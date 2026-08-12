/**
 * 吸附计算工具
 */

import type { Item, Track } from '@clash/remotion-core';
import { timeline } from '../styles';

export interface SnapTarget {
  frame: number;
  type: 'item-start' | 'item-end' | 'playhead' | 'track-start' | 'grid';
  label?: string;
}

export interface SnapResult {
  snappedFrame: number;
  target: SnapTarget | null;
  didSnap: boolean;
}

// 拖动物料（整体）时，既可能希望左边缘吸附，也可能希望右边缘吸附。
// 该结果在常规 SnapResult 基础上，额外返回究竟是哪个边缘发生了吸附。
export interface SnapItemRangeResult extends SnapResult {
  edge: 'left' | 'right' | null;
}

/**
 * 计算吸附位置
 * @param frame 当前帧位置
 * @param tracks 所有轨道
 * @param currentItemId 当前拖拽的素材项 ID（排除自己）
 * @param playheadFrame 播放头位置
 * @param snapEnabled 是否启用吸附
 * @param threshold 吸附阈值（帧数）
 * @returns 吸附结果
 */
export function calculateSnap(
  frame: number,
  tracks: Track[],
  currentItemId: string | null,
  playheadFrame: number,
  snapEnabled: boolean = true,
  threshold: number = timeline.snapThreshold
): SnapResult {
  if (!snapEnabled) {
    return {
      snappedFrame: frame,
      target: null,
      didSnap: false,
    };
  }

  // Build target groups and prefer item edges first, then playhead/track-start, then grid
  const itemEdgeTargets: SnapTarget[] = [];
  const secondaryTargets: SnapTarget[] = [];
  const gridTargets: SnapTarget[] = [];

  // Secondary: track start and playhead
  secondaryTargets.push({ frame: 0, type: 'track-start', label: '轨道起点' });
  secondaryTargets.push({ frame: playheadFrame, type: 'playhead', label: '播放头' });

  // Item edges from all tracks except the current item
  tracks.forEach((track) => {
    track.items.forEach((item) => {
      if (item.id === currentItemId) return;
      itemEdgeTargets.push({ frame: item.from, type: 'item-start', label: `${item.type} 起点` });
      itemEdgeTargets.push({ frame: item.from + item.durationInFrames, type: 'item-end', label: `${item.type} 终点` });
    });
  });

  // Grid
  const gridFrame = Math.round(frame / timeline.snapGridInterval) * timeline.snapGridInterval;
  gridTargets.push({ frame: gridFrame, type: 'grid', label: '网格' });

  const pickFrom = (targets: SnapTarget[]): SnapTarget | null => {
    let best: SnapTarget | null = null;
    let bestDist = threshold;
    for (const t of targets) {
      const dist = Math.abs(t.frame - frame);
      if (dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }
    return best;
  };

  // Try item edges first
  const itemChoice = pickFrom(itemEdgeTargets);
  if (itemChoice) {
    return { snappedFrame: itemChoice.frame, target: itemChoice, didSnap: true };
  }
  // Then playhead/track start
  const secondaryChoice = pickFrom(secondaryTargets);
  if (secondaryChoice) {
    return { snappedFrame: secondaryChoice.frame, target: secondaryChoice, didSnap: true };
  }
  // Finally grid
  const gridChoice = pickFrom(gridTargets);
  if (gridChoice) {
    return { snappedFrame: gridChoice.frame, target: gridChoice, didSnap: true };
  }

  return { snappedFrame: frame, target: null, didSnap: false };
}

/**
 * 计算调整大小时的吸附
 * @param frame 当前帧位置（左边缘或右边缘）
 * @param edge 正在调整的边缘（'left' | 'right'）
 * @param tracks 所有轨道
 * @param currentItemId 当前素材项 ID
 * @param playheadFrame 播放头位置
 * @param snapEnabled 是否启用吸附
 * @param threshold 吸附阈值
 * @returns 吸附结果
 */
export function calculateResizeSnap(
  frame: number,
  edge: 'left' | 'right',
  tracks: Track[],
  currentItemId: string,
  playheadFrame: number,
  snapEnabled: boolean = true,
  threshold: number = timeline.snapThreshold
): SnapResult {
  // 调整大小时的吸附逻辑与普通吸附类似，但只关注边缘
  return calculateSnap(frame, tracks, currentItemId, playheadFrame, snapEnabled, threshold);
}

/**
 * 计算整个素材在拖动时的吸附（考虑左/右两边缘）
 * 传入素材原始起点和时长，返回吸附后的起点及吸附边缘。
 */
export function calculateSnapForItemRange(
  rawFromFrame: number,
  durationInFrames: number,
  tracks: Track[],
  currentItemId: string | null,
  playheadFrame: number,
  snapEnabled: boolean = true,
  threshold: number = timeline.snapThreshold
): SnapItemRangeResult {
  if (!snapEnabled) {
    return {
      snappedFrame: rawFromFrame,
      target: null,
      didSnap: false,
      edge: null,
    };
  }

  // 左边缘吸附
  const leftSnap = calculateSnap(
    rawFromFrame,
    tracks,
    currentItemId,
    playheadFrame,
    snapEnabled,
    threshold
  );

  // 右边缘吸附（对右边缘进行吸附，然后推导新的起点）
  const rawRight = rawFromFrame + durationInFrames;
  const rightSnap = calculateSnap(
    rawRight,
    tracks,
    currentItemId,
    playheadFrame,
    snapEnabled,
    threshold
  );

  // 计算两种方式的“移动量”
  const leftDelta = Math.abs(leftSnap.snappedFrame - rawFromFrame);
  const snappedFromByRight = rightSnap.snappedFrame - durationInFrames;
  const rightDelta = Math.abs(snappedFromByRight - rawFromFrame);

  // 在两者都触发吸附时，选择移动量更小的方案；
  // 若只有其一触发吸附，则选择该方案；若都未吸附，则返回原值。
  if (leftSnap.didSnap && rightSnap.didSnap) {
    if (leftDelta <= rightDelta) {
      return { ...leftSnap, edge: 'left' };
    }
    return { snappedFrame: Math.max(0, snappedFromByRight), target: rightSnap.target, didSnap: true, edge: 'right' };
  }

  if (leftSnap.didSnap) {
    return { ...leftSnap, edge: 'left' };
  }
  if (rightSnap.didSnap) {
    return { snappedFrame: Math.max(0, snappedFromByRight), target: rightSnap.target, didSnap: true, edge: 'right' };
  }

  return { snappedFrame: rawFromFrame, target: null, didSnap: false, edge: null };
}

/**
 * 获取所有潜在的吸附目标（用于绘制辅助线）
 * @param tracks 所有轨道
 * @param excludeItemId 要排除的素材项 ID
 * @returns 吸附目标数组
 */
export function getAllSnapTargets(tracks: Track[], excludeItemId: string | null = null): SnapTarget[] {
  const targets: SnapTarget[] = [];

  // 轨道起点
  targets.push({ frame: 0, type: 'track-start' });

  // 所有素材的边缘
  tracks.forEach((track) => {
    track.items.forEach((item) => {
      if (item.id === excludeItemId) return;

      targets.push({
        frame: item.from,
        type: 'item-start',
      });

      targets.push({
        frame: item.from + item.durationInFrames,
        type: 'item-end',
      });
    });
  });

  return targets;
}

/**
 * 检查两个素材是否重叠
 * @param item1 素材1
 * @param item2 素材2
 * @returns 是否重叠
 */
export function checkItemsOverlap(item1: Item, item2: Item): boolean {
  const item1Start = item1.from;
  const item1End = item1.from + item1.durationInFrames;
  const item2Start = item2.from;
  const item2End = item2.from + item2.durationInFrames;

  return !(item1End <= item2Start || item2End <= item1Start);
}

/**
 * 在轨道中找到可以放置素材的位置（避免重叠）
 * @param track 轨道
 * @param duration 素材时长
 * @param preferredFrame 首选位置
 * @returns 可用的帧位置
 */
export function findAvailablePosition(
  track: Track,
  duration: number,
  preferredFrame: number
): number {
  // 如果首选位置可用，直接返回
  const wouldOverlap = track.items.some((item) => {
    const itemStart = item.from;
    const itemEnd = item.from + item.durationInFrames;
    const newStart = preferredFrame;
    const newEnd = preferredFrame + duration;

    return !(newEnd <= itemStart || itemEnd <= newStart);
  });

  if (!wouldOverlap) {
    return preferredFrame;
  }

  // 否则，找到最近的可用位置
  // 按起始位置排序素材
  const sortedItems = [...track.items].sort((a, b) => a.from - b.from);

  // 检查开头是否有空间
  if (sortedItems.length === 0 || sortedItems[0].from >= duration) {
    return 0;
  }

  // 检查素材之间的间隙
  for (let i = 0; i < sortedItems.length - 1; i++) {
    const currentEnd = sortedItems[i].from + sortedItems[i].durationInFrames;
    const nextStart = sortedItems[i + 1].from;
    const gap = nextStart - currentEnd;

    if (gap >= duration) {
      return currentEnd;
    }
  }

  // 放在最后
  const lastItem = sortedItems[sortedItems.length - 1];
  return lastItem.from + lastItem.durationInFrames;
}
