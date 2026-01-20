import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  Audio,
  Img,
  useCurrentFrame,
  interpolate,
} from 'remotion';
import type { Track, Item } from '@master-clash/remotion-core';

// Debug logging disabled for performance
// console.log('🎬 VideoComposition.tsx module loaded!');

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
const ItemComponent: React.FC<{ item: Item; durationInFrames: number; visibleFrom?: number; endFrame?: number; globalEndFrame?: number; trackZIndex: number; itemsDomMapRef?: React.RefObject<Map<string, HTMLElement>> }> = ({ item, durationInFrames: _durationInFrames, visibleFrom, endFrame, globalEndFrame, trackZIndex, itemsDomMapRef }) => {
  const frame = useCurrentFrame();

  // Apply transform properties
  const applyTransform = (baseStyle: React.CSSProperties = {}): React.CSSProperties => {
    const props = item.properties;
    if (!props) return { ...baseStyle, zIndex: trackZIndex };

    // Position from center (x, y in pixels from canvas center)
    // Canvas center is at 50%, 50%
    const left = `calc(50% + ${props.x}px)`;
    const top = `calc(50% + ${props.y}px)`;
    const width = `${props.width * 100}%`;
    const height = `${props.height * 100}%`;

    return {
      ...baseStyle,
      position: 'absolute',
      left,
      top,
      width,
      height,
      // translate(-50%, -50%) centers the item on the specified position
      transform: `translate(-50%, -50%) rotate(${props.rotation || 0}deg)`,
      opacity: props.opacity ?? 1,
      zIndex: trackZIndex, // Use track-based z-index
    };
  };

  if (item.type === 'solid') {
    return (
      <AbsoluteFill
        ref={(el) => {
          if (!itemsDomMapRef?.current || !el) return;
          itemsDomMapRef.current.set(item.id, el as HTMLElement);
        }}
        style={applyTransform({ backgroundColor: item.color })}
      />
    );
  }

  if (item.type === 'text') {
    const fadeOpacity = interpolate(frame, [0, 10], [0, 1], {
      extrapolateRight: 'clamp',
    });

    return (
      <AbsoluteFill
        ref={(el) => {
          if (!itemsDomMapRef?.current || !el) return;
          itemsDomMapRef.current.set(item.id, el as HTMLElement);
        }}
        style={applyTransform({
          justifyContent: 'center',
          alignItems: 'center',
          opacity: fadeOpacity,
        })}
      >
        <h1
          style={{
            color: item.color,
            fontSize: item.fontSize || 60,
            fontFamily: item.fontFamily || 'Arial',
            fontWeight: item.fontWeight || 'bold',
            textAlign: 'center',
            padding: '0 40px',
          }}
        >
          {item.text}
        </h1>
      </AbsoluteFill>
    );
  }

  if (item.type === 'video') {
    const sourceStart = (item as any).sourceStartInFrames || 0;
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
          itemsDomMapRef.current.set(item.id, el as HTMLElement);
        }}
        style={applyTransform({ backgroundColor: 'black' })}
      >
        <AbsoluteFill style={{ opacity: hidden ? 0 : 1, width: '100%', height: '100%' }}>
          <OffthreadVideo
            src={resolveAssetUrl(item.src)}
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

  if (item.type === 'audio') {
    const sourceStart = (item as any).sourceStartInFrames || 0;
    const baseVolume = item.volume || 1;
    return <Audio src={resolveAssetUrl(item.src)} startFrom={sourceStart} volume={baseVolume} />;
  }

  if (item.type === 'image') {
    return (
      <AbsoluteFill
        style={applyTransform({
          justifyContent: 'center',
          alignItems: 'center',
        })}
      >
        <Img
          src={resolveAssetUrl(item.src)}
          ref={(el) => {
            if (!itemsDomMapRef?.current || !el) return;
            itemsDomMapRef.current.set(item.id, el as HTMLElement);
          }}
          style={{ width: '100%', height: '100%', objectFit: 'fill' }}
        />
      </AbsoluteFill>
    );
  }

  return null;
};

// Component to render a single track
const TrackComponent: React.FC<{ track: Track; globalEndFrame: number; trackZIndex: number; itemsDomMapRef?: React.RefObject<Map<string, HTMLElement>> }> = ({ track, globalEndFrame, trackZIndex, itemsDomMapRef }) => {
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
            <ItemComponent item={item} durationInFrames={item.durationInFrames} visibleFrom={visibleFrom} endFrame={endFrame} globalEndFrame={globalEndFrame} trackZIndex={trackZIndex} itemsDomMapRef={itemsDomMapRef} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

// Main composition component
export const VideoComposition: React.FC<{
  tracks: Track[];
  selectedItemId?: string | null;
  selectionBoxRef?: React.RefObject<HTMLDivElement | null>;
  itemsDomMapRef?: React.RefObject<Map<string, HTMLElement>>;
}> = ({ tracks, selectedItemId, selectionBoxRef, itemsDomMapRef }) => {

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

  // 找到选中的 item 和它的 properties
  const selectedItem = React.useMemo(() => {
    if (!selectedItemId) return null;
    for (const track of tracks) {
      const item = track.items.find((i) => i.id === selectedItemId);
      if (item) return item;
    }
    return null;
  }, [tracks, selectedItemId]);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black', top: 0, left: 0, right: 0, bottom: 0 }}>
      {tracks.map((track, trackIndex) => {
        // Track 0 (first/top) should have highest z-index
        // Higher index = lower in timeline = lower z-index
        const trackZIndex = tracks.length - trackIndex;
        return (
          <TrackComponent key={`${track.id}-${trackIndex}`} track={track} globalEndFrame={globalEndFrame} trackZIndex={trackZIndex} itemsDomMapRef={itemsDomMapRef} />
        );
      })}
      
      {/* 选择框 - 透明的，只用于提供 ref（不包含旋转） */}
      {selectedItem && selectedItem.properties && (
        <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 9999 }}>
          <div
            ref={selectionBoxRef}
            style={{
              position: 'absolute',
              left: `calc(50% + ${selectedItem.properties.x}px)`,
              top: `calc(50% + ${selectedItem.properties.y}px)`,
              width: `${selectedItem.properties.width * 100}%`,
              height: `${selectedItem.properties.height * 100}%`,
              transform: `translate(-50%, -50%)`,
              // 不显示边框，不包含旋转，只用于获取未旋转的位置和尺寸
              boxSizing: 'border-box',
            }}
          />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
