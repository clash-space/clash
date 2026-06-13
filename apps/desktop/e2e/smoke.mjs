import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");

const appBinary = process.env.CLASH_DESKTOP_APP_BINARY;
const usePackagedApp = Boolean(appBinary);
let webUrl = process.env.CLASH_WEB_URL;
const captureDir =
  process.env.CLASH_DESKTOP_CAPTURE_DIR ??
  path.join(repoRoot, ".tmp", "electron-smoke-captures");
const dataDir =
  process.env.CLASH_DESKTOP_SMOKE_DATA_DIR ??
  path.join(repoRoot, ".tmp", "electron-smoke-data");
const latestScreenshot = path.join(captureDir, "latest-cdp-smoke.png");
const runtimeCopilotScreenshot = path.join(captureDir, "runtime-copilot-ui.png");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertWebServer() {
  const deadline = Date.now() + 25000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(webUrl, { signal: AbortSignal.timeout(2500) });
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(
    `Web app is not reachable at ${webUrl}. Start it first: pnpm --filter @master-clash/web dev\n` +
      `Reason: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
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

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function writeJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startMockCloudRoomServer() {
  const port = await findFreePort(49450);
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const roomMatch = /^\/api\/v1\/projects\/([^/]+)\/room\/messages$/.exec(url.pathname);
    if (roomMatch) {
      const projectId = decodeURIComponent(roomMatch[1]);
      if (req.method === "GET") {
        requests.push({
          kind: "room",
          method: "GET",
          projectId,
          authorization: req.headers.authorization ?? "",
        });
        return writeJson(res, 200, { messages: [] });
      }
      if (req.method === "POST") {
        const raw = await readRequestBody(req);
        const body = raw.byteLength ? JSON.parse(raw.toString("utf8")) : {};
        requests.push({
          kind: "room",
          method: "POST",
          projectId,
          authorization: req.headers.authorization ?? "",
          body,
        });
        return writeJson(res, 201, {
          id: body.id ?? "mock-cloud-room-message",
          project_id: projectId,
          sender_kind: body.sender_kind ?? "user",
          sender_id: body.sender_id ?? "local-user",
          sender_user_id: "local-user",
          mentions: body.mentions ?? [],
          text: body.text ?? "",
          at: Math.floor(Date.now() / 1000),
        });
      }
    }

    if (/^\/loro\/.+\/snapshot$/.test(url.pathname) && req.method === "GET") {
      requests.push({ kind: "loro", method: "GET", path: url.pathname });
      res.writeHead(404);
      res.end();
      return;
    }
    if (/^\/loro\/.+\/updates$/.test(url.pathname) && req.method === "POST") {
      const raw = await readRequestBody(req);
      requests.push({
        kind: "loro",
        method: "POST",
        path: url.pathname,
        bytes: raw.byteLength,
        authorization: req.headers.authorization ?? "",
      });
      res.writeHead(204);
      res.end();
      return;
    }

    writeJson(res, 404, { error: "not found" });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
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

async function startWebServerIfNeeded() {
  if (usePackagedApp) return null;
  if (webUrl) {
    await assertWebServer();
    return null;
  }

  const port = await findFreePort(3001);
  webUrl = `http://127.0.0.1:${port}`;
  const webDir = path.join(repoRoot, "apps", "web");
  const logs = [];
  const child = spawn("pnpm", ["--dir", webDir, "exec", "vite", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: webDir,
    env: process.env,
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
  try {
    await assertWebServer();
  } catch (error) {
    console.error("[desktop-smoke] web server logs\n" + tail(logs));
    await stopProcess(child);
    throw error;
  }
  return child;
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

async function waitForValue(fn, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
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

async function capture(cdp, targetPath = latestScreenshot) {
  await mkdir(captureDir, { recursive: true });
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(targetPath, Buffer.from(shot.data, "base64"));
}

async function typeRoomMessage(cdp, text) {
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
  if (!inserted) throw new Error("Could not type into room chat editor");
}

async function sendSyntheticLoroUpdate(apiPort, projectId) {
  const { LoroDoc } = await import("loro-crdt");
  const ws = new WebSocket(`ws://127.0.0.1:${apiPort}/sync/${encodeURIComponent(projectId)}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const doc = new LoroDoc();
  doc.getMap("nodes").set("desktop-e2e-node", {
    type: "text",
    position: { x: 120, y: 120 },
    data: { label: "Desktop E2E Loro" },
  });
  ws.send(doc.export({ mode: "snapshot" }));
  await sleep(250);
  ws.close();
}

async function exerciseLocalAcpSessionHistory(cdp) {
  const state = await evaluate(cdp, `(async () => {
    const runtime = window.__CLASH_RUNTIME_CONFIG__;
    const runtimes = await (await fetch(runtime.apiBaseUrl + "/api/v1/runtimes")).json();
    const createdRes = await fetch(runtime.apiBaseUrl + "/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        crew_id: "director",
        project_id: "desktop-smoke-agent"
      })
    });
    const created = await createdRes.json();
    if (!createdRes.ok) {
      return { ok: false, stage: "create", status: createdRes.status, runtimes, created };
    }

    const turnId = "desktop-smoke-turn";
    const promptText = "hello desktop local agent";
    const events = [];
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(runtime.wsBaseUrl + "/api/v1/local-sessions/" + encodeURIComponent(created.session_id) + "/_stream");
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for mock ACP completion"));
      }, 10000);
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ type: "prompt", turn_id: turnId, text: promptText }));
      });
      ws.addEventListener("message", (event) => {
        const msg = JSON.parse(String(event.data));
        events.push(msg);
        if (msg.type === "session.complete" && msg.turn_id === turnId) {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        }
      });
      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Mock ACP websocket failed"));
      });
    });

    const historyRes = await fetch(runtime.apiBaseUrl + "/api/v1/local-sessions/" + encodeURIComponent(created.session_id) + "/messages");
    const history = await historyRes.json();
    return {
      ok: historyRes.ok,
      stage: "history",
      status: historyRes.status,
      runtimes,
      created,
      events,
      history
    };
  })()`);

  const agents = state.runtimes?.runtimes?.flatMap((runtime) => runtime.agents ?? []) ?? [];
  const userMessage = state.history?.messages?.find((message) =>
    message.sender_kind === "user" &&
    message.events?.some((event) => event.type === "text" && event.text === "hello desktop local agent")
  );
  const crewMessage = state.history?.messages?.find((message) =>
    message.sender_kind === "crew" &&
    message.events?.some((event) => event.type === "text" && event.text === "Mock ACP reply: hello desktop local agent")
  );
  if (!state.ok || !agents.some((agent) => agent.id === "mock-acp") || !userMessage || !crewMessage) {
    throw new Error(`Local ACP session history smoke failed: ${JSON.stringify(state)}`);
  }
  console.log("[desktop-smoke] local acp history", JSON.stringify({
    session_id: state.created.session_id,
    events: state.events.map((event) => event.type),
    messages: state.history.messages.map((message) => ({
      sender_kind: message.sender_kind,
      sender_id: message.sender_id,
      turn_id: message.turn_id,
    })),
  }));
}

async function exerciseRuntimeCopilotUi(cdp) {
  await waitFor(
    cdp,
    `!!document.querySelector('[aria-label="AI Copilot"], [aria-label="AI 副驾驶"]')`,
    "AI Copilot panel",
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

  const prompt = "hello desktop runtime helper";
  await typeRoomMessage(cdp, prompt);
  await click(
    cdp,
    `([...document.querySelectorAll("button")].find((button) => {
      const label = (button.getAttribute("aria-label") || "").toLowerCase();
      const rect = button.getBoundingClientRect();
      return label.includes("send") && !button.disabled && rect.width > 0 && rect.height > 0;
      }))`,
    "Send runtime prompt",
  );

  try {
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
  } catch (error) {
    const diagnostics = await evaluate(cdp, `(() => ({
      bodyText: document.body.innerText.slice(0, 2000),
      runtimeMenuButtons: [...document.querySelectorAll("button, [role='menuitem']")].map((button) => ({
        text: (button.innerText || button.textContent || "").trim(),
        ariaLabel: button.getAttribute("aria-label"),
        disabled: button.disabled || button.getAttribute("aria-disabled"),
      })),
    }))()`);
    console.error("[desktop-smoke] runtime copilot diagnostics", JSON.stringify(diagnostics, null, 2));
    throw error;
  }

  const state = await evaluate(cdp, `(() => {
    const nodes = [...document.querySelectorAll(".react-flow__node")].map((node) => ({
      id: node.getAttribute("data-id"),
      text: ((node.querySelector("input")?.value || "") + " " + (node.innerText || node.textContent || "")).trim().slice(0, 180),
      rect: (() => {
        const r = node.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      })()
    }));
    return {
      text: document.body.innerText.slice(0, 800),
      url: location.href,
      nodes: nodes.filter((node) =>
        (node.id || "").includes("mock-agent-stage-") ||
        node.text.includes("Agent Brief") ||
        node.text.includes("Agent Image Pass")
      ),
    };
  })()`);
  await capture(cdp, runtimeCopilotScreenshot);
  console.log("[desktop-smoke] runtime copilot ui", JSON.stringify(state));
  console.log(`[desktop-smoke] runtime copilot screenshot ${runtimeCopilotScreenshot}`);
}

async function stopProcess(child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(3000).then(() => false),
  ]);
  if (!exited) child.kill("SIGKILL");
}

async function main() {
  let webChild = null;
  if (!usePackagedApp) {
    run("pnpm", ["--filter", "@master-clash/local-api", "build"]);
    run("pnpm", ["--filter", "@master-clash/desktop", "build"]);
    webChild = await startWebServerIfNeeded();
  }

  const cdpPort = await findFreePort(49355);
  const apiPort = await findFreePort(49356);
  await rm(dataDir, { recursive: true, force: true });
  const mockCloud = await startMockCloudRoomServer();
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
      CLASH_LOCAL_ACP_MOCK: "1",
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

    const syncState = await evaluate(cdp, `(async () => {
      const runtime = window.__CLASH_RUNTIME_CONFIG__;
      const res = await fetch(runtime.apiBaseUrl + "/api/v1/local/sync", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "cloud-sync",
          remote_loro_url: ${JSON.stringify(mockCloud.url)},
          remote_loro_token: "clsh_smoke_token"
        })
      });
      return await res.json();
    })()`);
    if (syncState.mode !== "cloud-sync") {
      throw new Error(`Failed to enable cloud sync: ${JSON.stringify(syncState)}`);
    }
    console.log("[desktop-smoke] sync", JSON.stringify(syncState));
    await exerciseLocalAcpSessionHistory(cdp);

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

    const projectId = await evaluate(cdp, `location.pathname.split("/").filter(Boolean).at(-1)`);
    const loroSnapshot = await waitForValue(
      () => mockCloud.requests.find((req) =>
        req.kind === "loro" &&
        req.method === "GET" &&
        req.path.includes(encodeURIComponent(projectId))
      ),
      "mock cloud Loro snapshot fetch",
      15000,
    );
    console.log("[desktop-smoke] loro cloud snapshot", JSON.stringify(loroSnapshot));
    await exerciseRuntimeCopilotUi(cdp);
    await sendSyntheticLoroUpdate(apiPort, projectId);
    const loroUpdate = await waitForValue(
      () => mockCloud.requests.find((req) =>
        req.kind === "loro" &&
        req.method === "POST" &&
        req.path.includes(encodeURIComponent(projectId)) &&
        req.bytes > 0
      ),
      "mock cloud Loro update append",
      15000,
    );
    console.log("[desktop-smoke] loro cloud update", JSON.stringify(loroUpdate));

    await click(
      cdp,
      `document.querySelector("button[aria-label='Return to projects']")`,
      "Return to projects",
    );
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
    await stopProcess(webChild);
    await mockCloud.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
