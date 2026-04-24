import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  Audio,
  Img,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';
import { getItemLookupIds, type Track, type Item } from '@master-clash/remotion-core';

// Debug logging disabled for performance

type ResolvedTimelineItem = Item & {
  naturalWidth?: number;
  naturalHeight?: number;
  resolvedSrcUrl?: string;
};

type PreparedSequenceItem = {
  item: ResolvedTimelineItem;
  seqFrom: number;
  visibleFromRel: number;
  endFrameRel: number;
  isGlobalEndItem: boolean;
};

type PreparedTrack = {
  id: string;
  hidden?: boolean;
  playbackItems: PreparedSequenceItem[];
};

/**
 * Resolves timeline item references to asset data.
 *
 * Timeline items store sourceNodeId plus, when known, assetId references.
 * This function resolves those references to the actual src/type/dimensions
 * data from asset nodes.
 * This is the frontend equivalent of the backend resolve_item function.
 *
 * @param item Timeline item with potential assetId reference
 * @param allNodesMap Map of all nodes (node ID -> node data)
 * @returns Item with src/type/dimensions resolved from asset node if assetId present
 */
const resolveTimelineItem = (
  item: Item,
  allNodesMap: Map<string, any>,
  srcNodeMap: Map<string, any>,
): ResolvedTimelineItem => {
  let asset = null;

  // 1. Try explicit source node id, then backing asset id, with legacy fallback.
  for (const lookupId of getItemLookupIds(item)) {
    asset = allNodesMap.get(lookupId);
    if (asset) {
      break;
    }
  }

  // 2. If not found by references, try to find by src
  if (!asset && 'src' in item) {
    const itemSrc = (item as any).src;
    asset = srcNodeMap.get(itemSrc) ?? null;
  }

  if (asset) {
    const assetData = asset.data || {};

    // Get natural dimensions from asset node
    let naturalWidth = assetData.naturalWidth;
    let naturalHeight = assetData.naturalHeight;

    // Fallback: parse aspectRatio string (e.g., "16:9") if no natural dimensions
    if ((!naturalWidth || !naturalHeight) && assetData.aspectRatio) {
      const ar = assetData.aspectRatio;
      if (typeof ar === 'string' && ar.includes(':')) {
        const [w, h] = ar.split(':').map(Number);
        if (w && h) {
          // Use 1920 as base width to calculate virtual dimensions
          naturalWidth = 1920;
          naturalHeight = Math.round(1920 * h / w);
        }
      }
    }

    return {
      ...item,
      src: assetData.src || ('src' in item ? item.src : undefined),
      type: asset.type || item.type,
      naturalWidth,
      naturalHeight,
      resolvedSrcUrl: resolveAssetUrl(assetData.src || ('src' in item ? item.src : undefined)),
    };
  }

  // Return as-is for non-asset items (solid, text) or if asset not found
  return {
    ...item,
    resolvedSrcUrl: resolveAssetUrl('src' in item ? item.src : undefined),
  };
};

const mergeContiguousMediaItems = (items: ResolvedTimelineItem[]): ResolvedTimelineItem[] => {
  const sorted = [...items].sort((a, b) => a.from - b.from);
  const result: ResolvedTimelineItem[] = [];

  for (const itm of sorted) {
    const last = result[result.length - 1];
    const isMedia = itm.type === 'video' || itm.type === 'audio';
    const lastIsMedia = last && (last.type === 'video' || last.type === 'audio');

    if (
      last &&
      isMedia &&
      lastIsMedia &&
      last.resolvedSrcUrl &&
      itm.resolvedSrcUrl &&
      itm.resolvedSrcUrl === last.resolvedSrcUrl
    ) {
      const lastEnd = last.from + last.durationInFrames;
      const isContiguous = itm.from === lastEnd;
      const lastOffset = (last as any).sourceStartInFrames || 0;
      const currOffset = (itm as any).sourceStartInFrames || 0;
      const offsetContinuous = currOffset === lastOffset + last.durationInFrames;

      if (isContiguous && offsetContinuous) {
        result[result.length - 1] = {
          ...last,
          durationInFrames: last.durationInFrames + itm.durationInFrames,
        };
        continue;
      }
    }

    result.push({ ...itm });
  }

  return result;
};

// Helper to ensure src is a proper URL
const resolveAssetUrl = (src: string | undefined): string => {
  if (!src) return '';

  // Already a full URL
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }

  // Already a view URL
  if (src.startsWith('/api/assets/view/')) {
    return src;
  }

  // Data URL
  if (src.startsWith('data:')) {
    return src;
  }

  // R2 key format (projects/...) - convert to view URL
  if (src.startsWith('projects/')) {
    return `/api/assets/view/${src}`;
  }

  // Other paths starting with /
  if (src.startsWith('/')) {
    return src;
  }

  // Default: treat as R2 key
  return `/api/assets/view/${src}`;
};

// Component to render individual items.
//
// IMPORTANT: `visibleFrom` and `endFrame` are SEQUENCE-RELATIVE frames (i.e.
// offsets from the enclosing <Sequence from=...>'s start), not composition-
// absolute frames. `useCurrentFrame()` inside a Sequence is sequence-relative
// too, so the comparisons below line up. Mixing the two coord systems was the
// original bug: every item with `item.from > 0` was computing `hidden=true`
// for its entire Sequence and only the outer black-bg wrapper showed.
const ItemComponent: React.FC<{
  item: ResolvedTimelineItem;
  durationInFrames: number;
  visibleFrom?: number;
  endFrame?: number;
  isGlobalEndItem?: boolean;
  trackZIndex: number;
  itemsDomMapRef?: React.RefObject<Map<string, HTMLElement>>;
}> = ({ item, durationInFrames: _durationInFrames, visibleFrom, endFrame, isGlobalEndItem, trackZIndex, itemsDomMapRef }) => {
  const frame = useCurrentFrame();
  const { width: compWidth, height: compHeight } = useVideoConfig();
  const resolvedItem = item;

  // Apply transform properties
  // width and height are scale factors relative to the asset's natural dimensions
  // width=1, height=1 means 100% of the asset's original size (not canvas size)
  const transformStyle = React.useMemo((): React.CSSProperties => {
    const props = resolvedItem.properties;
    if (!props) return { zIndex: trackZIndex };

    // Get natural dimensions from resolved item
    const naturalWidth = resolvedItem.naturalWidth || compWidth;
    const naturalHeight = resolvedItem.naturalHeight || compHeight;

    // Scale relative to natural dimensions
    // props.width/height are multipliers of the asset's natural size
    let widthPx: number;
    let heightPx: number;

    // When both width and height are 1, contain in canvas (preserve aspect ratio)
    if (props.width === 1 && props.height === 1) {
      const scaleX = compWidth / naturalWidth;
      const scaleY = compHeight / naturalHeight;
      const scale = Math.min(scaleX, scaleY);
      widthPx = naturalWidth * scale;
      heightPx = naturalHeight * scale;
    } else {
      // Normal scaling: props.width/height are multipliers of natural dimensions
      widthPx = props.width * naturalWidth;
      heightPx = props.height * naturalHeight;
    }

    const widthPercent = (widthPx / compWidth) * 100;
    const heightPercent = (heightPx / compHeight) * 100;


    // Position from center (x, y in pixels from canvas center)
    const left = `calc(50% + ${props.x}px)`;
    const top = `calc(50% + ${props.y}px)`;

    return {
      position: 'absolute',
      left,
      top,
      width: `${widthPercent}%`,
      height: `${heightPercent}%`,
      // translate(-50%, -50%) centers the item on the specified position
      transform: `translate(-50%, -50%) rotate(${props.rotation || 0}deg)`,
      opacity: props.opacity ?? 1,
      zIndex: trackZIndex, // Use track-based z-index
    };
  }, [resolvedItem.properties, resolvedItem.naturalWidth, resolvedItem.naturalHeight, compWidth, compHeight, trackZIndex]);

  const applyTransform = React.useCallback(
    (baseStyle: React.CSSProperties = {}): React.CSSProperties => ({
      ...transformStyle,
      ...baseStyle,
    }),
    [transformStyle],
  );

  if (resolvedItem.type === 'solid') {
    return (
      <AbsoluteFill
        ref={(el) => {
          if (!itemsDomMapRef?.current || !el) return;
          itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
        }}
        style={applyTransform({ backgroundColor: resolvedItem.color })}
      />
    );
  }

  if (resolvedItem.type === 'text') {
    const fadeOpacity = interpolate(frame, [0, 10], [0, 1], {
      extrapolateRight: 'clamp',
    });

    return (
      <AbsoluteFill
        ref={(el) => {
          if (!itemsDomMapRef?.current || !el) return;
          itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
        }}
        style={applyTransform({
          justifyContent: 'center',
          alignItems: 'center',
          opacity: fadeOpacity,
        })}
      >
        <h1
          style={{
            color: resolvedItem.color,
            fontSize: resolvedItem.fontSize || 60,
            fontFamily: resolvedItem.fontFamily || 'Arial',
            fontWeight: resolvedItem.fontWeight || 'bold',
            textAlign: 'center',
            padding: '0 40px',
          }}
        >
          {resolvedItem.text}
        </h1>
      </AbsoluteFill>
    );
  }

  if (resolvedItem.type === 'video') {
    const sourceStart = (resolvedItem as any).sourceStartInFrames || 0;
    const isBeforeVisible = typeof visibleFrom === 'number' ? frame < visibleFrom : false;
    const isLastFrameOfItem = typeof endFrame === 'number' ? frame === endFrame : false;
    // Skip the global-end item's last frame guard — that item is supposed to
    // still be visible at the composition's final frame.
    const shouldHideLastFrame = !isGlobalEndItem && isLastFrameOfItem;
    const hidden = isBeforeVisible || shouldHideLastFrame;
    const resolvedSrc = resolvedItem.resolvedSrcUrl || resolveAssetUrl(resolvedItem.src);

    return (
      <AbsoluteFill
        ref={(el) => {
          if (!itemsDomMapRef?.current || !el) return;
          itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
        }}
        style={applyTransform({ backgroundColor: 'black' })}
      >
        <AbsoluteFill style={{ opacity: hidden ? 0 : 1, width: '100%', height: '100%' }}>
          <OffthreadVideo
            src={resolvedSrc}
            style={{ width: '100%', height: '100%', objectFit: 'fill' }}
            startFrom={sourceStart}
            pauseWhenBuffering={false}
            acceptableTimeShiftInSeconds={0.25}
            muted={hidden}
            volume={1}
          />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  if (resolvedItem.type === 'audio') {
    const sourceStart = (resolvedItem as any).sourceStartInFrames || 0;
    const baseVolume = resolvedItem.volume || 1;
    return <Audio src={resolvedItem.resolvedSrcUrl || resolveAssetUrl(resolvedItem.src)} startFrom={sourceStart} volume={baseVolume} />;
  }

  if (resolvedItem.type === 'image') {
    return (
      <AbsoluteFill
        style={applyTransform({
          justifyContent: 'center',
          alignItems: 'center',
        })}
      >
        <Img
          src={resolvedItem.resolvedSrcUrl || resolveAssetUrl(resolvedItem.src)}
          ref={(el) => {
            if (!itemsDomMapRef?.current || !el) return;
            itemsDomMapRef.current.set(resolvedItem.id, el as HTMLElement);
          }}
          style={{ width: '100%', height: '100%', objectFit: 'fill' }}
        />
      </AbsoluteFill>
    );
  }

  return null;
};

// Component to render a single track
const TrackComponent: React.FC<{
  track: PreparedTrack;
  trackZIndex: number;
  itemsDomMapRef?: React.RefObject<Map<string, HTMLElement>>;
}> = React.memo(({ track, trackZIndex, itemsDomMapRef }) => {
  if (track.hidden) {
    return null;
  }

  const PREMOUNT_FRAMES = 45; // ~1.5秒@30fps，提前挂载以减少边界卡顿

  return (
    <AbsoluteFill>
      {track.playbackItems.map(({ item, seqFrom, visibleFromRel, endFrameRel, isGlobalEndItem }) => {
        return (
          <Sequence key={item.id} from={seqFrom} durationInFrames={item.durationInFrames} premountFor={PREMOUNT_FRAMES}>
            <ItemComponent item={item} durationInFrames={item.durationInFrames} visibleFrom={visibleFromRel} endFrame={endFrameRel} isGlobalEndItem={isGlobalEndItem} trackZIndex={trackZIndex} itemsDomMapRef={itemsDomMapRef} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
});

// Main composition component
export const VideoComposition: React.FC<{
  tracks: Track[];
  allNodes?: Map<string, any>; // Map of node ID -> node data for resolving assetId references
  selectedItemId?: string | null;
  selectionBoxRef?: React.RefObject<HTMLDivElement | null>;
  itemsDomMapRef?: React.RefObject<Map<string, HTMLElement>>;
}> = ({ tracks, allNodes, selectedItemId, selectionBoxRef, itemsDomMapRef }) => {
  const { width: compWidth, height: compHeight } = useVideoConfig();

  console.log('[VideoComposition] INPUT', {
    tracks: tracks?.map((t) => ({
      name: t.name,
      id: t.id,
      items: t.items?.map((it: any) => ({
        id: it.id,
        type: it.type,
        from: it.from,
        durationInFrames: it.durationInFrames,
        sourceNodeId: it.sourceNodeId,
        assetId: it.assetId,
        src: it.src?.slice?.(0, 80),
      })),
    })),
    allNodesCount: allNodes?.size ?? 0,
    allNodesEntries: allNodes
      ? [...allNodes.entries()].slice(0, 20).map(([k, v]) => ({
          key: k,
          type: v?.type,
          src: v?.data?.src?.slice?.(0, 80),
          naturalW: v?.data?.naturalWidth,
          naturalH: v?.data?.naturalHeight,
          dataKeys: v?.data ? Object.keys(v.data) : null,
        }))
      : [],
  });

  // Create empty nodes map if not provided (for backward compatibility)
  const nodesMap = React.useMemo(() => allNodes || new Map(), [allNodes]);
  const srcNodeMap = React.useMemo(() => {
    const next = new Map<string, any>();
    for (const [, node] of nodesMap.entries()) {
      const src = node?.data?.src;
      if (src) {
        next.set(src, node);
      }
    }
    return next;
  }, [nodesMap]);

  // 计算全局最后一帧（与上面的 TrackComponent 用到的 globalEndFrame 保持一致）
  const globalEndFrame = React.useMemo(() => {
    let maxEnd = 0;
    for (const t of tracks) {
      for (const itm of t.items) {
        const end = itm.from + itm.durationInFrames - 1;
        if (end > maxEnd) maxEnd = end;
      }
    }
    return maxEnd;
  }, [tracks]);

  const preparedTracks = React.useMemo<PreparedTrack[]>(() => {
    return tracks.map((track) => {
      const resolvedItems = track.items.map((item) => resolveTimelineItem(item, nodesMap, srcNodeMap));
      const mergedItems = mergeContiguousMediaItems(resolvedItems);
      const playbackItems = mergedItems.map((item, idx) => {
        const prev = idx > 0 ? mergedItems[idx - 1] : undefined;
        const isPrevContiguous =
          !!prev &&
          prev.type === item.type &&
          !!prev.resolvedSrcUrl &&
          !!item.resolvedSrcUrl &&
          prev.resolvedSrcUrl === item.resolvedSrcUrl &&
          prev.from + prev.durationInFrames === item.from &&
          (((prev as any).sourceStartInFrames || 0) + prev.durationInFrames === ((item as any).sourceStartInFrames || 0));

        const seqFrom = isPrevContiguous ? Math.max(0, item.from - 1) : item.from;
        const visibleFromRel = item.from - seqFrom;
        const endFrameRel = (item.from + item.durationInFrames - 1) - seqFrom;
        const isGlobalEndItem = item.from + item.durationInFrames - 1 === globalEndFrame;

        return {
          item,
          seqFrom,
          visibleFromRel,
          endFrameRel,
          isGlobalEndItem,
        };
      });

      return {
        id: track.id,
        hidden: track.hidden,
        playbackItems,
      };
    });
  }, [tracks, nodesMap, srcNodeMap, globalEndFrame]);

  // 找到选中的 item 和它的 properties，同时解析 natural dimensions
  const selectedItemResolved = React.useMemo(() => {
    if (!selectedItemId) return null;
    for (const track of preparedTracks) {
      const matched = track.playbackItems.find(({ item }) => item.id === selectedItemId);
      if (matched) {
        return matched.item;
      }
    }
    return null;
  }, [preparedTracks, selectedItemId]);

  // Calculate selection box dimensions using the same logic as applyTransform
  const selectionBoxStyle = React.useMemo(() => {
    if (!selectedItemResolved?.properties) return null;

    const props = selectedItemResolved.properties;
    const naturalWidth = (selectedItemResolved as any).naturalWidth || compWidth;
    const naturalHeight = (selectedItemResolved as any).naturalHeight || compHeight;

    // Scale relative to natural dimensions
    // props.width/height are multipliers of the asset's natural size
    let widthPx: number;
    let heightPx: number;

    // When both width and height are 1, contain in canvas (preserve aspect ratio)
    if (props.width === 1 && props.height === 1) {
      const scaleX = compWidth / naturalWidth;
      const scaleY = compHeight / naturalHeight;
      const scale = Math.min(scaleX, scaleY);
      widthPx = naturalWidth * scale;
      heightPx = naturalHeight * scale;
    } else {
      // Normal scaling: props.width/height are multipliers of natural dimensions
      widthPx = props.width * naturalWidth;
      heightPx = props.height * naturalHeight;
    }

    const widthPercent = (widthPx / compWidth) * 100;
    const heightPercent = (heightPx / compHeight) * 100;

    return {
      position: 'absolute' as const,
      left: `calc(50% + ${props.x}px)`,
      top: `calc(50% + ${props.y}px)`,
      width: `${widthPercent}%`,
      height: `${heightPercent}%`,
      transform: `translate(-50%, -50%)`,
      boxSizing: 'border-box' as const,
    };
  }, [selectedItemResolved, compWidth, compHeight]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black', top: 0, left: 0, right: 0, bottom: 0 }}>
      {preparedTracks.map((track, trackIndex) => {
        // Track 0 (first/top) should have highest z-index
        // Higher index = lower in timeline = lower z-index
        const trackZIndex = preparedTracks.length - trackIndex;
        return (
          <TrackComponent key={`${track.id}-${trackIndex}`} track={track} trackZIndex={trackZIndex} itemsDomMapRef={itemsDomMapRef} />
        );
      })}

      {/* 选择框 - 透明的，只用于提供 ref（不包含旋转） */}
      {selectedItemResolved && selectionBoxStyle && (
        <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 9999 }}>
          <div
            ref={selectionBoxRef}
            style={selectionBoxStyle}
          />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
