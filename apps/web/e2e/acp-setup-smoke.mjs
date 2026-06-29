import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CdpClient,
  assert,
  capture,
  chromeBinary,
  click,
  clickByText,
  evaluate,
  findFreePort,
  stopProcess,
  tail,
  waitFor,
  waitForHttp,
  waitForTarget,
} from "../../../scripts/e2e/harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(webDir, "..", "..");

const dataDir = process.env.CLASH_WEB_ACP_SETUP_E2E_DATA_DIR ??
  path.join(repoRoot, ".tmp", "web-acp-setup-e2e-local-api-data");
const chromeDataDir = process.env.CLASH_WEB_ACP_SETUP_E2E_CHROME_DATA_DIR ??
  path.join(repoRoot, ".tmp", "web-acp-setup-e2e-chrome");
const captureDir = process.env.CLASH_WEB_ACP_SETUP_E2E_CAPTURE_DIR ??
  path.join(repoRoot, ".tmp", "web-acp-setup-e2e-captures");
const latestScreenshot = path.join(captureDir, "latest-web-acp-setup.png");
const statusScreenshot = path.join(captureDir, "latest-web-acp-setup-status.png");

const registryUrl = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const smokeArchiveUrl = "https://example.test/smoke-registry-agent";
const smokeAgentId = "smoke-registry-agent";
const smokeAgentLabel = "Smoke Registry Agent";

function currentPlatformKey() {
  const os = process.platform === "darwin"
    ? "darwin"
    : process.platform === "linux"
      ? "linux"
      : process.platform === "win32"
        ? "windows"
        : process.platform;
  const arch = process.arch === "arm64"
    ? "aarch64"
    : process.arch === "x64"
      ? "x86_64"
      : process.arch;
  return `${os}-${arch}`;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(value, status = 200) {
  return new Response(value, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

function fakeRegistryFetch(input) {
  const url = typeof input === "string" ? input : input.url;
  if (url === registryUrl) {
    return Promise.resolve(jsonResponse({
      agents: [
        {
          id: smokeAgentId,
          name: smokeAgentLabel,
          version: "1.0.0",
          description: "E2E-only registry agent used to verify app-managed ACP installs.",
          website: "https://example.test/smoke-registry-agent",
          distribution: {
            binary: {
              [currentPlatformKey()]: {
                archive: smokeArchiveUrl,
                cmd: "./smoke-registry-agent",
                args: ["acp"],
                env: { SMOKE_ACP: "1" },
              },
            },
          },
        },
      ],
    }));
  }
  if (url === smokeArchiveUrl) {
    return Promise.resolve(textResponse("#!/bin/sh\necho smoke registry agent\n"));
  }
  return Promise.resolve(textResponse(`not found: ${url}`, 404));
}

async function writeExecutable(pathname, contents) {
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, contents, "utf8");
  await chmod(pathname, 0o755);
}

async function exists(pathname) {
  return access(pathname).then(() => true, () => false);
}

async function requestFromIncoming(req, origin) {
  const url = new URL(req.url ?? "/", origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value != null) {
      headers.set(key, value);
    }
  }
  const method = req.method ?? "GET";
  let body;
  if (method !== "GET" && method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);
    if (buffer.length > 0) body = buffer;
  }
  return new Request(url, { method, headers, body });
}

async function startLocalApi({ port, harnessDownloadDir }) {
  const { createLocalApiApp } = await import("../../local-api/dist/app.js");
  const {
    createLocalAcpAdapter,
    createLocalHarnessConfigStore,
    DESKTOP_LOCAL_RUNTIME_ID,
  } = await import("../../local-api/dist/local-acp.js");

  const geminiShim = path.join(harnessDownloadDir, "clash-acp-gemini");
  const cursorShim = path.join(harnessDownloadDir, "clash-acp-cursor");
  const openclawShim = path.join(harnessDownloadDir, "openclaw");
  await writeExecutable(geminiShim, "#!/bin/sh\necho gemini acp\n");
  await writeExecutable(cursorShim, "#!/bin/sh\necho cursor acp\n");
  await writeExecutable(openclawShim, "#!/bin/sh\necho openclaw acp\n");

  let cursorAuthed = false;
  const localAcp = createLocalAcpAdapter({
    harnessConfig: createLocalHarnessConfigStore(dataDir),
    harnessDownloadDir,
    probeCwd: path.join(dataDir, "probe-cwd"),
    fetch: fakeRegistryFetch,
    spawnEnv: {
      CLASH_ACP_BIN_DIR: harnessDownloadDir,
    },
    hostname: () => "ACP Setup E2E",
    osTag: () => "darwin/arm64",
    nowSeconds: () => 1_782_253_200,
    detectAgents: async () => {
      const agents = [
        {
          id: "gemini",
          label: "Gemini",
          spec: { command: geminiShim, args: ["--acp"] },
        },
      ];
      if (await exists(cursorShim)) {
        agents.push({
          id: "cursor",
          label: "Cursor",
          spec: { command: cursorShim, args: ["acp"] },
        });
      }
      return agents;
    },
    probeAgentAuth: async (agent) => {
      if (agent.id === "gemini") {
        return {
          status: "configured",
          message: "Gemini auth method selected: oauth-personal.",
          command: agent.spec.command,
        };
      }
      if (agent.id === "cursor") {
        return cursorAuthed
          ? {
              status: "configured",
              message: "Cursor ACP auth is configured (Cursor Login).",
              command: agent.spec.command,
            }
          : {
              status: "needs-auth",
              message: "Cursor requires ACP authentication (Cursor Login).",
              command: agent.spec.command,
            };
      }
      return undefined;
    },
    authenticateAgent: async (agent) => {
      if (agent.id === "cursor") cursorAuthed = true;
    },
    listResumeSessions: async () => [],
    createSessionManager: (send) => ({
      start(params) {
        send({ type: "session.ready", session_id: params.session_id, runtime_id: DESKTOP_LOCAL_RUNTIME_ID });
      },
      prompt(params) {
        send({
          type: "session.event",
          session_id: params.session_id,
          turn_id: params.turn_id,
          event: { type: "text", text: "ACP setup smoke reply" },
        });
        send({ type: "session.complete", session_id: params.session_id, turn_id: params.turn_id });
      },
      cancel: () => undefined,
      dispose: () => undefined,
    }),
  });

  const app = createLocalApiApp({ dataDir, localAcp });
  const origin = `http://127.0.0.1:${port}`;
  const server = createServer(async (req, res) => {
    try {
      const request = await requestFromIncoming(req, origin);
      const response = await app.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain");
      res.end(error instanceof Error ? error.stack ?? error.message : String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

async function startWeb({ webPort, apiOrigin }) {
  const logs = [];
  const child = spawn("pnpm", ["--dir", webDir, "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort)], {
    cwd: webDir,
    env: {
      ...process.env,
      VITE_CLASH_API_BASE_URL: apiOrigin,
      VITE_CLASH_WS_BASE_URL: apiOrigin.replace("http:", "ws:"),
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
  return { child, logs };
}

function agentRowExpression(label) {
  return `(() => {
    const label = ${JSON.stringify(label)};
    const rows = [...document.querySelectorAll("div.grid")].filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width < 400 || rect.height < 40 || style.display === "none" || style.visibility === "hidden") return false;
      const text = el.innerText || el.textContent || "";
      if (!text.includes(label)) return false;
      const title = [...el.querySelectorAll("span")].some((span) => (span.innerText || span.textContent || "").trim() === label);
      return title && !!el.querySelector("button, [role='switch']");
    });
    return rows[0] ?? null;
  })()`;
}

function agentRowActionExpression(label, action) {
  return `(() => {
    const row = (${agentRowExpression(label)});
    if (!row) return null;
    const action = ${JSON.stringify(action)};
    return [...row.querySelectorAll("button, [role='button']")].find((button) => {
      const text = (button.innerText || button.textContent || "").trim();
      const aria = button.getAttribute("aria-label") || "";
      return text === action || aria.includes(action);
    }) ?? null;
  })()`;
}

async function agentRowText(cdp, label) {
  return evaluate(cdp, `(() => {
    const row = (${agentRowExpression(label)});
    return row ? (row.innerText || row.textContent || "").trim() : null;
  })()`);
}

async function waitForAgentText(cdp, label, includes, description) {
  await waitFor(
    cdp,
    `(() => {
      const row = (${agentRowExpression(label)});
      return !!row && (row.innerText || row.textContent || "").includes(${JSON.stringify(includes)});
    })()`,
    description,
    15000,
  );
}

async function clickAgentAction(cdp, label, action) {
  await click(cdp, agentRowActionExpression(label, action), `${action} ${label}`);
}

async function exerciseAcpSetupUi(cdp, webOrigin) {
  await cdp.send("Page.navigate", { url: `${webOrigin}/settings?section=runtimes` });
  await waitFor(cdp, `document.body.innerText.includes("Runtimes")`, "settings runtimes");
  await waitFor(cdp, `document.body.innerText.includes("Agents")`, "agents section", 15000);

  await waitForAgentText(cdp, "Gemini", "Auth configured", "Gemini auth configured row");
  const gemini = await agentRowText(cdp, "Gemini");
  assert(gemini.includes("Gemini auth method selected: oauth-personal."), "Gemini row shows probe result", { gemini });
  assert(gemini.includes("clash-acp-gemini"), "Gemini row uses the managed registry shim", { gemini });
  assert(!gemini.includes("/opt/homebrew/bin/gemini"), "Gemini row must not use the system Gemini CLI", { gemini });
  assert(!gemini.includes("/auth"), "configured Gemini row must not show /auth fallback", { gemini });

  await waitForAgentText(cdp, "Cursor", "Auth needed", "Cursor auth-needed row");
  const cursorBefore = await agentRowText(cdp, "Cursor");
  assert(cursorBefore.includes("Click Auth to sign in"), "Cursor row gives direct GUI auth path", { cursorBefore });
  assert(cursorBefore.includes("/auth"), "Cursor row keeps fallback CLI auth hint", { cursorBefore });

  await waitForAgentText(cdp, smokeAgentLabel, "Install", "dynamic registry agent row");
  await clickAgentAction(cdp, smokeAgentLabel, "Install");
  await waitForAgentText(cdp, smokeAgentLabel, "Uninstall", "registry agent installed row");
  const smokeAfterInstall = await agentRowText(cdp, smokeAgentLabel);
  assert(smokeAfterInstall.includes("Ready"), "installed registry agent becomes ready", { smokeAfterInstall });

  await clickAgentAction(cdp, "Cursor", "Auth");
  await waitForAgentText(cdp, "Cursor", "Auth configured", "Cursor auth configured after auth button");
  const cursorAfterAuth = await agentRowText(cdp, "Cursor");
  assert(!cursorAfterAuth.includes("/auth"), "configured Cursor row removes /auth fallback", { cursorAfterAuth });

  await clickByText(cdp, "Check again", "Check again agents");
  await waitForAgentText(cdp, "Cursor", "Auth configured", "Cursor stays configured after re-probe");
  await evaluate(cdp, `(() => {
    const row = (${agentRowExpression("Gemini")});
    row?.scrollIntoView({ block: "start", inline: "nearest" });
    return true;
  })()`);
  await capture(cdp, statusScreenshot);

  await clickByText(cdp, "Add custom agent server", "Add custom agent server");
  await waitFor(cdp, `document.querySelector('[role="dialog"]')?.innerText.includes("Add custom agent server")`, "custom agent dialog");
  await waitFor(
    cdp,
    `(() => {
      const text = document.querySelector('[role="dialog"]')?.innerText || "";
      return text.includes("OpenClaw") && text.includes("Hermes") && text.includes("OpenClaw Gateway");
    })()`,
    "custom agent server templates",
  );
  await clickByText(cdp, "Save agent server", "Save custom agent server");
  await waitFor(cdp, `!document.querySelector('[role="dialog"]')`, "custom agent dialog closes", 15000);
  await waitFor(cdp, `document.body.innerText.includes("OpenClaw ACP") && document.body.innerText.includes("openclaw acp")`, "custom OpenClaw server saved");
  await waitForAgentText(cdp, "OpenClaw ACP", "Ready", "custom OpenClaw detected");
  await evaluate(cdp, `(() => {
    const customHeading = [...document.querySelectorAll("h4")].find((el) =>
      (el.innerText || el.textContent || "").trim() === "Custom agent servers"
    );
    customHeading?.scrollIntoView({ block: "start", inline: "nearest" });
    return true;
  })()`);

  return evaluate(cdp, `(() => ({
    href: location.href,
    runtime: window.__CLASH_RUNTIME_CONFIG__ ?? null,
    agentsText: [...document.querySelectorAll("div.grid")]
      .map((el) => (el.innerText || el.textContent || "").trim())
      .filter((text) =>
        text.includes("Gemini") ||
        text.includes("Cursor") ||
        text.includes(${JSON.stringify(smokeAgentLabel)}) ||
        text.includes("OpenClaw ACP")
      )
      .slice(0, 12),
  }))()`);
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  await rm(dataDir, { recursive: true, force: true });
  await rm(chromeDataDir, { recursive: true, force: true });
  await mkdir(captureDir, { recursive: true });

  const harnessDownloadDir = path.join(dataDir, "acp-bin");
  const apiPort = await findFreePort(49920);
  const webPort = await findFreePort(49940);
  const cdpPort = await findFreePort(49960);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const webOrigin = `http://127.0.0.1:${webPort}`;

  const apiServer = await startLocalApi({ port: apiPort, harnessDownloadDir });
  const { child: web, logs: webLogs } = await startWeb({ webPort, apiOrigin });
  const chromeLogs = [];
  let chrome;
  let cdp;

  try {
    await waitForHttp(`${apiOrigin}/health`, "local API");
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

    const state = await exerciseAcpSetupUi(cdp, webOrigin);
    await capture(cdp, latestScreenshot);
    console.log("[web-acp-setup] state", JSON.stringify(state));
    console.log(`[web-acp-setup] status screenshot ${statusScreenshot}`);
    console.log(`[web-acp-setup] screenshot ${latestScreenshot}`);
  } catch (error) {
    process.exitCode = 1;
    console.error("[web-acp-setup] caught", error instanceof Error ? error.stack ?? error.message : error);
    if (cdp) {
      try {
        await capture(cdp, latestScreenshot);
        console.error(`[web-acp-setup] failure screenshot ${latestScreenshot}`);
      } catch {
        // Ignore capture failure while unwinding.
      }
    }
    console.error("[web-acp-setup] web logs\n" + tail(webLogs));
    console.error("[web-acp-setup] chrome logs\n" + tail(chromeLogs));
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
