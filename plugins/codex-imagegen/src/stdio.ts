import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  defineStdioExecutablePlugin,
  type ExecutorContext,
} from "@clash/action-sdk";
import {
  ExecutablePluginAssetHandleSchema,
  ExecutablePluginInvocationSchema,
  ExecutablePluginResultSchema,
  type ExecutablePluginInvocation,
  type ExecutablePluginResult,
} from "@clash/shared-types/executable-plugin";

export const CODEX_IMAGEGEN_ACTION_ID = "codex-imagegen";

export type CodexImageGenServices = Pick<ExecutorContext, "hostTools">;

function promptValue(invocation: ExecutablePluginInvocation): string {
  const value = invocation.input.values.prompt;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Codex ImageGen requires a non-empty prompt.");
  }
  return value.trim();
}

function aspectRatioValue(invocation: ExecutablePluginInvocation) {
  const value = invocation.input.values.aspect_ratio;
  return value === "16:9" || value === "9:16" || value === "4:3"
    || value === "3:4" || value === "21:9"
    ? value
    : "1:1";
}

export async function runCodexImageGeneration(
  input: unknown,
  services: CodexImageGenServices,
): Promise<ExecutablePluginResult> {
  const invocation = ExecutablePluginInvocationSchema.parse(input);
  const references = invocation.input.references
    .filter((reference) => "asset" in reference && reference.asset.kind === "image")
    .sort((left, right) => left.index - right.index)
    .map((reference) => {
      if (!("asset" in reference)) throw new Error("Expected an image asset reference.");
      return { ...reference.asset, kind: "image" as const };
    });

  const asset = ExecutablePluginAssetHandleSchema.parse(
    await services.hostTools.codexImagegen.generate({
    prompt: promptValue(invocation),
    aspectRatio: aspectRatioValue(invocation),
    slot: "image",
    references,
    }),
  );

  return ExecutablePluginResultSchema.parse({
    protocol: "clash.plugin.result/v1",
    invocationId: invocation.invocationId,
    status: "completed",
    outputs: [{ slot: "image", kind: "asset", asset }],
  });
}

if (process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  void defineStdioExecutablePlugin({
    "generate-image": (invocation, context) =>
      runCodexImageGeneration(invocation, context),
  }).done;
}
