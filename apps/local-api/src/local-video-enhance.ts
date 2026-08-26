import type {
  ActionRunModelRoute,
  ExecutableVideoEnhanceReference,
  ExecutableVideoEnhanceResult,
} from "@clash/shared-types";

import type { ProviderPluginExecutor } from "./local-aigc.js";

export interface LocalVideoEnhanceInput {
  projectId: string;
  invocationId: string;
  taskId: string;
  reference: ExecutableVideoEnhanceReference;
  modelId: string;
  /** Exact Provider implementation frozen with the Run authority at selection time. */
  route: ActionRunModelRoute;
  params: unknown;
  /** Present only when resuming Host-owned asynchronous enhancement work. */
  poll?: unknown;
}

function paramsRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

/**
 * Generic Host-side dispatch for the generic clash.video-enhance Generator Action.
 *
 * This service never recognizes a Provider by name. It reads only the Host-frozen `route`
 * (`executorBinding`, `assetInputs`, `accountId`) selected at Run submission and invokes exactly
 * that pinned Provider executor plugin/version/export, the same generic mechanism used for
 * image/video/audio generation. A completed response's media crosses only as the Host-issued
 * canonical Asset handle the Provider executor's own single upload produced -- never a raw
 * upstream URL a second fetch would have to chase.
 *
 * `executorBinding` is pinned once at selection and never re-resolved here: a plugin upgrade
 * between this Run's submit and a later poll must not silently swap in a newer version. When the
 * Host's fresh provider-executor resolution answers with a different plugin, version, export, or
 * schema than the frozen binding, that is binding drift and the call fails closed.
 */
export function createLocalVideoEnhanceService(options: {
  providerPluginExecutor: ProviderPluginExecutor;
}) {
  return {
    async enhance(
      input: LocalVideoEnhanceInput,
    ): Promise<ExecutableVideoEnhanceResult> {
      const route = input.route;
      const binding = route.executorBinding;
      const executorPluginId = binding?.pluginId ?? route.executorPluginId;
      const executorExportId = binding?.exportId ?? route.executorExportId;
      if (!executorPluginId || !executorExportId) {
        throw new Error(
          `${input.modelId} resolved to ${route.providerId ?? route.upstreamId} ` +
            `(${route.apiShape}), which does not declare an executable submit/poll contract. ` +
            "Install or upgrade its Provider plugin before enhancing.",
        );
      }
      const response = await options.providerPluginExecutor({
        pluginId: executorPluginId,
        exportId: executorExportId,
        kind: "video",
        taskId: input.taskId,
        projectId: input.projectId,
        ...(binding ? { binding } : {}),
        ...(route.assetInputs ? { assetInputs: route.assetInputs } : {}),
        input: {
          values: {
            modelId: route.upstreamModel,
            ...paramsRecord(input.params),
          },
          references: [
            {
              slot: input.reference.slot,
              index: input.reference.index,
              asset: input.reference.asset,
            },
          ],
        },
        ...(input.poll === undefined ? {} : { pollState: input.poll }),
        ...(route.accountId ? { accountId: route.accountId } : {}),
      });
      if (
        response.binding.pluginId !== executorPluginId ||
        response.binding.exportId !== executorExportId
      ) {
        throw new Error(
          `Provider executor resolved ${response.binding.pluginId}/${response.binding.exportId}, ` +
            `expected ${executorPluginId}/${executorExportId}.`,
        );
      }
      if (
        binding &&
        (response.binding.version !== binding.version ||
          response.binding.schemaHash !== binding.schemaHash)
      ) {
        throw new Error(
          `Provider executor binding drifted: frozen ${binding.pluginId}/${binding.exportId}@` +
            `${binding.version} (${binding.schemaHash}), resolved ${response.binding.pluginId}/` +
            `${response.binding.exportId}@${response.binding.version} (${response.binding.schemaHash}).`,
        );
      }
      if (response.status === "failed") {
        throw new Error(response.error.message);
      }
      if (response.status === "accepted") {
        return {
          status: "accepted",
          poll: response.pollState as never,
          ...(response.retryAfterMs === undefined
            ? {}
            : { retryAfterMs: response.retryAfterMs }),
        };
      }
      if (!("media" in response)) {
        throw new Error(
          `Provider executor ${executorPluginId}/${executorExportId} returned a text output ` +
            "for a video enhancement request.",
        );
      }
      if (response.media.kind !== "video") {
        throw new Error(
          `Provider executor returned ${response.media.kind} output for a video enhancement request.`,
        );
      }
      return {
        status: "completed",
        provider: route.providerId ?? route.upstreamId,
        route: route.apiShape,
        underlyingModel: route.upstreamModel,
        asset: response.media as never,
      };
    },
  };
}

export type LocalVideoEnhanceService = ReturnType<
  typeof createLocalVideoEnhanceService
>;
