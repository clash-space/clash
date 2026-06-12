import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(webDir, "..", "..");
const dataDir = process.env.CLASH_WEB_E2E_DATA_DIR ?? path.join(repoRoot, ".tmp", "web-e2e-local-api-data");
const chromeDataDir = process.env.CLASH_WEB_E2E_CHROME_DATA_DIR ?? path.join(repoRoot, ".tmp", "web-e2e-chrome");
const captureDir = process.env.CLASH_WEB_E2E_CAPTURE_DIR ?? path.join(repoRoot, ".tmp", "web-e2e-captures");
const latestScreenshot = path.join(captureDir, "latest-web-local-runtime.png");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details === undefined ? "" : `: ${JSON.stringify(details)}`}`);
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

async function waitForHttp(url, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server is still booting.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}: ${url}`);
}

function tail(lines, max = 80) {
  return lines.slice(Math.max(0, lines.length - max)).join("");
}

function chromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("No Chrome-compatible browser found. Set CHROME_BIN to run web E2E.");
  }
  return found;
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
      // CDP is still booting.
    }
    await sleep(200);
  }
  throw new Error("Timed out waiting for Chrome CDP target");
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
      return true;
    })()`,
    `click ${label}`,
  );
}

function clickableByText(label) {
  return `([...document.querySelectorAll("a, button, [role='button'], [role='tab']")].find((el) => {
    const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return text === ${JSON.stringify(label)} &&
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden";
  }))`;
}

async function typeChatMessage(cdp, text) {
  const inserted = await evaluate(cdp, `(() => {
    const editor = document.querySelector(".milkdown-chat-input [contenteditable='true']");
    if (!editor) return false;
    editor.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, ${JSON.stringify(text)});
    editor.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: ${JSON.stringify(text)}
    }));
    return (editor.innerText || editor.textContent || "").includes(${JSON.stringify(text)});
  })()`);
  if (!inserted) throw new Error("Could not type into chat editor");
}

async function capture(cdp, targetPath = latestScreenshot) {
  await mkdir(captureDir, { recursive: true });
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(targetPath, Buffer.from(shot.data, "base64"));
}

async function exerciseLocalRuntimeUi(cdp) {
  await waitFor(cdp, `document.body.innerText.includes("Home")`, "home");
  const runtime = await evaluate(cdp, `window.__CLASH_RUNTIME_CONFIG__ ?? null`);
  assert(runtime?.apiBaseUrl, "web runtime config was injected", runtime);

  await click(cdp, clickableByText("Projects"), "Projects");
  await waitFor(cdp, `location.pathname === "/projects"`, "projects page");
  await click(cdp, clickableByText("New Project"), "New Project");
  await waitFor(
    cdp,
    `location.pathname.startsWith("/projects/") && location.pathname !== "/projects" && !!document.querySelector("#editor-header")`,
    "project editor",
    15000,
  );

  await click(
    cdp,
    `document.querySelector("button[aria-label='Run on (Cloud / local runtime)']") ||
      document.querySelector("button[aria-label='运行环境（云端 / 本地）']")`,
    "Run on runtime picker",
  );
  await click(
    cdp,
    `([...document.querySelectorAll("[role='menuitem'], button")].find((el) => {
      const text = (el.innerText || el.textContent || "").trim();
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return text.includes("Mock Desktop") &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    }))`,
    "Mock Desktop runtime",
  );
  await waitFor(cdp, `document.body.innerText.includes("Start local helper on Mock Desktop")`, "runtime picker dialog");
  await click(cdp, clickableByText("Start helper"), "Start helper");
  await waitFor(
    cdp,
    `document.body.innerText.includes("Local agent connected") ||
      document.body.innerText.includes("本地 Agent 已连接")`,
    "local runtime connected",
    15000,
  );

  const prompt = "hello web runtime helper";
  await typeChatMessage(cdp, prompt);
  await click(
    cdp,
    `([...document.querySelectorAll("button")].find((button) => {
      const label = (button.getAttribute("aria-label") || "").toLowerCase();
      const rect = button.getBoundingClientRect();
      return (label.includes("send") || label.includes("发送")) &&
        !button.disabled &&
        rect.width > 0 &&
        rect.height > 0;
    }))`,
    "Send runtime prompt",
  );
  await waitFor(
    cdp,
    `document.body.innerText.includes(${JSON.stringify(prompt)}) &&
      document.body.innerText.includes(${JSON.stringify(`Mock ACP reply: ${prompt}`)})`,
    "runtime mock ACP reply",
    15000,
  );
  await waitFor(
    cdp,
    `(() => {
      const nodes = [...document.querySelectorAll(".react-flow__node")].map((node) => ({
        id: node.getAttribute("data-id") || "",
        text: (node.querySelector("input")?.value || "") + " " + (node.innerText || node.textContent || ""),
      }));
      return nodes.some((node) => node.id.includes("mock-agent-stage-")) &&
        nodes.some((node) => node.text.includes("Agent Brief")) &&
        nodes.some((node) => node.text.includes("Agent Image Pass"));
    })()`,
    "runtime-created canvas nodes",
    15000,
  );

  return evaluate(cdp, `({
    href: location.href,
    text: document.body.innerText.slice(0, 800),
    runtime: window.__CLASH_RUNTIME_CONFIG__ ?? null,
    nodes: [...document.querySelectorAll(".react-flow__node")].map((node) => ({
      id: node.getAttribute("data-id"),
      text: ((node.querySelector("input")?.value || "") + " " + (node.innerText || node.textContent || "")).trim().slice(0, 180),
    })).filter((node) =>
      (node.id || "").includes("mock-agent-stage-") ||
      node.text.includes("Agent Brief") ||
      node.text.includes("Agent Image Pass")
    ),
  })`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(3000).then(() => false),
  ]);
  if (!exited) child.kill("SIGKILL");
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  process.env.CLASH_LOCAL_ACP_MOCK = "1";
  await rm(dataDir, { recursive: true, force: true });
  await rm(chromeDataDir, { recursive: true, force: true });

  const apiPort = await findFreePort(49600);
  const webPort = await findFreePort(49650);
  const cdpPort = await findFreePort(49700);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const webOrigin = `http://127.0.0.1:${webPort}`;

  const { startLocalApiServer } = await import("../../local-api/dist/server.js");
  const apiServer = await startLocalApiServer({ port: apiPort, dataDir });
  const webLogs = [];
  const chromeLogs = [];
  let web;
  let chrome;
  let cdp;

  try {
    web = spawn("pnpm", ["--dir", webDir, "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort)], {
      cwd: webDir,
      env: {
        ...process.env,
        VITE_CLASH_API_BASE_URL: apiOrigin,
        VITE_CLASH_WS_BASE_URL: apiOrigin.replace("http:", "ws:"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    web.stdout.on("data", (buf) => {
      const text = String(buf);
      webLogs.push(text);
      process.stdout.write(text);
    });
    web.stderr.on("data", (buf) => {
      const text = String(buf);
      webLogs.push(text);
      process.stderr.write(text);
    });
    await waitForHttp(webOrigin, "Vite web server");

    chrome = spawn(chromeBinary(), [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${chromeDataDir}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-renderer-backgrounding",
      "--window-size=1440,1000",
      "about:blank",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    chrome.stdout.on("data", (buf) => chromeLogs.push(String(buf)));
    chrome.stderr.on("data", (buf) => chromeLogs.push(String(buf)));

    cdp = new CdpClient(await waitForTarget(cdpPort));
    await cdp.ready();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: webOrigin });
    const state = await exerciseLocalRuntimeUi(cdp);
    await capture(cdp);
    console.log("[web-smoke] local runtime", JSON.stringify(state));
    console.log(`[web-smoke] screenshot ${latestScreenshot}`);
  } catch (error) {
    if (cdp) {
      try {
        await capture(cdp);
        console.error(`[web-smoke] failure screenshot ${latestScreenshot}`);
      } catch {
        // Ignore capture failure while unwinding.
      }
    }
    console.error("[web-smoke] web logs\n" + tail(webLogs));
    console.error("[web-smoke] chrome logs\n" + tail(chromeLogs));
    throw error;
  } finally {
    if (cdp) cdp.close();
    await stopProcess(chrome);
    await stopProcess(web);
    await closeServer(apiServer);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
