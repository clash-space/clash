const CASE_DEADLINE_MESSAGE = "Recording case deadline exceeded";
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export class CaseDeadlineError extends Error {
  constructor() {
    super(CASE_DEADLINE_MESSAGE);
    this.name = "CaseDeadlineError";
  }
}

export interface CaseWatchdogResult<T = unknown> {
  status: "stopped" | "timed-out";
  teardownResult?: T;
  teardownError?: unknown;
}

export interface CaseWatchdog<T = unknown> {
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
  readonly completion: Promise<CaseWatchdogResult<T>>;
  stop(): Promise<CaseWatchdogResult<T>>;
  dispose(): Promise<CaseWatchdogResult<T>>;
}

export interface CreateCaseWatchdogOptions<T> {
  timeoutMs: number;
  teardown(): T | PromiseLike<T>;
}

export function createCaseWatchdog<T = void>(
  options: CreateCaseWatchdogOptions<T>,
): CaseWatchdog<T> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError("recording case timeout must be positive and finite");
  }

  const deadlineAt = Date.now() + options.timeoutMs;
  if (!Number.isFinite(deadlineAt)) {
    throw new RangeError("recording case deadline must be finite");
  }

  const controller = new AbortController();
  let state: "armed" | "stopped" | "timed-out" = "armed";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveCompletion!: (result: CaseWatchdogResult<T>) => void;
  const completion = new Promise<CaseWatchdogResult<T>>((resolve) => {
    resolveCompletion = resolve;
  });

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const expire = (): Promise<CaseWatchdogResult<T>> => {
    if (state !== "armed") return completion;
    state = "timed-out";
    clearTimer();
    controller.abort(new CaseDeadlineError());

    let teardownResult: T | PromiseLike<T>;
    try {
      teardownResult = options.teardown();
    } catch (teardownError) {
      resolveCompletion({ status: "timed-out", teardownError });
      return completion;
    }

    void Promise.resolve(teardownResult).then(
      (value) => {
        resolveCompletion({ status: "timed-out", teardownResult: value });
      },
      (teardownError: unknown) => {
        resolveCompletion({ status: "timed-out", teardownError });
      },
    );
    return completion;
  };

  const armTimer = () => {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      void expire();
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      armTimer();
    }, timerDelay(remainingMs));
  };

  const stop = (): Promise<CaseWatchdogResult<T>> => {
    if (state !== "armed") return completion;
    if (Date.now() >= deadlineAt) return expire();
    state = "stopped";
    clearTimer();
    resolveCompletion({ status: "stopped" });
    return completion;
  };

  armTimer();
  return {
    signal: controller.signal,
    deadlineAt,
    completion,
    stop,
    dispose: stop,
  };
}

export interface SettleBeforeCaseDeadlineOptions<T> {
  promise: PromiseLike<T>;
  signal: AbortSignal;
  deadlineAt: number;
}

export function settleBeforeCaseDeadline<T>(
  options: SettleBeforeCaseDeadlineOptions<T>,
): Promise<T> {
  const source = Promise.resolve(options.promise);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      options.signal.removeEventListener("abort", rejectAtDeadline);
    };
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const rejectAtDeadline = () => {
      settle(() => reject(new CaseDeadlineError()));
    };
    const armTimer = () => {
      const remainingMs = options.deadlineAt - Date.now();
      if (remainingMs <= 0) {
        rejectAtDeadline();
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        armTimer();
      }, timerDelay(remainingMs));
    };

    source.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );

    if (!Number.isFinite(options.deadlineAt)) {
      settle(() => reject(new RangeError("case deadline must be finite")));
      return;
    }
    options.signal.addEventListener("abort", rejectAtDeadline, {
      once: true,
    });
    if (options.signal.aborted) {
      rejectAtDeadline();
      return;
    }
    armTimer();
  });
}

function timerDelay(remainingMs: number): number {
  return Math.max(1, Math.min(Math.ceil(remainingMs), MAX_TIMER_DELAY_MS));
}
