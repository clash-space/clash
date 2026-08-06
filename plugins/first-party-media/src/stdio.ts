import { createInterface } from "node:readline";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ExecutablePluginInvocationSchema,
  ExecutablePluginResultSchema,
  type ExecutablePluginInvocation,
  type ExecutablePluginResult,
} from "@clash/shared-types/executable-plugin";

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

export function handleInvocation(input: unknown): ExecutablePluginResult {
  let invocationId = "unknown";
  try {
    if (input && typeof input === "object" && "invocationId" in input) {
      invocationId = String((input as { invocationId: unknown }).invocationId);
    }
    const invocation = ExecutablePluginInvocationSchema.parse(input);
    invocationId = invocation.invocationId;
    const projector = PROJECTORS[invocation.target.exportId];
    if (!projector) throw new Error(`Unknown projector export: ${invocation.target.exportId}`);
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
        code: "projection_failed",
        message: (error as Error).message,
        retryable: false,
      },
    });
  }
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
    process.stdout.write(`${JSON.stringify(handleInvocation(message))}\n`);
  });
}
