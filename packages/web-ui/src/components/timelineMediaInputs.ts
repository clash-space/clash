import {
  projectTimelineActionId,
  type ActionAssetBinding,
  type ProjectTimeline,
  type ResolvedAsset,
} from "@clash/shared-types";
import type {
  AssetRelationEdge,
  AssetRelationNode,
} from "../features/assets/relations";
import { projectAssetPlaybackUrl } from "../features/assets/media-url";

export interface TimelineMediaInput {
  sourceNodeId: string;
  projectAssetId: string;
  type: "image" | "video" | "audio";
  src: string;
  displayName?: string;
}

type TimelineItemScopeRef = {
  id?: string;
  assetId?: string;
  sourceNodeId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function timelineItemRefs(state: unknown): Map<string, TimelineItemScopeRef> {
  const refs = new Map<string, TimelineItemScopeRef>();
  if (!isRecord(state) || !Array.isArray(state.tracks)) return refs;
  for (const track of state.tracks) {
    if (!isRecord(track) || !Array.isArray(track.items)) continue;
    for (const item of track.items) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id) continue;
      refs.set(item.id, {
        id: item.id,
        sourceNodeId:
          typeof item.sourceNodeId === "string" ? item.sourceNodeId : undefined,
        assetId: typeof item.assetId === "string" ? item.assetId : undefined,
      });
    }
  }
  return refs;
}

export function selectTimelineMediaInputs(input: {
  timeline: ProjectTimeline;
  assets: ResolvedAsset[];
  bindings: ActionAssetBinding[];
  nodes: AssetRelationNode[];
  edges: AssetRelationEdge[];
}): TimelineMediaInput[] {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const assetById = new Map<string, ResolvedAsset>();
  for (const asset of input.assets) {
    assetById.set(asset.id, asset);
  }

  const canvasSourceByProjectAssetId = new Map<string, string>();
  if (input.timeline.owner.kind === "canvas-action") {
    for (const edge of input.edges) {
      if (
        edge.canvasId === input.timeline.owner.canvasId &&
        edge.target === input.timeline.owner.actionNodeId
      ) {
        const projectAssetId = nodeById.get(edge.source)?.data?.assetId;
        if (typeof projectAssetId === "string" && projectAssetId) {
          canvasSourceByProjectAssetId.set(projectAssetId, edge.source);
        }
      }
    }
  }
  const itemRefs = timelineItemRefs(input.timeline.state);
  const actionId = projectTimelineActionId(
    input.timeline.id,
    input.timeline.owner,
  );
  const candidates = input.bindings
    .filter(
      (binding) =>
        binding.direction === "input" &&
        binding.owner.kind === "draft" &&
        binding.owner.actionId === actionId,
    )
    .sort(
      (left, right) =>
        left.slot.localeCompare(right.slot) || left.id.localeCompare(right.id),
    )
    .map((binding) => {
      const itemId = binding.slot.startsWith("timeline:item:")
        ? binding.slot.slice("timeline:item:".length)
        : undefined;
      const item = itemId ? itemRefs.get(itemId) : undefined;
      const itemSourceNodeId =
        item?.assetId === binding.projectAssetId
          ? item.sourceNodeId
          : undefined;
      return {
        projectAssetId: binding.projectAssetId,
        sourceNodeId:
          canvasSourceByProjectAssetId.get(binding.projectAssetId) ??
          itemSourceNodeId ??
          `timeline-asset:${binding.projectAssetId}`,
      };
    });

  const seenSourceNodeIds = new Set<string>();
  const seenProjectAssetIds = new Set<string>();
  const result: TimelineMediaInput[] = [];
  for (const candidate of candidates) {
    if (seenSourceNodeIds.has(candidate.sourceNodeId)) continue;
    const node = nodeById.get(candidate.sourceNodeId);
    const projectAsset = assetById.get(candidate.projectAssetId);
    const type = projectAsset?.kind;
    if (type !== "image" && type !== "video" && type !== "audio") continue;
    // The binding is authoritative. Canvas and item identities are navigation
    // hints only; prefer the Canvas placement for a Canvas-owned Timeline.
    if (seenProjectAssetIds.has(candidate.projectAssetId)) continue;
    if (!projectAsset) continue;
    const src = projectAssetPlaybackUrl(projectAsset);
    if (!src) continue;

    seenSourceNodeIds.add(candidate.sourceNodeId);
    seenProjectAssetIds.add(candidate.projectAssetId);
    result.push({
      sourceNodeId: candidate.sourceNodeId,
      projectAssetId: candidate.projectAssetId,
      type,
      src,
      displayName: firstText(
        node?.data?.label,
        node?.data?.name,
        projectAsset.name,
      ),
    });
  }
  return result;
}

/**
 * Rebinds media items to the canonical reference of their target scope.
 * Native Timeline DnD remains responsible for `from`; this only replaces the
 * Project-sidebar identity after the scope cascade has materialized the direct
 * Timeline reference or Canvas placement.
 */
export function canonicalizeTimelineItemScopeRefs<
  TTrack extends { items: TimelineItemScopeRef[] },
>(
  tracks: readonly TTrack[],
  mediaInputs: readonly TimelineMediaInput[],
): TTrack[] {
  const sourceNodeIdByProjectAssetId = new Map<string, string>();
  for (const input of mediaInputs) {
    if (!sourceNodeIdByProjectAssetId.has(input.projectAssetId)) {
      sourceNodeIdByProjectAssetId.set(
        input.projectAssetId,
        input.sourceNodeId,
      );
    }
  }

  return tracks.map((track) => ({
    ...track,
    items: track.items.map((item) => {
      if (!item.assetId) return item;
      const sourceNodeId = sourceNodeIdByProjectAssetId.get(item.assetId);
      return !sourceNodeId || sourceNodeId === item.sourceNodeId
        ? item
        : { ...item, sourceNodeId };
    }),
  }));
}
