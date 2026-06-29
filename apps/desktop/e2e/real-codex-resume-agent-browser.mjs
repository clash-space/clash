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
  throw new Error("Refusing to run the real Codex resume E2E without CLASH_E2E_REAL_CODEX=1");
}

const runRoot = path.join(repoRoot, ".tmp", "startup-real-codex-resume");
const captureDir = process.env.CLASH_E2E_REAL_CODEX_RESUME_CAPTURE_DIR ?? path.join(runRoot, "screenshots");
const dataDir = process.env.CLASH_E2E_REAL_CODEX_RESUME_DATA_DIR ?? path.join(runRoot, "data");
const sessionName = `clash-real-codex-resume-${Date.now().toString(36)}`;
const failureScreenshot = path.join(captureDir, "failure.png");
const firstFinalScreenshot = path.join(captureDir, "01-first-turn-final.png");
const historyScreenshot = path.join(captureDir, "02-reopened-history.png");
const resumedScreenshot = path.join(captureDir, "03-resumed-session.png");
const secondFinalScreenshot = path.join(captureDir, "04-second-turn-final.png");

function visibleMenuItemSelector() {
  return `[role="menu"] [role="menuitem"]`;
}

function clickFirstHistoryItem(agentBrowser) {
  return evalJson(agentBrowser, `(() => {
    const items = [...document.querySelectorAll(${JSON.stringify(visibleMenuItemSelector())})]
      .filter((item) => {
        const rect = item.getBoundingClientRect();
        const style = getComputedStyle(item);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          !item.disabled;
      });
    const item = items[0];
    if (!item) return false;
    item.scrollIntoView({ block: "center", inline: "center" });
    item.click();
    return true;
  })()`);
}

async function launchElectron({ cdpPort, webOrigin, apiPort, dataDir, captureDir, electronLogs }) {
  const electron = await startElectron({
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
  return electron;
}

async function waitForProjectComposer(agentBrowser) {
  await waitForEval(
    agentBrowser,
    `!!document.querySelector(".milkdown-chat-input [contenteditable='true']") &&
      document.body.innerText.includes("AI Copilot")`,
    "copilot composer",
    30000,
  );
}

async function submitAndWaitForPwd(agentBrowser, prompt, minimumToolRows, minimumPathRows) {
  if (!typeComposer(agentBrowser, prompt)) throw new Error(`Could not type prompt: ${prompt}`);
  if (!clickComposerSubmitButton(agentBrowser)) throw new Error("Could not click composer submit button");
  await waitForEval(
    agentBrowser,
    `(() => {
      const editor = document.querySelector(".milkdown-chat-input [contenteditable='true']");
      return !!editor && !(editor.innerText || editor.textContent || "").includes(${JSON.stringify(prompt.replaceAll("`", ""))});
    })()`,
    "composer cleared after submit",
    10000,
  );
  await waitForEval(
    agentBrowser,
    `(() => {
      const text = document.body.innerText;
      return (text.match(/Ran pwd|已运行\\s+pwd|已运行 pwd/g) || []).length >= ${minimumToolRows};
    })()`,
    `Codex shell tool call count ${minimumToolRows}`,
    180000,
  );
  await waitForEval(
    agentBrowser,
    `(() => (document.body.innerText.match(/\\/Users\\/[^\\n]+\\.clash\\/projects\\/?/g) || []).length >= ${minimumPathRows})()`,
    `Codex final project cwd path count ${minimumPathRows}`,
    180000,
  );
  await waitForEval(
    agentBrowser,
    `!document.querySelector(".clash-chat-input-stop")`,
    "Codex turn idle after final answer",
    240000,
  );
}

async function main() {
  ensureAgentBrowser();
  await resetDirs(captureDir, dataDir);

  const webPort = await findFreePort(50100);
  const apiPort = await findFreePort(50200);
  const firstCdpPort = await findFreePort(50300);
  const secondCdpPort = await findFreePort(50400);
  const webOrigin = `http://127.0.0.1:${webPort}`;

  const webLogs = [];
  const electronLogs = [];
  let web;
  let electron;
  const agentBrowser = createAgentBrowser({ sessionName, captureDir });

  try {
    web = await startVite({ webPort, logs: webLogs });
    await waitForHttp(webOrigin, "Vite desktop web shell");

    electron = await launchElectron({
      cdpPort: firstCdpPort,
      webOrigin,
      apiPort,
      dataDir,
      captureDir,
      electronLogs,
    });

    agentBrowser(["close"], { allowFailure: true });
    agentBrowser(["connect", String(firstCdpPort)]);
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
    const projectUrl = evalJson(agentBrowser, `location.href`);
    await waitForProjectComposer(agentBrowser);

    const firstPrompt = "Run `pwd` with your shell tool, then answer with only the path.";
    await submitAndWaitForPwd(agentBrowser, firstPrompt, 1, 1);
    agentBrowser(["screenshot", firstFinalScreenshot]);

    agentBrowser(["close"], { allowFailure: true });
    await stopProcess(electron);
    electron = null;
    await sleep(1200);

    electron = await launchElectron({
      cdpPort: secondCdpPort,
      webOrigin,
      apiPort,
      dataDir,
      captureDir,
      electronLogs,
    });
    agentBrowser(["connect", String(secondCdpPort)]);
    await waitForEval(agentBrowser, `document.body.innerText.includes("Home")`, "reopened home page");
    agentBrowser(["open", projectUrl]);
    await waitForEval(
      agentBrowser,
      `location.href === ${JSON.stringify(projectUrl)} || location.pathname.startsWith("/projects/")`,
      "reopened project route",
      30000,
    );
    await waitForProjectComposer(agentBrowser);

    if (!clickButtonByLabel(agentBrowser, "Session history") && !clickButtonByLabel(agentBrowser, "历史会话")) {
      throw new Error("Could not open session history after restart");
    }
    await waitForEval(
      agentBrowser,
      `(() => {
        const menu = document.querySelector('[role="menu"][aria-label="Session history"], [role="menu"][aria-label="历史会话"]');
        return !!menu &&
          !menu.innerText.toLowerCase().includes("no history yet") &&
          (menu.innerText.includes("Run \`pwd\`") || menu.innerText.includes("Run pwd"));
      })()`,
      "reopened persisted session history",
      30000,
    );
    agentBrowser(["screenshot", historyScreenshot]);

    if (!clickFirstHistoryItem(agentBrowser)) throw new Error("Could not select the persisted runtime session");
    await waitForEval(
      agentBrowser,
      `(() => {
        const text = document.body.innerText;
        return (text.includes("Run \`pwd\`") || text.includes("Run pwd")) &&
          /\\/Users\\/[^\\n]+\\.clash\\/projects\\/?/.test(text) &&
          (text.match(/Ran pwd|已运行\\s+pwd|已运行 pwd/g) || []).length >= 1;
      })()`,
      "resumed transcript loaded",
      30000,
    );
    agentBrowser(["screenshot", resumedScreenshot]);

    const secondPrompt = "Run `pwd` again with your shell tool, then answer with only the path.";
    await submitAndWaitForPwd(agentBrowser, secondPrompt, 2, 2);
    agentBrowser(["screenshot", secondFinalScreenshot]);

    const state = evalJson(agentBrowser, `(() => ({
      href: location.href,
      text: document.body.innerText.slice(0, 1600),
    }))()`);
    console.log("[startup-real-codex-resume] ok", JSON.stringify({
      firstFinalScreenshot,
      historyScreenshot,
      resumedScreenshot,
      secondFinalScreenshot,
      state,
    }));
  } catch (error) {
    try {
      agentBrowser(["screenshot", failureScreenshot], { allowFailure: true });
      console.error(`[startup-real-codex-resume] failure screenshot ${failureScreenshot}`);
    } catch {
      // Ignore screenshot failure while unwinding.
    }
    console.error("[startup-real-codex-resume] web logs\n" + tail(webLogs));
    console.error("[startup-real-codex-resume] electron logs\n" + tail(electronLogs));
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
