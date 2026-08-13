import { useCallback, useMemo, useState } from 'react';
import type { ProjectCanvas, ProjectTimeline, ResolvedAsset } from '@clash/shared-types';
import { useAsset } from '../../lib/hooks/useAsset';
import type { EditApplyResult } from './action-client';
import { ImageEditorPanel } from '../../components/ImageEditorContext';
import { VideoClipperPanel } from '../../components/VideoClipperContext';
import {
  ProjectAssetSurface,
  type ProjectAssetEditMetadata,
} from '../../components/ProjectWorkspaceSurfaces';
import { AssetRelationsPanel } from './AssetRelationsPanel';
import { Button } from '../../components/ui/button';
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
  isProjectCover = false,
  onProjectCoverChange,
  headerEndInset = 0,
}: {
  asset: ResolvedAsset;
  projectId: string;
  projectAssets?: ResolvedAsset[];
  canvases?: ProjectCanvas[];
  timelines?: ProjectTimeline[];
  relationNodes?: AssetRelationNode[];
  relationEdges?: AssetRelationEdge[];
  onOpenCanvas?: (canvasId: string, nodeId?: string) => void;
  onOpenTimeline?: (timelineId: string) => void;
  onOpenAsset?: (assetId: string) => void;
  onApplied: (result: EditApplyResult) => void | Promise<void>;
  isProjectCover?: boolean;
  onProjectCoverChange?: (isCover: boolean) => void | Promise<void>;
  headerEndInset?: number;
}) {
  const sourceUrl = asset.url?.trim();
  const sourceAssetId = asset.id;
  const assetRecord = useAsset(projectId, sourceAssetId);
  const [coverBusy, setCoverBusy] = useState(false);
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
      if (!sourceUrl) return null;
      if (asset.kind === 'image' && 'naturalWidth' in metadata) {
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
      if (asset.kind === 'video' && 'durationSec' in metadata) {
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
    [asset.kind, onApplied, projectId, sourceAssetId, sourceUrl],
  );

  const toggleProjectCover = useCallback(async () => {
    if (!onProjectCoverChange || coverBusy) return;
    setCoverBusy(true);
    try {
      await onProjectCoverChange(!isProjectCover);
    } finally {
      setCoverBusy(false);
    }
  }, [coverBusy, isProjectCover, onProjectCoverChange]);

  const canBeProjectCover = asset.kind === 'image' || asset.kind === 'video';

  return (
    <ProjectAssetSurface
      asset={asset}
      headerEndInset={headerEndInset}
      headerAction={canBeProjectCover && onProjectCoverChange ? (
        <Button
          size="sm"
          shape="rounded"
          aria-pressed={isProjectCover}
          disabled={coverBusy}
          onClick={() => void toggleProjectCover()}
          className="h-7 min-h-7 rounded-md border-warm-border bg-warm-surface px-2.5 text-xs font-semibold text-content-secondary shadow-none hover:bg-warm-hover hover:text-content-primary"
        >
          {isProjectCover ? 'Remove project cover' : 'Use as project cover'}
        </Button>
      ) : undefined}
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
