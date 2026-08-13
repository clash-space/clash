import { isDeepStrictEqual } from "node:util";

import {
  DurableRunEngine,
  createDurableRunRecord,
  durableRunIdempotencyKey,
  type DurableOutputStore,
  type DurableProjectPublisher,
  type DurableProviderFailure,
  type DurableProviderStep,
  type DurableRetryPolicy,
  type DurableRunAdvanceResult,
  type DurableRunClock,
  type DurableRunIdentity,
  type DurableRunOperation,
  type DurableRunRecord,
} from "@clash/shared-runtime";
import {
  ExecutablePluginBindingSchema,
  ExecutablePluginJsonValueSchema,
  ExecutablePluginOutputSchema,
  ExecutablePluginReferenceSchema,
  type ExecutablePluginBinding,
  type ExecutablePluginJsonValue,
  type ExecutablePluginReference,
} from "@clash/shared-types";

import type { SqliteDurableRunJournal } from "./durable-run-journal";
import type {
  ProviderPluginExecutor,
  ProviderPluginExecutorRequest,
  ProviderPluginExecutorResponse,
} from "./local-aigc";
import { ProviderPluginHostUnavailableError } from "./local-aigc";

type ProviderKind = ProviderPluginExecutorRequest["kind"];

/** One Host policy shared by every local Provider-backed product surface. */
export const DEFAULT_LOCAL_PROVIDER_RUN_DEADLINE_MS = 30 * 60_000;

export interface FrozenProjectAssetDelivery {
  kind: "project-asset";
  /** Product Action identity used by the output ActionAssetBinding. */
  actionId: string;
  /** Product-facing name to publish after the immutable Resource has been staged. */
  name: string;
  /** Frozen provenance, independent from any Canvas node. */
  prompt?: string;
}

export interface FrozenLocalProviderExecutorInput {
  schemaVersion: 1;
  binding: ExecutablePluginBinding;
  accountId?: string;
  kind: ProviderKind;
  projectId: string;
  nodeId?: string;
  delivery?: FrozenProjectAssetDelivery;
  provider?: string;
  modelEndpoint?: string;
  input: {
    values: Record<string, ExecutablePluginJsonValue>;
    references: ExecutablePluginReference[];
  };
}

export interface LocalDurableRunCreateCommand {
  type: "create";
  actionRunId: string;
  outputSlot: string;
  deadlineAt: number;
  executor: Omit<FrozenLocalProviderExecutorInput, "schemaVersion">;
}

export type LocalDurableRunCoordinatorCommand =
  | LocalDurableRunCreateCommand
  | { type: "advance"; identity: DurableRunIdentity }
  | { type: "recoverable"; now?: number };

export type LocalDurableRunCoordinatorResult =
  | { kind: "created"; run: DurableRunRecord }
  | DurableRunAdvanceResult
  | { kind: "recoverable"; identities: DurableRunIdentity[] };

export interface LocalDurableRunCoordinator {
  /** The single scheduling entry used by local-processor, sync, and restart recovery. */
  coordinate(
    command: LocalDurableRunCoordinatorCommand,
  ): Promise<LocalDurableRunCoordinatorResult>;
}

export interface LocalDurableRunCoordinatorOptions {
  ownerId: string;
  journal: SqliteDurableRunJournal;
  providerPluginExecutor: ProviderPluginExecutor;
  outputStore: DurableOutputStore;
  publisher: DurableProjectPublisher;
  retryPolicy: DurableRetryPolicy;
  clock?: DurableRunClock;
  attemptTimeoutMs?: Partial<Record<DurableRunOperation, number>>;
  deadlineReconciliationTimeoutMs?: number;
  recoveryFinalizationTimeoutMs?: number;
}

class FrozenExecutorInputError extends Error {
  override name = "FrozenExecutorInputError";
}

const PROVIDER_KINDS = new Set<ProviderKind>([
  "image",
  "video",
  "audio",
  "text",
  "model",
]);

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new FrozenExecutorInputError(
      `Frozen Provider executor ${field} must be a non-empty string.`,
    );
  }
  return value;
}

function parseFrozenExecutorInputUnchecked(
  input: unknown,
): FrozenLocalProviderExecutorInput {
  const json = ExecutablePluginJsonValueSchema.parse(input);
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new FrozenExecutorInputError(
      "Frozen Provider executor input must be an object.",
    );
  }
  if (json.schemaVersion !== 1) {
    throw new FrozenExecutorInputError(
      "Frozen Provider executor schemaVersion must be 1.",
    );
  }
  const binding = ExecutablePluginBindingSchema.parse(json.binding);
  if (
    typeof json.kind !== "string" ||
    !PROVIDER_KINDS.has(json.kind as ProviderKind)
  ) {
    throw new FrozenExecutorInputError(
      "Frozen Provider executor kind is not recognized.",
    );
  }
  const executorInput = json.input;
  if (
    !executorInput ||
    typeof executorInput !== "object" ||
    Array.isArray(executorInput)
  ) {
    throw new FrozenExecutorInputError(
      "Frozen Provider executor input.input must be an object.",
    );
  }
  const values = executorInput.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new FrozenExecutorInputError(
      "Frozen Provider executor input.values must be an object.",
    );
  }
  if (!Array.isArray(executorInput.references)) {
    throw new FrozenExecutorInputError(
      "Frozen Provider executor input.references must be an array.",
    );
  }
  const accountId = json.accountId;
  const nodeId = json.nodeId;
  const delivery = json.delivery;
  const provider = json.provider;
  const modelEndpoint = json.modelEndpoint;
  let parsedDelivery: FrozenProjectAssetDelivery | undefined;
  if (delivery !== undefined) {
    if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) {
      throw new FrozenExecutorInputError(
        "Frozen Provider executor delivery must be an object.",
      );
    }
    if (delivery.kind !== "project-asset") {
      throw new FrozenExecutorInputError(
        "Frozen Provider executor delivery kind is not recognized.",
      );
    }
    parsedDelivery = {
      kind: "project-asset",
      actionId: nonEmptyString(delivery.actionId, "delivery.actionId"),
      name: nonEmptyString(delivery.name, "delivery.name"),
      ...(delivery.prompt === undefined
        ? {}
        : { prompt: nonEmptyString(delivery.prompt, "delivery.prompt") }),
    };
  }
  if (nodeId !== undefined && parsedDelivery) {
    throw new FrozenExecutorInputError(
      "Frozen Provider executor cannot target both a Canvas node and a direct Project Asset delivery.",
    );
  }
  return {
    schemaVersion: 1,
    binding,
    ...(accountId === undefined
      ? {}
      : { accountId: nonEmptyString(accountId, "accountId") }),
    kind: json.kind as ProviderKind,
    projectId: nonEmptyString(json.projectId, "projectId"),
    ...(nodeId === undefined
      ? {}
      : { nodeId: nonEmptyString(nodeId, "nodeId") }),
    ...(parsedDelivery ? { delivery: parsedDelivery } : {}),
    ...(provider === undefined
      ? {}
      : { provider: nonEmptyString(provider, "provider") }),
    ...(modelEndpoint === undefined
      ? {}
      : { modelEndpoint: nonEmptyString(modelEndpoint, "modelEndpoint") }),
    input: {
      values: values as Record<string, ExecutablePluginJsonValue>,
      references: executorInput.references.map((reference) =>
        ExecutablePluginReferenceSchema.parse(reference),
      ),
    },
  };
}

function parseFrozenExecutorInput(
  input: unknown,
): FrozenLocalProviderExecutorInput {
  try {
    return parseFrozenExecutorInputUnchecked(input);
  } catch (error) {
    if (error instanceof FrozenExecutorInputError) throw error;
    throw new FrozenExecutorInputError(
      `Frozen Provider executor input is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function freezeExecutorInput(
  input: LocalDurableRunCreateCommand["executor"],
): FrozenLocalProviderExecutorInput {
  return parseFrozenExecutorInput({ schemaVersion: 1, ...input });
}

function assertSameBinding(
  frozen: ExecutablePluginBinding,
  response: ExecutablePluginBinding,
): void {
  if (
    frozen.pluginId !== response.pluginId ||
    frozen.exportId !== response.exportId ||
    frozen.version !== response.version ||
    frozen.schemaHash !== response.schemaHash
  ) {
    throw new FrozenExecutorInputError(
      `Provider executor binding drifted from ${frozen.pluginId}/${frozen.exportId} ` +
        `${frozen.version}/${frozen.schemaHash}.`,
    );
  }
}

function providerStep(
  run: DurableRunRecord,
  response: ProviderPluginExecutorResponse,
): DurableProviderStep {
  const frozen = parseFrozenExecutorInput(run.executorInput);
  assertSameBinding(frozen.binding, response.binding);
  if (response.status === "failed") {
    return { status: "failed", error: response.error };
  }
  if (response.status === "accepted") {
    return {
      status: "accepted",
      pollState: ExecutablePluginJsonValueSchema.parse(response.pollState),
      ...(response.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: response.retryAfterMs }),
    };
  }
  const output =
    "output" in response
      ? {
          ...response.output,
          slot: run.outputSlot,
        }
      : {
          slot: run.outputSlot,
          kind: "value" as const,
          value: ExecutablePluginJsonValueSchema.parse(response.media),
        };
  return {
    status: "completed",
    outputs: [ExecutablePluginOutputSchema.parse(output)],
  };
}

function providerRequest(
  run: DurableRunRecord,
  idempotencyKey: string,
  now: number,
  pollState?: ExecutablePluginJsonValue,
): ProviderPluginExecutorRequest {
  const frozen = parseFrozenExecutorInput(run.executorInput);
  const attempt = run.activeAttempt;
  if (!attempt) {
    throw new FrozenExecutorInputError(
      "A Provider request requires a checkpointed active attempt.",
    );
  }
  const timeoutMs = Math.max(1, Math.ceil(attempt.expiresAt - now));
  if (!Number.isSafeInteger(timeoutMs)) {
    throw new FrozenExecutorInputError(
      "A Provider request has an invalid remaining attempt budget.",
    );
  }
  return {
    pluginId: frozen.binding.pluginId,
    exportId: frozen.binding.exportId,
    binding: frozen.binding,
    ...(frozen.accountId ? { accountId: frozen.accountId } : {}),
    kind: frozen.kind,
    taskId: idempotencyKey,
    timeoutMs,
    projectId: frozen.projectId,
    ...(frozen.nodeId ? { nodeId: frozen.nodeId } : {}),
    input: frozen.input,
    ...(pollState === undefined ? {} : { pollState }),
  };
}

function classifyThrownError(
  error: unknown,
  operation: DurableRunOperation,
): DurableProviderFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof FrozenExecutorInputError) {
    return {
      code: "contract_violation",
      message,
      retryable: false,
      requestState: operation === "submit" ? "rejected" : "accepted",
    };
  }
  if (/(?:plugin invocation|plugin host IPC).*timed out/i.test(message)) {
    return {
      code: "transport_timeout",
      message,
      retryable: true,
      requestState: operation === "submit" ? "unknown" : "accepted",
    };
  }
  if (error instanceof ProviderPluginHostUnavailableError) {
    return {
      code: "plugin_unavailable",
      message,
      retryable: true,
      requestState: operation === "submit" ? "unknown" : "accepted",
    };
  }
  if (operation === "submit" || operation === "poll") {
    return {
      code: "execution_failed",
      message,
      retryable: false,
      requestState: operation === "submit" ? "unknown" : "accepted",
    };
  }
  return {
    code: operation === "stage"
      ? "output_persistence_failed"
      : "publication_failed",
    message,
    retryable: true,
    requestState: "accepted",
  };
}

function sameCreation(
  existing: DurableRunRecord,
  intended: DurableRunRecord,
): boolean {
  return (
    existing.actionRunId === intended.actionRunId &&
    existing.outputSlot === intended.outputSlot &&
    existing.owner.realm === intended.owner.realm &&
    existing.owner.id === intended.owner.id &&
    existing.deadlineAt === intended.deadlineAt &&
    isDeepStrictEqual(existing.executorInput, intended.executorInput)
  );
}

/**
 * Persist the frozen run before any Provider side effect.
 *
 * HTTP surfaces and Canvas processing both enter the same journal through this helper. It contains
 * no executor, staging, or publication dependency, so a command can durably enqueue work without
 * constructing a second Durable Run Engine or a second polling loop.
 */
export async function createLocalDurableRun(options: {
  ownerId: string;
  journal: SqliteDurableRunJournal;
  command: LocalDurableRunCreateCommand;
  clock?: DurableRunClock;
}): Promise<DurableRunRecord> {
  if (!options.ownerId.trim()) {
    throw new Error("A Local Durable Run creator requires an owner id.");
  }
  const clock = options.clock ?? { now: () => Date.now() };
  const actionRunId = nonEmptyString(
    options.command.actionRunId,
    "actionRunId",
  );
  const outputSlot = nonEmptyString(options.command.outputSlot, "outputSlot");
  const executorInput = freezeExecutorInput(options.command.executor);
  const intended = createDurableRunRecord({
    actionRunId,
    outputSlot,
    owner: { realm: "local", id: options.ownerId },
    executorInput: ExecutablePluginJsonValueSchema.parse(executorInput),
    createdAt: clock.now(),
    deadlineAt: options.command.deadlineAt,
  });
  const identity = { actionRunId, outputSlot };
  const existing = await options.journal.load(identity);
  if (existing) {
    if (!sameCreation(existing, intended)) {
      throw new Error(
        `Durable run ${actionRunId}/${outputSlot} already exists with different frozen input.`,
      );
    }
    return existing;
  }
  try {
    await options.journal.create(intended);
    return intended;
  } catch (error) {
    const raced = await options.journal.load(identity);
    if (raced && sameCreation(raced, intended)) return raced;
    throw error;
  }
}

export function createLocalDurableRunCoordinator(
  options: LocalDurableRunCoordinatorOptions,
): LocalDurableRunCoordinator {
  if (!options.ownerId.trim()) {
    throw new Error("A Local Durable Run coordinator requires an owner id.");
  }
  const clock = options.clock ?? { now: () => Date.now() };
  const engine = new DurableRunEngine({
    journal: options.journal,
    provider: {
      async submit({ run, idempotencyKey }) {
        const response = await options.providerPluginExecutor(
          providerRequest(run, idempotencyKey, clock.now()),
        );
        return providerStep(run, response);
      },
      async poll({ run, pollState }) {
        const idempotencyKey = durableRunIdempotencyKey(run);
        const response = await options.providerPluginExecutor(
          providerRequest(run, idempotencyKey, clock.now(), pollState),
        );
        return providerStep(run, response);
      },
    },
    outputStore: options.outputStore,
    publisher: options.publisher,
    ownerGuard: {
      async assertOwner(run) {
        if (run.owner.realm !== "local" || run.owner.id !== options.ownerId) {
          throw new Error(
            `Durable run ${run.actionRunId}/${run.outputSlot} is owned by ` +
              `${run.owner.realm}/${run.owner.id}, not local/${options.ownerId}.`,
          );
        }
      },
    },
    retryPolicy: options.retryPolicy,
    clock,
    ...(options.attemptTimeoutMs
      ? { attemptTimeoutMs: options.attemptTimeoutMs }
      : {}),
    ...(options.deadlineReconciliationTimeoutMs === undefined
      ? {}
      : {
          deadlineReconciliationTimeoutMs:
            options.deadlineReconciliationTimeoutMs,
        }),
    ...(options.recoveryFinalizationTimeoutMs === undefined
      ? {}
      : {
          recoveryFinalizationTimeoutMs: options.recoveryFinalizationTimeoutMs,
        }),
    classifyThrownError,
  });

  return {
    async coordinate(command) {
      if (command.type === "advance") {
        return engine.advance(command.identity);
      }
      if (command.type === "recoverable") {
        const records = await options.journal.listRecoverable(
          options.ownerId,
          command.now ?? clock.now(),
        );
        return {
          kind: "recoverable",
          identities: records.map(({ actionRunId, outputSlot }) => ({
            actionRunId,
            outputSlot,
          })),
        };
      }

      const run = await createLocalDurableRun({
        ownerId: options.ownerId,
        journal: options.journal,
        command,
        clock,
      });
      return { kind: "created", run };
    },
  };
}
