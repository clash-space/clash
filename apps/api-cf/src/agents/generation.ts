/**
 * GenerationWorkflow — durable dispatcher for AIGC tasks.
 *
 * Platform responsibility: resolve the right adapter, build a
 * GenerationContext, run adapter.execute(ctx), surface failures.
 *
 * Per-model / per-service step graphs live in src/generation/adapters/*.ts.
 * Shared primitives (R2 IO, probe, asset insert, Loro notify, step wrapper)
 * are in src/generation/context.ts.
 */
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { Env } from "../config";
import { log } from "../logger";
import { GenerationContext } from "../generation/context";
import { resolveGenerationModelProviderRoute } from "../generation/model-provider-route";
import type { GenerationParams } from "../generation/params";
import { resolveAdapter } from "../generation/registry";
import { getPlugins } from "../plugins/registry";
import { recordGenerationEvent } from "../observability/events";
import {
  applyModelProviderImplementation,
  MODEL_CARDS,
  normalizeModelId,
  validateModelCardConfiguration,
} from "@clash/shared-types";

// Re-export so existing importers (ProjectRoom, TaskPolling, tests) keep working.
export type { GenerationParams } from "../generation/params";

export class GenerationWorkflow extends WorkflowEntrypoint<Env, GenerationParams> {
  async run(event: WorkflowEvent<GenerationParams>, step: WorkflowStep): Promise<void> {
    const selectedRoute = await step.do(
      "resolve-model-provider-route",
      { retries: { limit: 2, delay: "2 seconds" }, timeout: "30 seconds" },
      () => resolveGenerationModelProviderRoute(this.env, event.payload),
    );
    const params: GenerationParams = {
      ...event.payload,
      ...(selectedRoute ? { selectedRoute } : {}),
    };
    const tag = { taskId: params.taskId, nodeId: params.nodeId, type: params.type };
    const startedAt = Date.now();
    log.info("Workflow started", tag);

    const ctx = new GenerationContext(params, step, this.env);
    const adapter = resolveAdapter(params);
    const plugins = getPlugins();
    const hookCtx = { params, env: this.env };
    const eventBase = {
      type: params.type,
      // Telemetry field name kept as `provider`: dashboards and queries already read it.
      provider: adapter.name,
      taskId: params.taskId,
      nodeId: params.nodeId,
      projectId: (params as any).projectId,
      modelId: (params as any).modelId,
    };

    try {
      const modelId = normalizeModelId(params.modelName ?? params.videoModel) ?? params.modelName ?? params.videoModel;
      const baseCard = MODEL_CARDS.find((card) => card.id === modelId);
      if (baseCard) {
        const effectiveCard = applyModelProviderImplementation(baseCard, selectedRoute);
        const lyricsParam = effectiveCard.musicInput?.lyricsParam;
        const effectiveModelParams: Record<string, string | number | boolean | undefined> = {
          ...(params.modelParams as Record<string, string | number | boolean | undefined> | undefined),
          ...(params.duration !== undefined ? { duration: params.duration } : {}),
          ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
        };
        const validationError = validateModelCardConfiguration(effectiveCard, {
          prompt: params.prompt,
          lyrics: lyricsParam && typeof effectiveModelParams[lyricsParam] === "string"
            ? effectiveModelParams[lyricsParam] as string
            : undefined,
          modelParams: effectiveModelParams,
        });
        if (validationError) throw new Error(validationError);
      }
      await plugins.generation?.beforeGenerate?.(hookCtx);
      await adapter.execute(ctx);
      await plugins.generation?.afterGenerate?.(hookCtx, {});
      log.info("Workflow completed", { ...tag, provider: adapter.name });
      recordGenerationEvent({ ...eventBase, outcome: "success", durationMs: Date.now() - startedAt });
    } catch (err) {
      await plugins.generation?.onFailure?.(hookCtx, err);
      const message = err instanceof Error ? err.message : String(err);
      const anyErr = err as any;
      log.error("Workflow failed — marking node Failed", {
        ...tag,
        provider: adapter.name,
        error: message,
        name: anyErr?.name,
        stack: anyErr?.stack,
        statusCode: anyErr?.statusCode ?? anyErr?.status,
        responseBody: anyErr?.responseBody ?? anyErr?.body,
        data: anyErr?.data,
        url: anyErr?.url,
        cause: anyErr?.cause
          ? {
              message: anyErr.cause?.message,
              statusCode: anyErr.cause?.statusCode ?? anyErr.cause?.status,
              responseBody: anyErr.cause?.responseBody ?? anyErr.cause?.body,
            }
          : undefined,
      });
      recordGenerationEvent({
        ...eventBase,
        outcome: "failure",
        durationMs: Date.now() - startedAt,
        errorMessage: message,
      });
      await ctx.notifyFailed(err);
      // Rethrow so the Workflow itself is recorded as errored — retention,
      // inspection, and TaskPolling's safety-net orphan sweep still see it.
      throw err;
    }
  }
}
