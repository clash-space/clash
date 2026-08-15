import type { LoroDoc } from "loro-crdt";
import { Canvas } from "./canvas-ops.js";
import { PROJECT_ASSET_RENDER_CANVAS_ID } from "./timeline-contract.js";
import {
  freezeProjectTimelineRunAssetInputs,
  projectTimelineRenderActionRunId,
  readProjectTimeline,
  resolveTimelineRenderTarget,
  type TimelineRenderTarget,
} from "./project-workspace.js";

export { PROJECT_ASSET_RENDER_CANVAS_ID } from "./timeline-contract.js";

export interface TimelineRenderRequestInput {
  timelineId: string;
  actorUserId: string;
  actorAgentId?: string;
  generateId: () => string;
}

export type TimelineRenderRequestResult =
  | {
      ok: true;
      renderNodeId: string;
      target: TimelineRenderTarget;
      position: { x: number; y: number };
    }
  | { ok: false; error: string };

export type RenderableTimelineDsl = {
  tracks?: Array<{
    items?: Array<{ from?: number; durationInFrames?: number }>;
  }>;
  compositionWidth?: number;
  compositionHeight?: number;
  fps?: number;
  durationInFrames?: number;
  [key: string]: unknown;
};

export function canonicalTimelineRenderDsl(
  state: unknown,
): RenderableTimelineDsl | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const timelineDsl = state as RenderableTimelineDsl;
  const tracks = Array.isArray(timelineDsl.tracks) ? timelineDsl.tracks : [];
  const totalItems = tracks.reduce(
    (count, track) =>
      count + (Array.isArray(track.items) ? track.items.length : 0),
    0,
  );
  if (totalItems === 0) return null;

  let maxEnd = 0;
  for (const track of tracks) {
    for (const item of track.items ?? []) {
      const from = typeof item.from === "number" ? item.from : 0;
      const duration =
        typeof item.durationInFrames === "number" ? item.durationInFrames : 0;
      maxEnd = Math.max(maxEnd, from + duration);
    }
  }
  const declaredDuration =
    typeof timelineDsl.durationInFrames === "number"
      ? timelineDsl.durationInFrames
      : 0;
  return {
    ...timelineDsl,
    durationInFrames: Math.max(maxEnd, declaredDuration, 1),
  };
}

/**
 * Creates the durable backend work item used by both Timeline Export and the
 * Canvas Timeline Action Render button. Canvas-owned outputs are linked into
 * their parent Canvas; standalone outputs live in an internal render scope and
 * surface through the project asset created by the backend processor.
 */
export function requestTimelineRender(
  doc: LoroDoc,
  input: TimelineRenderRequestInput,
): TimelineRenderRequestResult {
  const timeline = readProjectTimeline(doc, input.timelineId);
  if (!timeline)
    return { ok: false, error: `Timeline ${input.timelineId} not found` };
  const target = resolveTimelineRenderTarget(doc, input.timelineId);
  if (!target)
    return {
      ok: false,
      error: `Timeline ${input.timelineId} has no render target`,
    };

  if (target.kind === "canvas") {
    const result = new Canvas(doc, () => {}, target.canvasId).executeRender(
      target.actionNodeId,
      input.generateId,
    );
    if (result.error) return { ok: false, error: result.error };
    const nodes = doc.getMap("nodes");
    const raw = nodes.get(result.renderNodeId) as
      Record<string, any> | undefined;
    if (!raw)
      return {
        ok: false,
        error: `Render node ${result.renderNodeId} was not created`,
      };
    nodes.set(result.renderNodeId, {
      ...raw,
      data: {
        ...(raw.data ?? {}),
        actorType: input.actorAgentId ? "agent" : "user",
        actorUserId: input.actorUserId,
        ...(input.actorAgentId ? { actorAgentId: input.actorAgentId } : {}),
        renderTarget: target,
      },
    });
    return {
      ok: true,
      renderNodeId: result.renderNodeId,
      target,
      position: result.position,
    };
  }

  const timelineDsl = canonicalTimelineRenderDsl(timeline.state);
  if (!timelineDsl) {
    return {
      ok: false,
      error: `Timeline ${input.timelineId} has no items — nothing to render.`,
    };
  }
  const renderNodeId = input.generateId();
  const nodes = doc.getMap("nodes");
  if (nodes.get(renderNodeId) !== undefined) {
    return { ok: false, error: `Node ${renderNodeId} already exists` };
  }
  const actionRunId = projectTimelineRenderActionRunId(renderNodeId);
  const frozenPreflight = freezeProjectTimelineRunAssetInputs(
    doc.fork(),
    timeline,
    actionRunId,
  );
  if (!frozenPreflight.ok) {
    return { ok: false, error: frozenPreflight.error };
  }
  const naturalWidth =
    typeof timelineDsl.compositionWidth === "number" &&
    timelineDsl.compositionWidth > 0
      ? timelineDsl.compositionWidth
      : 1920;
  const naturalHeight =
    typeof timelineDsl.compositionHeight === "number" &&
    timelineDsl.compositionHeight > 0
      ? timelineDsl.compositionHeight
      : 1080;
  nodes.set(renderNodeId, {
    canvasId: PROJECT_ASSET_RENDER_CANVAS_ID,
    type: "video",
    position: { x: 0, y: 0 },
    data: {
      label: "Rendered Video",
      status: "pending",
      timelineDsl,
      sourceTimelineId: timeline.id,
      sourceTimelineActionId: frozenPreflight.owner.actionId,
      sourceTimelineRevisionId: timeline.revisionId,
      sourceTimelineActionRunId: actionRunId,
      pendingTask: null,
      naturalWidth,
      naturalHeight,
      aspectRatio: `${naturalWidth}:${naturalHeight}`,
      actorType: input.actorAgentId ? "agent" : "user",
      actorUserId: input.actorUserId,
      ...(input.actorAgentId ? { actorAgentId: input.actorAgentId } : {}),
      renderTarget: target,
    },
  });
  const frozen = freezeProjectTimelineRunAssetInputs(
    doc,
    timeline,
    actionRunId,
  );
  if (!frozen.ok) {
    throw new Error(
      `Timeline ${timeline.id} input freeze changed after preflight: ${frozen.error}`,
    );
  }
  return {
    ok: true,
    renderNodeId,
    target,
    position: { x: 0, y: 0 },
  };
}
