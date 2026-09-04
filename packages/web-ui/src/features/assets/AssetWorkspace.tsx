import { useCallback, useMemo } from 'react';
import type {
  ActionAssetBinding,
  ProjectCanvas,
  ProjectTimeline,
  ResolvedAsset,
} from '@clash/shared-types';
import { useAsset } from '../../lib/hooks/useAsset';
import type { EditApplyResult } from './action-client';
import { ImageEditorPanel } from '../../components/ImageEditorContext';
import { VideoClipperPanel } from '../../components/VideoClipperContext';
import {
  ProjectAssetSurface,
  type ProjectAssetEditMetadata,
} from '../../components/ProjectWorkspaceSurfaces';
import { AssetRelationsPanel } from './AssetRelationsPanel';
import { mergeResolvedAssetProjection } from './projectAssetPresentation';
import {
  buildAssetRelationSummary,
  type AssetRelationEdge,
  type AssetRelationNode,
} from './relations';

/**
 * Asset feature entry point. Preview and edit are presentation states of the
 * same workspace; edit execution remains an immutable asset action.
 */
export function EditableProjectAssetSurface({
  asset,
  projectId,
  projectAssets = [],
  canvases = [],
  timelines = [],
  relationNodes = [],
  relationEdges = [],
  relationBindings = [],
  onOpenCanvas,
  onOpenTimeline,
  onOpenAsset,
  onApplied,
  headerEndInset = 0,
}: {
  asset: ResolvedAsset;
  projectId: string;
  projectAssets?: ResolvedAsset[];
  canvases?: ProjectCanvas[];
  timelines?: ProjectTimeline[];
  relationNodes?: AssetRelationNode[];
  relationEdges?: AssetRelationEdge[];
  relationBindings?: ActionAssetBinding[];
  onOpenCanvas?: (canvasId: string, nodeId?: string) => void;
  onOpenTimeline?: (timelineId: string) => void;
  onOpenAsset?: (assetId: string) => void;
  onApplied: (result: EditApplyResult) => void | Promise<void>;
  headerEndInset?: number;
}) {
  const sourceAssetId = asset.id;
  const assetRecord = useAsset(projectId, sourceAssetId);
  const resolvedAsset = assetRecord
    ? mergeResolvedAssetProjection(assetRecord, asset)
    : asset;
  const sourceUrl =
    resolvedAsset.status === 'ready' ? resolvedAsset.url?.trim() : undefined;
  const relations = useMemo(
    () => buildAssetRelationSummary({
      assetId: sourceAssetId,
      asset: resolvedAsset,
      projectAssets,
      canvases,
      timelines,
      nodes: relationNodes,
      edges: relationEdges,
      bindings: relationBindings,
    }),
    [
      canvases,
      projectAssets,
      relationBindings,
      relationEdges,
      relationNodes,
      resolvedAsset,
      sourceAssetId,
      timelines,
    ],
  );

  const renderEditor = useCallback(
    (metadata: ProjectAssetEditMetadata, close: () => void) => {
      if (!sourceUrl) return null;
      if (resolvedAsset.kind === 'image' && 'naturalWidth' in metadata) {
        return (
          <ImageEditorPanel
            input={{
              projectId,
              sourceAssetId,
              sourceUrl,
              naturalWidth: metadata.naturalWidth,
              naturalHeight: metadata.naturalHeight,
              initialParams: {},
              origin: 'asset-preview',
              onApplied,
            }}
            loroSync={null}
            onClose={close}
          />
        );
      }
      if (resolvedAsset.kind === 'video' && 'durationSec' in metadata) {
        return (
          <VideoClipperPanel
            input={{
              projectId,
              sourceAssetId,
              sourceUrl,
              durationSec: metadata.durationSec,
              initialParams: undefined,
              origin: 'asset-preview',
              onApplied,
            }}
            loroSync={null}
            onClose={close}
          />
        );
      }
      return null;
    },
    [onApplied, projectId, resolvedAsset.kind, sourceAssetId, sourceUrl],
  );

  return (
    <ProjectAssetSurface
      asset={resolvedAsset}
      headerEndInset={headerEndInset}
      renderEditor={sourceUrl ? renderEditor : undefined}
      inspector={(
        <AssetRelationsPanel
          relations={relations}
          onOpenCanvas={onOpenCanvas}
          onOpenTimeline={onOpenTimeline}
          onOpenAsset={onOpenAsset}
        />
      )}
    />
  );
}
