import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Player, PlayerRef } from '@remotion/player';
import { VideoComposition } from '@master-clash/remotion-components';
import type { Track, Item, ItemProperties } from '@master-clash/remotion-core';

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
  onSeek?: (frame: number) => void;
  onFrameUpdate?: (frame: number) => void;
  onPlayingChange?: (playing: boolean) => void;
}

type DragMode = 'move' | 'rotate' | 'scale-tl' | 'scale-tr' | 'scale-bl' | 'scale-br' | null;

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  startProperties: ItemProperties;
  item: Item;
  trackId: string;
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
  onSeek: _onSeek,
  onFrameUpdate,
  onPlayingChange,
}) => {
  const playerRef = useRef<PlayerRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);
  const itemsDomMapRef = useRef<Map<string, HTMLElement>>(new Map());
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [snapLines, setSnapLines] = useState<{ centerX?: boolean; centerY?: boolean; left?: boolean; right?: boolean; top?: boolean; bottom?: boolean } | null>(null);
  const [, forceUpdate] = useState({});
  const mediaAspectRatioRef = useRef<Map<string, number>>(new Map());

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

  // --- Helper: Get natural dimensions from item/asset ---
  const getNaturalDimensions = useCallback((item: Item) => {
    let naturalWidth = compositionWidth;
    let naturalHeight = compositionHeight;
    let asset = null;

    if (allNodesMap) {
      // 1. Try by assetId
      if (item.assetId) {
        asset = allNodesMap.get(item.assetId);
      }

      // 2. Try by src
      if (!asset && 'src' in item) {
        const itemSrc = (item as any).src;
        for (const [_, node] of allNodesMap.entries()) {
          if (node.data?.src === itemSrc) {
            asset = node;
            break;
          }
        }
      }
    }

    if (asset) {
      const assetData = asset.data || {};
      if (assetData.naturalWidth && assetData.naturalHeight) {
        naturalWidth = assetData.naturalWidth;
        naturalHeight = assetData.naturalHeight;
      } else if (assetData.aspectRatio && typeof assetData.aspectRatio === 'string') {
        const ar = assetData.aspectRatio;
        if (ar.includes(':')) {
          const [w, h] = ar.split(':').map(Number);
          if (w && h) {
            naturalWidth = 1920;
            naturalHeight = Math.round(1920 * h / w);
          }
        }
      }
    }
    return { naturalWidth, naturalHeight };
  }, [allNodesMap, compositionWidth, compositionHeight]);

  // --- 辅助函数：获取媒体宽高比 ---
  // Resolves src and type from allNodesMap for reference-based timeline items
  const getMediaAspectRatio = useCallback(async (item: Item): Promise<number | null> => {
    // Resolve src and type from item directly or via assetId (reference-based model)
    let src = (item as any).src as string | undefined;
    let itemType = item.type as string | undefined;
    let asset = null;

    // If no direct src/type, try to resolve from allNodesMap via assetId
    if (item.assetId && allNodesMap) {
      asset = allNodesMap.get(item.assetId);
      if (asset) {
        if (!src && asset.data?.src) {
          src = asset.data.src;
        }
        if (!itemType && asset.type) {
          itemType = asset.type;
        }
      }
    }

    console.log(`[getMediaAspectRatio] itemId=${item.id} assetId=${item.assetId} directSrc=${src || 'none'} directType=${itemType || 'none'} assetFound=${!!asset} resolvedSrc=${src || 'none'} resolvedType=${itemType || 'none'}`);

    if (!src) {
      return null;
    }

    // Convert R2 key to viewable URL for loading
    const loadableSrc = resolveAssetUrl(src);

    // 1. 查缓存 (use original src as cache key for consistency)
    const cached = mediaAspectRatioRef.current.get(src);
    if (cached) return cached;

    // 2. 查 DOM (如果已经渲染)
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

    // 3. 主动加载获取 (use resolved itemType and loadableSrc)
    if (itemType === 'image') {
      const ratio = await new Promise<number | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null);
        img.onerror = () => {
          console.error(`[InteractiveCanvas] Image load failed for aspect ratio src="${loadableSrc}"`);
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
          console.error(`[InteractiveCanvas] Video load failed for aspect ratio src="${loadableSrc}"`);
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

  // --- 核心坐标系统 ---

  // 1. 计算播放器在容器中的基础尺寸和偏移（未缩放/平移前）
  const getBaseMetrics = useCallback(() => {
    if (!containerRef.current) return null;
    const containerRect = containerRef.current.getBoundingClientRect();
    const containerAspect = containerRect.width / containerRect.height;
    const compositionAspect = compositionWidth / compositionHeight;

    let width, height;
    if (compositionAspect > containerAspect) {
      width = containerRect.width;
      height = containerRect.width / compositionAspect;
    } else {
      height = containerRect.height;
      width = containerRect.height * compositionAspect;
    }

    const left = (containerRect.width - width) / 2;
    const top = (containerRect.height - height) / 2;

    return {
      width,
      height,
      left,
      top,
      scaleX: width / compositionWidth, // 1单位 composition 对应多少屏幕像素
      scaleY: height / compositionHeight
    };
  }, [compositionWidth, compositionHeight]);

  // 2. 数据坐标 (0-1) -> 屏幕像素坐标 (相对于 Container)
  const normalizedToScreen = useCallback((x: number, y: number) => {
    const metrics = getBaseMetrics();
    if (!metrics) return { x: 0, y: 0 };

    // 1. 归一化 -> 基础像素
    const basePxX = x * compositionWidth * metrics.scaleX;
    const basePxY = y * compositionHeight * metrics.scaleY;

    // 2. 应用平移 (panOffset 是在 zoom 后的像素偏移吗？看渲染逻辑：translate(panOffset.x / zoom) -> 实际位移是 panOffset.x)
    // 渲染逻辑: scale(zoom) translate(panX/zoom, panY/zoom)
    // 等价于: P_final = zoom * (P_base + pan/zoom) = P_base * zoom + pan
    // 中心点变换公式:
    // P_screen = Center + (P_base - Center) * zoom + pan

    const centerX = metrics.width / 2;
    const centerY = metrics.height / 2;

    const screenX = metrics.left + centerX + (basePxX - centerX) * zoom + panOffset.x;
    const screenY = metrics.top + centerY + (basePxY - centerY) * zoom + panOffset.y;

    return { x: screenX, y: screenY };
  }, [getBaseMetrics, zoom, panOffset, compositionWidth, compositionHeight]);

  // 3. 屏幕像素坐标 -> 数据坐标 (0-1)
  const screenToNormalized = useCallback((screenX: number, screenY: number) => {
    const metrics = getBaseMetrics();
    if (!containerRef.current || !metrics) return { x: 0, y: 0 };

    const containerRect = containerRef.current.getBoundingClientRect();
    const relX = screenX - containerRect.left;
    const relY = screenY - containerRect.top;

    const centerX = metrics.width / 2;
    const centerY = metrics.height / 2;

    // 逆运算:
    // relX = metrics.left + centerX + (basePxX - centerX) * zoom + panOffset.x
    // (relX - metrics.left - centerX - panOffset.x) / zoom + centerX = basePxX

    const basePxX = (relX - metrics.left - centerX - panOffset.x) / zoom + centerX;
    const basePxY = (relY - metrics.top - centerY - panOffset.y) / zoom + centerY;

    return {
      x: basePxX / (compositionWidth * metrics.scaleX),
      y: basePxY / (compositionHeight * metrics.scaleY)
    };
  }, [getBaseMetrics, zoom, panOffset, compositionWidth, compositionHeight]);

  // 4. 尺寸标量转换 (0-1 -> Screen Px)
  // const scalarToScreen = useCallback((w: number) => {
  //   const metrics = getBaseMetrics();
  //   if (!metrics) return 0;
  //   return w * compositionWidth * metrics.scaleX * zoom;
  // }, [getBaseMetrics, zoom, compositionWidth]);


  // 找到选中的 item
  const selectedItemData = selectedItemId
    ? tracks
        .flatMap((t) => t.items.map((i) => ({ trackId: t.id, item: i })))
        .find((x) => x.item.id === selectedItemId)
    : null;

  // 自动初始化 properties（如果不存在）- 智能填充逻辑
  // 注意：后端 patch_dsl 已经会自动计算并设置 properties，这里只是作为兜底
  // 使用 ref 来跟踪已处理的 item，避免重复初始化
  const initializedItemsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // 筛选出没有 properties 的 item，且未被初始化过
    const uninitializedItems = tracks
      .flatMap((t) => t.items.map((i) => ({ trackId: t.id, item: i })))
      .filter((x) => !x.item.properties && !initializedItemsRef.current.has(x.item.id));

    if (uninitializedItems.length === 0) return;

    uninitializedItems.forEach(async ({ trackId, item }) => {
      // 标记为正在初始化，防止重复处理
      initializedItemsRef.current.add(item.id);

      const mediaAR = await getMediaAspectRatio(item);
      const compAR = compositionWidth / compositionHeight;

      console.log(`[InteractiveCanvas] Auto-init itemId=${item.id} trackId=${trackId} mediaAR=${mediaAR?.toFixed(2) || 'null'} compAR=${compAR.toFixed(2)} compWidth=${compositionWidth} compHeight=${compositionHeight}`);

      let width = 1;
      let height = 1;

      // width=1, height=1 means "Contain Fit" (scale to fit within canvas while preserving aspect ratio)
      // This ensures the asset is fully visible and maximized within the canvas by default

      const defaultProperties: ItemProperties = {
        x: 0,
        y: 0,
        width,
        height,
        rotation: 0,
        opacity: 1,
      };

      onUpdateItem(trackId, item.id, {
        properties: defaultProperties,
      });
    });
  }, [tracks, onUpdateItem, getMediaAspectRatio, compositionWidth, compositionHeight]);

  // 检查 item 是否在当前帧可见
  const isItemVisible = selectedItemData
    ? currentFrame >= selectedItemData.item.from &&
      currentFrame < selectedItemData.item.from + selectedItemData.item.durationInFrames
    : false;

  // 调试日志
  useEffect(() => {
    if (selectedItemData) {
      const item = selectedItemData.item;
      console.log(`[InteractiveCanvas] Selected itemId=${item.id} from=${item.from} to=${item.from + item.durationInFrames} currentFrame=${currentFrame} visible=${isItemVisible} hasProps=${!!item.properties} x=${item.properties?.x ?? 'none'} y=${item.properties?.y ?? 'none'} w=${item.properties?.width ?? 'none'} h=${item.properties?.height ?? 'none'} rot=${item.properties?.rotation ?? 'none'}`);
    }
  }, [selectedItemData, currentFrame, isItemVisible]);

  // 准备 Player 的 inputProps
  const inputProps = React.useMemo(() => ({
    tracks,
    allNodes: allNodesMap,
    selectedItemId,
    selectionBoxRef,
    itemsDomMapRef,
  }), [tracks, allNodesMap, selectedItemId]);

  // 同步播放状态和当前帧
  // 关键修复：避免在暂停时强制 seek 导致的帧重置问题
  const lastPlayingStateRef = useRef<boolean>(playing);
  const lastSyncedFrameRef = useRef<number>(currentFrame);

  useEffect(() => {
    if (!playerRef.current) return;

    // 检测播放状态的切换
    const isPlayingToPaused = lastPlayingStateRef.current && !playing;
    const isPausedToPlaying = !lastPlayingStateRef.current && playing;

    if (isPlayingToPaused) {
      // 从播放切换到暂停：暂停 Player，但不 seek（让 Player 停在当前帧）
      playerRef.current.pause();
      lastSyncedFrameRef.current = playerRef.current.getCurrentFrame();
    } else if (isPausedToPlaying) {
      // 从暂停切换到播放：先 seek 到当前帧，再播放
      playerRef.current.seekTo(currentFrame);
      playerRef.current.play();
      lastSyncedFrameRef.current = currentFrame;
    } else if (!playing) {
      // 保持暂停状态：只在帧数确实变化且用户主动改变时才 seek
      // 这里通过比较 currentFrame 和 Player 内部的实际帧来判断
      const playerFrame = playerRef.current.getCurrentFrame();
      if (Math.abs(playerFrame - currentFrame) > 1) {
        playerRef.current.seekTo(currentFrame);
        lastSyncedFrameRef.current = currentFrame;
      }
    }

    lastPlayingStateRef.current = playing;
  }, [playing, currentFrame]);

  // 监听 Player 事件
  useEffect(() => {
    const player = playerRef.current as any;
    if (!player) return;

    const handleFrame = () => {
      const frame = player.getCurrentFrame();
      if (onFrameUpdate) {
        onFrameUpdate(frame);
      }
    };

    const handlePlay = () => {
      if (onPlayingChange) {
        onPlayingChange(true);
      }
    };

    const handlePause = () => {
      if (onPlayingChange) {
        onPlayingChange(false);
      }
    };

    player.addEventListener('frameupdate', handleFrame);
    player.addEventListener('play', handlePlay);
    player.addEventListener('pause', handlePause);

    return () => {
      player.removeEventListener('frameupdate', handleFrame);
      player.removeEventListener('play', handlePlay);
      player.removeEventListener('pause', handlePause);
    };
  }, [onFrameUpdate, onPlayingChange]);

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

  // 监听窗口 resize，强制更新 bounds
  useEffect(() => {
    const handleResize = () => {
      forceUpdate({});
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // 获取当前 metrics 用于 CSS
  const currentMetrics = getBaseMetrics();

  // 屏幕坐标转属性空间 (Composition Pixels, Center Relative)
  const screenToPropertySpace = useCallback((screenX: number, screenY: number) => {
    const norm = screenToNormalized(screenX, screenY);
    return {
      x: (norm.x - 0.5) * compositionWidth,
      y: (norm.y - 0.5) * compositionHeight,
    };
  }, [screenToNormalized, compositionWidth, compositionHeight]);

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

  // 处理鼠标按下
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, mode: DragMode) => {
      if (!selectedItemData) return;

      e.preventDefault();
      e.stopPropagation();

      const startPoint = screenToPropertySpace(e.clientX, e.clientY);

      let startWidth = selectedItemData.item.properties?.width ?? 1;
      let startHeight = selectedItemData.item.properties?.height ?? 1;

      // Handle Contain Fit special case for scaling
      // If we are about to scale, and we are in "Contain Fit" mode (1,1),
      // we need to calculate the effective scale so resizing is continuous.
      if (mode.startsWith('scale') && startWidth === 1 && startHeight === 1) {
        const { naturalWidth, naturalHeight } = getNaturalDimensions(selectedItemData.item);
        const scaleX = compositionWidth / naturalWidth;
        const scaleY = compositionHeight / naturalHeight;
        const scale = Math.min(scaleX, scaleY);

        startWidth = scale;
        startHeight = scale;

        console.log(`[InteractiveCanvas] Drag start (Scale) from Contain Fit. Adjusted startW/H to ${scale.toFixed(4)} (Nat: ${naturalWidth}x${naturalHeight})`);
      }

      setDragState({
        mode,
        startX: startPoint.x, // Composition Pixels (Center Relative)
        startY: startPoint.y,
        startProperties: {
          x: selectedItemData.item.properties?.x ?? 0,
          y: selectedItemData.item.properties?.y ?? 0,
          width: startWidth,
          height: startHeight,
          rotation: selectedItemData.item.properties?.rotation ?? 0,
          opacity: selectedItemData.item.properties?.opacity ?? 1,
        },
        item: selectedItemData.item,
        trackId: selectedItemData.trackId,
      });
    },
    [selectedItemData, screenToPropertySpace]
  );

  // 处理鼠标移动
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragState) return;

      const currentPoint = screenToPropertySpace(e.clientX, e.clientY);
      // Delta in Composition Pixels
      const deltaX = currentPoint.x - dragState.startX;
      const deltaY = currentPoint.y - dragState.startY;

      const newProperties: Partial<ItemProperties> = { ...dragState.startProperties };

      // 旋转相关计算
      const startX = dragState.startProperties.x ?? 0;
      const startY = dragState.startProperties.y ?? 0;

      switch (dragState.mode) {
        case 'move': {
          // 移动：直接加 Delta (因为 x,y 也是 Composition Pixels)
          let nextX = startX + deltaX;
          let nextY = startY + deltaY;

          // 吸附逻辑 (Snapping) - 完整田字格
          // 阈值：屏幕像素 10px -> 属性空间像素
          const metrics = getBaseMetrics();
          const snapThreshold = metrics ? 10 / metrics.scaleX / zoom : 10; // 约 10px 屏幕距离

          const snapState = {
            centerX: false,
            centerY: false,
            left: false,
            right: false,
            top: false,
            bottom: false,
          };

          // 获取元素的宽高（在属性空间中，单位是 composition pixels）
          // width=1, height=1 means 100% of media's natural size
          const { naturalWidth, naturalHeight } = getNaturalDimensions(dragState.item);

          const itemWidth = (dragState.startProperties.width ?? 1) * naturalWidth;
          const itemHeight = (dragState.startProperties.height ?? 1) * naturalHeight;

          // 计算元素的边界位置（相对于中心）
          const leftEdge = nextX - itemWidth / 2;
          const rightEdge = nextX + itemWidth / 2;
          const topEdge = nextY - itemHeight / 2;
          const bottomEdge = nextY + itemHeight / 2;

          // 画布边界（相对于中心，composition pixels）
          const canvasLeft = -compositionWidth / 2;
          const canvasRight = compositionWidth / 2;
          const canvasTop = -compositionHeight / 2;
          const canvasBottom = compositionHeight / 2;

          // 吸附优先级：中心 > 边界
          // X轴吸附
          // 1. 中心线吸附
          if (Math.abs(nextX) < snapThreshold) {
            nextX = 0;
            snapState.centerX = true;
          }
          // 2. 左边界吸附（元素左边缘 -> 画布左边界）
          else if (Math.abs(leftEdge - canvasLeft) < snapThreshold) {
            nextX = canvasLeft + itemWidth / 2;
            snapState.left = true;
          }
          // 3. 右边界吸附（元素右边缘 -> 画布右边界）
          else if (Math.abs(rightEdge - canvasRight) < snapThreshold) {
            nextX = canvasRight - itemWidth / 2;
            snapState.right = true;
          }

          // Y轴吸附
          // 1. 中心线吸附
          if (Math.abs(nextY) < snapThreshold) {
            nextY = 0;
            snapState.centerY = true;
          }
          // 2. 上边界吸附（元素上边缘 -> 画布上边界）
          else if (Math.abs(topEdge - canvasTop) < snapThreshold) {
            nextY = canvasTop + itemHeight / 2;
            snapState.top = true;
          }
          // 3. 下边界吸附（元素下边缘 -> 画布下边界）
          else if (Math.abs(bottomEdge - canvasBottom) < snapThreshold) {
            nextY = canvasBottom - itemHeight / 2;
            snapState.bottom = true;
          }

          setSnapLines(snapState);

          newProperties.x = nextX;
          newProperties.y = nextY;
          break;
        }

        case 'scale-tl':
        case 'scale-tr':
        case 'scale-bl':
        case 'scale-br': {
          // 缩放
          // 需要考虑旋转，这里简化处理，使用距离变化
          // 更好的方式是将鼠标点投影到对象局部坐标系，这里先实现中心缩放或简单的方向缩放

          // 简单的中心缩放实现：
          // 计算鼠标相对于中心的距离变化
          // 这种方式在旋转后也基本可用，但不是最精确的角落拖拽

          const startDist = Math.hypot(dragState.startX - startX, dragState.startY - startY);
          const curDist = Math.hypot(currentPoint.x - startX, currentPoint.y - startY);

          // 避免除零
          if (startDist < 1) break;

          const scale = curDist / startDist;

          // 基于初始宽高缩放
          newProperties.width = Math.max(0.01, dragState.startProperties.width * scale);
          newProperties.height = Math.max(0.01, dragState.startProperties.height * scale);
          break;
        }

        case 'rotate': {
          // 旋转
          // 计算当前鼠标相对于 Item 中心的角度
          const angle = Math.atan2(currentPoint.y - startY, currentPoint.x - startX) * (180 / Math.PI);
          // 此时 angle 是鼠标相对于中心的角度
          // 我们需要 delta angle
          const startAngle = Math.atan2(dragState.startY - startY, dragState.startX - startX) * (180 / Math.PI);
          const deltaAngle = angle - startAngle;

          let nextRotation = (dragState.startProperties.rotation ?? 0) + deltaAngle;

          // 旋转吸附：每 90 度吸附（0°, 90°, 180°, 270°, 360°）
          const snapRotationThreshold = 5; // 5度内吸附
          const rotationMod = nextRotation % 90;

          // 标准化到 -45 ~ 45 范围内判断
          const normalizedMod = rotationMod > 45 ? rotationMod - 90 : rotationMod < -45 ? rotationMod + 90 : rotationMod;

          if (Math.abs(normalizedMod) < snapRotationThreshold) {
            // 吸附到最近的 90 度倍数
            nextRotation = Math.round(nextRotation / 90) * 90;
          }

          newProperties.rotation = nextRotation;
          break;
        }
      }

      // 更新 item properties
      onUpdateItem(dragState.trackId, dragState.item.id, {
        properties: newProperties as ItemProperties,
      });
    },
    [dragState, screenToPropertySpace, onUpdateItem, getBaseMetrics, zoom, allNodesMap, compositionWidth, compositionHeight]
  );

  // 处理鼠标释放
  const handleMouseUp = useCallback(() => {
    setDragState(null);
    setSnapLines(null);
  }, []);

  // 绑定全局鼠标事件
  useEffect(() => {
    if (dragState) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragState, handleMouseMove, handleMouseUp]);

  // 获取 Item 在屏幕上的渲染信息 (替换原来的 getItemBounds/getItemScreenPosition)
  // width=1, height=1 means 100% of media's natural size (not composition size)
  const getItemRenderInfo = useCallback((item: Item) => {
    if (!item.properties) return null;

    // Properties:
    // x, y: Center relative composition pixels
    // width, height: Scale factor relative to media's natural size (1 = 100% natural size)

    const propX = item.properties.x ?? 0;
    const propY = item.properties.y ?? 0;
    const propW = item.properties.width ?? 1;
    const propH = item.properties.height ?? 1;
    const rotation = item.properties.rotation ?? 0;

    // Get natural dimensions from asset node
    const { naturalWidth, naturalHeight } = getNaturalDimensions(item);

    // 转换中心点到 Normalized (0-1 TopLeft)
    const normCx = (propX / compositionWidth) + 0.5;
    const normCy = (propY / compositionHeight) + 0.5;

    // 转换中心点到屏幕坐标
    const centerScreen = normalizedToScreen(normCx, normCy);

    const metrics = getBaseMetrics();
    if (!metrics) return null;

    // Calculate pixel size: propW * naturalWidth (then scale to screen)
    // Implement Contain Fit logic when width=1, height=1
    let itemPixelWidth: number;
    let itemPixelHeight: number;

    if (propW === 1 && propH === 1) {
      const scaleX = compositionWidth / naturalWidth;
      const scaleY = compositionHeight / naturalHeight;
      const scale = Math.min(scaleX, scaleY);
      itemPixelWidth = naturalWidth * scale;
      itemPixelHeight = naturalHeight * scale;
    } else {
      itemPixelWidth = propW * naturalWidth;
      itemPixelHeight = propH * naturalHeight;
    }

    const wPx = itemPixelWidth * metrics.scaleX * zoom;
    const hPx = itemPixelHeight * metrics.scaleY * zoom;

    return {
      centerX: centerScreen.x,
      centerY: centerScreen.y,
      width: wPx,
      height: hPx,
      rotation,
      // 屏幕坐标系的 Left/Top (未旋转的包围盒左上角)
      left: centerScreen.x - wPx / 2,
      top: centerScreen.y - hPx / 2
    };
  }, [normalizedToScreen, getBaseMetrics, compositionWidth, compositionHeight, zoom, allNodesMap]);

  // 当前选中项的屏幕信息
  const bounds = selectedItemData ? getItemRenderInfo(selectedItemData.item) : null;

  // 统一的指针按下处理（同时处理选中和拖动）
  // const handlePointerDown = useCallback(
  //   (e: React.MouseEvent) => {
  //     if (!onSelectItem) return;

  //     const target = e.target as HTMLElement;
  //     if (target.closest('.control-handle') || target.closest('.zoom-controls')) {
  //       return;
  //     }
  //     if (target.tagName === 'BUTTON' || target.closest('button')) {
  //       return;
  //     }

  //     const point = screenToPropertySpace(e.clientX, e.clientY);

  //     console.log('[InteractiveCanvas] Click at:', point);

  //     const hitTarget = findTopItemAtPoint(
  //       point.x,
  //       point.y,
  //       tracks,
  //       currentFrame,
  //       compositionWidth,
  //       compositionHeight
  //     );

  //     if (hitTarget) {
  //       console.log('[InteractiveCanvas] Clicked item:', hitTarget.itemId);
  //       if (selectedItemId !== hitTarget.itemId) {
  //         onSelectItem(hitTarget.itemId);
  //       }

  //       const itemData = tracks
  //         .flatMap((t) => t.items.map((i) => ({ trackId: t.id, item: i })))
  //         .find((x) => x.item.id === hitTarget.itemId);

  //       if (itemData) {
  //         e.preventDefault();
  //         e.stopPropagation();

  //         // startX/Y needs to be in Property Space (Composition Pixels)
  //         setDragState({
  //           mode: 'move',
  //           startX: point.x,
  //           startY: point.y,
  //           startProperties: {
  //             x: itemData.item.properties?.x ?? 0,
  //             y: itemData.item.properties?.y ?? 0,
  //             width: itemData.item.properties?.width ?? 1,
  //             height: itemData.item.properties?.height ?? 1,
  //             rotation: itemData.item.properties?.rotation ?? 0,
  //             opacity: itemData.item.properties?.opacity ?? 1,
  //           },
  //           item: itemData.item,
  //           trackId: itemData.trackId,
  //         });
  //       }
  //     } else {
  //       console.log('[InteractiveCanvas] Clicked empty area, deselecting');
  //       onSelectItem(null);
  //     }
  //   },
  //   [
  //     tracks,
  //     currentFrame,
  //     compositionWidth,
  //     compositionHeight,
  //     selectedItemId,
  //     onSelectItem,
  //     screenToPropertySpace,
  //   ]
  // );

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
          // 点击空白区域取消选中
          // 如果点击的是元素或控制手柄，他们会 stopPropagation，不会到达这里
          console.log(`[InteractiveCanvas] Click event=emptyArea action=deselect`);
          onSelectItem?.(null);
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
            style={{
              position: 'relative',
              // 使用 JS 计算的精确像素值，不再使用百分比，确保与 getBaseMetrics 一致
              width: currentMetrics ? currentMetrics.width : (aspectRatio > 1 ? '100%' : `${aspectRatio * 100}%`),
              height: currentMetrics ? currentMetrics.height : (aspectRatio > 1 ? `${(1 / aspectRatio) * 100}%` : '100%'),
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
            
          </div>
        </div>
        
        {/* 吸附辅助线 (Snap Lines) - 完整田字格 */}
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 900,
          }}
        >
          {(() => {
            // 计算画布边界在屏幕上的位置
            const topLeft = normalizedToScreen(0, 0);
            const topRight = normalizedToScreen(1, 0);
            const bottomLeft = normalizedToScreen(0, 1);
            const bottomRight = normalizedToScreen(1, 1);
            const center = normalizedToScreen(0.5, 0.5);

            const lines: React.ReactNode[] = [];

            // 垂直中心线
            if (snapLines?.centerX) {
              lines.push(
                <line
                  key="center-x"
                  x1={center.x}
                  y1={topLeft.y}
                  x2={center.x}
                  y2={bottomLeft.y}
                  stroke="cyan"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                />
              );
            }

            // 水平中心线
            if (snapLines?.centerY) {
              lines.push(
                <line
                  key="center-y"
                  x1={topLeft.x}
                  y1={center.y}
                  x2={topRight.x}
                  y2={center.y}
                  stroke="cyan"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                />
              );
            }

            // 左边界线
            if (snapLines?.left) {
              lines.push(
                <line
                  key="left"
                  x1={topLeft.x}
                  y1={topLeft.y}
                  x2={bottomLeft.x}
                  y2={bottomLeft.y}
                  stroke="cyan"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                />
              );
            }

            // 右边界线
            if (snapLines?.right) {
              lines.push(
                <line
                  key="right"
                  x1={topRight.x}
                  y1={topRight.y}
                  x2={bottomRight.x}
                  y2={bottomRight.y}
                  stroke="cyan"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                />
              );
            }

            // 上边界线
            if (snapLines?.top) {
              lines.push(
                <line
                  key="top"
                  x1={topLeft.x}
                  y1={topLeft.y}
                  x2={topRight.x}
                  y2={topRight.y}
                  stroke="cyan"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                />
              );
            }

            // 下边界线
            if (snapLines?.bottom) {
              lines.push(
                <line
                  key="bottom"
                  x1={bottomLeft.x}
                  y1={bottomLeft.y}
                  x2={bottomRight.x}
                  y2={bottomRight.y}
                  stroke="cyan"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                />
              );
            }

            return lines;
          })()}
        </svg>

        {/* 交互层1 - 所有可见元素的透明点击区域 */}
        <svg 
          className="canvas-items"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'all',
            zIndex: 1000,
          }}
        >
          {/* 全屏透明背景，用于捕获空白点击 */}
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="transparent"
            style={{ pointerEvents: 'all' }}
            onMouseDown={(_e) => {
              console.log(`[InteractiveCanvas] Click event=emptyBackground action=deselect`);
              onSelectItem?.(null);
            }}
          />
          
          {/* 为每个可见元素渲染透明点击区域 */}
          {tracks.flatMap((track) =>
            track.items
              .filter((item) =>
                item.properties &&
                currentFrame >= item.from &&
                currentFrame < item.from + item.durationInFrames
              )
              .map((item) => {
                if (!item.properties) return null;

                // 使用统一的计算逻辑
                const itemBounds = getItemRenderInfo(item);
                if (!itemBounds) return null;

                return (
                  <rect
                    key={item.id}
                    className="item-clickable"
                    x={itemBounds.left}
                    y={itemBounds.top}
                    width={itemBounds.width}
                    height={itemBounds.height}
                    fill="transparent"
                    style={{
                      pointerEvents: 'all',
                      cursor: 'pointer',
                      transform: `rotate(${itemBounds.rotation}deg)`,
                      transformOrigin: `${itemBounds.centerX}px ${itemBounds.centerY}px`,
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();

                      // 选中该元素（如果未选中）
                      if (onSelectItem && selectedItemId !== item.id) {
                        onSelectItem(item.id);
                      }

                      // 准备拖动
                      const point = screenToPropertySpace(e.clientX, e.clientY);
                      setDragState({
                        mode: 'move',
                        startX: point.x,
                        startY: point.y,
                        startProperties: {
                          x: item.properties?.x ?? 0,
                          y: item.properties?.y ?? 0,
                          width: item.properties?.width ?? 1,
                          height: item.properties?.height ?? 1,
                          rotation: item.properties?.rotation ?? 0,
                          opacity: item.properties?.opacity ?? 1,
                        },
                        item: item,
                        trackId: track.id,
                      });
                    }}
                  />
                );
              })
          )}
        </svg>
        
        {/* 交互层2 - 选中元素的蓝框和控制手柄 */}
        {bounds && selectedItemData && (
          <svg 
            className="canvas-controls"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 1001,
            }}
          >
          {/* 蓝色边框 */}
          <rect
            className="control-handle"
            x={bounds.left}
            y={bounds.top}
            width={bounds.width}
            height={bounds.height}
            fill="none"
            stroke="#0066ff"
            strokeWidth="2"
            style={{
              pointerEvents: 'none',
              transform: `rotate(${bounds.rotation}deg)`,
              transformOrigin: `${bounds.centerX}px ${bounds.centerY}px`,
            }}
          />

          {/* 透明的拖拽区域（选中时覆盖在透明层上方，优先响应） */}
          <rect
            className="control-handle"
            x={bounds.left}
            y={bounds.top}
            width={bounds.width}
            height={bounds.height}
            fill="transparent"
            style={{
              transform: `rotate(${bounds.rotation}deg)`,
              transformOrigin: `${bounds.centerX}px ${bounds.centerY}px`,
              cursor: 'move',
              pointerEvents: 'all',
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleMouseDown(e as any, 'move');
            }}
          />

            {/* 四个角的缩放手柄 */}
            {[
              { pos: 'tl', x: bounds.left, y: bounds.top },
              { pos: 'tr', x: bounds.left + bounds.width, y: bounds.top },
              { pos: 'bl', x: bounds.left, y: bounds.top + bounds.height },
              { pos: 'br', x: bounds.left + bounds.width, y: bounds.top + bounds.height },
            ].map(({ pos, x, y }) => (
              <circle
                key={pos}
                className="control-handle"
                cx={x}
                cy={y}
                r="6"
                fill="#ffffff"
                stroke="#0066ff"
                strokeWidth="2"
                style={{
                  pointerEvents: 'all',
                  cursor: `${pos.includes('t') ? 'n' : 's'}${pos.includes('l') ? 'w' : 'e'}-resize`,
                  transform: `rotate(${bounds.rotation}deg)`,
                  transformOrigin: `${bounds.centerX}px ${bounds.centerY}px`,
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  handleMouseDown(e as any, `scale-${pos}` as DragMode);
                }}
              />
            ))}

            {/* 旋转手柄 */}
            <circle
              className="control-handle"
              cx={bounds.centerX}
              cy={bounds.top - 30}
              r="6"
              fill="#ffffff"
              stroke="#0066ff"
              strokeWidth="2"
              style={{
                pointerEvents: 'all',
                cursor: 'crosshair',
                transform: `rotate(${bounds.rotation}deg)`,
                transformOrigin: `${bounds.centerX}px ${bounds.centerY}px`,
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleMouseDown(e as any, 'rotate');
              }}
            />
            <line
              className="control-handle"
              x1={bounds.centerX}
              y1={bounds.top}
              x2={bounds.centerX}
              y2={bounds.top - 30}
              stroke="#0066ff"
              strokeWidth="2"
              style={{
                transform: `rotate(${bounds.rotation}deg)`,
                transformOrigin: `${bounds.centerX}px ${bounds.centerY}px`,
                pointerEvents: 'none',
              }}
            />
          </svg>
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
