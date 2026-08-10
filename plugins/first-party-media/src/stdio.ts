import { falAdapter } from "./fal-adapter";
import { minimaxAdapter } from "./minimax-adapter";
import type { ProviderExecutor } from "./executor-contract";
import { createInterface } from "node:readline";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ExecutablePluginInvocationSchema,
  ExecutablePluginResultSchema,
  type ExecutablePluginInvocation,
  type ExecutablePluginResult,
} from "@clash/shared-types/executable-plugin";

import { falPoll, falSubmit, type FalPollState } from "./fal-executor";
import {
  projectFalH3,
  projectFalMiniMaxMusic3,
  projectFalSeedance2,
  type ProjectorInput,
  type ProviderProjection,
} from "./projectors";

const PROJECTORS: Record<string, (input: ProjectorInput) => ProviderProjection> = {
  "fal-h3": projectFalH3,
  "fal-seedance-2": projectFalSeedance2,
  "fal-minimax-music-3": projectFalMiniMaxMusic3,
};

function projectorInput(invocation: ExecutablePluginInvocation): ProjectorInput {
  return {
    values: invocation.input.values,
    references: invocation.input.references,
  } as ProjectorInput;
}

/**
 * Everything an executor needs from outside itself.
 *
 * Passed in rather than reached for, so a test can drive the whole dispatcher without a network and
 * without a credential. The key arrives from the broker at call time and is never stored here.
 */
export interface ExecutorContext {
  fetch?: typeof globalThis.fetch;
  apiKey?: string;
  endpoint?: string;
  queueBaseUrl?: string;
}

/**
 * One entry per API shape, each answering the same two questions.
 *
 * The dispatch below is the whole of it: no provider gets a branch here, because a branch is where
 * a retry budget, a sleep, or a private idea of "still running" starts. Those were per-plugin
 * decisions once and became eight hand-written loops.
 */
const EXECUTORS: Record<string, ProviderExecutor> = {
  "fal-execute": falAdapter,
  "minimax-execute": minimaxAdapter,
};


function accepted(invocationId: string, pollState: unknown): ExecutablePluginResult {
  return ExecutablePluginResultSchema.parse({
    protocol: "clash.plugin.result/v1",
    invocationId,
    status: "accepted",
    pollState,
  });
}

function readFalPollState(value: unknown): FalPollState {
  const state = value as Partial<FalPollState> | null;
  if (!state || typeof state.requestId !== "string" || typeof state.endpoint !== "string") {
    throw new Error("fal poll state is missing its request id or endpoint.");
  }
  return { requestId: state.requestId, endpoint: state.endpoint };
}

function falKind(invocation: ExecutablePluginInvocation): "image" | "video" | "audio" {
  const declared = invocation.input.values.kind;
  return declared === "video" || declared === "audio" ? declared : "image";
}

export async function handleInvocation(
  input: unknown,
  context: ExecutorContext = {},
): Promise<ExecutablePluginResult> {
  let invocationId = "unknown";
  let executionFailed = false;
  try {
    if (input && typeof input === "object" && "invocationId" in input) {
      invocationId = String((input as { invocationId: unknown }).invocationId);
    }
    const invocation = ExecutablePluginInvocationSchema.parse(input);
    invocationId = invocation.invocationId;
    const executor = EXECUTORS[invocation.target.exportId];
    if (executor) {
      // Anything thrown past this point came from talking to the provider, not from mapping
      // parameters. Which half failed is the first thing a reader wants to know.
      executionFailed = true;
      const step = invocation.operation === "poll"
        ? await executor.poll(invocation, context)
        : await executor.submit(invocation, context);
      return ExecutablePluginResultSchema.parse(step.status === "accepted"
        ? {
          protocol: "clash.plugin.result/v1",
          invocationId: invocation.invocationId,
          status: "accepted",
          pollState: step.pollState,
          ...(step.retryAfterMs === undefined ? {} : { retryAfterMs: step.retryAfterMs }),
        }
        : {
          protocol: "clash.plugin.result/v1",
          invocationId: invocation.invocationId,
          status: "completed",
          outputs: step.outputs,
        });
    }
    const projector = PROJECTORS[invocation.target.exportId];
    if (!projector) throw new Error(`Unknown export: ${invocation.target.exportId}`);
    return ExecutablePluginResultSchema.parse({
      protocol: "clash.plugin.result/v1",
      invocationId,
      status: "completed",
      outputs: [{
        slot: "projection",
        kind: "value",
        value: projector(projectorInput(invocation)),
      }],
    });
  } catch (error) {
    return ExecutablePluginResultSchema.parse({
      protocol: "clash.plugin.result/v1",
      invocationId,
      status: "failed",
      error: {
        // Which half failed is the first thing a reader wants, and an executor reporting
      // `projection_failed` sends them to look at parameter mapping when the provider refused.
      code: executionFailed ? "execution_failed" : "projection_failed",
        message: (error as Error).message,
        retryable: false,
      },
    });
  }
}

/**
 * The credential and endpoint the host supplies for this run.
 *
 * Read at call time from the environment the broker prepared, never stored and never written to a
 * result. A plugin that kept one would be keeping a secret the host is responsible for rotating.
 */
function executorContext(): ExecutorContext {
  return {
    ...(process.env.CLASH_PROVIDER_API_KEY ? { apiKey: process.env.CLASH_PROVIDER_API_KEY } : {}),
    ...(process.env.CLASH_PROVIDER_ENDPOINT ? { endpoint: process.env.CLASH_PROVIDER_ENDPOINT } : {}),
    ...(process.env.CLASH_FAL_QUEUE_BASE_URL
      ? { queueBaseUrl: process.env.CLASH_FAL_QUEUE_BASE_URL }
      : {}),
  };
}

if (process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      message = { invocationId: "unknown", invalidJson: (error as Error).message };
    }
    // Serialising the promise itself would write `{}` and leave the host waiting on a plugin that
    // has already answered. One reply per line, in the order they finish.
    void handleInvocation(message, executorContext()).then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    });
  });
}
