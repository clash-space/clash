import path from "node:path";
import {
  clickButtonByLabel,
  clickByText,
  clickComposerSubmitButton,
  createAgentBrowser,
  desktopDir,
  ensureAgentBrowser,
  evalJson,
  findFreePort,
  repoRoot,
  resetDirs,
  sleep,
  startElectron,
  startVite,
  stopProcess,
  tail,
  typeComposer,
  waitForEval,
  waitForHttp,
} from "./startup-shared.mjs";

if (process.env.CLASH_E2E_REAL_CODEX !== "1") {
  throw new Error("Refusing to run the real Codex E2E without CLASH_E2E_REAL_CODEX=1");
}

const runRoot = path.join(repoRoot, ".tmp", "startup-real-codex");
const captureDir = process.env.CLASH_E2E_REAL_CODEX_CAPTURE_DIR ?? path.join(runRoot, "screenshots");
const dataDir = process.env.CLASH_E2E_REAL_CODEX_DATA_DIR ?? path.join(runRoot, "data");
const sessionName = `clash-real-codex-${Date.now().toString(36)}`;
const failureScreenshot = path.join(captureDir, "failure.png");
const finalScreenshot = path.join(captureDir, "final.png");
const historyScreenshot = path.join(captureDir, "history.png");
const retryStatusScreenshot = path.join(captureDir, "retry-status.png");

function hasTransportDiagnostic(lines) {
  return lines.some((line) =>
    /Reconnecting\.\.\.\s*\d+\/\d+|retrying sampling request|falling back to HTTP|Falling back from WebSockets to HTTPS transport/i.test(line),
  );
}

async function captureRetryStatus(agentBrowser, screenshotPath, shouldStop) {
  const deadline = Date.now() + 240000;
  while (!shouldStop() && Date.now() < deadline) {
    let statusText = null;
    try {
      statusText = evalJson(agentBrowser, `(() => {
        const text = document.body.innerText;
        const match = text.match(/(?:Reconnecting\\s+\\d+\\/\\d+|Switching transport|正在重连\\s*\\d+\\/\\d+|正在切换传输)(?:\\s*[·•-]\\s*[^\\n]+)?/i);
        return match ? match[0] : null;
      })()`);
    } catch {
      // The Electron window can be briefly unavailable while the test is
      // submitting or navigating; keep polling until the turn is done.
    }
    if (statusText) {
      agentBrowser(["screenshot", screenshotPath]);
      return { text: statusText, screenshot: screenshotPath };
    }
    await sleep(200);
  }
  return null;
}

async function main() {
  ensureAgentBrowser();
  await resetDirs(captureDir, dataDir);

  const webPort = await findFreePort(50100);
  const apiPort = await findFreePort(50200);
  const cdpPort = await findFreePort(50300);
  const webOrigin = `http://127.0.0.1:${webPort}`;

  const webLogs = [];
  const electronLogs = [];
  let web;
  let electron;
  let stopRetryStatusCapture = false;
  let retryStatusCapture = Promise.resolve(null);
  const agentBrowser = createAgentBrowser({ sessionName, captureDir });

  try {
    web = await startVite({ webPort, logs: webLogs });
    await waitForHttp(webOrigin, "Vite desktop web shell");

    electron = await startElectron({
      cdpPort,
      webOrigin,
      apiPort,
      dataDir,
      captureDir,
      logs: electronLogs,
      env: {
        CLASH_ACP_BIN_DIR: path.join(desktopDir, "build", "acp-bin"),
      },
    });
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, "Electron CDP");

    agentBrowser(["close"], { allowFailure: true });
    agentBrowser(["connect", String(cdpPort)]);
    await waitForEval(agentBrowser, `document.body.innerText.includes("Home")`, "home page");

    if (!clickByText(agentBrowser, "Projects")) throw new Error("Could not open Projects");
    await waitForEval(agentBrowser, `location.pathname === "/projects"`, "projects route");
    if (!clickByText(agentBrowser, "New Project")) throw new Error("Could not create project");
    await waitForEval(
      agentBrowser,
      `location.pathname.startsWith("/projects/") && location.pathname !== "/projects"`,
      "project editor route",
      20000,
    );
    await waitForEval(
      agentBrowser,
      `!!document.querySelector(".milkdown-chat-input [contenteditable='true']") &&
        document.body.innerText.includes("AI Copilot")`,
      "copilot composer",
      30000,
    );

    const prompt = "Run `pwd` with your shell tool, then answer with only the path.";
    if (!typeComposer(agentBrowser, prompt)) throw new Error("Could not type into composer");
    stopRetryStatusCapture = false;
    retryStatusCapture = captureRetryStatus(
      agentBrowser,
      retryStatusScreenshot,
      () => stopRetryStatusCapture,
    );
    if (!clickComposerSubmitButton(agentBrowser)) throw new Error("Could not click composer submit button");
    await waitForEval(
      agentBrowser,
      `(() => {
        const editor = document.querySelector(".milkdown-chat-input [contenteditable='true']");
        return !!editor && !(editor.innerText || editor.textContent || "").includes(${JSON.stringify(prompt)});
      })()`,
      "composer cleared after submit",
      10000,
    );

    await waitForEval(
      agentBrowser,
      `(() => {
        const text = document.body.innerText;
        return text.includes("Ran pwd") || text.includes("已运行  pwd") || text.includes("已运行 pwd");
      })()`,
      "Codex shell tool call",
      180000,
    );
    await waitForEval(
      agentBrowser,
      `(() => /\\/Users\\/[^\\n]+\\.clash\\/projects\\//.test(document.body.innerText))()`,
      "Codex final project cwd path",
      180000,
    );
    await waitForEval(
      agentBrowser,
      `!document.body.innerText.includes("Falling back from WebSockets to HTTPS transport")`,
      "transport diagnostics hidden from transcript",
      10000,
    );
    await waitForEval(
      agentBrowser,
      `!document.querySelector(".clash-chat-input-stop")`,
      "Codex turn idle after final answer",
      240000,
    );
    stopRetryStatusCapture = true;
    const retryStatus = await retryStatusCapture;
    const transportDiagnosticObserved = hasTransportDiagnostic(electronLogs);
    if (transportDiagnosticObserved && !retryStatus) {
      throw new Error("Codex transport retry/fallback was observed in logs, but no retry status appeared in the UI");
    }
    agentBrowser(["screenshot", finalScreenshot]);

    if (!clickButtonByLabel(agentBrowser, "New session") && !clickButtonByLabel(agentBrowser, "新建会话")) {
      throw new Error("Could not create a fresh session from the header");
    }
    await waitForEval(
      agentBrowser,
      `!document.body.innerText.includes(${JSON.stringify(prompt)})`,
      "fresh session cleared visible transcript",
      30000,
    );
    if (!clickButtonByLabel(agentBrowser, "Session history") && !clickButtonByLabel(agentBrowser, "历史会话")) {
      throw new Error("Could not open session history");
    }
    await waitForEval(
      agentBrowser,
      `(() => {
        const menu = document.querySelector('[role="menu"][aria-label="Session history"], [role="menu"][aria-label="历史会话"]');
        return !!menu && !menu.innerText.toLowerCase().includes("no history yet");
      })()`,
      "persisted runtime session history",
      30000,
    );
    await waitForEval(
      agentBrowser,
      `(() => {
        const text = document.body.innerText;
        return text.includes("Run \`pwd\`") || text.includes("Run pwd");
      })()`,
      "runtime session history keeps the prompt title",
      30000,
    );
    agentBrowser(["screenshot", historyScreenshot]);

    const state = evalJson(agentBrowser, `(() => ({
      href: location.href,
      text: document.body.innerText.slice(0, 1200),
    }))()`);
    console.log("[startup-real-codex] ok", JSON.stringify({
      finalScreenshot,
      historyScreenshot,
      retryStatusScreenshot: retryStatus?.screenshot ?? null,
      retryStatusText: retryStatus?.text ?? null,
      transportDiagnosticObserved,
      state,
    }));
  } catch (error) {
    stopRetryStatusCapture = true;
    try {
      agentBrowser(["screenshot", failureScreenshot], { allowFailure: true });
      console.error(`[startup-real-codex] failure screenshot ${failureScreenshot}`);
    } catch {
      // Ignore screenshot failure while unwinding.
    }
    console.error("[startup-real-codex] web logs\n" + tail(webLogs));
    console.error("[startup-real-codex] electron logs\n" + tail(electronLogs));
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
