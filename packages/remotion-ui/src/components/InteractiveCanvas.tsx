import React, { useRef, useEffect, useState, useCallback } from 'react';
import Moveable from 'react-moveable';
import { Player, PlayerRef } from '@remotion/player';
import { VideoComposition } from '@master-clash/remotion-components';
import type { Track, Item, ItemProperties } from '@master-clash/remotion-core';
import { findTopItemAtPoint } from './canvas/hitTest';

interface InteractiveCanvasProps {
  tracks: Track[];
  allNodesMap?: Map<string, any>; // Map of node ID -> node data for resolving assetId references
  selectedItemId: string | null;
  currentFrame: number;
  compositionWidth: number;
  compositionHeight: number;
  fps: number;
  durationInFrames: number;
  onUpdateItem: (trackId: string, itemId: string, updates: Partial<Item>) => void;
  onSelectItem?: (itemId: string | null) => void;
  playing?: boolean;
  onRequestPause?: () => void;
}

export const InteractiveCanvas: React.FC<InteractiveCanvasProps> = ({
  tracks,
  allNodesMap,
  selectedItemId,
  currentFrame,
  compositionWidth,
  compositionHeight,
  fps,
  durationInFrames,
  onUpdateItem,
  onSelectItem,
  playing = false,
  onRequestPause,
}) => {
  const playerRef = useRef<PlayerRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerStageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);
  const itemsDomMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const moveableRef = useRef<Moveable | null>(null);
  const moveableSessionRef = useRef<{
    trackId: string;
    itemId: string;
    startProperties: ItemProperties;
    startRect: { left: number; top: number; width: number; height: number };
    startRotation: number;
    startPointer?: { x: number; y: number };
  } | null>(null);
  const isInteractingRef = useRef(false);
  const rafUpdateRef = useRef<number | null>(null);
  const [moveableTarget, setMoveableTarget] = useState<HTMLElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [, forceUpdate] = useState({});
  const prevPlayingRef = useRef(playing);
  const mediaAspectRatioRef = useRef<Map<string, number>>(new Map());

  // 找到选中的 item
  const selectedItemData = selectedItemId
    ? tracks
        .flatMap((t) => t.items.map((i) => ({ trackId: t.id, item: i })))
        .find((x) => x.item.id === selectedItemId)
    : null;

  // --- Helper: Convert R2 key to viewable URL ---
  const resolveAssetUrl = useCallback((src: string): string => {
    if (!src) return '';
    // If it's an R2 key (starts with 'projects/'), convert to API URL
    if (src.startsWith('projects/') || src.startsWith('/projects/')) {
      const cleanKey = src.startsWith('/') ? src.slice(1) : src;
      return `/api/assets/view/${cleanKey}`;
    }
    // Otherwise return as-is (blob:, http:, data:, /api/assets/view/, etc.)
    return src;
  }, []);

  // --- Utility function: get media aspect ratio ---
  // Resolves src and type from allNodesMap for reference-based timeline items
  const getMediaAspectRatio = useCallback(async (item: Item): Promise<number | null> => {
    // Resolve src and type from item directly or via assetId (reference-based model)
    let src = (item as any).src as string | undefined;
    let itemType = item.type as string | undefined;

    // If no direct src/type, try to resolve from allNodesMap via assetId
    if (item.assetId && allNodesMap) {
      const asset = allNodesMap.get(item.assetId);
      if (asset) {
        if (!src && asset.data?.src) {
          src = asset.data.src;
        }
        if (!itemType && asset.type) {
          itemType = asset.type;
        }
      }
    }

    if (!src) return null;

    // Convert R2 key to viewable URL for loading
    const loadableSrc = resolveAssetUrl(src);

    // 1. Check cache (use original src as cache key for consistency)
    const cached = mediaAspectRatioRef.current.get(src);
    if (cached) return cached;

    // 2. Check DOM (if already rendered)
    const el = itemsDomMapRef.current.get(item.id);
    if (el instanceof HTMLImageElement && el.naturalWidth && el.naturalHeight) {
      const ratio = el.naturalWidth / el.naturalHeight;
      mediaAspectRatioRef.current.set(src, ratio);
      return ratio;
    }
    if (el instanceof HTMLVideoElement && el.videoWidth && el.videoHeight) {
      const ratio = el.videoWidth / el.videoHeight;
      mediaAspectRatioRef.current.set(src, ratio);
      return ratio;
    }

    if (typeof window === 'undefined') return null;

    // 3. Actively load to get dimensions (use resolved itemType and loadableSrc)
    if (itemType === 'image') {
      const ratio = await new Promise<number | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null);
        img.onerror = () => {
          console.error('[InteractiveCanvas] Failed to load image for aspect ratio:', loadableSrc);
          resolve(null);
        };
        img.src = loadableSrc;
      });
      if (ratio) mediaAspectRatioRef.current.set(src, ratio);
      return ratio;
    }
    if (itemType === 'video') {
      const ratio = await new Promise<number | null>((resolve) => {
        const video = document.createElement('video');
        const cleanup = () => {
          video.removeAttribute('src');
          video.load();
        };
        video.addEventListener('loadedmetadata', () => {
          const r = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : null;
          cleanup();
          resolve(r);
        });
        video.addEventListener('error', () => {
          console.error('[InteractiveCanvas] Failed to load video for aspect ratio:', loadableSrc);
          cleanup();
          resolve(null);
        });
        video.src = loadableSrc;
      });
      if (ratio) mediaAspectRatioRef.current.set(src, ratio);
      return ratio;
    }
    return null;
  }, [allNodesMap, resolveAssetUrl]);

  useEffect(() => {
    isInteractingRef.current = false;
    moveableSessionRef.current = null;
  }, [selectedItemData?.item.id]);

  // 自动初始化 properties（如果不存在）
  useEffect(() => {
    if (selectedItemData && !selectedItemData.item.properties) {
      const defaultProperties: ItemProperties = {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        rotation: 0,
        opacity: 1,
      };
      onUpdateItem(selectedItemData.trackId, selectedItemData.item.id, {
        properties: defaultProperties,
      });
    }
  }, [selectedItemData, onUpdateItem]);

  useEffect(() => {
    const syncAspectRatio = async () => {
      if (isInteractingRef.current) return;
      if (!selectedItemData?.item.properties) return;

      // Resolve type from item directly or via assetId (reference-based model)
      let itemType = selectedItemData.item.type as string | undefined;
      if (!itemType && selectedItemData.item.assetId && allNodesMap) {
        const asset = allNodesMap.get(selectedItemData.item.assetId);
        if (asset?.type) {
          itemType = asset.type;
        }
      }
      if (!itemType || !['image', 'video'].includes(itemType)) return;

      const ratio = await getMediaAspectRatio(selectedItemData.item);
      if (!ratio) return;
      const props = selectedItemData.item.properties;
      const targetWidth = props.height * ratio * (compositionHeight / compositionWidth);
      const currentRatio = (props.width * compositionWidth) / (props.height * compositionHeight);
      if (Math.abs(currentRatio - ratio) < 0.01) return;
      const next = {
        ...props,
        width: Math.min(1, Math.max(0.01, targetWidth)),
      };
      onUpdateItem(selectedItemData.trackId, selectedItemData.item.id, {
        properties: next,
      });
    };
    void syncAspectRatio();
  }, [selectedItemData, compositionWidth, compositionHeight, getMediaAspectRatio, onUpdateItem, allNodesMap]);

  // 检查 item 是否在当前帧可见
  const isItemVisible = selectedItemData
    ? currentFrame >= selectedItemData.item.from &&
      currentFrame < selectedItemData.item.from + selectedItemData.item.durationInFrames
    : false;

  // 准备 Player 的 inputProps
  const inputProps = React.useMemo(() => ({
    tracks,
    allNodes: allNodesMap,
    selectedItemId,
    selectionBoxRef,
    itemsDomMapRef,
  }), [tracks, allNodesMap, selectedItemId]);

  // 同步播放状态
  useEffect(() => {
    if (!playerRef.current) return;
    const wasPlaying = prevPlayingRef.current;
    if (playing && !wasPlaying) {
      playerRef.current.play();
    } else if (!playing && wasPlaying) {
      playerRef.current.pause();
    }
    prevPlayingRef.current = playing;
  }, [playing]);

  // 同步当前帧（仅在暂停时对齐）
  useEffect(() => {
    if (playerRef.current && !playing) {
      playerRef.current.seekTo(currentFrame);
    }
  }, [currentFrame, playing]);

  // 处理缩放
  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev * 1.2, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev / 1.2, 0.1));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // 处理滚轮缩放
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Cmd/Ctrl + 滚轮：缩放
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.95 : 1.05;
        setZoom((prev) => Math.max(0.1, Math.min(5, prev * delta)));
      }
    },
    []
  );

  // 绑定滚轮事件
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // 处理画布平移
  const handleCanvasPan = useCallback(
    (e: React.MouseEvent) => {
      // 空格键 + 拖拽：平移画布
      if (e.buttons === 1 && e.currentTarget === e.target) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          e.preventDefault();
          setIsPanning(true);
          setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
        }
      }
    },
    [panOffset]
  );

  const handlePanMove = useCallback(
    (e: MouseEvent) => {
      if (isPanning) {
        setPanOffset({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      }
    },
    [isPanning, panStart]
  );

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // 绑定平移事件
  useEffect(() => {
    if (isPanning) {
      window.addEventListener('mousemove', handlePanMove);
      window.addEventListener('mouseup', handlePanEnd);
      return () => {
        window.removeEventListener('mousemove', handlePanMove);
        window.removeEventListener('mouseup', handlePanEnd);
      };
    }
  }, [isPanning, handlePanMove, handlePanEnd]);

  useEffect(() => {
    forceUpdate({});
  }, []);

  // 坐标转换：从屏幕坐标到 composition 坐标
  const screenToComposition = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } => {
      const rect = playerStageRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };

      const relX = screenX - rect.left;
      const relY = screenY - rect.top;
      const scaleX = compositionWidth / rect.width;
      const scaleY = compositionHeight / rect.height;

      return {
        x: (relX - rect.width / 2) * scaleX,
        y: (relY - rect.height / 2) * scaleY,
      };
    },
    [compositionWidth, compositionHeight]
  );

  const getStageMetrics = useCallback(() => {
    const stage = playerStageRef.current;
    if (!stage) return null;
    const width = stage.offsetWidth;
    const height = stage.offsetHeight;
    if (width <= 0 || height <= 0) return null;
    return {
      width,
      height,
      scaleX: width / compositionWidth,
      scaleY: height / compositionHeight,
    };
  }, [compositionWidth, compositionHeight]);

  const applyOverlayRect = useCallback((rect: { left: number; top: number; width: number; height: number }, rotation: number) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.transform = `rotate(${rotation}deg)`;
    overlay.style.transformOrigin = 'center center';
  }, []);

  const getStageRect = useCallback(() => {
    const stage = playerStageRef.current;
    if (!stage) return null;
    return stage.getBoundingClientRect();
  }, []);

  const getOverlayRect = useCallback(() => {
    const overlay = overlayRef.current;
    const stageRect = getStageRect();
    if (!overlay || !stageRect) return null;
    const overlayRect = overlay.getBoundingClientRect();
    return {
      left: (overlayRect.left - stageRect.left) / zoom,
      top: (overlayRect.top - stageRect.top) / zoom,
      width: overlayRect.width / zoom,
      height: overlayRect.height / zoom,
    };
  }, [getStageRect, zoom]);

  const getSelectionBoxRect = useCallback(() => {
    const selection = selectionBoxRef.current;
    const stageRect = getStageRect();
    if (!selection || !stageRect) return null;
    const selectionRect = selection.getBoundingClientRect();
    return {
      left: (selectionRect.left - stageRect.left) / zoom,
      top: (selectionRect.top - stageRect.top) / zoom,
      width: selectionRect.width / zoom,
      height: selectionRect.height / zoom,
    };
  }, [getStageRect, zoom]);

  const getSelectedItemRect = useCallback(() => {
    if (!selectedItemData) return null;
    const el = itemsDomMapRef.current.get(selectedItemData.item.id);
    const stageRect = getStageRect();
    if (!el || !stageRect) return null;
    const rect = el.getBoundingClientRect();
    return {
      left: (rect.left - stageRect.left) / zoom,
      top: (rect.top - stageRect.top) / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    };
  }, [getStageRect, selectedItemData, zoom]);

  const rectToProperties = useCallback(
    (
      rect: { left: number; top: number; width: number; height: number },
      rotation: number,
      base: ItemProperties
    ): ItemProperties | null => {
      const metrics = getStageMetrics();
      const stageRect = getStageRect();
      if (!metrics || !stageRect) return null;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const width = rect.width;
      const height = rect.height;
      const next = {
        ...base,
        x: (centerX - metrics.width / 2) / metrics.scaleX,
        y: (centerY - metrics.height / 2) / metrics.scaleY,
        width: width / metrics.width,
        height: height / metrics.height,
        rotation,
      };
      return next;
    },
    [getStageMetrics, getStageRect]
  );

  const scheduleUpdate = useCallback(
    (trackId: string, itemId: string, next: ItemProperties) => {
      if (rafUpdateRef.current) {
        window.cancelAnimationFrame(rafUpdateRef.current);
      }
      rafUpdateRef.current = window.requestAnimationFrame(() => {
        onUpdateItem(trackId, itemId, {
          properties: next,
        });
        rafUpdateRef.current = null;
      });
    },
    [onUpdateItem]
  );

  useEffect(() => {
    if (!selectedItemData || !isItemVisible) {
      setMoveableTarget(null);
      return;
    }

    let rafId: number | null = null;
    let attempts = 0;

    const resolveTarget = () => {
      const nextTarget = overlayRef.current;
      if (nextTarget) {
        setMoveableTarget(nextTarget);
        return;
      }
      if (attempts < 6) {
        attempts += 1;
        rafId = window.requestAnimationFrame(resolveTarget);
      }
    };

    resolveTarget();

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [selectedItemData, isItemVisible]);

  useEffect(() => {
    moveableRef.current?.updateRect();
  }, [moveableTarget, zoom, panOffset.x, panOffset.y]);

  useEffect(() => {
    if (!selectedItemData?.item.properties || !isItemVisible) return;
    if (isInteractingRef.current) return;
    const selectionRect = getSelectionBoxRect();
    const itemRect = selectionRect ?? getSelectedItemRect();
    if (itemRect) {
      applyOverlayRect(itemRect, selectedItemData.item.properties.rotation ?? 0);
      return;
    }
    const metrics = getStageMetrics();
    if (!metrics) return;
    const width = (selectedItemData.item.properties.width ?? 1) * metrics.width;
    const height = (selectedItemData.item.properties.height ?? 1) * metrics.height;
    const left =
      metrics.width / 2 +
      (selectedItemData.item.properties.x ?? 0) * metrics.scaleX -
      width / 2;
    const top =
      metrics.height / 2 +
      (selectedItemData.item.properties.y ?? 0) * metrics.scaleY -
      height / 2;
    applyOverlayRect({ left, top, width, height }, selectedItemData.item.properties.rotation ?? 0);
  }, [
    selectedItemData,
    isItemVisible,
    getSelectedItemRect,
    getSelectionBoxRect,
    getStageMetrics,
    applyOverlayRect,
  ]);

  // 统一的指针按下处理（处理选中）
  const handlePointerDown = useCallback(
    (e: React.MouseEvent) => {
      if (!onSelectItem) return;

      const target = e.target as HTMLElement;
      if (
        target.closest('.moveable-control-box') ||
        target.closest('.moveable-control') ||
        target.closest('.moveable-line') ||
        target.closest('.zoom-controls')
      ) {
        return;
      }

      if (target.tagName === 'BUTTON' || target.closest('button')) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        return;
      }

      const { x, y } = screenToComposition(e.clientX, e.clientY);

      const hitTarget = findTopItemAtPoint(
        x,
        y,
        tracks,
        currentFrame,
        compositionWidth,
        compositionHeight
      );

      if (hitTarget) {
        if (selectedItemId !== hitTarget.itemId) {
          onSelectItem(hitTarget.itemId);
        }
        if (playing) {
          onRequestPause?.();
        }
      } else {
        onSelectItem(null);
      }
    },
    [
      tracks,
      currentFrame,
      compositionWidth,
      compositionHeight,
      selectedItemId,
      onSelectItem,
      screenToComposition,
      playing,
      onRequestPause,
    ]
  );

  // 计算画布的实际显示尺寸（保持宽高比）
  const aspectRatio = compositionWidth / compositionHeight;

  return (
    <div style={styles.container}>
      {/* 缩放控制按钮 */}
      <div className="zoom-controls" style={styles.zoomControls}>
        <button onClick={handleZoomOut} style={styles.zoomButton} title="缩小 (Cmd/Ctrl + 滚轮)">
          −
        </button>
        <span style={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
        <button onClick={handleZoomIn} style={styles.zoomButton} title="放大 (Cmd/Ctrl + 滚轮)">
          +
        </button>
        <button onClick={handleResetZoom} style={styles.resetButton} title="重置">
          ⟲
        </button>
      </div>

      {/* Remotion Player - 底层渲染 */}
      <div
        ref={containerRef}
        style={{
          ...styles.playerWrapper,
          cursor: isPanning ? 'grabbing' : 'default',
        }}
        onMouseDown={(e) => {
          handleCanvasPan(e);
          handlePointerDown(e);
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <div
            ref={playerStageRef}
            style={{
              position: 'relative',
              width: aspectRatio > 1 ? '100%' : `${aspectRatio * 100}%`,
              height: aspectRatio > 1 ? `${(1 / aspectRatio) * 100}%` : '100%',
              transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`,
              transformOrigin: 'center center',
            }}
          >
            <Player
              key={`player-${compositionWidth}-${compositionHeight}`}
              ref={playerRef}
              component={VideoComposition}
              compositionWidth={compositionWidth}
              compositionHeight={compositionHeight}
              durationInFrames={durationInFrames}
              fps={fps}
              inputProps={inputProps}
              style={styles.player}
              controls={false}
              loop={false}
            />
            {selectedItemData?.item.properties && isItemVisible && (
              <div
                ref={overlayRef}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 0,
                  height: 0,
                  pointerEvents: 'auto',
                }}
              />
            )}
          </div>
        </div>
        {moveableTarget && selectedItemData && (
          <Moveable
            ref={moveableRef}
            target={moveableTarget}
            container={containerRef.current ?? undefined}
            origin={false}
            draggable
            resizable
            rotatable
            renderDirections={['nw', 'ne', 'sw', 'se']}
            zoom={zoom}
            keepRatio
            onDragStart={() => {
              if (playing) {
                onRequestPause?.();
              }
              const rect = getOverlayRect();
              if (!rect) return;
              isInteractingRef.current = true;
              moveableSessionRef.current = {
                trackId: selectedItemData.trackId,
                itemId: selectedItemData.item.id,
                startProperties: {
                  x: selectedItemData.item.properties?.x ?? 0,
                  y: selectedItemData.item.properties?.y ?? 0,
                  width: selectedItemData.item.properties?.width ?? 1,
                  height: selectedItemData.item.properties?.height ?? 1,
                  rotation: selectedItemData.item.properties?.rotation ?? 0,
                  opacity: selectedItemData.item.properties?.opacity ?? 1,
                },
                startRect: rect,
                startRotation: selectedItemData.item.properties?.rotation ?? 0,
              };
            }}
            onDrag={(e) => {
              const session = moveableSessionRef.current;
              if (!session) return;
              const [dx, dy] = e.beforeTranslate;
              const nextRect = {
                left: session.startRect.left + dx / zoom,
                top: session.startRect.top + dy / zoom,
                width: session.startRect.width,
                height: session.startRect.height,
              };
              applyOverlayRect(nextRect, session.startRotation);
              const next = rectToProperties(nextRect, session.startRotation, session.startProperties);
              if (next) {
                next.width = session.startProperties.width;
                next.height = session.startProperties.height;
                scheduleUpdate(session.trackId, session.itemId, next);
              }
            }}
            onResizeStart={(e) => {
              if (playing) {
                onRequestPause?.();
              }
              const rect = getOverlayRect();
              if (!rect) return;
              const inputEvent = e.inputEvent as MouseEvent | undefined;
              const startPointer = inputEvent
                ? screenToComposition(inputEvent.clientX, inputEvent.clientY)
                : undefined;
              isInteractingRef.current = true;
              moveableSessionRef.current = {
                trackId: selectedItemData.trackId,
                itemId: selectedItemData.item.id,
                startProperties: {
                  x: selectedItemData.item.properties?.x ?? 0,
                  y: selectedItemData.item.properties?.y ?? 0,
                  width: selectedItemData.item.properties?.width ?? 1,
                  height: selectedItemData.item.properties?.height ?? 1,
                  rotation: selectedItemData.item.properties?.rotation ?? 0,
                  opacity: selectedItemData.item.properties?.opacity ?? 1,
                },
                startRect: rect,
                startRotation: selectedItemData.item.properties?.rotation ?? 0,
                startPointer,
              };
            }}
            onResize={(e) => {
              const session = moveableSessionRef.current;
              if (!session) return;
              const [dx, dy] = e.drag.beforeTranslate;
              const nextRect = {
                left: session.startRect.left + dx / zoom,
                top: session.startRect.top + dy / zoom,
                width: Math.max(4, e.width / zoom),
                height: Math.max(4, e.height / zoom),
              };
              applyOverlayRect(nextRect, session.startRotation);
              const inputEvent = e.inputEvent as MouseEvent | undefined;
              const direction = e.direction as [number, number] | undefined;
              if (inputEvent && session.startPointer && direction) {
                const currentPointer = screenToComposition(inputEvent.clientX, inputEvent.clientY);
                const deltaX = currentPointer.x - session.startPointer.x;
                const deltaY = currentPointer.y - session.startPointer.y;
                const [dirX, dirY] = direction;
                const baseWidth = (session.startProperties.width ?? 1) * compositionWidth;
                const baseHeight = (session.startProperties.height ?? 1) * compositionHeight;
                const startVector = {
                  x: (baseWidth / 2) * (dirX === 0 ? 1 : dirX),
                  y: (baseHeight / 2) * (dirY === 0 ? 1 : dirY),
                };
                const currentVector = {
                  x: startVector.x + deltaX,
                  y: startVector.y + deltaY,
                };
                const startDist = Math.hypot(startVector.x, startVector.y);
                const currentDist = Math.hypot(currentVector.x, currentVector.y);
                const scale = startDist > 0 ? currentDist / startDist : 1;
                const nextWidth = Math.max(4, baseWidth * scale);
                const nextHeight = Math.max(4, baseHeight * scale);
                const deltaWidth = nextWidth - baseWidth;
                const deltaHeight = nextHeight - baseHeight;
                const next = {
                  ...session.startProperties,
                  width: nextWidth / compositionWidth,
                  height: nextHeight / compositionHeight,
                  x: (session.startProperties.x ?? 0) + (deltaWidth / 2) * (dirX || 0),
                  y: (session.startProperties.y ?? 0) + (deltaHeight / 2) * (dirY || 0),
                };
                scheduleUpdate(session.trackId, session.itemId, next);
                return;
              }
              const next = rectToProperties(nextRect, session.startRotation, session.startProperties);
              if (next) {
                scheduleUpdate(session.trackId, session.itemId, next);
              }
            }}
            onRotateStart={() => {
              if (playing) {
                onRequestPause?.();
              }
              const rect = getOverlayRect();
              if (!rect) return;
              isInteractingRef.current = true;
              moveableSessionRef.current = {
                trackId: selectedItemData.trackId,
                itemId: selectedItemData.item.id,
                startProperties: {
                  x: selectedItemData.item.properties?.x ?? 0,
                  y: selectedItemData.item.properties?.y ?? 0,
                  width: selectedItemData.item.properties?.width ?? 1,
                  height: selectedItemData.item.properties?.height ?? 1,
                  rotation: selectedItemData.item.properties?.rotation ?? 0,
                  opacity: selectedItemData.item.properties?.opacity ?? 1,
                },
                startRect: rect,
                startRotation: selectedItemData.item.properties?.rotation ?? 0,
              };
            }}
            onRotate={(e) => {
              const session = moveableSessionRef.current;
              if (!session) return;
              const rotation = session.startRotation + e.beforeRotate;
              applyOverlayRect(session.startRect, rotation);
              const next = rectToProperties(session.startRect, rotation, session.startProperties);
              if (next) {
                scheduleUpdate(session.trackId, session.itemId, next);
              }
            }}
            onDragEnd={() => {
              moveableSessionRef.current = null;
              isInteractingRef.current = false;
            }}
            onResizeEnd={() => {
              moveableSessionRef.current = null;
              isInteractingRef.current = false;
            }}
            onRotateEnd={() => {
              moveableSessionRef.current = null;
              isInteractingRef.current = false;
            }}
          />
        )}
        {moveableTarget && (
          <style dangerouslySetInnerHTML={{
            __html: `
            .moveable-control-box {
              border: 2px solid #0066ff;
            }
            .moveable-line {
              background: #0066ff;
            }
            .moveable-control {
              width: 12px;
              height: 12px;
              border: 2px solid #0066ff;
              background: #ffffff;
            }
          `}} />
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  playerWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  player: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'all',
    userSelect: 'none',
  },
  zoomControls: {
    position: 'absolute',
    top: 16,
    right: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: '8px 12px',
    borderRadius: 8,
    zIndex: 1000,
  },
  zoomButton: {
    width: 28,
    height: 28,
    border: 'none',
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.2s',
  },
  resetButton: {
    width: 28,
    height: 28,
    border: 'none',
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    color: 'white',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.2s',
  },
  zoomLabel: {
    color: 'white',
    fontSize: 12,
    fontWeight: 500,
    minWidth: 45,
    textAlign: 'center',
  },
};
