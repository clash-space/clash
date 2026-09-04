import type { CompositionItem, Track } from "@clash/remotion-core";

type TimelineStateLike = Record<string, unknown> & {
  tracks?: Track[];
};

export type RemotionComponentTimelineInput = {
  nodeId: string;
  componentId: string;
  label: string;
  durationInFrames: number;
};

type CanvasConnectionNode = {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
};

type ConnectionTimeline = {
  id: string;
  state?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : fallback;
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-") || "component";
}

function uniqueId(prefix: string, used: Set<string>): string {
  if (!used.has(prefix)) return prefix;
  let suffix = 2;
  while (used.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

/**
 * Adds a live Remotion component reference to a Project Timeline.
 *
 * The Timeline intentionally stores no source snapshot or render revision.
 * `sourceNodeId` is the stable identity; preview/export resolve that Canvas
 * node's latest `data.content` when they start.
 */
export function appendRemotionComponentToTimelineState(
  state: TimelineStateLike,
  component: RemotionComponentTimelineInput,
): TimelineStateLike & { tracks: Track[] } {
  const tracks = Array.isArray(state.tracks) ? state.tracks : [];
  const alreadyConnected = tracks.some((track) =>
    track.items.some(
      (item) =>
        item.type === "composition" &&
        item.runtime === "remotion" &&
        item.sourceNodeId === component.nodeId,
    ),
  );
  if (alreadyConnected) return state as TimelineStateLike & { tracks: Track[] };

  const usedTrackIds = new Set(tracks.map((track) => track.id));
  const usedItemIds = new Set(tracks.flatMap((track) => track.items.map((item) => item.id)));
  const existingTrack = tracks.find(
    (track) => track.category === "visual" && track.role === "overlay",
  );
  const item: CompositionItem = {
    id: uniqueId(`remotion-${safePathSegment(component.nodeId)}`, usedItemIds),
    type: "composition",
    compositionKind: "custom",
    runtime: "remotion",
    compositionId: component.componentId,
    sourceNodeId: component.nodeId,
    sourcePath: `components/${safePathSegment(component.nodeId)}.tsx`,
    from: 0,
    durationInFrames: Math.max(1, Math.round(component.durationInFrames)),
  };

  if (existingTrack) {
    return {
      ...state,
      tracks: tracks.map((track) => track.id === existingTrack.id
        ? { ...track, items: [...track.items, item] }
        : track),
    };
  }

  const track: Track = {
    id: uniqueId("remotion-components", usedTrackIds),
    name: "Remotion Components",
    role: "overlay",
    category: "visual",
    items: [item],
  };
  return { ...state, tracks: [...tracks, track] };
}

/**
 * A Canvas edge from a Remotion Component to a Timeline Editor is the handoff.
 * The Timeline stores the live source-node reference; the component node does
 * not own a second Timeline picker or imperative "add" workflow.
 */
export function deriveRemotionComponentConnectionUpdate(input: {
  sourceId: string;
  targetId: string;
  nodes: readonly CanvasConnectionNode[];
  timelines: readonly ConnectionTimeline[];
}): {
  timelineId: string;
  state: TimelineStateLike & { tracks: Track[] };
} | null {
  const source = input.nodes.find((node) => node.id === input.sourceId);
  const target = input.nodes.find((node) => node.id === input.targetId);
  if (source?.type !== "remotion-component" || target?.type !== "video-editor") {
    return null;
  }

  const timelineId = target.data?.timelineId;
  if (typeof timelineId !== "string" || !timelineId) return null;
  const timeline = input.timelines.find((candidate) => candidate.id === timelineId);
  if (!timeline) return null;

  const currentState = isRecord(timeline.state) ? timeline.state : {};
  const nextState = appendRemotionComponentToTimelineState(currentState, {
    nodeId: source.id,
    componentId:
      typeof source.data?.componentId === "string" && source.data.componentId.trim()
        ? source.data.componentId.trim()
        : source.id,
    label:
      typeof source.data?.label === "string" && source.data.label.trim()
        ? source.data.label.trim()
        : "Remotion Component",
    durationInFrames: positiveInteger(source.data?.durationInFrames, 120),
  });
  if (nextState === currentState) return null;
  return { timelineId, state: nextState };
}
