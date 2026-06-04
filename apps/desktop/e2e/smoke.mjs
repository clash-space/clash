import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");

const appBinary = process.env.CLASH_DESKTOP_APP_BINARY;
const usePackagedApp = Boolean(appBinary);
const webUrl = process.env.CLASH_WEB_URL ?? "http://127.0.0.1:3001";
const captureDir =
  process.env.CLASH_DESKTOP_CAPTURE_DIR ??
  path.join(repoRoot, ".tmp", "electron-smoke-captures");
const dataDir =
  process.env.CLASH_DESKTOP_SMOKE_DATA_DIR ??
  path.join(repoRoot, ".tmp", "electron-smoke-data");
const latestScreenshot = path.join(captureDir, "latest-cdp-smoke.png");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertWebServer() {
  try {
    const res = await fetch(webUrl, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    throw new Error(
      `Web app is not reachable at ${webUrl}. Start it first: pnpm --filter @master-clash/web dev\n` +
        `Reason: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function findFreePort(start) {
  for (let port = start; port < start + 100; port += 1) {
    const ok = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (ok) return port;
  }
  throw new Error(`No free port found from ${start}`);
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}`);
  }
}

function tail(lines, max = 80) {
  return lines.slice(Math.max(0, lines.length - max)).join("");
}

async function waitForTarget(cdpPort) {
  const url = `http://127.0.0.1:${cdpPort}/json/list`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // Electron may not have opened the DevTools endpoint yet.
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for Electron CDP page target");
}

class CdpClient {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (!msg.id || !this.pending.has(msg.id)) return;
      const pending = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
      else pending.resolve(msg.result);
    });
  }

  async ready() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.ws.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed");
  }
  return result.result.value;
}

async function waitFor(cdp, expression, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(cdp, expression);
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function click(cdp, selectorExpression, label) {
  return waitFor(
    cdp,
    `(() => {
      const el = (${selectorExpression});
      if (!el) return false;
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return {
        label: ${JSON.stringify(label)},
        text: (el.innerText || el.textContent || "").trim(),
        href: location.href
      };
    })()`,
    `click ${label}`,
  );
}

function clickableByText(label) {
  return `([...document.querySelectorAll("a, button, [role='button'], [role='tab']")].find((el) => {
    const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
    if (text !== ${JSON.stringify(label)}) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }))`;
}

function assertReadableTheme(state) {
  if (state.bodyColor === "rgb(255, 255, 255)" && state.bodyBg !== "rgb(0, 0, 0)") {
    throw new Error(`Body text is white on a non-black background: ${JSON.stringify(state)}`);
  }
}

async function capture(cdp) {
  await mkdir(captureDir, { recursive: true });
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(latestScreenshot, Buffer.from(shot.data, "base64"));
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(3000).then(() => false),
  ]);
  if (!exited) child.kill("SIGKILL");
}

async function main() {
  if (!usePackagedApp) {
    await assertWebServer();
    run("pnpm", ["--filter", "@master-clash/local-api", "build"]);
    run("pnpm", ["--filter", "@master-clash/desktop", "build"]);
  }

  const cdpPort = await findFreePort(49355);
  const apiPort = await findFreePort(49356);
  const electronBin = path.join(repoRoot, "node_modules", ".bin", "electron");
  const launchCommand = appBinary ?? electronBin;
  const launchArgs = usePackagedApp
    ? []
    : [`--remote-debugging-port=${cdpPort}`, desktopDir];
  const logs = [];
  const child = spawn(launchCommand, launchArgs, {
    cwd: usePackagedApp ? path.dirname(launchCommand) : repoRoot,
    env: {
      ...process.env,
      ...(usePackagedApp ? {} : { CLASH_WEB_URL: webUrl }),
      ...(usePackagedApp ? { CLASH_DESKTOP_REMOTE_DEBUGGING_PORT: String(cdpPort) } : {}),
      CLASH_LOCAL_DATA_DIR: dataDir,
      CLASH_LOCAL_API_PORT: String(apiPort),
      CLASH_DESKTOP_CAPTURE_DIR: captureDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (buf) => {
    const text = String(buf);
    logs.push(text);
    process.stdout.write(text);
  });
  child.stderr.on("data", (buf) => {
    const text = String(buf);
    logs.push(text);
    process.stderr.write(text);
  });

  let cdp;
  try {
    cdp = new CdpClient(await waitForTarget(cdpPort));
    await cdp.ready();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.bringToFront");

    await waitFor(cdp, `document.body.innerText.includes("Home")`, "home");
    const homeState = await evaluate(cdp, `({
      href: location.href,
      text: document.body.innerText.slice(0, 240),
      bodyColor: getComputedStyle(document.body).color,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      runtime: window.__CLASH_RUNTIME_CONFIG__ ?? null
    })`);
    assertReadableTheme(homeState);
    console.log("[desktop-smoke] home", JSON.stringify(homeState));

    await click(cdp, clickableByText("Projects"), "Projects");
    await waitFor(cdp, `location.pathname === "/projects"`, "projects page");

    await click(cdp, clickableByText("New Project"), "New Project");
    await waitFor(
      cdp,
      `location.pathname.startsWith("/projects/") && location.pathname !== "/projects" && !!document.querySelector("#editor-header")`,
      "project editor",
      15000,
    );
    const projectState = await evaluate(cdp, `({
      href: location.href,
      text: document.body.innerText.slice(0, 240),
      hasEditorHeader: !!document.querySelector("#editor-header")
    })`);
    console.log("[desktop-smoke] project", JSON.stringify(projectState));

    await click(
      cdp,
      `document.querySelector("#editor-header a[href='/']") || [...document.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/")`,
      "Logo Home",
    );
    await waitFor(cdp, `location.pathname === "/" && document.body.innerText.includes("Projects")`, "home from editor");

    await click(cdp, clickableByText("Projects"), "Projects again");
    await waitFor(cdp, `location.pathname === "/projects"`, "projects page again");

    await click(cdp, clickableByText("Store"), "Store");
    await waitFor(cdp, `location.pathname === "/marketplace"`, "store page");

    const finalState = await evaluate(cdp, `({
      href: location.href,
      title: document.title,
      text: document.body.innerText.slice(0, 500),
      bodyColor: getComputedStyle(document.body).color,
      bodyBg: getComputedStyle(document.body).backgroundColor
    })`);
    assertReadableTheme(finalState);
    await capture(cdp);
    console.log("[desktop-smoke] final", JSON.stringify(finalState));
    console.log(`[desktop-smoke] screenshot ${latestScreenshot}`);
  } catch (error) {
    if (cdp) {
      try {
        await capture(cdp);
        console.error(`[desktop-smoke] failure screenshot ${latestScreenshot}`);
      } catch {
        // Ignore screenshot failures during cleanup.
      }
    }
    console.error(tail(logs));
    throw error;
  } finally {
    if (cdp) cdp.close();
    await stopProcess(child);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
