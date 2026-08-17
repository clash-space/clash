import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  DEMO_WEBSOCKET_INSTRUMENTATION_SOURCE,
  finalAnswerForTurn,
  sanitizeArtifactText,
  summarizeProductReadback,
} from "./runner-support.js";
import * as runnerSupport from "./runner-support.js";

class FakeWebSocket extends EventTarget {
  static readonly instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  readonly sent: unknown[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {}
}

describe("demo runner support", () => {
  it("keeps Vite source frozen for the full async recording startup and restores the runner environment", async () => {
    const withFrozenViteSource = (
      runnerSupport as unknown as {
        withFrozenViteSource?: <T>(operation: () => Promise<T>) => Promise<T>;
      }
    ).withFrozenViteSource;
    const key = "CLASH_WEB_E2E_FREEZE_SOURCE";
    const original = process.env[key];
    const observed: Array<string | undefined> = [];

    assert.equal(typeof withFrozenViteSource, "function");
    if (!withFrozenViteSource) return;
    try {
      process.env[key] = "ambient";
      const result = await withFrozenViteSource(async () => {
        observed.push(process.env[key]);
        await Promise.resolve();
        observed.push(process.env[key]);
        return "vite-started";
      });

      assert.equal(result, "vite-started");
      assert.deepEqual(observed, ["1", "1"]);
      assert.equal(process.env[key], "ambient");
    } finally {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  it("keeps the private agent-browser socket below the Unix path limit", () => {
    const buildRecordingAgentBrowserScope = (
      runnerSupport as unknown as {
        buildRecordingAgentBrowserScope?: (options: {
          temporaryHome: string;
          idleTimeoutMs: number;
        }) => {
          sessionName: string;
          namespace: string;
          environment: Readonly<Record<string, string>>;
        };
      }
    ).buildRecordingAgentBrowserScope;
    const temporaryHome =
      "/var/folders/3s/hynhnqz91bn_vycjd2cdjznm0000gq/T/clash-demo-home-123456";

    assert.equal(typeof buildRecordingAgentBrowserScope, "function");
    if (!buildRecordingAgentBrowserScope) return;
    const scope = buildRecordingAgentBrowserScope({
      temporaryHome,
      idleTimeoutMs: 180_000,
    });
    const socketPath = path.join(
      scope.environment.AGENT_BROWSER_SOCKET_DIR ?? "",
      "namespaces",
      scope.namespace,
      "run",
      `${scope.sessionName}.sock`,
    );

    assert.ok(socketPath.startsWith(`${temporaryHome}${path.sep}`));
    assert.ok(Buffer.byteLength(socketPath) <= 103, socketPath);
    assert.equal(scope.environment.HOME, temporaryHome);
    assert.equal(scope.environment.AGENT_BROWSER_NAMESPACE, scope.namespace);
    assert.equal(scope.environment.AGENT_BROWSER_IDLE_TIMEOUT_MS, "180000");
  });

  it("scopes agent-browser commands to temporary environment overrides and restores the runner environment", () => {
    const withAgentBrowserEnvironment = (
      runnerSupport as unknown as {
        withAgentBrowserEnvironment?: (
          run: (
            args: string[],
            options?: { allowFailure?: boolean },
          ) => string,
          overrides: Readonly<Record<string, string | undefined>>,
        ) => (
          args: string[],
          options?: { allowFailure?: boolean },
        ) => string;
      }
    ).withAgentBrowserEnvironment;
    const key = "CLASH_RECORDING_AGENT_BROWSER_TEST_ENV";
    const original = process.env[key];
    let observed: string | undefined;

    assert.equal(typeof withAgentBrowserEnvironment, "function");
    if (!withAgentBrowserEnvironment) return;
    try {
      delete process.env[key];
      const run = withAgentBrowserEnvironment(
        () => {
          observed = process.env[key];
          return "fixture-result";
        },
        { [key]: "private-case" },
      );

      assert.equal(run(["session", "info", "--json"]), "fixture-result");
      assert.equal(observed, "private-case");
      assert.equal(process.env[key], undefined);
    } finally {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  it("accepts only the matching private agent-browser daemon identity", () => {
    const parseAgentBrowserDaemonIdentity = (
      runnerSupport as unknown as {
        parseAgentBrowserDaemonIdentity?: (
          output: string,
          expected: { session: string; namespace: string },
        ) => { pid: number; session: string; namespace: string };
      }
    ).parseAgentBrowserDaemonIdentity;
    const output = JSON.stringify({
      success: true,
      data: {
        active: true,
        namespace: "clash-demo-private-case",
        pid: 41_234,
        session: "clash-demo-private-session",
      },
    });

    assert.equal(typeof parseAgentBrowserDaemonIdentity, "function");
    if (!parseAgentBrowserDaemonIdentity) return;
    assert.deepEqual(
      parseAgentBrowserDaemonIdentity(output, {
        session: "clash-demo-private-session",
        namespace: "clash-demo-private-case",
      }),
      {
        pid: 41_234,
        session: "clash-demo-private-session",
        namespace: "clash-demo-private-case",
      },
    );
    assert.throws(
      () =>
        parseAgentBrowserDaemonIdentity(output, {
          session: "clash-demo-private-session",
          namespace: "another-case",
        }),
      /does not match the recording case/u,
    );
  });

  it("pins every Electron driver command to the requested CDP endpoint", () => {
    const withAgentBrowserCdp = (
      runnerSupport as unknown as {
        withAgentBrowserCdp?: (
          run: (args: string[], options?: { allowFailure?: boolean }) => string,
          cdpPort: number,
        ) => (args: string[], options?: { allowFailure?: boolean }) => string;
      }
    ).withAgentBrowserCdp;
    const calls: Array<{
      args: string[];
      options: { allowFailure?: boolean } | undefined;
    }> = [];

    assert.equal(typeof withAgentBrowserCdp, "function");
    if (typeof withAgentBrowserCdp !== "function") return;
    const run = withAgentBrowserCdp((args, options) => {
      calls.push({ args, options });
      return "fixture-result";
    }, 51_300);

    assert.equal(
      run(["eval", "location.href"], { allowFailure: true }),
      "fixture-result",
    );
    assert.deepEqual(calls, [
      {
        args: ["--cdp", "51300", "eval", "location.href"],
        options: { allowFailure: true },
      },
    ]);
  });

  it("recognizes the stable Desktop Projects control without a web navigation link", () => {
    const readinessSource = (
      runnerSupport as unknown as {
        DESKTOP_HOME_READINESS_SOURCE?: string;
      }
    ).DESKTOP_HOME_READINESS_SOURCE;

    assert.equal(typeof readinessSource, "string");
    if (typeof readinessSource !== "string") return;

    class FakeHtmlElement {
      disabled = false;

      getBoundingClientRect() {
        return { width: 120, height: 36 };
      }
    }

    const projectsButton = new FakeHtmlElement();
    const document = {
      querySelector(selector: string) {
        return selector ===
          'nav[aria-label="Primary"] button[aria-label="Projects"]'
          ? projectsButton
          : null;
      },
    };
    const runtime = {
      mode: "desktop",
      apiBaseUrl: "http://127.0.0.1:57368",
    };
    const evaluateReadiness = new Function(
      "window",
      "document",
      "HTMLElement",
      "getComputedStyle",
      `return ${readinessSource}`,
    ) as (
      window: { __CLASH_RUNTIME_CONFIG__: typeof runtime },
      document: { querySelector(selector: string): FakeHtmlElement | null },
      HTMLElement: typeof FakeHtmlElement,
      getComputedStyle: () => { display: string; visibility: string },
    ) => unknown;

    assert.deepEqual(
      evaluateReadiness(
        { __CLASH_RUNTIME_CONFIG__: runtime },
        document,
        FakeHtmlElement,
        () => ({ display: "block", visibility: "visible" }),
      ),
      runtime,
    );
  });

  it("waits for both the Agent harness control and composer before driving a turn", () => {
    const readinessSource = (
      runnerSupport as unknown as {
        AGENT_COMPOSER_READINESS_SOURCE?: string;
      }
    ).AGENT_COMPOSER_READINESS_SOURCE;

    assert.equal(typeof readinessSource, "string");
    if (typeof readinessSource !== "string") return;

    class FakeHtmlElement {
      getBoundingClientRect() {
        return { width: 160, height: 40 };
      }
    }

    const harness = new FakeHtmlElement();
    const editor = new FakeHtmlElement();
    const document = {
      querySelector(selector: string) {
        if (selector === '[data-testid="session-harness-config-trigger"]') {
          return harness;
        }
        if (selector === ".milkdown-chat-input [contenteditable='true']") {
          return editor;
        }
        return null;
      },
    };
    const evaluateReadiness = new Function(
      "document",
      "HTMLElement",
      "getComputedStyle",
      `return ${readinessSource}`,
    ) as (
      document: { querySelector(selector: string): FakeHtmlElement | null },
      HTMLElement: typeof FakeHtmlElement,
      getComputedStyle: () => { display: string; visibility: string },
    ) => unknown;

    assert.equal(
      evaluateReadiness(document, FakeHtmlElement, () => ({
        display: "block",
        visibility: "visible",
      })),
      true,
    );
  });

  it("keeps a fit-all recording shot pending until Copilot is collapsed and every expected Canvas node is visible", () => {
    const buildReadinessSource = (
      runnerSupport as unknown as {
        buildCanvasCameraReadinessSource?: (options: {
          mode: "fit-all";
          expectedNodeCount: number;
        }) => string;
      }
    ).buildCanvasCameraReadinessSource;

    assert.equal(typeof buildReadinessSource, "function");
    if (typeof buildReadinessSource !== "function") return;

    type Rect = {
      left: number;
      top: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    };
    class FakeHtmlElement {
      readonly style = { transform: "translate(120px, 80px) scale(1)" };

      constructor(
        private readonly readRect: () => Rect,
        private readonly children: FakeHtmlElement[] = [],
        private readonly viewport: FakeHtmlElement | null = null,
      ) {}

      getBoundingClientRect(): Rect {
        return this.readRect();
      }

      querySelectorAll(selector: string): FakeHtmlElement[] {
        return selector === ".react-flow__node[data-id]" ? this.children : [];
      }

      querySelector(selector: string): FakeHtmlElement | null {
        return selector === ".react-flow__viewport" ? this.viewport : null;
      }
    }

    const rect = (
      left: number,
      top: number,
      right: number,
      bottom: number,
    ): Rect => ({
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    });
    let copilotCollapsed = false;
    let secondNodeRect = rect(700, 120, 1_080, 360);
    const nodes = [
      new FakeHtmlElement(() => rect(120, 120, 420, 360)),
      new FakeHtmlElement(() => secondNodeRect),
    ];
    const viewport = new FakeHtmlElement(() => rect(80, 80, 1_000, 760));
    const flow = new FakeHtmlElement(
      () => rect(80, 80, 1_000, 760),
      nodes,
      viewport,
    );
    const expandCopilot = new FakeHtmlElement(() => rect(1_300, 16, 1_332, 48));
    const window: Record<string, unknown> = {};
    const document = {
      querySelector(selector: string): FakeHtmlElement | null {
        if (selector === "#project-workspace-inset .react-flow") return flow;
        if (
          selector ===
          '[aria-label="Expand AI Copilot"], [aria-label="Expand chat panel"]'
        ) {
          return copilotCollapsed ? expandCopilot : null;
        }
        return null;
      },
    };
    const evaluateReadiness = (expectedNodeCount: number) =>
      new Function(
        "window",
        "document",
        "HTMLElement",
        `return ${buildReadinessSource({ mode: "fit-all", expectedNodeCount })}`,
      )(window, document, FakeHtmlElement) as false | { nodeCount?: number };

    assert.equal(evaluateReadiness(2), false, "open Copilot covers the shot");
    copilotCollapsed = true;
    assert.equal(evaluateReadiness(2), false, "a clipped node is not ready");
    secondNodeRect = rect(600, 120, 920, 360);
    assert.equal(
      evaluateReadiness(3),
      false,
      "a partial Canvas render is not ready",
    );
    assert.equal(
      evaluateReadiness(2),
      false,
      "the first stable geometry sample is not ready",
    );
    const readyCamera = evaluateReadiness(2);
    assert.notEqual(readyCamera, false);
    if (readyCamera !== false) assert.equal(readyCamera.nodeCount, 2);
  });

  it("waits for React Flow's complete Canvas model before invoking fit-all", () => {
    const buildModelReadinessSource = (
      runnerSupport as unknown as {
        buildCanvasModelReadinessSource?: (expectedNodeCount: number) => string;
      }
    ).buildCanvasModelReadinessSource;

    assert.equal(typeof buildModelReadinessSource, "function");
    if (typeof buildModelReadinessSource !== "function") return;

    let minimapNodeCount = 3;
    const document = {
      querySelectorAll(selector: string): unknown[] {
        return selector ===
          "#project-workspace-shell .react-flow__minimap-node"
          ? Array.from({ length: minimapNodeCount })
          : [];
      },
    };
    const evaluateReadiness = new Function(
      "document",
      `return ${buildModelReadinessSource(4)}`,
    ) as (document: { querySelectorAll(selector: string): unknown[] }) =>
      | false
      | { nodeCount?: number };

    assert.equal(evaluateReadiness(document), false);
    minimapNodeCount = 4;
    const readyModel = evaluateReadiness(document);
    assert.notEqual(readyModel, false);
    if (readyModel !== false) assert.equal(readyModel.nodeCount, 4);
  });

  it("applies the fit-all recording preset through visible product controls in transition order", async () => {
    const applyCanvasCameraPreset = (
      runnerSupport as unknown as {
        applyCanvasCameraPreset?: (options: {
          preset: { mode: "fit-all"; expectedNodeCount: number };
          isCopilotCollapsed: () => boolean;
          clickControl: (label: string) => boolean;
          waitForReadiness: (
            source: string,
            label: string,
            timeoutMs: number,
          ) => Promise<unknown>;
        }) => Promise<unknown>;
      }
    ).applyCanvasCameraPreset;

    assert.equal(typeof applyCanvasCameraPreset, "function");
    if (typeof applyCanvasCameraPreset !== "function") return;

    let copilotCollapsed = false;
    let canvasCentered = false;
    const transitions: string[] = [];
    const result = await applyCanvasCameraPreset({
      preset: { mode: "fit-all", expectedNodeCount: 4 },
      isCopilotCollapsed: () => copilotCollapsed,
      clickControl: (label) => {
        transitions.push(`click:${label}`);
        if (label === "Collapse AI Copilot") {
          copilotCollapsed = true;
          return true;
        }
        if (label === "Center view on nodes" && copilotCollapsed) {
          canvasCentered = true;
          return true;
        }
        return false;
      },
      waitForReadiness: async (_source, label) => {
        transitions.push(`wait:${label}`);
        if (label === "complete Canvas model") return { nodeCount: 4 };
        if (label === "collapsed Copilot") return copilotCollapsed;
        if (label === "fit-all Canvas camera") {
          return canvasCentered && copilotCollapsed
            ? { mode: "fit-all", nodeCount: 4 }
            : false;
        }
        return false;
      },
    });

    assert.deepEqual(transitions, [
      "wait:complete Canvas model",
      "click:Collapse AI Copilot",
      "wait:collapsed Copilot",
      "click:Center view on nodes",
      "wait:fit-all Canvas camera",
    ]);
    assert.deepEqual(result, { mode: "fit-all", nodeCount: 4 });
  });

  it("reframes the live Canvas only after completed execute add or attach mutations", () => {
    const shouldReframe = (
      runnerSupport as unknown as {
        shouldReframeLiveCanvas?: (event: {
          type: string;
          status?: string;
          dispatcherMode?: string;
          requestedOperation?: string;
        }) => boolean;
      }
    ).shouldReframeLiveCanvas;

    assert.equal(typeof shouldReframe, "function");
    if (!shouldReframe) return;

    const completedExecute = {
      type: "agent.tool.completed",
      status: "completed",
      dispatcherMode: "execute",
    };
    assert.equal(
      shouldReframe({ ...completedExecute, requestedOperation: "add" }),
      true,
    );
    assert.equal(
      shouldReframe({ ...completedExecute, requestedOperation: "attach" }),
      true,
    );
    for (const requestedOperation of ["create", "get", "list"]) {
      assert.equal(
        shouldReframe({ ...completedExecute, requestedOperation }),
        false,
      );
    }
    assert.equal(
      shouldReframe({
        ...completedExecute,
        type: "agent.tool.failed",
        requestedOperation: "add",
      }),
      false,
    );
    assert.equal(
      shouldReframe({
        ...completedExecute,
        status: "failed",
        requestedOperation: "attach",
      }),
      false,
    );
    assert.equal(
      shouldReframe({
        ...completedExecute,
        dispatcherMode: "contract",
        requestedOperation: "add",
      }),
      false,
    );
  });

  it("accepts a live Canvas model that rendered beyond the current mutation event", () => {
    const buildReadinessSource = (
      runnerSupport as unknown as {
        buildLiveCanvasModelReadinessSource?: (
          minimumNodeCount: number,
        ) => string;
      }
    ).buildLiveCanvasModelReadinessSource;

    assert.equal(typeof buildReadinessSource, "function");
    if (!buildReadinessSource) return;

    let minimapNodeCount = 2;
    const document = {
      querySelectorAll(selector: string): unknown[] {
        return selector ===
          "#project-workspace-shell .react-flow__minimap-node"
          ? Array.from({ length: minimapNodeCount })
          : [];
      },
    };
    const evaluateReadiness = new Function(
      "document",
      `return ${buildReadinessSource(3)}`,
    ) as (document: { querySelectorAll(selector: string): unknown[] }) =>
      | false
      | { nodeCount?: number };

    assert.equal(evaluateReadiness(document), false);
    minimapNodeCount = 4;
    assert.deepEqual(evaluateReadiness(document), { nodeCount: 4 });
  });

  it("waits for visible stable live Canvas geometry while Copilot stays open", () => {
    const buildReadinessSource = (
      runnerSupport as unknown as {
        buildLiveCanvasCameraReadinessSource?: (options: {
          mode: "fit-live";
          minimumNodeCount: number;
        }) => string;
      }
    ).buildLiveCanvasCameraReadinessSource;
    const buildCenteredReadinessSource = (
      runnerSupport as unknown as {
        buildCenteredLiveCanvasCameraReadinessSource?: (options: {
          mode: "fit-live";
          minimumNodeCount: number;
        }) => string;
      }
    ).buildCenteredLiveCanvasCameraReadinessSource;

    assert.equal(typeof buildReadinessSource, "function");
    assert.equal(typeof buildCenteredReadinessSource, "function");
    if (!buildReadinessSource || !buildCenteredReadinessSource) return;

    type Rect = {
      left: number;
      top: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    };
    class FakeHtmlElement {
      readonly style = { transform: "translate(120px, 80px) scale(1)" };

      constructor(
        private readonly readRect: () => Rect,
        private readonly children: FakeHtmlElement[] = [],
        private readonly viewport: FakeHtmlElement | null = null,
      ) {}

      getBoundingClientRect(): Rect {
        return this.readRect();
      }

      querySelectorAll(selector: string): FakeHtmlElement[] {
        return selector === ".react-flow__node[data-id]" ? this.children : [];
      }

      querySelector(selector: string): FakeHtmlElement | null {
        return selector === ".react-flow__viewport" ? this.viewport : null;
      }
    }

    const rect = (
      left: number,
      top: number,
      right: number,
      bottom: number,
    ): Rect => ({
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    });
    let copilotOpen = true;
    let secondNodeRect = rect(700, 120, 1_080, 360);
    const nodes = [
      new FakeHtmlElement(() => rect(120, 120, 420, 360)),
      new FakeHtmlElement(() => secondNodeRect),
    ];
    const viewport = new FakeHtmlElement(() => rect(80, 80, 1_400, 760));
    const flow = new FakeHtmlElement(
      () => rect(80, 80, 1_400, 760),
      nodes,
      viewport,
    );
    const copilot = new FakeHtmlElement(() => rect(1_000, 80, 1_400, 760));
    const window: Record<string, unknown> = {};
    const document = {
      querySelector(selector: string): FakeHtmlElement | null {
        if (selector === "#project-workspace-inset .react-flow") return flow;
        if (selector === "#clash-copilot-panel") {
          return copilotOpen ? copilot : null;
        }
        return null;
      },
    };
    const evaluateReadiness = () =>
      new Function(
        "window",
        "document",
        "HTMLElement",
        `return ${buildReadinessSource({ mode: "fit-live", minimumNodeCount: 2 })}`,
      )(window, document, FakeHtmlElement) as false | { nodeCount?: number };
    const evaluateCenteredReadiness = () =>
      new Function(
        "window",
        "document",
        "HTMLElement",
        `return ${buildCenteredReadinessSource({ mode: "fit-live", minimumNodeCount: 2 })}`,
      )(window, document, FakeHtmlElement) as false | { nodeCount?: number };

    assert.equal(
      evaluateCenteredReadiness(),
      false,
      "the first centered geometry sample is not ready",
    );
    assert.deepEqual(evaluateCenteredReadiness(), {
      mode: "fit-live",
      nodeCount: 2,
    });
    assert.equal(evaluateReadiness(), false, "an occluded node is not ready");
    assert.equal(
      evaluateReadiness(),
      false,
      "stable geometry behind Copilot is still not visible",
    );
    secondNodeRect = rect(600, 120, 920, 360);
    assert.equal(evaluateReadiness(), false, "the first stable sample is not ready");
    assert.deepEqual(evaluateReadiness(), { mode: "fit-live", nodeCount: 2 });
    copilotOpen = false;
    assert.equal(evaluateReadiness(), false, "the live shot requires visible Copilot");
  });

  it("plans a native Canvas pan from the full Flow center into the Copilot-safe area", () => {
    const buildPanPlanSource = (
      runnerSupport as unknown as {
        buildLiveCanvasPanPlanSource?: () => string;
      }
    ).buildLiveCanvasPanPlanSource;

    assert.equal(typeof buildPanPlanSource, "function");
    if (!buildPanPlanSource) return;

    class FakeHtmlElement {
      constructor(
        private readonly bounds: {
          left: number;
          top: number;
          right: number;
          bottom: number;
          width: number;
          height: number;
        },
      ) {}

      getBoundingClientRect() {
        return this.bounds;
      }
    }
    const flow = new FakeHtmlElement({
      left: 192,
      top: 40,
      right: 1_440,
      bottom: 900,
      width: 1_248,
      height: 860,
    });
    const copilot = new FakeHtmlElement({
      left: 952,
      top: 40,
      right: 1_440,
      bottom: 900,
      width: 488,
      height: 860,
    });
    const document = {
      querySelector(selector: string) {
        if (selector === "#project-workspace-inset .react-flow") return flow;
        if (selector === "#clash-copilot-panel") return copilot;
        return null;
      },
    };
    const evaluatePlan = new Function(
      "document",
      "HTMLElement",
      `return ${buildPanPlanSource()}`,
    ) as (
      document: { querySelector(selector: string): FakeHtmlElement | null },
      HTMLElement: typeof FakeHtmlElement,
    ) => unknown;

    assert.deepEqual(evaluatePlan(document, FakeHtmlElement), {
      startX: 572,
      startY: 104,
      endX: 328,
      endY: 104,
    });
  });

  it("applies the live Canvas preset without touching Copilot", async () => {
    const applyLiveCanvasCameraPreset = (
      runnerSupport as unknown as {
        applyLiveCanvasCameraPreset?: (options: {
          preset: { mode: "fit-live"; minimumNodeCount: number };
          clickControl: (label: string) => boolean;
          panToVisibleArea: () => Promise<void>;
          waitForReadiness: (
            source: string,
            label: string,
            timeoutMs: number,
          ) => Promise<unknown>;
        }) => Promise<unknown>;
      }
    ).applyLiveCanvasCameraPreset;

    assert.equal(typeof applyLiveCanvasCameraPreset, "function");
    if (!applyLiveCanvasCameraPreset) return;

    const transitions: string[] = [];
    const result = await applyLiveCanvasCameraPreset({
      preset: { mode: "fit-live", minimumNodeCount: 3 },
      clickControl: (label) => {
        transitions.push(`click:${label}`);
        return label === "Center view on nodes";
      },
      panToVisibleArea: async () => {
        transitions.push("pan:Copilot-safe Canvas area");
      },
      waitForReadiness: async (_source, label) => {
        transitions.push(`wait:${label}`);
        if (label === "live Canvas model") return { nodeCount: 4 };
        if (label === "centered live Canvas camera") {
          return { mode: "fit-live", nodeCount: 4 };
        }
        if (label === "live Canvas camera") {
          return { mode: "fit-live", nodeCount: 4 };
        }
        return false;
      },
    });

    assert.deepEqual(transitions, [
      "wait:live Canvas model",
      "click:Center view on nodes",
      "wait:centered live Canvas camera",
      "pan:Copilot-safe Canvas area",
      "wait:live Canvas camera",
    ]);
    assert.deepEqual(result, { mode: "fit-live", nodeCount: 4 });
  });

  it("applies and verifies the declared CSS-pixel recording viewport", async () => {
    const applyRecordingViewport = (
      runnerSupport as unknown as {
        applyRecordingViewport?: (options: {
          viewport: { width: number; height: number };
          clearDeviceMetrics: () => Promise<unknown>;
          setDeviceMetrics: (
            metrics: Record<string, unknown>,
          ) => Promise<unknown>;
          waitForReadiness: (
            source: string,
            label: string,
            timeoutMs: number,
          ) => Promise<unknown>;
        }) => Promise<unknown>;
      }
    ).applyRecordingViewport;

    assert.equal(typeof applyRecordingViewport, "function");
    if (!applyRecordingViewport) return;

    const transitions: string[] = [];
    let readinessSource = "";
    const result = await applyRecordingViewport({
      viewport: { width: 1_440, height: 900 },
      clearDeviceMetrics: async () => {
        transitions.push("metrics:clear");
      },
      setDeviceMetrics: async (metrics) => {
        transitions.push(`metrics:${JSON.stringify(metrics)}`);
      },
      waitForReadiness: async (source, label, timeoutMs) => {
        readinessSource = source;
        transitions.push(`wait:${label}:${timeoutMs}`);
        return { width: 1_440, height: 900, deviceScaleFactor: 1 };
      },
    });

    assert.deepEqual(transitions, [
      "metrics:clear",
      "wait:native recording viewport:10000",
      'metrics:{"width":1440,"height":900,"deviceScaleFactor":1,"mobile":false}',
      "wait:recording viewport:10000",
    ]);
    assert.deepEqual(result, {
      width: 1_440,
      height: 900,
      deviceScaleFactor: 1,
    });
    const evaluateReadiness = new Function(
      "window",
      `return ${readinessSource}`,
    ) as (window: {
      innerWidth: number;
      innerHeight: number;
      devicePixelRatio: number;
    }) => false | { width: number; height: number; deviceScaleFactor: number };
    assert.equal(
      evaluateReadiness({
        innerWidth: 1_440,
        innerHeight: 882,
        devicePixelRatio: 1,
      }),
      false,
    );
    assert.equal(
      evaluateReadiness({
        innerWidth: 1_440,
        innerHeight: 900,
        devicePixelRatio: 2,
      }),
      false,
    );
    assert.deepEqual(
      evaluateReadiness({
        innerWidth: 1_440,
        innerHeight: 900,
        devicePixelRatio: 1,
      }),
      { width: 1_440, height: 900, deviceScaleFactor: 1 },
    );
  });

  it("holds the final product result for the three-second recording contract", async () => {
    const holdFinalProductResult = (
      runnerSupport as unknown as {
        holdFinalProductResult?: (
          delay: (milliseconds: number) => Promise<void>,
        ) => Promise<void>;
      }
    ).holdFinalProductResult;

    assert.equal(typeof holdFinalProductResult, "function");
    if (!holdFinalProductResult) return;

    const delays: number[] = [];
    await holdFinalProductResult(async (milliseconds) => {
      delays.push(milliseconds);
    });
    assert.deepEqual(delays, [3_000]);
  });

  it("approves only a bundled Clash MCP permission and rejects an untrusted tool", () => {
    const approvalSource = (
      runnerSupport as unknown as {
        TRUSTED_CLASH_PERMISSION_APPROVAL_SOURCE?: string;
      }
    ).TRUSTED_CLASH_PERMISSION_APPROVAL_SOURCE;
    assert.equal(typeof approvalSource, "string");
    if (typeof approvalSource !== "string") return;
    class FakeHtmlElement {
      textContent = "";
      title = "";
      clicked = false;

      click() {
        this.clicked = true;
      }
    }
    const evaluateApproval = new Function(
      "document",
      "HTMLElement",
      `return ${approvalSource}`,
    ) as (
      document: { querySelector(selector: string): FakeHtmlElement | null },
      HTMLElement: typeof FakeHtmlElement,
    ) => string;
    const trustedTitle = new FakeHtmlElement();
    trustedTitle.title = "mcp__clash__clash_canvas";
    const trustedAllow = new FakeHtmlElement();
    trustedAllow.textContent = "Always allow";
    const trustedReject = new FakeHtmlElement();
    trustedReject.textContent = "Reject";
    const trustedCard = Object.assign(new FakeHtmlElement(), {
      querySelector: (selector: string) =>
        selector === "[title]" ? trustedTitle : null,
      querySelectorAll: (selector: string) =>
        selector === "button" ? [trustedReject, trustedAllow] : [],
    });

    assert.equal(
      evaluateApproval(
        {
          querySelector: (selector) =>
            selector === '[data-testid="acp-permission-card"]'
              ? trustedCard
              : null,
        },
        FakeHtmlElement,
      ),
      "approved",
    );
    assert.equal(trustedAllow.clicked, true);
    assert.equal(trustedReject.clicked, false);

    trustedTitle.title = "mcp__clash__clash_composition";
    trustedAllow.clicked = false;
    assert.equal(
      evaluateApproval(
        {
          querySelector: (selector) =>
            selector === '[data-testid="acp-permission-card"]'
              ? trustedCard
              : null,
        },
        FakeHtmlElement,
      ),
      "approved",
      "a new permission rendered into the same card element must still resolve",
    );
    assert.equal(trustedAllow.clicked, true);

    const untrustedTitle = new FakeHtmlElement();
    untrustedTitle.title = "bash";
    const untrustedAllow = new FakeHtmlElement();
    untrustedAllow.textContent = "Always allow bash";
    const untrustedReject = new FakeHtmlElement();
    untrustedReject.textContent = "Reject";
    const untrustedCard = Object.assign(new FakeHtmlElement(), {
      querySelector: (selector: string) =>
        selector === "[title]" ? untrustedTitle : null,
      querySelectorAll: (selector: string) =>
        selector === "button" ? [untrustedReject, untrustedAllow] : [],
    });

    assert.equal(
      evaluateApproval(
        {
          querySelector: (selector) =>
            selector === '[data-testid="acp-permission-card"]'
              ? untrustedCard
              : null,
        },
        FakeHtmlElement,
      ),
      "blocked",
    );
    assert.equal(untrustedAllow.clicked, false);
    assert.equal(untrustedReject.clicked, true);
    assert.equal(
      evaluateApproval({ querySelector: () => null }, FakeHtmlElement),
      "none",
    );
  });

  it("mirrors the product session socket without retaining prompt text", () => {
    FakeWebSocket.instances.length = 0;
    const target = { WebSocket: FakeWebSocket };
    const install = new Function(
      "window",
      `return ${DEMO_WEBSOCKET_INSTRUMENTATION_SOURCE}`,
    ) as (window: typeof target) => {
      drainFrames(): unknown[];
      drainTurnIds(): string[];
      snapshot(): { observerCount: number; openObserverCount: number };
      dispose(): void;
    };
    const instrumentation = install(target);

    const productSocket = new target.WebSocket(
      "ws://127.0.0.1:8789/api/v1/local-sessions/session-1/_stream",
    );
    productSocket.send(
      JSON.stringify({
        type: "prompt",
        turn_id: "turn-target",
        text: "private prompt text",
      }),
    );

    assert.equal(FakeWebSocket.instances.length, 2);
    const observer = FakeWebSocket.instances.find(
      (socket) => socket !== productSocket,
    )!;
    assert.match(observer.url, /_stream\?replay=0$/u);
    assert.deepEqual(instrumentation.snapshot(), {
      observerCount: 1,
      openObserverCount: 0,
      bufferedFrameCount: 0,
      bufferedTurnCount: 1,
    });
    observer.readyState = FakeWebSocket.OPEN;
    observer.dispatchEvent(new Event("open"));
    assert.equal(instrumentation.snapshot().openObserverCount, 1);
    assert.equal(productSocket.sent.length, 1);
    assert.deepEqual(instrumentation.drainTurnIds(), ["turn-target"]);
    assert.doesNotMatch(
      JSON.stringify(instrumentation.snapshot()),
      /private prompt text/u,
    );

    observer.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "session.complete",
          turn_id: "turn-target",
        }),
      }),
    );
    assert.deepEqual(instrumentation.drainFrames(), [
      { type: "session.complete", turn_id: "turn-target" },
    ]);

    instrumentation.dispose();
    const reinstalled = install(target);
    assert.notEqual(reinstalled, instrumentation);
    reinstalled.dispose();
  });

  it("reduces product readback to safe structural facts", () => {
    const summary = summarizeProductReadback({
      canvas: {
        nodes: [
          {
            id: "node-1",
            canvas_id: "main",
            type: "text",
            data: {
              label: "Brief",
              content: "private prompt-derived prose",
              token: "secret-node-value",
            },
          },
        ],
      },
      edges: {
        edges: [{ id: "edge-1", source: "/Users/alice/private-source" }],
      },
      timelines: {
        timelines: [
          {
            id: "timeline-1",
            name: "Signal Garden Cut",
            owner: {
              kind: "canvas-action",
              canvasId: "main",
              actionNodeId: "timeline-action-1",
              rawInput: "private",
            },
            state: { private: true },
          },
        ],
      },
      timelineRenders: {
        renders: [{ node: { id: "render-1", data: { rawOutput: "private" } } }],
      },
      directorStages: {
        stages: [
          {
            id: "stage-1",
            name: "Signal Garden Stage",
            owner: { kind: "project", reasoning: "private" },
            state: { apiKey: "secret-stage-value" },
          },
        ],
      },
    });

    assert.deepEqual(summary, {
      schemaVersion: 1,
      canvas: {
        count: 1,
        ids: ["node-1"],
        facts: [
          {
            id: "node-1",
            canvasId: "main",
            type: "text",
            label: "Brief",
          },
        ],
      },
      edges: { count: 1, ids: ["edge-1"] },
      timelines: {
        count: 1,
        ids: ["timeline-1"],
        facts: [
          {
            id: "timeline-1",
            name: "Signal Garden Cut",
            owner: {
              kind: "canvas-action",
              canvasId: "main",
              actionNodeId: "timeline-action-1",
            },
          },
        ],
      },
      timelineRenders: { count: 1, ids: ["render-1"] },
      directorStages: {
        count: 1,
        ids: ["stage-1"],
        facts: [
          {
            id: "stage-1",
            name: "Signal Garden Stage",
            owner: { kind: "project" },
          },
        ],
      },
    });
    assert.doesNotMatch(
      JSON.stringify(summary),
      /private prompt-derived prose|secret-node-value|secret-stage-value|rawInput|reasoning|rawOutput|Users\/alice/u,
    );
  });

  it("reads the final answer only from the target turn", () => {
    const answer = finalAnswerForTurn(
      {
        messages: [
          {
            sender_kind: "agent",
            turn_id: "historical-turn",
            events: [{ type: "text", text: "DEMO_READY" }],
          },
          {
            sender_kind: "agent",
            turn_id: "target-turn",
            events: [
              { type: "text", text: "internal summary" },
              {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "TARGET_READY" },
                _meta: { codex: { phase: "final_answer" } },
              },
            ],
          },
        ],
      },
      "target-turn",
    );

    assert.equal(answer, "TARGET_READY");
  });

  it("uses standard Pi assistant chunks without treating thought as a final answer", () => {
    const answer = finalAnswerForTurn(
      {
        messages: [
          {
            sender_kind: "agent",
            turn_id: "pi-turn",
            events: [
              {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: "private reasoning" },
              },
              {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "DEMO_" },
              },
              {
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "READY" },
                },
              },
            ],
          },
        ],
      },
      "pi-turn",
    );

    assert.equal(answer, "DEMO_READY");
  });

  it("treats only the post-tool Pi message segment as the final answer", () => {
    const answer = finalAnswerForTurn(
      {
        messages: [
          {
            sender_kind: "agent",
            turn_id: "pi-turn",
            events: [
              {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "I will inspect the project." },
              },
              {
                sessionUpdate: "tool_call",
                toolCallId: "tool-1",
                title: "Canvas · list",
              },
              {
                sessionUpdate: "tool_call_update",
                toolCallId: "tool-1",
                status: "completed",
              },
              {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: "private reasoning" },
              },
              {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "DEMO_" },
              },
              {
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "READY" },
                },
              },
            ],
          },
        ],
      },
      "pi-turn",
    );

    assert.equal(answer, "DEMO_READY");
  });

  it("rejects an expected final answer when the raw persisted answer has extra whitespace", () => {
    const matchesExpectedFinalAnswer = (
      runnerSupport as unknown as {
        matchesExpectedFinalAnswer?: (
          answer: string,
          expected: string | undefined,
        ) => boolean;
      }
    ).matchesExpectedFinalAnswer;
    const answer = finalAnswerForTurn(
      {
        messages: [
          {
            sender_kind: "agent",
            turn_id: "target-turn",
            events: [
              {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "DEMO_READY\n" },
              },
            ],
          },
        ],
      },
      "target-turn",
    );

    assert.equal(typeof matchesExpectedFinalAnswer, "function");
    if (typeof matchesExpectedFinalAnswer !== "function") return;
    assert.equal(matchesExpectedFinalAnswer(answer, "DEMO_READY"), false);
    assert.equal(matchesExpectedFinalAnswer("DEMO_READY", "DEMO_READY"), true);
  });

  it("scores the exact final line independently from preceding visible progress", () => {
    const matchesExpectedFinalAnswer = (
      runnerSupport as unknown as {
        matchesExpectedFinalAnswer?: (
          answer: string,
          expected: string | undefined,
        ) => boolean;
      }
    ).matchesExpectedFinalAnswer;

    assert.equal(typeof matchesExpectedFinalAnswer, "function");
    if (typeof matchesExpectedFinalAnswer !== "function") return;
    assert.equal(
      matchesExpectedFinalAnswer(
        "All requested product state is persisted.\nDEMO_READY",
        "DEMO_READY",
      ),
      true,
    );
    assert.equal(
      matchesExpectedFinalAnswer(
        "All requested product state is persisted.\nDEMO_READY ",
        "DEMO_READY",
      ),
      false,
    );
  });

  it("decouples persisted-turn readiness from final-answer scoring", () => {
    const persistedTurnHasAnswer = (
      runnerSupport as unknown as {
        persistedTurnHasAnswer?: (value: unknown, turnId: string) => boolean;
      }
    ).persistedTurnHasAnswer;
    assert.equal(typeof persistedTurnHasAnswer, "function");
    if (typeof persistedTurnHasAnswer !== "function") return;

    assert.equal(
      persistedTurnHasAnswer(
        {
          messages: [
            {
              sender_kind: "agent",
              turn_id: "target-turn",
              events: [
                {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "NOT_THE_EXPECTED_ANSWER" },
                },
              ],
            },
          ],
        },
        "target-turn",
      ),
      true,
    );
    assert.equal(persistedTurnHasAnswer({ messages: [] }, "target-turn"), false);
  });

  it("accepts Pi diagnostics only with parseable successful session creation and prompt records", async () => {
    const validatePiAcpDiagnostics = (
      runnerSupport as unknown as {
        validatePiAcpDiagnostics?: (filePath: string) => Promise<{
          valid: boolean;
          validatedContent?: string;
        }>;
      }
    ).validatePiAcpDiagnostics;
    const root = await mkdtemp(
      path.join(tmpdir(), "clash-pi-diagnostics-test-"),
    );
    const diagnosticsPath = path.join(root, "pi-acp-diagnostics.jsonl");
    try {
      assert.equal(typeof validatePiAcpDiagnostics, "function");
      if (typeof validatePiAcpDiagnostics !== "function") return;

      assert.equal(
        (await validatePiAcpDiagnostics(diagnosticsPath)).valid,
        false,
      );
      await writeFile(diagnosticsPath, "\n", "utf8");
      assert.equal(
        (await validatePiAcpDiagnostics(diagnosticsPath)).valid,
        false,
      );
      await writeFile(diagnosticsPath, "not-json\n", "utf8");
      assert.equal(
        (await validatePiAcpDiagnostics(diagnosticsPath)).valid,
        false,
      );
      await writeFile(
        diagnosticsPath,
        `${JSON.stringify({
          schemaVersion: 1,
          layer: "acp",
          method: "session/new",
          outcome: "ok",
        })}\n`,
        "utf8",
      );
      assert.equal(
        (await validatePiAcpDiagnostics(diagnosticsPath)).valid,
        false,
      );
      await writeFile(
        diagnosticsPath,
        [
          JSON.stringify({
            schemaVersion: 1,
            layer: "acp",
            method: "session/new",
            outcome: "ok",
          }),
          JSON.stringify({
            schemaVersion: 1,
            layer: "acp",
            method: "session/prompt",
            outcome: "error",
          }),
        ].join("\n") + "\n",
        "utf8",
      );
      assert.equal(
        (await validatePiAcpDiagnostics(diagnosticsPath)).valid,
        false,
      );
      await writeFile(
        diagnosticsPath,
        [
          JSON.stringify({
            schemaVersion: 1,
            layer: "acp",
            method: "session/new",
            outcome: "ok",
          }),
          JSON.stringify({
            schemaVersion: 1,
            layer: "acp",
            method: "session/prompt",
            outcome: "ok",
          }),
        ].join("\n") + "\n",
        "utf8",
      );
      assert.deepEqual(await validatePiAcpDiagnostics(diagnosticsPath), {
        valid: true,
        validatedContent:
          `${JSON.stringify({
            schemaVersion: 1,
            layer: "acp",
            method: "session/new",
            outcome: "ok",
          })}\n` +
          `${JSON.stringify({
            schemaVersion: 1,
            layer: "acp",
            method: "session/prompt",
            outcome: "ok",
          })}\n`,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects Pi diagnostics when either required record contains non-allowlisted sensitive fields", async () => {
    const validatePiAcpDiagnostics = (
      runnerSupport as unknown as {
        validatePiAcpDiagnostics?: (filePath: string) => Promise<{
          valid: boolean;
        }>;
      }
    ).validatePiAcpDiagnostics;
    const root = await mkdtemp(
      path.join(tmpdir(), "clash-pi-diagnostics-test-"),
    );
    const diagnosticsPath = path.join(root, "pi-acp-diagnostics.jsonl");
    const leakCases = [
      { recordIndex: 0, key: "token", value: "fixture-secret-token" },
      {
        recordIndex: 1,
        key: "rawInput",
        value: { prompt: "fixture-private-prompt" },
      },
      {
        recordIndex: 0,
        key: "cwd",
        value: "/Users/alice/private-project",
      },
    ] as const;

    try {
      assert.equal(typeof validatePiAcpDiagnostics, "function");
      if (typeof validatePiAcpDiagnostics !== "function") return;

      for (const leakCase of leakCases) {
        const records: Array<Record<string, unknown>> = [
          {
            schemaVersion: 1,
            layer: "acp",
            method: "session/new",
            outcome: "ok",
          },
          {
            schemaVersion: 1,
            layer: "acp",
            method: "session/prompt",
            outcome: "ok",
          },
        ];
        records[leakCase.recordIndex]![leakCase.key] = leakCase.value;
        await writeFile(
          diagnosticsPath,
          `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
          "utf8",
        );

        assert.equal(
          (await validatePiAcpDiagnostics(diagnosticsPath)).valid,
          false,
          `must reject non-allowlisted ${leakCase.key}`,
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("publishes only validated diagnostics and removes a stale artifact on rejection", async () => {
    const publishValidatedPiAcpDiagnostics = (
      runnerSupport as unknown as {
        publishValidatedPiAcpDiagnostics?: (
          sourcePath: string,
          artifactPath: string,
        ) => Promise<{ valid: boolean; validatedContent?: string }>;
      }
    ).publishValidatedPiAcpDiagnostics;
    const root = await mkdtemp(
      path.join(tmpdir(), "clash-pi-diagnostics-publish-test-"),
    );
    const sourcePath = path.join(root, "raw.jsonl");
    const artifactPath = path.join(root, "artifact", "diagnostics.jsonl");

    try {
      assert.equal(typeof publishValidatedPiAcpDiagnostics, "function");
      if (typeof publishValidatedPiAcpDiagnostics !== "function") return;
      await mkdir(path.dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, "stale-private-diagnostics\n", "utf8");
      await writeFile(
        sourcePath,
        `${JSON.stringify({
          schemaVersion: 1,
          layer: "acp",
          method: "session/new",
          outcome: "ok",
          rawInput: { prompt: "fixture-private-prompt" },
        })}\n`,
        "utf8",
      );

      assert.equal(
        (await publishValidatedPiAcpDiagnostics(sourcePath, artifactPath))
          .valid,
        false,
      );
      await assert.rejects(readFile(artifactPath, "utf8"), {
        code: "ENOENT",
      });

      const validContent = [
        {
          schemaVersion: 1,
          layer: "acp",
          method: "session/new",
          outcome: "ok",
        },
        {
          schemaVersion: 1,
          layer: "acp",
          method: "session/prompt",
          outcome: "ok",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n");
      await writeFile(sourcePath, `${validContent}\n`, "utf8");

      const published = await publishValidatedPiAcpDiagnostics(
        sourcePath,
        artifactPath,
      );
      assert.equal(published.valid, true);
      assert.equal(await readFile(artifactPath, "utf8"), `${validContent}\n`);
      assert.equal((await stat(artifactPath)).mode & 0o777, 0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("redacts local paths and credentials from persisted failure details", () => {
    const sanitized = sanitizeArtifactText(
      "failed at /Users/alice/private/project with token=top-secret and Bearer abc.def.ghi",
    );

    assert.equal(
      sanitized,
      "failed at [local-path] with token=[redacted] and Bearer [redacted]",
    );
  });

  it("uses the loopback API endpoint published by the Desktop runtime", () => {
    const resolvePublishedRuntimeApiBaseUrl = (
      runnerSupport as unknown as {
        resolvePublishedRuntimeApiBaseUrl?: (value: unknown) => string;
      }
    ).resolvePublishedRuntimeApiBaseUrl;

    assert.equal(typeof resolvePublishedRuntimeApiBaseUrl, "function");
    assert.equal(
      resolvePublishedRuntimeApiBaseUrl?.({
        apiBaseUrl: "http://127.0.0.1:57368",
        configuredPort: 51200,
      }),
      "http://127.0.0.1:57368",
    );
    assert.throws(
      () =>
        resolvePublishedRuntimeApiBaseUrl?.({
          apiBaseUrl: "https://api.example.test",
        }),
      /loopback/u,
    );
  });

  it("keeps Corepack on the original package-manager cache when HOME is isolated", () => {
    const resolveCorepackHome = (
      runnerSupport as unknown as {
        resolveCorepackHome?: (
          env: Record<string, string | undefined>,
          originalHome: string,
        ) => string;
      }
    ).resolveCorepackHome;

    assert.equal(typeof resolveCorepackHome, "function");
    assert.equal(
      resolveCorepackHome?.({ COREPACK_HOME: "/cache/explicit" }, "/home/demo"),
      "/cache/explicit",
    );
    assert.equal(
      resolveCorepackHome?.({ XDG_CACHE_HOME: "/cache/xdg" }, "/home/demo"),
      "/cache/xdg/node/corepack",
    );
    assert.equal(
      resolveCorepackHome?.({}, "/home/demo"),
      "/home/demo/.cache/node/corepack",
    );
  });

  it("shadows the ambient environment while retaining only runtime-safe and explicit values", () => {
    const buildRecordingChildEnvironment = (
      runnerSupport as unknown as {
        buildRecordingChildEnvironment?: (
          ambient: Record<string, string | undefined>,
          overrides: Record<string, string | undefined>,
        ) => Record<string, string | undefined>;
      }
    ).buildRecordingChildEnvironment;
    const ambient = {
      PATH: "/toolchain/bin",
      TMPDIR: "/private/tmp",
      LANG: "zh_CN.UTF-8",
      HTTPS_PROXY: "http://proxy.example.test:8080",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/custom.pem",
      DISPLAY: ":99",
      SystemRoot: "C:\\Windows",
      npm_execpath: "/toolchain/pnpm.cjs",
      HOME: "/Users/alice",
      CODEX_HOME: "/Users/alice/custom-codex",
      CLASH_HOME: "/Users/alice/.clash",
      CLASH_API_URL: "https://cloud.example.test",
      CLASH_E2E_REAL_CODEX: "1",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      GITHUB_TOKEN: "github-secret",
      NPM_TOKEN: "npm-secret",
      npm_config_token: "npm-config-secret",
      OPENAI_API_KEY: "openai-secret",
      ANTHROPIC_API_KEY: "anthropic-secret",
      HILO_API_KEY: "hilo-secret",
      NODE_OPTIONS: "--require /tmp/ambient-hook.cjs",
    };
    const overrides = {
      HOME: "/tmp/recording-home",
      CLASH_HOME: "/tmp/recording-clash",
      COREPACK_ENABLE_NETWORK: "0",
      COREPACK_HOME: "/cache/corepack",
      CLASH_DESKTOP_HOST_STARTUP_TIMEOUT_MS: "60000",
    };

    assert.equal(typeof buildRecordingChildEnvironment, "function");
    const isolated = buildRecordingChildEnvironment?.(ambient, overrides) ?? {};

    for (const key of Object.keys(ambient)) {
      assert.equal(
        Object.hasOwn(isolated, key),
        true,
        `ambient key ${key} must be explicitly shadowed`,
      );
    }
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(isolated).filter(([, value]) => value !== undefined),
      ),
      {
        PATH: "/toolchain/bin",
        TMPDIR: "/private/tmp",
        LANG: "zh_CN.UTF-8",
        HTTPS_PROXY: "http://proxy.example.test:8080",
        NODE_EXTRA_CA_CERTS: "/etc/ssl/custom.pem",
        DISPLAY: ":99",
        SystemRoot: "C:\\Windows",
        npm_execpath: "/toolchain/pnpm.cjs",
        HOME: "/tmp/recording-home",
        CLASH_HOME: "/tmp/recording-clash",
        COREPACK_ENABLE_NETWORK: "0",
        COREPACK_HOME: "/cache/corepack",
        CLASH_DESKTOP_HOST_STARTUP_TIMEOUT_MS: "60000",
      },
    );
    assert.equal(isolated.CODEX_HOME, undefined);
    assert.equal(isolated.OPENAI_API_KEY, undefined);
    assert.equal(isolated.CLASH_E2E_REAL_CODEX, undefined);
  });

  it("prepares an isolated Pi ACP harness without copying ambient packages or credentials into artifacts", async () => {
    const preparePiRecordingEnvironment = (
      runnerSupport as unknown as {
        preparePiRecordingEnvironment?: (options: {
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
        }) => Promise<{
          agentId: string;
          agentLabel: string;
          piAgentDir: string;
        }>;
      }
    ).preparePiRecordingEnvironment;
    const root = await mkdtemp(path.join(tmpdir(), "clash-pi-recording-test-"));
    try {
      const sourcePiAgentDir = path.join(root, "source-agent");
      const temporaryHome = path.join(root, "recording-home");
      const localDataDir = path.join(root, "clash-home", "local-api");
      await mkdir(sourcePiAgentDir, { recursive: true });
      await writeFile(
        path.join(sourcePiAgentDir, "models.json"),
        `${JSON.stringify({
          providers: {
            "anthropic-proxy": {
              baseUrl: "https://provider.example.test",
              apiKey: "fixture-provider-secret",
              models: [{ id: "claude-sonnet-5" }],
            },
          },
        })}\n`,
        "utf8",
      );

      assert.equal(typeof preparePiRecordingEnvironment, "function");
      if (typeof preparePiRecordingEnvironment !== "function") return;
      const prepared = await preparePiRecordingEnvironment({
        sourcePiAgentDir,
        temporaryHome,
        localDataDir,
        nodeExecutable: "/runtime/node",
        piAcpEntryPath: "/runtime/pi-acp.js",
        piAcpProxyPath: "/workspace/pi-acp-proxy.ts",
        tsxImportPath: "/workspace/tsx-loader.mjs",
        diagnosticsPath: "/artifacts/pi-acp-diagnostics.jsonl",
        pidPath: "/runtime/pi-acp-process.json",
        provider: "anthropic-proxy",
        model: "claude-sonnet-5",
        thinkingLevel: "high",
      });

      const piAgentDir = path.join(temporaryHome, ".pi", "agent");
      const clashConfigPath = path.join(
        path.dirname(localDataDir),
        "config.yaml",
      );
      assert.deepEqual(prepared, {
        agentId: "custom-pi",
        agentLabel: "Pi",
        piAgentDir,
      });
      assert.deepEqual(JSON.parse(await readFile(clashConfigPath, "utf8")), {
        version: 1,
        harnesses: {
          enabled: ["custom-pi"],
          agents: {
            Pi: {
              type: "custom",
              command: "/runtime/node",
              args: [
                "--import",
                "/workspace/tsx-loader.mjs",
                "/workspace/pi-acp-proxy.ts",
                "/runtime/pi-acp.js",
              ],
              env: {
                PI_CODING_AGENT_DIR: piAgentDir,
                CLASH_PI_ACP_DIAGNOSTICS_PATH:
                  "/artifacts/pi-acp-diagnostics.jsonl",
                CLASH_PI_ACP_PID_PATH: "/runtime/pi-acp-process.json",
                PI_OFFLINE: "1",
                PI_TELEMETRY: "0",
              },
            },
          },
        },
      });
      assert.deepEqual(
        JSON.parse(
          await readFile(path.join(piAgentDir, "settings.json"), "utf8"),
        ),
        {
          defaultProvider: "anthropic-proxy",
          defaultModel: "claude-sonnet-5",
          defaultThinkingLevel: "high",
          quietStartup: true,
          packages: [],
        },
      );
      assert.match(
        await readFile(path.join(piAgentDir, "models.json"), "utf8"),
        /fixture-provider-secret/u,
      );
      assert.doesNotMatch(
        await readFile(clashConfigPath, "utf8"),
        /fixture-provider-secret/u,
      );
      for (const file of [
        clashConfigPath,
        path.join(piAgentDir, "settings.json"),
        path.join(piAgentDir, "models.json"),
      ]) {
        assert.equal((await stat(file)).mode & 0o777, 0o600);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("finds the selected Agent session instead of accepting a different harness", () => {
    const findRuntimeAgentSessionId = (
      runnerSupport as unknown as {
        findRuntimeAgentSessionId?: (
          value: unknown,
          agentId: string,
        ) => string | undefined;
      }
    ).findRuntimeAgentSessionId;

    assert.equal(typeof findRuntimeAgentSessionId, "function");
    assert.equal(
      findRuntimeAgentSessionId?.(
        {
          sessions: [
            { id: "codex-session", type: "runtime", agentId: "codex-acp" },
            { threadId: "pi-session", type: "runtime", agentId: "custom-pi" },
          ],
        },
        "custom-pi",
      ),
      "pi-session",
    );
    assert.equal(
      findRuntimeAgentSessionId?.(
        {
          sessions: [
            { id: "codex-session", type: "runtime", agentId: "codex-acp" },
          ],
        },
        "custom-pi",
      ),
      undefined,
    );
  });

  it("rejects screenshot fallback as demo recording evidence", () => {
    const requireScreencastCapture = (
      runnerSupport as unknown as {
        requireScreencastCapture?: (value: {
          sourceFrameCount: number;
          usedFallback: boolean;
          endMs: number;
        }) => {
          sourceFrameCount: number;
          usedFallback: boolean;
          durationMs: number;
        };
      }
    ).requireScreencastCapture;

    assert.equal(typeof requireScreencastCapture, "function");
    assert.deepEqual(
      requireScreencastCapture?.({
        sourceFrameCount: 24,
        usedFallback: false,
        endMs: 4_200,
      }),
      { sourceFrameCount: 24, usedFallback: false, durationMs: 4_200 },
    );
    assert.throws(
      () =>
        requireScreencastCapture?.({
          sourceFrameCount: 0,
          usedFallback: true,
          endMs: 1_000,
        }),
      /source frame/iu,
    );
  });
});
