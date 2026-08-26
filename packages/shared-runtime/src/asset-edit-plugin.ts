import {
  assemblePluginModule,
  defineAction,
  invokePluginModule,
  type PluginExecutionRealm,
  type PluginModule,
  type ExecutorContext,
} from "@clash/action-sdk/browser";
import {
  ASSET_ACTION_ID,
  AssetEditActionInvocationSchema,
  type AssetEditActionInvocation,
} from "@clash/shared-types/actions/asset-edit";
import type {
  ExecutablePluginOutput,
  ExecutablePluginReference,
} from "@clash/shared-types/executable-plugin";

export interface AssetEditExecutionInput {
  actionRunId: string;
  invocation: AssetEditActionInvocation;
  sourceUrl?: string;
  reference?: ExecutablePluginReference;
}

export type AssetEditExecutor = (
  input: AssetEditExecutionInput,
  context: ExecutorContext,
) => Promise<ExecutablePluginOutput>;

const PLUGIN_ID = "clash.asset-edit";
const PLUGIN_VERSION = "1.0.0";
const PLUGIN_SCHEMA_HASH = `sha256:${"a".repeat(64)}` as const;

/**
 * The built-in edit Generator module. Local, cloud, and client inject only their media adapter;
 * dispatch, validation, invocation shape, and result normalization remain this single module.
 */
export function createAssetEditPluginModule(
  execute: AssetEditExecutor,
): PluginModule {
  const action = defineAction({
    async run(pluginInvocation, context) {
      const values = pluginInvocation.input.values as Record<string, unknown>;
      const sourceReferences = pluginInvocation.input.references.filter(
        (candidate) => candidate.slot === "source" && "asset" in candidate,
      );
      const reference =
        sourceReferences.length === 1 ? sourceReferences[0] : undefined;
      const invocation = values.invocation
        ? AssetEditActionInvocationSchema.parse(values.invocation)
        : invocationFromGenerator(pluginInvocation, values, reference);
      const sourceUrl =
        typeof values.sourceUrl === "string" ? values.sourceUrl : undefined;
      const output = await execute(
        {
          actionRunId: pluginInvocation.taskId,
          invocation,
          ...(sourceUrl ? { sourceUrl } : {}),
          ...(reference ? { reference } : {}),
        },
        context,
      );
      return {
        status: "completed" as const,
        outputs: [{ ...output, slot: "output" }],
      };
    },
  });
  return assemblePluginModule({
    pluginId: PLUGIN_ID,
    functions: [
      {
        id: ASSET_ACTION_ID.ImageEditor,
        kind: "action",
        operations: ["submit"],
        assetInputs: [
          {
            match: { slots: ["source"], kinds: ["image"] },
            representations: ["bytes", "executor-url"],
          },
        ],
      },
      {
        id: ASSET_ACTION_ID.VideoClipper,
        kind: "action",
        operations: ["submit"],
        assetInputs: [
          {
            match: { slots: ["source"], kinds: ["video"] },
            representations: ["bytes", "executor-url"],
          },
        ],
      },
    ],
    contributes: {
      [ASSET_ACTION_ID.ImageEditor]: action,
      [ASSET_ACTION_ID.VideoClipper]: action,
    },
  });
}

function invocationFromGenerator(
  pluginInvocation: Parameters<PluginModule["invoke"]>[0],
  values: Record<string, unknown>,
  reference: ExecutablePluginReference | undefined,
): AssetEditActionInvocation {
  if (!reference || !("asset" in reference)) {
    throw new Error("Asset edit requires exactly one source media reference.");
  }
  const generatorActionId = values.__generatorActionId;
  if (typeof generatorActionId !== "string") {
    throw new Error(
      "Asset edit Generator invocation is missing its Action id.",
    );
  }
  const exportId = pluginInvocation.target.exportId;
  if (exportId === ASSET_ACTION_ID.ImageEditor) {
    if (generatorActionId !== "transform") {
      throw new Error(`Unsupported Image Editor Action ${generatorActionId}.`);
    }
    if (reference.asset.kind !== "image") {
      throw new Error("Image Editor requires one image source reference.");
    }
    return AssetEditActionInvocationSchema.parse({
      actionId: ASSET_ACTION_ID.ImageEditor,
      projectId: pluginInvocation.projectId,
      mode: "explicit",
      source: { assetId: reference.asset.assetId, kind: "image" },
      params: {
        ...(values.crop === undefined ? {} : { crop: values.crop }),
        ...(values.rotation === undefined ? {} : { rotation: values.rotation }),
      },
      surface: "canvas",
    });
  }
  if (exportId !== ASSET_ACTION_ID.VideoClipper) {
    throw new Error(`Unsupported Asset edit export ${exportId}.`);
  }
  if (reference.asset.kind !== "video") {
    throw new Error("Video Clipper requires one video source reference.");
  }
  const params =
    generatorActionId === "screenshot"
      ? { mode: "screenshot", frameTimeSec: values.frameTimeSec }
      : generatorActionId === "crop"
        ? {
            mode: "crop",
            startSec: values.startSec,
            endSec: values.endSec,
          }
        : undefined;
  if (!params) {
    throw new Error(`Unsupported Video Clipper Action ${generatorActionId}.`);
  }
  return AssetEditActionInvocationSchema.parse({
    actionId: ASSET_ACTION_ID.VideoClipper,
    projectId: pluginInvocation.projectId,
    mode: "explicit",
    source: { assetId: reference.asset.assetId, kind: "video" },
    params,
    surface: "canvas",
  });
}

export async function invokeAssetEditPlugin(input: {
  realm: PluginExecutionRealm;
  module: PluginModule;
  actionRunId: string;
  invocation: AssetEditActionInvocation;
  sourceUrl?: string;
}): Promise<{ assetId: string }> {
  const result = await invokePluginModule({
    realm: input.realm,
    module: input.module,
    invocation: {
      protocol: "clash.plugin.invoke/v1",
      invocationId: input.actionRunId,
      taskId: input.actionRunId,
      projectId: input.invocation.projectId,
      target: {
        pluginId: PLUGIN_ID,
        version: PLUGIN_VERSION,
        exportId: input.invocation.actionId,
        schemaHash: PLUGIN_SCHEMA_HASH,
        kind: "action",
      },
      operation: "submit",
      input: {
        values: {
          invocation: input.invocation,
          ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        },
        references: [],
      },
      assetInputs: [],
      actor: { kind: "user" },
    },
  });
  if (result.status !== "completed") {
    throw new Error(
      result.status === "failed"
        ? result.error.message
        : "Asset edit unexpectedly remained pending.",
    );
  }
  const output = result.outputs.find(
    (candidate) => candidate.slot === "output",
  );
  if (output?.kind !== "asset") {
    throw new Error("Asset edit plugin returned no Asset output.");
  }
  return { assetId: output.asset.assetId };
}
