import path from "node:path";
import { homedir } from "node:os";
import { stat } from "node:fs/promises";
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

function currentClashHome() {
  return process.env.CLASH_HOME || path.join(homedir(), ".clash");
}

async function assertProjectWorkspaceLayout(projectId) {
  const projectWorkspaceRoot = path.join(currentClashHome(), "projects", projectId);
  const required = [
    "drafts",
    "projections/text",
    "projections/timelines",
    "timelines",
    "assets/links",
    "sessions",
    "runtime",
  ];
  const missing = [];
  for (const relativePath of required) {
    const fullPath = path.join(projectWorkspaceRoot, relativePath);
    try {
      const info = await stat(fullPath);
      if (!info.isDirectory()) missing.push(relativePath);
    } catch {
      missing.push(relativePath);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Project workspace layout is missing ${missing.join(", ")} under ${projectWorkspaceRoot}`);
  }
  return { projectWorkspaceRoot, required };
}

async function fetchAndAssertProjectStatus(apiPort, projectId) {
  const url = `http://127.0.0.1:${apiPort}/api/v1/projects/${encodeURIComponent(projectId)}/status`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Project status failed ${res.status}: ${text.slice(0, 1000)}`);
  }
  const status = JSON.parse(text);
  if (!status.runtimeRoot || status.runtimeRoot !== status.roots?.runtime) {
    throw new Error(`Project status must expose runtimeRoot matching roots.runtime: ${text.slice(0, 1000)}`);
  }
  if (!Array.isArray(status.protectedPaths) || !status.protectedPaths.includes(status.runtimeRoot)) {
    throw new Error(`Project status protectedPaths must include runtimeRoot: ${text.slice(0, 1000)}`);
  }
  return {
    projectId: status.projectId,
    projectStore: status.projectStore,
    projectWorkspaceRoot: status.projectWorkspaceRoot,
    roots: status.roots,
    runtimeRoot: status.runtimeRoot,
    protectedPaths: status.protectedPaths,
    editablePaths: status.editablePaths,
    loro: status.loro,
    localSqlitePath: status.localSqlitePath,
  };
}

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

async function selectCodexHarness(agentBrowser) {
  const triggerExpression = `document.querySelector("[data-testid='session-harness-config-trigger']")`;
  const selectedHarnessExpression = `(() => {
    const trigger = ${triggerExpression};
    const logo = trigger?.querySelector("[data-acp-agent-logo]");
    return {
      text: trigger?.innerText || "",
      logoLabel: logo?.getAttribute("aria-label") || "",
    };
  })()`;
  const currentSelection = evalJson(agentBrowser, selectedHarnessExpression);
  if (currentSelection.logoLabel.includes("Codex") || currentSelection.text.includes("Codex")) return;

  const opened = evalJson(agentBrowser, `(() => {
    const trigger = ${triggerExpression};
    if (!trigger) return false;
    trigger.scrollIntoView({ block: "center", inline: "center" });
    trigger.click();
    return true;
  })()`);
  if (!opened) throw new Error("Could not open session harness selector");

  await waitForEval(
    agentBrowser,
    `(() => {
      const menuText = [...document.querySelectorAll("[role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]")]
        .map((el) => el.innerText || el.textContent || "")
        .join("\\n");
      return menuText.includes("Codex");
    })()`,
    "Codex harness option",
    10000,
  );
  const picked = evalJson(agentBrowser, `(() => {
    const candidates = [...document.querySelectorAll("[role='option'], [role='menuitemradio'], button, [data-value]")]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== "none" && style.visibility !== "hidden";
      });
    const option = candidates.find((el) => {
      const text = (el.innerText || el.textContent || "").trim();
      const aria = el.getAttribute("aria-label") || "";
      return text === "Codex" || text.startsWith("Codex\\n") || aria === "Codex";
    });
    if (!option) return false;
    option.scrollIntoView({ block: "center", inline: "center" });
    option.click();
    return true;
  })()`);
  if (!picked) throw new Error("Could not select Codex harness");
  await waitForEval(
    agentBrowser,
    `(() => {
      const selection = ${selectedHarnessExpression};
      return selection.logoLabel.includes("Codex") || selection.text.includes("Codex");
    })()`,
    "Codex harness selected",
    10000,
  );
}

async function logRuntimeSnapshot(apiPort, label) {
  const url = `http://127.0.0.1:${apiPort}/api/v1/runtimes?probe=config&refresh=1`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    console.log(`[startup-real-codex] ${label} ${res.status} ${text.slice(0, 4000)}`);
  } catch (error) {
    console.error(`[startup-real-codex] ${label} failed`, error instanceof Error ? error.message : error);
  }
}

async function waitForPersistedPwdOutput(apiPort, projectId) {
  const expectedPathFragment = `/.clash/projects/${projectId}`;
  const deadline = Date.now() + 60000;
  let lastState = null;
  while (Date.now() < deadline) {
    try {
      const sessionsRes = await fetch(`http://127.0.0.1:${apiPort}/api/v1/sessions?projectId=${encodeURIComponent(projectId)}`);
      const sessionsJson = sessionsRes.ok ? await sessionsRes.json() : { sessions: [] };
      const sessions = Array.isArray(sessionsJson.sessions) ? sessionsJson.sessions : [];
      for (const session of sessions) {
        const sessionId = session?.id ?? session?.threadId;
        if (!sessionId || session?.type !== "runtime") continue;
        const messagesRes = await fetch(`http://127.0.0.1:${apiPort}/api/v1/local-sessions/${encodeURIComponent(sessionId)}/messages`);
        const messagesJson = messagesRes.ok ? await messagesRes.json() : null;
        const serialized = JSON.stringify(messagesJson);
        if (serialized.includes(expectedPathFragment) && serialized.includes("\"stdout\"")) {
          return {
            sessionId,
            expectedPathFragment,
            messages: messagesJson?.messages?.length ?? 0,
          };
        }
        lastState = { sessionId, messagesStatus: messagesRes.status, serialized: serialized.slice(0, 1000) };
      }
      lastState = { sessionsStatus: sessionsRes.status, sessions: sessions.map((session) => ({
        id: session?.id,
        threadId: session?.threadId,
        type: session?.type,
        title: session?.title,
      })) };
    } catch (error) {
      lastState = { error: error instanceof Error ? error.message : String(error) };
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for persisted pwd output: ${JSON.stringify(lastState)}`);
}

function clickPwdToolRow(agentBrowser) {
  return evalJson(agentBrowser, `(() => {
    const exactLabels = new Set(["Ran pwd", "Run pwd", "已运行 pwd", "已运行  pwd"]);
    const labelFor = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" &&
        !el.disabled;
    };
    const direct = [...document.querySelectorAll("button, [role='button'], summary")]
      .find((el) => exactLabels.has(labelFor(el)) && isVisible(el));
    if (direct) {
      direct.scrollIntoView({ block: "center", inline: "center" });
      direct.click();
      return true;
    }
    const textOwner = [...document.querySelectorAll("body *")]
      .find((el) => exactLabels.has(labelFor(el)) && isVisible(el));
    const target = textOwner?.closest("button, [role='button'], summary") ?? textOwner;
    if (!target || !isVisible(target)) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    target.click();
    return true;
  })()`);
}

async function waitAndClickPwdToolRow(agentBrowser) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (clickPwdToolRow(agentBrowser)) return;
    await sleep(300);
  }
  throw new Error("Could not expand the Codex pwd tool output");
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
        CLASH_ACP_TEST_BIN_DIR: path.join(desktopDir, "build", "acp-bin"),
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
    const projectId = evalJson(agentBrowser, `location.pathname.split("/").filter(Boolean).pop()`);
    if (!projectId) throw new Error("Could not read project id from editor route");
    await waitForEval(
      agentBrowser,
      `!!document.querySelector(".milkdown-chat-input [contenteditable='true']") &&
        document.body.innerText.includes("AI Copilot")`,
      "copilot composer",
      30000,
    );
    await logRuntimeSnapshot(apiPort, "runtime snapshot before harness select");
    await selectCodexHarness(agentBrowser);

    const prompt = "Run pwd with your shell tool. After it finishes, reply exactly DONE.";
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

    const persistedToolOutput = await waitForPersistedPwdOutput(apiPort, projectId);
    const projectWorkspaceLayout = await assertProjectWorkspaceLayout(projectId);
    const projectStatus = await fetchAndAssertProjectStatus(apiPort, projectId);
    await waitAndClickPwdToolRow(agentBrowser);
    await waitForEval(
      agentBrowser,
      `(() => document.body.innerText.includes(${JSON.stringify(`/.clash/projects/${projectId}`)}))()`,
      "Codex tool output project cwd path",
      10000,
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
        return text.includes("Run pwd");
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
      persistedToolOutput,
      projectWorkspaceLayout,
      projectStatus,
      state,
    }));
  } catch (error) {
    stopRetryStatusCapture = true;
    await logRuntimeSnapshot(apiPort, "runtime snapshot after failure");
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
