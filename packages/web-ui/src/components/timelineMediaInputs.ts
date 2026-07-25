import type { ProjectTimeline } from '@clash/shared-types';
import type { ProjectAsset } from '@clash/web-ui/lib/types';
import type { AssetRelationEdge, AssetRelationNode } from '../features/assets/relations';
import { projectAssetPlaybackUrl } from '../features/assets/media-url';

export interface TimelineMediaInput {
  sourceNodeId: string;
  backingAssetId: string;
  type: ProjectAsset['type'];
  src: string;
  displayName?: string;
}

type TimelineItemScopeRef = {
  assetId?: string;
  sourceNodeId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function timelineItemRefs(state: unknown): Array<{ sourceNodeId: string; assetId?: string }> {
  if (!isRecord(state) || !Array.isArray(state.tracks)) return [];
  const refs: Array<{ sourceNodeId: string; assetId?: string }> = [];
  for (const track of state.tracks) {
    if (!isRecord(track) || !Array.isArray(track.items)) continue;
    for (const item of track.items) {
      if (!isRecord(item) || typeof item.sourceNodeId !== 'string') continue;
      refs.push({
        sourceNodeId: item.sourceNodeId,
        assetId: typeof item.assetId === 'string' ? item.assetId : undefined,
      });
    }
  }
  return refs;
}

function explicitTimelineMediaRefs(state: unknown): Array<{ sourceNodeId: string; assetId: string }> {
  if (!isRecord(state) || !Array.isArray(state.mediaAssetRefs)) return [];
  return state.mediaAssetRefs.flatMap((ref) => {
    if (!isRecord(ref) || typeof ref.assetId !== 'string' || !ref.assetId) return [];
    return [{ sourceNodeId: `timeline-asset:${ref.assetId}`, assetId: ref.assetId }];
  });
}

export function selectTimelineMediaInputs(input: {
  timeline: ProjectTimeline;
  assets: ProjectAsset[];
  nodes: AssetRelationNode[];
  edges: AssetRelationEdge[];
}): TimelineMediaInput[] {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const assetById = new Map<string, ProjectAsset>();
  for (const asset of input.assets) {
    assetById.set(asset.id, asset);
    if (asset.assetId) assetById.set(asset.assetId, asset);
  }

  const candidates: Array<{ sourceNodeId: string; assetId?: string }> = [];
  if (input.timeline.owner.kind === 'canvas-action') {
    for (const edge of input.edges) {
      if (
        edge.canvasId === input.timeline.owner.canvasId &&
        edge.target === input.timeline.owner.actionNodeId
      ) {
        candidates.push({ sourceNodeId: edge.source });
      }
    }
  }
  candidates.push(...explicitTimelineMediaRefs(input.timeline.state));
  candidates.push(...timelineItemRefs(input.timeline.state));

  const seenSourceNodeIds = new Set<string>();
  const seenBackingAssetIds = new Set<string>();
  const result: TimelineMediaInput[] = [];
  for (const candidate of candidates) {
    if (seenSourceNodeIds.has(candidate.sourceNodeId)) continue;
    const node = nodeById.get(candidate.sourceNodeId);
    const directAsset = candidate.assetId ? assetById.get(candidate.assetId) : undefined;
    const type = node?.type ?? directAsset?.type;
    if (type !== 'image' && type !== 'video' && type !== 'audio') continue;
    const nodeAssetId = typeof node?.data?.assetId === 'string' ? node.data.assetId : undefined;
    const backingAssetId = nodeAssetId ?? candidate.assetId;
    if (!backingAssetId) continue;
    // Candidate order is the scope order: a Canvas edge (Canvas-owned
    // Timeline) or direct Timeline reference (Project-owned Timeline) comes
    // before an item's transient sidebar drag identity. Keep that canonical
    // reference and do not expose the same backing media as a second card.
    if (seenBackingAssetIds.has(backingAssetId)) continue;
    const projectAsset = directAsset ?? assetById.get(backingAssetId);
    if (!projectAsset) continue;

    seenSourceNodeIds.add(candidate.sourceNodeId);
    seenBackingAssetIds.add(backingAssetId);
    result.push({
      sourceNodeId: candidate.sourceNodeId,
      backingAssetId,
      type,
      src: projectAssetPlaybackUrl(projectAsset) ?? projectAsset.url,
      displayName: firstText(node?.data?.label, node?.data?.name, projectAsset.name),
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
>(tracks: readonly TTrack[], mediaInputs: readonly TimelineMediaInput[]): TTrack[] {
  const sourceNodeIdByBackingAssetId = new Map<string, string>();
  for (const input of mediaInputs) {
    if (!sourceNodeIdByBackingAssetId.has(input.backingAssetId)) {
      sourceNodeIdByBackingAssetId.set(input.backingAssetId, input.sourceNodeId);
    }
  }

  return tracks.map((track) => ({
    ...track,
    items: track.items.map((item) => {
      if (!item.assetId) return item;
      const sourceNodeId = sourceNodeIdByBackingAssetId.get(item.assetId);
      return !sourceNodeId || sourceNodeId === item.sourceNodeId
        ? item
        : { ...item, sourceNodeId };
    }),
  }));
}
