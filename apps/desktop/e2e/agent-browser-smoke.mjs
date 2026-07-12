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
const collapsedNavigatorScreenshot = path.join(captureDir, "collapsed-navigator-agent-browser-desktop.png");
const timelineDockScreenshot = path.join(captureDir, "timeline-dock-agent-browser-desktop.png");
const assetDestinationScreenshot = path.join(captureDir, "asset-destination-agent-browser-desktop.png");
const localSettingsScreenshot = path.join(captureDir, "local-settings-agent-browser-desktop.png");
const agentFollowScreenshot = path.join(captureDir, "agent-follow-agent-browser-desktop.png");
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

function clickOpenMenuItemByText(text) {
  return evalJson(`(() => {
    const wanted = ${JSON.stringify(text)};
    const menus = [...document.querySelectorAll('[role="menu"]')].filter((menu) => {
      const rect = menu.getBoundingClientRect();
      const style = getComputedStyle(menu);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden";
    });
    const menu = menus.at(-1);
    const item = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].find((candidate) =>
      (candidate.innerText || candidate.textContent || "").trim() === wanted &&
      candidate.getAttribute("aria-disabled") !== "true"
    );
    if (!item) return false;
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
    const seededAssetResponse = await fetch(`${apiOrigin}/api/v1/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        kind: "image",
        srcR2Key: "e2e/explicit-target.png",
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!seededAssetResponse.ok) {
      throw new Error(`Could not seed project asset: HTTP ${seededAssetResponse.status}`);
    }
    const seededAsset = await seededAssetResponse.json();
    agentBrowser(["eval", "location.reload()"], { allowFailure: true });
    await sleep(750);
    recoverAgentBrowserTarget(agentBrowser, electronTargetRecovery);
    await waitForEval(
      `document.querySelector('#project-assets')?.getAttribute('aria-label')?.includes('(1)') === true`,
      "project detail with complete asset list",
      20000,
    );
    await waitForEval(`document.body.innerText.includes("Mock ACP")`, "mock ACP runtime ready", 20000);

    const firstPrompt = "agent-browser desktop first turn";
    const secondPrompt = "agent-browser desktop fresh turn";
    if (
      !clickButtonByLabel(agentBrowser, "Follow agent actions") &&
      !clickButtonByLabel(agentBrowser, "跟随 Agent 操作")
    ) {
      throw new Error("Could not enable agent follow mode");
    }
    await waitForEval(
      `document.querySelector('#project-workspace-shell')?.getAttribute('data-following-agent') === 'true' &&
       document.querySelector('[aria-label="Stop following agent"], [aria-label="停止跟随 Agent"]')?.getAttribute('aria-pressed') === 'true'`,
      "active agent follow mode",
      10000,
    );
    await sendPrompt(firstPrompt);
    const agentFollow = await waitForEval(
      `(() => {
        const shell = document.querySelector('#project-workspace-shell');
        const flow = document.querySelector('#project-workspace-inset .react-flow')?.getBoundingClientRect();
        const target = [...document.querySelectorAll('[data-id^="mock-agent-action-"]')].at(-1)?.getBoundingClientRect();
        const toggle = document.querySelector('[aria-label="Stop following agent"], [aria-label="停止跟随 Agent"]');
        const panelElement = document.querySelector('#clash-copilot-panel');
        const panel = panelElement?.getBoundingClientRect();
        if (!shell || !flow || !target || !toggle) return false;
        if (shell.getAttribute('data-following-agent') !== 'true' || toggle.getAttribute('aria-pressed') !== 'true') return false;
        const panelCoversCanvas = panelElement?.getAttribute('aria-hidden') !== 'true' && panel &&
          panel.left > flow.left && panel.left < flow.right && panel.bottom > flow.top && panel.top < flow.bottom;
        const visibleRight = panelCoversCanvas ? panel.left - 12 : flow.right;
        const deltaX = Math.abs((target.left + target.width / 2) - (flow.left + (visibleRight - flow.left) / 2));
        const deltaY = Math.abs((target.top + target.height / 2) - (flow.top + flow.height / 2));
        if (deltaX > 80 || deltaY > 80) return false;
        return {
          targetId: [...document.querySelectorAll('[data-id^="mock-agent-action-"]')].at(-1)?.getAttribute('data-id'),
          deltaX: Math.round(deltaX),
          deltaY: Math.round(deltaY),
          active: true,
        };
      })()`,
      "agent-created node centered by follow mode",
      20000,
    );
    agentBrowser(["screenshot", agentFollowScreenshot]);

    agentBrowser(["click", "#project-assets"]);
    await waitForEval(
      `document.querySelector('#project-workspace-shell')?.getAttribute('data-following-agent') === 'false' &&
       !!document.querySelector('[aria-label="Follow agent actions"], [aria-label="跟随 Agent 操作"]')`,
      "manual project navigation stops agent follow mode",
      10000,
    );
    agentBrowser(["click", "#project-canvas-main"]);
    await waitForEval(
      `document.querySelector('#project-workspace-shell')?.getAttribute('data-copilot-layout') === 'overlay'`,
      "Main Canvas after manual follow takeover",
      10000,
    );
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

    if (
      !clickButtonByLabel(agentBrowser, "Collapse AI Copilot") &&
      !clickButtonByLabel(agentBrowser, "Collapse chat panel")
    ) {
      throw new Error("Could not collapse project chat before narrow layout checks");
    }
    await waitForEval(
      `!!document.querySelector('[aria-label="Expand AI Copilot"], [aria-label="Expand chat panel"]')`,
      "collapsed project chat",
      10000,
    );
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
      const sidebarSearchRow = sidebarElement?.querySelector('.clash-project-sidebar-search')?.getBoundingClientRect();
      const projectReturn = sidebarElement?.querySelector('[aria-label="Return to projects"]')?.getBoundingClientRect();
      const searchControl = sidebarElement?.querySelector('[aria-label="Search project"]')?.getBoundingClientRect();
      const selectedTab = sidebarElement?.querySelector('[role="tab"][aria-selected="true"]')?.getBoundingClientRect();
      const toolbarElement = document.querySelector('[aria-label="Canvas tools"]');
      const toolbarRail = toolbarElement?.getBoundingClientRect();
      const canvasSectionHeader = sidebarElement?.querySelector('#project-canvases-heading')?.parentElement?.getBoundingClientRect();
      const timelineSectionHeader = sidebarElement?.querySelector('#project-timelines-heading')?.parentElement?.getBoundingClientRect();
      const assetsTab = sidebarElement?.querySelector('#project-assets')?.getBoundingClientRect();
      const timelineTabs = [...(sidebarElement?.querySelectorAll('[id^="project-timeline-"]') ?? [])]
        .map((element) => element.getBoundingClientRect());
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
      ];
      const sidebarRowIconLefts = [
        left(sidebarElement?.querySelector('[role="tab"][aria-selected="true"] svg')),
        left(sidebarElement?.querySelector('#project-assets svg')),
      ];
      const sidebarNavigationIconCenters = [
        centerX(sidebarElement?.querySelector('[aria-label="Return to projects"] svg')),
        centerX(sidebarElement?.querySelector('[role="tab"][aria-selected="true"] svg')),
        centerX(sidebarElement?.querySelector('#project-assets svg')),
      ];
      const atomicControlHeights = [
        projectReturn?.height ?? null,
        projectTitle?.getBoundingClientRect().height ?? null,
        searchControl?.height ?? null,
        canvasSectionHeader?.height ?? null,
        selectedTab?.height ?? null,
        timelineSectionHeader?.height ?? null,
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
      const topUtilityRowHeights = [
        sidebarHeader?.height ?? null,
        sidebarSearchRow?.height ?? null,
      ];
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
        topUtilityRowHeights: topUtilityRowHeights.map((value) => value === null ? null : Math.round(value)),
        topUtilityRowHeightSpread: spread(topUtilityRowHeights),
        atomicControlHeights: atomicControlHeights.map((value) => value === null ? null : Math.round(value)),
        atomicControlHeightSpread: spread(atomicControlHeights),
        actionSlotHeights: sidebarActionHeights.map((value) => value === null ? null : Math.round(value)),
        actionSlotHeightSpread: spread(sidebarActionHeights),
        searchToolbarBoundarySpread: spread([searchControl?.bottom ?? null, toolbarRail?.top ?? null]),
        firstRowTopBoundarySpread: spread([canvasSectionHeader?.top ?? null, selectMode?.top ?? null]),
        secondRowTopBoundarySpread: spread([selectedTab?.top ?? null, handMode?.top ?? null]),
        thirdRowTopBoundarySpread: spread([timelineSectionHeader?.top ?? null, assetsTool?.top ?? null]),
        timelineAssetsGap: assetsTab
          ? Math.round(assetsTab.top - (timelineTabs.at(-1)?.bottom ?? timelineSectionHeader?.bottom ?? assetsTab.top))
          : null,
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
        sidebarNavigationIconCenters: sidebarNavigationIconCenters.map((value) => value === null ? null : Math.round(value * 10) / 10),
        sidebarNavigationIconCenterSpread: spread(sidebarNavigationIconCenters),
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
      narrowLayout.primaryChromeDimensions?.sidebarHeaderHeight !== 40 ||
      narrowLayout.primaryChromeDimensions?.toolbarRailWidth !== 48 ||
      narrowLayout.topUtilityRowHeights?.some((height) => height !== 40) ||
      narrowLayout.topUtilityRowHeightSpread === null || narrowLayout.topUtilityRowHeightSpread > 1 ||
      narrowLayout.atomicControlHeights?.some((height) => height < 31 || height > 33) ||
      narrowLayout.atomicControlHeightSpread === null || narrowLayout.atomicControlHeightSpread > 1 ||
      narrowLayout.actionSlotHeights?.some((height) => height < 23 || height > 25) ||
      narrowLayout.actionSlotHeightSpread === null || narrowLayout.actionSlotHeightSpread > 1 ||
      narrowLayout.searchToolbarBoundarySpread === null || narrowLayout.searchToolbarBoundarySpread > 1 ||
      narrowLayout.firstRowTopBoundarySpread === null || narrowLayout.firstRowTopBoundarySpread > 1 ||
      narrowLayout.secondRowTopBoundarySpread === null || narrowLayout.secondRowTopBoundarySpread > 1 ||
      narrowLayout.thirdRowTopBoundarySpread === null || narrowLayout.thirdRowTopBoundarySpread > 1 ||
      narrowLayout.timelineAssetsGap < 7 || narrowLayout.timelineAssetsGap > 9 ||
      narrowLayout.chromeEdgeGutterSpread === null || narrowLayout.chromeEdgeGutterSpread > 1 ||
      narrowLayout.searchEdgeGutterSpread === null || narrowLayout.searchEdgeGutterSpread > 1 ||
      narrowLayout.toolbarButtonInsetSpread === null || narrowLayout.toolbarButtonInsetSpread > 1 ||
      narrowLayout.sidebarActionColumnSpread === null || narrowLayout.sidebarActionColumnSpread > 1 ||
      narrowLayout.sidebarSectionHeadingLeftSpread === null || narrowLayout.sidebarSectionHeadingLeftSpread > 1 ||
      narrowLayout.sidebarRowIconLeftSpread === null || narrowLayout.sidebarRowIconLeftSpread > 1 ||
      narrowLayout.sidebarNavigationIconCenterSpread === null || narrowLayout.sidebarNavigationIconCenterSpread > 1 ||
      narrowLayout.horizontalOverflow > 1 ||
      narrowLayout.projectTitleOverflow > 1
    ) {
      throw new Error(`Narrow project chrome layout failed: ${JSON.stringify(narrowLayout)}`);
    }
    agentBrowser(["screenshot", narrowLayoutScreenshot]);

    agentBrowser(["press", "Meta+k"]);
    const commandPalette = await waitForEval(
      `(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="Search project"], [role="dialog"] [aria-label="Search project"]')?.closest('[role="dialog"]');
        const input = document.querySelector('[role="combobox"][aria-label="Search project"]');
        if (!dialog || !input) return false;
        return { dialogVisible: true, inputRole: input.getAttribute('role') };
      })()`,
      "Cmd-K project command palette",
      10000,
    );
    agentBrowser(["keyboard", "type", "Main"]);
    await waitForEval(
      `!!document.querySelector('[role="option"][aria-label="Main Canvas"]')`,
      "project command palette result",
      10000,
    );
    agentBrowser(["press", "Escape"]);
    await waitForEval(
      `!document.querySelector('[role="dialog"] [aria-label="Search project"]')`,
      "closed project command palette",
      10000,
    );

    if (!clickButtonByLabel(agentBrowser, "Collapse project sidebar")) {
      throw new Error("Could not collapse project sidebar");
    }
    await waitForEval(
      `document.querySelector('#project-workspace-shell')?.getAttribute('data-project-navigator-collapsed') === 'true' &&
       Math.round(document.querySelector('[aria-label="Project navigator"]')?.getBoundingClientRect().width ?? 0) === 48`,
      "collapsed 48px project navigator",
      10000,
    );
    const collapsedNavigator = evalJson(`(() => {
      const sidebar = document.querySelector('[aria-label="Project navigator"]');
      const sidebarRect = sidebar?.getBoundingClientRect();
      const search = sidebar?.querySelector('[aria-label="Search project"]')?.getBoundingClientRect();
      const selectedTab = sidebar?.querySelector('[role="tab"][aria-selected="true"]')?.getBoundingClientRect();
      const toolbar = document.querySelector('[aria-label="Canvas tools"]')?.getBoundingClientRect();
      const centerX = (element) => {
        const rect = element?.getBoundingClientRect();
        return rect ? Math.round((rect.left + rect.width / 2) * 10) / 10 : null;
      };
      const iconCenters = [
        centerX(sidebar?.querySelector('[aria-label="Return to projects"] svg')),
        centerX(sidebar?.querySelector('[aria-label="Search project"] svg')),
        centerX(sidebar?.querySelector('[role="tab"][aria-selected="true"] svg')),
        centerX(sidebar?.querySelector('#project-assets svg')),
      ];
      const iconCenterSpread = iconCenters.every((value) => value !== null)
        ? Math.round((Math.max(...iconCenters) - Math.min(...iconCenters)) * 10) / 10
        : null;
      return {
        sidebarWidth: sidebarRect ? Math.round(sidebarRect.width) : null,
        searchWidth: search ? Math.round(search.width) : null,
        selectedTabWidth: selectedTab ? Math.round(selectedTab.width) : null,
        toolbarGutter: sidebarRect && toolbar ? Math.round(toolbar.left - sidebarRect.right) : null,
        iconCenters,
        iconCenterSpread,
        projectTitleVisible: !!sidebar?.querySelector('.clash-project-name-input'),
        settingsVisible: !!sidebar?.querySelector('[aria-label="Settings"]'),
        expandVisible: !!sidebar?.querySelector('[aria-label="Expand project sidebar"]'),
        horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      };
    })()`);
    if (
      collapsedNavigator.sidebarWidth !== 48 ||
      collapsedNavigator.searchWidth !== 32 ||
      collapsedNavigator.selectedTabWidth !== 32 ||
      collapsedNavigator.toolbarGutter < 7 || collapsedNavigator.toolbarGutter > 9 ||
      collapsedNavigator.iconCenterSpread === null || collapsedNavigator.iconCenterSpread > 0.1 ||
      collapsedNavigator.projectTitleVisible ||
      collapsedNavigator.settingsVisible ||
      !collapsedNavigator.expandVisible ||
      collapsedNavigator.horizontalOverflow > 1
    ) {
      throw new Error(`Collapsed project navigator layout failed: ${JSON.stringify(collapsedNavigator)}`);
    }
    agentBrowser(["screenshot", collapsedNavigatorScreenshot]);

    if (!clickButtonByLabel(agentBrowser, "Expand project sidebar")) {
      throw new Error("Could not expand project sidebar");
    }
    await waitForEval(
      `document.querySelector('#project-workspace-shell')?.getAttribute('data-project-navigator-collapsed') === 'false' &&
       Math.round(document.querySelector('[aria-label="Project navigator"]')?.getBoundingClientRect().width ?? 0) === 192`,
      "expanded 192px project navigator",
      10000,
    );

    agentBrowser(["set", "viewport", "1440", "900"]);
    await waitForEval(
      `window.innerWidth === 1440 && window.innerHeight === 900`,
      "1440x900 timeline viewport",
      10000,
    );
    if (
      !clickButtonByLabel(agentBrowser, "Expand AI Copilot") &&
      !clickButtonByLabel(agentBrowser, "Expand chat panel")
    ) {
      throw new Error("Could not expand persistent project chat");
    }
    const draftMarker = "draft survives project surface switch";
    if (!typeComposer(agentBrowser, draftMarker)) {
      throw new Error("Could not type persistent chat draft");
    }
    evalJson(`(() => {
      window.prompt = () => "E2E Rough Cut";
      return true;
    })()`);
    if (!clickButtonByLabel(agentBrowser, "New Timeline")) {
      throw new Error("Could not create Timeline from the project navigator");
    }
    await waitForEval(
      `document.querySelector('[data-testid="project-timeline-editor"]') &&
       document.querySelector('[data-layout="embedded"]') &&
       !document.querySelector('[role="dialog"][aria-label="Video editor"]') &&
       !document.querySelector('[aria-label^="Open parent Canvas"]') &&
       document.querySelector('#project-workspace-shell')?.getAttribute('data-copilot-layout') === 'docked' &&
       document.body.innerText.includes(${JSON.stringify(draftMarker)})`,
      "embedded Timeline editor with docked persistent chat",
      20000,
    );
    if (!clickVisibleLinkOrButtonByText("+ Text")) {
      throw new Error("Could not add text in Timeline editor");
    }
    await waitForEval(
      `document.querySelectorAll('[aria-label^="text:"]').length === 1`,
      "Timeline text item",
      10000,
    );
    if (!clickVisibleLinkOrButtonByText("Main")) {
      throw new Error("Could not switch from Timeline to Main Canvas");
    }
    await waitForEval(
      `document.querySelector('#project-workspace-shell')?.getAttribute('data-copilot-layout') === 'overlay' &&
       document.body.innerText.includes(${JSON.stringify(draftMarker)})`,
      "Canvas overlay with persistent chat draft",
      10000,
    );
    if (!clickVisibleLinkOrButtonByText("E2E Rough Cut")) {
      throw new Error("Could not reopen Timeline from the project navigator");
    }
    const timelineDock = await waitForEval(
      `(() => {
        const workspace = document.querySelector('#project-workspace-shell')?.getBoundingClientRect();
        const copilot = document.querySelector('#clash-copilot-panel')?.getBoundingClientRect();
        const editor = document.querySelector('[data-testid="project-timeline-editor"]')?.getBoundingClientRect();
        const navigator = document.querySelector('[aria-label="Project navigator"]')?.getBoundingClientRect();
        const footer = document.querySelector('.clash-project-sidebar-footer')?.getBoundingClientRect();
        const settings = document.querySelector('.clash-project-sidebar-footer [aria-label="Settings"]')?.getBoundingClientRect();
        const itemCount = document.querySelectorAll('[aria-label^="text:"]').length;
        if (!workspace || !copilot || !editor || !navigator || !footer || !settings || itemCount !== 1) return false;
        const gap = copilot.left - workspace.right;
        if (gap < -1 || gap > 1) return false;
        if (Math.abs(navigator.bottom - footer.bottom) > 1) return false;
        if (settings.top < footer.top || settings.bottom > footer.bottom) return false;
        if (document.querySelector('#project-top-actions')) return false;
        if (!document.body.innerText.includes(${JSON.stringify(draftMarker)})) return false;
        return {
          workspace: { left: workspace.left, right: workspace.right, width: workspace.width },
          copilot: { left: copilot.left, right: copilot.right, width: copilot.width },
          editor: { left: editor.left, right: editor.right, width: editor.width },
          sidebarFooter: { top: footer.top, bottom: footer.bottom, settingsLeft: settings.left },
          gap,
          itemCount,
        };
      })()`,
      "persisted Timeline item and dock geometry",
      15000,
    );
    agentBrowser(["screenshot", timelineDockScreenshot]);

    evalJson(`(() => {
      window.prompt = () => "Review Canvas";
      return true;
    })()`);
    if (!clickButtonByLabel(agentBrowser, "New Canvas")) {
      throw new Error("Could not create a second Canvas for explicit asset placement");
    }
    await waitForEval(
      `document.querySelector('[aria-label="Project navigator"] [role="tab"][aria-selected="true"]')?.textContent?.includes("Review Canvas") === true &&
       document.querySelector('#project-workspace-shell')?.getAttribute('data-copilot-layout') === 'overlay' &&
       document.body.innerText.includes(${JSON.stringify(draftMarker)})`,
      "second Canvas with persistent chat draft",
      10000,
    );
    if (!evalJson(`(() => {
      const assetsTab = document.querySelector('#project-assets');
      if (!assetsTab) return false;
      assetsTab.scrollIntoView({ block: 'center', inline: 'center' });
      assetsTab.click();
      return true;
    })()`)) {
      throw new Error("Could not open project Assets surface");
    }
    await waitForEval(
      `document.querySelector('[aria-label="Project navigator"] [role="tab"][aria-selected="true"]')?.id === 'project-assets' &&
       document.querySelector('#project-workspace-shell')?.getAttribute('data-copilot-layout') === 'docked' &&
       document.querySelector('[aria-label="Project navigator"]')?.innerText.includes('Library') === false &&
       document.body.innerText.includes(${JSON.stringify(draftMarker)})`,
      "top-level Assets surface with docked persistent chat",
      10000,
    );
    const addAssetLabel = `Add ${seededAsset.id} to canvas`;
    if (!clickButtonByLabel(agentBrowser, addAssetLabel)) {
      throw new Error(`Could not open explicit asset destination menu for ${seededAsset.id}`);
    }
    const assetDestination = await waitForEval(
      `(() => {
        const menu = [...document.querySelectorAll('[role="menu"]')].find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        const choices = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])]
          .map((item) => (item.innerText || item.textContent || '').trim());
        if (!choices.includes('Main') || !choices.includes('Review Canvas')) return false;
        if (choices.some((choice) => /place/i.test(choice))) return false;
        return { choices, libraryVisible: false, assetId: ${JSON.stringify(seededAsset.id)} };
      })()`,
      "explicit Canvas destination menu",
      10000,
    );
    agentBrowser(["screenshot", assetDestinationScreenshot]);
    if (!clickOpenMenuItemByText("Main")) {
      throw new Error("Could not apply the asset to the explicit Main Canvas target");
    }
    await waitForEval(
      `!!document.querySelector('[data-id^="asset-node-"]')`,
      "asset node on the explicit non-active Canvas target",
      15000,
    );
    const assetPlacement = evalJson(`(() => ({
      selectedCanvas: document.querySelector('[aria-label="Project navigator"] [role="tab"][aria-selected="true"]')?.textContent?.trim() ?? null,
      copilotLayout: document.querySelector('#project-workspace-shell')?.getAttribute('data-copilot-layout') ?? null,
      draftPreserved: document.body.innerText.includes(${JSON.stringify(draftMarker)}),
      projectImageVisible: !!document.querySelector('[data-id^="asset-node-"]'),
    }))()`);
    if (
      !assetPlacement.selectedCanvas?.includes('Main') ||
      assetPlacement.copilotLayout !== 'overlay' ||
      !assetPlacement.draftPreserved ||
      !assetPlacement.projectImageVisible
    ) {
      throw new Error(`Explicit asset placement state failed: ${JSON.stringify(assetPlacement)}`);
    }

    if (!evalJson(`(() => {
      const link = document.querySelector('a[aria-label="Settings"]');
      if (!link) return false;
      const rect = link.getBoundingClientRect();
      const style = getComputedStyle(link);
      if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return false;
      link.scrollIntoView({ block: 'center', inline: 'center' });
      link.click();
      return true;
    })()`)) {
      throw new Error("Could not open local desktop Settings from the project sidebar");
    }
    const localSettings = await waitForEval(
      `(() => {
        if (location.pathname !== '/settings') return false;
        const signOut = [...document.querySelectorAll('button')].find((button) =>
          (button.innerText || button.textContent || '').trim() === 'Sign out'
        );
        if (signOut) return false;
        if (document.body.innerText.includes('Workspace controls')) return false;
        const sidebar = document.querySelector('.clash-settings-page-sidebar');
        const sidebarHeader = sidebar?.querySelector('.clash-settings-sidebar-header')?.getBoundingClientRect();
        const firstNavigationRow = sidebar?.querySelector('[aria-label="Settings sections"] [role="tab"]')?.getBoundingClientRect();
        if (!sidebarHeader || Math.round(sidebarHeader.height) !== 40) return false;
        if (!firstNavigationRow || Math.round(firstNavigationRow.height) !== 32) return false;
        return {
          path: location.pathname,
          signOutVisible: false,
          sidebarHeaderHeight: Math.round(sidebarHeader.height),
          navigationRowHeight: Math.round(firstNavigationRow.height),
        };
      })()`,
      "local Settings without cloud sign out",
      10000,
    );
    agentBrowser(["screenshot", localSettingsScreenshot]);

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
    console.log("[desktop-agent-browser] command palette", JSON.stringify(commandPalette));
    console.log("[desktop-agent-browser] collapsed navigator", JSON.stringify(collapsedNavigator));
    console.log("[desktop-agent-browser] timeline dock", JSON.stringify(timelineDock));
    console.log("[desktop-agent-browser] asset destination", JSON.stringify(assetDestination));
    console.log("[desktop-agent-browser] asset placement", JSON.stringify(assetPlacement));
    console.log("[desktop-agent-browser] local settings", JSON.stringify(localSettings));
    console.log("[desktop-agent-browser] agent follow", JSON.stringify(agentFollow));
    console.log(`[desktop-agent-browser] screenshot ${latestScreenshot}`);
    console.log(`[desktop-agent-browser] history screenshot ${historyScreenshot}`);
    console.log(`[desktop-agent-browser] narrow screenshot ${narrowLayoutScreenshot}`);
    console.log(`[desktop-agent-browser] collapsed navigator screenshot ${collapsedNavigatorScreenshot}`);
    console.log(`[desktop-agent-browser] timeline dock screenshot ${timelineDockScreenshot}`);
    console.log(`[desktop-agent-browser] asset destination screenshot ${assetDestinationScreenshot}`);
    console.log(`[desktop-agent-browser] local settings screenshot ${localSettingsScreenshot}`);
    console.log(`[desktop-agent-browser] agent follow screenshot ${agentFollowScreenshot}`);
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
