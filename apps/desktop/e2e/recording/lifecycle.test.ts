import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createCaseTeardown,
  finalizeRecordingAfterRuntime,
  installSignalTeardown,
  stopChildProcessVerified,
  stopDetachedHost,
  stopRecordedAgentProcesses,
  terminateProcessWithEscalation,
  type ChildProcessHandle,
  type SignalTarget,
} from "./lifecycle.js";
import * as lifecycleModule from "./lifecycle.js";

describe("demo recording lifecycle", () => {
  it("runs teardown steps in order exactly once and continues after a failed step", async () => {
    const calls: string[] = [];
    const hostError = new Error("Host stayed alive");
    const teardown = createCaseTeardown({
      stopElectron: async () => {
        calls.push("Electron");
      },
      stopAgent: async () => {
        calls.push("Agent");
      },
      stopHost: async () => {
        calls.push("Host");
        throw hostError;
      },
      stopWeb: async () => {
        calls.push("Web");
      },
      cleanupWebState: async () => {
        calls.push("temporary state");
      },
      cleanupSensitiveHome: async () => {
        calls.push("sensitive HOME");
      },
    });

    const first = teardown();
    const second = teardown();

    assert.strictEqual(first, second);
    const [firstFailures, secondFailures] = await Promise.all([first, second]);
    assert.deepEqual(calls, [
      "Electron",
      "Agent",
      "Host",
      "Web",
      "temporary state",
      "sensitive HOME",
    ]);
    assert.strictEqual(firstFailures, secondFailures);
    assert.equal(firstFailures.failures.length, 1);
    assert.equal(firstFailures.failures[0]?.label, "Host");
    assert.strictEqual(firstFailures.failures[0]?.error, hostError);
    assert.equal(firstFailures.electronStopped, true);
    assert.equal(firstFailures.agentStopped, true);
    assert.equal(firstFailures.hostStopped, false);
    assert.equal(firstFailures.webStopped, true);
    assert.equal(firstFailures.processesStopped, false);
  });

  it("escalates a timed-out SIGTERM to SIGKILL and verifies the process exited", async () => {
    const calls: string[] = [];
    let waitCount = 0;

    await terminateProcessWithEscalation({
      pid: 42,
      isRunning: () => true,
      sendSignal: (_pid, signal) => {
        calls.push(`signal:${signal}`);
      },
      waitForExit: async (_pid, timeoutMs) => {
        calls.push(`wait:${timeoutMs}`);
        waitCount += 1;
        return waitCount === 2;
      },
      termTimeoutMs: 5_000,
      killTimeoutMs: 2_000,
    });

    assert.deepEqual(calls, [
      "signal:SIGTERM",
      "wait:5000",
      "signal:SIGKILL",
      "wait:2000",
    ]);
  });

  it("fails cleanup when the process remains alive after SIGKILL", async () => {
    const signals: NodeJS.Signals[] = [];

    await assert.rejects(
      terminateProcessWithEscalation({
        pid: 43,
        isRunning: () => true,
        sendSignal: (_pid, signal) => {
          signals.push(signal);
        },
        waitForExit: async () => false,
        termTimeoutMs: 1,
        killTimeoutMs: 1,
      }),
      /still running after SIGKILL/u,
    );
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  });

  it("applies TERM then KILL escalation to the detached Host record", async () => {
    const fixtureDir = await mkdtemp(path.join(tmpdir(), "clash-host-stop-"));
    const hostRecordPath = path.join(fixtureDir, "host.json");
    await writeFile(
      hostRecordPath,
      `${JSON.stringify({ hostId: "fixture-host", pid: 44 })}\n`,
      "utf8",
    );
    const signals: NodeJS.Signals[] = [];
    let running = true;

    try {
      await stopDetachedHost(hostRecordPath, {
        isRunning: () => running,
        sendSignal: (_pid, signal) => {
          signals.push(signal);
          if (signal === "SIGKILL") running = false;
        },
        delay: async () => {},
        termTimeoutMs: 2,
        killTimeoutMs: 2,
        pollIntervalMs: 1,
      });
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }

    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(running, false);
  });

  it("verifies a managed child exit after escalating from TERM to KILL", async () => {
    const child = new FakeChildProcess(45, true);

    await stopChildProcessVerified(child, {
      label: "Electron",
      isRunning: () => child.running,
      delay: async () => {},
      termTimeoutMs: 1,
      killTimeoutMs: 1,
    });

    assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(child.running, false);
  });

  it("rejects a managed child that remains alive after KILL", async () => {
    const child = new FakeChildProcess(46, false);

    await assert.rejects(
      stopChildProcessVerified(child, {
        label: "Web",
        isRunning: () => true,
        delay: async () => {},
        termTimeoutMs: 1,
        killTimeoutMs: 1,
      }),
      /Web process 46 is still running after SIGKILL/u,
    );
    assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  });

  it("escalates an agent-browser daemon that remains alive after its session closes", async () => {
    const stopAgentBrowserDaemon = (
      lifecycleModule as unknown as {
        stopAgentBrowserDaemon?: (options: {
          pid: number;
          closeSession(): void | Promise<void>;
          isRunning(pid: number): boolean;
          sendSignal(pid: number, signal: NodeJS.Signals): void;
          delay(ms: number): Promise<void>;
          closeTimeoutMs: number;
          termTimeoutMs: number;
          killTimeoutMs: number;
          pollIntervalMs: number;
        }) => Promise<void>;
      }
    ).stopAgentBrowserDaemon;
    const events: string[] = [];
    let running = true;

    assert.equal(typeof stopAgentBrowserDaemon, "function");
    if (!stopAgentBrowserDaemon) return;
    await stopAgentBrowserDaemon({
      pid: 47,
      closeSession: () => {
        events.push("close");
      },
      isRunning: () => running,
      sendSignal: (_pid, signal) => {
        events.push(`signal:${signal}`);
        if (signal === "SIGKILL") running = false;
      },
      delay: async (ms) => {
        events.push(`wait:${ms}`);
      },
      closeTimeoutMs: 1,
      termTimeoutMs: 1,
      killTimeoutMs: 1,
      pollIntervalMs: 1,
    });

    assert.deepEqual(events, [
      "close",
      "wait:1",
      "signal:SIGTERM",
      "wait:1",
      "signal:SIGKILL",
    ]);
    assert.equal(running, false);
  });

  it("stops and verifies the recorded Pi child before its proxy", async () => {
    const fixtureDir = await mkdtemp(path.join(tmpdir(), "clash-pi-stop-"));
    const processPath = path.join(fixtureDir, "pi-process.json");
    await writeFile(
      processPath,
      `${JSON.stringify({ proxyPid: 70, childPid: 71 })}\n`,
      "utf8",
    );
    const running = new Set([70, 71]);
    const signals: string[] = [];

    try {
      await stopRecordedAgentProcesses(processPath, {
        isRunning: (pid) => running.has(pid),
        sendSignal: (pid, signal) => {
          signals.push(`${pid}:${signal}`);
          if (signal === "SIGKILL") running.delete(pid);
        },
        delay: async () => {},
        termTimeoutMs: 1,
        killTimeoutMs: 1,
        pollIntervalMs: 1,
      });
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }

    assert.deepEqual(signals, [
      "71:SIGTERM",
      "71:SIGKILL",
      "70:SIGTERM",
      "70:SIGKILL",
    ]);
    assert.deepEqual([...running], []);
  });

  it("still stops the Pi proxy when its child cannot be killed", async () => {
    const fixtureDir = await mkdtemp(path.join(tmpdir(), "clash-pi-stop-"));
    const processPath = path.join(fixtureDir, "pi-process.json");
    await writeFile(
      processPath,
      `${JSON.stringify({ proxyPid: 80, childPid: 81 })}\n`,
      "utf8",
    );
    const signals: string[] = [];
    const running = new Set([80, 81]);

    try {
      await assert.rejects(
        stopRecordedAgentProcesses(processPath, {
          isRunning: (pid) => running.has(pid),
          sendSignal: (pid, signal) => {
            signals.push(`${pid}:${signal}`);
            if (pid === 80 && signal === "SIGTERM") running.delete(pid);
          },
          delay: async () => {},
          termTimeoutMs: 1,
          killTimeoutMs: 1,
          pollIntervalMs: 1,
        }),
        /Pi child process 81 is still running after SIGKILL/u,
      );
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }

    assert.deepEqual(signals, ["81:SIGTERM", "81:SIGKILL", "80:SIGTERM"]);
  });

  it("captures frames, tears down the runtime, then encodes", async () => {
    const calls: string[] = [];
    const teardown = createCaseTeardown({
      stopElectron: async () => {
        calls.push("Electron");
      },
      stopAgent: async () => {
        calls.push("Agent");
      },
      stopHost: async () => {
        calls.push("Host");
      },
      stopWeb: async () => {
        calls.push("Web");
      },
      cleanupWebState: async () => {
        calls.push("temporary state");
      },
      cleanupSensitiveHome: async () => {
        calls.push("sensitive HOME");
      },
    });

    const result = await finalizeRecordingAfterRuntime({
      capture: async () => {
        calls.push("capture");
        return { frames: ["frame-1"] };
      },
      teardown,
      encode: async (recording) => {
        assert.deepEqual(recording, { frames: ["frame-1"] });
        calls.push("encode");
      },
      cleanupCapture: async () => {
        calls.push("cleanup capture");
      },
    });

    assert.deepEqual(calls, [
      "capture",
      "Electron",
      "Agent",
      "Host",
      "Web",
      "temporary state",
      "sensitive HOME",
      "encode",
      "cleanup capture",
    ]);
    assert.equal(result.videoReady, true);
    assert.equal(result.failure, undefined);
  });

  it("preserves the primary failure and skips encoding after cleanup fails", async () => {
    let encodeCalls = 0;
    const teardown = createCaseTeardown({
      stopElectron: async () => {},
      stopAgent: async () => {},
      stopHost: async () => {
        throw new Error("still serving requests");
      },
      stopWeb: async () => {},
      cleanupWebState: async () => {},
      cleanupSensitiveHome: async () => {},
    });

    const result = await finalizeRecordingAfterRuntime({
      initialFailure: "Agent turn timed out",
      capture: async () => ({ frames: ["frame-1"] }),
      teardown,
      encode: async () => {
        encodeCalls += 1;
      },
      cleanupCapture: async () => {},
    });

    assert.equal(encodeCalls, 0);
    assert.equal(
      result.failure,
      "Agent turn timed out; Host cleanup failed: still serving requests",
    );
    assert.equal(result.videoReady, false);
  });

  it("skips encoding when Web shutdown is not verified", async () => {
    let encodeCalls = 0;
    const result = await finalizeRecordingAfterRuntime({
      capture: async () => ({ frames: ["frame-1"] }),
      teardown: createCaseTeardown({
        stopElectron: async () => {},
        stopAgent: async () => {},
        stopHost: async () => {},
        stopWeb: async () => {
          throw new Error("Vite stayed alive");
        },
        cleanupWebState: async () => {},
        cleanupSensitiveHome: async () => {},
      }),
      encode: async () => {
        encodeCalls += 1;
      },
      cleanupCapture: async () => {},
    });

    assert.equal(encodeCalls, 0);
    assert.equal(result.teardown.webStopped, false);
    assert.equal(result.teardown.processesStopped, false);
    assert.equal(result.failure, "Web cleanup failed: Vite stayed alive");
  });

  it("preserves the primary failure when encoding also fails", async () => {
    const result = await finalizeRecordingAfterRuntime({
      initialFailure: "Agent returned incomplete state",
      capture: async () => ({ frames: ["frame-1"] }),
      teardown: createCaseTeardown({
        stopElectron: async () => {},
        stopAgent: async () => {},
        stopHost: async () => {},
        stopWeb: async () => {},
        cleanupWebState: async () => {},
        cleanupSensitiveHome: async () => {},
      }),
      encode: async () => {
        throw new Error("ffmpeg exited 1");
      },
      cleanupCapture: async () => {},
    });

    assert.equal(
      result.failure,
      "Agent returned incomplete state; video encoding failed: ffmpeg exited 1",
    );
    assert.equal(result.videoReady, false);
  });

  it("uses the active idempotent teardown before re-signalling without recursion", async () => {
    const target = new FakeSignalTarget(911);
    const events: string[] = [];
    let releaseCleanup: (() => void) | undefined;
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const teardown = createCaseTeardown({
      stopElectron: async () => {
        events.push("cleanup");
        await cleanupGate;
      },
      stopAgent: async () => {},
      stopHost: async () => {},
      stopWeb: async () => {},
      cleanupWebState: async () => {},
      cleanupSensitiveHome: async () => {},
    });
    const killed = new Promise<void>((resolve) => {
      target.onKill = (_pid, signal) => {
        events.push(`kill:${signal}`);
        target.emit(signal);
        resolve();
      };
    });

    installSignalTeardown({ target, teardown });
    target.emit("SIGTERM");
    target.emit("SIGINT");
    releaseCleanup?.();
    await killed;

    assert.deepEqual(events, ["cleanup", "kill:SIGTERM"]);
    assert.deepEqual(target.kills, [{ pid: 911, signal: "SIGTERM" }]);
    assert.equal(target.listenerCount("SIGINT"), 0);
    assert.equal(target.listenerCount("SIGTERM"), 0);
  });
});

class FakeChildProcess implements ChildProcessHandle {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly pid: number;
  readonly signals: NodeJS.Signals[] = [];
  readonly #exitOnKill: boolean;
  readonly #exitListeners = new Set<
    (code: number | null, signal: NodeJS.Signals | null) => void
  >();

  constructor(pid: number, exitOnKill: boolean) {
    this.pid = pid;
    this.#exitOnKill = exitOnKill;
  }

  get running(): boolean {
    return this.exitCode === null && this.signalCode === null;
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    if (signal === "SIGKILL" && this.#exitOnKill) {
      this.signalCode = signal;
      for (const listener of [...this.#exitListeners]) listener(null, signal);
    }
    return true;
  }

  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) {
    assert.equal(event, "exit");
    const onceListener = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      this.removeListener("exit", onceListener);
      listener(code, signal);
    };
    this.#exitListeners.add(onceListener);
    return this;
  }

  removeListener(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) {
    assert.equal(event, "exit");
    this.#exitListeners.delete(listener);
    return this;
  }
}

class FakeSignalTarget implements SignalTarget {
  readonly kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  readonly pid: number;
  onKill: ((pid: number, signal: NodeJS.Signals) => void) | undefined;
  readonly #listeners = new Map<NodeJS.Signals, Set<() => void>>();

  constructor(pid: number) {
    this.pid = pid;
  }

  on(signal: NodeJS.Signals, listener: () => void) {
    const listeners = this.#listeners.get(signal) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(signal, listeners);
    return this;
  }

  removeListener(signal: NodeJS.Signals, listener: () => void) {
    this.#listeners.get(signal)?.delete(listener);
    return this;
  }

  kill(pid: number, signal: NodeJS.Signals): boolean {
    this.kills.push({ pid, signal });
    this.onKill?.(pid, signal);
    return true;
  }

  emit(signal: NodeJS.Signals): void {
    for (const listener of [...(this.#listeners.get(signal) ?? [])]) {
      listener();
    }
  }

  listenerCount(signal: NodeJS.Signals): number {
    return this.#listeners.get(signal)?.size ?? 0;
  }
}
