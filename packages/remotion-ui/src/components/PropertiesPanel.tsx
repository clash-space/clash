import React from 'react';
import {
  useEditorDispatch,
  useEditorPlayback,
  useEditorStaticState,
} from '@master-clash/remotion-core';
import type { TextItem, SolidItem, TransitionItem, TransitionType } from '@master-clash/remotion-core';
import {
  RemotionButton,
  RemotionInput,
  RemotionSelect,
  RemotionTextarea,
} from './ui/controls';

const TRANSITION_TYPES: TransitionType[] = [
  'crossfade',
  'push-left',
  'push-right',
  'slide-up',
  'slide-down',
  'wipe-left',
  'wipe-right',
  'circle-wipe',
  'zoom-in',
];

const panelClassName = 'flex h-full flex-col overflow-hidden bg-[#fffdfb]';
const panelHeaderClassName = 'flex items-center justify-between border-b border-slate-200/80 bg-white/95 px-4 py-3';
const sectionTitleClassName = 'mb-3 text-xs font-bold uppercase tracking-wide text-slate-500';
const labelClassName = 'mb-1.5 block text-xs font-medium text-slate-500';
const fieldClassName = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none transition-all focus:border-[#ff9a86] focus:ring-1 focus:ring-[#ffb6a8]';
const readOnlyFieldClassName = 'w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm text-slate-500';

/**
 * Split button — isolated subscriber for `currentFrame` so the rest of
 * the 690-line PropertiesPanel doesn't re-render on every scrub or
 * playback frame. Inline button placement still works because React
 * happily reconciles a single child element when only it changes.
 *
 * `canSplit` is a function of (currentFrame, item) — keeping the
 * subscription local means only this small subtree reconciles per
 * frame, not all the Properties form fields below.
 */
const SplitButton: React.FC<{
  itemFrom: number;
  itemEnd: number;
  trackId: string;
  itemId: string;
}> = React.memo(({ itemFrom, itemEnd, trackId, itemId }) => {
  const dispatch = useEditorDispatch();
  const { currentFrame } = useEditorPlayback();
  const canSplit = currentFrame > itemFrom && currentFrame < itemEnd;
  const splitItem = () => {
    if (!canSplit) return;
    dispatch({
      type: 'SPLIT_ITEM',
      payload: { trackId, itemId, splitFrame: currentFrame },
    });
  };
  return (
    <RemotionButton
      onClick={splitItem}
      disabled={!canSplit}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
        canSplit
          ? 'cursor-pointer border-[#ffd3ca] bg-white text-[#d94f38] hover:border-[#ffb6a8] hover:bg-[#fff3f0]'
          : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
      }`}
      title={canSplit ? `Split at frame ${currentFrame}` : 'Move playhead onto the selected item to split'}
    >
      Split
    </RemotionButton>
  );
});

type PropertiesPanelProps = {
  showHeader?: boolean;
};

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ showHeader = true }) => {
  const dispatch = useEditorDispatch();
  const {
    tracks,
    selectedItemId,
    compositionWidth,
    compositionHeight,
    durationInFrames,
    fps,
  } = useEditorStaticState();

  // Find selected item
  const selectedItem = selectedItemId
    ? tracks
      .flatMap((t) => t.items.map((i) => ({ trackId: t.id, item: i })))
      .find((x) => x.item.id === selectedItemId)
    : null;

  const selectedItemData = selectedItem?.item;
  const itemEnd = selectedItemData ? selectedItemData.from + selectedItemData.durationInFrames : 0;





  // Format time helper
  const formatTime = (frames: number): string => {
    const totalSeconds = frames / fps;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const centiseconds = Math.floor(((totalSeconds % 1) * 100));
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  };

  // Canvas properties when no item is selected
  // Canvas properties when no item is selected
  if (!selectedItem) {
    return (
      <div className={panelClassName}>
        {showHeader && (
        <div className={panelHeaderClassName}>
          <h2 className="m-0 text-sm font-bold text-slate-900">Properties</h2>
        </div>
        )}
        <div className="flex-1 overflow-auto p-4">
          {/* Canvas Section */}
          <div className="mb-6">
            <h3 className={sectionTitleClassName}>Canvas</h3>

            <div className="mb-3">
              <label className={labelClassName}>Aspect Ratio</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: '16:9', w: 1920, h: 1080 },
                  { label: '9:16', w: 1080, h: 1920 },
                  { label: '4:3', w: 1440, h: 1080 },
                  { label: '1:1', w: 1080, h: 1080 },
                  { label: '21:9', w: 2560, h: 1080 },
                  { label: '4:5', w: 1080, h: 1350 },
                ].map(preset => (
                  <RemotionButton
                    key={preset.label}
                    onClick={() => dispatch({
                      type: 'SET_COMPOSITION_SIZE',
                      payload: { width: preset.w, height: preset.h },
                    })}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${compositionWidth === preset.w && compositionHeight === preset.h
                        ? 'bg-[#ff6b50] text-white shadow-sm'
                        : 'border border-slate-200 bg-white text-slate-700 hover:border-[#ffb6a8] hover:bg-[#fff3f0] hover:text-[#d94f38]'
                      }`}
                  >
                    {preset.label}
                  </RemotionButton>
                ))}
              </div>
            </div>
          </div>

          {/* Duration Section */}
          <div className="mb-6">
            <h3 className={sectionTitleClassName}>Duration</h3>
            <div className="text-2xl font-semibold text-slate-900 mb-4 font-mono tracking-tight">
              {formatTime(durationInFrames)}
            </div>
            <div className="mb-3">
              <label className={labelClassName}>Duration (frames)</label>
              <RemotionInput
                type="number"
                value={durationInFrames}
                onChange={(e) => dispatch({
                  type: 'SET_DURATION',
                  payload: parseInt(e.target.value) || 600,
                })}
                className={fieldClassName}
              />
            </div>
            <div className="mb-3">
              <label className={labelClassName}>Frame Rate (FPS)</label>
              <div className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm text-slate-600">{fps} fps</div>
            </div>
          </div>

        </div>
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

  return (
    <div className={panelClassName}>
      {showHeader && (
      <div className={panelHeaderClassName}>
        <h2 className="m-0 text-sm font-bold text-slate-900">Properties</h2>
        <div className="flex gap-2">
          <SplitButton
            itemFrom={item.from}
            itemEnd={itemEnd}
            trackId={trackId}
            itemId={item.id}
          />
          <RemotionButton
            onClick={deleteItem}
            className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50"
          >
            Delete
          </RemotionButton>
        </div>
      </div>
      )}

      <div className="flex-1 overflow-auto p-4">

        {/* Transform Properties */}
        <div className="mb-6">
          <h3 className={sectionTitleClassName}>Transform</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="mb-3">
              <label className={labelClassName}>X Position (px)</label>
              <RemotionInput
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
                className={fieldClassName}
              />
            </div>
            <div className="mb-3">
              <label className={labelClassName}>Y Position (px)</label>
              <RemotionInput
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
                className={fieldClassName}
              />
            </div>
            <div className="mb-3">
              <label className={labelClassName}>Width Scale (1=100%)</label>
              <RemotionInput
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
                className={fieldClassName}
              />
            </div>
            <div className="mb-3">
              <label className={labelClassName}>Height Scale (1=100%)</label>
              <RemotionInput
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
                className={fieldClassName}
              />
            </div>
          </div>
          <div className="mb-3">
            <label className={labelClassName}>Rotation (degrees)</label>
            <RemotionInput
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
              className={fieldClassName}
            />
          </div>
          <div className="mb-3">
            <label className={labelClassName}>Opacity (0-1)</label>
            <RemotionInput
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
              className={fieldClassName}
            />
          </div>
          <div className="mb-3">
            <label className={labelClassName}>Layer Order</label>
            <div className={readOnlyFieldClassName}>
              Controlled by track position
            </div>
          </div>
        </div>

        {/* Common Properties */}
        <div className="mb-6">
          <h3 className={sectionTitleClassName}>Timing</h3>
          <div className="mb-3">
            <label className={labelClassName}>Start Frame</label>
            <RemotionInput
              type="number"
              value={item.from}
              onChange={(e) => updateItem({ from: parseInt(e.target.value) || 0 })}
              className={fieldClassName}
            />
          </div>
          <div className="mb-3">
            <label className={labelClassName}>Duration (frames)</label>
            <RemotionInput
              type="number"
              value={item.durationInFrames}
              onChange={(e) =>
                updateItem({ durationInFrames: parseInt(e.target.value) || 1 })
              }
              className={fieldClassName}
            />
          </div>
        </div>

        {/* Transition Item Properties */}
        {item.type === 'transition' && (
          <div className="mb-6">
            <h3 className={sectionTitleClassName}>Transition</h3>
            <div className="mb-3">
              <label className={labelClassName}>Type</label>
              <RemotionSelect
                value={(item as TransitionItem).transitionType}
                onChange={(e) =>
                  updateItem({ transitionType: e.target.value as TransitionType } as Partial<typeof item>)
                }
                className={fieldClassName}
              >
                {TRANSITION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </RemotionSelect>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className={labelClassName}>From item ID</label>
                <RemotionInput
                  type="text"
                  value={(item as TransitionItem).fromItemId ?? ''}
                  onChange={(e) =>
                    updateItem({ fromItemId: e.target.value } as Partial<typeof item>)
                  }
                  className={fieldClassName}
                  placeholder="clip leaving"
                />
              </div>
              <div>
                <label className={labelClassName}>To item ID</label>
                <RemotionInput
                  type="text"
                  value={(item as TransitionItem).toItemId ?? ''}
                  onChange={(e) =>
                    updateItem({ toItemId: e.target.value } as Partial<typeof item>)
                  }
                  className={fieldClassName}
                  placeholder="clip entering"
                />
              </div>
            </div>
            <p className="m-0 text-xs text-slate-500">
              Both clips are auto-hidden on their original tracks during the transition window.
            </p>
          </div>
        )}

        {/* Fades & Transitions */}
        {(item.type === 'video' || item.type === 'audio' || item.type === 'image') && (
          <div className="mb-6">
            <h3 className={sectionTitleClassName}>Fades & Transitions</h3>

            {item.type === 'video' && (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClassName}>Video fade in (frames)</label>
                    <RemotionInput
                      type="number"
                      min={0}
                      value={(item as { videoFadeIn?: number }).videoFadeIn ?? 0}
                      onChange={(e) =>
                        updateItem({ videoFadeIn: Math.max(0, parseInt(e.target.value) || 0) } as Partial<typeof item>)
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>Video fade out (frames)</label>
                    <RemotionInput
                      type="number"
                      min={0}
                      value={(item as { videoFadeOut?: number }).videoFadeOut ?? 0}
                      onChange={(e) =>
                        updateItem({ videoFadeOut: Math.max(0, parseInt(e.target.value) || 0) } as Partial<typeof item>)
                      }
                      className={fieldClassName}
                    />
                  </div>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClassName}>Fade-in color (optional)</label>
                    <RemotionInput
                      type="text"
                      placeholder="e.g. white, #000"
                      value={(item as { videoFadeInColor?: string }).videoFadeInColor ?? ''}
                      onChange={(e) =>
                        updateItem({ videoFadeInColor: e.target.value || undefined } as Partial<typeof item>)
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>Fade-out color (optional)</label>
                    <RemotionInput
                      type="text"
                      placeholder="e.g. white, #000"
                      value={(item as { videoFadeOutColor?: string }).videoFadeOutColor ?? ''}
                      onChange={(e) =>
                        updateItem({ videoFadeOutColor: e.target.value || undefined } as Partial<typeof item>)
                      }
                      className={fieldClassName}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className={labelClassName}>Audio fade in (frames)</label>
                <RemotionInput
                  type="number"
                  min={0}
                  value={(item as { audioFadeIn?: number }).audioFadeIn ?? 0}
                  onChange={(e) =>
                    updateItem({ audioFadeIn: Math.max(0, parseInt(e.target.value) || 0) } as Partial<typeof item>)
                  }
                  className={fieldClassName}
                  disabled={item.type === 'image'}
                />
              </div>
              <div>
                <label className={labelClassName}>Audio fade out (frames)</label>
                <RemotionInput
                  type="number"
                  min={0}
                  value={(item as { audioFadeOut?: number }).audioFadeOut ?? 0}
                  onChange={(e) =>
                    updateItem({ audioFadeOut: Math.max(0, parseInt(e.target.value) || 0) } as Partial<typeof item>)
                  }
                  className={fieldClassName}
                  disabled={item.type === 'image'}
                />
              </div>
            </div>

            {item.type === 'image' && (
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClassName}>Image fade in (frames)</label>
                  <RemotionInput
                    type="number"
                    min={0}
                    value={(item as { imageFadeIn?: number }).imageFadeIn ?? 0}
                    onChange={(e) =>
                      updateItem({ imageFadeIn: Math.max(0, parseInt(e.target.value) || 0) } as Partial<typeof item>)
                    }
                    className={fieldClassName}
                  />
                </div>
                <div>
                  <label className={labelClassName}>Image fade out (frames)</label>
                  <RemotionInput
                    type="number"
                    min={0}
                    value={(item as { imageFadeOut?: number }).imageFadeOut ?? 0}
                    onChange={(e) =>
                      updateItem({ imageFadeOut: Math.max(0, parseInt(e.target.value) || 0) } as Partial<typeof item>)
                    }
                    className={fieldClassName}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Text Item Properties */}
        {item.type === 'text' && (
          <div className="mb-6">
            <h3 className={sectionTitleClassName}>Text</h3>
            <div className="mb-3">
              <label className={labelClassName}>Content</label>
              <RemotionTextarea
                value={(item as TextItem).text}
                onChange={(e) => updateItem({ text: e.target.value })}
                className={`${fieldClassName} min-h-[80px] resize-y`}
              />
            </div>
            <div className="mb-3">
              <label className={labelClassName}>Color</label>
              <div className="flex gap-2 items-center">
                <RemotionInput
                  type="color"
                  value={(item as TextItem).color}
                  onChange={(e) => updateItem({ color: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded-md border border-slate-200 bg-white p-0.5"
                />
                <RemotionInput
                  type="text"
                  value={(item as TextItem).color}
                  onChange={(e) => updateItem({ color: e.target.value })}
                  className={`flex-1 ${fieldClassName}`}
                />
              </div>
            </div>
            <div className="mb-3">
              <label className={labelClassName}>Font Size</label>
              <RemotionInput
                type="number"
                value={(item as TextItem).fontSize || 60}
                onChange={(e) =>
                  updateItem({ fontSize: parseInt(e.target.value) || 60 })
                }
                className={fieldClassName}
              />
            </div>
            <div className="mb-3">
              <label className={labelClassName}>Font Family</label>
              <RemotionSelect
                value={(item as TextItem).fontFamily || 'Arial'}
                onChange={(e) => updateItem({ fontFamily: e.target.value })}
                className={fieldClassName}
              >
                <option value="Arial">Arial</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Georgia">Georgia</option>
                <option value="Courier New">Courier New</option>
                <option value="Verdana">Verdana</option>
              </RemotionSelect>
            </div>
            <div className="mb-3">
              <label className={labelClassName}>Font Weight</label>
              <RemotionSelect
                value={(item as TextItem).fontWeight || 'bold'}
                onChange={(e) => updateItem({ fontWeight: e.target.value })}
                className={fieldClassName}
              >
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
                <option value="lighter">Lighter</option>
                <option value="bolder">Bolder</option>
              </RemotionSelect>
            </div>
          </div>
        )}

        {/* Solid Item Properties */}
        {item.type === 'solid' && (
          <div className="mb-6">
            <h3 className={sectionTitleClassName}>Color</h3>
            <div className="mb-3">
              <label className={labelClassName}>Background Color</label>
              <div className="flex gap-2 items-center">
                <RemotionInput
                  type="color"
                  value={(item as SolidItem).color}
                  onChange={(e) => updateItem({ color: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded-md border border-slate-200 bg-white p-0.5"
                />
                <RemotionInput
                  type="text"
                  value={(item as SolidItem).color}
                  onChange={(e) => updateItem({ color: e.target.value })}
                  className={`flex-1 ${fieldClassName}`}
                />
              </div>
            </div>
          </div>
        )}

        {/* Video/Image/Audio Properties */}
        {(item.type === 'video' || item.type === 'image' || item.type === 'audio') && (
          <div className="mb-6">
            <h3 className={sectionTitleClassName}>Source</h3>
            <div className="mb-3">
              <label className={labelClassName}>File Path</label>
              <RemotionInput
                type="text"
                value={item.src}
                readOnly
                className={readOnlyFieldClassName}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
