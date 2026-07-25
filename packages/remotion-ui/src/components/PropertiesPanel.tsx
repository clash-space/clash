import React from 'react';
import {
  AUDIO_GAIN_DB_MAX,
  AUDIO_GAIN_DB_MIN,
  DEFAULT_AUDIO_DUCKING_SETTINGS,
  findAdjacentTimelineKeyframes,
  getItemResolvedSrc,
  isSubtitleTextItem,
  resolveAudioFadeInFrames,
  resolveAudioFadeOutFrames,
  resolveAudioGainDb,
  removeTimelineKeyframe,
  sampleTimelineKeyframes,
  upsertTimelineKeyframe,
  useEditorDispatch,
  useEditorPlayback,
  useEditorStaticState,
} from '@master-clash/remotion-core';
import type {
  AudioItem,
  ClipAnimationType,
  CompositionItem,
  DerivedOverlayItem,
  EffectParamValue,
  Item,
  MediaFit,
  SolidItem,
  StickerItem,
  TextItem,
  TransitionItem,
  TransitionType,
  VideoItem,
} from '@master-clash/remotion-core';
import {
  builtInEffectRegistry,
  type EffectParamDefinition,
} from '@master-clash/remotion-effects';
import {
  MgCompositionSpecSchema,
  type MgCompositionLayer,
  type MgCompositionSpec,
} from '@clash/shared-types';
import {
  RemotionButton,
  RemotionInput,
  RemotionSelect,
  RemotionTextarea,
} from './ui/controls';
import { getContinuousTransitionBoundaries } from '../library/applyTimelineLibraryItem';

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

const CLIP_ANIMATION_OPTIONS: Array<{ value: ClipAnimationType; label: string }> = [
  { value: 'fade', label: 'Fade' },
  { value: 'zoom-in', label: 'Zoom in' },
  { value: 'zoom-out', label: 'Zoom out' },
  { value: 'slide-left', label: 'Slide left' },
  { value: 'slide-right', label: 'Slide right' },
  { value: 'slide-up', label: 'Slide up' },
  { value: 'slide-down', label: 'Slide down' },
];

const editorTypeClassName = {
  caption: 'text-[length:var(--clash-editor-text-caption)] leading-[var(--clash-editor-leading-caption)]',
  control: 'text-[length:var(--clash-editor-text-control)] leading-[var(--clash-editor-leading-control)]',
  item: 'text-[length:var(--clash-editor-text-item)] leading-[var(--clash-editor-leading-item)]',
  heading: 'text-[length:var(--clash-editor-text-heading)] leading-[var(--clash-editor-leading-heading)]',
  metric: 'text-[length:var(--clash-editor-text-metric)] leading-[var(--clash-editor-leading-metric)]',
} as const;
const panelClassName = 'flex h-full flex-col overflow-hidden bg-warm-surface text-slate-900 dark:text-stone-100';
const panelHeaderClassName = 'flex min-h-12 items-center justify-between gap-3 border-b border-warm-border/75 bg-warm-surface px-4 py-2.5';
const panelScrollClassName = 'flex-1 overflow-y-auto overscroll-contain px-4 pb-5';
const inspectorSectionClassName = 'border-t border-warm-border/70 py-4 first:border-t-0';
const sectionTitleClassName = `mb-3 font-semibold tracking-[-0.01em] text-slate-800 dark:text-stone-200 ${editorTypeClassName.item}`;
const labelClassName = `mb-1 block font-medium text-stone-500 dark:text-stone-400 ${editorTypeClassName.caption}`;
const controlRadiusClassName = 'rounded-[var(--clash-workbench-control-radius)]';
const fieldClassName = `h-8 w-full ${controlRadiusClassName} border border-warm-border bg-warm-page/40 px-2.5 text-slate-900 outline-none transition-[border-color,box-shadow,background-color] focus:border-brand/55 focus:bg-warm-surface focus:ring-2 focus:ring-brand/15 dark:text-stone-100 ${editorTypeClassName.item}`;
const readOnlyFieldClassName = `flex min-h-8 w-full items-center ${controlRadiusClassName} border border-warm-border/75 bg-warm-muted/55 px-2.5 text-stone-500 dark:text-stone-400 ${editorTypeClassName.item}`;
const colorFieldClassName = `h-8 w-10 shrink-0 cursor-pointer ${controlRadiusClassName} border border-warm-border bg-warm-page/40 p-1`;

const aspectRatioLabel = (width: number, height: number): string => {
  const ratio = width / Math.max(1, height);
  const rounded = Math.round(ratio * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)}:1`;
};

const MediaFitControl: React.FC<{
  value?: MediaFit;
  fallback: MediaFit;
  onChange: (value: MediaFit) => void;
}> = ({ value, fallback, onChange }) => (
  <div>
    <label className={labelClassName}>Fit</label>
    <RemotionSelect
      aria-label="Media fit"
      value={value ?? fallback}
      onChange={(event) => onChange(event.target.value as MediaFit)}
      className={fieldClassName}
    >
      <option value="fill">Fill frame</option>
      <option value="cover">Cover</option>
      <option value="contain">Contain</option>
    </RemotionSelect>
  </div>
);

const InspectorIdentityRow: React.FC<{
  label: string;
  value: React.ReactNode;
}> = ({ label, value }) => (
  <div>
    <label className={labelClassName}>{label}</label>
    <div className={`${readOnlyFieldClassName} min-w-0 break-all`}>{value}</div>
  </div>
);

const InspectorCompactNumberField: React.FC<
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> & {
    prefix: string;
  }
> = ({ prefix, ...inputProps }) => (
  <label className={`grid grid-cols-[42px_minmax(0,1fr)] items-center ${controlRadiusClassName} border border-warm-border bg-warm-page/40 pl-2 text-stone-400`}>
    <span className={editorTypeClassName.caption}>{prefix}</span>
    <RemotionInput
      {...inputProps}
      type="number"
      className={`${fieldClassName} border-0 bg-transparent pl-0 focus:ring-0`}
    />
  </label>
);

const updateMgLayer = (
  spec: MgCompositionSpec,
  layerId: string,
  updates: Partial<MgCompositionLayer>,
): MgCompositionSpec => ({
  ...spec,
  layers: spec.layers.map((layer) => (
    layer.id === layerId
      ? { ...layer, ...updates } as MgCompositionLayer
      : layer
  )),
});

const effectDisplayName = (effectId: string): string => effectId
  .split('/').pop()!
  .split('-')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const resolveEffectDefinition = (effectId: string, version: number) => {
  try {
    return builtInEffectRegistry.resolve(effectId, version);
  } catch {
    return null;
  }
};

const EffectParameterControl: React.FC<{
  effectName: string;
  name: string;
  definition: EffectParamDefinition;
  value: EffectParamValue;
  onChange: (value: EffectParamValue) => void;
}> = ({ effectName, name, definition, value, onChange }) => {
  const ariaLabel = `${effectName} ${name}`;
  if (definition.type === 'boolean') {
    return (
      <label className="flex items-center justify-between gap-3 py-1 text-slate-600 dark:text-stone-300">
        <span className={editorTypeClassName.control}>{name}</span>
        <RemotionInput
          aria-label={ariaLabel}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 accent-brand"
        />
      </label>
    );
  }
  if (definition.type === 'enum') {
    return (
      <div>
        <label className={labelClassName}>{name}</label>
        <RemotionSelect
          aria-label={ariaLabel}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className={fieldClassName}
        >
          {definition.values.map((option) => <option key={option} value={option}>{option}</option>)}
        </RemotionSelect>
      </div>
    );
  }
  if (definition.type === 'color') {
    return (
      <div>
        <label className={labelClassName}>{name}</label>
        <RemotionInput
          aria-label={ariaLabel}
          type="color"
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className={`h-9 w-full cursor-pointer ${controlRadiusClassName} border border-warm-border bg-warm-page/45 p-1`}
        />
      </div>
    );
  }
  if (definition.type === 'vec2') {
    const tuple = Array.isArray(value) ? value : definition.default;
    return (
      <div>
        <label className={labelClassName}>{name}</label>
        <div className="grid grid-cols-2 gap-2">
          {[0, 1].map((axis) => (
            <RemotionInput
              key={axis}
              aria-label={`${ariaLabel} ${axis === 0 ? 'x' : 'y'}`}
              type="number"
              min={definition.min}
              max={definition.max}
              value={Number(tuple[axis] ?? 0)}
              onChange={(event) => {
                const next = [...tuple] as [number, number];
                next[axis] = Number(event.target.value);
                onChange(next);
              }}
              className={fieldClassName}
            />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div>
      <label className={labelClassName}>{name}</label>
      <RemotionInput
        aria-label={ariaLabel}
        type="number"
        min={definition.min}
        max={definition.max}
        step={definition.step}
        value={Number(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className={fieldClassName}
      />
    </div>
  );
};

/**
 * Split button — isolated subscriber for `currentFrame` so the rest of
 * PropertiesPanel doesn't re-render on every scrub or playback frame.
 * Inline button placement still works because React reconciles only
 * this small child when the playhead changes.
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
      className={`${controlRadiusClassName} border px-3 py-1.5 font-medium transition-colors ${editorTypeClassName.control} ${
        canSplit
          ? 'cursor-pointer border-brand/35 bg-brand-light text-brand hover:border-brand/55 hover:bg-brand-light/75'
          : 'cursor-not-allowed border-warm-border bg-warm-muted text-content-disabled'
      }`}
      title={canSplit ? `Split at frame ${currentFrame}` : 'Move playhead onto the selected item to split'}
    >
      Split
    </RemotionButton>
  );
});

type KeyframeControlHeaderProps = {
  label: 'Position' | 'Scale' | 'Rotation' | 'Opacity';
  active: boolean;
  itemFrom: number;
  itemLocalFrame: number;
  currentKey: { interpolation: 'hold' | 'linear' } | undefined;
  previousFrame: number | null;
  nextFrame: number | null;
  onToggle: () => void;
  onInterpolationChange: (interpolation: 'hold' | 'linear') => void;
};

const KeyframeControlHeader: React.FC<KeyframeControlHeaderProps> = ({
  label,
  active,
  itemFrom,
  itemLocalFrame,
  currentKey,
  previousFrame,
  nextFrame,
  onToggle,
  onInterpolationChange,
}) => {
  const dispatch = useEditorDispatch();
  const navigate = (frame: number | null) => {
    if (frame === null) return;
    dispatch({ type: 'SET_CURRENT_FRAME', payload: itemFrom + frame });
  };

  return (
    <div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
      <span className={`font-medium text-stone-500 dark:text-stone-400 ${editorTypeClassName.caption}`}>
        {label}
      </span>
      <RemotionButton
        type="button"
        aria-label={`${currentKey ? 'Remove' : 'Add'} ${label} keyframe at current frame`}
        title={`${currentKey ? 'Remove' : 'Add'} ${label} keyframe at frame ${itemLocalFrame}`}
        onClick={onToggle}
        className={`flex h-6 w-6 items-center justify-center ${controlRadiusClassName} border ${
          currentKey
            ? 'border-brand/60 bg-brand-light text-brand'
            : active
              ? 'border-brand/35 bg-warm-surface text-brand'
              : 'border-warm-border bg-warm-page/40 text-stone-400'
        }`}
      >
        {currentKey ? '◆' : '◇'}
      </RemotionButton>
      {active && (
      <div className="col-span-2 flex min-w-0 items-center gap-1">
        <RemotionButton
          type="button"
          aria-label={`Previous ${label} keyframe`}
          title={`Previous ${label} keyframe`}
          disabled={previousFrame === null}
          onClick={() => navigate(previousFrame)}
          className={`flex h-6 min-w-6 items-center justify-center ${controlRadiusClassName} border border-warm-border bg-warm-page/40 px-1 text-stone-500 disabled:cursor-not-allowed disabled:opacity-35`}
        >
          ‹
        </RemotionButton>
        <RemotionButton
          type="button"
          aria-label={`Next ${label} keyframe`}
          title={`Next ${label} keyframe`}
          disabled={nextFrame === null}
          onClick={() => navigate(nextFrame)}
          className={`flex h-6 min-w-6 items-center justify-center ${controlRadiusClassName} border border-warm-border bg-warm-page/40 px-1 text-stone-500 disabled:cursor-not-allowed disabled:opacity-35`}
        >
          ›
        </RemotionButton>
        {currentKey && (
          <RemotionSelect
            aria-label={`${label} keyframe interpolation`}
            title={`${label} outgoing interpolation`}
            value={currentKey.interpolation}
            onChange={(event) => onInterpolationChange(event.target.value as 'hold' | 'linear')}
            className={`h-6 min-w-0 flex-1 ${controlRadiusClassName} border border-warm-border bg-warm-page/40 px-1 text-stone-600 ${editorTypeClassName.caption}`}
          >
            <option value="linear">Linear</option>
            <option value="hold">Hold</option>
          </RemotionSelect>
        )}
      </div>
      )}
    </div>
  );
};

const PositionKeyframeControl: React.FC<{
  trackId: string;
  item: Item;
}> = React.memo(({ trackId, item }) => {
  const dispatch = useEditorDispatch();
  const { currentFrame } = useEditorPlayback();
  const itemLocalFrame = Math.max(
    0,
    Math.min(item.durationInFrames - 1, currentFrame - item.from),
  );
  const properties = item.properties ?? {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    opacity: 1,
  };
  const sampled = sampleTimelineKeyframes(item.keyframes, itemLocalFrame, {
    position: [properties.x, properties.y],
    scale: [1, 1],
    rotation: properties.rotation ?? 0,
    opacity: properties.opacity ?? 1,
  });
  const active = (item.keyframes?.position?.length ?? 0) > 0;
  const currentKey = item.keyframes?.position?.find(
    (keyframe) => keyframe.frame === itemLocalFrame,
  );
  const adjacent = findAdjacentTimelineKeyframes(
    item.keyframes,
    'position',
    itemLocalFrame,
  );
  const updateItem = (updates: Partial<Item>) => {
    dispatch({
      type: 'UPDATE_ITEM',
      payload: { trackId, itemId: item.id, updates },
    });
  };
  const toggleCurrentKeyframe = () => {
    updateItem({
      keyframes: currentKey
        ? removeTimelineKeyframe(item.keyframes, 'position', itemLocalFrame)
        : upsertTimelineKeyframe(item.keyframes, 'position', {
            frame: itemLocalFrame,
            value: sampled.position,
            interpolation: 'linear',
          }),
    } as Partial<Item>);
  };
  const updateAxis = (axis: 0 | 1, value: number) => {
    if (active) {
      const nextValue = [...sampled.position] as [number, number];
      nextValue[axis] = value;
      updateItem({
        keyframes: upsertTimelineKeyframe(item.keyframes, 'position', {
          frame: itemLocalFrame,
          value: nextValue,
          interpolation: currentKey?.interpolation ?? 'linear',
        }),
      } as Partial<Item>);
      return;
    }
    updateItem({
      properties: {
        ...properties,
        x: axis === 0 ? value : properties.x,
        y: axis === 1 ? value : properties.y,
      },
    } as Partial<Item>);
  };
  const updateInterpolation = (interpolation: 'hold' | 'linear') => {
    if (!currentKey) return;
    updateItem({
      keyframes: upsertTimelineKeyframe(item.keyframes, 'position', {
        ...currentKey,
        interpolation,
      }),
    } as Partial<Item>);
  };

  return (
    <div>
      <KeyframeControlHeader
        label="Position"
        active={active}
        itemFrom={item.from}
        itemLocalFrame={itemLocalFrame}
        currentKey={currentKey}
        previousFrame={adjacent.previousFrame}
        nextFrame={adjacent.nextFrame}
        onToggle={toggleCurrentKeyframe}
        onInterpolationChange={updateInterpolation}
      />
      <div className="grid grid-cols-2 gap-2">
        {(['X', 'Y'] as const).map((axisLabel, axis) => (
          <label
            key={axisLabel}
            className={`grid grid-cols-[18px_minmax(0,1fr)] items-center ${controlRadiusClassName} border border-warm-border bg-warm-page/40 pl-2 text-stone-400`}
          >
            <span className={editorTypeClassName.caption}>{axisLabel}</span>
            <RemotionInput
              aria-label={`${axisLabel} position in pixels`}
              type="number"
              step="1"
              value={sampled.position[axis]}
              onChange={(event) => updateAxis(axis as 0 | 1, parseFloat(event.target.value) || 0)}
              className={`${fieldClassName} border-0 bg-transparent pl-0 focus:ring-0`}
            />
          </label>
        ))}
      </div>
    </div>
  );
});

const ScaleKeyframeControl: React.FC<{
  trackId: string;
  item: Item;
}> = React.memo(({ trackId, item }) => {
  const dispatch = useEditorDispatch();
  const { currentFrame } = useEditorPlayback();
  const itemLocalFrame = Math.max(
    0,
    Math.min(item.durationInFrames - 1, currentFrame - item.from),
  );
  const properties = {
    x: item.properties?.x ?? 0,
    y: item.properties?.y ?? 0,
    width: item.properties?.width ?? 1,
    height: item.properties?.height ?? 1,
    rotation: item.properties?.rotation ?? 0,
    opacity: item.properties?.opacity ?? 1,
  };
  const sampled = sampleTimelineKeyframes(item.keyframes, itemLocalFrame, {
    position: [properties.x, properties.y],
    scale: [1, 1],
    rotation: properties.rotation,
    opacity: properties.opacity,
  });
  const active = (item.keyframes?.scale?.length ?? 0) > 0;
  const currentKey = item.keyframes?.scale?.find(
    (keyframe) => keyframe.frame === itemLocalFrame,
  );
  const adjacent = findAdjacentTimelineKeyframes(item.keyframes, 'scale', itemLocalFrame);
  const updateItem = (updates: Partial<Item>) => dispatch({
    type: 'UPDATE_ITEM',
    payload: { trackId, itemId: item.id, updates },
  });
  const toggleCurrentKeyframe = () => updateItem({
    keyframes: currentKey
      ? removeTimelineKeyframe(item.keyframes, 'scale', itemLocalFrame)
      : upsertTimelineKeyframe(item.keyframes, 'scale', {
          frame: itemLocalFrame,
          value: sampled.scale,
          interpolation: 'linear',
        }),
  } as Partial<Item>);
  const updateAxis = (axis: 0 | 1, value: number) => {
    const nextValue = [...sampled.scale] as [number, number];
    nextValue[axis] = Math.max(0, value);
    updateItem({
      keyframes: upsertTimelineKeyframe(item.keyframes, 'scale', {
        frame: itemLocalFrame,
        value: nextValue,
        interpolation: currentKey?.interpolation ?? 'linear',
      }),
    } as Partial<Item>);
  };
  const updateInterpolation = (interpolation: 'hold' | 'linear') => {
    if (!currentKey) return;
    updateItem({
      keyframes: upsertTimelineKeyframe(item.keyframes, 'scale', {
        ...currentKey,
        interpolation,
      }),
    } as Partial<Item>);
  };

  return (
    <div>
      <KeyframeControlHeader
        label="Scale"
        active={active}
        itemFrom={item.from}
        itemLocalFrame={itemLocalFrame}
        currentKey={currentKey}
        previousFrame={adjacent.previousFrame}
        nextFrame={adjacent.nextFrame}
        onToggle={toggleCurrentKeyframe}
        onInterpolationChange={updateInterpolation}
      />
      <div className="grid grid-cols-2 gap-2">
        {(['X', 'Y'] as const).map((axisLabel, axis) => (
          <label
            key={axisLabel}
            className={`grid grid-cols-[18px_minmax(0,1fr)] items-center ${controlRadiusClassName} border border-warm-border bg-warm-page/40 pl-2 text-stone-400`}
          >
            <span className={editorTypeClassName.caption}>{axisLabel}</span>
            <RemotionInput
              aria-label={`${axisLabel} animated scale`}
              type="number"
              step="0.01"
              min="0"
              disabled={!active}
              value={sampled.scale[axis]}
              onChange={(event) => updateAxis(axis as 0 | 1, parseFloat(event.target.value) || 0)}
              className={`${fieldClassName} border-0 bg-transparent pl-0 focus:ring-0`}
            />
          </label>
        ))}
      </div>
    </div>
  );
});

type ScalarKeyframeControlProps = {
  trackId: string;
  item: Item;
  channel: 'rotation' | 'opacity';
  label: 'Rotation' | 'Opacity';
  ariaLabel: string;
  step: string;
  min?: string;
  max?: string;
};

const ScalarKeyframeControl: React.FC<ScalarKeyframeControlProps> = React.memo(({
  trackId,
  item,
  channel,
  label,
  ariaLabel,
  step,
  min,
  max,
}) => {
  const dispatch = useEditorDispatch();
  const { currentFrame } = useEditorPlayback();
  const itemLocalFrame = Math.max(
    0,
    Math.min(item.durationInFrames - 1, currentFrame - item.from),
  );
  const properties = {
    x: item.properties?.x ?? 0,
    y: item.properties?.y ?? 0,
    width: item.properties?.width ?? 1,
    height: item.properties?.height ?? 1,
    rotation: item.properties?.rotation ?? 0,
    opacity: item.properties?.opacity ?? 1,
  };
  const sampled = sampleTimelineKeyframes(item.keyframes, itemLocalFrame, {
    position: [properties.x, properties.y],
    scale: [1, 1],
    rotation: properties.rotation,
    opacity: properties.opacity,
  });
  const channelKeys = item.keyframes?.[channel];
  const active = (channelKeys?.length ?? 0) > 0;
  const currentKey = channelKeys?.find((keyframe) => keyframe.frame === itemLocalFrame);
  const adjacent = findAdjacentTimelineKeyframes(item.keyframes, channel, itemLocalFrame);
  const value = sampled[channel];
  const updateItem = (updates: Partial<Item>) => dispatch({
    type: 'UPDATE_ITEM',
    payload: { trackId, itemId: item.id, updates },
  });
  const toggleCurrentKeyframe = () => updateItem({
    keyframes: currentKey
      ? removeTimelineKeyframe(item.keyframes, channel, itemLocalFrame)
      : upsertTimelineKeyframe(item.keyframes, channel, {
          frame: itemLocalFrame,
          value,
          interpolation: 'linear',
        }),
  } as Partial<Item>);
  const updateValue = (nextValue: number) => {
    if (active) {
      updateItem({
        keyframes: upsertTimelineKeyframe(item.keyframes, channel, {
          frame: itemLocalFrame,
          value: channel === 'opacity' ? Math.max(0, Math.min(1, nextValue)) : nextValue,
          interpolation: currentKey?.interpolation ?? 'linear',
        }),
      } as Partial<Item>);
      return;
    }
    updateItem({
      properties: {
        ...properties,
        [channel]: channel === 'opacity' ? Math.max(0, Math.min(1, nextValue)) : nextValue,
      },
    } as Partial<Item>);
  };
  const updateInterpolation = (interpolation: 'hold' | 'linear') => {
    if (!currentKey) return;
    updateItem({
      keyframes: upsertTimelineKeyframe(item.keyframes, channel, {
        ...currentKey,
        interpolation,
      }),
    } as Partial<Item>);
  };

  return (
    <div>
      <KeyframeControlHeader
        label={label}
        active={active}
        itemFrom={item.from}
        itemLocalFrame={itemLocalFrame}
        currentKey={currentKey}
        previousFrame={adjacent.previousFrame}
        nextFrame={adjacent.nextFrame}
        onToggle={toggleCurrentKeyframe}
        onInterpolationChange={updateInterpolation}
      />
      <RemotionInput
        aria-label={ariaLabel}
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(event) => updateValue(parseFloat(event.target.value) || 0)}
        className={fieldClassName}
      />
    </div>
  );
});

type PropertiesPanelProps = {
  showHeader?: boolean;
  title?: string;
  headerAction?: React.ReactNode;
};

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  showHeader = true,
  title = 'Properties',
  headerAction,
}) => {
  const [mgLayerQuery, setMgLayerQuery] = React.useState('');
  const [mgLayerOpenById, setMgLayerOpenById] = React.useState<Record<string, boolean>>({});
  const dispatch = useEditorDispatch();
  const {
    tracks,
    assets,
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

  React.useEffect(() => {
    setMgLayerQuery('');
    setMgLayerOpenById({});
  }, [selectedItemId]);

  // Format time helper
  const formatTime = (frames: number): string => {
    const totalCentiseconds = Math.floor(((frames * 100) / Math.max(1, fps)) + 1e-6);
    const minutes = Math.floor(totalCentiseconds / 6000);
    const seconds = Math.floor((totalCentiseconds % 6000) / 100);
    const centiseconds = totalCentiseconds % 100;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  };

  // Canvas properties when no item is selected
  if (!selectedItem) {
    return (
      <div className={panelClassName}>
        {showHeader && (
        <div className={panelHeaderClassName}>
          <h2 className={`m-0 font-bold text-slate-900 dark:text-stone-100 ${editorTypeClassName.heading}`}>{title}</h2>
          {headerAction}
        </div>
        )}
        <div className={panelScrollClassName}>
          {/* Canvas Section */}
          <div className={inspectorSectionClassName}>
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
                    className={`${controlRadiusClassName} px-2 py-1.5 font-medium transition-colors ${editorTypeClassName.control} ${compositionWidth === preset.w && compositionHeight === preset.h
                        ? 'bg-brand text-brand-foreground shadow-sm'
                        : 'border border-warm-border bg-warm-surface text-stone-700 hover:border-brand/40 hover:bg-brand/[0.08] hover:text-brand dark:text-neutral-200'
                      }`}
                  >
                    {preset.label}
                  </RemotionButton>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className={labelClassName}>Width</span>
                <RemotionInput
                  aria-label="Canvas width in pixels"
                  type="number"
                  min={1}
                  step={1}
                  value={compositionWidth}
                  onChange={(event) => dispatch({
                    type: 'SET_COMPOSITION_SIZE',
                    payload: {
                      width: Math.max(1, parseInt(event.target.value, 10) || 1),
                      height: compositionHeight,
                    },
                  })}
                  className={fieldClassName}
                />
              </label>
              <label>
                <span className={labelClassName}>Height</span>
                <RemotionInput
                  aria-label="Canvas height in pixels"
                  type="number"
                  min={1}
                  step={1}
                  value={compositionHeight}
                  onChange={(event) => dispatch({
                    type: 'SET_COMPOSITION_SIZE',
                    payload: {
                      width: compositionWidth,
                      height: Math.max(1, parseInt(event.target.value, 10) || 1),
                    },
                  })}
                  className={fieldClassName}
                />
              </label>
            </div>
            <p className={`mb-0 mt-2 text-stone-400 ${editorTypeClassName.caption}`}>
              {aspectRatioLabel(compositionWidth, compositionHeight)}
            </p>
          </div>

          {/* Duration Section */}
          <div className={inspectorSectionClassName}>
            <h3 className={sectionTitleClassName}>Duration</h3>
            <div className={`mb-4 font-mono font-semibold tracking-tight text-slate-900 tabular-nums dark:text-stone-100 ${editorTypeClassName.metric}`}>
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
              <div className={readOnlyFieldClassName}>{fps} fps</div>
            </div>
          </div>

        </div>
      </div>
    );
  }

  const { trackId, item } = selectedItem;
  const selectedTrack = tracks.find((track) => track.id === trackId);
  const transitionBoundary = item.type === 'transition'
    ? tracks
      .flatMap((track) => getContinuousTransitionBoundaries(track))
      .find((boundary) => (
        boundary.fromItem.id === item.fromItemId
        && boundary.toItem.id === item.toItemId
      ))
    : undefined;
  const transitionMaxDuration = transitionBoundary
    ? Math.max(
      1,
      Math.min(
        transitionBoundary.fromItem.durationInFrames,
        transitionBoundary.toItem.durationInFrames,
      ) * 2,
    )
    : Math.max(1, item.durationInFrames);
  const supportsVisualTransform = item.type !== 'transition' && item.type !== 'audio';
  const subtitleItem = isSubtitleTextItem(item) ? item : null;
  const parsedMgSpec = item.type === 'composition'
    ? MgCompositionSpecSchema.safeParse((item as CompositionItem).spec)
    : null;
  const visibleMgLayers = parsedMgSpec?.success
    ? parsedMgSpec.data.layers.filter((layer) => (
      layer.id.toLocaleLowerCase().includes(mgLayerQuery.trim().toLocaleLowerCase())
      || layer.type.includes(mgLayerQuery.trim().toLocaleLowerCase())
    ))
    : [];
  const resolvedSource = item.type === 'composition'
    ? item.sourcePath
    : getItemResolvedSrc(item, assets);

  const updateItem = (updates: Partial<typeof item>) => {
    dispatch({
      type: 'UPDATE_ITEM',
      payload: { trackId, itemId: item.id, updates },
    });
  };

  const updateVideoAnimation = (
    phase: 'entrance' | 'exit',
    updates: { type?: ClipAnimationType | 'none'; durationInFrames?: number },
  ) => {
    if (item.type !== 'video') return;
    const field = phase === 'entrance' ? 'entranceAnimation' : 'exitAnimation';
    const current = (item as VideoItem)[field];
    if (updates.type === 'none') {
      updateItem({ [field]: undefined } as Partial<typeof item>);
      return;
    }
    const nextType = updates.type ?? current?.type;
    if (!nextType) return;
    updateItem({
      [field]: {
        type: nextType,
        durationInFrames: Math.max(
          1,
          Math.min(
            item.durationInFrames,
            updates.durationInFrames ?? current?.durationInFrames ?? Math.min(15, item.durationInFrames),
          ),
        ),
      },
    } as Partial<typeof item>);
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
        <h2 className={`m-0 font-bold text-slate-900 dark:text-stone-100 ${editorTypeClassName.heading}`}>{title}</h2>
        <div className="flex gap-2">
          {headerAction}
          {item.type !== 'transition' && (
            <SplitButton
              itemFrom={item.from}
              itemEnd={itemEnd}
              trackId={trackId}
              itemId={item.id}
            />
          )}
          <RemotionButton
            onClick={deleteItem}
            className={`${controlRadiusClassName} border border-red-200 bg-warm-surface px-3 py-1.5 font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 dark:border-red-900/70 dark:text-red-400 dark:hover:bg-red-950/45 ${editorTypeClassName.control}`}
          >
            Delete
          </RemotionButton>
        </div>
      </div>
      )}

      <div className={panelScrollClassName}>

        {/* Transform Properties */}
        {supportsVisualTransform && (
        <div className={inspectorSectionClassName}>
          <h3 className={sectionTitleClassName}>Transform</h3>
          <div className="space-y-3">
            <PositionKeyframeControl trackId={trackId} item={item} />
            <div>
              <span className={labelClassName}>Size</span>
              <div className="grid grid-cols-2 gap-2">
                <label className={`grid grid-cols-[18px_minmax(0,1fr)] items-center ${controlRadiusClassName} border border-warm-border bg-warm-page/40 pl-2 text-stone-400`}>
                  <span className={editorTypeClassName.caption}>W</span>
                  <RemotionInput
                    aria-label="Width scale"
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
                    className={`${fieldClassName} border-0 bg-transparent pl-0 focus:ring-0`}
                  />
                </label>
                <label className={`grid grid-cols-[18px_minmax(0,1fr)] items-center ${controlRadiusClassName} border border-warm-border bg-warm-page/40 pl-2 text-stone-400`}>
                  <span className={editorTypeClassName.caption}>H</span>
                  <RemotionInput
                    aria-label="Height scale"
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
                    className={`${fieldClassName} border-0 bg-transparent pl-0 focus:ring-0`}
                  />
                </label>
              </div>
            </div>
            <ScaleKeyframeControl trackId={trackId} item={item} />
            <div data-testid="scalar-keyframe-controls" className="space-y-3">
              <ScalarKeyframeControl
                trackId={trackId}
                item={item}
                channel="rotation"
                label="Rotation"
                ariaLabel="Rotation in degrees"
                step="1"
              />
              <ScalarKeyframeControl
                trackId={trackId}
                item={item}
                channel="opacity"
                label="Opacity"
                ariaLabel="Opacity"
                step="0.1"
                min="0"
                max="1"
              />
            </div>
            <p className={`m-0 text-stone-400 ${editorTypeClassName.caption}`}>
              Layer order follows the track stack.
            </p>
          </div>
        </div>
        )}

        {/* Common Properties */}
        <div className={inspectorSectionClassName}>
          <h3 className={sectionTitleClassName}>Timing</h3>
          {item.type === 'transition' ? (
            <>
              <div className="mb-3">
                <label className={labelClassName}>Range</label>
                <div className={readOnlyFieldClassName}>
                  {formatTime(item.from)}–{formatTime(item.from + item.durationInFrames)}
                </div>
              </div>
              <div className="mb-3">
                <label className={labelClassName}>Duration (frames)</label>
                <RemotionInput
                  aria-label="Transition duration in frames"
                  type="number"
                  min={1}
                  max={transitionMaxDuration}
                  value={item.durationInFrames}
                  onChange={(e) => {
                    const requestedDuration = parseInt(e.target.value, 10) || 1;
                    const nextDuration = Math.max(
                      1,
                      Math.min(transitionMaxDuration, requestedDuration),
                    );
                    updateItem({
                      durationInFrames: nextDuration,
                      from: transitionBoundary
                        ? transitionBoundary.frame - Math.floor(nextDuration / 2)
                        : item.from,
                    });
                  }}
                  className={fieldClassName}
                />
              </div>
              <div className="mb-3">
                <label className={labelClassName}>Duration</label>
                <div className={readOnlyFieldClassName}>
                  {(item.durationInFrames / Math.max(1, fps)).toFixed(2)} seconds
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className={labelClassName}>Start</span>
                  <RemotionInput
                    aria-label="Start frame"
                    type="number"
                    value={item.from}
                    onChange={(e) => updateItem({ from: parseInt(e.target.value, 10) || 0 })}
                    className={fieldClassName}
                  />
                </label>
                <label>
                  <span className={labelClassName}>Duration</span>
                  <RemotionInput
                    aria-label="Duration in frames"
                    type="number"
                    min={1}
                    value={item.durationInFrames}
                    onChange={(e) =>
                      updateItem({ durationInFrames: Math.max(1, parseInt(e.target.value, 10) || 1) })
                    }
                    className={fieldClassName}
                  />
                </label>
              </div>
              {(item.type === 'video' || item.type === 'audio') && (
                <label>
                  <span className={labelClassName}>Source in-point</span>
                  <RemotionInput
                    aria-label="Source start frame"
                    type="number"
                    min={0}
                    step={1}
                    value={item.sourceStartInFrames ?? 0}
                    onChange={(event) => updateItem({
                      sourceStartInFrames: Math.max(0, parseInt(event.target.value, 10) || 0),
                    } as Partial<typeof item>)}
                    className={fieldClassName}
                  />
                </label>
              )}
            </div>
          )}
        </div>

        {(item.type === 'video'
          || item.type === 'image'
          || item.type === 'sticker'
          || item.type === 'derived-overlay') && (
          <div className={inspectorSectionClassName}>
            <h3 className={sectionTitleClassName}>Layout</h3>
            <MediaFitControl
              value={item.mediaFit}
              fallback={item.type === 'sticker' ? 'contain' : 'fill'}
              onChange={(mediaFit) => updateItem({ mediaFit } as Partial<typeof item>)}
            />
          </div>
        )}

        {item.type === 'video' && (
          <div className={inspectorSectionClassName}>
            <h3 className={sectionTitleClassName}>Animation</h3>
            <div className="space-y-2">
              {(['entrance', 'exit'] as const).map((phase) => {
                const field = phase === 'entrance' ? 'entranceAnimation' : 'exitAnimation';
                const animation = item[field];
                const phaseLabel = phase === 'entrance' ? 'Entrance' : 'Exit';
                return (
                  <div
                    key={phase}
                    className={`${controlRadiusClassName} border border-warm-border/75 bg-warm-page/35 p-2.5`}
                  >
                    <p className={`mb-2 mt-0 font-semibold text-slate-700 dark:text-stone-300 ${editorTypeClassName.control}`}>
                      {phaseLabel}
                    </p>
                    <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
                      <label>
                        <span className={labelClassName}>Motion</span>
                        <RemotionSelect
                          aria-label={`${phaseLabel} animation type`}
                          value={animation?.type ?? 'none'}
                          onChange={(event) => updateVideoAnimation(phase, {
                            type: event.target.value as ClipAnimationType | 'none',
                          })}
                          className={fieldClassName}
                        >
                          <option value="none">None</option>
                          {CLIP_ANIMATION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </RemotionSelect>
                      </label>
                      <label>
                        <span className={labelClassName}>Frames</span>
                        <RemotionInput
                          aria-label={`${phaseLabel} animation duration in frames`}
                          type="number"
                          min={1}
                          max={item.durationInFrames}
                          step={1}
                          disabled={!animation}
                          value={animation?.durationInFrames ?? Math.min(15, item.durationInFrames)}
                          onChange={(event) => updateVideoAnimation(phase, {
                            durationInFrames: parseInt(event.target.value, 10) || 1,
                          })}
                          className={`${fieldClassName} disabled:cursor-not-allowed disabled:bg-warm-muted/55 disabled:text-stone-400`}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className={`mb-0 mt-2 text-stone-400 ${editorTypeClassName.caption}`}>
              Entrance and exit belong to this clip. Transitions stay between continuous clips.
            </p>
          </div>
        )}

        {/* Ordered, version-pinned clip effect stack */}
        {item.effects && item.effects.length > 0 && (
          <div className={inspectorSectionClassName}>
            <h3 className={sectionTitleClassName}>Effects</h3>
            <div className="space-y-2">
              {item.effects.map((effect, effectIndex) => {
                const definition = resolveEffectDefinition(effect.effectId, effect.effectVersion);
                const displayName = effectDisplayName(effect.effectId);
                return (
                  <div key={`${effect.effectId}:${effect.effectVersion}:${effectIndex}`} className="rounded-lg bg-warm-page/70 p-2.5 ring-1 ring-warm-border/70">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`m-0 truncate font-semibold text-slate-900 dark:text-stone-100 ${editorTypeClassName.item}`}>{displayName}</p>
                        <p className={`m-0 text-stone-400 ${editorTypeClassName.caption}`}>v{effect.effectVersion}</p>
                      </div>
                      <div className="flex items-center">
                        {([
                          { direction: -1, label: 'up', path: 'M5 12.5 10 7.5l5 5' },
                          { direction: 1, label: 'down', path: 'M5 7.5 10 12.5l5-5' },
                        ] as const).map(({ direction, label, path }) => {
                          const targetIndex = effectIndex + direction;
                          const canMove = targetIndex >= 0 && targetIndex < (item.effects?.length ?? 0);
                          return (
                            <RemotionButton
                              key={label}
                              type="button"
                              aria-label={`Move ${displayName} ${label}`}
                              title={`Move ${displayName} ${label}`}
                              disabled={!canMove}
                              onClick={() => {
                                if (!canMove || !item.effects) return;
                                const effects = [...item.effects];
                                [effects[effectIndex], effects[targetIndex]] = [
                                  effects[targetIndex]!,
                                  effects[effectIndex]!,
                                ];
                                updateItem({ effects });
                              }}
                              className={`flex h-7 w-7 items-center justify-center ${controlRadiusClassName} text-stone-400 transition-colors hover:bg-warm-muted hover:text-slate-700 disabled:opacity-25 dark:hover:text-stone-200`}
                            >
                              <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
                                <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </RemotionButton>
                          );
                        })}
                        <RemotionButton
                          type="button"
                          aria-label={`Remove ${displayName}`}
                          title={`Remove ${displayName}`}
                          onClick={() => updateItem({
                            effects: item.effects?.filter((_, index) => index !== effectIndex) ?? [],
                          })}
                          className={`flex h-7 w-7 items-center justify-center ${controlRadiusClassName} text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/45 dark:hover:text-red-400`}
                        >
                          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
                            <path d="M4 10h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </RemotionButton>
                      </div>
                    </div>
                    {definition ? (
                      <div className="space-y-2">
                        {Object.entries(definition.params).map(([name, parameter]) => (
                          <EffectParameterControl
                            key={name}
                            effectName={displayName}
                            name={name}
                            definition={parameter}
                            value={effect.params?.[name] ?? parameter.default}
                            onChange={(value) => updateItem({
                              effects: item.effects?.map((candidate, index) => index === effectIndex
                                ? { ...candidate, params: { ...(candidate.params ?? {}), [name]: value } }
                                : candidate),
                            })}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className={`m-0 text-stone-500 ${editorTypeClassName.control}`}>
                        Effect package unavailable. The pinned reference is preserved.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Transition Item Properties */}
        {item.type === 'transition' && (
          <div className={inspectorSectionClassName}>
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
                <div className={readOnlyFieldClassName}>
                  {(item as TransitionItem).fromItemId ?? 'Missing'}
                </div>
              </div>
              <div>
                <label className={labelClassName}>To item ID</label>
                <div className={readOnlyFieldClassName}>
                  {(item as TransitionItem).toItemId ?? 'Missing'}
                </div>
              </div>
            </div>
            <p className={`m-0 text-slate-500 ${editorTypeClassName.item}`}>
              {transitionBoundary
                ? 'Pinned to the continuous edit point. Drag either edge on the Timeline or edit the duration here.'
                : 'This transition is detached because the referenced clips are no longer continuous.'}
            </p>
          </div>
        )}

        {/* Clip gain is independent from fade duration in both the DSL and UI. */}
        {(item.type === 'video' || item.type === 'audio') && (
          <div className={inspectorSectionClassName}>
            <h3 className={sectionTitleClassName}>Audio</h3>
            <div>
              <label className={labelClassName}>Gain</label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <RemotionInput
                  aria-label="Audio gain in decibels"
                  type="number"
                  min={AUDIO_GAIN_DB_MIN}
                  max={AUDIO_GAIN_DB_MAX}
                  step={0.1}
                  value={Math.round(resolveAudioGainDb(item) * 10) / 10}
                  onChange={(e) =>
                    updateItem({
                      audioGainDb: Math.max(
                        AUDIO_GAIN_DB_MIN,
                        Math.min(AUDIO_GAIN_DB_MAX, Number(e.target.value)),
                      ),
                      volume: undefined,
                    } as Partial<typeof item>)
                  }
                  className={fieldClassName}
                />
                <span className={`w-6 text-right text-stone-400 ${editorTypeClassName.caption}`}>dB</span>
              </div>
            </div>
            {item.type === 'audio' && selectedTrack?.role === 'music' && (
              <div className="mt-4 border-t border-warm-border/60 pt-3">
                <label className="flex items-center justify-between gap-3 text-slate-600 dark:text-stone-300">
                  <span className={`font-medium ${editorTypeClassName.control}`}>Duck under speech</span>
                  <RemotionInput
                    aria-label="Automatic audio ducking"
                    type="checkbox"
                    checked={Boolean(item.audioDucking)}
                    onChange={(event) => updateItem({
                      audioDucking: event.target.checked
                        ? { ...DEFAULT_AUDIO_DUCKING_SETTINGS }
                        : undefined,
                    } as Partial<typeof item>)}
                    className="h-4 w-4 accent-brand"
                  />
                </label>
                {item.audioDucking && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div>
                      <label className={labelClassName}>Amount</label>
                      <RemotionInput
                        aria-label="Ducking amount in decibels"
                        type="number"
                        min={AUDIO_GAIN_DB_MIN}
                        max={0}
                        step={0.1}
                        value={item.audioDucking.amountDb}
                        onChange={(event) => updateItem({
                          audioDucking: {
                            ...item.audioDucking,
                            amountDb: Math.max(
                              AUDIO_GAIN_DB_MIN,
                              Math.min(0, Number(event.target.value)),
                            ),
                          },
                        } as Partial<AudioItem>)}
                        className={fieldClassName}
                      />
                    </div>
                    <div>
                      <label className={labelClassName}>Attack</label>
                      <RemotionInput
                        aria-label="Ducking attack frames"
                        type="number"
                        min={0}
                        step={1}
                        value={item.audioDucking.attackFrames}
                        onChange={(event) => updateItem({
                          audioDucking: {
                            ...item.audioDucking,
                            attackFrames: Math.max(0, parseInt(event.target.value, 10) || 0),
                          },
                        } as Partial<AudioItem>)}
                        className={fieldClassName}
                      />
                    </div>
                    <div>
                      <label className={labelClassName}>Release</label>
                      <RemotionInput
                        aria-label="Ducking release frames"
                        type="number"
                        min={0}
                        step={1}
                        value={item.audioDucking.releaseFrames}
                        onChange={(event) => updateItem({
                          audioDucking: {
                            ...item.audioDucking,
                            releaseFrames: Math.max(0, parseInt(event.target.value, 10) || 0),
                          },
                        } as Partial<AudioItem>)}
                        className={fieldClassName}
                      />
                    </div>
                  </div>
                )}
                <p className={`mb-0 mt-2 text-stone-400 ${editorTypeClassName.caption}`}>
                  Narration, dialogue, and primary video audio trigger the reduction.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Audio fade stays separate from dB gain. Visual video motion lives
            in Animation above; transitions remain bound to clip seams. */}
        {(item.type === 'audio' || item.type === 'image') && (
          <div className={inspectorSectionClassName}>
            <h3 className={sectionTitleClassName}>Fades</h3>

            {item.type === 'audio' && (
              <div className="mb-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClassName}>Fade in</label>
                    <RemotionInput
                      aria-label="Audio fade in frames"
                      type="number"
                      min={0}
                      step={1}
                      value={resolveAudioFadeInFrames(item)}
                      onChange={(e) =>
                        updateItem({
                          audioFadeInFrames: Math.max(0, parseInt(e.target.value, 10) || 0),
                          audioFadeIn: undefined,
                        } as Partial<typeof item>)
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>Fade out</label>
                    <RemotionInput
                      aria-label="Audio fade out frames"
                      type="number"
                      min={0}
                      step={1}
                      value={resolveAudioFadeOutFrames(item)}
                      onChange={(e) =>
                        updateItem({
                          audioFadeOutFrames: Math.max(0, parseInt(e.target.value, 10) || 0),
                          audioFadeOut: undefined,
                        } as Partial<typeof item>)
                      }
                      className={fieldClassName}
                    />
                  </div>
              </div>
            )}

            {item.type === 'image' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClassName}>Fade in</label>
                    <RemotionInput
                      aria-label="Image fade in frames"
                      type="number"
                      min={0}
                      value={item.imageFadeIn ?? 0}
                      onChange={(e) =>
                        updateItem({ imageFadeIn: Math.max(0, parseInt(e.target.value, 10) || 0) } as Partial<typeof item>)
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>Fade out</label>
                    <RemotionInput
                      aria-label="Image fade out frames"
                      type="number"
                      min={0}
                      value={item.imageFadeOut ?? 0}
                      onChange={(e) =>
                        updateItem({ imageFadeOut: Math.max(0, parseInt(e.target.value, 10) || 0) } as Partial<typeof item>)
                      }
                      className={fieldClassName}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className={labelClassName}>Fade-in color</span>
                    <RemotionInput
                      aria-label="Image fade in color"
                      type="text"
                      placeholder="transparent"
                      value={item.imageFadeInColor ?? ''}
                      onChange={(event) => updateItem({
                        imageFadeInColor: event.target.value || undefined,
                      } as Partial<typeof item>)}
                      className={fieldClassName}
                    />
                  </label>
                  <label>
                    <span className={labelClassName}>Fade-out color</span>
                    <RemotionInput
                      aria-label="Image fade out color"
                      type="text"
                      placeholder="transparent"
                      value={item.imageFadeOutColor ?? ''}
                      onChange={(event) => updateItem({
                        imageFadeOutColor: event.target.value || undefined,
                      } as Partial<typeof item>)}
                      className={fieldClassName}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Plain Text items are editable overlays. Timed subtitles remain Text
            in the DSL but expose their cue-backed presentation separately. */}
        {item.type === 'text' && !subtitleItem && (
          <div className={inspectorSectionClassName}>
            <h3 className={sectionTitleClassName}>Text</h3>
            <div className="mb-3">
              <label className={labelClassName}>Content</label>
              <RemotionTextarea
                aria-label="Text content"
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
                  className={colorFieldClassName}
                />
                <RemotionInput
                  type="text"
                  value={(item as TextItem).color}
                  onChange={(e) => updateItem({ color: e.target.value })}
                  className={`flex-1 ${fieldClassName}`}
                />
              </div>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <label>
                <span className={labelClassName}>Font size</span>
                <RemotionInput
                  aria-label="Text font size"
                  type="number"
                  min={1}
                  value={(item as TextItem).fontSize || 60}
                  onChange={(e) =>
                    updateItem({ fontSize: Math.max(1, parseInt(e.target.value, 10) || 60) })
                  }
                  className={fieldClassName}
                />
              </label>
              <label>
                <span className={labelClassName}>Alignment</span>
                <RemotionSelect
                  aria-label="Text alignment"
                  value={(item as TextItem).textAlign ?? 'center'}
                  onChange={(event) => updateItem({
                    textAlign: event.target.value as TextItem['textAlign'],
                  })}
                  className={fieldClassName}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </RemotionSelect>
              </label>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <label>
                <span className={labelClassName}>Letter spacing</span>
                <RemotionInput
                  aria-label="Text letter spacing in pixels"
                  type="number"
                  step={0.1}
                  value={(item as TextItem).letterSpacingPx ?? 0}
                  onChange={(event) => updateItem({
                    letterSpacingPx: Number(event.target.value) || 0,
                  })}
                  className={fieldClassName}
                />
              </label>
              <label>
                <span className={labelClassName}>Line height</span>
                <RemotionInput
                  aria-label="Text line height"
                  type="number"
                  min={0.5}
                  step={0.05}
                  value={(item as TextItem).lineHeight ?? 1.1}
                  onChange={(event) => updateItem({
                    lineHeight: Math.max(0.5, Number(event.target.value) || 1.1),
                  })}
                  className={fieldClassName}
                />
              </label>
            </div>
            <label className="mb-3 block">
              <span className={labelClassName}>Font family</span>
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
            </label>
            <label className="block">
              <span className={labelClassName}>Font weight</span>
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
            </label>
          </div>
        )}

        {subtitleItem && (
          <div className={inspectorSectionClassName}>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="m-0 font-semibold tracking-[-0.01em] text-slate-800 dark:text-stone-200">
                Captions
              </h3>
              <span className={`text-stone-400 ${editorTypeClassName.caption}`}>
                {subtitleItem.cues.length} {subtitleItem.cues.length === 1 ? 'cue' : 'cues'}
              </span>
            </div>
            <p className={`mb-3 mt-0 text-stone-500 ${editorTypeClassName.control}`}>
              Cue text is edited in the Captions workspace. These controls style the timed Text item.
            </p>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <label>
                <span className={labelClassName}>Position</span>
                <RemotionSelect
                  aria-label="Caption position"
                  value={subtitleItem.style?.position ?? 'bottom'}
                  onChange={(event) => updateItem({
                    style: {
                      ...subtitleItem.style,
                      position: event.target.value as NonNullable<TextItem['style']>['position'],
                    },
                  })}
                  className={fieldClassName}
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                </RemotionSelect>
              </label>
              <label>
                <span className={labelClassName}>Font size</span>
                <RemotionInput
                  aria-label="Caption font size"
                  type="number"
                  min={1}
                  value={subtitleItem.style?.fontSize ?? 48}
                  onChange={(event) => updateItem({
                    style: {
                      ...subtitleItem.style,
                      fontSize: Math.max(1, parseInt(event.target.value, 10) || 48),
                    },
                  })}
                  className={fieldClassName}
                />
              </label>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <label>
                <span className={labelClassName}>Text color</span>
                <RemotionInput
                  aria-label="Caption text color"
                  type="text"
                  value={subtitleItem.style?.color ?? subtitleItem.color}
                  onChange={(event) => updateItem({
                    style: { ...subtitleItem.style, color: event.target.value },
                  })}
                  className={fieldClassName}
                />
              </label>
              <label>
                <span className={labelClassName}>Background</span>
                <RemotionInput
                  aria-label="Caption background color"
                  type="text"
                  value={subtitleItem.style?.backgroundColor ?? 'transparent'}
                  onChange={(event) => updateItem({
                    style: { ...subtitleItem.style, backgroundColor: event.target.value },
                  })}
                  className={fieldClassName}
                />
              </label>
            </div>
            <label className="block">
              <span className={labelClassName}>Font family</span>
              <RemotionInput
                aria-label="Caption font family"
                type="text"
                value={subtitleItem.style?.fontFamily ?? 'Arial'}
                onChange={(event) => updateItem({
                  style: { ...subtitleItem.style, fontFamily: event.target.value },
                })}
                className={fieldClassName}
              />
            </label>
            <label className="mt-3 block">
              <span className={labelClassName}>Font weight</span>
              <RemotionSelect
                aria-label="Caption font weight"
                value={String(subtitleItem.style?.fontWeight ?? 700)}
                onChange={(event) => updateItem({
                  style: {
                    ...subtitleItem.style,
                    fontWeight: parseInt(event.target.value, 10),
                  },
                })}
                className={fieldClassName}
              >
                <option value="400">Regular</option>
                <option value="500">Medium</option>
                <option value="600">Semibold</option>
                <option value="700">Bold</option>
                <option value="800">Extra bold</option>
                <option value="900">Black</option>
              </RemotionSelect>
            </label>
          </div>
        )}

        {/* Solid Item Properties */}
        {item.type === 'solid' && (
          <div className={inspectorSectionClassName}>
            <h3 className={sectionTitleClassName}>Color</h3>
            <div className="mb-3">
              <label className={labelClassName}>Background Color</label>
              <div className="flex gap-2 items-center">
                <RemotionInput
                  type="color"
                  value={(item as SolidItem).color}
                  onChange={(e) => updateItem({ color: e.target.value })}
                  className={colorFieldClassName}
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

        {item.type === 'composition' && (
          <div className={inspectorSectionClassName}>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="m-0 font-semibold tracking-[-0.01em] text-slate-800 dark:text-stone-200">
                Motion Graphics
              </h3>
              <span className={`text-stone-400 ${editorTypeClassName.caption}`}>
                {parsedMgSpec?.success ? `${parsedMgSpec.data.layers.length} layers` : 'External runtime'}
              </span>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <InspectorIdentityRow label="Runtime" value={(item as CompositionItem).runtime} />
              <InspectorIdentityRow label="Composition" value={(item as CompositionItem).compositionId} />
            </div>
            {parsedMgSpec?.success ? (
              <div>
                <label className="mb-3 block">
                  <span className={labelClassName}>Canvas background</span>
                  <RemotionInput
                    aria-label="MG background"
                    type="text"
                    value={parsedMgSpec.data.background}
                    onChange={(event) => updateItem({
                      spec: {
                        ...parsedMgSpec.data,
                        background: event.target.value,
                      },
                    } as Partial<typeof item>)}
                    className={fieldClassName}
                  />
                </label>
                <RemotionInput
                  aria-label="Search MG layers"
                  type="search"
                  value={mgLayerQuery}
                  onChange={(event) => setMgLayerQuery(event.target.value)}
                  placeholder="Search layers"
                  className={`${fieldClassName} mb-2`}
                />
                <div className="divide-y divide-warm-border/70 border-y border-warm-border/70">
                  {visibleMgLayers.map((layer) => (
                    <details
                      key={layer.id}
                      open={mgLayerOpenById[layer.id] ?? (
                        parsedMgSpec.data.layers.length <= 8 || mgLayerQuery.trim().length > 0
                      )}
                      onToggle={(event) => {
                        const isOpen = event.currentTarget.open;
                        setMgLayerOpenById((current) => (
                          current[layer.id] === isOpen
                            ? current
                            : { ...current, [layer.id]: isOpen }
                        ));
                      }}
                      className="group py-1.5"
                    >
                      <summary className={`flex cursor-pointer list-none items-center justify-between gap-2 py-1 text-slate-700 marker:hidden dark:text-stone-300 ${editorTypeClassName.control}`}>
                        <span className="min-w-0 truncate font-medium">{layer.id}</span>
                        <span className="flex items-center gap-2">
                          <span className={`uppercase tracking-[0.08em] text-stone-400 ${editorTypeClassName.caption}`}>
                            {layer.type}
                          </span>
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-stone-400 transition-transform group-open:rotate-90" aria-hidden="true">
                            <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </summary>
                      <div className="space-y-3 pb-2 pt-1">
                        <div>
                          <span className={labelClassName}>Timing</span>
                          <div className="grid grid-cols-2 gap-2">
                            <InspectorCompactNumberField
                              prefix="Start"
                              aria-label={`MG layer ${layer.id} start frame`}
                              min={0}
                              step={1}
                              value={layer.from}
                              onChange={(event) => updateItem({
                                spec: updateMgLayer(
                                  parsedMgSpec.data,
                                  layer.id,
                                  { from: Math.max(0, parseInt(event.target.value, 10) || 0) },
                                ),
                              } as Partial<typeof item>)}
                            />
                            <InspectorCompactNumberField
                              prefix="Dur"
                              aria-label={`MG layer ${layer.id} duration in frames`}
                              min={1}
                              step={1}
                              value={layer.durationInFrames}
                              onChange={(event) => updateItem({
                                spec: updateMgLayer(
                                  parsedMgSpec.data,
                                  layer.id,
                                  {
                                    durationInFrames: Math.max(
                                      1,
                                      parseInt(event.target.value, 10) || 1,
                                    ),
                                  },
                                ),
                              } as Partial<typeof item>)}
                            />
                          </div>
                        </div>
                        <div>
                          <span className={labelClassName}>Position</span>
                          <div className="grid grid-cols-2 gap-2">
                            <InspectorCompactNumberField
                              prefix="X"
                              aria-label={`MG layer ${layer.id} x position`}
                              step={1}
                              value={layer.x}
                              onChange={(event) => updateItem({
                                spec: updateMgLayer(
                                  parsedMgSpec.data,
                                  layer.id,
                                  { x: Number(event.target.value) || 0 },
                                ),
                              } as Partial<typeof item>)}
                            />
                            <InspectorCompactNumberField
                              prefix="Y"
                              aria-label={`MG layer ${layer.id} y position`}
                              step={1}
                              value={layer.y}
                              onChange={(event) => updateItem({
                                spec: updateMgLayer(
                                  parsedMgSpec.data,
                                  layer.id,
                                  { y: Number(event.target.value) || 0 },
                                ),
                              } as Partial<typeof item>)}
                            />
                          </div>
                        </div>
                        <div>
                          <span className={labelClassName}>Transform</span>
                          <div className="grid grid-cols-2 gap-2">
                            <InspectorCompactNumberField
                              prefix="Scale"
                              aria-label={`MG layer ${layer.id} scale`}
                              min={0.01}
                              step={0.05}
                              value={layer.scale}
                              onChange={(event) => updateItem({
                                spec: updateMgLayer(
                                  parsedMgSpec.data,
                                  layer.id,
                                  { scale: Math.max(0.01, Number(event.target.value) || 1) },
                                ),
                              } as Partial<typeof item>)}
                            />
                            <InspectorCompactNumberField
                              prefix="Rot"
                              aria-label={`MG layer ${layer.id} rotation`}
                              step={1}
                              value={layer.rotation}
                              onChange={(event) => updateItem({
                                spec: updateMgLayer(
                                  parsedMgSpec.data,
                                  layer.id,
                                  { rotation: Number(event.target.value) || 0 },
                                ),
                              } as Partial<typeof item>)}
                            />
                            <InspectorCompactNumberField
                              prefix="Alpha"
                              aria-label={`MG layer ${layer.id} opacity`}
                              min={0}
                              max={1}
                              step={0.05}
                              value={layer.opacity}
                              onChange={(event) => updateItem({
                                spec: updateMgLayer(
                                  parsedMgSpec.data,
                                  layer.id,
                                  {
                                    opacity: Math.min(
                                      1,
                                      Math.max(0, Number(event.target.value) || 0),
                                    ),
                                  },
                                ),
                              } as Partial<typeof item>)}
                            />
                            <InspectorCompactNumberField
                              prefix="Z"
                              aria-label={`MG layer ${layer.id} layer order`}
                              step={1}
                              value={layer.zIndex}
                              onChange={(event) => updateItem({
                                spec: updateMgLayer(
                                  parsedMgSpec.data,
                                  layer.id,
                                  { zIndex: parseInt(event.target.value, 10) || 0 },
                                ),
                              } as Partial<typeof item>)}
                            />
                          </div>
                        </div>
                        <div>
                          <span className={labelClassName}>Size</span>
                          <div className="grid grid-cols-2 gap-2">
                            <InspectorCompactNumberField
                              prefix="W"
                              aria-label={`MG layer ${layer.id} width`}
                              min={1}
                              step={1}
                              value={layer.width ?? ''}
                              placeholder="Auto"
                              onChange={(event) => updateItem({
                                spec: updateMgLayer(
                                  parsedMgSpec.data,
                                  layer.id,
                                  {
                                    width: event.target.value === ''
                                      ? undefined
                                      : Math.max(1, Number(event.target.value) || 1),
                                  },
                                ),
                              } as Partial<typeof item>)}
                            />
                            <InspectorCompactNumberField
                              prefix="H"
                              aria-label={`MG layer ${layer.id} height`}
                              min={1}
                              step={1}
                              value={layer.height ?? ''}
                              placeholder="Auto"
                              onChange={(event) => updateItem({
                                spec: updateMgLayer(
                                  parsedMgSpec.data,
                                  layer.id,
                                  {
                                    height: event.target.value === ''
                                      ? undefined
                                      : Math.max(1, Number(event.target.value) || 1),
                                  },
                                ),
                              } as Partial<typeof item>)}
                            />
                          </div>
                        </div>
                        {layer.type === 'text' ? (
                          <div className="space-y-2">
                            <span className={labelClassName}>Typography</span>
                            <RemotionInput
                              aria-label={`MG layer ${layer.id} text`}
                              type="text"
                              value={layer.text}
                              onChange={(event) => updateItem({
                                spec: updateMgLayer(
                                  parsedMgSpec.data,
                                  layer.id,
                                  { text: event.target.value },
                                ),
                              } as Partial<typeof item>)}
                              className={fieldClassName}
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <label>
                                <span className={labelClassName}>Font size</span>
                                <RemotionInput
                                  aria-label={`MG layer ${layer.id} font size`}
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={layer.fontSize}
                                  onChange={(event) => updateItem({
                                    spec: updateMgLayer(
                                      parsedMgSpec.data,
                                      layer.id,
                                      {
                                        fontSize: Math.max(
                                          1,
                                          Number(event.target.value) || 1,
                                        ),
                                      },
                                    ),
                                  } as Partial<typeof item>)}
                                  className={fieldClassName}
                                />
                              </label>
                              <label>
                                <span className={labelClassName}>Weight</span>
                                <RemotionInput
                                  aria-label={`MG layer ${layer.id} font weight`}
                                  type="text"
                                  value={layer.fontWeight}
                                  onChange={(event) => updateItem({
                                    spec: updateMgLayer(
                                      parsedMgSpec.data,
                                      layer.id,
                                      {
                                        fontWeight: Number.isNaN(Number(event.target.value))
                                          ? event.target.value
                                          : Number(event.target.value),
                                      },
                                    ),
                                  } as Partial<typeof item>)}
                                  className={fieldClassName}
                                />
                              </label>
                              <label>
                                <span className={labelClassName}>Color</span>
                                <RemotionInput
                                  aria-label={`MG layer ${layer.id} color`}
                                  type="text"
                                  value={layer.color}
                                  onChange={(event) => updateItem({
                                    spec: updateMgLayer(
                                      parsedMgSpec.data,
                                      layer.id,
                                      { color: event.target.value },
                                    ),
                                  } as Partial<typeof item>)}
                                  className={fieldClassName}
                                />
                              </label>
                              <label>
                                <span className={labelClassName}>Tracking</span>
                                <RemotionInput
                                  aria-label={`MG layer ${layer.id} letter spacing`}
                                  type="number"
                                  step={0.1}
                                  value={layer.letterSpacing}
                                  onChange={(event) => updateItem({
                                    spec: updateMgLayer(
                                      parsedMgSpec.data,
                                      layer.id,
                                      { letterSpacing: Number(event.target.value) || 0 },
                                    ),
                                  } as Partial<typeof item>)}
                                  className={fieldClassName}
                                />
                              </label>
                            </div>
                            <span className={labelClassName}>Alignment</span>
                            <RemotionSelect
                              aria-label={`MG layer ${layer.id} text alignment`}
                              value={layer.align}
                              onChange={(event) => updateItem({
                                spec: updateMgLayer(
                                  parsedMgSpec.data,
                                  layer.id,
                                  {
                                    align: event.target.value as Extract<
                                      MgCompositionLayer,
                                      { type: 'text' }
                                    >['align'],
                                  },
                                ),
                              } as Partial<typeof item>)}
                              className={fieldClassName}
                            >
                              <option value="left">Left</option>
                              <option value="center">Center</option>
                              <option value="right">Right</option>
                            </RemotionSelect>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <span className={labelClassName}>Shape</span>
                            <div className="grid grid-cols-2 gap-2">
                              <label>
                                <span className={labelClassName}>Fill</span>
                                <RemotionInput
                                  aria-label={`MG layer ${layer.id} fill`}
                                  type="text"
                                  value={layer.fill}
                                  onChange={(event) => updateItem({
                                    spec: updateMgLayer(
                                      parsedMgSpec.data,
                                      layer.id,
                                      { fill: event.target.value },
                                    ),
                                  } as Partial<typeof item>)}
                                  className={fieldClassName}
                                />
                              </label>
                              <label>
                                <span className={labelClassName}>Stroke</span>
                                <RemotionInput
                                  aria-label={`MG layer ${layer.id} stroke`}
                                  type="text"
                                  value={layer.stroke ?? ''}
                                  placeholder="None"
                                  onChange={(event) => updateItem({
                                    spec: updateMgLayer(
                                      parsedMgSpec.data,
                                      layer.id,
                                      { stroke: event.target.value || undefined },
                                    ),
                                  } as Partial<typeof item>)}
                                  className={fieldClassName}
                                />
                              </label>
                              <label>
                                <span className={labelClassName}>Stroke width</span>
                                <RemotionInput
                                  aria-label={`MG layer ${layer.id} stroke width`}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={layer.strokeWidth ?? 0}
                                  onChange={(event) => updateItem({
                                    spec: updateMgLayer(
                                      parsedMgSpec.data,
                                      layer.id,
                                      {
                                        strokeWidth: Math.max(
                                          0,
                                          Number(event.target.value) || 0,
                                        ),
                                      },
                                    ),
                                  } as Partial<typeof item>)}
                                  className={fieldClassName}
                                />
                              </label>
                              <label>
                                <span className={labelClassName}>Radius</span>
                                <RemotionInput
                                  aria-label={`MG layer ${layer.id} corner radius`}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={layer.radius}
                                  onChange={(event) => updateItem({
                                    spec: updateMgLayer(
                                      parsedMgSpec.data,
                                      layer.id,
                                      {
                                        radius: Math.max(
                                          0,
                                          Number(event.target.value) || 0,
                                        ),
                                      },
                                    ),
                                  } as Partial<typeof item>)}
                                  className={fieldClassName}
                                />
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
                  {visibleMgLayers.length === 0 && (
                    <p className={`my-3 text-center text-stone-400 ${editorTypeClassName.control}`}>
                      No matching layers
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className={`m-0 text-stone-500 ${editorTypeClassName.control}`}>
                This composition is rendered by its declared runtime. Its source remains editable in the project workspace.
              </p>
            )}
          </div>
        )}

        {item.type === 'derived-overlay' && (
          <div className={inspectorSectionClassName}>
            <h3 className={sectionTitleClassName}>Derived Media</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <InspectorIdentityRow
                  label="Source asset"
                  value={(item as DerivedOverlayItem).sourceAssetId}
                />
                <InspectorIdentityRow
                  label="Derived asset"
                  value={(item as DerivedOverlayItem).derivedAssetId}
                />
              </div>
              <InspectorIdentityRow
                label="Derivation"
                value={(item as DerivedOverlayItem).derivation.kind}
              />
              {(item as DerivedOverlayItem).derivation.description && (
                <p className={`m-0 text-stone-500 ${editorTypeClassName.control}`}>
                  {(item as DerivedOverlayItem).derivation.description}
                </p>
              )}
            </div>
          </div>
        )}

        {item.type === 'sticker' && (
          <div className={inspectorSectionClassName}>
            <h3 className={sectionTitleClassName}>Sticker</h3>
            <InspectorIdentityRow
              label="Source"
              value={(item as StickerItem).src}
            />
          </div>
        )}

        {/* Source identity is deliberately read-only; trimming and fit are real
            edit operations above, while replacing an asset goes through Media. */}
        {(item.type === 'video'
          || item.type === 'image'
          || item.type === 'audio'
          || item.type === 'derived-overlay'
          || item.type === 'composition') && (
          <div className={inspectorSectionClassName}>
            <h3 className={sectionTitleClassName}>Source</h3>
            <InspectorIdentityRow
              label="File path"
              value={resolvedSource || 'Source unavailable'}
            />
          </div>
        )}
      </div>
    </div>
  );
};
