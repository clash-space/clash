import React, { useCallback } from 'react';
import type { Track, Asset, Item } from '@master-clash/remotion-core';
import { getItemAssetDurationInFrames, useEditorStaticState } from '@master-clash/remotion-core';
import { TimelineItem } from './TimelineItem';
import { colors, timeline, typography } from './styles';

interface TimelineTrackProps {
  track: Track;
  durationInFrames: number;
  pixelsPerFrame: number;
  isSelected: boolean;
  selectedItemId: string | null;
  assets: Asset[];
  onSelectTrack: () => void;
  onSelectItem: (itemId: string) => void;
  onDeleteItem: (itemId: string) => void;
  onUpdateItem: (itemId: string, updates: Partial<Item>) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

export const TimelineTrack: React.FC<TimelineTrackProps> = ({
  track,
  durationInFrames: _durationInFrames,
  pixelsPerFrame,
  isSelected,
  selectedItemId,
  assets,
  onSelectTrack,
  onSelectItem,
  onDeleteItem,
  onUpdateItem,
  onDragOver,
  onDrop,
}) => {
  // Use global editor state for fps so we never assume 30fps in calculations
  const { fps } = useEditorStaticState();

  const handleTrackClick = useCallback(() => {
    onSelectTrack();
  }, [onSelectTrack]);

  const handleItemResize = useCallback(
    (itemId: string, edge: 'left' | 'right', deltaFrames: number) => {
      const item = track.items.find((i) => i.id === itemId);
      if (!item) return;

      // 获取视频/音频素材的总时长（以帧为单位），用于约束逻辑剪裁
      let totalFramesForAsset: number | undefined;
      if (item.type === 'video' || item.type === 'audio') {
        totalFramesForAsset = getItemAssetDurationInFrames(item, assets, fps);
      }

      if (edge === 'left') {
        // 调整起点和时长（左侧剪裁：可向左扩展/向右剪入）
        const newFrom = Math.max(0, item.from + deltaFrames);
        const newDuration = item.durationInFrames + (item.from - newFrom);

        // 计算拟应用的 sourceStartInFrames（媒体项才有偏移），用于正确约束最大时长
        const consumed = newFrom - item.from; // <0 表示向左扩展；>0 表示向右剪入
        const currentOffset = ((item as any).sourceStartInFrames || 0);
        const proposedOffset = Math.max(0, currentOffset + consumed);
        const maxDurationWithProposedOffset = (totalFramesForAsset !== undefined)
          ? Math.max(0, totalFramesForAsset - proposedOffset)
          : undefined;

        // 检查最小和最大限制（基于“拟应用偏移”的可用时长），允许向左扩展
        const isValidDuration = newDuration >= 15 &&
          (!maxDurationWithProposedOffset || newDuration <= maxDurationWithProposedOffset);

        if (isValidDuration) {
          onUpdateItem(itemId, {
            from: newFrom,
            durationInFrames: newDuration,
            ...(item.type === 'video' || item.type === 'audio' ? { sourceStartInFrames: proposedOffset } : {}),
          } as any);
        }
      } else {
        // 调整时长（右侧剪裁：向右扩展/向左剪出）
        let newDuration = Math.max(15, item.durationInFrames + deltaFrames);

        // 限制最大时长不超过素材实际可用时长（基于当前偏移）
        if (totalFramesForAsset !== undefined) {
          const currentOffset = ((item as any).sourceStartInFrames || 0);
          const maxDuration = Math.max(0, totalFramesForAsset - currentOffset);
          if (newDuration > maxDuration) newDuration = maxDuration;
        }

        onUpdateItem(itemId, {
          durationInFrames: newDuration,
        });
      }
    },
    [track.items, assets, fps, onUpdateItem]
  );

  return (
    <div
      style={{
        display: 'flex',
        height: timeline.trackHeight,
        borderBottom: `1px solid ${colors.border.default}`,
        backgroundColor: isSelected ? colors.bg.selected : colors.bg.primary,
        transition: 'background-color 0.15s ease',
        opacity: track.hidden ? 0.3 : 1,
      }}
    >
      {/* 轨道标签区域 */}
      <div
        style={{
          width: timeline.trackLabelWidth,
          flexShrink: 0,
          backgroundColor: colors.bg.secondary,
          borderRight: `1px solid ${colors.border.default}`,
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          cursor: 'pointer',
        }}
        onClick={handleTrackClick}
      >
        {/* 轨道名称 */}
        <div
          style={{
            color: colors.text.primary,
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.medium,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            userSelect: 'none',
          }}
        >
          {track.name}
        </div>
      </div>

      {/* 轨道内容区域 */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          height: '100%',
          overflow: 'visible',
        }}
        onClick={handleTrackClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {/* 直接渲染素材项，不需要额外包装 */}
        {track.items.map((item) => (
          <TimelineItem
            key={item.id}
            item={item}
            trackId={track.id}
            track={track}
            pixelsPerFrame={pixelsPerFrame}
            isSelected={selectedItemId === item.id}
            assets={assets}
            onSelect={() => onSelectItem(item.id)}
            onDelete={() => onDeleteItem(item.id)}
            onUpdate={onUpdateItem}
            onResize={(edge, deltaFrames) => handleItemResize(item.id, edge, deltaFrames)}
          />
        ))}
      </div>
    </div>
  );
};
