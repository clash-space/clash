import { describe, expect, it } from "vitest";

import {
  DurableRunEngine,
  createBoundedRetryPolicy,
  createDurableRunRecord,
  type DurableProviderStep,
  type DurableRunIdentity,
  type DurableRunJournal,
  type DurableRunRecord,
} from "./durable-run-engine";

class MemoryJournal implements DurableRunJournal {
  readonly records = new Map<string, DurableRunRecord>();
  rejectNextCas = false;

  constructor(run: DurableRunRecord) {
    this.records.set(this.key(run), structuredClone(run));
  }

  key(identity: DurableRunIdentity): string {
    return `${identity.actionRunId}:${identity.outputSlot}`;
  }

  async load(
    identity: DurableRunIdentity,
  ): Promise<DurableRunRecord | undefined> {
    const run = this.records.get(this.key(identity));
    return run ? structuredClone(run) : undefined;
  }

  async compareAndSet(
    identity: DurableRunIdentity,
    expectedRevision: number,
    next: DurableRunRecord,
  ): Promise<boolean> {
    if (this.rejectNextCas) {
      this.rejectNextCas = false;
      return false;
    }
    const key = this.key(identity);
    const current = this.records.get(key);
    if (!current || current.revision !== expectedRevision) return false;
    this.records.set(key, structuredClone(next));
    return true;
  }
}

function fixture(overrides: Partial<DurableRunRecord> = {}): DurableRunRecord {
  return {
    ...createDurableRunRecord({
      actionRunId: "run-1",
      outputSlot: "video",
      owner: { realm: "local", id: "host-1" },
      executorInput: { route: "minimax", accountId: "account-1" },
      createdAt: 1,
      deadlineAt: 30 * 60_000,
    }),
    ...overrides,
  };
}

function harness(input: {
  run?: DurableRunRecord;
  now?: number;
  submit?: (
    idempotencyKey: string,
    run: DurableRunRecord,
  ) => Promise<DurableProviderStep>;
  poll?: (run: DurableRunRecord) => Promise<DurableProviderStep>;
  stage?: (key: string, run: DurableRunRecord) => Promise<unknown>;
  publish?: (key: string, run: DurableRunRecord) => Promise<void>;
  publishFailure?: (failure: unknown) => Promise<void>;
  rejectNextCas?: boolean;
  deadlineReconciliationTimeoutMs?: number;
  recoveryFinalizationTimeoutMs?: number;
}) {
  let now = input.now ?? 10;
  const journal = new MemoryJournal(input.run ?? fixture());
  journal.rejectNextCas = input.rejectNextCas ?? false;
  let submits = 0;
  let polls = 0;
  let failurePublishes = 0;
  const engine = new DurableRunEngine({
    journal,
    clock: { now: () => now },
    ownerGuard: { assertOwner: async () => undefined },
    provider: {
      submit: async ({ idempotencyKey, run }) => {
        submits += 1;
        return (
          input.submit?.(idempotencyKey, run) ?? {
            status: "accepted",
            pollState: { taskId: "provider-task" },
            retryAfterMs: 5_000,
          }
        );
      },
      poll: async ({ run }) => {
        polls += 1;
        return (
          input.poll?.(run) ?? {
            status: "completed",
            outputs: [{ slot: "text", kind: "value", value: "done" }],
          }
        );
      },
    },
    outputStore: {
      stage: async ({ idempotencyKey, run }) => {
        if (!input.stage) return { resourceId: "sha256:result" };
        return (await input.stage(idempotencyKey, run)) as Record<
          string,
          string
        >;
      },
    },
    publisher: {
      publish: async ({ idempotencyKey, run }) =>
        input.publish?.(idempotencyKey, run),
      publishFailure: async ({ failure }) => {
        failurePublishes += 1;
        return input.publishFailure?.(failure);
      },
    },
    retryPolicy: createBoundedRetryPolicy({
      maxFailures: { submit: 2, poll: 2, stage: 2, publish: 2 },
      baseDelayMs: 100,
      maxDelayMs: 1_000,
    }),
    attemptTimeoutMs: {
      submit: 1_000,
      poll: 1_000,
      stage: 1_000,
      publish: 1_000,
    },
    ...(input.deadlineReconciliationTimeoutMs === undefined
      ? {}
      : {
          deadlineReconciliationTimeoutMs:
            input.deadlineReconciliationTimeoutMs,
        }),
    ...(input.recoveryFinalizationTimeoutMs === undefined
      ? {}
      : {
          recoveryFinalizationTimeoutMs: input.recoveryFinalizationTimeoutMs,
        }),
  });
  return {
    engine,
    journal,
    get submits() {
      return submits;
    },
    get polls() {
      return polls;
    },
    get failurePublishes() {
      return failurePublishes;
    },
    setNow(value: number) {
      now = value;
    },
  };
}

describe("DurableRunEngine", () => {
  const identity = { actionRunId: "run-1", outputSlot: "video" } as const;

  it("checkpoints an accepted token and only polls after restart", async () => {
    const firstHost = harness({});

    await expect(firstHost.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: { phase: "submitting" },
    });
    await expect(firstHost.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: { phase: "polling", pollState: { taskId: "provider-task" } },
    });
    expect(firstHost.submits).toBe(1);

    const persisted = await firstHost.journal.load(identity);
    const restarted = harness({ run: persisted, now: 5_010 });
    await expect(restarted.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: { phase: "finalizing" },
    });
    expect(restarted.submits).toBe(0);
    expect(restarted.polls).toBe(1);
  });

  it("retries an expired ambiguous submit with the same idempotency identity", async () => {
    const keys: string[] = [];
    const run = fixture({
      phase: "submitting",
      revision: 3,
      activeAttempt: {
        operation: "submit",
        number: 1,
        startedAt: 10,
        expiresAt: 20,
      },
      attemptCounts: { submit: 1, poll: 0, stage: 0, publish: 0 },
    });
    const test = harness({
      run,
      now: 30,
      submit: async (key) => {
        keys.push(key);
        return {
          status: "accepted",
          pollState: { taskId: "second-upstream-task" },
        };
      },
    });

    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "submitting",
        failure: { code: "transport_timeout", requestState: "unknown" },
      },
    });
    test.setNow(130);

    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: { phase: "polling" },
    });
    expect(test.submits).toBe(1);
    expect(keys).toEqual(["run-1:video"]);
  });

  it("clamps a submit attempt lease to the Run deadline", async () => {
    let expiresAt: number | undefined;
    const test = harness({
      now: 900,
      run: fixture({ phase: "submitting", deadlineAt: 1_000 }),
      submit: async (_key, run) => {
        expiresAt = run.activeAttempt?.expiresAt;
        return {
          status: "accepted",
          pollState: { taskId: "provider-task" },
        };
      },
    });

    await test.engine.advance(identity);

    expect(expiresAt).toBe(1_000);
  });

  it("clamps an ordinary poll attempt lease to the Run deadline", async () => {
    let expiresAt: number | undefined;
    const test = harness({
      now: 900,
      run: fixture({
        phase: "polling",
        pollState: { taskId: "provider-task" },
        deadlineAt: 1_000,
      }),
      poll: async (run) => {
        expiresAt = run.activeAttempt?.expiresAt;
        return {
          status: "accepted",
          pollState: { taskId: "provider-task" },
        };
      },
    });

    await test.engine.advance(identity);

    expect(expiresAt).toBe(1_000);
  });

  it("opens the one recovery window when a pre-deadline poll returns completed just after deadline", async () => {
    let test!: ReturnType<typeof harness>;
    test = harness({
      now: 90,
      run: fixture({
        phase: "polling",
        pollState: { taskId: "completed-at-deadline" },
        deadlineAt: 100,
      }),
      recoveryFinalizationTimeoutMs: 50,
      poll: async () => {
        test.setNow(101);
        return {
          status: "completed",
          outputs: [{ slot: "text", kind: "value", value: "done" }],
        };
      },
    });

    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "finalizing",
        recoveryFinalizationDeadlineAt: 151,
      },
    });
    expect(test.polls).toBe(1);
    expect(test.submits).toBe(0);
  });

  it("performs one conclusive poll after the deadline and then stops", async () => {
    let reconciliationExpiresAt: number | undefined;
    const test = harness({
      now: 200,
      run: fixture({
        phase: "polling",
        pollState: { taskId: "still-running" },
        deadlineAt: 100,
      }),
      deadlineReconciliationTimeoutMs: 75,
      poll: async (run) => {
        reconciliationExpiresAt = run.activeAttempt?.expiresAt;
        return {
          status: "accepted",
          pollState: { taskId: "still-running" },
        };
      },
    });

    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: { deadlineReconciliationPending: true },
    });
    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: { phase: "failed", failure: { code: "deadline_exceeded" } },
    });
    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "terminal",
      run: { projectedAt: expect.any(Number) },
    });
    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "terminal",
    });
    expect(test.polls).toBe(1);
    expect(reconciliationExpiresAt).toBe(275);
  });

  it("never retries the one deadline reconciliation poll when its call fails", async () => {
    const test = harness({
      now: 200,
      run: fixture({
        phase: "polling",
        pollState: { taskId: "still-running" },
        deadlineAt: 100,
      }),
      poll: async () => {
        throw new Error("the final status request lost its connection");
      },
    });

    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: { deadlineReconciliationPending: true },
    });
    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "failed",
        failure: { code: "plugin_unavailable", requestState: "accepted" },
      },
    });
    await test.engine.advance(identity);
    await test.engine.advance(identity);

    expect(test.polls).toBe(1);
  });

  it("does not repeat a claimed deadline reconciliation poll after restart", async () => {
    const test = harness({
      now: 300,
      run: fixture({
        phase: "polling",
        pollState: { taskId: "possibly-queried" },
        deadlineAt: 100,
        deadlineReconciliationPending: true,
        activeAttempt: {
          operation: "poll",
          number: 2,
          startedAt: 200,
          expiresAt: 250,
        },
        attemptCounts: { submit: 1, poll: 2, stage: 0, publish: 0 },
      }),
    });

    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "failed",
        activeAttempt: undefined,
        failure: { code: "transport_timeout", requestState: "accepted" },
      },
    });
    await test.engine.advance(identity);

    expect(test.polls).toBe(0);
  });

  it("enters recovery finalization when the one deadline poll finds completed output", async () => {
    let stages = 0;
    let publishes = 0;
    const test = harness({
      now: 200,
      run: fixture({
        phase: "polling",
        pollState: { taskId: "completed-during-restart" },
        deadlineAt: 100,
      }),
      recoveryFinalizationTimeoutMs: 300,
      poll: async () => ({
        status: "completed",
        outputs: [{ slot: "text", kind: "value", value: "recovered" }],
      }),
      stage: async () => {
        stages += 1;
        return { resourceId: "sha256:recovered" };
      },
      publish: async () => {
        publishes += 1;
      },
    });

    await test.engine.advance(identity);
    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "finalizing",
        recoveryFinalizationDeadlineAt: 500,
      },
    });
    await test.engine.advance(identity);
    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: { phase: "succeeded" },
    });

    expect(test.polls).toBe(1);
    expect(test.submits).toBe(0);
    expect(stages).toBe(1);
    expect(publishes).toBe(1);
  });

  it("shares one persisted recovery deadline across stage and publish after restart", async () => {
    let stageExpiresAt: number | undefined;
    let publishExpiresAt: number | undefined;
    const first = harness({
      now: 200,
      run: fixture({
        phase: "polling",
        pollState: { taskId: "completed-during-restart" },
        deadlineAt: 100,
      }),
      recoveryFinalizationTimeoutMs: 300,
      poll: async () => ({
        status: "completed",
        outputs: [{ slot: "text", kind: "value", value: "recovered" }],
      }),
      stage: async (_key, run) => {
        stageExpiresAt = run.activeAttempt?.expiresAt;
        return { resourceId: "sha256:recovered" };
      },
    });

    await first.engine.advance(identity);
    await first.engine.advance(identity);
    await first.engine.advance(identity);
    const persisted = await first.journal.load(identity);

    const restarted = harness({
      run: persisted,
      now: 300,
      // A restarted Host may have a different default; persisted state must win.
      recoveryFinalizationTimeoutMs: 9_000,
      publish: async (_key, run) => {
        publishExpiresAt = run.activeAttempt?.expiresAt;
      },
    });
    await expect(restarted.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "succeeded",
        recoveryFinalizationDeadlineAt: 500,
      },
    });

    expect(stageExpiresAt).toBe(500);
    expect(publishExpiresAt).toBe(500);
    expect(restarted.submits).toBe(0);
    expect(restarted.polls).toBe(0);
  });

  it("does not extend recovery finalization when a stage retry wakes after its persisted deadline", async () => {
    let stageCalls = 0;
    const first = harness({
      now: 200,
      run: fixture({
        phase: "polling",
        pollState: { taskId: "completed-during-restart" },
        deadlineAt: 100,
      }),
      recoveryFinalizationTimeoutMs: 50,
      poll: async () => ({
        status: "completed",
        outputs: [{ slot: "text", kind: "value", value: "recovered" }],
      }),
      stage: async () => {
        stageCalls += 1;
        throw new Error("local Resource store was temporarily busy");
      },
    });

    await first.engine.advance(identity);
    await first.engine.advance(identity);
    await first.engine.advance(identity);
    const persisted = await first.journal.load(identity);
    expect(persisted).toMatchObject({
      phase: "finalizing",
      recoveryFinalizationDeadlineAt: 250,
      nextAttemptAt: 300,
    });

    const restarted = harness({
      run: persisted,
      now: 300,
      recoveryFinalizationTimeoutMs: 30 * 60_000,
      stage: async () => {
        stageCalls += 1;
        return { resourceId: "sha256:must-not-stage" };
      },
    });
    await expect(restarted.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "failed",
        recoveryFinalizationDeadlineAt: 250,
        failure: {
          code: "output_persistence_failed",
          retryable: false,
          requestState: "accepted",
        },
      },
    });

    expect(stageCalls).toBe(1);
    expect(restarted.submits).toBe(0);
    expect(restarted.polls).toBe(0);
  });

  it("settles late finalizer success in the same advance without opening another attempt", async () => {
    let ordinaryStage!: ReturnType<typeof harness>;
    ordinaryStage = harness({
      now: 90,
      run: fixture({
        phase: "finalizing",
        deadlineAt: 100,
        providerOutputs: [{ slot: "text", kind: "value", value: "done" }],
      }),
      stage: async () => {
        ordinaryStage.setNow(101);
        return { resourceId: "sha256:late-normal" };
      },
    });

    await expect(ordinaryStage.engine.advance(identity)).resolves.toMatchObject(
      {
        kind: "progressed",
        run: {
          phase: "failed",
          failure: { code: "deadline_exceeded", retryable: false },
        },
      },
    );

    let stageRun!: ReturnType<typeof harness>;
    stageRun = harness({
      now: 90,
      run: fixture({
        phase: "finalizing",
        deadlineAt: 50,
        recoveryFinalizationDeadlineAt: 100,
        providerOutputs: [{ slot: "text", kind: "value", value: "done" }],
      }),
      stage: async () => {
        stageRun.setNow(101);
        return { resourceId: "sha256:late" };
      },
    });

    await expect(stageRun.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "failed",
        failure: {
          code: "output_persistence_failed",
          retryable: false,
        },
      },
    });

    let publishRun!: ReturnType<typeof harness>;
    publishRun = harness({
      now: 90,
      run: fixture({
        phase: "finalizing",
        deadlineAt: 50,
        recoveryFinalizationDeadlineAt: 100,
        providerOutputs: [{ slot: "text", kind: "value", value: "done" }],
        stagedOutput: { resourceId: "sha256:done" },
      }),
      publish: async () => {
        publishRun.setNow(101);
      },
    });

    await expect(publishRun.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: { phase: "succeeded", succeededAt: 101, projectedAt: 101 },
    });
  });

  it("does not start ordinary staging after the whole-run deadline", async () => {
    let stages = 0;
    const test = harness({
      now: 200,
      run: fixture({
        phase: "finalizing",
        providerOutputs: [{ slot: "text", kind: "value", value: "done" }],
        deadlineAt: 100,
      }),
      stage: async () => {
        stages += 1;
        return { resourceId: "sha256:late" };
      },
    });

    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: { phase: "failed", failure: { code: "deadline_exceeded" } },
    });

    expect(stages).toBe(0);
  });

  it("treats a poll failure with a pre-acceptance request state as a contract violation", async () => {
    const test = harness({
      run: fixture({
        phase: "polling",
        pollState: { taskId: "accepted-task" },
      }),
      poll: async () => ({
        status: "failed",
        error: {
          code: "transport_error",
          message: "plugin incorrectly forgot the accepted task",
          retryable: true,
          requestState: "rejected",
        },
      }),
    });

    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "failed",
        failure: {
          code: "contract_violation",
          retryable: false,
          requestState: "accepted",
        },
      },
    });
    expect(test.polls).toBe(1);
  });

  it("never resubmits work the Provider says it already accepted", async () => {
    const test = harness({
      run: fixture({ phase: "submitting" }),
      submit: async () => ({
        status: "failed",
        error: {
          code: "provider_unavailable",
          message:
            "The accepted upstream task failed before returning a poll token.",
          retryable: true,
          requestState: "accepted",
        },
      }),
    });

    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "failed",
        failure: { requestState: "accepted" },
      },
    });
    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "terminal",
    });
    expect(test.submits).toBe(1);
  });

  it("retries staging and publishing idempotently after post-effect crashes", async () => {
    const stageKeys: string[] = [];
    const publishKeys: string[] = [];
    let stageCalls = 0;
    let publishCalls = 0;
    const test = harness({
      run: fixture({
        phase: "finalizing",
        providerOutputs: [{ slot: "text", kind: "value", value: "done" }],
      }),
      stage: async (key) => {
        stageCalls += 1;
        stageKeys.push(key);
        if (stageCalls === 1) throw new Error("lost stage response");
        return { resourceId: "sha256:result" };
      },
      publish: async (key) => {
        publishCalls += 1;
        publishKeys.push(key);
        if (publishCalls === 1) throw new Error("lost publish response");
      },
    });

    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "finalizing",
        failure: { code: "output_persistence_failed" },
      },
    });
    test.setNow(110);
    await test.engine.advance(identity);
    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: { phase: "finalizing", failure: { code: "publication_failed" } },
    });
    test.setNow(210);
    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: { phase: "succeeded" },
    });

    expect(stageKeys).toEqual(["run-1:video", "run-1:video"]);
    expect(publishKeys).toEqual(["run-1:video", "run-1:video"]);
  });

  it("does not perform an external effect when the attempt CAS loses", async () => {
    const test = harness({
      run: fixture({ phase: "submitting" }),
      rejectNextCas: true,
    });
    await expect(test.engine.advance(identity)).resolves.toEqual({
      kind: "contended",
    });
    expect(test.submits).toBe(0);
  });

  it("does not publish a terminal failure when its attempt CAS loses", async () => {
    const test = harness({
      run: fixture({
        phase: "failed",
        failedAt: 10,
        failure: {
          code: "provider_failed",
          message: "The accepted Provider task failed.",
          retryable: false,
          requestState: "accepted",
        },
      }),
      rejectNextCas: true,
    });

    await expect(test.engine.advance(identity)).resolves.toEqual({
      kind: "contended",
    });
    expect(test.failurePublishes).toBe(0);
  });

  it("projects a public failure without leaking owner-private Provider diagnostics", async () => {
    let projected: unknown;
    const privateFailure = {
      code: "provider_failed" as const,
      message:
        "request to https://private.provider.test/tasks/secret failed for account acct-private",
      retryable: false,
      requestState: "accepted" as const,
      providerCode: "UPSTREAM_PRIVATE_42",
      details: { responseBody: "private response body" },
    };
    const test = harness({
      run: fixture({ phase: "submitting" }),
      submit: async () => ({ status: "failed", error: privateFailure }),
      publishFailure: async (failure) => {
        projected = failure;
      },
    });

    await test.engine.advance(identity);
    await test.engine.advance(identity);

    await expect(test.journal.load(identity)).resolves.toMatchObject({
      failure: privateFailure,
    });
    expect(projected).toMatchObject({ code: "provider_failed" });
    expect(Object.keys(projected as object).sort()).toEqual([
      "code",
      "message",
    ]);
    expect(JSON.stringify(projected)).not.toMatch(
      /private\.provider|acct-private|UPSTREAM_PRIVATE_42|private response body/i,
    );
  });

  it("expires and retries a claimed terminal-failure publication without replacing the Provider failure", async () => {
    const test = harness({
      now: 30,
      run: fixture({
        phase: "failed",
        failedAt: 10,
        failure: {
          code: "provider_failed",
          message: "The accepted Provider task failed.",
          retryable: false,
          requestState: "accepted",
        },
        activeAttempt: {
          operation: "publish",
          number: 1,
          startedAt: 10,
          expiresAt: 20,
        },
        attemptCounts: { submit: 1, poll: 0, stage: 0, publish: 1 },
      }),
    });

    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "failed",
        activeAttempt: undefined,
        failure: { code: "provider_failed" },
        projectionFailure: { code: "transport_timeout" },
        nextAttemptAt: 130,
      },
    });
    expect(test.failurePublishes).toBe(0);

    test.setNow(130);
    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "terminal",
      run: {
        phase: "failed",
        projectedAt: 130,
        failure: { code: "provider_failed" },
      },
    });
    expect(test.failurePublishes).toBe(1);
  });

  it("uses a separate retry budget when publishing the terminal failure", async () => {
    let calls = 0;
    const test = harness({
      now: 10,
      run: fixture({
        phase: "failed",
        failedAt: 10,
        failure: {
          code: "publication_failed",
          message: "Output publication exhausted its own retry budget.",
          retryable: true,
          requestState: "accepted",
        },
        failureCounts: { submit: 0, poll: 0, stage: 0, publish: 99 },
      }),
      publishFailure: async () => {
        calls += 1;
        if (calls === 1)
          throw new Error("Project replica temporarily unavailable");
      },
    });

    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "progressed",
      run: {
        phase: "failed",
        projectionFailureCount: 1,
        nextAttemptAt: 110,
      },
    });

    test.setNow(110);
    await expect(test.engine.advance(identity)).resolves.toMatchObject({
      kind: "terminal",
      run: { phase: "failed", projectedAt: 110 },
    });
    expect(calls).toBe(2);
  });
});
