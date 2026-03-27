import React from 'react';
import { useEditor } from '@master-clash/remotion-core';
import type { TextItem, SolidItem } from '@master-clash/remotion-core';


export const PropertiesPanel: React.FC = () => {
  const { state, dispatch } = useEditor();
  const [showExportModal, setShowExportModal] = React.useState(false);

  // Find selected item
  const selectedItem = state.selectedItemId
    ? state.tracks
      .flatMap((t) => t.items.map((i) => ({ trackId: t.id, item: i })))
      .find((x) => x.item.id === state.selectedItemId)
    : null;

  // Calculate split quality and recommendations (must be before early return)
  const selectedItemData = selectedItem?.item;
  const itemEnd = selectedItemData ? selectedItemData.from + selectedItemData.durationInFrames : 0;
  const canSplit = selectedItemData ? (state.currentFrame > selectedItemData.from && state.currentFrame < itemEnd) : false;





  // Format time helper
  const formatTime = (frames: number): string => {
    const totalSeconds = frames / state.fps;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const centiseconds = Math.floor(((totalSeconds % 1) * 100));
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  };

  // Canvas properties when no item is selected
  // Canvas properties when no item is selected
  if (!selectedItem) {
    return (
      <div className="flex flex-col h-full bg-slate-50 rounded-lg overflow-hidden border-l border-slate-200">
        <div className="flex justify-between items-center px-4 py-3 bg-white border-b border-slate-200">
          <h2 className="m-0 text-sm font-bold text-slate-900">Properties</h2>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {/* Canvas Section */}
          <div className="mb-6">
            <h3 className="mb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Canvas</h3>

            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">Aspect Ratio</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: '16:9', w: 1920, h: 1080 },
                  { label: '9:16', w: 1080, h: 1920 },
                  { label: '4:3', w: 1440, h: 1080 },
                  { label: '1:1', w: 1080, h: 1080 },
                  { label: '21:9', w: 2560, h: 1080 },
                  { label: '4:5', w: 1080, h: 1350 },
                ].map(preset => (
                  <button
                    key={preset.label}
                    onClick={() => dispatch({
                      type: 'SET_COMPOSITION_SIZE',
                      payload: { width: preset.w, height: preset.h },
                    })}
                    className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${state.compositionWidth === preset.w && state.compositionHeight === preset.h
                        ? 'bg-red-500 text-white shadow-sm'
                        : 'bg-white text-slate-700 border border-slate-200 hover:border-red-300 hover:text-red-500'
                      }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Duration Section */}
          <div className="mb-6">
            <h3 className="mb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Duration</h3>
            <div className="text-2xl font-semibold text-slate-900 mb-4 font-mono tracking-tight">
              {formatTime(state.durationInFrames)}
            </div>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">Duration (frames)</label>
              <input
                type="number"
                value={state.durationInFrames}
                onChange={(e) => dispatch({
                  type: 'SET_DURATION',
                  payload: parseInt(e.target.value) || 600,
                })}
                className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
              />
            </div>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">Frame Rate (FPS)</label>
              <div className="px-2 py-1.5 bg-slate-100 text-slate-600 rounded text-sm border border-slate-200">{state.fps} fps</div>
            </div>
          </div>

          {/* Export Section */}
          <div className="mb-6">
            <h3 className="mb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Export</h3>
            <div className="mb-3">
              <div className="px-3 py-2 bg-slate-100 text-slate-700 rounded text-sm text-center border border-slate-200 font-medium">MP4 (H.264)</div>
            </div>
            <button
              onClick={() => setShowExportModal(true)}
              className="w-full py-2.5 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm hover:shadow active:scale-95"
            >
              Render video
            </button>
          </div>
        </div>

        {/* Export Modal */}
        {showExportModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowExportModal(false)}>
            <div className="bg-white rounded-xl p-8 max-w-xl w-[90%] shadow-2xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
              <h2 className="m-0 mb-4 text-xl font-bold text-slate-900">Export Video</h2>
              <p className="m-0 mb-6 text-sm text-slate-500 leading-relaxed">
                To render your video, use one of these methods:
              </p>

              <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <h3 className="m-0 mb-3 text-sm font-semibold text-slate-900">Method 1: Command Line</h3>
                <div className="mb-2 p-3 bg-slate-900 rounded border border-slate-800 overflow-x-auto">
                  <code className="text-xs text-green-400 font-mono whitespace-pre-wrap break-all">
                    npx remotion render src/remotion/index.tsx VideoComposition out/video.mp4
                  </code>
                </div>
                <p className="m-0 text-xs text-slate-500">
                  Run this in your terminal to render the video
                </p>
              </div>

              <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
                <h3 className="m-0 mb-3 text-sm font-semibold text-blue-900">Method 2: Remotion Studio (Recommended)</h3>
                <div className="mb-2 p-3 bg-white rounded border border-blue-200 overflow-x-auto">
                  <code className="text-xs text-red-500 font-mono">npm run dev</code>
                </div>
                <p className="m-0 text-xs text-red-500/80">
                  Opens Remotion Studio at localhost:3002 with GUI render controls
                </p>
              </div>

              <button
                onClick={() => setShowExportModal(false)}
                className="w-full py-2.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-200 hover:text-slate-900 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const { trackId, item } = selectedItem;

  const updateItem = (updates: Partial<typeof item>) => {
    dispatch({
      type: 'UPDATE_ITEM',
      payload: { trackId, itemId: item.id, updates },
    });
  };

  const deleteItem = () => {
    dispatch({
      type: 'REMOVE_ITEM',
      payload: { trackId, itemId: item.id },
    });
  };

  const splitItem = () => {
    if (!canSplit) return;

    dispatch({
      type: 'SPLIT_ITEM',
      payload: {
        trackId,
        itemId: item.id,
        splitFrame: state.currentFrame,
      },
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 rounded-lg overflow-hidden border-l border-slate-200">
      <div className="flex justify-between items-center px-4 py-3 bg-white border-b border-slate-200">
        <h2 className="m-0 text-sm font-bold text-slate-900">Properties</h2>
        <div className="flex gap-2">
          <button
            onClick={splitItem}
            disabled={!canSplit}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors border ${canSplit
                ? 'bg-white text-red-500 border-blue-200 hover:bg-blue-50 hover:border-blue-300 cursor-pointer'
                : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
              }`}
            title={
              canSplit
                ? `Split at frame ${state.currentFrame}`
                : 'Move playhead onto the selected item to split'
            }
          >
            Split
          </button>
          <button
            onClick={deleteItem}
            className="px-3 py-1.5 bg-white text-red-600 border border-red-200 rounded text-xs font-medium hover:bg-red-50 hover:border-red-300 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">

        {/* Transform Properties */}
        <div className="mb-6">
          <h3 className="mb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Transform</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">X Position (px)</label>
              <input
                type="number"
                step="1"
                value={item.properties?.x ?? 0}
                onChange={(e) => updateItem({
                  properties: {
                    ...item.properties,
                    x: parseFloat(e.target.value) || 0,
                    y: item.properties?.y ?? 0,
                    width: item.properties?.width ?? 1,
                    height: item.properties?.height ?? 1,
                  }
                })}
                className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
              />
            </div>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">Y Position (px)</label>
              <input
                type="number"
                step="1"
                value={item.properties?.y ?? 0}
                onChange={(e) => updateItem({
                  properties: {
                    ...item.properties,
                    x: item.properties?.x ?? 0,
                    y: parseFloat(e.target.value) || 0,
                    width: item.properties?.width ?? 1,
                    height: item.properties?.height ?? 1,
                  }
                })}
                className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
              />
            </div>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">Width Scale (1=100%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={item.properties?.width ?? 1}
                onChange={(e) => updateItem({
                  properties: {
                    ...item.properties,
                    x: item.properties?.x ?? 0,
                    y: item.properties?.y ?? 0,
                    width: parseFloat(e.target.value) || 0,
                    height: item.properties?.height ?? 1,
                  }
                })}
                className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
              />
            </div>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">Height Scale (1=100%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={item.properties?.height ?? 1}
                onChange={(e) => updateItem({
                  properties: {
                    ...item.properties,
                    x: item.properties?.x ?? 0,
                    y: item.properties?.y ?? 0,
                    width: item.properties?.width ?? 1,
                    height: parseFloat(e.target.value) || 0,
                  }
                })}
                className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-slate-500 mb-1.5">Rotation (degrees)</label>
            <input
              type="number"
              step="1"
              value={item.properties?.rotation ?? 0}
              onChange={(e) => updateItem({
                properties: {
                  ...item.properties,
                  x: item.properties?.x ?? 0,
                  y: item.properties?.y ?? 0,
                  width: item.properties?.width ?? 1,
                  height: item.properties?.height ?? 1,
                  rotation: parseFloat(e.target.value) || 0,
                }
              })}
              className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
            />
          </div>
          <div className="mb-3">
            <label className="block text-xs text-slate-500 mb-1.5">Opacity (0-1)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={item.properties?.opacity ?? 1}
              onChange={(e) => updateItem({
                properties: {
                  ...item.properties,
                  x: item.properties?.x ?? 0,
                  y: item.properties?.y ?? 0,
                  width: item.properties?.width ?? 1,
                  height: item.properties?.height ?? 1,
                  opacity: parseFloat(e.target.value) ?? 1,
                }
              })}
              className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
            />
          </div>
          <div className="mb-3">
            <label className="block text-xs text-slate-500 mb-1.5">Layer Order</label>
            <div className="w-full px-2 py-1.5 bg-slate-100 text-slate-400 border border-slate-200 rounded text-sm cursor-not-allowed">
              Controlled by track position
            </div>
          </div>
        </div>

        {/* Common Properties */}
        <div className="mb-6">
          <h3 className="mb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Timing</h3>
          <div className="mb-3">
            <label className="block text-xs text-slate-500 mb-1.5">Start Frame</label>
            <input
              type="number"
              value={item.from}
              onChange={(e) => updateItem({ from: parseInt(e.target.value) || 0 })}
              className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
            />
          </div>
          <div className="mb-3">
            <label className="block text-xs text-slate-500 mb-1.5">Duration (frames)</label>
            <input
              type="number"
              value={item.durationInFrames}
              onChange={(e) =>
                updateItem({ durationInFrames: parseInt(e.target.value) || 1 })
              }
              className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
            />
          </div>
        </div>

        {/* Text Item Properties */}
        {item.type === 'text' && (
          <div className="mb-6">
            <h3 className="mb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Text</h3>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">Content</label>
              <textarea
                value={(item as TextItem).text}
                onChange={(e) => updateItem({ text: e.target.value })}
                className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all min-h-[80px] resize-y"
              />
            </div>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">Color</label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={(item as TextItem).color}
                  onChange={(e) => updateItem({ color: e.target.value })}
                  className="w-12 h-9 p-0.5 bg-white border border-slate-200 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={(item as TextItem).color}
                  onChange={(e) => updateItem({ color: e.target.value })}
                  className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">Font Size</label>
              <input
                type="number"
                value={(item as TextItem).fontSize || 60}
                onChange={(e) =>
                  updateItem({ fontSize: parseInt(e.target.value) || 60 })
                }
                className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
              />
            </div>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">Font Family</label>
              <select
                value={(item as TextItem).fontFamily || 'Arial'}
                onChange={(e) => updateItem({ fontFamily: e.target.value })}
                className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
              >
                <option value="Arial">Arial</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Georgia">Georgia</option>
                <option value="Courier New">Courier New</option>
                <option value="Verdana">Verdana</option>
              </select>
            </div>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">Font Weight</label>
              <select
                value={(item as TextItem).fontWeight || 'bold'}
                onChange={(e) => updateItem({ fontWeight: e.target.value })}
                className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
              >
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
                <option value="lighter">Lighter</option>
                <option value="bolder">Bolder</option>
              </select>
            </div>
          </div>
        )}

        {/* Solid Item Properties */}
        {item.type === 'solid' && (
          <div className="mb-6">
            <h3 className="mb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Color</h3>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">Background Color</label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={(item as SolidItem).color}
                  onChange={(e) => updateItem({ color: e.target.value })}
                  className="w-12 h-9 p-0.5 bg-white border border-slate-200 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={(item as SolidItem).color}
                  onChange={(e) => updateItem({ color: e.target.value })}
                  className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-red-400 outline-none transition-all"
                />
              </div>
            </div>
          </div>
        )}

        {/* Video/Image/Audio Properties */}
        {(item.type === 'video' || item.type === 'image' || item.type === 'audio') && (
          <div className="mb-6">
            <h3 className="mb-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Source</h3>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">File Path</label>
              <input
                type="text"
                value={item.src}
                readOnly
                className="w-full px-2 py-1.5 bg-slate-100 border border-slate-200 rounded text-sm text-slate-500 cursor-not-allowed"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
