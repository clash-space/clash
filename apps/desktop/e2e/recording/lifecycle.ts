import { readFile, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export interface TeardownFailure {
  label: string;
  error: unknown;
}

export interface CaseTeardownResult {
  failures: readonly TeardownFailure[];
  electronStopped: boolean;
  agentStopped: boolean;
  hostStopped: boolean;
  webStopped: boolean;
  processesStopped: boolean;
}

export interface CaseTeardownOperations {
  stopElectron(): void | Promise<void>;
  stopAgent(): void | Promise<void>;
  stopHost(): void | Promise<void>;
  stopWeb(): void | Promise<void>;
  cleanupWebState(): void | Promise<void>;
  cleanupSensitiveHome(): void | Promise<void>;
}

export type CaseTeardown = () => Promise<CaseTeardownResult>;

export function createCaseTeardown(
  operations: CaseTeardownOperations,
): CaseTeardown {
  let running: Promise<CaseTeardownResult> | undefined;

  return () => {
    running ??= (async () => {
      const failures: TeardownFailure[] = [];
      let electronStopped = false;
      let agentStopped = false;
      let hostStopped = false;
      let webStopped = false;
      const steps: Array<{
        label: string;
        run(): void | Promise<void>;
        stopped?: "electron" | "agent" | "host" | "web";
      }> = [
        {
          label: "Electron",
          run: operations.stopElectron,
          stopped: "electron",
        },
        { label: "Agent", run: operations.stopAgent, stopped: "agent" },
        { label: "Host", run: operations.stopHost, stopped: "host" },
        { label: "Web", run: operations.stopWeb, stopped: "web" },
        { label: "temporary state", run: operations.cleanupWebState },
        { label: "sensitive HOME", run: operations.cleanupSensitiveHome },
      ];

      for (const step of steps) {
        try {
          await step.run();
          if (step.stopped === "electron") electronStopped = true;
          if (step.stopped === "agent") agentStopped = true;
          if (step.stopped === "host") hostStopped = true;
          if (step.stopped === "web") webStopped = true;
        } catch (error) {
          failures.push({ label: step.label, error });
        }
      }

      return {
        failures,
        electronStopped,
        agentStopped,
        hostStopped,
        webStopped,
        processesStopped:
          electronStopped && agentStopped && hostStopped && webStopped,
      };
    })();
    return running;
  };
}

export interface ProcessTerminationOptions {
  pid: number;
  label?: string;
  isRunning(pid: number): boolean;
  sendSignal(pid: number, signal: NodeJS.Signals): void;
  waitForExit(pid: number, timeoutMs: number): Promise<boolean>;
  termTimeoutMs: number;
  killTimeoutMs: number;
}

export async function terminateProcessWithEscalation(
  options: ProcessTerminationOptions,
): Promise<void> {
  if (!options.isRunning(options.pid)) return;

  if (!sendSignalUnlessExited(options, "SIGTERM")) return;
  if (
    (await options.waitForExit(options.pid, options.termTimeoutMs)) ||
    !options.isRunning(options.pid)
  ) {
    return;
  }

  if (!sendSignalUnlessExited(options, "SIGKILL")) return;
  if (
    (await options.waitForExit(options.pid, options.killTimeoutMs)) ||
    !options.isRunning(options.pid)
  ) {
    return;
  }

  throw new Error(
    `${options.label ?? "process"} process ${options.pid} is still running after SIGKILL`,
  );
}

function sendSignalUnlessExited(
  options: ProcessTerminationOptions,
  signal: NodeJS.Signals,
): boolean {
  try {
    options.sendSignal(options.pid, signal);
    return true;
  } catch (error) {
    if (!options.isRunning(options.pid)) return false;
    throw error;
  }
}

export interface WaitForProcessExitOptions {
  pid: number;
  timeoutMs: number;
  pollIntervalMs?: number;
  isRunning(pid: number): boolean;
  delay(ms: number): Promise<void>;
}

export async function waitForProcessExit(
  options: WaitForProcessExitOptions,
): Promise<boolean> {
  if (!options.isRunning(options.pid)) return true;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error("process exit poll interval must be positive");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
    throw new Error("process exit timeout must be non-negative");
  }

  let waitedMs = 0;
  while (waitedMs < options.timeoutMs) {
    const delayMs = Math.min(pollIntervalMs, options.timeoutMs - waitedMs);
    await options.delay(delayMs);
    waitedMs += delayMs;
    if (!options.isRunning(options.pid)) return true;
  }
  return !options.isRunning(options.pid);
}

export interface ChildProcessHandle {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  removeListener(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
}

export interface ChildProcessStopOptions {
  label: string;
  isRunning?: (pid: number) => boolean;
  delay?: (ms: number) => Promise<void>;
  termTimeoutMs?: number;
  killTimeoutMs?: number;
}

export async function stopChildProcessVerified(
  child: ChildProcessHandle | undefined,
  options: ChildProcessStopOptions,
): Promise<void> {
  if (!child || childHasExited(child)) return;
  if (!Number.isSafeInteger(child.pid) || Number(child.pid) <= 0) {
    throw new Error(`${options.label} process has no valid PID`);
  }
  const pid = child.pid as number;
  const isRunning =
    options.isRunning ??
    ((candidatePid: number) =>
      !childHasExited(child) && processIsRunning(candidatePid));
  const wait = options.delay ?? delay;

  await terminateProcessWithEscalation({
    pid,
    label: options.label,
    isRunning,
    sendSignal: (_pid, signal) => {
      child.kill(signal);
    },
    waitForExit: (_pid, timeoutMs) => waitForChildExit(child, timeoutMs, wait),
    termTimeoutMs: options.termTimeoutMs ?? 3_000,
    killTimeoutMs: options.killTimeoutMs ?? 2_000,
  });
}

export interface AgentBrowserDaemonStopOptions
  extends DetachedHostStopOptions {
  pid: number;
  closeSession(): void | Promise<void>;
  closeTimeoutMs?: number;
}

export async function stopAgentBrowserDaemon(
  options: AgentBrowserDaemonStopOptions,
): Promise<void> {
  try {
    await options.closeSession();
  } catch {
    // Process verification below is authoritative; a failed IPC close still
    // has a bounded TERM/KILL cleanup path.
  }

  const isRunning = options.isRunning ?? processIsRunning;
  if (!isRunning(options.pid)) return;
  const wait = options.delay ?? delay;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const exitedAfterClose = await waitForProcessExit({
    pid: options.pid,
    timeoutMs: options.closeTimeoutMs ?? 500,
    pollIntervalMs,
    isRunning,
    delay: wait,
  });
  if (exitedAfterClose) return;

  const sendSignal =
    options.sendSignal ??
    ((pid: number, signal: NodeJS.Signals) => {
      process.kill(pid, signal);
    });
  await terminateProcessWithEscalation({
    pid: options.pid,
    label: "agent-browser daemon",
    isRunning,
    sendSignal,
    waitForExit: (pid, timeoutMs) =>
      waitForProcessExit({
        pid,
        timeoutMs,
        pollIntervalMs,
        isRunning,
        delay: wait,
      }),
    termTimeoutMs: options.termTimeoutMs ?? 1_000,
    killTimeoutMs: options.killTimeoutMs ?? 1_000,
  });
}

function childHasExited(child: ChildProcessHandle): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(
  child: ChildProcessHandle,
  timeoutMs: number,
  wait: (ms: number) => Promise<void>,
): Promise<boolean> {
  if (childHasExited(child)) return true;
  let listener:
    ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  const exited = new Promise<boolean>((resolve) => {
    listener = () => resolve(true);
    child.once("exit", listener);
  });
  const result = await Promise.race([
    exited,
    wait(timeoutMs).then(() => false),
  ]);
  if (listener) child.removeListener("exit", listener);
  return result || childHasExited(child);
}

interface DetachedHostRecord {
  hostId: string;
  pid: number;
}

export interface DetachedHostStopOptions {
  isRunning?: (pid: number) => boolean;
  sendSignal?: (pid: number, signal: NodeJS.Signals) => void;
  delay?: (ms: number) => Promise<void>;
  termTimeoutMs?: number;
  killTimeoutMs?: number;
  pollIntervalMs?: number;
}

export async function stopDetachedHost(
  hostRecordPath: string,
  options: DetachedHostStopOptions = {},
): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(hostRecordPath, "utf8")) as unknown;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  if (!isDetachedHostRecord(value)) {
    throw new Error("demo Host discovery record is invalid");
  }

  const isRunning = options.isRunning ?? processIsRunning;
  const sendSignal =
    options.sendSignal ??
    ((pid: number, signal: NodeJS.Signals) => {
      process.kill(pid, signal);
    });
  const wait = options.delay ?? delay;
  const pollIntervalMs = options.pollIntervalMs ?? 50;

  await terminateProcessWithEscalation({
    pid: value.pid,
    label: "demo Host",
    isRunning,
    sendSignal,
    waitForExit: (pid, timeoutMs) =>
      waitForProcessExit({
        pid,
        timeoutMs,
        pollIntervalMs,
        isRunning,
        delay: wait,
      }),
    termTimeoutMs: options.termTimeoutMs ?? 5_000,
    killTimeoutMs: options.killTimeoutMs ?? 2_000,
  });
}

interface RecordedAgentProcessRecord {
  proxyPid: number;
  childPid: number;
}

export type RecordedAgentStopOptions = DetachedHostStopOptions;

export async function stopRecordedAgentProcesses(
  processRecordPath: string,
  options: RecordedAgentStopOptions = {},
): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(processRecordPath, "utf8")) as unknown;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  if (!isRecordedAgentProcessRecord(value)) {
    throw new Error("Pi process lifecycle record is invalid");
  }

  const isRunning = options.isRunning ?? processIsRunning;
  const sendSignal =
    options.sendSignal ??
    ((pid: number, signal: NodeJS.Signals) => {
      process.kill(pid, signal);
    });
  const wait = options.delay ?? delay;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const failures: unknown[] = [];

  for (const target of [
    { pid: value.childPid, label: "Pi child" },
    { pid: value.proxyPid, label: "Pi proxy" },
  ]) {
    try {
      await terminateProcessWithEscalation({
        pid: target.pid,
        label: target.label,
        isRunning,
        sendSignal,
        waitForExit: (pid, timeoutMs) =>
          waitForProcessExit({
            pid,
            timeoutMs,
            pollIntervalMs,
            isRunning,
            delay: wait,
          }),
        termTimeoutMs: options.termTimeoutMs ?? 3_000,
        killTimeoutMs: options.killTimeoutMs ?? 2_000,
      });
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Pi child and proxy cleanup failed");
  }
  await rm(processRecordPath, { force: true });
}

function isDetachedHostRecord(value: unknown): value is DetachedHostRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.hostId === "string" &&
    typeof record.pid === "number" &&
    Number.isSafeInteger(record.pid) &&
    record.pid > 0
  );
}

function isRecordedAgentProcessRecord(
  value: unknown,
): value is RecordedAgentProcessRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.proxyPid === "number" &&
    Number.isSafeInteger(record.proxyPid) &&
    record.proxyPid > 0 &&
    typeof record.childPid === "number" &&
    Number.isSafeInteger(record.childPid) &&
    record.childPid > 0 &&
    record.proxyPid !== record.childPid
  );
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

function errorCode(error: unknown): unknown {
  return error && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
}

export interface RecordingFinalizationOptions<TRecording> {
  initialFailure?: string;
  capture?: () => Promise<TRecording>;
  teardown: CaseTeardown;
  encode?: (recording: TRecording) => Promise<void>;
  cleanupCapture?: () => Promise<void>;
  describeError?: (error: unknown) => string;
}

export interface RecordingFinalizationResult<TRecording> {
  recording?: TRecording;
  videoReady: boolean;
  failure?: string;
  teardown: CaseTeardownResult;
}

export async function finalizeRecordingAfterRuntime<TRecording>(
  options: RecordingFinalizationOptions<TRecording>,
): Promise<RecordingFinalizationResult<TRecording>> {
  const describeError = options.describeError ?? defaultErrorMessage;
  let failure = options.initialFailure;
  let recording: TRecording | undefined;
  let videoReady = false;

  if (options.capture) {
    try {
      recording = await options.capture();
    } catch (error) {
      failure = appendFailure(
        failure,
        "video recording failed",
        describeError(error),
      );
    }
  }

  let teardown: CaseTeardownResult;
  try {
    teardown = await options.teardown();
  } catch (error) {
    teardown = {
      failures: [{ label: "runtime", error }],
      electronStopped: false,
      agentStopped: false,
      hostStopped: false,
      webStopped: false,
      processesStopped: false,
    };
  }
  for (const teardownFailure of teardown.failures) {
    failure = appendFailure(
      failure,
      `${teardownFailure.label} cleanup failed`,
      describeError(teardownFailure.error),
    );
  }

  if (recording !== undefined && options.encode && teardown.processesStopped) {
    try {
      await options.encode(recording);
      videoReady = true;
    } catch (error) {
      failure = appendFailure(
        failure,
        "video encoding failed",
        describeError(error),
      );
    }
  }

  if (options.cleanupCapture) {
    try {
      await options.cleanupCapture();
    } catch (error) {
      failure = appendFailure(
        failure,
        "recording frame cleanup failed",
        describeError(error),
      );
    }
  }

  return { recording, videoReady, failure, teardown };
}

function defaultErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendFailure(
  current: string | undefined,
  label: string,
  message: string,
): string {
  const next = `${label}: ${message}`;
  return current ? `${current}; ${next}` : next;
}

export interface SignalTarget {
  readonly pid: number;
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
  kill(pid: number, signal: NodeJS.Signals): boolean;
}

export interface SignalTeardownOptions {
  target: SignalTarget;
  teardown(): Promise<unknown>;
  onError?: (error: unknown) => void;
}

export function installSignalTeardown(
  options: SignalTeardownOptions,
): () => void {
  const signals = ["SIGINT", "SIGTERM"] as const;
  const listeners = new Map<NodeJS.Signals, () => void>();
  let handling = false;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const [signal, listener] of listeners) {
      options.target.removeListener(signal, listener);
    }
    listeners.clear();
  };

  for (const signal of signals) {
    const listener = () => {
      if (handling) return;
      handling = true;
      void Promise.resolve()
        .then(() => options.teardown())
        .catch((error: unknown) => {
          options.onError?.(error);
        })
        .finally(() => {
          dispose();
          options.target.kill(options.target.pid, signal);
        });
    };
    listeners.set(signal, listener);
    options.target.on(signal, listener);
  }

  return dispose;
}
