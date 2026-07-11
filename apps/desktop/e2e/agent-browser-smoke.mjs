import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clickButtonByLabel,
  clickComposerSubmitButton,
  recoverAgentBrowserTarget,
  runtimeSessionPathObservation,
  startVite,
  typeComposer,
} from "./startup-shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");

const captureDir =
  process.env.CLASH_DESKTOP_AGENT_BROWSER_CAPTURE_DIR ??
  path.join(repoRoot, ".tmp", "agent-browser-desktop-captures");
const dataDir =
  process.env.CLASH_DESKTOP_AGENT_BROWSER_DATA_DIR ??
  path.join(repoRoot, ".tmp", "agent-browser-desktop-data");
const sessionName = `clash-desktop-agent-browser-${Date.now().toString(36)}`;
const latestScreenshot = path.join(captureDir, "latest-agent-browser-desktop.png");
const historyScreenshot = path.join(captureDir, "history-agent-browser-desktop.png");
const narrowLayoutScreenshot = path.join(captureDir, "narrow-layout-agent-browser-desktop.png");
let electronTargetRecovery = null;

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
  let pollCount = 0;
  while (Date.now() < deadline) {
    lastValue = evalJson(expression);
    if (lastValue) return lastValue;
    pollCount += 1;
    if (
      electronTargetRecovery &&
      (evalJson("location.href") === "about:blank" || pollCount % 12 === 0)
    ) {
      recoverAgentBrowserTarget(agentBrowser, electronTargetRecovery);
      lastValue = evalJson(expression);
      if (lastValue) return lastValue;
    }
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
  if (!electronTargetRecovery) {
    throw new Error("Electron target recovery is not configured");
  }
  await sleep(750);
  recoverAgentBrowserTarget(agentBrowser, electronTargetRecovery);
  await waitForEval(
     `document.body.innerText.includes(${JSON.stringify(text)}) &&
       document.body.innerText.includes(${JSON.stringify(`Mock ACP reply: ${text}`)})`,
     `mock ACP reply for ${text}`,
     30000,
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
    const sessionsWithPaths = [];
    for (const session of runtimeSessions) {
      const messages = await fetchJson(
        `${apiOrigin}/api/v1/local-sessions/${encodeURIComponent(session.threadId || session.id)}/messages`,
      );
      sessionsWithPaths.push(runtimeSessionPathObservation({
        session,
        projectId,
        apiOrigin,
        dataDir,
        messageCount: (messages.messages || []).length,
      }));
    }
    lastState = {
      count: runtimeSessions.length,
      sessions: sessionsWithPaths,
    };
    if (
      runtimeSessions.length >= expectedCount &&
      sessionsWithPaths.every((session) => session.messageCount >= 2)
    ) {
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
    web = await startVite({ webPort, logs: webLogs });

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
    electronTargetRecovery = {
      cdpPort,
      expectedUrlPrefix: `http://127.0.0.1:${webPort}/`,
    };
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
    const restoredSession = firstHistory.sessions[0];
    if (!restoredSession?.id) throw new Error("Could not identify the restored first session");

    const projectStatusApiPath = `${apiOrigin}/api/v1/projects/${encodeURIComponent(projectId)}/status`;
    const projectStatus = await fetchJson(projectStatusApiPath);
    if (
      projectStatus.projectId !== projectId ||
      !projectStatus.runtimeRoot ||
      !Array.isArray(projectStatus.protectedPaths) ||
      !projectStatus.protectedPaths.includes(projectStatus.runtimeRoot)
    ) {
      throw new Error(`Project status path contract failed: ${JSON.stringify(projectStatus)}`);
    }
    const projectStatusEvidence = {
      projectId: projectStatus.projectId,
      projectStore: projectStatus.projectStore,
      projectWorkspaceRoot: projectStatus.projectWorkspaceRoot,
      roots: projectStatus.roots,
      runtimeRoot: projectStatus.runtimeRoot,
      protectedPaths: projectStatus.protectedPaths,
      editablePaths: projectStatus.editablePaths,
      loro: projectStatus.loro,
      localSqlitePath: projectStatus.localSqlitePath,
    };

    const state = evalJson(`(() => ({
      href: location.href,
      projectId: ${JSON.stringify(projectId)},
      bodyText: document.body.innerText.slice(0, 1200),
      runtime: window.__CLASH_RUNTIME_CONFIG__ ?? null,
    }))()`);
    agentBrowser(["screenshot", latestScreenshot]);

    clickButtonByLabel(agentBrowser, "Collapse chat panel");
    agentBrowser(["set", "viewport", "720", "900"]);
    await waitForEval(
      `window.innerWidth === 720 && window.innerHeight === 900`,
      "720x900 project viewport",
      10000,
    );
    const narrowLayout = evalJson(`(() => {
      const sidebarElement = document.querySelector('[aria-label="Project navigator"]');
      const sidebar = sidebarElement?.getBoundingClientRect();
      const sidebarHeader = sidebarElement?.querySelector('.clash-project-sidebar-header')?.getBoundingClientRect();
      const searchControl = sidebarElement?.querySelector('[aria-label="Search project"]')?.getBoundingClientRect();
      const selectedTab = sidebarElement?.querySelector('[role="tab"][aria-selected="true"]')?.getBoundingClientRect();
      const toolbarElement = document.querySelector('[aria-label="Canvas tools"]');
      const toolbarRail = toolbarElement?.getBoundingClientRect();
      const canvasSectionHeader = sidebarElement?.querySelector('#project-canvases-heading')?.parentElement?.getBoundingClientRect();
      const timelineSectionHeader = sidebarElement?.querySelector('#project-timelines-heading')?.parentElement?.getBoundingClientRect();
      const librarySectionHeader = sidebarElement?.querySelector('#project-library-heading')?.parentElement?.getBoundingClientRect();
      const assetsTab = sidebarElement?.querySelector('#project-assets')?.getBoundingClientRect();
      const selectMode = document.querySelector('[aria-label="Select mode"]')?.getBoundingClientRect();
      const handMode = document.querySelector('[aria-label="Hand mode"]')?.getBoundingClientRect();
      const assetsTool = toolbarElement?.querySelector('[aria-label="Assets"]')?.getBoundingClientRect();
      const actionsTool = toolbarElement?.querySelector('[aria-label="Actions"]')?.getBoundingClientRect();
      const editorTool = toolbarElement?.querySelector('[aria-label="Editor"]')?.getBoundingClientRect();
      const projectTitle = document.querySelector('.clash-project-name-input');
      const centerX = (element) => {
        const rect = element?.getBoundingClientRect();
        return rect ? rect.left + rect.width / 2 : null;
      };
      const left = (element) => element?.getBoundingClientRect().left ?? null;
      const spread = (values) => values.every((value) => value !== null)
        ? Math.round((Math.max(...values) - Math.min(...values)) * 10) / 10
        : null;
      const sidebarActionCenters = [
        centerX(sidebarElement?.querySelector('[aria-label="New Canvas"]')),
        centerX(sidebarElement?.querySelector('[aria-label="New Timeline"]')),
        centerX(sidebarElement?.querySelector('[data-sidebar-action-slot="asset-count"]')),
      ];
      const sidebarSectionHeadingLefts = [
        left(sidebarElement?.querySelector('#project-canvases-heading')),
        left(sidebarElement?.querySelector('#project-timelines-heading')),
        left(sidebarElement?.querySelector('#project-library-heading')),
      ];
      const sidebarRowIconLefts = [
        left(sidebarElement?.querySelector('[role="tab"][aria-selected="true"] svg')),
        left(sidebarElement?.querySelector('#project-assets svg')),
      ];
      const atomicControlHeights = [
        searchControl?.height ?? null,
        canvasSectionHeader?.height ?? null,
        selectedTab?.height ?? null,
        timelineSectionHeader?.height ?? null,
        librarySectionHeader?.height ?? null,
        assetsTab?.height ?? null,
        selectMode?.height ?? null,
        handMode?.height ?? null,
        assetsTool?.height ?? null,
        actionsTool?.height ?? null,
        editorTool?.height ?? null,
      ];
      const sidebarActionHeights = [
        sidebarElement?.querySelector('[aria-label="New Canvas"]')?.getBoundingClientRect().height ?? null,
        sidebarElement?.querySelector('[aria-label="New Timeline"]')?.getBoundingClientRect().height ?? null,
        sidebarElement?.querySelector('[data-sidebar-action-slot="asset-count"]')?.getBoundingClientRect().height ?? null,
      ];
      const chromeEdgeGutters = sidebar && selectedTab && toolbarRail
        ? [sidebar.right - selectedTab.right, toolbarRail.left - sidebar.right]
        : [null, null];
      const toolbarButtonInsets = toolbarRail && selectMode
        ? [selectMode.left - toolbarRail.left, toolbarRail.right - selectMode.right]
        : [null, null];
      const searchEdgeGutters = sidebar && searchControl
        ? [searchControl.left - sidebar.left, sidebar.right - searchControl.right]
        : [null, null];
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        sidebarWidth: sidebar ? Math.round(sidebar.width) : null,
        selectedTabWidth: selectedTab ? Math.round(selectedTab.width) : null,
        toolbarRailWidth: toolbarRail ? Math.round(toolbarRail.width) : null,
        toolbarHorizontalGutter: sidebar && toolbarRail
          ? Math.round(toolbarRail.left - sidebar.right)
          : null,
        toolbarVerticalOffset: sidebarHeader && toolbarRail
          ? Math.round(toolbarRail.top - sidebarHeader.bottom)
          : null,
        primaryChromeDimensions: sidebarHeader && toolbarRail
          ? { sidebarHeaderHeight: Math.round(sidebarHeader.height), toolbarRailWidth: Math.round(toolbarRail.width) }
          : null,
        atomicControlHeights: atomicControlHeights.map((value) => value === null ? null : Math.round(value)),
        atomicControlHeightSpread: spread(atomicControlHeights),
        actionSlotHeights: sidebarActionHeights.map((value) => value === null ? null : Math.round(value)),
        actionSlotHeightSpread: spread(sidebarActionHeights),
        searchToolbarBoundarySpread: spread([searchControl?.bottom ?? null, toolbarRail?.top ?? null]),
        firstRowTopBoundarySpread: spread([canvasSectionHeader?.top ?? null, selectMode?.top ?? null]),
        secondRowTopBoundarySpread: spread([selectedTab?.top ?? null, handMode?.top ?? null]),
        thirdRowTopBoundarySpread: spread([timelineSectionHeader?.top ?? null, assetsTool?.top ?? null]),
        fourthRowTopBoundarySpread: spread([librarySectionHeader?.top ?? null, actionsTool?.top ?? null]),
        fifthRowTopBoundarySpread: spread([assetsTab?.top ?? null, editorTool?.top ?? null]),
        chromeEdgeGutters: chromeEdgeGutters.map((value) => value === null ? null : Math.round(value)),
        chromeEdgeGutterSpread: spread(chromeEdgeGutters),
        searchEdgeGutters: searchEdgeGutters.map((value) => value === null ? null : Math.round(value)),
        searchEdgeGutterSpread: spread(searchEdgeGutters),
        toolbarButtonInsets: toolbarButtonInsets.map((value) => value === null ? null : Math.round(value)),
        toolbarButtonInsetSpread: spread(toolbarButtonInsets),
        sidebarActionCenters: sidebarActionCenters.map((value) => value === null ? null : Math.round(value)),
        sidebarActionColumnSpread: spread(sidebarActionCenters),
        sidebarSectionHeadingLeftSpread: spread(sidebarSectionHeadingLefts),
        sidebarRowIconLeftSpread: spread(sidebarRowIconLefts),
        horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
        projectTitleOverflow: projectTitle ? projectTitle.scrollWidth - projectTitle.clientWidth : null,
      };
    })()`);
    if (
      narrowLayout.sidebarWidth < 190 || narrowLayout.sidebarWidth > 194 ||
      narrowLayout.selectedTabWidth < 174 ||
      narrowLayout.toolbarRailWidth < 46 || narrowLayout.toolbarRailWidth > 50 ||
      narrowLayout.toolbarHorizontalGutter < 7 || narrowLayout.toolbarHorizontalGutter > 9 ||
      narrowLayout.toolbarVerticalOffset < 39 || narrowLayout.toolbarVerticalOffset > 41 ||
      narrowLayout.primaryChromeDimensions?.sidebarHeaderHeight !== 48 ||
      narrowLayout.primaryChromeDimensions?.toolbarRailWidth !== 48 ||
      narrowLayout.atomicControlHeights?.some((height) => height < 31 || height > 33) ||
      narrowLayout.atomicControlHeightSpread === null || narrowLayout.atomicControlHeightSpread > 1 ||
      narrowLayout.actionSlotHeights?.some((height) => height < 23 || height > 25) ||
      narrowLayout.actionSlotHeightSpread === null || narrowLayout.actionSlotHeightSpread > 1 ||
      narrowLayout.searchToolbarBoundarySpread === null || narrowLayout.searchToolbarBoundarySpread > 1 ||
      narrowLayout.firstRowTopBoundarySpread === null || narrowLayout.firstRowTopBoundarySpread > 1 ||
      narrowLayout.secondRowTopBoundarySpread === null || narrowLayout.secondRowTopBoundarySpread > 1 ||
      narrowLayout.thirdRowTopBoundarySpread === null || narrowLayout.thirdRowTopBoundarySpread > 1 ||
      narrowLayout.fourthRowTopBoundarySpread === null || narrowLayout.fourthRowTopBoundarySpread > 1 ||
      narrowLayout.fifthRowTopBoundarySpread === null || narrowLayout.fifthRowTopBoundarySpread > 1 ||
      narrowLayout.chromeEdgeGutterSpread === null || narrowLayout.chromeEdgeGutterSpread > 1 ||
      narrowLayout.searchEdgeGutterSpread === null || narrowLayout.searchEdgeGutterSpread > 1 ||
      narrowLayout.toolbarButtonInsetSpread === null || narrowLayout.toolbarButtonInsetSpread > 1 ||
      narrowLayout.sidebarActionColumnSpread === null || narrowLayout.sidebarActionColumnSpread > 1 ||
      narrowLayout.sidebarSectionHeadingLeftSpread === null || narrowLayout.sidebarSectionHeadingLeftSpread > 1 ||
      narrowLayout.sidebarRowIconLeftSpread === null || narrowLayout.sidebarRowIconLeftSpread > 1 ||
      narrowLayout.horizontalOverflow > 1 ||
      narrowLayout.projectTitleOverflow > 1
    ) {
      throw new Error(`Narrow project chrome layout failed: ${JSON.stringify(narrowLayout)}`);
    }
    agentBrowser(["screenshot", narrowLayoutScreenshot]);

    console.log("[desktop-agent-browser] state", JSON.stringify(state));
    console.log("[desktop-agent-browser] history", JSON.stringify({
      firstHistory,
      secondHistory,
      restoredSession,
    }));
    console.log("[desktop-agent-browser] project status", JSON.stringify({
      apiPath: projectStatusApiPath,
      status: projectStatusEvidence,
    }));
    console.log("[desktop-agent-browser] narrow layout", JSON.stringify(narrowLayout));
    console.log(`[desktop-agent-browser] screenshot ${latestScreenshot}`);
    console.log(`[desktop-agent-browser] history screenshot ${historyScreenshot}`);
    console.log(`[desktop-agent-browser] narrow screenshot ${narrowLayoutScreenshot}`);
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
