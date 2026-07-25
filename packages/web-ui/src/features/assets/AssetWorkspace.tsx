import { useCallback, useMemo } from 'react';
import type { ProjectCanvas, ProjectTimeline } from '@clash/shared-types';
import type { ProjectAsset } from '@clash/web-ui/lib/types';
import { useAsset } from '../../lib/hooks/useAsset';
import type { EditApplyResult } from './action-client';
import { ImageEditorPanel } from '../../components/ImageEditorContext';
import { VideoClipperPanel } from '../../components/VideoClipperContext';
import {
  ProjectAssetSurface,
  type ProjectAssetEditMetadata,
} from '../../components/ProjectWorkspaceSurfaces';
import { AssetRelationsPanel } from './AssetRelationsPanel';
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
  onOpenCanvas,
  onOpenTimeline,
  onOpenAsset,
  onApplied,
  headerEndInset = 0,
}: {
  asset: ProjectAsset;
  projectId: string;
  projectAssets?: ProjectAsset[];
  canvases?: ProjectCanvas[];
  timelines?: ProjectTimeline[];
  relationNodes?: AssetRelationNode[];
  relationEdges?: AssetRelationEdge[];
  onOpenCanvas?: (canvasId: string, nodeId?: string) => void;
  onOpenTimeline?: (timelineId: string) => void;
  onOpenAsset?: (assetId: string) => void;
  onApplied: (result: EditApplyResult) => void | Promise<void>;
  headerEndInset?: number;
}) {
  const sourceR2Key = asset.storageKey?.trim();
  const sourceAssetId = asset.assetId ?? asset.id;
  const assetRecord = useAsset(sourceAssetId);
  const relations = useMemo(
    () => buildAssetRelationSummary({
      assetId: sourceAssetId,
      asset: assetRecord,
      projectAssets,
      canvases,
      timelines,
      nodes: relationNodes,
      edges: relationEdges,
    }),
    [assetRecord, canvases, projectAssets, relationEdges, relationNodes, sourceAssetId, timelines],
  );

  const renderEditor = useCallback(
    (metadata: ProjectAssetEditMetadata, close: () => void) => {
      if (!sourceR2Key) return null;
      if (asset.type === 'image' && 'naturalWidth' in metadata) {
        return (
          <ImageEditorPanel
            input={{
              projectId,
              sourceAssetId,
              sourceR2Key,
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
      if (asset.type === 'video' && 'durationSec' in metadata) {
        return (
          <VideoClipperPanel
            input={{
              projectId,
              sourceAssetId,
              sourceR2Key,
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
    [asset.type, onApplied, projectId, sourceAssetId, sourceR2Key],
  );

  return (
    <ProjectAssetSurface
      asset={asset}
      headerEndInset={headerEndInset}
      renderEditor={sourceR2Key ? renderEditor : undefined}
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
