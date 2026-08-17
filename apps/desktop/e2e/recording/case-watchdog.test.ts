import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CaseDeadlineError,
  createCaseWatchdog,
  settleBeforeCaseDeadline,
} from "./case-watchdog.js";

const TEST_GUARD_MS = 1_000;

describe("demo recording case watchdog", () => {
  it("rejects a non-positive or non-finite timeout before arming", () => {
    for (const timeoutMs of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_VALUE,
    ]) {
      let armed: ReturnType<typeof createCaseWatchdog> | undefined;
      try {
        assert.throws(() => {
          armed = createCaseWatchdog({
            timeoutMs,
            teardown: async () => {},
          });
        }, RangeError);
      } finally {
        armed?.stop();
      }
    }
  });

  it("aborts the case before invoking teardown when the deadline expires", async () => {
    const events: string[] = [];
    let teardownCalls = 0;
    let signal: AbortSignal | undefined;
    const watchdog = createCaseWatchdog({
      timeoutMs: 20,
      teardown: async () => {
        teardownCalls += 1;
        events.push(`teardown:aborted=${String(signal?.aborted)}`);
      },
    });
    signal = watchdog.signal;
    signal.addEventListener(
      "abort",
      () => {
        events.push("abort");
      },
      { once: true },
    );

    const result = await guard(watchdog.completion);

    assert.deepEqual(events, ["abort", "teardown:aborted=true"]);
    assert.equal(teardownCalls, 1);
    assert.equal(result.status, "timed-out");
    assert.equal(result.teardownError, undefined);
  });

  it("stops without aborting or tearing down a completed case", async () => {
    let teardownCalls = 0;
    const watchdog = createCaseWatchdog({
      timeoutMs: 30,
      teardown: async () => {
        teardownCalls += 1;
      },
    });

    watchdog.stop();
    watchdog.dispose();
    const result = await watchdog.completion;
    await delay(60);

    assert.equal(result.status, "stopped");
    assert.equal(watchdog.signal.aborted, false);
    assert.equal(teardownCalls, 0);
  });

  it("reports teardown failure through completion instead of rejecting it", async () => {
    const teardownError = new Error("fixture teardown failed");
    const watchdog = createCaseWatchdog({
      timeoutMs: 10,
      teardown: async () => {
        throw teardownError;
      },
    });

    const result = await guard(watchdog.completion);

    assert.equal(result.status, "timed-out");
    assert.strictEqual(result.teardownError, teardownError);
  });

  it("preserves a structured teardown result for cleanup inspection", async () => {
    const teardownResult = {
      failures: [{ label: "Host", error: new Error("still running") }],
      processesStopped: false,
    };
    const watchdog = createCaseWatchdog({
      timeoutMs: 10,
      teardown: async () => teardownResult,
    });

    const result = await guard(watchdog.completion);

    assert.equal(result.status, "timed-out");
    assert.strictEqual(result.teardownResult, teardownResult);
  });

  it("rejects a non-cooperative promise at the absolute deadline", async () => {
    const controller = new AbortController();
    const neverSettles = new Promise<never>(() => {});
    const pending = settleBeforeCaseDeadline({
      promise: neverSettles,
      signal: controller.signal,
      deadlineAt: Date.now() + 30,
    });
    const earlyState = await Promise.race([
      pending.then(
        () => "settled",
        () => "settled",
      ),
      delay(5).then(() => "pending"),
    ]);

    assert.equal(earlyState, "pending");
    await assert.rejects(guard(pending), CaseDeadlineError);
  });

  it("uses a fixed safe deadline error instead of an abort reason", async () => {
    const controller = new AbortController();
    const sensitiveReason = new Error("provider-token-fixture");
    const pending = settleBeforeCaseDeadline({
      promise: new Promise<never>(() => {}),
      signal: controller.signal,
      deadlineAt: Date.now() + 500,
    });

    controller.abort(sensitiveReason);

    await assert.rejects(guard(pending), (error: unknown) => {
      assert.ok(error instanceof CaseDeadlineError);
      assert.notStrictEqual(error, sensitiveReason);
      assert.doesNotMatch(error.message, /provider-token-fixture/u);
      return true;
    });
  });

  it("preserves a promise result that settles before the case deadline", async () => {
    const controller = new AbortController();

    const value = await settleBeforeCaseDeadline({
      promise: Promise.resolve("ready"),
      signal: controller.signal,
      deadlineAt: Date.now() + 500,
    });

    assert.equal(value, "ready");
  });
});

async function guard<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("test watchdog did not settle")),
      TEST_GUARD_MS,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
