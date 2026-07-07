import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clickButtonByLabel, clickComposerSubmitButton, typeComposer } from "./startup-shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const webDir = path.join(repoRoot, "apps", "web");

const captureDir =
  process.env.CLASH_DESKTOP_AGENT_BROWSER_CAPTURE_DIR ??
  path.join(repoRoot, ".tmp", "agent-browser-desktop-captures");
const dataDir =
  process.env.CLASH_DESKTOP_AGENT_BROWSER_DATA_DIR ??
  path.join(repoRoot, ".tmp", "agent-browser-desktop-data");
const sessionName = `clash-desktop-agent-browser-${Date.now().toString(36)}`;
const latestScreenshot = path.join(captureDir, "latest-agent-browser-desktop.png");
const historyScreenshot = path.join(captureDir, "history-agent-browser-desktop.png");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort(start) {
  const failures = [];
  for (let port = start; port < start + 100; port += 1) {
    const ok = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", (error) => {
        failures.push(`${port}:${error.code ?? error.message}`);
        resolve(false);
      });
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (ok) return port;
  }
  throw new Error(`No free port found from ${start}. Last bind errors: ${failures.slice(-5).join(", ")}`);
}

async function waitForHttp(url, label) {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`${label} did not become reachable at ${url}: ${lastError?.message ?? lastError}`);
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

function tail(lines, max = 100) {
  return lines.slice(Math.max(0, lines.length - max)).join("");
}

const forbiddenRendererPatterns = [
  /Cannot update a component .* while rendering a different component/,
  /Maximum update depth exceeded/,
  /Rendered (?:fewer|more) hooks than expected/,
  /Invalid hook call/,
  /Minified React error #/,
];

function assertNoForbiddenRendererIssues(logs) {
  const text = logs.join("");
  const matched = forbiddenRendererPatterns.find((pattern) => pattern.test(text));
  if (!matched) return;
  const lines = text
    .split(/\r?\n/)
    .filter((line) => forbiddenRendererPatterns.some((pattern) => pattern.test(line)));
  throw new Error(
    `Forbidden renderer issue matched ${matched}: ${lines.slice(-5).join("\n")}`,
  );
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function agentBrowser(args, opts = {}) {
  let result;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    result = spawnSync("agent-browser", ["--session", sessionName, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_BROWSER_SCREENSHOT_DIR: captureDir,
      },
    });
    if (result.status === 0) break;
    if (!String(result.stderr).includes("Resource temporarily unavailable")) break;
    sleepSync(250);
  }
  if (!opts.allowFailure && result.status !== 0) {
    throw new Error(
      `agent-browser ${args.join(" ")} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function parseEvalOutput(stdout) {
  const trimmed = stdout.trim();
  if (trimmed) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall back to the final non-empty line for primitive outputs that
      // include command status chatter.
    }
  }
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  try {
    return JSON.parse(last);
  } catch (error) {
    throw new Error(`Could not parse agent-browser eval output as JSON:\n${stdout}\n${error.message}`);
  }
}

function evalJson(expression) {
  return parseEvalOutput(agentBrowser(["eval", expression]));
}

async function waitForEval(expression, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = evalJson(expression);
    if (lastValue) return lastValue;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`);
}

function clickVisibleLinkOrButtonByText(text) {
  return evalJson(`(() => {
    const el = [...document.querySelectorAll("a, button, [role='button'], [role='tab']")].find((candidate) => {
      const value = (candidate.innerText || candidate.textContent || "").trim();
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return value === ${JSON.stringify(text)} &&
        rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" &&
        !candidate.disabled;
    });
    if (!el) return false;
    el.scrollIntoView({ block: "center", inline: "center" });
    el.click();
    return true;
  })()`);
}

function clickHistoryMenuItemByText(text) {
  return evalJson(`(() => {
    const wanted = ${JSON.stringify(text)};
    const menu = document.querySelector('[role="menu"][aria-label="Session history"], [role="menu"][aria-label="历史会话"]');
    const root = menu || document;
    const item = [...root.querySelectorAll("[role='menuitem']")].find((candidate) => {
      const value = (candidate.innerText || candidate.textContent || "").trim();
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return value.includes(wanted) &&
        rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" &&
        candidate.getAttribute("aria-disabled") !== "true";
    });
    if (!item) return false;
    item.scrollIntoView({ block: "center", inline: "center" });
    const pointerInit = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const mouseInit = { bubbles: true, cancelable: true, button: 0 };
    item.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
    item.dispatchEvent(new MouseEvent("mousedown", mouseInit));
    item.dispatchEvent(new PointerEvent("pointerup", pointerInit));
    item.dispatchEvent(new MouseEvent("mouseup", mouseInit));
    item.click();
    return true;
  })()`);
}

async function sendPrompt(text) {
  if (!typeComposer(agentBrowser, text)) throw new Error("Could not type into composer");
  const clickedSend = clickComposerSubmitButton(agentBrowser);
  if (!clickedSend) {
    throw new Error("Could not click send button");
  }
  await waitForEval(
    `document.body.innerText.includes(${JSON.stringify(text)}) &&
      document.body.innerText.includes(${JSON.stringify(`Mock ACP reply: ${text}`)})`,
    `mock ACP reply for ${text}`,
    20000,
  );
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function assertRuntimeHistory(projectId, apiOrigin, expectedCount) {
  const deadline = Date.now() + 20000;
  let lastState = null;
  while (Date.now() < deadline) {
    const sessions = await fetchJson(
      `${apiOrigin}/api/v1/sessions?projectId=${encodeURIComponent(projectId)}`,
    );
    const runtimeSessions = (sessions.sessions || sessions || []).filter((session) => session.type === "runtime");
    const messageCounts = [];
    for (const session of runtimeSessions) {
      const messages = await fetchJson(
        `${apiOrigin}/api/v1/local-sessions/${encodeURIComponent(session.threadId || session.id)}/messages`,
      );
      messageCounts.push((messages.messages || []).length);
    }
    lastState = {
      count: runtimeSessions.length,
      messageCounts,
      titles: runtimeSessions.map((session) => session.title || ""),
    };
    if (runtimeSessions.length >= expectedCount && messageCounts.every((count) => count >= 2)) {
      return lastState;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for runtime history ${expectedCount}: ${JSON.stringify(lastState)}`);
}

async function main() {
  if (!spawnSync("agent-browser", ["--help"], { encoding: "utf8" }).stdout.includes("agent-browser")) {
    throw new Error("agent-browser CLI is not available");
  }

  process.env.CLASH_E2E_STUB_ACP = "1";
  await rm(dataDir, { recursive: true, force: true });
  await rm(captureDir, { recursive: true, force: true });
  await mkdir(captureDir, { recursive: true });

  const webPort = await findFreePort(49870);
  const apiPort = await findFreePort(49920);
  const cdpPort = await findFreePort(49970);
  const webOrigin = `http://127.0.0.1:${webPort}`;

  const webLogs = [];
  const electronLogs = [];
  let web;
  let electron;

  try {
    web = spawn("pnpm", ["--dir", webDir, "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort)], {
      cwd: webDir,
      env: process.env,
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

    await waitForHttp(webOrigin, "Vite desktop-runtime web shell");

    const electronBin = require("electron");
    electron = spawn(electronBin, [`--remote-debugging-port=${cdpPort}`, desktopDir], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLASH_WEB_URL: webOrigin,
        CLASH_E2E_STUB_ACP: "1",
        CLASH_LOCAL_DATA_DIR: dataDir,
        CLASH_LOCAL_API_PORT: String(apiPort),
        CLASH_DESKTOP_CAPTURE_DIR: captureDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    electron.stdout.on("data", (buf) => {
      const text = String(buf);
      electronLogs.push(text);
      process.stdout.write(text);
    });
    electron.stderr.on("data", (buf) => {
      const text = String(buf);
      electronLogs.push(text);
      process.stderr.write(text);
    });
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, "Electron CDP");

    agentBrowser(["close"], { allowFailure: true });
    agentBrowser(["connect", String(cdpPort)]);
    await waitForEval(`document.body.innerText.includes("Home")`, "home page");
    const runtime = await waitForEval(
      `(() => window.__CLASH_RUNTIME_CONFIG__?.apiBaseUrl ? window.__CLASH_RUNTIME_CONFIG__ : false)()`,
      "Electron desktop runtime config",
    );
    const apiOrigin = runtime.apiBaseUrl;

    if (!clickVisibleLinkOrButtonByText("Projects")) throw new Error("Could not open Projects");
    await waitForEval(`location.pathname === "/projects"`, "projects route");
    if (!clickVisibleLinkOrButtonByText("New Project")) throw new Error("Could not create project");
    const projectId = await waitForEval(
      `location.pathname.startsWith("/projects/") &&
        location.pathname !== "/projects" &&
        location.pathname.split("/").pop()`,
      "project editor route",
      20000,
    );
    await waitForEval(`document.body.innerText.includes("Mock ACP")`, "mock ACP runtime ready", 20000);

    const firstPrompt = "agent-browser desktop first turn";
    const secondPrompt = "agent-browser desktop fresh turn";
    await sendPrompt(firstPrompt);
    const firstHistory = await assertRuntimeHistory(projectId, apiOrigin, 1);

    if (!clickButtonByLabel(agentBrowser, "New session") && !clickButtonByLabel(agentBrowser, "新建会话")) {
      throw new Error("Could not click New session");
    }
    await waitForEval(
      `!document.body.innerText.includes(${JSON.stringify(`Mock ACP reply: ${firstPrompt}`)})`,
      "fresh session cleared visible transcript",
      20000,
    );
    await sendPrompt(secondPrompt);
    const secondHistory = await assertRuntimeHistory(projectId, apiOrigin, 2);

    if (!clickButtonByLabel(agentBrowser, "Session history") && !clickButtonByLabel(agentBrowser, "历史会话")) {
      throw new Error("Could not open session history");
    }
    await waitForEval(
      `(() => {
        const menu = document.querySelector('[role="menu"][aria-label="Session history"], [role="menu"][aria-label="历史会话"]');
        return !!menu && !menu.innerText.toLowerCase().includes("no history yet");
      })()`,
      "session history panel",
      10000,
    );
    agentBrowser(["screenshot", historyScreenshot]);
    if (!clickHistoryMenuItemByText(firstPrompt)) {
      throw new Error("Could not restore the first session from history");
    }
    await waitForEval(
      `document.body.innerText.includes(${JSON.stringify(firstPrompt)}) &&
        document.body.innerText.includes(${JSON.stringify(`Mock ACP reply: ${firstPrompt}`)})`,
      "restored first session transcript",
      20000,
    );

    const state = evalJson(`(() => ({
      href: location.href,
      projectId: ${JSON.stringify(projectId)},
      bodyText: document.body.innerText.slice(0, 1200),
      runtime: window.__CLASH_RUNTIME_CONFIG__ ?? null,
    }))()`);
    agentBrowser(["screenshot", latestScreenshot]);
    console.log("[desktop-agent-browser] state", JSON.stringify(state));
    console.log("[desktop-agent-browser] history", JSON.stringify({ firstHistory, secondHistory }));
    console.log(`[desktop-agent-browser] screenshot ${latestScreenshot}`);
    console.log(`[desktop-agent-browser] history screenshot ${historyScreenshot}`);
    assertNoForbiddenRendererIssues(electronLogs);
  } catch (error) {
    try {
      agentBrowser(["screenshot", latestScreenshot], { allowFailure: true });
      console.error(`[desktop-agent-browser] failure screenshot ${latestScreenshot}`);
    } catch {
      // Ignore screenshot failure while unwinding.
    }
    console.error("[desktop-agent-browser] web logs\n" + tail(webLogs));
    console.error("[desktop-agent-browser] electron logs\n" + tail(electronLogs));
    throw error;
  } finally {
    agentBrowser(["close"], { allowFailure: true });
    await stopProcess(electron);
    await stopProcess(web);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
