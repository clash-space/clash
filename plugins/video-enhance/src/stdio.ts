import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assemblePluginModule,
  defineActionExecutor,
  servePluginStdio,
  type ExecutorContext,
  type ExecutorStep,
} from "@clash/action-sdk";
import {
  ExecutablePluginInvocationSchema,
  ExecutableVideoEnhanceReferenceSchema,
  GeneratorDefinitionSpecSchema,
  type ExecutablePluginInvocation,
  type ExecutablePluginJsonValue,
  type ExecutableVideoEnhanceReference,
} from "@clash/shared-types/executable-plugin";

export const VIDEO_ENHANCE_ACTION_ID = "enhance";
/** Canonical media output slot shared with Provider executor conventions (e.g. `media: {media: ...}`). */
export const VIDEO_ENHANCE_OUTPUT_SLOT = "media";
const manifestDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const definitionDocument = JSON.parse(
  readFileSync(join(manifestDir, "generators/video-enhance.json"), "utf8"),
) as { spec: unknown };
export const VIDEO_ENHANCE_DEFINITION = GeneratorDefinitionSpecSchema.parse(
  definitionDocument.spec,
);

function sourceReference(
  invocation: ExecutablePluginInvocation,
): ExecutableVideoEnhanceReference {
  if (invocation.input.references.length !== 1) {
    throw new Error("Video enhancement requires exactly one frozen video source reference.");
  }
  const parsed = ExecutableVideoEnhanceReferenceSchema.safeParse(
    invocation.input.references[0],
  );
  if (!parsed.success || parsed.data.slot !== "source") {
    throw new Error("Video enhancement requires exactly one frozen video source reference.");
  }
  return parsed.data;
}

function requiredString(values: Record<string, ExecutablePluginJsonValue>, key: string): string {
  const value = values[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Video enhancement requires ${key}.`);
  }
  return value.trim();
}

/**
 * Provider-specific enhancement options, forwarded verbatim.
 *
 * This Generator never enumerates or interprets an option; the selected model card and its
 * Provider implementation are the sole authority for which keys exist and what they mean.
 */
function modelParams(
  values: Record<string, ExecutablePluginJsonValue>,
): Record<string, ExecutablePluginJsonValue> {
  const raw = values.modelParams;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, ExecutablePluginJsonValue>)
    : {};
}

async function enhanceStep(
  input: unknown,
  context: ExecutorContext,
): Promise<ExecutorStep> {
  const invocation = ExecutablePluginInvocationSchema.parse(input);
  const reference = sourceReference(invocation);
  const values = invocation.input.values;
  const source = values.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Video enhancement requires frozen source identity.");
  }
  if (
    source.projectAssetId !== reference.asset.assetId ||
    source.kind !== reference.asset.kind ||
    source.kind !== "video" ||
    typeof source.resourceHash !== "string"
  ) {
    throw new Error("Video enhancement source identity does not match its frozen reference.");
  }
  const modelId = requiredString(values, "modelId");
  const params = modelParams(values);

  const enhanced = await context.hostTools.videoEnhance({
    reference,
    modelId,
    params,
    ...(invocation.operation === "poll" ? { poll: invocation.pollState! } : {}),
  });

  if (enhanced.status === "accepted") {
    return {
      status: "accepted",
      pollState: enhanced.poll,
      ...(enhanced.retryAfterMs === undefined ? {} : { retryAfterMs: enhanced.retryAfterMs }),
    };
  }

  return {
    status: "completed",
    outputs: [
      {
        slot: VIDEO_ENHANCE_OUTPUT_SLOT,
        kind: "asset",
        asset: enhanced.asset,
      },
    ],
  };
}

export const CONTRIBUTIONS = {
  [VIDEO_ENHANCE_ACTION_ID]: defineActionExecutor({
    submit: enhanceStep,
    poll: enhanceStep,
  }),
};

export const plugin = assemblePluginModule({
  manifestDir,
  contributes: CONTRIBUTIONS,
});

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  void servePluginStdio(plugin).done;
}
