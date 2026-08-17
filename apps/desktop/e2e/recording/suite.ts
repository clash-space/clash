import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  clickButtonByLabel,
  clickByText,
  clickComposerSubmitButton,
  createAgentBrowser,
  ensureAgentBrowser,
  evalJson,
  findFreePort,
  repoRoot,
  resetDirs,
  sleep,
  startElectron,
  startVite,
  submitProjectCreateDialog,
  typeComposer,
  waitForEval,
  waitForHttp,
} from "../startup-shared.mjs";
import { writeArtifactManifest } from "../../src/demo-recording/artifacts.js";
import {
  parseDemoSuite,
  type DemoCase,
  type DemoSuite,
} from "../../src/demo-recording/contracts.js";
import {
  DemoEventJournal,
  type DemoEvent,
} from "../../src/demo-recording/events.js";
import {
  CdpScreencastRecorder,
  connectToClashPage,
  type CdpClient,
  waitForCdpReadiness,
} from "../../src/demo-recording/recorder.js";
import {
  SessionEventProjector,
  waitForPersistedTurn,
  type PersistedSessionMessages,
  type SessionTerminalResult,
} from "../../src/demo-recording/session-observer.js";
import {
  encodeScreencast,
  evaluateEncodedVideoContract,
  probeEncodedVideoStream,
} from "../../src/demo-recording/video.js";
import { resolveLocalMediaBinary } from "../../../local-api/src/local-media-binaries.js";
import {
  evaluateAgentEvidence,
  observeCompletedProductOperations,
  type AgentEvidenceResult,
} from "./evidence.js";
import {
  CaseDeadlineError,
  createCaseWatchdog,
  settleBeforeCaseDeadline,
} from "./case-watchdog.js";
import {
  createCaseTeardown,
  finalizeRecordingAfterRuntime,
  installSignalTeardown,
  stopAgentBrowserDaemon,
  stopChildProcessVerified,
  stopDetachedHost,
  stopRecordedAgentProcesses,
  type CaseTeardown,
} from "./lifecycle.js";
import { readProjectSnapshot, type ProjectSnapshot } from "./readback.js";
import {
  evaluateChapterCoverage,
  evaluateTrajectoryHealth,
  selectDemoSuiteCases,
} from "./suite-gates.js";
import {
  AGENT_COMPOSER_READINESS_SOURCE,
  applyCanvasCameraPreset,
  applyLiveCanvasCameraPreset,
  applyRecordingViewport,
  buildLiveCanvasPanPlanSource,
  buildRecordingAgentBrowserScope,
  buildRecordingChildEnvironment,
  DESKTOP_HOME_READINESS_SOURCE,
  DEMO_WEBSOCKET_INSTRUMENTATION_SOURCE,
  finalAnswerForTurn,
  findRuntimeAgentSessionId,
  holdFinalProductResult,
  matchesExpectedFinalAnswer,
  parseAgentBrowserDaemonIdentity,
  persistedTurnHasAnswer,
  preparePiRecordingEnvironment,
  requireScreencastCapture,
  resolveCorepackHome,
  resolvePublishedRuntimeApiBaseUrl,
  sanitizeArtifactText,
  shouldReframeLiveCanvas,
  summarizeProductReadback,
  TRUSTED_CLASH_PERMISSION_APPROVAL_SOURCE,
  withAgentBrowserCdp,
  withAgentBrowserEnvironment,
  withFrozenViteSource,
  publishValidatedPiAcpDiagnostics,
  type AgentBrowserDaemonIdentity,
  type DemoCaptureMetrics,
  type PreparedPiRecordingEnvironment,
  type ProductReadbackArtifact,
} from "./runner-support.js";
import type {
  AgentDemoDriver,
  DemoDriver,
  DemoDriverModule,
  FeatureDemoDriver,
  FeatureDemoStep,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

interface CaseRunResult {
  caseId: string;
  kind: "agent" | "feature";
  status: "pass" | "fail";
  artifactDir: string;
  failures: string[];
}

interface CaseResultArtifact {
  schemaVersion: 1;
  suiteId: string;
  caseId: string;
  kind: "agent" | "feature";
  status: "pass" | "fail";
  startedAt: string;
  completedAt: string;
  failures: string[];
  evidence?: {
    missingOperations: AgentEvidenceResult["missingOperations"];
    missingProductState: AgentEvidenceResult["missingProductState"];
    metrics: AgentEvidenceResult["metrics"];
    finalAnswerMatched?: boolean;
  };
  capture?: DemoCaptureMetrics;
  artifacts: {
    video: boolean;
    events: number;
    screenshots: number;
    readback: boolean;
    diagnostics: boolean;
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const desktopDir = path.resolve(__dirname, "..", "..");
const defaultSuitePath = path.join(
  repoRoot,
  "demos",
  "desktop",
  "v1",
  "suite.json",
);
const runStamp = new Date().toISOString().replace(/[:.]/gu, "-");
const artifactRoot = path.resolve(
  process.env.CLASH_DEMO_ARTIFACT_DIR ??
    path.join(repoRoot, "artifacts", "desktop-demo-recordings", runStamp),
);
const originalHome = process.env.HOME ?? homedir();
const sourcePiAgentDir = path.join(originalHome, ".pi", "agent");
const corepackHome = resolveCorepackHome(process.env, originalHome);
const piAcpLibraryPath = require.resolve("@automatalabs/pi-acp");
const piAcpEntryPath = path.join(path.dirname(piAcpLibraryPath), "index.js");
const piAcpProxyPath = path.join(__dirname, "pi-acp-proxy.ts");
const tsxImportPath = require.resolve("tsx");
const sensitiveHomes = new Set<string>();
let activeCaseTeardown: CaseTeardown | undefined;

async function cleanupSensitiveHomes(): Promise<void> {
  await Promise.all(
    [...sensitiveHomes].map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
      sensitiveHomes.delete(directory);
    }),
  );
}

installSignalTeardown({
  target: process,
  teardown: async () => {
    await activeCaseTeardown?.();
    await cleanupSensitiveHomes();
  },
  onError: (error) => {
    console.error(
      `[desktop-demo] signal cleanup failed: ${sanitizeArtifactText(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
  },
});

function recordValue(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

async function assertRecordingDiskBudget(): Promise<void> {
  const disk = await statfs(repoRoot);
  const availableBytes = disk.bavail * disk.bsize;
  const minimumBytes = 120 * 1024 * 1024;
  if (availableBytes < minimumBytes) {
    throw new Error(
      `demo recording requires at least 120 MiB free; observed ${Math.floor(availableBytes / 1024 / 1024)} MiB`,
    );
  }
}

function remainingCaseTime(deadlineAt: number, maximumMs: number): number {
  return Math.max(1, Math.min(maximumMs, deadlineAt - Date.now()));
}

function electronLogTail(logs: readonly string[]): string {
  const text = logs.slice(-20).join("");
  return sanitizeArtifactText(text || "no Electron log output");
}

async function waitForClashPageTarget(options: {
  cdpPort: number;
  webOrigin: string;
  electron: { exitCode: number | null; signalCode: NodeJS.Signals | null };
  electronLogs: readonly string[];
  signal: AbortSignal;
  caseDeadlineAt: number;
  timeoutMs?: number;
}): Promise<void> {
  const deadline = Math.min(
    options.caseDeadlineAt,
    Date.now() + (options.timeoutMs ?? 90_000),
  );
  let lastTargets: unknown = [];
  while (Date.now() < deadline) {
    if (
      options.electron.exitCode !== null ||
      options.electron.signalCode !== null
    ) {
      throw new Error(
        `ELECTRON_EXITED_BEFORE_PAGE_TARGET exit=${options.electron.exitCode ?? "none"} ` +
          `signal=${options.electron.signalCode ?? "none"}; log=${electronLogTail(options.electronLogs)}`,
      );
    }
    try {
      const requestDeadline = Math.min(deadline, Date.now() + 2_500);
      const response = await settleBeforeCaseDeadline({
        promise: fetch(`http://127.0.0.1:${options.cdpPort}/json`, {
          signal: options.signal,
        }),
        signal: options.signal,
        deadlineAt: requestDeadline,
      });
      const targets = await settleBeforeCaseDeadline({
        promise: response.json() as Promise<unknown>,
        signal: options.signal,
        deadlineAt: requestDeadline,
      });
      lastTargets = targets;
      if (
        response.ok &&
        Array.isArray(targets) &&
        targets.some((target) => {
          const record = recordValue(target);
          return (
            record?.type === "page" &&
            typeof record.url === "string" &&
            record.url.startsWith(options.webOrigin)
          );
        })
      ) {
        return;
      }
    } catch (error) {
      if (
        options.signal.aborted ||
        Date.now() >= options.caseDeadlineAt
      ) {
        throw new CaseDeadlineError();
      }
      lastTargets = error instanceof Error ? error.message : String(error);
    }
    await sleep(100);
  }
  const targetCount = Array.isArray(lastTargets) ? lastTargets.length : 0;
  throw new Error(
    `ELECTRON_PAGE_TARGET_TIMEOUT targets=${targetCount}; log=${electronLogTail(options.electronLogs)}`,
  );
}

async function evaluateCdp<T>(
  client: CdpClient,
  expression: string,
): Promise<T> {
  const response = (await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as {
    result?: { value?: T; description?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  };
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "renderer evaluation failed",
    );
  }
  return response.result?.value as T;
}

async function captureScreenshot(
  client: CdpClient,
  outputPath: string,
): Promise<void> {
  const result = (await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  })) as { data?: unknown };
  if (typeof result.data !== "string")
    throw new Error("CDP screenshot returned no image data");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(result.data, "base64"));
}

async function requireAgentHarnessSelected(
  agentBrowser: ReturnType<typeof createAgentBrowser>,
  agentLabel: string,
): Promise<void> {
  await waitForEval(
    agentBrowser,
    `(() => {
      const trigger = document.querySelector('[data-testid="session-harness-config-trigger"]');
      const text = (trigger?.innerText || trigger?.textContent || '') + ' ' +
        (trigger?.querySelector('[data-acp-agent-logo]')?.getAttribute('aria-label') || '');
      return text.includes(${JSON.stringify(agentLabel)});
    })()`,
    `${agentLabel} harness selected`,
    30_000,
  );
}

async function discoverAgentSession(options: {
  apiBaseUrl: string;
  projectId: string;
  agentId: string;
  timeoutMs: number;
  signal: AbortSignal;
  caseDeadlineAt: number;
}): Promise<string> {
  const deadline = Math.min(
    options.caseDeadlineAt,
    Date.now() + options.timeoutMs,
  );
  let lastProblem = "session not created";
  while (Date.now() < deadline) {
    try {
      const requestDeadline = Math.min(deadline, Date.now() + 2_500);
      const response = await settleBeforeCaseDeadline({
        promise: fetch(
          new URL(
          `/api/v1/sessions?projectId=${encodeURIComponent(options.projectId)}`,
          options.apiBaseUrl,
          ),
          { signal: options.signal },
        ),
        signal: options.signal,
        deadlineAt: requestDeadline,
      });
      const body = await settleBeforeCaseDeadline({
        promise: response.json() as Promise<unknown>,
        signal: options.signal,
        deadlineAt: requestDeadline,
      });
      const id = findRuntimeAgentSessionId(body, options.agentId);
      if (id) return id;
      const sessions = recordValue(body)?.sessions;
      const sessionCount = Array.isArray(sessions) ? sessions.length : 0;
      lastProblem = `observed ${sessionCount} project session(s)`;
    } catch (error) {
      if (
        options.signal.aborted ||
        Date.now() >= options.caseDeadlineAt
      ) {
        throw new CaseDeadlineError();
      }
      lastProblem = error instanceof Error ? error.message : String(error);
    }
    await sleep(50);
  }
  throw new Error(
    `timed out discovering the ${options.agentId} session: ${lastProblem}`,
  );
}

async function waitForDemoObserver(
  client: CdpClient,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot: unknown;
  while (Date.now() < deadline) {
    lastSnapshot = await evaluateCdp(
      client,
      "window.__clashDemoRecording?.snapshot?.() ?? null",
    );
    if (
      (recordValue(lastSnapshot)?.openObserverCount as number | undefined) &&
      Number(recordValue(lastSnapshot)?.openObserverCount) > 0
    ) {
      return;
    }
    await sleep(50);
  }
  throw new Error(
    `demo observer WebSocket was not attached: ${JSON.stringify(lastSnapshot)}`,
  );
}

async function driveAgentCase(options: {
  demoCase: DemoCase;
  driver: AgentDemoDriver;
  agent: PreparedPiRecordingEnvironment;
  agentBrowser: ReturnType<typeof createAgentBrowser>;
  client: CdpClient;
  apiBaseUrl: string;
  projectId: string;
  journal: DemoEventJournal;
  events: DemoEvent[];
  screenshotsDir: string;
  screenshotFiles: string[];
  beginChapter: (id: string) => void;
  signal: AbortSignal;
  caseDeadlineAt: number;
}): Promise<{
  evidence: AgentEvidenceResult;
  finalAnswerMatched: boolean;
  readback: ProjectSnapshot;
}> {
  if (process.env.CLASH_E2E_REAL_AGENT !== "1") {
    throw new Error("real Agent recording requires CLASH_E2E_REAL_AGENT=1");
  }
  await waitForEval(
    options.agentBrowser,
    AGENT_COMPOSER_READINESS_SOURCE,
    "Agent composer and harness controls",
    30_000,
  );
  await requireAgentHarnessSelected(
    options.agentBrowser,
    options.agent.agentLabel,
  );
  const instrumentationInstalled = await evaluateCdp<boolean>(
    options.client,
    "Boolean(window.__clashDemoRecording?.snapshot)",
  );
  if (!instrumentationInstalled)
    throw new Error("demo WebSocket instrumentation is not installed");
  let minimumLiveCanvasNodeCount = await evaluateCdp<number>(
    options.client,
    `document.querySelectorAll(
      '#project-workspace-shell .react-flow__minimap-node'
    ).length`,
  );
  if (
    !Number.isSafeInteger(minimumLiveCanvasNodeCount) ||
    minimumLiveCanvasNodeCount < 0
  ) {
    throw new Error("could not read the initial Canvas node count");
  }

  options.beginChapter("brief");
  if (!typeComposer(options.agentBrowser, options.driver.prompt)) {
    throw new Error("could not type the Agent demo brief into the composer");
  }
  const briefScreenshot = path.join(options.screenshotsDir, "brief.png");
  await captureScreenshot(options.client, briefScreenshot);
  options.screenshotFiles.push(briefScreenshot);

  options.beginChapter("agent-work");
  if (!clickComposerSubmitButton(options.agentBrowser)) {
    throw new Error("could not submit the Agent demo brief");
  }
  await waitForDemoObserver(options.client);
  const sessionId = await discoverAgentSession({
    apiBaseUrl: options.apiBaseUrl,
    projectId: options.projectId,
    agentId: options.agent.agentId,
    timeoutMs: 30_000,
    signal: options.signal,
    caseDeadlineAt: options.caseDeadlineAt,
  });

  const projector = new SessionEventProjector(options.journal);
  const bufferedFrames: unknown[] = [];
  let targetTurnId: string | undefined;
  let terminal: SessionTerminalResult | undefined;
  let toolScreenshotIndex = 0;
  const deadline = options.caseDeadlineAt;

  while (!terminal && Date.now() < deadline) {
    const permissionDecision = await evaluateCdp<
      "none" | "approved" | "blocked"
    >(options.client, TRUSTED_CLASH_PERMISSION_APPROVAL_SOURCE);
    if (permissionDecision === "blocked") {
      throw new Error(
        "Agent requested permission for a tool outside the bundled Clash MCP",
      );
    }
    const [turnIds, frames] = await Promise.all([
      evaluateCdp<string[]>(
        options.client,
        "window.__clashDemoRecording?.drainTurnIds?.() ?? []",
      ),
      evaluateCdp<unknown[]>(
        options.client,
        "window.__clashDemoRecording?.drainFrames?.() ?? []",
      ),
    ]);
    bufferedFrames.push(
      ...frames.filter((frame) => recordValue(frame)?.session_id === sessionId),
    );
    targetTurnId ??= turnIds.find(
      (turnId) => typeof turnId === "string" && turnId.length > 0,
    );
    if (!targetTurnId) {
      await sleep(50);
      continue;
    }
    if (
      bufferedFrames.length > 0 &&
      !options.events.some((event) => event.type === "agent.turn.started")
    ) {
      projector.arm(targetTurnId);
    }

    const before = options.events.length;
    while (bufferedFrames.length > 0) {
      const result = projector.consume(bufferedFrames.shift());
      if (result.kind === "untrusted-tool") {
        throw new Error(`Agent requested an untrusted ${result.toolKind} tool`);
      }
      if (result.kind === "completed" || result.kind === "failed") {
        terminal = result;
        break;
      }
    }
    const newlyCompleted = options.events
      .slice(before)
      .filter((event) => event.type === "agent.tool.completed");
    const liveCanvasMutationCount = newlyCompleted.filter(
      shouldReframeLiveCanvas,
    ).length;
    if (liveCanvasMutationCount > 0) {
      minimumLiveCanvasNodeCount += liveCanvasMutationCount;
      await applyLiveCanvasCameraPreset({
        preset: {
          mode: "fit-live",
          minimumNodeCount: minimumLiveCanvasNodeCount,
        },
        clickControl: (label) => clickButtonByLabel(options.agentBrowser, label),
        panToVisibleArea: async () => {
          const plan = await evaluateCdp<
            | false
            | {
                startX: number;
                startY: number;
                endX: number;
                endY: number;
              }
          >(options.client, buildLiveCanvasPanPlanSource());
          if (!plan) {
            throw new Error("could not plan the live Canvas camera pan");
          }
          const coordinates = [
            plan.startX,
            plan.startY,
            plan.endX,
            plan.endY,
          ];
          if (!coordinates.every(Number.isFinite)) {
            throw new Error("live Canvas camera pan returned invalid coordinates");
          }
          if (plan.startX === plan.endX && plan.startY === plan.endY) return;
          await options.client.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: plan.startX,
            y: plan.startY,
            button: "none",
            buttons: 0,
          });
          await options.client.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: plan.startX,
            y: plan.startY,
            button: "middle",
            buttons: 4,
            clickCount: 1,
          });
          await options.client.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: plan.endX,
            y: plan.endY,
            button: "middle",
            buttons: 4,
          });
          await options.client.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: plan.endX,
            y: plan.endY,
            button: "middle",
            buttons: 0,
            clickCount: 1,
          });
        },
        waitForReadiness: (source, label, timeoutMs) =>
          waitForEval(
            options.agentBrowser,
            source,
            label,
            remainingCaseTime(options.caseDeadlineAt, timeoutMs),
          ),
      });
    }
    for (const _event of newlyCompleted) {
      if (toolScreenshotIndex >= 16) break;
      toolScreenshotIndex += 1;
      const file = path.join(
        options.screenshotsDir,
        `tool-${String(toolScreenshotIndex).padStart(2, "0")}.png`,
      );
      await captureScreenshot(options.client, file);
      options.screenshotFiles.push(file);
    }
    if (!terminal) await sleep(80);
  }

  if (!targetTurnId)
    throw new Error("the product UI never emitted an Agent turn id");
  if (!terminal) throw new Error("the Agent demo turn timed out");
  if (terminal.kind === "failed") {
    throw new Error(
      `Agent turn failed: ${sanitizeArtifactText(terminal.message)}`,
    );
  }

  const messages = await settleBeforeCaseDeadline({
    promise: waitForPersistedTurn({
      apiBaseUrl: options.apiBaseUrl,
      sessionId,
      turnId: targetTurnId,
      timeoutMs: 30_000,
      signal: options.signal,
      readyWhen: (body) => persistedTurnHasAnswer(body, targetTurnId),
    }),
    signal: options.signal,
    deadlineAt: options.caseDeadlineAt,
  });
  const completedOperations = observeCompletedProductOperations(
    messages,
    targetTurnId,
    options.journal,
  );

  options.beginChapter("product-result");
  const readback = await settleBeforeCaseDeadline({
    promise: readProjectSnapshot({
      apiBaseUrl: options.apiBaseUrl,
      projectId: options.projectId,
      signal: options.signal,
      timeoutMs: remainingCaseTime(options.caseDeadlineAt, 30_000),
    }),
    signal: options.signal,
    deadlineAt: options.caseDeadlineAt,
  });
  const evidence = evaluateAgentEvidence({
    requirements: options.driver.requirements,
    completedOperations,
    readback,
  });
  const observedAnswer = finalAnswerForTurn(messages, targetTurnId);
  const finalAnswerMatched = matchesExpectedFinalAnswer(
    observedAnswer,
    options.driver.expectedFinalAnswer,
  );
  if (!finalAnswerMatched) {
    evidence.status = "fail";
    evidence.failures.push(
      "Agent did not return the exact expected final answer",
    );
  }
  await evaluateCdp(
    options.client,
    `(() => {
    const main = document.querySelector('#project-canvas-main');
    if (main instanceof HTMLElement) main.click();
    return true;
  })()`,
  );
  await waitForEval(
    options.agentBrowser,
    `!!document.querySelector('#project-workspace-inset .react-flow__pane')`,
    "Main Canvas before result framing",
    remainingCaseTime(options.caseDeadlineAt, 20_000),
  );
  const canvasNodeCount = Array.isArray(readback.canvas.nodes)
    ? readback.canvas.nodes.length
    : 0;
  await applyCanvasCameraPreset({
    preset: { mode: "fit-all", expectedNodeCount: canvasNodeCount },
    isCopilotCollapsed: () =>
      Boolean(
        evalJson(
          options.agentBrowser,
          `document.querySelector('#clash-copilot-panel')?.getAttribute('aria-hidden') === 'true'`,
        ),
      ),
    clickControl: (label) => clickButtonByLabel(options.agentBrowser, label),
    waitForReadiness: (source, label, timeoutMs) =>
      waitForEval(
        options.agentBrowser,
        source,
        label,
        remainingCaseTime(options.caseDeadlineAt, timeoutMs),
      ),
  });
  return { evidence, finalAnswerMatched, readback };
}

async function driveFeatureStep(options: {
  step: FeatureDemoStep;
  agentBrowser: ReturnType<typeof createAgentBrowser>;
}): Promise<void> {
  const { step, agentBrowser } = options;
  if (step.kind === "create-timeline") {
    evalJson(
      agentBrowser,
      `(() => { window.prompt = () => ${JSON.stringify(step.name)}; return true; })()`,
    );
    if (!clickButtonByLabel(agentBrowser, "New Timeline")) {
      throw new Error(
        "could not invoke New Timeline from the Project navigator",
      );
    }
    await waitForEval(
      agentBrowser,
      `!!document.querySelector('[data-testid="project-timeline-editor"]') &&
        !!document.querySelector('[data-testid="project-timeline-editor"] [data-layout="embedded"]') &&
        !!document.querySelector('[data-testid="project-timeline-editor"] .tracks-viewport') &&
        document.body.innerText.includes(${JSON.stringify(step.name)})`,
      "created Timeline surface",
      20_000,
    );
    return;
  }
  if (step.kind === "create-director-stage") {
    evalJson(
      agentBrowser,
      `(() => { window.prompt = () => ${JSON.stringify(step.name)}; return true; })()`,
    );
    if (!clickButtonByLabel(agentBrowser, "New Director Stage")) {
      throw new Error(
        "could not invoke New Director Stage from the Project navigator",
      );
    }
    await waitForEval(
      agentBrowser,
      `!!document.querySelector(${JSON.stringify(`[aria-label="${step.name} Director Stage"]`)})`,
      "created Director Stage surface",
      30_000,
    );
    return;
  }
  const opened = evalJson(
    agentBrowser,
    `(() => {
    const main = document.querySelector('#project-canvas-main');
    if (!main) return false;
    main.click();
    return true;
  })()`,
  );
  if (!opened) throw new Error("could not return to the Main Canvas");
  await waitForEval(
    agentBrowser,
    `!!document.querySelector('.react-flow__pane')`,
    "Main Canvas surface",
    20_000,
  );
}

async function driveFeatureCase(options: {
  driver: FeatureDemoDriver;
  agentBrowser: ReturnType<typeof createAgentBrowser>;
  client: CdpClient;
  apiBaseUrl: string;
  projectId: string;
  screenshotsDir: string;
  screenshotFiles: string[];
  beginChapter: (id: string) => void;
  signal: AbortSignal;
  caseDeadlineAt: number;
}): Promise<{ evidence: AgentEvidenceResult; readback: ProjectSnapshot }> {
  for (const [index, step] of options.driver.steps.entries()) {
    const chapterId =
      step.kind === "create-timeline"
        ? "timeline"
        : step.kind === "create-director-stage"
          ? "director-stage"
          : "product-result";
    options.beginChapter(chapterId);
    await driveFeatureStep({ step, agentBrowser: options.agentBrowser });
    const screenshot = path.join(
      options.screenshotsDir,
      `feature-${String(index + 1).padStart(2, "0")}-${step.kind}.png`,
    );
    await captureScreenshot(options.client, screenshot);
    options.screenshotFiles.push(screenshot);
  }
  const readback = await settleBeforeCaseDeadline({
    promise: readProjectSnapshot({
      apiBaseUrl: options.apiBaseUrl,
      projectId: options.projectId,
      signal: options.signal,
      timeoutMs: remainingCaseTime(options.caseDeadlineAt, 30_000),
    }),
    signal: options.signal,
    deadlineAt: options.caseDeadlineAt,
  });
  return {
    evidence: evaluateAgentEvidence({
      requirements: {
        operations: [],
        minimumProductState: options.driver.minimumProductState,
        requiredProductState: options.driver.requiredProductState,
      },
      completedOperations: [],
      readback,
    }),
    readback,
  };
}

async function loadDriver(demoCase: DemoCase): Promise<DemoDriver> {
  const module = (await import(
    pathToFileURL(demoCase.driverPath).href
  )) as DemoDriverModule;
  if (!module.default || module.default.kind !== demoCase.kind) {
    throw new Error(`driver kind does not match demo case ${demoCase.id}`);
  }
  return module.default;
}

async function runCase(
  suite: DemoSuite,
  demoCase: DemoCase,
): Promise<CaseRunResult> {
  const driver = await loadDriver(demoCase);
  const caseArtifactDir = path.join(artifactRoot, demoCase.id);
  const caseVideoPath = path.join(caseArtifactDir, "case.mp4");
  const screenshotsDir = path.join(caseArtifactDir, "screenshots");
  const publishedPiDiagnosticsPath = path.join(
    caseArtifactDir,
    "pi-acp-diagnostics.jsonl",
  );
  const runRoot = path.join(
    repoRoot,
    ".tmp",
    `desktop-demo-${demoCase.id}-${process.pid}`,
  );
  const rawPiDiagnosticsPath = path.join(
    runRoot,
    "pi-acp-diagnostics.raw.jsonl",
  );
  const piProcessPath = path.join(runRoot, "pi-acp-process.json");
  const clashHome = path.join(runRoot, "clash-home");
  const dataDir = path.join(clashHome, "local-api");
  const captureDir = path.join(runRoot, "capture");
  const frameDir = path.join(runRoot, "frames");
  const temporaryHome = await mkdtemp(path.join(tmpdir(), "clash-demo-home-"));
  await chmod(temporaryHome, 0o700);
  sensitiveHomes.add(temporaryHome);
  const startedAt = new Date().toISOString();
  const events: DemoEvent[] = [];
  const screenshotFiles: string[] = [];
  let currentChapter: string | undefined;
  let readbackArtifact: ProductReadbackArtifact | undefined;
  let evidence: AgentEvidenceResult | undefined;
  let finalAnswerMatched: boolean | undefined;
  let projectId: string | undefined;
  let failure: string | undefined;
  let agentStopped = demoCase.kind === "feature";
  let processesStopped = false;
  let videoReady = false;
  const videoContractFailures: string[] = [];
  let caseTimedOut = false;
  let captureMetrics: DemoCaptureMetrics | undefined;
  let recorder: CdpScreencastRecorder | undefined;
  let recordingEndMs = 0;
  let client:
    Awaited<ReturnType<typeof connectToClashPage>>["client"] | undefined;
  let web: Awaited<ReturnType<typeof startVite>> | undefined;
  let electron: Awaited<ReturnType<typeof startElectron>> | undefined;
  let webPort = 0;
  let apiPort = 0;
  let apiBaseUrl: string | undefined;
  let recordingAgent: PreparedPiRecordingEnvironment | undefined;
  let agentBrowserSessionStarted = false;
  let agentBrowserDaemonIdentity: AgentBrowserDaemonIdentity | undefined;
  const webLogs: string[] = [];
  const electronLogs: string[] = [];
  const agentBrowserScope = buildRecordingAgentBrowserScope({
    temporaryHome,
    idleTimeoutMs: demoCase.timeoutMs + 60_000,
  });
  const sessionName = agentBrowserScope.sessionName;
  const agentBrowserNamespace = agentBrowserScope.namespace;
  const agentBrowserControl = withAgentBrowserEnvironment(
    createAgentBrowser({ sessionName, captureDir }),
    agentBrowserScope.environment,
  );
  let agentBrowser = agentBrowserControl;
  const journal = new DemoEventJournal({
    onRecord: (event) => events.push(event),
  });
  const teardown = createCaseTeardown({
    stopElectron: async () => {
      const failures: unknown[] = [];
      if (agentBrowserSessionStarted) {
        try {
          agentBrowserDaemonIdentity = parseAgentBrowserDaemonIdentity(
            agentBrowserControl(["session", "info", "--json"]),
            {
              session: sessionName,
              namespace: agentBrowserNamespace,
            },
          );
        } catch (error) {
          if (!agentBrowserDaemonIdentity) failures.push(error);
        }
        if (agentBrowserDaemonIdentity) {
          try {
            await stopAgentBrowserDaemon({
              pid: agentBrowserDaemonIdentity.pid,
              closeSession: () => {
                agentBrowserControl(["close", "--all"]);
              },
            });
          } catch (error) {
            failures.push(error);
          }
        } else {
          try {
            agentBrowserControl(["close", "--all"]);
          } catch (error) {
            failures.push(error);
          }
        }
      }
      try {
        client?.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        await stopChildProcessVerified(electron, { label: "Electron" });
      } catch (error) {
        failures.push(error);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          "Agent browser and Electron cleanup failed",
        );
      }
    },
    stopAgent: () =>
      demoCase.kind === "agent"
        ? stopRecordedAgentProcesses(piProcessPath)
        : Promise.resolve(),
    stopHost: () => stopDetachedHost(path.join(clashHome, "run", "host.json")),
    stopWeb: () => stopChildProcessVerified(web, { label: "Web" }),
    cleanupWebState: async () => {
      if (webPort <= 0) return;
      await rm(
        path.join(repoRoot, ".tmp", "desktop-vite-state", String(webPort)),
        { recursive: true, force: true },
      );
    },
    cleanupSensitiveHome: async () => {
      await rm(temporaryHome, { recursive: true, force: true });
      sensitiveHomes.delete(temporaryHome);
    },
  });
  activeCaseTeardown = teardown;
  const watchdog = createCaseWatchdog({
    timeoutMs: demoCase.timeoutMs,
    teardown,
  });
  const beforeCaseDeadline = <T>(promise: PromiseLike<T>): Promise<T> =>
    settleBeforeCaseDeadline({
      promise,
      signal: watchdog.signal,
      deadlineAt: watchdog.deadlineAt,
    });

  const completeCurrentChapter = (
    status: "completed" | "failed" = "completed",
  ) => {
    if (!currentChapter) return;
    journal.record({
      source: "runner",
      type: "chapter.completed",
      chapterId: currentChapter,
      status,
    });
    currentChapter = undefined;
  };
  const beginChapter = (id: string) => {
    if (currentChapter === id) return;
    completeCurrentChapter();
    journal.record({
      source: "runner",
      type: "chapter.started",
      chapterId: id,
    });
    currentChapter = id;
  };

  try {
    await beforeCaseDeadline(resetDirs(caseArtifactDir, runRoot));
    await beforeCaseDeadline(mkdir(screenshotsDir, { recursive: true }));
    await beforeCaseDeadline(access(corepackHome));
    if (demoCase.kind === "agent") {
      recordingAgent = await beforeCaseDeadline(
        preparePiRecordingEnvironment({
          sourcePiAgentDir,
          temporaryHome,
          localDataDir: dataDir,
          nodeExecutable: process.execPath,
          piAcpEntryPath,
          piAcpProxyPath,
          tsxImportPath,
          diagnosticsPath: rawPiDiagnosticsPath,
          pidPath: piProcessPath,
          provider: "anthropic-proxy",
          model: "claude-sonnet-5",
          thinkingLevel: "high",
        }),
      );
    }
    webPort = await beforeCaseDeadline(findFreePort(51100));
    apiPort = await beforeCaseDeadline(findFreePort(51200));
    const cdpPort = await beforeCaseDeadline(findFreePort(51300));
    const webOrigin = `http://127.0.0.1:${webPort}`;

    web = await withFrozenViteSource(() =>
      startVite({ webPort, logs: webLogs }),
    );
    await beforeCaseDeadline(
      waitForHttp(webOrigin, "Vite desktop demo shell"),
    );
    const startedElectron = await startElectron({
      cdpPort,
      webOrigin,
      apiPort,
      dataDir,
      captureDir,
      logs: electronLogs,
      env: buildRecordingChildEnvironment(process.env, {
        HOME: temporaryHome,
        CLASH_HOME: clashHome,
        COREPACK_ENABLE_NETWORK: "0",
        COREPACK_HOME: corepackHome,
        CLASH_DESKTOP_HOST_STARTUP_TIMEOUT_MS: "60000",
        CLASH_DESKTOP_HOST_STDIO: "inherit",
        CLASH_DESKTOP_SOURCE_HOST_WATCH: "0",
        CLASH_DESKTOP_RECORDING_VIEWPORT:
          `${demoCase.viewport.width}x${demoCase.viewport.height}`,
        CLASH_ACP_TEST_BIN_DIR: path.join(desktopDir, "build", "acp-bin"),
        ...(demoCase.kind === "feature" ? { CLASH_E2E_STUB_ACP: "1" } : {}),
      }),
      electronArgs: [`--lang=${demoCase.locale}`],
    } as any);
    electron = startedElectron;
    await beforeCaseDeadline(
      waitForHttp(
        `http://127.0.0.1:${cdpPort}/json/version`,
        "Electron CDP",
      ),
    );
    await waitForClashPageTarget({
      cdpPort,
      webOrigin,
      electron: startedElectron,
      electronLogs,
      signal: watchdog.signal,
      caseDeadlineAt: watchdog.deadlineAt,
    });
    agentBrowser = withAgentBrowserCdp(agentBrowserControl, cdpPort);
    agentBrowserSessionStarted = true;
    await beforeCaseDeadline(
      waitForEval(
        agentBrowser,
        `location.href.startsWith(${JSON.stringify(webOrigin)})`,
        "Electron page target",
        10_000,
      ),
    );
    agentBrowserDaemonIdentity = parseAgentBrowserDaemonIdentity(
      agentBrowserControl(["session", "info", "--json"]),
      {
        session: sessionName,
        namespace: agentBrowserNamespace,
      },
    );
    apiBaseUrl = resolvePublishedRuntimeApiBaseUrl(
      await beforeCaseDeadline(
        waitForEval(
          agentBrowser,
          DESKTOP_HOME_READINESS_SOURCE,
          "ready Desktop Home",
          30_000,
        ),
      ),
    );

    ({ client } = await beforeCaseDeadline(
      connectToClashPage({
        debugPort: cdpPort,
        appBaseUrl: webOrigin,
      }),
    ));
    await beforeCaseDeadline(
      applyRecordingViewport({
        viewport: demoCase.viewport,
        clearDeviceMetrics: () =>
          client!.send("Emulation.clearDeviceMetricsOverride"),
        setDeviceMetrics: (metrics) =>
          client!.send("Emulation.setDeviceMetricsOverride", metrics),
        waitForReadiness: (source, label, timeoutMs) =>
          waitForCdpReadiness({
            client: client!,
            source,
            label,
            timeoutMs,
          }),
      }),
    );
    await beforeCaseDeadline(
      client.send("Emulation.setEmulatedMedia", {
        features: [
          {
            name: "prefers-color-scheme",
            value: demoCase.theme === "dark" ? "dark" : "light",
          },
        ],
      }),
    );
    recorder = new CdpScreencastRecorder({
      client,
      frameDir,
      viewport: demoCase.viewport,
      quality: 60,
      everyNthFrame: 1,
      minimumFrameIntervalMs: 200,
    });
    await beforeCaseDeadline(assertRecordingDiskBudget());
    await beforeCaseDeadline(recorder.start());
    journal.record({
      source: "runner",
      type: "case.started",
      label: demoCase.title,
    });

    beginChapter("project-ready");
    if (!clickButtonByLabel(agentBrowser, "Projects")) {
      throw new Error("could not open Projects from Desktop navigation");
    }
    await beforeCaseDeadline(
      waitForEval(
        agentBrowser,
        `location.pathname === '/projects'`,
        "Projects route",
      ),
    );
    if (!clickByText(agentBrowser, "New Project"))
      throw new Error("could not open New Project");
    await beforeCaseDeadline(
      submitProjectCreateDialog(agentBrowser, driver.projectName),
    );
    projectId = await beforeCaseDeadline(
      waitForEval(
        agentBrowser,
        `location.pathname.startsWith('/projects/') && location.pathname !== '/projects' &&
          location.pathname.split('/').filter(Boolean).pop()`,
        "Project editor route",
        20_000,
      ),
    );
    if (!projectId)
      throw new Error("Project editor did not expose a Project id");
    await beforeCaseDeadline(
      waitForEval(
        agentBrowser,
        `!!document.querySelector('[aria-label="Project navigator"]') &&
          !!document.querySelector('.react-flow__pane')`,
        "Project Canvas ready",
        30_000,
      ),
    );
    const readyScreenshot = path.join(screenshotsDir, "project-ready.png");
    await beforeCaseDeadline(captureScreenshot(client, readyScreenshot));
    screenshotFiles.push(readyScreenshot);

    if (driver.kind === "agent") {
      if (!recordingAgent) {
        throw new Error("real Agent recording environment was not prepared");
      }
      await beforeCaseDeadline(client.send("Runtime.enable"));
      const installed = await beforeCaseDeadline(
        evaluateCdp<boolean>(
          client,
          `Boolean(${DEMO_WEBSOCKET_INSTRUMENTATION_SOURCE})`,
        ),
      );
      if (!installed) {
        throw new Error("could not install demo WebSocket instrumentation");
      }
      const result = await beforeCaseDeadline(
        driveAgentCase({
          demoCase,
          driver,
          agent: recordingAgent,
          agentBrowser,
          client,
          apiBaseUrl,
          projectId,
          journal,
          events,
          screenshotsDir,
          screenshotFiles,
          beginChapter,
          signal: watchdog.signal,
          caseDeadlineAt: watchdog.deadlineAt,
        }),
      );
      evidence = result.evidence;
      finalAnswerMatched = result.finalAnswerMatched;
      readbackArtifact = summarizeProductReadback(result.readback);
    } else {
      const result = await beforeCaseDeadline(
        driveFeatureCase({
          driver,
          agentBrowser,
          client,
          apiBaseUrl,
          projectId,
          screenshotsDir,
          screenshotFiles,
          beginChapter,
          signal: watchdog.signal,
          caseDeadlineAt: watchdog.deadlineAt,
        }),
      );
      evidence = result.evidence;
      readbackArtifact = summarizeProductReadback(result.readback);
    }
    const finalScreenshot = path.join(screenshotsDir, "product-result.png");
    await beforeCaseDeadline(captureScreenshot(client, finalScreenshot));
    screenshotFiles.push(finalScreenshot);
    await beforeCaseDeadline(holdFinalProductResult(sleep));
    completeCurrentChapter(evidence.status === "pass" ? "completed" : "failed");
    journal.record({
      source: "runner",
      type: evidence.status === "pass" ? "case.completed" : "case.failed",
      status: evidence.status === "pass" ? "completed" : "failed",
    });
    if (evidence.status === "fail") failure = evidence.failures.join("; ");
  } catch (error) {
    caseTimedOut = error instanceof CaseDeadlineError || watchdog.signal.aborted;
    failure = caseTimedOut
      ? new CaseDeadlineError().message
      : sanitizeArtifactText(
          error instanceof Error ? error.message : String(error),
        );
    completeCurrentChapter("failed");
    journal.record({ source: "runner", type: "case.failed", status: "failed" });
    if (client && !watchdog.signal.aborted) {
      try {
        const screenshot = path.join(screenshotsDir, "failure.png");
        await beforeCaseDeadline(captureScreenshot(client, screenshot));
        screenshotFiles.push(screenshot);
      } catch {
        // Preserve the primary failure when the renderer is already gone.
      }
    }
  } finally {
    if (!watchdog.signal.aborted && !readbackArtifact && projectId) {
      try {
        if (apiBaseUrl) {
          readbackArtifact = summarizeProductReadback(
            await beforeCaseDeadline(
              readProjectSnapshot({
                apiBaseUrl,
                projectId,
                signal: watchdog.signal,
                timeoutMs: remainingCaseTime(watchdog.deadlineAt, 30_000),
              }),
            ),
          );
        }
      } catch {
        // A failed Host may not support final readback.
      }
    }
    try {
      const activeRecorder = recorder;
      const finalization = await finalizeRecordingAfterRuntime({
        initialFailure: failure,
        capture: activeRecorder
          ? async () => {
              const recording = await beforeCaseDeadline(
                activeRecorder.stop(),
              );
              recordingEndMs = recording.endMs;
              captureMetrics = requireScreencastCapture(recording);
              return recording;
            }
          : undefined,
        teardown,
        encode: activeRecorder
          ? async (recording) => {
              const watchdogResult = await watchdog.stop();
              caseTimedOut ||= watchdogResult.status === "timed-out";
              if (caseTimedOut) throw new CaseDeadlineError();
              await encodeScreencast({
                frames: recording.frames,
                endMs: recording.endMs,
                outputPath: caseVideoPath,
                concatPath: path.join(runRoot, "frames.ffconcat"),
                ffmpegPath:
                  resolveLocalMediaBinary("ffmpeg") ??
                  (() => {
                    throw new Error(
                      "a local ffmpeg binary is required to encode the demo recording",
                    );
                  })(),
              });
            }
          : undefined,
        cleanupCapture: () => rm(frameDir, { recursive: true, force: true }),
        describeError: (error) =>
          sanitizeArtifactText(
            error instanceof Error ? error.message : String(error),
          ),
      });
      failure = finalization.failure;
      videoReady = finalization.videoReady;
      agentStopped = finalization.teardown.agentStopped;
      processesStopped = finalization.teardown.processesStopped;
      const watchdogResult = await watchdog.stop();
      caseTimedOut ||= watchdogResult.status === "timed-out";
      if (caseTimedOut) {
        const deadlineFailure = new CaseDeadlineError().message;
        if (!failure?.startsWith(deadlineFailure)) {
          failure = failure
            ? `${deadlineFailure}; ${failure}`
            : deadlineFailure;
        }
      }
    } finally {
      if (activeCaseTeardown === teardown) {
        activeCaseTeardown = undefined;
      }
    }
  }

  if (videoReady) {
    const ffprobePath = resolveLocalMediaBinary("ffprobe");
    if (!ffprobePath) {
      videoContractFailures.push(
        "a local ffprobe binary is required to validate the demo recording",
      );
    } else {
      try {
        const stream = await probeEncodedVideoStream({
          ffprobePath,
          videoPath: caseVideoPath,
        });
        videoContractFailures.push(
          ...evaluateEncodedVideoContract({
            viewport: demoCase.viewport,
            stream,
          }),
        );
      } catch (error) {
        videoContractFailures.push(
          `recording video validation failed: ${sanitizeArtifactText(
            error instanceof Error ? error.message : String(error),
          )}`,
        );
      }
    }
  }

  const completedAt = new Date().toISOString();
  let diagnostics:
    | Awaited<ReturnType<typeof publishValidatedPiAcpDiagnostics>>
    | { valid: false; failure?: string };
  if (demoCase.kind !== "agent") {
    diagnostics = { valid: false };
  } else if (agentStopped) {
    diagnostics = await publishValidatedPiAcpDiagnostics(
      rawPiDiagnosticsPath,
      publishedPiDiagnosticsPath,
    );
  } else {
    await rm(publishedPiDiagnosticsPath, { force: true });
    diagnostics = {
      valid: false,
      failure: "Agent cleanup was not verified",
    };
  }
  const diagnosticsReady = diagnostics.valid;
  const chapterCoverage = evaluateChapterCoverage({
    demoCase,
    events,
    endMs: recordingEndMs,
  });
  const trajectoryHealth = evaluateTrajectoryHealth(events);
  const failures = [
    ...(evidence?.failures ?? []),
    ...(failure ? [failure] : []),
    ...chapterCoverage.failures,
    ...trajectoryHealth.failures,
    ...videoContractFailures,
    ...(demoCase.kind === "agent" && !diagnosticsReady
      ? [diagnostics.failure ?? "Agent Pi ACP diagnostics are invalid"]
      : []),
    ...(!videoReady ? ["recording did not produce case.mp4"] : []),
  ].map(sanitizeArtifactText);
  const uniqueFailures = [...new Set(failures)];
  const status: "pass" | "fail" =
    uniqueFailures.length === 0 && evidence?.status === "pass"
      ? "pass"
      : "fail";
  const eventsPath = path.join(caseArtifactDir, "events.jsonl");
  await writeFile(
    eventsPath,
    events.map((event) => JSON.stringify(event)).join("\n") +
      (events.length > 0 ? "\n" : ""),
    "utf8",
  );
  if (readbackArtifact) {
    await writeFile(
      path.join(caseArtifactDir, "readback.json"),
      `${JSON.stringify(readbackArtifact, null, 2)}\n`,
      "utf8",
    );
  }
  const resultArtifact: CaseResultArtifact = {
    schemaVersion: 1,
    suiteId: suite.id,
    caseId: demoCase.id,
    kind: demoCase.kind,
    status,
    startedAt,
    completedAt,
    failures: uniqueFailures,
    ...(evidence
      ? {
          evidence: {
            missingOperations: evidence.missingOperations,
            missingProductState: evidence.missingProductState,
            metrics: evidence.metrics,
            ...(finalAnswerMatched === undefined ? {} : { finalAnswerMatched }),
          },
        }
      : {}),
    ...(captureMetrics ? { capture: captureMetrics } : {}),
    artifacts: {
      video: videoReady,
      events: events.length,
      screenshots: screenshotFiles.length,
      readback: Boolean(readbackArtifact),
      diagnostics: diagnosticsReady,
    },
  };
  await writeFile(
    path.join(caseArtifactDir, "case-result.json"),
    `${JSON.stringify(resultArtifact, null, 2)}\n`,
    "utf8",
  );

  const files = [
    ...(videoReady ? [{ path: "case.mp4", mediaType: "video/mp4" }] : []),
    { path: "events.jsonl", mediaType: "application/x-ndjson" },
    ...(readbackArtifact
      ? [{ path: "readback.json", mediaType: "application/json" }]
      : []),
    { path: "case-result.json", mediaType: "application/json" },
    ...(diagnosticsReady
      ? [
          {
            path: "pi-acp-diagnostics.jsonl",
            mediaType: "application/x-ndjson",
          },
        ]
      : []),
    ...screenshotFiles.map((file) => ({
      path: path.relative(caseArtifactDir, file),
      mediaType: "image/png",
    })),
  ];
  await writeArtifactManifest({
    artifactDir: caseArtifactDir,
    suiteId: suite.id,
    caseId: demoCase.id,
    caseKind: demoCase.kind,
    status,
    title: demoCase.title,
    startedAt,
    completedAt,
    chapters: chapterCoverage.chapters,
    files,
  });
  if (processesStopped) {
    await rm(runRoot, { recursive: true, force: true });
  }

  return {
    caseId: demoCase.id,
    kind: demoCase.kind,
    status,
    artifactDir: caseArtifactDir,
    failures: uniqueFailures,
  };
}

async function main(): Promise<void> {
  ensureAgentBrowser();
  const suitePath = path.resolve(
    process.env.CLASH_DEMO_SUITE ?? defaultSuitePath,
  );
  const suite = parseDemoSuite(
    JSON.parse(await readFile(suitePath, "utf8")) as unknown,
    suitePath,
  );
  const selectedCaseId = process.env.CLASH_DEMO_CASE?.trim() || undefined;
  const selection = selectDemoSuiteCases({
    suite,
    selectedCaseId,
    mode: process.env.CLASH_DEMO_REQUIRE_FULL === "1" ? "full" : "selectable",
    requiredSuitePath: defaultSuitePath,
  });
  if (selection.failures.length > 0) {
    throw new Error(selection.failures.join("; "));
  }
  const cases = selection.cases;
  if (
    cases.some((demoCase) => demoCase.kind === "agent") &&
    process.env.CLASH_E2E_REAL_AGENT !== "1"
  ) {
    throw new Error(
      "refusing to run real Agent demo cases without CLASH_E2E_REAL_AGENT=1",
    );
  }

  await mkdir(artifactRoot, { recursive: true });
  const results: CaseRunResult[] = [];
  for (const demoCase of cases) {
    console.log(`[desktop-demo] recording ${demoCase.id}`);
    const result = await runCase(suite, demoCase);
    results.push(result);
    console.log(
      `[desktop-demo] ${result.status} ${demoCase.id} ${result.artifactDir}`,
    );
  }
  await writeFile(
    path.join(artifactRoot, "suite-result.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        suiteId: suite.id,
        declaredCaseCount: selection.declaredCaseCount,
        selectedCaseCount: selection.selectedCaseCount,
        status: results.every((result) => result.status === "pass")
          ? "pass"
          : "fail",
        cases: results.map(({ caseId, kind, status, failures }) => ({
          caseId,
          kind,
          status,
          failures,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  if (results.some((result) => result.status === "fail")) process.exitCode = 1;
}

try {
  await main();
} finally {
  await cleanupSensitiveHomes();
}
