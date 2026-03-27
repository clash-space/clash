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
import type { Track, Item } from '@master-clash/remotion-core';

// Debug logging disabled for performance

/**
 * Resolves timeline item references to asset data.
 *
 * Timeline items store only assetId references. This function resolves
 * those references to the actual src/type/dimensions data from asset nodes.
 * This is the frontend equivalent of the backend resolve_item function.
 *
 * @param item Timeline item with potential assetId reference
 * @param allNodesMap Map of all nodes (node ID -> node data)
 * @returns Item with src/type/dimensions resolved from asset node if assetId present
 */
const resolveTimelineItem = (item: Item, allNodesMap: Map<string, any>): Item & { naturalWidth?: number; naturalHeight?: number } => {
  let asset = null;

  // 1. Try to find asset by assetId
  if (item.assetId) {
    asset = allNodesMap.get(item.assetId);
  }

  // 2. If not found by assetId, try to find by src
  if (!asset && 'src' in item) {
    const itemSrc = (item as any).src;
    // Iterate over all assets to find a match by src
    for (const [_, node] of allNodesMap.entries()) {
      if (node.data?.src === itemSrc) {
        asset = node;
        break;
      }
    }
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
    };
  }

  // Return as-is for non-asset items (solid, text) or if asset not found
  return item;
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

// Component to render individual items
const ItemComponent: React.FC<{ item: Item; allNodesMap: Map<string, any>; durationInFrames: number; visibleFrom?: number; endFrame?: number; globalEndFrame?: number; trackZIndex: number; itemsDomMapRef?: React.RefObject<Map<string, HTMLElement>> }> = ({ item, allNodesMap, durationInFrames: _durationInFrames, visibleFrom, endFrame, globalEndFrame, trackZIndex, itemsDomMapRef }) => {
  const frame = useCurrentFrame();
  const { width: compWidth, height: compHeight } = useVideoConfig();

  // Resolve item references dynamically from asset nodes
  const resolvedItem = resolveTimelineItem(item, allNodesMap);

  // Apply transform properties
  // width and height are scale factors relative to the asset's natural dimensions
  // width=1, height=1 means 100% of the asset's original size (not canvas size)
  const applyTransform = (baseStyle: React.CSSProperties = {}): React.CSSProperties => {
    const props = resolvedItem.properties;
    if (!props) return { ...baseStyle, zIndex: trackZIndex };

    // Get natural dimensions from resolved item
    const naturalWidth = (resolvedItem as any).naturalWidth || compWidth;
    const naturalHeight = (resolvedItem as any).naturalHeight || compHeight;

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
      ...baseStyle,
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
  };

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
    const shouldHideLastFrame = typeof globalEndFrame === 'number' && typeof endFrame === 'number'
      ? (endFrame !== globalEndFrame && isLastFrameOfItem)
      : false;
    const hidden = isBeforeVisible || shouldHideLastFrame;

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
            src={resolveAssetUrl(resolvedItem.src)}
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
    return <Audio src={resolveAssetUrl(resolvedItem.src)} startFrom={sourceStart} volume={baseVolume} />;
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
          src={resolveAssetUrl(resolvedItem.src)}
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
const TrackComponent: React.FC<{ track: Track; allNodesMap: Map<string, any>; globalEndFrame: number; trackZIndex: number; itemsDomMapRef?: React.RefObject<Map<string, HTMLElement>> }> = ({ track, allNodesMap, globalEndFrame, trackZIndex, itemsDomMapRef }) => {
  if (track.hidden) {
    return null;
  }

  // 合并同源且时间/偏移连续的媒体分段（仅渲染层副本，不改state）
  const mergeContiguousMediaItems = (items: Item[]): Item[] => {
    const sorted = [...items].sort((a, b) => a.from - b.from);
    const result: Item[] = [];

    for (const itm of sorted) {
      const last = result[result.length - 1];
      const isMedia = itm.type === 'video' || itm.type === 'audio';
      const lastIsMedia = last && (last.type === 'video' || last.type === 'audio');

      if (
        last && isMedia && lastIsMedia && ('src' in itm) && ('src' in last) && (itm as any).src === (last as any).src
      ) {
        const lastEnd = last.from + last.durationInFrames;
        const isContiguous = itm.from === lastEnd;
        const lastOffset = (last as any).sourceStartInFrames || 0;
        const currOffset = (itm as any).sourceStartInFrames || 0;
        const offsetContinuous = currOffset === lastOffset + last.durationInFrames;

        if (isContiguous && offsetContinuous) {
          // 合并：延长上一段的时长（使用副本）
          const extended = { ...last, durationInFrames: last.durationInFrames + itm.durationInFrames } as Item;
          result[result.length - 1] = extended;
          continue;
        }
      }

      result.push({ ...itm } as Item);
    }

    return result;
  };

  const playbackItems = mergeContiguousMediaItems(track.items);

  const PREMOUNT_FRAMES = 45; // ~1.5秒@30fps，提前挂载以减少边界卡顿

  return (
    <AbsoluteFill>
      {playbackItems.map((item, idx) => {
        const prev = idx > 0 ? playbackItems[idx - 1] : undefined;
        const isPrevContiguous = prev && (prev.type === item.type) && ('src' in prev) && ('src' in item)
          && (prev as any).src === (item as any).src
          && (prev.from + prev.durationInFrames === item.from)
          && (((prev as any).sourceStartInFrames || 0) + prev.durationInFrames === ((item as any).sourceStartInFrames || 0));

        const seqFrom = isPrevContiguous ? Math.max(0, item.from - 1) : item.from;
        const visibleFrom = item.from;
        const endFrame = item.from + item.durationInFrames - 1;

        return (
          <Sequence key={item.id} from={seqFrom} durationInFrames={item.durationInFrames} premountFor={PREMOUNT_FRAMES}>
            <ItemComponent item={item} allNodesMap={allNodesMap} durationInFrames={item.durationInFrames} visibleFrom={visibleFrom} endFrame={endFrame} globalEndFrame={globalEndFrame} trackZIndex={trackZIndex} itemsDomMapRef={itemsDomMapRef} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

// Main composition component
export const VideoComposition: React.FC<{
  tracks: Track[];
  allNodes?: Map<string, any>; // Map of node ID -> node data for resolving assetId references
  selectedItemId?: string | null;
  selectionBoxRef?: React.RefObject<HTMLDivElement | null>;
  itemsDomMapRef?: React.RefObject<Map<string, HTMLElement>>;
}> = ({ tracks, allNodes, selectedItemId, selectionBoxRef, itemsDomMapRef }) => {
  const { width: compWidth, height: compHeight } = useVideoConfig();

  // Create empty nodes map if not provided (for backward compatibility)
  const nodesMap = allNodes || new Map();

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

  // 找到选中的 item 和它的 properties，同时解析 natural dimensions
  const selectedItemResolved = React.useMemo(() => {
    if (!selectedItemId) return null;
    for (const track of tracks) {
      const item = track.items.find((i) => i.id === selectedItemId);
      if (item) {
        return resolveTimelineItem(item, nodesMap);
      }
    }
    return null;
  }, [tracks, selectedItemId, nodesMap]);

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
      {tracks.map((track, trackIndex) => {
        // Track 0 (first/top) should have highest z-index
        // Higher index = lower in timeline = lower z-index
        const trackZIndex = tracks.length - trackIndex;
        return (
          <TrackComponent key={`${track.id}-${trackIndex}`} track={track} allNodesMap={nodesMap} globalEndFrame={globalEndFrame} trackZIndex={trackZIndex} itemsDomMapRef={itemsDomMapRef} />
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
