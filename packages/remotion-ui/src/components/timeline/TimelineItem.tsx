import React, { useState, useCallback, CSSProperties } from 'react';
import { useDraggable } from '../ui/dnd';
import type { Item, BaseItem, Asset, Track } from '@master-clash/remotion-core';
import {
  findAssetForItem,
  getItemResolvedSrc,
  getItemResolvedType,
  getItemSourceNodeId,
  useEditorStaticState,
} from '@master-clash/remotion-core';
import { frameToPixels, secondsToFrames } from './utils/timeFormatter';
import { getRendererForItem } from './items/registry';
import { generateVideoThumbnailAtTime, thumbnailCache } from '../../utils/thumbnailCache';
import {
  DEFAULT_FILMSTRIP_SAMPLE_COUNT,
  createFilmstripColumnMapping,
  createFilmstripCacheEntry,
  createSerializedTaskQueue,
  drawFilmstripColumnsForSample,
  type FilmstripCacheEntry,
  generateVideoFilmstrip,
  getOrCreatePendingTask,
  getPersistentVideoCacheId,
  renderFilmstripToCanvas,
} from './videoThumbnailUtils';
import { TimelineColorInput, TimelineIconButton, TimelineTextInput } from '../ui/controls';
import { useDragGesture } from '../ui/gesture';
import { TimelineSlider } from '../ui/timeline-slider';

// Store dragged item globally on window object for cross-module access
declare global {
  interface Window {
    currentDraggedItem: { item: Item; trackId: string } | null;
  }
}

const pendingFilmstripBuilds = new Map<string, Promise<string | undefined>>();
const enqueueFilmstripBuild = createSerializedTaskQueue();

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
  const { fps } = useEditorStaticState();
  const [isHovered, setIsHovered] = useState(false);
  const [resizingEdge, setResizingEdge] = useState<'left' | 'right' | null>(null);
  const [draggingFade, setDraggingFade] = useState<{ type: 'in' | 'out' } | null>(null);
  const [isEditingText, setIsEditingText] = useState(false);
  const [tempText, setTempText] = useState('');
  const waveformContainerRef = React.useRef<HTMLDivElement | null>(null);

  const width = frameToPixels(item.durationInFrames, pixelsPerFrame);

  // Resolve item type and src from asset if using reference-based model
  // This is needed because reference-based items only have assetId, not type/src directly
  const resolvedItemType = React.useMemo(() => {
    return getItemResolvedType(item as BaseItem & { type?: Item['type']; src?: string }, assets);
  }, [item, assets]);

  const resolvedItemSrc = React.useMemo(() => {
    return getItemResolvedSrc(item as BaseItem & { src?: string }, assets);
  }, [item, assets]);

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
      case 'caption':
        return '#0f766e';
      case 'composition':
        return '#4f46e5';
      case 'derived-overlay':
        return '#db2777';
      default:
        return '#666666';
    }
  };

  // Get asset data (for thumbnail and waveform) - use resolved type
  const asset = React.useMemo(() => {
    return findAssetForItem(item as BaseItem & { src?: string; type?: Item['type'] }, assets);
  }, [item, assets]);

  const staticThumbnail = asset?.thumbnail || (resolvedItemType === 'image' ? resolvedItemSrc : undefined);
  const itemWaveform: number[] | undefined =
    (resolvedItemType === 'audio' || resolvedItemType === 'video') && 'waveform' in item
      ? (item as any).waveform as number[] | undefined
      : undefined;
  const hasWaveform: boolean = Array.isArray(itemWaveform) && itemWaveform.length > 0;
  const sourceStartInFrames = (item as any).sourceStartInFrames || 0;
  const sourceNodeId = getItemSourceNodeId(item);
  const itemBackingAssetId = item.sourceNodeId ? item.assetId : undefined;
  const persistentVideoCacheId = React.useMemo(
    () => getPersistentVideoCacheId(
      asset?.backingAssetId ?? itemBackingAssetId,
      sourceNodeId,
      resolvedItemSrc
    ),
    [asset?.backingAssetId, itemBackingAssetId, sourceNodeId, resolvedItemSrc]
  );
  const filmstripCacheKey = persistentVideoCacheId ? `filmstrip:${persistentVideoCacheId}` : null;
  const fallbackThumbnailCacheKey = persistentVideoCacheId
    ? `thumb:${persistentVideoCacheId}:${sourceStartInFrames}`
    : null;
  const [filmstripThumbnail, setFilmstripThumbnail] = React.useState<string | null>(null);
  const [fallbackVideoThumbnail, setFallbackVideoThumbnail] = React.useState<string | null>(null);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = React.useState(false);
  const filmstripGenerationRef = React.useRef(0);
  const fallbackThumbnailGenerationRef = React.useRef(0);
  const attemptedFilmstripKeyRef = React.useRef<string | null>(null);
  const progressiveFilmstripCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [hasProgressiveFilmstripFrame, setHasProgressiveFilmstripFrame] = React.useState(false);

  const displayThumbnail = resolvedItemType === 'video'
    ? (fallbackVideoThumbnail || asset?.thumbnail || undefined)
    : staticThumbnail;
  const hasVideoThumbnailSurface = resolvedItemType === 'video' && Boolean(
    hasProgressiveFilmstripFrame ||
    filmstripThumbnail ||
    fallbackVideoThumbnail ||
    asset?.thumbnail
  );

  // Calculate heights - ensure items fit within 72px track height
  const hasVideoWithThumbnail = hasVideoThumbnailSurface && hasWaveform;
  const itemHeight = hasVideoWithThumbnail ? 60 : (hasWaveform ? 56 : 44);
  const borderSize = isSelected ? 2 : 1;
  const availableHeight = itemHeight - (borderSize * 2);
  // For video items with both thumbnail and waveform, use a 7:3 ratio (thumbnail:waveform)
  // Keep existing behavior for other item types
  const thumbnailHeight = hasVideoWithThumbnail
    ? Math.max(1, Math.floor(availableHeight * 0.7))
    : (hasWaveform ? Math.floor(availableHeight * 0.6) : 44);

  const fullVideoFrames = asset?.duration
    ? secondsToFrames(asset.duration, fps)
    : item.durationInFrames;
  const fullVideoPixelWidth = frameToPixels(fullVideoFrames, pixelsPerFrame);

  React.useEffect(() => {
    attemptedFilmstripKeyRef.current = null;
    setHasProgressiveFilmstripFrame(false);
  }, [filmstripCacheKey]);

  React.useEffect(() => {
    if (resolvedItemType !== 'video') {
      setFilmstripThumbnail(null);
      setFallbackVideoThumbnail(null);
      return;
    }

    setFilmstripThumbnail(filmstripCacheKey ? thumbnailCache.get(filmstripCacheKey) : null);
    setFallbackVideoThumbnail(
      fallbackThumbnailCacheKey ? thumbnailCache.get(fallbackThumbnailCacheKey) : null
    );
  }, [resolvedItemType, filmstripCacheKey, fallbackThumbnailCacheKey]);

  React.useEffect(() => {
    if (
      resolvedItemType !== 'video' ||
      !filmstripThumbnail ||
      !asset?.duration
    ) {
      return;
    }

    let cancelled = false;
    const targetCanvas = progressiveFilmstripCanvasRef.current;
    const targetContext = targetCanvas?.getContext('2d');
    if (!targetCanvas || !targetContext) {
      return;
    }

    const destHeight = Math.max(16, Math.floor(hasWaveform ? thumbnailHeight : itemHeight));
    const previewWidth = Math.max(1, Math.ceil(fullVideoPixelWidth));

    const renderCachedStrip = (image: HTMLImageElement) => {
      if (cancelled) {
        return;
      }

      const stripWidth = image.naturalWidth || image.width;
      const stripHeight = image.naturalHeight || image.height;
      if (!stripWidth || !stripHeight) {
        return;
      }

      const stripCanvas = document.createElement('canvas');
      stripCanvas.width = stripWidth;
      stripCanvas.height = stripHeight;
      const stripContext = stripCanvas.getContext('2d');
      if (!stripContext) {
        return;
      }

      stripContext.drawImage(image, 0, 0, stripWidth, stripHeight);

      const entry = createFilmstripCacheEntry({
        canvas: stripCanvas,
        sampleCount: DEFAULT_FILMSTRIP_SAMPLE_COUNT,
        duration: asset.duration ?? 0,
      });

      targetCanvas.width = previewWidth;
      targetCanvas.height = destHeight;
      targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      renderFilmstripToCanvas({
        target: targetContext,
        entry,
        destHeight,
        fullVideoPixelWidth,
      });
      setHasProgressiveFilmstripFrame(true);
    };

    const image = new Image();
    image.decoding = 'async';
    image.onload = () => renderCachedStrip(image);
    image.onerror = () => {
      if (!cancelled) {
        setHasProgressiveFilmstripFrame(false);
      }
    };
    image.src = filmstripThumbnail;

    if (image.complete && image.naturalWidth > 0) {
      renderCachedStrip(image);
    }

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [
    resolvedItemType,
    filmstripThumbnail,
    asset?.duration,
    fullVideoPixelWidth,
    hasWaveform,
    thumbnailHeight,
    itemHeight,
  ]);

  React.useEffect(() => {
    if (
      resolvedItemType !== 'video' ||
      !resolvedItemSrc ||
      !fallbackThumbnailCacheKey ||
      filmstripThumbnail ||
      fallbackVideoThumbnail ||
      asset?.thumbnail
    ) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const run = async () => {
      const generationId = fallbackThumbnailGenerationRef.current + 1;
      fallbackThumbnailGenerationRef.current = generationId;

      const cached = thumbnailCache.get(fallbackThumbnailCacheKey);
      if (cached) {
        if (!cancelled && fallbackThumbnailGenerationRef.current === generationId) {
          setFallbackVideoThumbnail(cached);
        }
        return;
      }

      const generated = await generateVideoThumbnailAtTime(
        resolvedItemSrc,
        sourceStartInFrames / fps
      );

      if (
        cancelled ||
        fallbackThumbnailGenerationRef.current !== generationId ||
        !generated
      ) {
        return;
      }

      thumbnailCache.set(fallbackThumbnailCacheKey, generated);
      setFallbackVideoThumbnail(generated);
    };

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(run, { timeout: 500 });
    } else {
      timeoutId = setTimeout(run, 120);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [
    resolvedItemType,
    resolvedItemSrc,
    fallbackThumbnailCacheKey,
    filmstripThumbnail,
    fallbackVideoThumbnail,
    asset?.thumbnail,
    sourceStartInFrames,
    fps,
  ]);

  React.useEffect(() => {
    if (
      resolvedItemType !== 'video' ||
      !resolvedItemSrc ||
      !asset?.duration ||
      !filmstripCacheKey ||
      filmstripThumbnail ||
      attemptedFilmstripKeyRef.current === filmstripCacheKey
    ) {
      return;
    }

    attemptedFilmstripKeyRef.current = filmstripCacheKey;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const run = async () => {
      setIsGeneratingThumbnail(true);
      setHasProgressiveFilmstripFrame(false);
      const generationId = filmstripGenerationRef.current + 1;
      filmstripGenerationRef.current = generationId;
      const destHeight = Math.max(16, Math.floor(hasWaveform ? thumbnailHeight : itemHeight));
      const previewCanvas = progressiveFilmstripCanvasRef.current;
      const previewContext = previewCanvas?.getContext('2d');
      let progressiveMapping: ReturnType<typeof createFilmstripColumnMapping> | null = null;

      if (previewCanvas && previewContext) {
        previewCanvas.width = Math.max(1, Math.ceil(fullVideoPixelWidth));
        previewCanvas.height = destHeight;
        previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      }

      const generated = await getOrCreatePendingTask(
        pendingFilmstripBuilds,
        filmstripCacheKey,
        () =>
          enqueueFilmstripBuild(() =>
            generateVideoFilmstrip({
              videoSrc: resolvedItemSrc,
              duration: asset.duration ?? 0,
              onSample:
                previewContext && previewCanvas
                  ? (snapshot: FilmstripCacheEntry, sampleIndex: number) => {
                    if (cancelled || filmstripGenerationRef.current !== generationId) {
                      return;
                    }

                    progressiveMapping ??= createFilmstripColumnMapping({
                      entry: snapshot,
                      destHeight,
                      fullVideoPixelWidth,
                    });

                    const drawnColumns = drawFilmstripColumnsForSample({
                      target: previewContext,
                      entry: snapshot,
                      mapping: progressiveMapping,
                      sampleIndex,
                      destHeight,
                    });

                    if (drawnColumns > 0) {
                      setHasProgressiveFilmstripFrame(true);
                    }
                  }
                  : undefined,
            })
          )
      );

      if (cancelled || filmstripGenerationRef.current !== generationId) {
        return;
      }

      if (generated) {
        thumbnailCache.set(filmstripCacheKey, generated);
        setFilmstripThumbnail(generated);
      }

      setIsGeneratingThumbnail(false);
    };

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(run, { timeout: 700 });
    } else {
      timeoutId = setTimeout(run, 120);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      setIsGeneratingThumbnail(false);
      setHasProgressiveFilmstripFrame(false);
    };
  }, [
    resolvedItemType,
    resolvedItemSrc,
    asset?.duration,
    filmstripCacheKey,
    filmstripThumbnail,
    fullVideoPixelWidth,
    hasWaveform,
    thumbnailHeight,
    itemHeight,
  ]);

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
  const maxFadeFrames = Math.floor((item.durationInFrames * 2) / 3);
  const fadeSliderWidth = Math.max(12, maxFadeFrames * pixelsPerFrame);

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
    const totalFrames = secondsToFrames(asset.duration, fps);
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

  const updateFade = useCallback((type: 'in' | 'out', value: number) => {
    const frames = Math.max(0, Math.min(maxFadeFrames, Math.round(value)));
    onUpdate(item.id, type === 'in' ? { audioFadeIn: frames } : { audioFadeOut: frames });
  }, [item.id, maxFadeFrames, onUpdate]);

  const updateVolume = useCallback((value: number) => {
    const volume = Math.max(0, Math.min(2, value));
    onUpdate(item.id, { volume });
  }, [item.id, onUpdate]);

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

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  }, [onSelect]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  }, [onDelete]);

  const resizeGestureBind = useDragGesture<PointerEvent>(
    ({ first, last, movement: [movementX], args: [edge, isRollEdit], event }) => {
      event.preventDefault();
      event.stopPropagation();

      if (first) {
        setResizingEdge(edge);
        onResizeStart?.(edge);
      }

      const deltaFrames = Math.round(movementX / pixelsPerFrame);

      if (isRollEdit && onRollEdit) {
        onRollEdit(edge, deltaFrames);
      } else {
        onResize?.(edge, deltaFrames);
      }

      const viewportEl = (event.currentTarget as HTMLElement | null)?.closest('.tracks-viewport') as HTMLDivElement | null;
      if (viewportEl) {
        const SCROLL_EDGE = 40;
        const MAX_STEP = 40;
        const viewportRect = viewportEl.getBoundingClientRect();
        const pointerX = event.clientX;
        let step = 0;

        if (pointerX > viewportRect.right - SCROLL_EDGE) {
          step = Math.min(MAX_STEP, (pointerX - (viewportRect.right - SCROLL_EDGE)) * 0.5);
        } else if (pointerX < viewportRect.left + SCROLL_EDGE) {
          step = -Math.min(MAX_STEP, ((viewportRect.left + SCROLL_EDGE) - pointerX) * 0.5);
        }

        if (step !== 0) {
          viewportEl.scrollLeft += step;
        }
      }

      if (last) {
        setResizingEdge(null);
        onResizeEnd?.();
      }
    },
    {
      preventDefault: true,
      pointer: { capture: true },
      eventOptions: { passive: false },
    },
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
      role={isDragOverlay ? undefined : 'button'}
      tabIndex={isDragOverlay ? undefined : 0}
      aria-label={`${resolvedItemType ?? 'item'}: ${getItemLabel()}`}
      aria-pressed={isSelected}
      className="timeline-item"
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
              backgroundSize: 'cover',
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
              backgroundColor: displayThumbnail ? 'transparent' : '#000',
              backgroundImage: displayThumbnail ? `url(${displayThumbnail})` : undefined,
              backgroundSize: 'auto 100%',
              backgroundPosition: 'left top',
              backgroundRepeat: 'repeat-x',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: '100%',
                width: `${fullVideoPixelWidth}px`,
                transform: `translateX(${(-(sourceStartInFrames) * pixelsPerFrame)}px)`,
                willChange: 'transform',
                opacity: hasProgressiveFilmstripFrame ? 1 : 0,
              }}
            >
              <canvas
                ref={progressiveFilmstripCanvasRef}
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'block',
                }}
              />
            </div>
            {isGeneratingThumbnail && !displayThumbnail && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                }}
              />
            )}
          </div>
      )}

      {/* Waveform */}
      {hasWaveform && itemWaveform && (
        <div
          ref={waveformContainerRef}
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
              <>
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: `${clampedLineY}px`,
                    left: 0,
                    width: '100%',
                    height: '1px',
                    backgroundColor: isHovered ? 'rgba(255, 255, 255, 0.5)' : 'transparent',
                    zIndex: 3,
                    pointerEvents: 'none',
                  }}
                />
                <TimelineSlider
                  min={0}
                  max={2}
                  step={0.01}
                  value={itemVolume}
                  aria-label="Volume"
                  aria-orientation="vertical"
                  aria-valuetext={`${Math.round(itemVolume * 100)}%`}
                  title={isHovered ? `Volume: ${Math.round(itemVolume * 100)}%` : ''}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(event) => updateVolume(Number(event.currentTarget.value))}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    margin: 0,
                    opacity: 0,
                    cursor: isHovered ? 'ns-resize' : 'default',
                    pointerEvents: isHovered ? 'auto' : 'none',
                    zIndex: 4,
                    writingMode: 'vertical-lr',
                    direction: 'rtl',
                    WebkitAppearance: 'slider-vertical',
                  }}
                />
              </>
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
      {hasWaveform && (isHovered || draggingFade) && (
        <>
          {/* Fade In Handle */}
          <TimelineSlider
            min={0}
            max={maxFadeFrames}
            step={1}
            value={audioFadeIn}
            aria-label="Fade in duration"
            aria-valuetext={`${(audioFadeIn / fps).toFixed(2)} seconds`}
            title={`Fade In: ${(audioFadeIn / fps).toFixed(1)}s`}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDraggingFade({ type: 'in' });
            }}
            onPointerUp={() => setDraggingFade(null)}
            onPointerCancel={() => setDraggingFade(null)}
            onBlur={() => setDraggingFade(null)}
            onClick={(e) => e.stopPropagation()}
            onChange={(event) => updateFade('in', Number(event.currentTarget.value))}
            style={{
              position: 'absolute',
              left: 0,
              top: hasVideoWithThumbnail ? `${thumbnailHeight - 12}px` : (hasWaveform ? `${thumbnailHeight - 12}px` : '-12px'),
              width: `${fadeSliderWidth}px`,
              height: '24px',
              margin: 0,
              opacity: 0,
              cursor: 'ew-resize',
              zIndex: 31,
              pointerEvents: 'auto',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${audioFadeIn * pixelsPerFrame - 6}px`,
              top: hasVideoWithThumbnail ? `${thumbnailHeight - 6}px` : (hasWaveform ? `${thumbnailHeight - 6}px` : '-6px'),
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: '#fff',
              border: '2px solid #FF6B50',
              zIndex: 30,
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
              pointerEvents: 'none',
            }}
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
                {(audioFadeIn / fps).toFixed(2)}s
              </div>
            )}
          </div>

          {/* Fade Out Handle */}
          <TimelineSlider
            min={0}
            max={maxFadeFrames}
            step={1}
            value={audioFadeOut}
            dir="rtl"
            aria-label="Fade out duration"
            aria-valuetext={`${(audioFadeOut / fps).toFixed(2)} seconds`}
            title={`Fade Out: ${(audioFadeOut / fps).toFixed(1)}s`}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDraggingFade({ type: 'out' });
            }}
            onPointerUp={() => setDraggingFade(null)}
            onPointerCancel={() => setDraggingFade(null)}
            onBlur={() => setDraggingFade(null)}
            onClick={(e) => e.stopPropagation()}
            onChange={(event) => updateFade('out', Number(event.currentTarget.value))}
            style={{
              position: 'absolute',
              right: 0,
              top: hasVideoWithThumbnail ? `${thumbnailHeight - 12}px` : (hasWaveform ? `${thumbnailHeight - 12}px` : '-12px'),
              width: `${fadeSliderWidth}px`,
              height: '24px',
              margin: 0,
              opacity: 0,
              cursor: 'ew-resize',
              zIndex: 31,
              pointerEvents: 'auto',
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: `${audioFadeOut * pixelsPerFrame - 6}px`,
              top: hasVideoWithThumbnail ? `${thumbnailHeight - 6}px` : (hasWaveform ? `${thumbnailHeight - 6}px` : '-6px'),
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: '#fff',
              border: '2px solid #FF6B50',
              zIndex: 30,
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
              pointerEvents: 'none',
            }}
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
                {(audioFadeOut / fps).toFixed(2)}s
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
        backgroundColor: (displayThumbnail || hasWaveform) ? 'rgba(0, 0, 0, 0.7)' : 'transparent',
        padding: (displayThumbnail || hasWaveform) ? '2px 6px' : '0',
        borderRadius: (displayThumbnail || hasWaveform) ? '3px' : '0',
        zIndex: 1,
        maxWidth: isHovered ? 'calc(100% - 40px)' : 'calc(100% - 16px)',
        pointerEvents: 'none',
      }}>
        {isEditingText && resolvedItemType === 'text' ? (
          <TimelineTextInput
            value={tempText}
            onChange={(e) => setTempText(e.target.value)}
            onBlur={handleTextSave}
            onCommit={handleTextSave}
            onCancel={handleTextCancel}
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
        <TimelineIconButton
          onClick={handleDeleteClick}
          aria-label={`Delete ${getItemLabel()}`}
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
        </TimelineIconButton>
      )}

      {/* Resize handles */}
      {/* Roll Edit 模式：hover 时且相邻时，显示高亮手柄 */}
      {/* 普通模式：hover 时显示手柄 */}
      {/* 联动显示：相邻 item hover 时也显示 */}
      {(isHovered || shouldHighlightLeft || shouldHighlightRight) && (
        <>
          {/* 左边缘手柄 - 向左延伸,覆盖边界 */}
          <div
            {...resizeGestureBind('left', Boolean(hasAdjacentItemOnLeft && onRollEdit))}
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
            {...resizeGestureBind('right', Boolean(hasAdjacentItemOnRight && onRollEdit))}
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
        <TimelineColorInput
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
