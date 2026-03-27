import React, { useState, useCallback, useEffect, CSSProperties } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS as _DndCSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import type { Item, BaseItem, Asset, Track } from '@master-clash/remotion-core';
import { useEditor } from '@master-clash/remotion-core';
import { frameToPixels, secondsToFrames } from './utils/timeFormatter';
import { getRendererForItem } from './items/registry';

// Simple in-memory cache for per-asset filmstrips built at a high sample rate
type FilmstripCacheEntry = {
  canvas: HTMLCanvasElement;
  frameWidth: number;
  frameHeight: number;
  framesPerRow: number;
  sampleCount: number;
  duration: number; // seconds
};

const filmstripCache = new Map<string, FilmstripCacheEntry>();

// Store dragged item globally on window object for cross-module access
declare global {
  interface Window {
    currentDraggedItem: { item: Item; trackId: string } | null;
  }
}

interface TimelineItemProps {
  item: Item;
  trackId: string;
  track: Track;
  pixelsPerFrame: number;
  isSelected: boolean;
  assets: Asset[];
  onSelect: () => void;
  onDelete: () => void;
  onUpdate: (itemId: string, updates: Partial<Item>) => void;
  // Legacy native DnD callbacks (kept for compatibility with old flow if needed)
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onResizeStart?: (edge: 'left' | 'right') => void;
  onResize?: (edge: 'left' | 'right', deltaFrames: number) => void;
  onRollEdit?: (edge: 'left' | 'right', deltaFrames: number) => void; // Roll edit with adjacent item
  hasAdjacentItemOnLeft?: boolean;
  hasAdjacentItemOnRight?: boolean;
  shouldHighlightLeft?: boolean;
  shouldHighlightRight?: boolean;
  onHoverChange?: (isHovered: boolean) => void;
  onResizeEnd?: () => void;
  style?: CSSProperties;
  // DragOverlay mode: disable positioning, let DragOverlay handle it
  isDragOverlay?: boolean;
}

export const TimelineItem: React.FC<TimelineItemProps> = ({
  item,
  trackId,
  track,
  pixelsPerFrame,
  isSelected,
  assets,
  onSelect,
  onDelete,
  onUpdate,
  onDragStart: _onDragStartProp,
  onDragEnd: _onDragEndProp,
  onResizeStart,
  onResize,
  onResizeEnd,
  onRollEdit,
  hasAdjacentItemOnLeft,
  hasAdjacentItemOnRight,
  shouldHighlightLeft = false,
  shouldHighlightRight = false,
  onHoverChange,
  style: customStyle,
  isDragOverlay = false,
}) => {
  const { state } = useEditor();
  const [isHovered, setIsHovered] = useState(false);
  const [resizingEdge, setResizingEdge] = useState<'left' | 'right' | null>(null);
  const [draggingFade, setDraggingFade] = useState<{ type: 'in' | 'out' } | null>(null);
  const [draggingVolume, setDraggingVolume] = useState(false);
  const [isEditingText, setIsEditingText] = useState(false);
  const [tempText, setTempText] = useState('');

  const width = frameToPixels(item.durationInFrames, pixelsPerFrame);

  // Resolve item type and src from asset if using reference-based model
  // This is needed because reference-based items only have assetId, not type/src directly
  const resolvedItemType = React.useMemo(() => {
    if (item.type) return item.type;
    // Try to resolve from assets via assetId
    const baseItem = item as BaseItem;
    if (baseItem.assetId) {
      const asset = assets.find((a) => a.id === baseItem.assetId);
      if (asset?.type) return asset.type;
    }
    return undefined;
  }, [item.type, (item as BaseItem).assetId, assets]);

  const resolvedItemSrc = React.useMemo(() => {
    if ((item as any).src) return (item as any).src;
    // Try to resolve from assets via assetId
    const baseItem = item as BaseItem;
    if (baseItem.assetId) {
      const asset = assets.find((a) => a.id === baseItem.assetId);
      if (asset?.src) return asset.src;
    }
    return undefined;
  }, [(item as any).src, (item as BaseItem).assetId, assets]);

  // Get item color based on type (use resolved type)
  const getColor = () => {
    switch (resolvedItemType) {
      case 'solid':
        return (item as any).color;
      case 'text':
        return '#4CAF50';
      case 'video':
        return '#2196F3';
      case 'audio':
        return '#FF9800';
      case 'image':
        return '#9C27B0';
      default:
        return '#666666';
    }
  };

  // Get asset data (for thumbnail and waveform) - use resolved type
  const asset = React.useMemo(() => {
    if (resolvedItemType === 'video' || resolvedItemType === 'audio' || resolvedItemType === 'image') {
      // Priority 1: Lookup by assetId (if present)
      if ('assetId' in item && item.assetId) {
        const found = assets.find((a) => a.id === item.assetId);
        if (found) return found;
      }
      // Priority 2: Fallback to lookup by src (legacy/direct link)
      return assets.find((a) => a.src === (item as any).src) ?? null;
    }
    // Also try assetId lookup even if type is unknown (reference-based model)
    if (item.assetId) {
      const found = assets.find((a) => a.id === item.assetId);
      if (found) return found;
    }
    return null;
  }, [item, assets, resolvedItemType]);

  // Use resolved src for thumbnail fallback
  const thumbnail = asset?.thumbnail || (resolvedItemType === 'image' ? resolvedItemSrc : undefined);
  const itemWaveform: number[] | undefined =
    (resolvedItemType === 'audio' || resolvedItemType === 'video') && 'waveform' in item
      ? (item as any).waveform as number[] | undefined
      : undefined;
  const hasWaveform: boolean = Array.isArray(itemWaveform) && itemWaveform.length > 0;

  // Calculate heights - ensure items fit within 72px track height
  const hasVideoWithThumbnail = resolvedItemType === 'video' && thumbnail && hasWaveform;
  const itemHeight = hasVideoWithThumbnail ? 60 : (hasWaveform ? 56 : 44);
  const borderSize = isSelected ? 2 : 1;
  const availableHeight = itemHeight - (borderSize * 2);
  // For video items with both thumbnail and waveform, use a 7:3 ratio (thumbnail:waveform)
  // Keep existing behavior for other item types
  const thumbnailHeight = hasVideoWithThumbnail
    ? Math.max(1, Math.floor(availableHeight * 0.7))
    : (hasWaveform ? Math.floor(availableHeight * 0.6) : 44);

  // Dynamic thumbnail generation based on zoom level
  const [dynamicThumbnail, ] = React.useState<string | null>(null);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = React.useState(false);
  const thumbnailCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const canvasPixelWidthRef = React.useRef<number>(0);


  // Generate thumbnail based on current zoom level
  // 绘制整个视频的缩略图，trim 由外层 CSS transform 完成
  const generateDynamicThumbnail = React.useCallback(async () => {
    if (!asset?.duration || resolvedItemType !== 'video' || !resolvedItemSrc) {
      return;
    }

    setIsGeneratingThumbnail(true);

    try {
      const videoSrc = resolvedItemSrc;
      const duration = asset.duration;
      const totalFrames = secondsToFrames(duration, state.fps);

      // 计算目标显示区域的高度和宽度（像素）
      // 注意：这里使用 totalFrames 而不是 item.durationInFrames，绘制完整视频
      const displayHeight = hasWaveform ? thumbnailHeight : itemHeight;
      const fullVideoPixelWidth = frameToPixels(totalFrames, pixelsPerFrame);

      const canvasEl = thumbnailCanvasRef.current;
      const ctx = canvasEl?.getContext('2d');
      if (!canvasEl || !ctx) {
        setIsGeneratingThumbnail(false);
        return;
      }

      // 初始化画布尺寸（基于完整视频）并先填充全黑
      const destHeight = Math.max(16, Math.floor(displayHeight));
      canvasEl.width = Math.max(1, Math.ceil(fullVideoPixelWidth));
      canvasEl.height = destHeight;
      // Record canvas width for CSS viewport logic
      canvasPixelWidthRef.current = canvasEl.width;
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);


      // Generate filmstrip progressively; avoid runtime logs in production

      // 1) Ensure we have a max-sample filmstrip cached for this asset
      const ensureFilmstrip = async (
        onSample?: (sampleIndex: number, entry: FilmstripCacheEntry) => void
      ): Promise<FilmstripCacheEntry> => {
        const cached = filmstripCache.get(videoSrc);
        if (cached && Math.abs(cached.duration - duration) < 0.001) {
          return cached;
        }

        const video = document.createElement('video');
        video.src = videoSrc;
        video.crossOrigin = 'anonymous';
        video.preload = 'metadata';

        await new Promise<void>((resolve, reject) => {
          const onLoaded = () => resolve();
          const onError = () => reject(new Error('video metadata error'));
          video.addEventListener('loadedmetadata', onLoaded, { once: true });
          video.addEventListener('error', onError, { once: true });
        });

        const BASE_HEIGHT = 80; // 基础缓存高度
        const frameHeight = BASE_HEIGHT;
        const frameWidth = Math.max(1, Math.floor((video.videoWidth / video.videoHeight) * frameHeight));

        // 固定采样数量 - 减少以提升速度
        const SAMPLE_COUNT = 40;
        const sampleCount = Math.min(SAMPLE_COUNT, totalFrames);
        const framesPerRow = 60; // 网格每行放置帧数，控制宽度
        const rows = Math.ceil(sampleCount / framesPerRow);

        const filmstrip = document.createElement('canvas');
        filmstrip.width = frameWidth * Math.min(sampleCount, framesPerRow);
        filmstrip.height = frameHeight * rows;
        const fctx = filmstrip.getContext('2d');
        if (!fctx) {
          throw new Error('Cannot get filmstrip context');
        }

        const interval = duration / Math.max(sampleCount, 1);
        for (let i = 0; i < sampleCount; i++) {
          const time = Math.min(i * interval, Math.max(0, duration - 0.05));
          await new Promise<void>((resolveSeek) => {
            const seeked = () => {
              video.removeEventListener('seeked', seeked);
              resolveSeek();
            };
            video.addEventListener('seeked', seeked);
            video.currentTime = time;
          });

          const row = Math.floor(i / framesPerRow);
          const col = i % framesPerRow;
          const dx = col * frameWidth;
          const dy = row * frameHeight;
          fctx.drawImage(
            video,
            0, 0, video.videoWidth, video.videoHeight,
            dx, dy, frameWidth, frameHeight
          );

          if (onSample) {
            onSample(i, {
              canvas: filmstrip,
              frameWidth,
              frameHeight,
              framesPerRow,
              sampleCount,
              duration,
            });
          }
        }

        const entry: FilmstripCacheEntry = {
          canvas: filmstrip,
          frameWidth,
          frameHeight,
          framesPerRow,
          sampleCount,
          duration,
        };
        filmstripCache.set(videoSrc, entry);
        return entry;
      };

      // Helpers to map columns to sample indices and draw
      // 绘制整个视频的缩略图（0 到 1 的完整范围）
      const drawFromEntry = (entry: FilmstripCacheEntry) => {
        const destFrameWidth = Math.max(1, Math.floor(entry.frameWidth * (destHeight / entry.frameHeight)));
        const columns = Math.max(1, Math.ceil(fullVideoPixelWidth / destFrameWidth));
        const colToIdx: number[] = new Array(columns);
        // Map columns to samples across the entire video [0, 1]
        for (let col = 0; col < columns; col++) {
          const ratio = columns === 1 ? 0 : col / (columns - 1);
          colToIdx[col] = Math.min(entry.sampleCount - 1, Math.max(0, Math.round(ratio * (entry.sampleCount - 1))));
        }

        const BATCH = 64; // 增加批处理大小,加快绘制速度
        let col = 0;
        const step = () => {
          const end = Math.min(columns, col + BATCH);
          for (; col < end; col++) {
            const idx = colToIdx[col];
            const srcRow = Math.floor(idx / entry.framesPerRow);
            const srcCol = idx % entry.framesPerRow;
            const sx = srcCol * entry.frameWidth;
            const sy = srcRow * entry.frameHeight;
            const dx = col * destFrameWidth;
            ctx.drawImage(entry.canvas, sx, sy, entry.frameWidth, entry.frameHeight, dx, 0, destFrameWidth, destHeight);
          }
          if (col < columns) requestAnimationFrame(step);
          else setIsGeneratingThumbnail(false);
        };
        requestAnimationFrame(step);
      };

      const cached = filmstripCache.get(videoSrc);
      if (cached && Math.abs(cached.duration - duration) < 0.001) {
        drawFromEntry(cached);
      } else {
        // Build cache and progressively paint as samples become available
        let mapped = false;
        let entryForMap: FilmstripCacheEntry | null = null;
        let destFrameWidth = 1;
        let columns = 1;
        let colToIdx: number[] = [];
        let idxToCols: number[][] = [];

        await ensureFilmstrip((readyIdx, entry) => {
          if (!mapped) {
            entryForMap = entry;
            destFrameWidth = Math.max(1, Math.floor(entry.frameWidth * (destHeight / entry.frameHeight)));
            columns = Math.max(1, Math.ceil(fullVideoPixelWidth / destFrameWidth));
            colToIdx = new Array(columns);
            idxToCols = new Array(entry.sampleCount).fill(null).map(() => []);
            // 绘制整个视频范围 [0, 1]
            for (let col = 0; col < columns; col++) {
              const ratio = columns === 1 ? 0 : col / (columns - 1);
              const idx = Math.min(entry.sampleCount - 1, Math.max(0, Math.round(ratio * (entry.sampleCount - 1))));
              colToIdx[col] = idx;
              idxToCols[idx].push(col);
            }
            mapped = true;
          }

          if (!entryForMap) return;
          const cols = idxToCols[readyIdx];
          if (cols && cols.length) {
            for (const c of cols) {
              const idx = colToIdx[c];
              const srcRow = Math.floor(idx / entryForMap.framesPerRow);
              const srcCol = idx % entryForMap.framesPerRow;
              const sx = srcCol * entryForMap.frameWidth;
              const sy = srcRow * entryForMap.frameHeight;
              const dx = c * destFrameWidth;
              ctx.drawImage(entry.canvas, sx, sy, entryForMap.frameWidth, entryForMap.frameHeight, dx, 0, destFrameWidth, destHeight);
            }
          }
        });
        setIsGeneratingThumbnail(false);
      }
    } catch (error) {
      console.error('Error generating dynamic thumbnail:', error);
      setIsGeneratingThumbnail(false);
    }
  }, [asset?.duration, resolvedItemType, resolvedItemSrc, pixelsPerFrame, thumbnailHeight, itemHeight, hasWaveform, state.fps]);

  // 在以下情况触发绘制：
  // 1. 素材首次拖入 timeline (justInserted) - 采样 + 绘制
  // 2. zoom 级别显著变化 - 仅重绘（从缓存的 filmstrip 中取样，不重新采样视频）
  // 注意：trim 和移动操作只改变 CSS transform，不触发重绘
  const didInitRef = React.useRef(false);
  const pendingClearInsertFlagRef = React.useRef(false);
  const lastZoomLevelRef = React.useRef<number>(pixelsPerFrame);
  const redrawTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    if (!didInitRef.current) {
      didInitRef.current = true;
      lastZoomLevelRef.current = pixelsPerFrame;

      // 对于视频类型，如果有 justInserted 标记，初始绘制（采样 + 绘制）
      if (resolvedItemType === 'video' && asset?.duration) {
        if ((item as any).justInserted) {
          pendingClearInsertFlagRef.current = true;
        }
        generateDynamicThumbnail();
      }
      return;
    }

    // zoom 级别变化时，立即重绘（无防抖）
    // 因为只是从缓存 filmstrip 中重新采样绘制，很快，不需要防抖
    const zoomChanged = Math.abs(pixelsPerFrame - lastZoomLevelRef.current) > 0.01;
    if (zoomChanged && resolvedItemType === 'video' && asset?.duration) {
      lastZoomLevelRef.current = pixelsPerFrame;

      // 清除之前的定时器
      if (redrawTimeoutRef.current) {
        clearTimeout(redrawTimeoutRef.current);
      }

      // 立即重绘（从缓存绘制，不重新采样）
      generateDynamicThumbnail();
    }

    return () => {
      if (redrawTimeoutRef.current) {
        clearTimeout(redrawTimeoutRef.current);
      }
    };
  }, [
    pixelsPerFrame,
    generateDynamicThumbnail,
    item.id,
    resolvedItemType,
    asset?.duration,
  ]);

  // 绘制完成后，清除 justInserted 标记，避免后续重复绘制
  React.useEffect(() => {
    if (!isGeneratingThumbnail && pendingClearInsertFlagRef.current && (item as any).justInserted) {
      pendingClearInsertFlagRef.current = false;
      onUpdate(item.id, { justInserted: false } as any);
    }
  }, [isGeneratingThumbnail, item.id, onUpdate]);


  // 不再因为 waveform 可用性变化而重绘，遵循“仅拖入时绘制”的策略
  const prevHasWaveformRef = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    prevHasWaveformRef.current = hasWaveform;
  }, [hasWaveform]);


  // Revoke previously created object URLs to avoid memory leaks and reduce flicker
  const prevThumbUrlRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (prevThumbUrlRef.current && prevThumbUrlRef.current !== dynamicThumbnail) {
      URL.revokeObjectURL(prevThumbUrlRef.current);
    }
    prevThumbUrlRef.current = dynamicThumbnail;
  }, [dynamicThumbnail]);

  // Use dynamic thumbnail if available, otherwise fallback to static one
  const displayThumbnail = dynamicThumbnail || thumbnail;
  const isDynamicReady = Boolean(dynamicThumbnail);

  // (removed) Previously used to stretch thumbnail to fit width.
  // Match 3:7 ratio when video has waveform; otherwise keep previous calculation
  const waveformHeight = hasWaveform
    ? (hasVideoWithThumbnail
      ? Math.max(0, availableHeight - thumbnailHeight)
      : availableHeight - thumbnailHeight)
    : 0;

  // Get audio/video properties (use resolved type)
  const audioFadeIn = ((resolvedItemType === 'video' || resolvedItemType === 'audio') && 'audioFadeIn' in item)
    ? (item as any).audioFadeIn || 0 : 0;
  const audioFadeOut = ((resolvedItemType === 'video' || resolvedItemType === 'audio') && 'audioFadeOut' in item)
    ? (item as any).audioFadeOut || 0 : 0;
  const itemVolume = ((resolvedItemType === 'video' || resolvedItemType === 'audio') && 'volume' in item)
    ? (item as any).volume ?? 1 : 1;

  // Get display label (use resolved type and src)
  const getItemLabel = () => {
    if (resolvedItemType === 'text') {
      return (item as any).text;
    }
    if (resolvedItemType === 'solid') {
      return 'Solid';
    }
    // For media items, extract filename from src (use resolved src)
    if (resolvedItemSrc) {
      const filename = resolvedItemSrc.split('/').pop() || resolvedItemType || 'item';
      const cleanName = filename.replace(/\.[^.]+$/, '').replace(/_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i, '');
      return cleanName.substring(0, 30);
    }
    return resolvedItemType || 'item';
  };

  // Render waveform with volume and clipping
  // 渲染完整的 waveform，不做任何裁剪
  // 裁剪由外层的 overflow:hidden 和 transform 完成
  const renderWaveform = (
    waveform: number[],
    height: number
  ) => {
    if (!asset?.duration) {
      return null;
    }

    // 计算完整波形的宽度（基于整个视频的时长）
    const totalFrames = secondsToFrames(asset.duration, state.fps);
    const fullWidth = frameToPixels(totalFrames, pixelsPerFrame);

    const barCount = waveform.length;
    const barWidth = fullWidth / barCount;

    return (
      <svg
        width={fullWidth}
        height={height}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          pointerEvents: 'none',
        }}
        preserveAspectRatio="none"
      >
        {waveform.map((peak, i) => {
          const targetBarHeight = peak * height * itemVolume;
          const x = i * barWidth;
          const isClipping = targetBarHeight > height;
          const barHeight = Math.min(targetBarHeight, height);
          const normalHeight = isClipping ? height : barHeight;

          return (
            <g key={i}>
              <rect
                x={x}
                y={height - normalHeight}
                width={Math.max(barWidth, 1)}
                height={normalHeight}
                fill="rgba(200, 200, 200, 0.9)"
              />
              {isClipping && (
                <rect
                  x={x}
                  y={0}
                  width={Math.max(barWidth, 1)}
                  height={2}
                  fill="rgba(255, 60, 60, 0.9)"
                />
              )}
            </g>
          );
        })}
      </svg>
    );
  };

  // Render fade curve
  const renderFadeCurve = (
    width: number,
    height: number,
    fadeFrames: number,
    type: 'in' | 'out'
  ) => {
    if (fadeFrames <= 0) return null;

    const fadeWidth = fadeFrames * pixelsPerFrame;
    const handleCenterY = thumbnailHeight;

    let curvePath: string;
    let fillPath: string;

    if (type === 'in') {
      const handleCenterX = fadeWidth;
      const controlX = fadeWidth / 2;
      const controlY = handleCenterY - 1;
      curvePath = `M 0,${height} Q ${controlX},${controlY} ${handleCenterX},${handleCenterY}`;
      fillPath = `M 0,${height} Q ${controlX},${controlY} ${handleCenterX},${handleCenterY} L 0,${handleCenterY} Z`;
    } else {
      const handleCenterX = width - fadeWidth;
      const controlX = width - fadeWidth / 2;
      const controlY = handleCenterY - 1;
      curvePath = `M ${width},${height} Q ${controlX},${controlY} ${handleCenterX},${handleCenterY}`;
      fillPath = `M ${width},${height} Q ${controlX},${controlY} ${handleCenterX},${handleCenterY} L ${width},${handleCenterY} Z`;
    }

    return (
      <svg
        width={width}
        height={height}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        <path d={fillPath} fill="black" />
        <path d={curvePath} stroke="rgba(100, 150, 255, 0.8)" strokeWidth="0.5" fill="none" />
      </svg>
    );
  };

  // Fade drag handlers
  const handleFadeMouseDown = (e: React.MouseEvent, type: 'in' | 'out') => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingFade({ type });
  };

  const handleFadeDrag = useCallback((e: MouseEvent) => {
    if (!draggingFade) return;

    const container = document.querySelector('[data-timeline-container]');
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const x = e.clientX - rect.left - 200; // Account for track label width
    const relativeX = x - (item.from * pixelsPerFrame);
    const frames = Math.max(0, Math.floor(relativeX / pixelsPerFrame));

    if (draggingFade.type === 'in') {
      const maxFade = Math.floor((item.durationInFrames * 2) / 3);
      const newFadeIn = Math.max(0, Math.min(maxFade, frames));
      onUpdate(item.id, { audioFadeIn: newFadeIn });
    } else {
      const distanceFromEnd = item.durationInFrames - frames;
      const maxFade = Math.floor((item.durationInFrames * 2) / 3);
      const newFadeOut = Math.max(0, Math.min(maxFade, distanceFromEnd));
      onUpdate(item.id, { audioFadeOut: newFadeOut });
    }
  }, [draggingFade, item, pixelsPerFrame, onUpdate]);

  const handleFadeMouseUp = useCallback(() => {
    setDraggingFade(null);
  }, []);

  // Volume drag handlers
  const handleVolumeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingVolume(true);
  };

  const handleVolumeDrag = useCallback((e: MouseEvent) => {
    if (!draggingVolume) return;

    const waveformElement = document.querySelector(`[data-waveform-id="${item.id}"]`);
    if (!waveformElement) return;

    const rect = waveformElement.getBoundingClientRect();
    const rawY = e.clientY - rect.top;
    const y = Math.max(0, Math.min(rect.height, rawY));
    const normalizedY = y / rect.height;
    const volume = Math.max(0, Math.min(2, (1 - normalizedY) * 2));

    onUpdate(item.id, { volume });
  }, [draggingVolume, item.id, onUpdate]);

  const handleVolumeMouseUp = useCallback(() => {
    setDraggingVolume(false);
  }, []);

  // Text editing handlers (use resolved type)
  const handleTextEdit = () => {
    if (resolvedItemType === 'text') {
      setTempText((item as any).text);
      setIsEditingText(true);
    }
  };

  const handleTextSave = () => {
    if (resolvedItemType === 'text' && tempText.trim()) {
      onUpdate(item.id, { text: tempText.trim() });
    }
    setIsEditingText(false);
  };

  const handleTextCancel = () => {
    setIsEditingText(false);
    setTempText('');
  };

  // Setup drag listeners
  useEffect(() => {
    if (draggingFade) {
      window.addEventListener('mousemove', handleFadeDrag);
      window.addEventListener('mouseup', handleFadeMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleFadeDrag);
        window.removeEventListener('mouseup', handleFadeMouseUp);
      };
    }
  }, [draggingFade, handleFadeDrag, handleFadeMouseUp]);

  useEffect(() => {
    if (draggingVolume) {
      window.addEventListener('mousemove', handleVolumeDrag);
      window.addEventListener('mouseup', handleVolumeMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleVolumeDrag);
        window.removeEventListener('mouseup', handleVolumeMouseUp);
      };
    }
  }, [draggingVolume, handleVolumeDrag, handleVolumeMouseUp]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  }, [onSelect]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  }, [onDelete]);

  // Handle resize
  const handleResizeMouseDown = useCallback(
    (edge: 'left' | 'right', e: React.MouseEvent, isRollEdit = false) => {
      e.stopPropagation();
      e.preventDefault();

      setResizingEdge(edge);
      onResizeStart?.(edge);

      const startX = e.clientX;
      // Auto-scroll support when resizing towards edges
      // Find the horizontal scroll container (tracks viewport)
      const viewportEl = (e.currentTarget as HTMLElement).closest('.tracks-viewport') as HTMLDivElement | null;
      const SCROLL_EDGE = 40; // px from edge to start autoscroll
      const MAX_STEP = 40; // px per mousemove tick (capped)

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaFrames = Math.round(deltaX / pixelsPerFrame);

        // Roll Edit 模式使用 onRollEdit，普通模式使用 onResize
        if (isRollEdit && onRollEdit) {
          onRollEdit(edge, deltaFrames);
        } else {
          onResize?.(edge, deltaFrames);
        }

        // Auto-scroll horizontally if cursor nears viewport edges
        if (viewportEl) {
          const vr = viewportEl.getBoundingClientRect();
          const x = moveEvent.clientX;
          let step = 0;
          if (x > vr.right - SCROLL_EDGE) {
            step = Math.min(MAX_STEP, (x - (vr.right - SCROLL_EDGE)) * 0.5);
          } else if (x < vr.left + SCROLL_EDGE) {
            step = -Math.min(MAX_STEP, ((vr.left + SCROLL_EDGE) - x) * 0.5);
          }
          if (step !== 0) {
            viewportEl.scrollLeft += step;
          }
        }
      };

      const handleMouseUp = () => {
        setResizingEdge(null);
        onResizeEnd?.();
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [pixelsPerFrame, onResizeStart, onResize, onResizeEnd, onRollEdit]
  );

  // dnd-kit draggable (overlay-only integration; does not alter static layout)
  // DragOverlay中的item不需要draggable
  const draggableHook = useDraggable({
    id: `item-${item.id}`,
    data: {
      item,
      trackId,
      from: item.from,
      durationInFrames: item.durationInFrames,
    },
    disabled: isDragOverlay, // DragOverlay中禁用draggable
  });
  
  const {attributes, listeners, setNodeRef, isDragging} = isDragOverlay 
    ? { attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false }
    : draggableHook;

  // Decoupled renderers: first enable for image/text, others keep existing path
  // Use resolved type for determining which renderer to use
  const useNewRenderer = resolvedItemType === 'image' || resolvedItemType === 'text';

  // Create a resolved item with type for the renderer registry
  const resolvedItemForRenderer = React.useMemo(() => {
    if (item.type) return item;
    // If item.type is not set, create a copy with resolved type
    return resolvedItemType ? { ...(item as BaseItem), type: resolvedItemType } as Item : item;
  }, [item, resolvedItemType]);

  const Renderer = React.useMemo(() => getRendererForItem(resolvedItemForRenderer), [resolvedItemForRenderer]);

  return (
    <div
      // dnd-kit takes over dragging; disable native dragging to avoid conflicts
      draggable={false}
      ref={setNodeRef}
      {...attributes}
      data-dnd-id={`item-${item.id}`}
      onMouseEnter={() => {
        setIsHovered(true);
        onHoverChange?.(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        onHoverChange?.(false);
      }}
      onClick={handleClick}
      onDoubleClick={handleTextEdit}
      style={{
        position: isDragOverlay ? undefined : 'absolute',
        left: isDragOverlay ? undefined : frameToPixels(item.from, pixelsPerFrame),
        width: width,
        height: `${itemHeight}px`,
        top: isDragOverlay ? undefined : '50%',
        transform: isDragOverlay ? undefined : 'translateY(-50%)',
        backgroundColor: getColor(),
        borderRadius: '4px',
        border: isSelected
          ? `${borderSize}px solid #ffffff`
          : `${borderSize}px solid rgba(0,0,0,0.2)`,
        cursor: 'move',
        overflow: 'visible', // 改为 visible,让 resize handles 可以延伸出去
        boxSizing: 'border-box',
        opacity: isDragging ? 0 : (track.hidden ? 0.3 : 1),
        outline: isDragging ? '1px dashed rgba(0, 153, 255, 0.8)' : 'none',
        ...customStyle, // 应用自定义样式（可以覆盖默认样式，如opacity）
      }}
    >
      {/* 内层可拖动区域 - 排除 resize handles,让它们可以独立工作 */}
      <div
        {...listeners}
        style={{
          position: 'absolute',
          inset: '0 6px 0 6px', // 左右各留出 6px,因为 handles 向外延伸
          cursor: 'move',
          zIndex: 5,
          pointerEvents: 'auto', // 确保可以捕获拖动事件
        }}
      />

      {/* 内容裁剪容器 - 防止内容溢出到 resize handles */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none', // 让事件穿透到内层元素
          borderRadius: '4px',
        }}
      >
        {/* 背景图片(非视频类型) - use resolved type */}
        {!useNewRenderer && resolvedItemType !== 'video' && resolvedItemType !== 'audio' && displayThumbnail && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${displayThumbnail})`,
              backgroundSize: isDynamicReady ? 'auto 100%' : 'cover',
              backgroundPosition: 'left top',
              backgroundRepeat: 'no-repeat',
            }}
          />
        )}

        {/* New renderer (image/text) */}
        {useNewRenderer && (
          <div style={{ position: 'absolute', inset: 0 }}>
            <Renderer item={resolvedItemForRenderer} asset={asset} width={width} height={itemHeight} pixelsPerFrame={pixelsPerFrame} />
          </div>
        )}

        {/* Thumbnail for video (with or without waveform) - use resolved type */}
        {resolvedItemType === 'video' && (
          <div
            data-thumbnail-id={item.id}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: hasWaveform ? `${thumbnailHeight}px` : '100%',
              zIndex: 1,
              overflow: 'hidden',
              backgroundColor: '#000',
            }}
          >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              width: canvasPixelWidthRef.current ? `${canvasPixelWidthRef.current}px` : '100%',
              transform: `translateX(${(-((item as any).sourceStartInFrames || 0) * pixelsPerFrame)}px)`,
              willChange: 'transform',
            }}
          >
            <canvas
              ref={thumbnailCanvasRef}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
              }}
            />
          </div>
        </div>
      )}

      {/* Waveform */}
      {hasWaveform && itemWaveform && (
        <div
          data-waveform-id={item.id}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: `${waveformHeight}px`,
            overflow: 'hidden',
            zIndex: 2,
            contain: 'strict',
          }}
        >
          {/* 内容容器：通过 transform 平移显示正确的波形部分 */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              height: '100%',
              transform: `translateX(${(-((item as any).sourceStartInFrames || 0) * pixelsPerFrame)}px)`,
              willChange: 'transform',
            }}
          >
            {itemWaveform ? renderWaveform(itemWaveform, waveformHeight) : null}
          </div>


          {/* Volume control line - use resolved type */}
          {(resolvedItemType === 'audio' || resolvedItemType === 'video') && (() => {
            const lineY = waveformHeight * (1 - itemVolume / 2);
            const clampedLineY = Math.max(0, Math.min(waveformHeight - 1, lineY));

            return (
              <div
                onMouseDown={isHovered ? handleVolumeMouseDown : undefined}
                style={{
                  position: 'absolute',
                  top: `${clampedLineY}px`,
                  left: 0,
                  width: '100%',
                  height: '1px',
                  backgroundColor: isHovered ? 'rgba(255, 255, 255, 0.5)' : 'transparent',
                  cursor: isHovered ? 'ns-resize' : 'default',
                  zIndex: 3,
                  pointerEvents: isHovered ? 'auto' : 'none',
                }}
                title={isHovered ? `Volume: ${Math.round(itemVolume * 100)}%` : ''}
              />
            );
          })()}
        </div>
      )}
      </div>
      {/* 内容裁剪容器结束 */}

      {/* Fade curves */}
      {hasWaveform && isSelected && (
        <>
          {renderFadeCurve(width, itemHeight, audioFadeIn, 'in')}
          {renderFadeCurve(width, itemHeight, audioFadeOut, 'out')}
        </>
      )}

      {/* Fade handles */}
      {hasWaveform && isHovered && (
        <>
          {/* Fade In Handle */}
          <div
            onMouseDown={(e) => handleFadeMouseDown(e, 'in')}
            onDragStart={(e) => e.preventDefault()}
            style={{
              position: 'absolute',
              left: `${audioFadeIn * pixelsPerFrame - 6}px`,
              top: hasVideoWithThumbnail ? `${thumbnailHeight - 6}px` : (hasWaveform ? `${thumbnailHeight - 6}px` : '-6px'),
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: '#fff',
              border: '2px solid #FF6B50',
              cursor: 'ew-resize',
              zIndex: 30,
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
              pointerEvents: 'auto',
            }}
            title={`Fade In: ${(audioFadeIn / state.fps).toFixed(1)}s`}
          >
            {draggingFade?.type === 'in' && (
              <div style={{
                position: 'absolute',
                top: '-24px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(0,0,0,0.9)',
                color: '#fff',
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '11px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}>
                {(audioFadeIn / state.fps).toFixed(2)}s
              </div>
            )}
          </div>

          {/* Fade Out Handle */}
          <div
            onMouseDown={(e) => handleFadeMouseDown(e, 'out')}
            onDragStart={(e) => e.preventDefault()}
            style={{
              position: 'absolute',
              right: `${audioFadeOut * pixelsPerFrame - 6}px`,
              top: hasVideoWithThumbnail ? `${thumbnailHeight - 6}px` : (hasWaveform ? `${thumbnailHeight - 6}px` : '-6px'),
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: '#fff',
              border: '2px solid #FF6B50',
              cursor: 'ew-resize',
              zIndex: 30,
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
              pointerEvents: 'auto',
            }}
            title={`Fade Out: ${(audioFadeOut / state.fps).toFixed(1)}s`}
          >
            {draggingFade?.type === 'out' && (
              <div style={{
                position: 'absolute',
                top: '-24px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(0,0,0,0.9)',
                color: '#fff',
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '11px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}>
                {(audioFadeOut / state.fps).toFixed(2)}s
              </div>
            )}
          </div>
        </>
      )}

      {/* Item Label */}
      <span style={{
        position: 'absolute',
        top: '4px',
        right: '4px',
        fontSize: '12px',
        color: '#ffffff',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        backgroundColor: (thumbnail || hasWaveform) ? 'rgba(0, 0, 0, 0.7)' : 'transparent',
        padding: (thumbnail || hasWaveform) ? '2px 6px' : '0',
        borderRadius: (thumbnail || hasWaveform) ? '3px' : '0',
        zIndex: 1,
        maxWidth: isHovered ? 'calc(100% - 40px)' : 'calc(100% - 16px)',
        pointerEvents: 'none',
      }}>
        {isEditingText && resolvedItemType === 'text' ? (
          <input
            type="text"
            value={tempText}
            onChange={(e) => setTempText(e.target.value)}
            onBlur={handleTextSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTextSave();
              if (e.key === 'Escape') handleTextCancel();
            }}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#FFFFFF',
              width: '100%',
              font: 'inherit',
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          getItemLabel()
        )}
      </span>

      {/* Delete button - only on hover */}
      {isHovered && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.15 }}
          onClick={handleDeleteClick}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 20,
            height: 20,
            backgroundColor: 'rgba(255, 68, 68, 0.9)',
            border: 'none',
            borderRadius: '4px',
            color: 'white',
            fontSize: 14,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 31,
            fontWeight: 'bold',
          }}
        >
          ×
        </motion.button>
      )}

      {/* Resize handles */}
      {/* Roll Edit 模式：hover 时且相邻时，显示高亮手柄 */}
      {/* 普通模式：hover 时显示手柄 */}
      {/* 联动显示：相邻 item hover 时也显示 */}
      {(isHovered || shouldHighlightLeft || shouldHighlightRight) && (
        <>
          {/* 左边缘手柄 - 向左延伸,覆盖边界 */}
          <div
            onMouseDown={(e) => {
              e.stopPropagation(); // 阻止事件冒泡,防止触发 dnd-kit 拖动
              if (hasAdjacentItemOnLeft && onRollEdit) {
                // Roll Edit 模式
                handleResizeMouseDown('left', e, true);
              } else {
                // 普通 trim 模式
                handleResizeMouseDown('left', e);
              }
            }}
            onPointerDown={(e) => e.stopPropagation()} // 阻止 dnd-kit 的 pointer 事件
            style={{
              position: 'absolute',
              left: -6,  // 向左延伸 6px,覆盖边界
              top: 0,
              bottom: 0,
              width: 12,
              cursor: 'ew-resize',
              zIndex: 10,
              backgroundColor: shouldHighlightLeft
                ? 'rgba(255, 165, 0, 0.6)'  // Roll Edit: 橙色高亮
                : resizingEdge === 'left' ? 'rgba(0, 102, 255, 0.3)' : 'transparent',
              touchAction: 'none', // 防止触摸事件干扰
            }}
          />
          {/* 右边缘手柄 - 向右延伸,覆盖边界 */}
          <div
            onMouseDown={(e) => {
              e.stopPropagation(); // 阻止事件冒泡,防止触发 dnd-kit 拖动
              if (hasAdjacentItemOnRight && onRollEdit) {
                // Roll Edit 模式
                handleResizeMouseDown('right', e, true);
              } else {
                // 普通 trim 模式
                handleResizeMouseDown('right', e);
              }
            }}
            onPointerDown={(e) => e.stopPropagation()} // 阻止 dnd-kit 的 pointer 事件
            style={{
              position: 'absolute',
              right: -6,  // 向右延伸 6px,覆盖边界
              top: 0,
              bottom: 0,
              width: 12,
              cursor: 'ew-resize',
              zIndex: 10,
              backgroundColor: shouldHighlightRight
                ? 'rgba(255, 165, 0, 0.6)'  // Roll Edit: 橙色高亮
                : resizingEdge === 'right' ? 'rgba(0, 102, 255, 0.3)' : 'transparent',
              touchAction: 'none', // 防止触摸事件干扰
            }}
          />
        </>
      )}

      {/* Color picker for solid items - use resolved type */}
      {resolvedItemType === 'solid' && isHovered && (
        <input
          type="color"
          value={(item as any).color}
          onChange={(e) => onUpdate(item.id, { color: e.target.value })}
          style={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            width: 20,
            height: 20,
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            zIndex: 2,
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
};
