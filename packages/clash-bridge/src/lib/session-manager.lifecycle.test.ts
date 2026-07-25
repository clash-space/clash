import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpSession, SessionOptions } from "../_acp-runtime/types.js";

const mocks = vi.hoisted(() => ({
  runtimeStart: vi.fn(),
}));

vi.mock("../_acp-runtime/index.js", () => ({
  AcpRuntimeImpl: class {
    start = mocks.runtimeStart;
  },
}));

vi.mock("../_acp-runtime/spawners/node.js", () => ({
  NodeSpawner: class {},
}));

vi.mock("./session-cwd.js", () => ({
  ensureAgentCwd: vi.fn(async () => "/tmp/clash-session-lifecycle"),
  readAgentRuntime: vi.fn(async () => ({ agent_id: "fake-acp" })),
}));

import { SessionManager, type ManagerOut, type SessionStartParams } from "./session-manager.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function sessionParams(sessionId: string): SessionStartParams {
  return {
    session_id: sessionId,
    agent_template_id: "master-clash",
    agent_id: "fake-acp",
    agent_spec: { command: "fake-acp" },
    project_id: "project-lifecycle",
  };
}

function createAcpSession(options: {
  prompt?: AcpSession["prompt"];
  dispose?: AcpSession["dispose"];
} = {}): AcpSession {
  return {
    id: "runtime-session",
    acpSessionId: "acp-session",
    options: { agent: { command: "fake-acp" } } satisfies SessionOptions,
    authMethods: [],
    agentInfo: null,
    configOptions: [],
    modes: undefined,
    promptCapabilities: {},
    supportsSessionFork: false,
    loadedReplayEvents: [],
    drainPendingEvents() {
      return [];
    },
    prompt: options.prompt ?? (async function* () {}),
    async setConfigOption() {
      return [];
    },
    async setMode() {
      return undefined;
    },
    async provideToolResult() {
      return undefined;
    },
    async authenticate() {
      return undefined;
    },
    isAlive() {
      return true;
    },
    dispose: options.dispose ?? (async () => undefined),
  };
}

async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("SessionManager lifecycle", () => {
  beforeEach(() => {
    mocks.runtimeStart.mockReset();
  });

  it("coalesces concurrent starts for one session into one ACP child", async () => {
    const started = deferred<AcpSession>();
    const session = createAcpSession();
    mocks.runtimeStart.mockReturnValue(started.promise);
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-coalesced-start");

    const first = manager.start(params);
    const second = manager.start(params);
    await vi.waitFor(() => expect(mocks.runtimeStart).toHaveBeenCalled());
    await nextTask();
    const startCount = mocks.runtimeStart.mock.calls.length;
    started.resolve(session);
    await Promise.all([first, second]);

    try {
      expect(startCount).toBe(1);
      expect(sent.filter((message) => message.type === "session.ready")).toHaveLength(1);
      expect(sent.some((message) => message.type === "session.error")).toBe(false);
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("lets dispose dominate an in-flight start and reaps the late ACP child", async () => {
    const started = deferred<AcpSession>();
    const dispose = vi.fn(async () => undefined);
    mocks.runtimeStart.mockReturnValue(started.promise);
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-disposed-during-start");

    const starting = manager.start(params);
    await vi.waitFor(() => expect(mocks.runtimeStart).toHaveBeenCalledOnce());
    const disposing = manager.dispose(params.session_id);
    started.resolve(createAcpSession({ dispose }));
    await Promise.all([starting, disposing]);

    try {
      expect(dispose).toHaveBeenCalledOnce();
      expect(manager.has(params.session_id)).toBe(false);
      expect(sent.some((message) => message.type === "session.ready")).toBe(false);
      expect(sent.filter((message) => message.type === "session.disposed")).toHaveLength(1);
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("serializes prompts within one ACP session", async () => {
    const promptReleases: Array<Deferred<void>> = [];
    const promptInputs: unknown[] = [];
    const session = createAcpSession({
      prompt(input) {
        promptInputs.push(input);
        const release = deferred<void>();
        promptReleases.push(release);
        return (async function* () {
          await release.promise;
        })();
      },
    });
    mocks.runtimeStart.mockResolvedValue(session);
    const manager = new SessionManager(() => undefined);
    const params = sessionParams("session-serialized-prompts");
    await manager.start(params);

    const first = manager.prompt({
      session_id: params.session_id,
      turn_id: "turn-1",
      text: "first",
    });
    await vi.waitFor(() => expect(promptInputs).toHaveLength(1));
    const second = manager.prompt({
      session_id: params.session_id,
      turn_id: "turn-2",
      text: "second",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    const concurrentPromptCount = promptInputs.length;
    promptReleases[0]!.resolve();
    await vi.waitFor(() => expect(promptInputs).toHaveLength(2));
    promptReleases[1]!.resolve();
    await Promise.all([first, second]);

    try {
      expect(concurrentPromptCount).toBe(1);
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("emits no late turn completion after disposal", async () => {
    const promptDone = deferred<void>();
    const session = createAcpSession({
      prompt() {
        return (async function* () {
          await promptDone.promise;
        })();
      },
    });
    mocks.runtimeStart.mockResolvedValue(session);
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-dispose-dominates-turn");
    await manager.start(params);

    const prompting = manager.prompt({
      session_id: params.session_id,
      turn_id: "turn-disposed",
      text: "keep working",
    });
    await nextTask();
    await manager.dispose(params.session_id);
    promptDone.resolve();
    await prompting;

    const disposedAt = sent.findIndex((message) => message.type === "session.disposed");
    expect(disposedAt).toBeGreaterThanOrEqual(0);
    expect(sent.slice(disposedAt + 1)).not.toContainEqual(
      expect.objectContaining({
        type: expect.stringMatching(/^session\.(complete|error)$/),
        turn_id: "turn-disposed",
      }),
    );
  });

  it("keeps disposeAll pending until in-flight starts are reaped", async () => {
    const started = deferred<AcpSession>();
    const dispose = vi.fn(async () => undefined);
    mocks.runtimeStart.mockReturnValue(started.promise);
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-shutdown-during-start");

    const starting = manager.start(params);
    await vi.waitFor(() => expect(mocks.runtimeStart).toHaveBeenCalledOnce());
    let shutdownSettled = false;
    const shutdown = manager.disposeAll().then(() => {
      shutdownSettled = true;
    });
    await nextTask();
    const settledBeforeStartResolved = shutdownSettled;
    started.resolve(createAcpSession({ dispose }));
    await Promise.all([starting, shutdown]);

    expect(settledBeforeStartResolved).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
    expect(manager.has(params.session_id)).toBe(false);
    expect(sent.some((message) => message.type === "session.ready")).toBe(false);
  });
});
