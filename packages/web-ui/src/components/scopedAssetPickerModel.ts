import type {
  Asset,
  AssetScopeSource,
  AssetScopeTarget,
  AssetSourceScope,
} from '@clash/shared-types';
import type { EditorAssetInput } from '@master-clash/remotion-core';
import type { ProjectAsset } from '@clash/web-ui/lib/types';
import type { AssetRelationEdge, AssetRelationNode } from '../features/assets/relations';
import { projectAssetPlaybackUrl } from '../features/assets/media-url';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.[a-z0-9]+)?$/i;
const INTERNAL_NAME_PATTERN = /^(?:https?:|data:|file:)|[\\/]/i;

function fallbackName(type: ProjectAsset['type']) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function safeScopedAssetName(asset: Pick<ProjectAsset, 'name' | 'type'>, candidate?: string) {
  const value = (candidate || asset.name)?.trim();
  if (!value || UUID_PATTERN.test(value) || INTERNAL_NAME_PATTERN.test(value)) {
    return fallbackName(asset.type);
  }
  return value;
}

export interface ScopedAssetOption {
  assetId: string;
  name: string;
  type: ProjectAsset['type'];
  src: string;
  thumbnail?: string;
  source: AssetScopeSource;
  sourceNodeId?: string;
}

export interface ScopedAssetSection {
  scope: AssetSourceScope;
  label: string;
  description: string;
  assets: ScopedAssetOption[];
  allowLocalUpload?: boolean;
}

export function buildScopedTimelineAssetInput({
  option,
  sourceNodeId,
  backingAssetId,
  asset,
}: {
  option: ScopedAssetOption;
  sourceNodeId: string;
  backingAssetId: string;
  asset?: Asset;
}): EditorAssetInput {
  return {
    id: sourceNodeId,
    backingAssetId,
    sourceNodeId,
    name: option.name,
    src: asset?.signedUrl ?? option.src,
    thumbnail: asset?.signedCoverUrl ?? option.thumbnail,
    type: option.type,
    width: asset?.metadata?.width,
    height: asset?.metadata?.height,
    duration: asset?.metadata?.durationMs
      ? asset.metadata.durationMs / 1000
      : undefined,
    waveform: asset?.metadata?.waveform,
  };
}

export function buildScopedAssetSections({
  target,
  targetState,
  projectAssets,
  globalAssets,
  nodes,
  edges = [],
}: {
  target: AssetScopeTarget;
  targetState?: unknown;
  projectAssets: ProjectAsset[];
  globalAssets: ProjectAsset[];
  nodes: AssetRelationNode[];
  edges?: AssetRelationEdge[];
}): ScopedAssetSection[] {
  const projectById = new Map<string, ProjectAsset>();
  for (const asset of projectAssets) {
    projectById.set(asset.id, asset);
    if (asset.assetId) projectById.set(asset.assetId, asset);
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const targetAssetIds = new Set<string>();
  if (target.kind === 'canvas') {
    for (const node of nodes) {
      if (node.canvasId === target.canvasId && typeof node.data?.assetId === 'string') {
        targetAssetIds.add(node.data.assetId);
      }
    }
  } else if (target.owner.kind === 'canvas-action') {
    for (const edge of edges) {
      if (
        edge.canvasId !== target.owner.canvasId
        || edge.target !== target.owner.actionNodeId
      ) continue;
      const assetId = nodeById.get(edge.source)?.data?.assetId;
      if (typeof assetId === 'string') targetAssetIds.add(assetId);
    }
  } else if (targetState && typeof targetState === 'object') {
    const refs = (targetState as { mediaAssetRefs?: unknown }).mediaAssetRefs;
    if (Array.isArray(refs)) {
      for (const ref of refs) {
        if (ref && typeof ref === 'object' && typeof (ref as { assetId?: unknown }).assetId === 'string') {
          targetAssetIds.add((ref as { assetId: string }).assetId);
        }
      }
    }
  }

  const alreadyInTarget = (asset: ProjectAsset) =>
    targetAssetIds.has(asset.id) || Boolean(asset.assetId && targetAssetIds.has(asset.assetId));
  const canvasId = target.kind === 'timeline' && target.owner.kind === 'canvas-action'
    ? target.owner.canvasId
    : undefined;
  const canvasOptions: ScopedAssetOption[] = [];
  const canvasAssetIds = new Set<string>();
  if (canvasId) {
    for (const node of nodes) {
      if (node.canvasId !== canvasId || !['image', 'video', 'audio'].includes(node.type || '')) continue;
      const assetId = typeof node.data?.assetId === 'string' ? node.data.assetId : undefined;
      const asset = assetId ? projectById.get(assetId) : undefined;
      if (!asset || !assetId || canvasAssetIds.has(assetId)) continue;
      canvasAssetIds.add(assetId);
      if (alreadyInTarget(asset)) continue;
      canvasOptions.push({
        assetId,
        sourceNodeId: node.id,
        name: safeScopedAssetName(asset, typeof node.data?.label === 'string' ? node.data.label : undefined),
        type: asset.type,
        src: projectAssetPlaybackUrl(asset) ?? asset.url,
        thumbnail: asset.thumbnailUrl,
        source: { kind: 'current-canvas', assetId, sourceNodeId: node.id, canvasId },
      });
    }
  }

  const projectOptions = projectAssets
    .filter((asset) => !alreadyInTarget(asset) && !canvasAssetIds.has(asset.assetId ?? asset.id))
    .map((asset): ScopedAssetOption => {
      const assetId = asset.assetId ?? asset.id;
      return {
        assetId,
        name: safeScopedAssetName(asset),
        type: asset.type,
        src: projectAssetPlaybackUrl(asset) ?? asset.url,
        thumbnail: asset.thumbnailUrl,
        source: { kind: 'project', assetId },
      };
    });

  const projectIds = new Set(projectAssets.flatMap((asset) => [asset.id, asset.assetId].filter(Boolean) as string[]));
  const globalOptions = globalAssets
    .filter((asset) => !alreadyInTarget(asset) && !projectIds.has(asset.assetId ?? asset.id))
    .map((asset): ScopedAssetOption => {
      const assetId = asset.assetId ?? asset.id;
      return {
        assetId,
        name: safeScopedAssetName(asset),
        type: asset.type,
        src: projectAssetPlaybackUrl(asset) ?? asset.url,
        thumbnail: asset.thumbnailUrl,
        source: { kind: 'global-library', assetId },
      };
    });

  return [
    ...(canvasId ? [{
      scope: 'current-canvas' as const,
      label: 'Current Canvas',
      description: 'Media already placed on this Canvas.',
      assets: canvasOptions,
    }] : []),
    {
      scope: 'project' as const,
      label: 'Project',
      description: 'Media already referenced by this Project.',
      assets: projectOptions,
    },
    {
      scope: 'external' as const,
      label: 'More sources',
      description: 'Choose from Global Assets or upload from this Mac.',
      assets: globalOptions,
      allowLocalUpload: true,
    },
  ];
}
