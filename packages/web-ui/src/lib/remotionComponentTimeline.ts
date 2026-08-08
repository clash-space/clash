import type { CompositionItem, Track } from "@master-clash/remotion-core";

type TimelineStateLike = Record<string, unknown> & {
  tracks?: Track[];
};

export type RemotionComponentTimelineInput = {
  nodeId: string;
  componentId: string;
  label: string;
  durationInFrames: number;
};

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
