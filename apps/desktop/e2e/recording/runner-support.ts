import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const DESKTOP_HOME_READINESS_SOURCE = String.raw`(() => {
  const runtime = window.__CLASH_RUNTIME_CONFIG__;
  const projects = document.querySelector(
    'nav[aria-label="Primary"] button[aria-label="Projects"]',
  );
  if (!runtime?.apiBaseUrl || !(projects instanceof HTMLElement) || projects.disabled) {
    return false;
  }
  const rect = projects.getBoundingClientRect();
  const style = getComputedStyle(projects);
  return rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
    ? runtime
    : false;
})()`;

export const AGENT_COMPOSER_READINESS_SOURCE = String.raw`(() => {
  const harness = document.querySelector(
    '[data-testid="session-harness-config-trigger"]',
  );
  const editor = document.querySelector(
    ".milkdown-chat-input [contenteditable='true']",
  );
  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden";
  };
  return visible(harness) && visible(editor);
})()`;

export function buildRecordingViewportReadinessSource(viewport: {
  width: number;
  height: number;
}): string {
  if (
    !Number.isSafeInteger(viewport.width) ||
    viewport.width < 1 ||
    !Number.isSafeInteger(viewport.height) ||
    viewport.height < 1
  ) {
    throw new Error("recording viewport must use positive integer dimensions");
  }
  return String.raw`(() => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const deviceScaleFactor = window.devicePixelRatio;
  return width === ${JSON.stringify(viewport.width)} &&
    height === ${JSON.stringify(viewport.height)} &&
    deviceScaleFactor === 1
    ? { width, height, deviceScaleFactor }
    : false;
})()`;
}

function buildNativeRecordingViewportReadinessSource(viewport: {
  width: number;
  height: number;
}): string {
  return String.raw`(() => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return width === ${JSON.stringify(viewport.width)} &&
    height === ${JSON.stringify(viewport.height)}
    ? { width, height }
    : false;
})()`;
}

export async function applyRecordingViewport(options: {
  viewport: { width: number; height: number };
  clearDeviceMetrics: () => Promise<unknown>;
  setDeviceMetrics: (metrics: Record<string, unknown>) => Promise<unknown>;
  waitForReadiness: (
    source: string,
    label: string,
    timeoutMs: number,
  ) => Promise<unknown>;
}): Promise<unknown> {
  await options.clearDeviceMetrics();
  await options.waitForReadiness(
    buildNativeRecordingViewportReadinessSource(options.viewport),
    "native recording viewport",
    10_000,
  );
  await options.setDeviceMetrics({
    width: options.viewport.width,
    height: options.viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return options.waitForReadiness(
    buildRecordingViewportReadinessSource(options.viewport),
    "recording viewport",
    10_000,
  );
}

export interface CanvasCameraPreset {
  mode: "fit-all";
  expectedNodeCount: number;
}

export interface LiveCanvasCameraPreset {
  mode: "fit-live";
  minimumNodeCount: number;
}

export function shouldReframeLiveCanvas(event: {
  type: string;
  status?: string;
  dispatcherMode?: string;
  requestedOperation?: string;
}): boolean {
  return (
    event.type === "agent.tool.completed" &&
    event.status === "completed" &&
    event.dispatcherMode === "execute" &&
    (event.requestedOperation === "add" ||
      event.requestedOperation === "attach")
  );
}

export const COLLAPSED_COPILOT_READINESS_SOURCE = String.raw`(() => {
  const panel = document.querySelector("#clash-copilot-panel");
  if (!(panel instanceof HTMLElement) || panel.getAttribute("aria-hidden") !== "true") {
    return false;
  }
  const style = getComputedStyle(panel);
  return Number.parseFloat(style.opacity || "1") <= 0.01;
})()`;

export function buildCanvasModelReadinessSource(
  expectedNodeCount: number,
): string {
  if (!Number.isSafeInteger(expectedNodeCount) || expectedNodeCount < 1) {
    throw new Error("Canvas camera requires an expected node count");
  }
  return String.raw`(() => {
  const nodeCount = document.querySelectorAll(
    "#project-workspace-shell .react-flow__minimap-node",
  ).length;
  return nodeCount === ${JSON.stringify(expectedNodeCount)}
    ? { nodeCount }
    : false;
})()`;
}

export function buildLiveCanvasModelReadinessSource(
  minimumNodeCount: number,
): string {
  if (!Number.isSafeInteger(minimumNodeCount) || minimumNodeCount < 1) {
    throw new Error("live Canvas camera requires a minimum node count");
  }
  return String.raw`(() => {
  const nodeCount = document.querySelectorAll(
    "#project-workspace-shell .react-flow__minimap-node",
  ).length;
  return nodeCount >= ${JSON.stringify(minimumNodeCount)}
    ? { nodeCount }
    : false;
})()`;
}

/**
 * Browser-side readiness for the recording camera's fit-all preset. The
 * recorder drives the real product controls, then waits on this geometry
 * contract instead of guessing how long React Flow's animation will take.
 */
export function buildCanvasCameraReadinessSource(
  preset: CanvasCameraPreset,
): string {
  if (
    preset.mode !== "fit-all" ||
    !Number.isSafeInteger(preset.expectedNodeCount) ||
    preset.expectedNodeCount < 1
  ) {
    throw new Error("fit-all Canvas camera requires an expected node count");
  }
  const expectedNodeCount = JSON.stringify(preset.expectedNodeCount);
  return String.raw`(() => {
  const flow = document.querySelector("#project-workspace-inset .react-flow");
  const resetSample = () => {
    delete window.__clashDemoCanvasCameraSample;
    return false;
  };
  const collapsedCopilot = document.querySelector(
    '[aria-label="Expand AI Copilot"], [aria-label="Expand chat panel"]',
  );
  if (!(flow instanceof HTMLElement) || !(collapsedCopilot instanceof HTMLElement)) {
    return resetSample();
  }
  const flowRect = flow.getBoundingClientRect();
  if (flowRect.width <= 0 || flowRect.height <= 0) return resetSample();
  const viewport = flow.querySelector(".react-flow__viewport");
  if (!(viewport instanceof HTMLElement)) return resetSample();
  const nodes = Array.from(
    flow.querySelectorAll(".react-flow__node[data-id]"),
  ).filter((node) => node instanceof HTMLElement);
  if (nodes.length !== ${expectedNodeCount}) return resetSample();
  const nodeRects = nodes.map((node) => node.getBoundingClientRect());
  const inset = 8;
  if (
    nodeRects.some(
      (rect) =>
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.left < flowRect.left + inset ||
        rect.top < flowRect.top + inset ||
        rect.right > flowRect.right - inset ||
        rect.bottom > flowRect.bottom - inset,
    )
  ) {
    return resetSample();
  }
  const sample = JSON.stringify({
    transform: viewport.style.transform,
    flow: [flowRect.left, flowRect.top, flowRect.right, flowRect.bottom],
    nodes: nodeRects.map((rect) => [
      rect.left,
      rect.top,
      rect.right,
      rect.bottom,
    ]),
  });
  const previousSample = window.__clashDemoCanvasCameraSample;
  window.__clashDemoCanvasCameraSample = sample;
  if (previousSample !== sample) return false;
  return {
    mode: "fit-all",
    nodeCount: nodeRects.length,
    bounds: {
      left: Math.round(Math.min(...nodeRects.map((rect) => rect.left))),
      top: Math.round(Math.min(...nodeRects.map((rect) => rect.top))),
      right: Math.round(Math.max(...nodeRects.map((rect) => rect.right))),
      bottom: Math.round(Math.max(...nodeRects.map((rect) => rect.bottom))),
    },
  };
})()`;
}

function buildLiveCanvasGeometryReadinessSource(
  preset: LiveCanvasCameraPreset,
  options: { respectCopilot: boolean; sampleProperty: string },
): string {
  if (
    preset.mode !== "fit-live" ||
    !Number.isSafeInteger(preset.minimumNodeCount) ||
    preset.minimumNodeCount < 1
  ) {
    throw new Error("fit-live Canvas camera requires a minimum node count");
  }
  const minimumNodeCount = JSON.stringify(preset.minimumNodeCount);
  const sampleProperty = JSON.stringify(options.sampleProperty);
  const visibleRightSource = options.respectCopilot
    ? String.raw`const copilotOverlapsFlow =
    copilotRect.left < flowRect.right && copilotRect.right > flowRect.left;
  const visibleRight =
    (copilotOverlapsFlow
      ? Math.min(flowRect.right, copilotRect.left)
      : flowRect.right) - inset;`
    : "const visibleRight = flowRect.right - inset;";
  return String.raw`(() => {
  const resetSample = () => {
    delete window[${sampleProperty}];
    return false;
  };
  const flow = document.querySelector("#project-workspace-inset .react-flow");
  const copilot = document.querySelector("#clash-copilot-panel");
  if (!(flow instanceof HTMLElement) || !(copilot instanceof HTMLElement)) {
    return resetSample();
  }
  const flowRect = flow.getBoundingClientRect();
  const copilotRect = copilot.getBoundingClientRect();
  if (
    flowRect.width <= 0 ||
    flowRect.height <= 0 ||
    copilotRect.width <= 0 ||
    copilotRect.height <= 0
  ) {
    return resetSample();
  }
  const viewport = flow.querySelector(".react-flow__viewport");
  if (!(viewport instanceof HTMLElement)) return resetSample();
  const nodes = Array.from(
    flow.querySelectorAll(".react-flow__node[data-id]"),
  ).filter((node) => node instanceof HTMLElement);
  if (nodes.length < ${minimumNodeCount}) return resetSample();
  const nodeRects = nodes.map((node) => node.getBoundingClientRect());
  const inset = 8;
  ${visibleRightSource}
  if (
    nodeRects.some(
      (rect) =>
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.left < flowRect.left + inset ||
        rect.top < flowRect.top + inset ||
        rect.right > visibleRight ||
        rect.bottom > flowRect.bottom - inset,
    )
  ) {
    return resetSample();
  }
  const sample = JSON.stringify({
    transform: viewport.style.transform,
    flow: [flowRect.left, flowRect.top, flowRect.right, flowRect.bottom],
    copilot: [
      copilotRect.left,
      copilotRect.top,
      copilotRect.right,
      copilotRect.bottom,
    ],
    visibleRight,
    nodes: nodeRects.map((rect) => [
      rect.left,
      rect.top,
      rect.right,
      rect.bottom,
    ]),
  });
  const previousSample = window[${sampleProperty}];
  window[${sampleProperty}] = sample;
  if (previousSample !== sample) return false;
  return { mode: "fit-live", nodeCount: nodeRects.length };
})()`;
}

/**
 * First wait for the product's Center control to finish its full-Flow fit.
 * The recorder then pans that stable camera into the Copilot-safe area.
 */
export function buildCenteredLiveCanvasCameraReadinessSource(
  preset: LiveCanvasCameraPreset,
): string {
  return buildLiveCanvasGeometryReadinessSource(preset, {
    respectCopilot: false,
    sampleProperty: "__clashDemoCenteredLiveCanvasCameraSample",
  });
}

/**
 * Final live readiness keeps Copilot visible and rejects nodes hidden behind
 * its overlay after the recording-only pan gesture.
 */
export function buildLiveCanvasCameraReadinessSource(
  preset: LiveCanvasCameraPreset,
): string {
  return buildLiveCanvasGeometryReadinessSource(preset, {
    respectCopilot: true,
    sampleProperty: "__clashDemoLiveCanvasCameraSample",
  });
}

export function buildLiveCanvasPanPlanSource(): string {
  return String.raw`(() => {
  const flow = document.querySelector("#project-workspace-inset .react-flow");
  const copilot = document.querySelector("#clash-copilot-panel");
  if (!(flow instanceof HTMLElement) || !(copilot instanceof HTMLElement)) {
    return false;
  }
  const flowRect = flow.getBoundingClientRect();
  const copilotRect = copilot.getBoundingClientRect();
  if (
    flowRect.width <= 0 ||
    flowRect.height <= 0 ||
    copilotRect.width <= 0 ||
    copilotRect.height <= 0
  ) {
    return false;
  }
  const copilotOverlapsFlow =
    copilotRect.left < flowRect.right && copilotRect.right > flowRect.left;
  const visibleRight = copilotOverlapsFlow
    ? Math.min(flowRect.right, copilotRect.left)
    : flowRect.right;
  const fullCenterX = (flowRect.left + flowRect.right) / 2;
  const visibleCenterX = (flowRect.left + visibleRight) / 2;
  const shiftX = visibleCenterX - fullCenterX;
  const startX = visibleCenterX;
  const startY = flowRect.top + Math.min(64, flowRect.height / 4);
  return {
    startX: Math.round(startX),
    startY: Math.round(startY),
    endX: Math.round(startX + shiftX),
    endY: Math.round(startY),
  };
})()`;
}

export async function applyCanvasCameraPreset(options: {
  preset: CanvasCameraPreset;
  isCopilotCollapsed: () => boolean;
  clickControl: (label: string) => boolean;
  waitForReadiness: (
    source: string,
    label: string,
    timeoutMs: number,
  ) => Promise<unknown>;
}): Promise<unknown> {
  await options.waitForReadiness(
    buildCanvasModelReadinessSource(options.preset.expectedNodeCount),
    "complete Canvas model",
    20_000,
  );
  if (
    !options.isCopilotCollapsed() &&
    !options.clickControl("Collapse AI Copilot") &&
    !options.clickControl("Collapse chat panel")
  ) {
    throw new Error("could not collapse Copilot for the Canvas result shot");
  }
  await options.waitForReadiness(
    COLLAPSED_COPILOT_READINESS_SOURCE,
    "collapsed Copilot",
    10_000,
  );
  if (!options.clickControl("Center view on nodes")) {
    throw new Error("could not invoke Center view on nodes");
  }
  return options.waitForReadiness(
    buildCanvasCameraReadinessSource(options.preset),
    "fit-all Canvas camera",
    20_000,
  );
}

export async function applyLiveCanvasCameraPreset(options: {
  preset: LiveCanvasCameraPreset;
  clickControl: (label: string) => boolean;
  panToVisibleArea: () => Promise<void>;
  waitForReadiness: (
    source: string,
    label: string,
    timeoutMs: number,
  ) => Promise<unknown>;
}): Promise<unknown> {
  await options.waitForReadiness(
    buildLiveCanvasModelReadinessSource(options.preset.minimumNodeCount),
    "live Canvas model",
    20_000,
  );
  if (!options.clickControl("Center view on nodes")) {
    throw new Error("could not invoke Center view on nodes for live recording");
  }
  await options.waitForReadiness(
    buildCenteredLiveCanvasCameraReadinessSource(options.preset),
    "centered live Canvas camera",
    20_000,
  );
  await options.panToVisibleArea();
  return options.waitForReadiness(
    buildLiveCanvasCameraReadinessSource(options.preset),
    "live Canvas camera",
    20_000,
  );
}

export async function holdFinalProductResult(
  delay: (milliseconds: number) => Promise<void>,
): Promise<void> {
  await delay(3_000);
}

export const TRUSTED_CLASH_PERMISSION_APPROVAL_SOURCE = String.raw`(() => {
  const card = document.querySelector('[data-testid="acp-permission-card"]');
  if (!(card instanceof HTMLElement)) return "none";

  const titleElement = card.querySelector("[title]");
  const toolTitle = titleElement instanceof HTMLElement
    ? titleElement.title.trim()
    : "";
  if (card.__clashDemoPermissionHandled === toolTitle) return "none";
  const buttons = Array.from(card.querySelectorAll("button")).filter(
    (button) => button instanceof HTMLElement,
  );
  const rejectButton = buttons.find((button) =>
    /^reject$/iu.test((button.textContent || "").trim()),
  );
  const trustedTool = /^mcp__clash__clash(?:_[a-z0-9]+)*$/u.test(toolTitle);
  if (!trustedTool) {
    card.__clashDemoPermissionHandled = toolTitle;
    rejectButton?.click();
    return "blocked";
  }

  const allowButton = buttons.find((button) => {
    const label = (button.textContent || "").trim();
    return /\ballow\b/iu.test(label) && !/\breject\b/iu.test(label);
  });
  if (!(allowButton instanceof HTMLElement)) {
    card.__clashDemoPermissionHandled = toolTitle;
    rejectButton?.click();
    return "blocked";
  }
  card.__clashDemoPermissionHandled = toolTitle;
  allowButton.click();
  return "approved";
})()`;

export const DEMO_WEBSOCKET_INSTRUMENTATION_SOURCE = String.raw`(() => {
  const target = window;
  if (target.__clashDemoRecording) return target.__clashDemoRecording;
  const NativeWebSocket = target.WebSocket;
  const nativeSend = NativeWebSocket.prototype.send;
  const observers = [];
  const frames = [];
  const turnIds = [];

  NativeWebSocket.prototype.send = function (data) {
    if (typeof data === "string" && this.url.includes("/api/v1/local-sessions/")) {
      try {
        const message = JSON.parse(data);
        if (
          message.type === "prompt" &&
          typeof message.turn_id === "string" &&
          message.turn_id.trim().length > 0
        ) {
          turnIds.push(message.turn_id);
        }
      } catch {}
    }
    nativeSend.call(this, data);
  };

  const InstrumentedWebSocket = new Proxy(NativeWebSocket, {
    construct(Constructor, args) {
      const rawUrl = String(args[0] ?? "");
      try {
        const url = new URL(rawUrl);
        if (
          url.pathname.includes("/api/v1/local-sessions/") &&
          url.pathname.endsWith("/_stream")
        ) {
          url.searchParams.set("replay", "0");
          const observer = Reflect.construct(Constructor, [url.toString()]);
          observer.addEventListener("message", (event) => {
            if (typeof event.data !== "string") return;
            try {
              frames.push(JSON.parse(event.data));
            } catch {}
          });
          observers.push(observer);
        }
      } catch {}
      return Reflect.construct(Constructor, args);
    },
  });

  const instrumentation = {
    drainFrames() {
      return frames.splice(0);
    },
    drainTurnIds() {
      return turnIds.splice(0);
    },
    snapshot() {
      return {
        observerCount: observers.length,
        openObserverCount: observers.filter(
          (observer) => observer.readyState === NativeWebSocket.OPEN,
        ).length,
        bufferedFrameCount: frames.length,
        bufferedTurnCount: turnIds.length,
      };
    },
    dispose() {
      NativeWebSocket.prototype.send = nativeSend;
      target.WebSocket = NativeWebSocket;
      delete target.__clashDemoRecording;
      for (const observer of observers) observer.close();
      observers.splice(0);
      frames.splice(0);
      turnIds.splice(0);
    },
  };
  target.WebSocket = InstrumentedWebSocket;
  target.__clashDemoRecording = instrumentation;
  return instrumentation;
})()`;

export interface ProductReadbackArtifact {
  schemaVersion: 1;
  canvas: {
    count: number;
    ids: string[];
    facts: Array<{
      id?: string;
      canvasId?: string;
      type?: string;
      label?: string;
    }>;
  };
  edges: { count: number; ids: string[] };
  timelines: {
    count: number;
    ids: string[];
    facts: NamedOwnedEntityFact[];
  };
  timelineRenders: { count: number; ids: string[] };
  directorStages: {
    count: number;
    ids: string[];
    facts: NamedOwnedEntityFact[];
  };
}

interface NamedOwnedEntityFact {
  id?: string;
  name?: string;
  owner?: {
    kind: string;
    canvasId?: string;
    actionNodeId?: string;
  };
}

type JsonRecord = Record<string, unknown>;

export type AgentBrowserCommand = (
  args: string[],
  options?: { allowFailure?: boolean },
) => string;

export interface RecordingAgentBrowserScope {
  sessionName: string;
  namespace: string;
  environment: Readonly<Record<string, string>>;
}

export function buildRecordingAgentBrowserScope(options: {
  temporaryHome: string;
  idleTimeoutMs: number;
}): RecordingAgentBrowserScope {
  const sessionName = "u";
  const namespace = "r";
  return {
    sessionName,
    namespace,
    environment: {
      HOME: options.temporaryHome,
      AGENT_BROWSER_SOCKET_DIR: path.join(options.temporaryHome, "a"),
      AGENT_BROWSER_NAMESPACE: namespace,
      AGENT_BROWSER_IDLE_TIMEOUT_MS: String(options.idleTimeoutMs),
    },
  };
}

export function withAgentBrowserCdp(
  run: AgentBrowserCommand,
  cdpPort: number,
): AgentBrowserCommand {
  return (args, options) => run(["--cdp", String(cdpPort), ...args], options);
}

export async function withFrozenViteSource<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const key = "CLASH_WEB_E2E_FREEZE_SOURCE";
  const previous = process.env[key];
  process.env[key] = "1";
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

export function withAgentBrowserEnvironment(
  run: AgentBrowserCommand,
  overrides: Readonly<Record<string, string | undefined>>,
): AgentBrowserCommand {
  return (args, options) => {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(overrides)) {
      previous.set(key, process.env[key]);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      return run(args, options);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
}

export interface AgentBrowserDaemonIdentity {
  pid: number;
  session: string;
  namespace: string;
}

export function parseAgentBrowserDaemonIdentity(
  output: string,
  expected: { session: string; namespace: string },
): AgentBrowserDaemonIdentity {
  let value: unknown;
  try {
    value = JSON.parse(output) as unknown;
  } catch {
    throw new Error("agent-browser session info is not valid JSON");
  }
  const result = recordValue(value);
  const data = recordValue(result?.data);
  if (
    result?.success !== true ||
    data?.active !== true ||
    !Number.isSafeInteger(data?.pid) ||
    Number(data?.pid) <= 0 ||
    typeof data?.session !== "string" ||
    typeof data?.namespace !== "string"
  ) {
    throw new Error("agent-browser session info has no active daemon identity");
  }
  if (
    data.session !== expected.session ||
    data.namespace !== expected.namespace
  ) {
    throw new Error(
      "agent-browser daemon identity does not match the recording case",
    );
  }
  return {
    pid: data.pid as number,
    session: data.session,
    namespace: data.namespace,
  };
}

export function sanitizeArtifactText(value: unknown): string {
  return String(value)
    .replace(
      /(?:\/(?:Users|home|private|tmp|var\/folders)\/[^\s,;'"()[\]{}]+|[A-Za-z]:\\[^\s,;'"()[\]{}]+)/gu,
      "[local-path]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(
      /\b(api[-_ ]?key|token|authorization|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "$1=[redacted]",
    )
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, "sk-[redacted]")
    .slice(0, 2_000);
}

function recordValue(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

export interface PreparedPiRecordingEnvironment {
  agentId: "custom-pi";
  agentLabel: "Pi";
  piAgentDir: string;
}

export async function preparePiRecordingEnvironment(options: {
  sourcePiAgentDir: string;
  temporaryHome: string;
  localDataDir: string;
  nodeExecutable: string;
  piAcpEntryPath: string;
  piAcpProxyPath: string;
  tsxImportPath: string;
  diagnosticsPath: string;
  pidPath: string;
  provider: string;
  model: string;
  thinkingLevel: string;
}): Promise<PreparedPiRecordingEnvironment> {
  const piAgentDir = path.join(options.temporaryHome, ".pi", "agent");
  await Promise.all([
    mkdir(piAgentDir, { recursive: true, mode: 0o700 }),
    mkdir(options.localDataDir, { recursive: true }),
  ]);
  const targetModelsPath = path.join(piAgentDir, "models.json");
  await copyFile(
    path.join(options.sourcePiAgentDir, "models.json"),
    targetModelsPath,
  );
  await chmod(targetModelsPath, 0o600);
  await writeFile(
    path.join(piAgentDir, "settings.json"),
    `${JSON.stringify(
      {
        defaultProvider: options.provider,
        defaultModel: options.model,
        defaultThinkingLevel: options.thinkingLevel,
        quietStartup: true,
        packages: [],
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await writeFile(
    path.join(path.dirname(options.localDataDir), "config.yaml"),
    `${JSON.stringify(
      {
        version: 1,
        harnesses: {
          enabled: ["custom-pi"],
          agents: {
            Pi: {
              type: "custom",
              command: options.nodeExecutable,
              args: [
                "--import",
                options.tsxImportPath,
                options.piAcpProxyPath,
                options.piAcpEntryPath,
              ],
              env: {
                PI_CODING_AGENT_DIR: piAgentDir,
                CLASH_PI_ACP_DIAGNOSTICS_PATH: options.diagnosticsPath,
                CLASH_PI_ACP_PID_PATH: options.pidPath,
                PI_OFFLINE: "1",
                PI_TELEMETRY: "0",
              },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return {
    agentId: "custom-pi",
    agentLabel: "Pi",
    piAgentDir,
  };
}

export function findRuntimeAgentSessionId(
  value: unknown,
  agentId: string,
): string | undefined {
  const body = recordValue(value);
  const sessions = Array.isArray(body?.sessions) ? body.sessions : [];
  const session = sessions
    .map(recordValue)
    .filter((candidate): candidate is JsonRecord => Boolean(candidate))
    .find(
      (candidate) =>
        candidate.type === "runtime" && candidate.agentId === agentId,
    );
  const id = session?.threadId ?? session?.id;
  return typeof id === "string" && id.trim().length > 0 ? id : undefined;
}

export function resolvePublishedRuntimeApiBaseUrl(value: unknown): string {
  const apiBaseUrl = recordValue(value)?.apiBaseUrl;
  if (typeof apiBaseUrl !== "string") {
    throw new Error("Desktop runtime did not publish a loopback API endpoint");
  }
  const url = new URL(apiBaseUrl);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error("Desktop runtime API endpoint must be loopback HTTP");
  }
  return url.origin;
}

export const RECORDING_CHILD_ENV_PASSTHROUGH_KEYS = [
  "PATH",
  "Path",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "CURL_CA_BUNDLE",
  "REQUESTS_CA_BUNDLE",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "PATHEXT",
  "npm_execpath",
] as const;

export function buildRecordingChildEnvironment(
  ambient: Readonly<Record<string, string | undefined>>,
  overrides: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const isolated = Object.fromEntries(
    Object.keys(ambient).map((key) => [key, undefined]),
  ) as Record<string, string | undefined>;
  for (const key of RECORDING_CHILD_ENV_PASSTHROUGH_KEYS) {
    if (ambient[key] !== undefined) isolated[key] = ambient[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    isolated[key] = value;
  }
  return isolated;
}

export function resolveCorepackHome(
  env: Record<string, string | undefined>,
  originalHome: string,
): string {
  const explicit = env.COREPACK_HOME?.trim();
  if (explicit) return path.resolve(explicit);
  const cacheRoot = env.XDG_CACHE_HOME?.trim();
  return cacheRoot
    ? path.resolve(cacheRoot, "node", "corepack")
    : path.resolve(originalHome, ".cache", "node", "corepack");
}

export interface DemoCaptureMetrics {
  sourceFrameCount: number;
  usedFallback: boolean;
  durationMs: number;
}

export function requireScreencastCapture(value: {
  sourceFrameCount: number;
  usedFallback: boolean;
  endMs: number;
}): DemoCaptureMetrics {
  if (
    !Number.isSafeInteger(value.sourceFrameCount) ||
    value.sourceFrameCount < 1 ||
    value.usedFallback
  ) {
    throw new Error("demo recording produced no CDP screencast source frame");
  }
  if (!Number.isFinite(value.endMs) || value.endMs < 0) {
    throw new Error("demo recording duration is invalid");
  }
  return {
    sourceFrameCount: value.sourceFrameCount,
    usedFallback: value.usedFallback,
    durationMs: value.endMs,
  };
}

function textFromEvent(value: unknown): string {
  const event = recordValue(value);
  if (!event) return "";
  if (typeof event.text === "string") return event.text;
  if (Array.isArray(event.content))
    return event.content.map(textFromEvent).join("");
  const content = recordValue(event.content);
  if (typeof content?.text === "string") return content.text;
  const update = recordValue(event.update);
  return update ? textFromEvent(update) : "";
}

function eventPayload(value: unknown): JsonRecord | undefined {
  const event = recordValue(value);
  return recordValue(event?.update) ?? event;
}

export function finalAnswerForTurn(
  value: unknown,
  targetTurnId: string,
): string {
  const body = recordValue(value);
  if (!Array.isArray(body?.messages)) return "";
  const events = body.messages.flatMap((rawMessage) => {
    const message = recordValue(rawMessage);
    return message?.sender_kind === "agent" &&
      message.turn_id === targetTurnId &&
      Array.isArray(message.events)
      ? message.events
      : [];
  });
  const finalAnswer = events
    .filter((rawEvent) => {
      const payload = eventPayload(rawEvent);
      return (
        recordValue(recordValue(payload?._meta)?.codex)?.phase ===
        "final_answer"
      );
    })
    .map(textFromEvent)
    .join("");
  if (finalAnswer.length > 0) return finalAnswer;
  let lastToolEventIndex = -1;
  for (const [index, rawEvent] of events.entries()) {
    const update = eventPayload(rawEvent)?.sessionUpdate;
    if (update === "tool_call" || update === "tool_call_update") {
      lastToolEventIndex = index;
    }
  }
  const standardAnswer = events
    .slice(lastToolEventIndex + 1)
    .filter((rawEvent) => {
      const payload = eventPayload(rawEvent);
      return payload?.sessionUpdate === "agent_message_chunk";
    })
    .map(textFromEvent)
    .join("");
  if (standardAnswer.length > 0) return standardAnswer;
  return events
    .filter((rawEvent) => {
      const payload = eventPayload(rawEvent);
      return payload?.type === "text";
    })
    .map(textFromEvent)
    .join("");
}

export function matchesExpectedFinalAnswer(
  answer: string,
  expected: string | undefined,
): boolean {
  if (expected === undefined || answer === expected) return true;
  if (!answer.endsWith(expected)) return false;
  const markerStart = answer.length - expected.length;
  return markerStart > 0 && answer[markerStart - 1] === "\n";
}

export function persistedTurnHasAnswer(
  value: unknown,
  targetTurnId: string,
): boolean {
  return finalAnswerForTurn(value, targetTurnId).length > 0;
}

export interface PiAcpDiagnosticsValidation {
  valid: boolean;
  failure?: string;
  validatedContent?: string;
}

const PI_ACP_DIAGNOSTIC_KEYS = new Set([
  "schemaVersion",
  "layer",
  "method",
  "outcome",
  "toolKind",
  "decisionKind",
  "code",
  "errorKind",
  "httpStatus",
  "retryable",
]);
const PI_ACP_TOOL_KINDS = new Set<unknown>([
  "bundled_clash_mcp",
  "shell",
  "filesystem",
  "other",
]);
const PI_ACP_DECISION_KINDS = new Set<unknown>([
  "allow_always",
  "allow_once",
  "reject_once",
  "cancelled",
  "unrecognized",
]);
const PI_ACP_DIAGNOSTIC_TOKEN = /^[A-Za-z0-9_./:-]{1,120}$/u;

function isPiAcpDiagnosticToken(value: unknown): value is string {
  return typeof value === "string" && PI_ACP_DIAGNOSTIC_TOKEN.test(value);
}

function isValidPiAcpDiagnosticRecord(record: JsonRecord): boolean {
  if (!Object.keys(record).every((key) => PI_ACP_DIAGNOSTIC_KEYS.has(key))) {
    return false;
  }
  if (
    record.schemaVersion !== 1 ||
    record.layer !== "acp" ||
    !isPiAcpDiagnosticToken(record.method) ||
    (record.outcome !== "ok" && record.outcome !== "error")
  ) {
    return false;
  }
  if (
    (record.toolKind !== undefined &&
      !PI_ACP_TOOL_KINDS.has(record.toolKind)) ||
    (record.decisionKind !== undefined &&
      !PI_ACP_DECISION_KINDS.has(record.decisionKind)) ||
    (record.code !== undefined && !Number.isSafeInteger(record.code)) ||
    (record.errorKind !== undefined &&
      !isPiAcpDiagnosticToken(record.errorKind)) ||
    (record.httpStatus !== undefined &&
      (!Number.isSafeInteger(record.httpStatus) ||
        Number(record.httpStatus) < 100 ||
        Number(record.httpStatus) > 599)) ||
    (record.retryable !== undefined && typeof record.retryable !== "boolean")
  ) {
    return false;
  }
  return true;
}

export async function validatePiAcpDiagnostics(
  filePath: string,
): Promise<PiAcpDiagnosticsValidation> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return {
      valid: false,
      failure: "Agent recording did not produce Pi ACP diagnostics",
    };
  }
  if (text.length === 0) {
    return { valid: false, failure: "Agent Pi ACP diagnostics are empty" };
  }

  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  const records: JsonRecord[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      return {
        valid: false,
        failure: "Agent Pi ACP diagnostics contain an empty record",
      };
    }
    try {
      const record = recordValue(JSON.parse(line) as unknown);
      if (!record) {
        return {
          valid: false,
          failure: "Agent Pi ACP diagnostics contain a non-object record",
        };
      }
      if (!isValidPiAcpDiagnosticRecord(record)) {
        return {
          valid: false,
          failure: "Agent Pi ACP diagnostics contain a non-allowlisted record",
        };
      }
      records.push(record);
    } catch {
      return {
        valid: false,
        failure: "Agent Pi ACP diagnostics contain invalid JSON",
      };
    }
  }
  if (records.length === 0) {
    return { valid: false, failure: "Agent Pi ACP diagnostics are empty" };
  }
  const hasSuccessfulMethod = (method: string) =>
    records.some(
      (record) => record.method === method && record.outcome === "ok",
    );
  if (
    !hasSuccessfulMethod("session/new") ||
    !hasSuccessfulMethod("session/prompt")
  ) {
    return {
      valid: false,
      failure:
        "Agent Pi ACP diagnostics lack successful session and prompt records",
    };
  }
  return {
    valid: true,
    validatedContent: `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  };
}

export async function publishValidatedPiAcpDiagnostics(
  sourcePath: string,
  artifactPath: string,
): Promise<PiAcpDiagnosticsValidation> {
  const validation = await validatePiAcpDiagnostics(sourcePath);
  if (!validation.valid || validation.validatedContent === undefined) {
    await rm(artifactPath, { force: true });
    return validation;
  }
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, validation.validatedContent, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(artifactPath, 0o600);
  return validation;
}

function summarizeEntities(
  value: unknown,
  idFrom: (item: JsonRecord) => unknown = (item) => item.id,
): { count: number; ids: string[] } {
  const items = Array.isArray(value) ? value : [];
  return {
    count: items.length,
    ids: items.flatMap((item) => {
      const record = recordValue(item);
      const id = record ? idFrom(record) : undefined;
      return typeof id === "string" && id.trim().length > 0 ? [id] : [];
    }),
  };
}

function structuralText(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return sanitizeArtifactText(value.trim());
}

function structuralOwner(value: unknown): NamedOwnedEntityFact["owner"] {
  const owner = recordValue(value);
  const kind = structuralText(owner?.kind);
  if (!kind) return undefined;
  const canvasId = structuralText(owner?.canvasId);
  const actionNodeId = structuralText(owner?.actionNodeId);
  return {
    kind,
    ...(canvasId ? { canvasId } : {}),
    ...(actionNodeId ? { actionNodeId } : {}),
  };
}

function summarizeCanvasFacts(
  value: unknown,
): ProductReadbackArtifact["canvas"]["facts"] {
  const items = Array.isArray(value) ? value : [];
  return items.flatMap((item) => {
    const node = recordValue(item);
    if (!node) return [];
    const data = recordValue(node.data);
    const id = structuralText(node.id);
    const canvasId = structuralText(node.canvasId ?? node.canvas_id);
    const type = structuralText(node.type);
    const label = structuralText(data?.label);
    return [
      {
        ...(id ? { id } : {}),
        ...(canvasId ? { canvasId } : {}),
        ...(type ? { type } : {}),
        ...(label ? { label } : {}),
      },
    ];
  });
}

function summarizeNamedOwnedFacts(value: unknown): NamedOwnedEntityFact[] {
  const items = Array.isArray(value) ? value : [];
  return items.flatMap((item) => {
    const entity = recordValue(item);
    if (!entity) return [];
    const id = structuralText(entity.id);
    const name = structuralText(entity.name);
    const owner = structuralOwner(entity.owner);
    return [
      {
        ...(id ? { id } : {}),
        ...(name ? { name } : {}),
        ...(owner ? { owner } : {}),
      },
    ];
  });
}

export function summarizeProductReadback(snapshot: {
  canvas: JsonRecord;
  edges: JsonRecord;
  timelines: JsonRecord;
  timelineRenders: JsonRecord;
  directorStages: JsonRecord;
}): ProductReadbackArtifact {
  const canvas = summarizeEntities(snapshot.canvas.nodes);
  const timelines = summarizeEntities(snapshot.timelines.timelines);
  const directorStages = summarizeEntities(snapshot.directorStages.stages);
  return {
    schemaVersion: 1,
    canvas: {
      ...canvas,
      facts: summarizeCanvasFacts(snapshot.canvas.nodes),
    },
    edges: summarizeEntities(snapshot.edges.edges),
    timelines: {
      ...timelines,
      facts: summarizeNamedOwnedFacts(snapshot.timelines.timelines),
    },
    timelineRenders: summarizeEntities(
      snapshot.timelineRenders.renders,
      (render) => recordValue(render.node)?.id ?? render.id,
    ),
    directorStages: {
      ...directorStages,
      facts: summarizeNamedOwnedFacts(snapshot.directorStages.stages),
    },
  };
}
