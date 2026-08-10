/**
 * Canonical generation events for the dashboard.
 *
 * One JSON line per workflow outcome via `console.log(JSON.stringify(...))`
 * — Workers Logs auto-extracts JSON fields so the CF Dashboard's Logs UI
 * can filter / group / chart by them. No new bindings, no new tables.
 *
 * Schema (don't reshape without updating the dashboard queries in
 * clash-hosted/OPERATIONS.md):
 *   event              — "generation_event" (constant; lets us filter all
 *                         events out of the rest of the log noise)
 *   outcome            — "success" | "failure"
 *   type               — image_gen | video_gen | video_render | audio_gen
 *                         | text_gen | image_desc | video_desc | video_thumbnail
 *   provider           — the adapter's `name` tag (google-image, video-render,
 *                         fal-image, …). Field and values are unchanged: these
 *                         are what dashboards already query. The adapter symbols
 *                         in src/generation/adapters/ are named after the wire
 *                         format they translate and do not track these strings.
 *   model_id           — set when params carry one (workflow can be
 *                         provider-only without a specific model)
 *   project_id         — for per-project rollups
 *   task_id, node_id   — drill-down to a specific run
 *   duration_ms        — wall-clock from workflow start to outcome.
 *                         Note: CF Workflows resumes from durable state on
 *                         retry, so a resumed run shows a small duration —
 *                         interpret as "post-resume work", not full task time.
 *   failure_category   — one of CATEGORIES below; "" on success
 *   failure_message    — first 500 chars of the error message; "" on success
 */

const CATEGORIES: Array<[string, RegExp]> = [
  ["do_reset", /Durable Object reset because its code was updated/i],
  ["workflow_internal", /WorkflowInternalError/i],
  ["render_server", /Render server error/i],
  ["r2_put", /readable stream must have a known length/i],
  ["asset_not_found", /R2 object not found|Asset(?:\s|.+?)not found/i],
  ["remotion_bundle", /Remotion entry point not found/i],
  ["provider_api", /\b(Vertex|fal|OpenAI|Kling|Gemini|Pika)\b.*\b[45]\d\d\b/i],
  ["timeout", /\btimeout|timed out|deadline exceeded\b/i],
];

export function categorizeFailure(message: string | undefined): string {
  if (!message) return "other";
  for (const [name, re] of CATEGORIES) {
    if (re.test(message)) return name;
  }
  return "other";
}

export interface GenerationEventInput {
  outcome: "success" | "failure";
  type: string;
  provider: string;
  taskId: string;
  nodeId?: string;
  projectId?: string;
  modelId?: string;
  durationMs: number;
  errorMessage?: string;
}

export function recordGenerationEvent(evt: GenerationEventInput): void {
  const failureMessage = evt.errorMessage?.slice(0, 500) ?? "";
  // eslint-disable-next-line no-console -- intentional structured log for dashboard
  console.log(
    JSON.stringify({
      event: "generation_event",
      outcome: evt.outcome,
      type: evt.type,
      provider: evt.provider,
      model_id: evt.modelId ?? "",
      project_id: evt.projectId ?? "",
      task_id: evt.taskId,
      node_id: evt.nodeId ?? "",
      duration_ms: evt.durationMs,
      failure_category: evt.outcome === "failure" ? categorizeFailure(failureMessage) : "",
      failure_message: failureMessage,
    }),
  );
}
