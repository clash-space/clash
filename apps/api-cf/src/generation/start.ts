/**
 * Single chokepoint for spawning a GenerationWorkflow instance.
 *
 * Two callers exist throughout the codebase:
 *   - HTTP handlers (routes/index.ts, etc.) — use the returned promise
 *     to send a 4xx back to the browser when the plugin rejects.
 *   - DO/agent contexts (loro/NodeProcessor, agents/tools/canvas) — wrap
 *     in try/catch and surface the error on the offending node so the
 *     UI sees the failure without polling workflow status.
 *
 * Always go through this helper instead of calling
 * `env.GENERATION_WORKFLOW.create` directly: it gives plugins (e.g. the
 * hosted billing plugin) a synchronous fail-fast hook, which is what
 * makes "out of credits" surface in milliseconds instead of seconds-after-
 * workflow-spin-up.
 */
import type { Env } from "../config";
import { getPlugins } from "../plugins/registry";
import type { GenerationParams } from "./params";

export async function startGeneration(
  env: Env,
  taskId: string,
  params: GenerationParams,
): Promise<void> {
  const plugins = getPlugins();
  await plugins.generation?.beforeGenerationStart?.({ env, params });
  await env.GENERATION_WORKFLOW.create({ id: taskId, params });
}
