import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const desktopDir = path.resolve(__dirname, "..");
export const repoRoot = path.resolve(desktopDir, "..", "..");
export const webDir = path.join(repoRoot, "apps", "web");

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function findFreePort(start) {
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
  const fallback = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error(`No free port found from ${start}`));
      });
    });
  });
  return fallback;
}

export async function waitForHttp(url, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
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

export async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(3000).then(() => false),
  ]);
  if (!exited) child.kill("SIGKILL");
}

export function tail(lines, max = 120) {
  return lines.slice(Math.max(0, lines.length - max)).join("");
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function ensureAgentBrowser() {
  const result = spawnSync("agent-browser", ["--help"], { encoding: "utf8" });
  if (result.status !== 0 || !`${result.stdout}\n${result.stderr}`.includes("agent-browser")) {
    throw new Error("agent-browser CLI is not available");
  }
}

export function createAgentBrowser({ sessionName, captureDir }) {
  return function agentBrowser(args, opts = {}) {
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
  };
}

function parseEvalOutput(stdout) {
  const trimmed = stdout.trim();
  if (trimmed) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // agent-browser may print a status line before primitive JSON output.
    }
  }
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return JSON.parse(last);
}

export function evalJson(agentBrowser, expression) {
  return parseEvalOutput(agentBrowser(["eval", expression]));
}

export function recoverAgentBrowserTarget(agentBrowser, {
  cdpPort,
  expectedUrlPrefix,
  maxAttempts = 8,
}) {
  let lastHref = "about:blank";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    agentBrowser(["close"], { allowFailure: true });
    agentBrowser(["connect", String(cdpPort)], { allowFailure: true });
    try {
      lastHref = evalJson(agentBrowser, "location.href");
      if (typeof lastHref === "string" && lastHref.startsWith(expectedUrlPrefix)) {
        return lastHref;
      }
    } catch {
      lastHref = "unavailable";
    }
    if (attempt + 1 < maxAttempts) sleepSync(250);
  }
  throw new Error(
    `Could not recover Electron agent-browser target at ${expectedUrlPrefix}; last URL: ${lastHref}`,
  );
}

export function runtimeSessionPathObservation({
  session,
  projectId,
  apiOrigin,
  dataDir,
  messageCount,
}) {
  const id = session.threadId || session.id;
  return {
    id,
    projectId: session.projectId || projectId,
    title: session.title || "",
    messageCount,
    apiPath: `${apiOrigin}/api/v1/local-sessions/${encodeURIComponent(id)}/messages`,
    storagePath: path.join(dataDir, "local.sqlite"),
    cwdPath: null,
  };
}

export async function waitForEval(agentBrowser, expression, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = evalJson(agentBrowser, expression);
    if (lastValue) return lastValue;
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`);
}

export function clickByText(agentBrowser, text) {
  return evalJson(agentBrowser, `(() => {
    const wanted = ${JSON.stringify(text)};
    const el = [...document.querySelectorAll("a, button, [role='button'], [role='tab']")].find((candidate) => {
      const value = (candidate.innerText || candidate.textContent || "").trim();
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return value === wanted &&
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

export function clickButtonByLabel(agentBrowser, label) {
  return evalJson(agentBrowser, `(() => {
    const wanted = ${JSON.stringify(label)};
    const activate = (el) => {
      el.scrollIntoView({ block: "center", inline: "center" });
      const pointerInit = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
      const mouseInit = { bubbles: true, cancelable: true, button: 0 };
      el.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
      el.dispatchEvent(new MouseEvent("mousedown", mouseInit));
      el.dispatchEvent(new PointerEvent("pointerup", pointerInit));
      el.dispatchEvent(new MouseEvent("mouseup", mouseInit));
      el.click();
    };
    const button = [...document.querySelectorAll("button")].find((el) => {
      const text = (el.innerText || el.textContent || "").trim();
      const aria = el.getAttribute("aria-label") || "";
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (text === wanted || aria === wanted) &&
        rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" &&
        !el.disabled;
    });
    if (!button) return false;
    activate(button);
    return true;
  })()`);
}

export function typeComposer(agentBrowser, text) {
  const selector = ".milkdown-chat-input [contenteditable='true']";
  const expectedPlainText = text.replaceAll("`", "");
  const chunks = text.match(/.{1,16}/g) ?? [text];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ready = evalJson(agentBrowser, `(() => {
      const editor = document.querySelector(${JSON.stringify(selector)});
      const rect = editor?.getBoundingClientRect();
      const style = editor ? getComputedStyle(editor) : null;
      return !!editor && !!rect &&
        rect.width > 0 && rect.height > 0 &&
        style?.display !== "none" && style?.visibility !== "hidden";
    })()`);
    if (!ready) {
      sleepSync(500);
      continue;
    }

    agentBrowser(["click", selector]);
    sleepSync(500);
    agentBrowser(["press", "Meta+A"], { allowFailure: true });
    agentBrowser(["press", "Control+A"], { allowFailure: true });
    agentBrowser(["press", "Backspace"], { allowFailure: true });
    sleepSync(100);
    for (const chunk of chunks) {
      agentBrowser(["keyboard", "type", chunk]);
      sleepSync(40);
    }

    const deadline = Date.now() + 5000;
    let accepted = false;
    while (Date.now() < deadline) {
      accepted = evalJson(agentBrowser, `(() => {
        const editor = document.querySelector(${JSON.stringify(selector)});
        const surface = editor?.closest(".clash-chat-input-surface");
        const currentText = editor?.innerText || editor?.textContent || "";
        const submit =
          surface?.querySelector("button[aria-label='Send message']:not([disabled])") ||
          surface?.querySelector("button[aria-label='发送']:not([disabled])") ||
          surface?.querySelector("button.clash-chat-input-primary:not([disabled])");
        return currentText.includes(${JSON.stringify(expectedPlainText)}) && !!submit;
      })()`);
      if (accepted) return true;
      sleepSync(200);
    }
  }

  return false;
}

export function clickComposerSend(agentBrowser) {
  return clickButtonByLabel(agentBrowser, "Send message") ||
    clickButtonByLabel(agentBrowser, "发送") ||
    evalJson(agentBrowser, `(() => {
      const editor = document.querySelector(".milkdown-chat-input [contenteditable='true']");
      const composer = editor?.closest("form, [role='form']") ||
        editor?.closest(".milkdown-chat-input")?.parentElement?.parentElement?.parentElement;
      if (!composer) return false;
      const buttons = [...composer.querySelectorAll("button")].filter((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== "none" && style.visibility !== "hidden" &&
          !button.disabled;
      });
      const button = buttons.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
      if (!button) return false;
      button.click();
      return true;
    })()`);
}

export function clickComposerSubmitButton(agentBrowser) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const clicked = evalJson(agentBrowser, `(() => {
      const editor = document.querySelector(".milkdown-chat-input [contenteditable='true']");
      const surface = editor?.closest(".clash-chat-input-surface");
      const submit =
        surface?.querySelector("button[aria-label='Send message']:not([disabled])") ||
        surface?.querySelector("button[aria-label='发送']:not([disabled])") ||
        surface?.querySelector("button.clash-chat-input-primary:not([disabled])") ||
        (() => {
          if (!surface) return null;
          const surfaceRect = surface.getBoundingClientRect();
          const buttons = [...surface.querySelectorAll("button")].filter((button) => {
            const rect = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return !button.disabled &&
              rect.width > 0 && rect.height > 0 &&
              style.display !== "none" && style.visibility !== "hidden" &&
              rect.right > surfaceRect.right - 96 &&
              rect.bottom > surfaceRect.bottom - 96;
          });
          return buttons.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0] ?? null;
        })();
      if (!submit) return false;
      const rect = submit.getBoundingClientRect();
      const style = getComputedStyle(submit);
      if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") return false;
      submit.scrollIntoView({ block: "center", inline: "center" });
      submit.click();
      return true;
    })()`);
    if (clicked) return true;
    sleepSync(250);
  }
  return false;
}

export async function startVite({ webPort, logs }) {
  const viteBin = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
  const persistStateDir = path.join(repoRoot, ".tmp", "desktop-vite-state", String(webPort));
  await rm(persistStateDir, { recursive: true, force: true });
  await mkdir(persistStateDir, { recursive: true });
  const web = spawn(viteBin, ["--host", "127.0.0.1", "--port", String(webPort)], {
    cwd: webDir,
    env: {
      ...process.env,
      CLASH_WEB_E2E_PERSIST_STATE: persistStateDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  web.stdout.on("data", (buf) => {
    const text = String(buf);
    logs.push(text);
    process.stdout.write(text);
  });
  web.stderr.on("data", (buf) => {
    const text = String(buf);
    logs.push(text);
    process.stderr.write(text);
  });
  return web;
}

export async function startElectron({ cdpPort, webOrigin, apiPort, dataDir, captureDir, logs, env = {} }) {
  const electronBin = require("electron");
  const electron = spawn(electronBin, [`--remote-debugging-port=${cdpPort}`, desktopDir], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      CLASH_WEB_URL: webOrigin,
      CLASH_LOCAL_DATA_DIR: dataDir,
      CLASH_LOCAL_API_PORT: String(apiPort),
      CLASH_DESKTOP_CAPTURE_DIR: captureDir,
      CLASH_NODE_EXEC_PATH: process.execPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  electron.stdout.on("data", (buf) => {
    const text = String(buf);
    logs.push(text);
    process.stdout.write(text);
  });
  electron.stderr.on("data", (buf) => {
    const text = String(buf);
    logs.push(text);
    process.stderr.write(text);
  });
  return electron;
}

export async function resetDirs(...dirs) {
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
  }
}
