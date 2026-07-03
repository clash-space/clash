import React, { useRef, useState } from 'react';
import {
  getEditorAssetKey,
  normalizeEditorAsset,
  useEditorDispatch,
  useEditorPlaybackRefs,
  useEditorStaticState,
} from '@master-clash/remotion-core';
import type { Asset, EditorAssetInput, TextItem } from '@master-clash/remotion-core';
import { RemotionButton, RemotionFileInput } from './ui/controls';

// Export for TimelineTracksContainer to use
export let currentDraggedAsset: any = null;
export let currentAssetDragOffset: number = 0; // 鼠标相对于 asset 卡片左边缘的偏移量（像素）

type AssetPanelProps = {
  onBack?: () => void;
  backLabel?: string;
  onAssetUpload?: (file: File, type: 'video' | 'image' | 'audio') => void;
  availableAssets?: EditorAssetInput[];
  onAssetPicked?: (asset: EditorAssetInput) => void;
  onExport?: () => Promise<void>;
};

export const AssetPanel: React.FC<AssetPanelProps> = ({
  onBack,
  backLabel = '返回',
  onAssetUpload,
  availableAssets = [],
  onAssetPicked,
  onExport,
}) => {
  const dispatch = useEditorDispatch();
  const { tracks, assets } = useEditorStaticState();
  const { currentFrameRef } = useEditorPlaybackRefs();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      const type = file.type.startsWith('video')
        ? 'video'
        : file.type.startsWith('audio')
          ? 'audio'
          : file.type.startsWith('image')
            ? 'image'
            : null;

      if (!type) continue;
      if (!onAssetUpload) {
        console.warn('[AssetPanel] onAssetUpload not provided; skipping upload.');
        continue;
      }

      onAssetUpload(file, type);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAssetDragStart = (e: React.DragEvent, asset: Asset) => {
    currentDraggedAsset = asset; // Store globally

    // 计算鼠标相对于 asset 卡片左边缘的偏移量
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    currentAssetDragOffset = e.clientX - rect.left;

    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', asset.id); // Use text/plain for better compatibility
    e.dataTransfer.setData('assetId', asset.id);
    e.dataTransfer.setData('asset', JSON.stringify(asset));
  };

  const handleAddTextToTrack = () => {
    const newItemDuration = 90; // 3 seconds at 30fps
    const newItemFrom = currentFrameRef.current;
    const newItemTo = newItemFrom + newItemDuration;

    // 检测第一轨道是否有重叠
    let trackId: string;
    let needsNewTrack = false;

    if (tracks.length === 0) {
      // 没有轨道，创建新轨道
      trackId = `track-${Date.now()}`;
      needsNewTrack = true;
    } else {
      const firstTrack = tracks[0];
      // 检查第一轨道上是否有元素与新元素时间范围重叠
      const hasOverlap = firstTrack.items.some(item => {
        const itemFrom = item.from;
        const itemTo = item.from + item.durationInFrames;
        // 两个时间范围重叠的条件：newItemFrom < itemTo && newItemTo > itemFrom
        return newItemFrom < itemTo && newItemTo > itemFrom;
      });

      if (hasOverlap) {
        // 有重叠，创建新轨道并插入到第一位置
        trackId = `track-${Date.now()}`;
        needsNewTrack = true;
      } else {
        // 无重叠，使用第一轨道
        trackId = firstTrack.id;
      }
    }

    // 如果需要新轨道，先创建
    if (needsNewTrack) {
      dispatch({
        type: 'INSERT_TRACK',
        payload: {
          track: {
            id: trackId,
            name: 'Text',
            items: [],
          },
          index: 0, // 插入到第一位置
        }
      });
    }

    // 创建 text item
    const textItem: TextItem = {
      id: `text-${Date.now()}`,
      type: 'text',
      text: 'Double click to edit',
      color: '#ffffff',
      from: newItemFrom,
      durationInFrames: newItemDuration,
      fontSize: 60,
      properties: {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        rotation: 0,
        opacity: 1,
      },
    };

    // 使用 setTimeout 确保轨道先创建
    setTimeout(() => {
      dispatch({
        type: 'ADD_ITEM',
        payload: { trackId, item: textItem },
      });
    }, 0);
  };

  // Handle dragging Quick Add items
  const handleQuickAddDragStart = (e: React.DragEvent, type: 'text' | 'solid') => {
    // Create a pseudo-asset for quick add items
    const pseudoAsset = {
      id: `quick-${type}-${Date.now()}`,
      name: type === 'text' ? 'Text' : 'Color',
      type: type as 'text' | 'solid',
      src: '',
      createdAt: Date.now(),
    };

    currentDraggedAsset = { ...pseudoAsset, quickAdd: true, quickAddType: type }; // Store globally

    // 计算鼠标相对于按钮左边缘的偏移量
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    currentAssetDragOffset = e.clientX - rect.left;

    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', pseudoAsset.id); // Use text/plain for compatibility
    e.dataTransfer.setData('assetId', pseudoAsset.id);
    e.dataTransfer.setData('quickAdd', 'true');
    e.dataTransfer.setData('quickAddType', type);
  };

  const handlePickAsset = (asset: EditorAssetInput) => {
    const assetKey = getEditorAssetKey(asset);
    const exists = assets.some((a) =>
      getEditorAssetKey(a) === assetKey ||
      (!!asset.src && a.src === asset.src)
    );

    if (!exists) {
      dispatch({
        type: 'ADD_ASSET',
        payload: normalizeEditorAsset({
          ...asset,
          name: asset.name || 'Canvas Asset',
          readOnly: true,
        }),
      });
    }
    onAssetPicked?.(asset);
    setIsPickerOpen(false);
  };

  return (

    <div className="relative flex h-full flex-col bg-[#fffdfb]">
      <div className="border-b border-slate-200/80 bg-white/95 px-4 py-3">
        <div className="flex items-center justify-between">
          {onBack ? (
            <RemotionButton
              type="button"
              onClick={onBack}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
              aria-label={backLabel}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M10.5 6.5L5 12l5.5 5.5M6 12h13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </RemotionButton>
          ) : (
            <h2 className="m-0 text-sm font-bold text-slate-900">Assets</h2>
          )}
          {onExport && (
            <RemotionButton
              type="button"
              onClick={() => onExport()}
              className="flex h-9 items-center justify-center rounded-md border border-[#ff6b50] bg-[#ff6b50] px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:border-[#e85f47] hover:bg-[#e85f47]"
            >
              Export
            </RemotionButton>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* Quick Add Section */}
        <div className="mb-6">
          <h3 className="m-0 mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Quick Add</h3>
          <div className="flex gap-2">
            <RemotionButton
              onClick={handleAddTextToTrack}
              className="flex-1 cursor-grab rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:border-[#ffb6a8] hover:bg-[#fff3f0] hover:text-[#d94f38] active:cursor-grabbing"
              draggable
              onDragStart={(e) => handleQuickAddDragStart(e, 'text')}
              title="Click to add or drag to timeline"
            >
              + Text
            </RemotionButton>
            <RemotionButton
              onClick={() => {
                const newItemDuration = 30; // 1 second at 30fps (smaller initial size)
                const newItemFrom = currentFrameRef.current;
                const newItemTo = newItemFrom + newItemDuration;

                // 检测第一轨道是否有重叠
                let trackId: string;
                let needsNewTrack = false;

                if (tracks.length === 0) {
                  // 没有轨道，创建新轨道
                  trackId = `track-${Date.now()}`;
                  needsNewTrack = true;
                } else {
                  const firstTrack = tracks[0];
                  // 检查第一轨道上是否有元素与新元素时间范围重叠
                  const hasOverlap = firstTrack.items.some(item => {
                    const itemFrom = item.from;
                    const itemTo = item.from + item.durationInFrames;
                    // 两个时间范围重叠的条件：newItemFrom < itemTo && newItemTo > itemFrom
                    return newItemFrom < itemTo && newItemTo > itemFrom;
                  });

                  if (hasOverlap) {
                    // 有重叠，创建新轨道并插入到第一位置
                    trackId = `track-${Date.now()}`;
                    needsNewTrack = true;
                  } else {
                    // 无重叠，使用第一轨道
                    trackId = firstTrack.id;
                  }
                }

                // 如果需要新轨道，先创建
                if (needsNewTrack) {
                  dispatch({
                    type: 'INSERT_TRACK',
                    payload: {
                      track: {
                        id: trackId,
                        name: 'Solid',
                        items: [],
                      },
                      index: 0, // 插入到第一位置
                    }
                  });
                }

                // 创建 solid item
                const solidItem = {
                  id: `solid-${Date.now()}`,
                  type: 'solid' as const,
                  color: '#' + Math.floor(Math.random() * 16777215).toString(16),
                  from: newItemFrom,
                  durationInFrames: newItemDuration,
                  properties: {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                    rotation: 0,
                    opacity: 1,
                  },
                };

                // 使用 setTimeout 确保轨道先创建
                setTimeout(() => {
                  dispatch({
                    type: 'ADD_ITEM',
                    payload: {
                      trackId,
                      item: solidItem,
                    },
                  });
                }, 0);
              }}
              className="flex-1 cursor-grab rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:border-[#ffb6a8] hover:bg-[#fff3f0] hover:text-[#d94f38] active:cursor-grabbing"
              draggable
              onDragStart={(e) => handleQuickAddDragStart(e, 'solid')}
              title="Click to add or drag to timeline"
            >
              + Color
            </RemotionButton>
          </div>
        </div>

        {/* Upload Section */}
        <div className="mb-6">
          <h3 className="m-0 mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Media Files</h3>
          <RemotionFileInput
            ref={fileInputRef}
            accept="image/*,video/*,audio/*"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
          <RemotionButton
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-md bg-[#ff6b50] px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#e85f47] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!onAssetUpload}
          >
            Upload Files
          </RemotionButton>
          <RemotionButton
            onClick={() => setIsPickerOpen(true)}
            className="mt-2 w-full rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={availableAssets.length === 0}
          >
            Add From Canvas
          </RemotionButton>
        </div>

        {/* Assets List */}
        <div className="flex flex-col gap-2">
          {assets.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-white/60 py-8 text-center text-sm text-slate-400">
              No assets uploaded yet
            </div>
          ) : (
            assets.map((asset) => (
              <div
                key={asset.id}
                draggable
                onDragStart={(e) => handleAssetDragStart(e, asset)}
                className="group flex cursor-move items-center gap-3 overflow-hidden rounded-md border border-slate-200 bg-white p-2 transition-all hover:border-[#ffb6a8] hover:shadow-sm"
              >
                {asset.type === 'image' && (
                  <img
                    src={asset.src}
                    alt={asset.name}
                    className="w-12 h-12 object-cover object-left-top rounded bg-slate-100 border border-slate-100"
                  />
                )}
                {asset.type === 'video' && (
                  asset.thumbnail ? (
                    <img
                      src={asset.thumbnail}
                      alt={asset.name}
                      className="w-12 h-12 object-cover object-left-top rounded bg-slate-100 border border-slate-100"
                    />
                  ) : (
                    <video
                      src={asset.src}
                      muted
                      playsInline
                      preload="metadata"
                      className="w-12 h-12 object-cover object-left-top rounded bg-slate-100 border border-slate-100"
                    />
                  )
                )}
                {asset.type === 'audio' && (
                  <div className="w-12 h-12 flex items-center justify-center bg-slate-100 rounded text-xl border border-slate-200">🎵</div>
                )}
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="text-sm font-medium text-slate-900 truncate" title={asset.name}>
                    {asset.name}
                  </div>
                  <div className="text-xs text-slate-500 capitalize mt-0.5">{asset.type}</div>
                </div>
                {!asset.readOnly && (
                  <RemotionButton
                    onClick={() => dispatch({ type: 'REMOVE_ASSET', payload: asset.id })}
                    className="flex h-6 w-6 items-center justify-center rounded text-slate-400 opacity-0 transition-colors hover:bg-[#fff3f0] hover:text-[#d94f38] group-hover:opacity-100"
                  >
                    ×
                  </RemotionButton>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {isPickerOpen && (
        <div className="absolute inset-0 z-20 bg-white/95">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
            <div className="text-sm font-bold text-slate-900">Add From Canvas</div>
            <RemotionButton
              onClick={() => setIsPickerOpen(false)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              Close
            </RemotionButton>
          </div>
          <div className="p-4 space-y-2 overflow-auto h-[calc(100%-52px)]">
            {availableAssets.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">
                No available assets
              </div>
            ) : (
              availableAssets.map((asset) => (
                <RemotionButton
                  key={asset.id}
                  onClick={() => handlePickAsset(asset)}
                  className="flex w-full items-center gap-3 rounded-md border border-slate-200 bg-white p-2 text-left transition-colors hover:border-[#ffb6a8] hover:bg-[#fff3f0]"
                >
                  {asset.type === 'image' ? (
                    <img
                      src={asset.src}
                      alt={asset.name || 'Image'}
                      className="w-12 h-12 object-cover rounded-md bg-slate-100 border border-slate-100"
                    />
                  ) : asset.type === 'video' ? (
                    asset.thumbnail ? (
                      <img
                        src={asset.thumbnail}
                        alt={asset.name || 'Video'}
                        className="w-12 h-12 object-cover rounded-md bg-slate-100 border border-slate-100"
                      />
                    ) : (
                      <video
                        src={asset.src}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-12 h-12 object-cover rounded-md bg-slate-100 border border-slate-100"
                      />
                    )
                  ) : (
                    <div className="w-12 h-12 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-500">
                      {asset.type.toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {asset.name || 'Untitled'}
                    </div>
                    <div className="text-xs text-slate-500 capitalize">{asset.type}</div>
                  </div>
                </RemotionButton>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
