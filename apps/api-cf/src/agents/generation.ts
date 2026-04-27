/**
 * GenerationWorkflow — durable dispatcher for AIGC tasks.
 *
 * Platform responsibility: resolve the right provider, build a
 * GenerationContext, run provider.execute(ctx), surface failures.
 *
 * Per-model / per-service step graphs live in src/generation/providers/*.ts.
 * Shared primitives (R2 IO, probe, asset insert, Loro notify, step wrapper)
 * are in src/generation/context.ts.
 */
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { Env } from "../config";
import { log } from "../logger";
import { GenerationContext } from "../generation/context";
import type { GenerationParams } from "../generation/params";
import { resolveProvider } from "../generation/registry";
import { getPlugins } from "../plugins/registry";
import { recordGenerationEvent } from "../observability/events";

// Re-export so existing importers (ProjectRoom, TaskPolling, tests) keep working.
export type { GenerationParams } from "../generation/params";

export class GenerationWorkflow extends WorkflowEntrypoint<Env, GenerationParams> {
  async run(event: WorkflowEvent<GenerationParams>, step: WorkflowStep): Promise<void> {
    const params = event.payload;
    const tag = { taskId: params.taskId, nodeId: params.nodeId, type: params.type };
    const startedAt = Date.now();
    log.info("Workflow started", tag);

    const ctx = new GenerationContext(params, step, this.env);
    const provider = resolveProvider(params);
    const plugins = getPlugins();
    const hookCtx = { params, env: this.env };
    const eventBase = {
      type: params.type,
      provider: provider.name,
      taskId: params.taskId,
      nodeId: params.nodeId,
      projectId: (params as any).projectId,
      modelId: (params as any).modelId,
    };

    try {
      await plugins.generation?.beforeGenerate?.(hookCtx);
      await provider.execute(ctx);
      await plugins.generation?.afterGenerate?.(hookCtx, {});
      log.info("Workflow completed", { ...tag, provider: provider.name });
      recordGenerationEvent({ ...eventBase, outcome: "success", durationMs: Date.now() - startedAt });
    } catch (err) {
      await plugins.generation?.onFailure?.(hookCtx, err);
      const message = err instanceof Error ? err.message : String(err);
      const anyErr = err as any;
      log.error("Workflow failed — marking node Failed", {
        ...tag,
        provider: provider.name,
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
