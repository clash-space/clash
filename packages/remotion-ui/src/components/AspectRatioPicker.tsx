import React, { useEffect, useMemo, useRef, useState } from 'react';
import { aspectRatioLabel } from '@clash/shared-types';

import { useDragGesture } from './ui/gesture';
import { Tooltip } from './ui/tooltip';

export type AspectRatioValue = string | number;

export interface AspectRatioOption<T extends AspectRatioValue = string> {
  value: T;
  label: string;
  description?: string;
  ratio?: number;
}

export interface AspectRatioDimensions {
  width: number;
  height: number;
  onChange: (dimensions: { width: number; height: number }) => void;
}

export interface AspectRatioPickerProps<T extends AspectRatioValue = string> {
  allowCustom?: boolean;
  ariaLabel?: string;
  className?: string;
  customDimensions?: AspectRatioDimensions;
  density?: 'comfortable' | 'compact';
  onValueChange: (value: T) => void;
  options: readonly AspectRatioOption<T>[];
  value: T;
}

const RATIO_PATTERN = /(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/;
const DIMENSION_PATTERN = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i;
const COMPACT_PRESET_HINT_MIN_WIDTH = 208;

const SEMANTIC_RATIO_PRESETS = [
  { label: '16:9', ratio: 16 / 9, order: 10 },
  { label: '4:3', ratio: 4 / 3, order: 20 },
  { label: '3:2', ratio: 3 / 2, order: 30 },
  { label: '1:1', ratio: 1, order: 40 },
  { label: '3:4', ratio: 3 / 4, order: 50 },
  { label: '2:3', ratio: 2 / 3, order: 60 },
  { label: '9:16', ratio: 9 / 16, order: 70 },
  { label: '4:5', ratio: 4 / 5, order: 80 },
  { label: '5:4', ratio: 5 / 4, order: 90 },
  { label: '21:9', ratio: 21 / 9, order: 100 },
  { label: '2:1', ratio: 2, order: 110 },
  { label: '4:1', ratio: 4, order: 120 },
  { label: '1:4', ratio: 1 / 4, order: 130 },
  { label: '8:1', ratio: 8, order: 140 },
  { label: '1:8', ratio: 1 / 8, order: 150 },
] as const;

interface PresentedPreset<T extends AspectRatioValue> {
  key: string;
  label: string;
  option: AspectRatioOption<T> | null;
  order: number;
}

export function parseAspectRatio(
  option: Pick<AspectRatioOption<AspectRatioValue>, 'label' | 'ratio' | 'value'>,
): number | null {
  if (typeof option.ratio === 'number' && Number.isFinite(option.ratio) && option.ratio > 0) {
    return option.ratio;
  }
  for (const candidate of [option.label, String(option.value)]) {
    const match = candidate.match(RATIO_PATTERN) ?? candidate.match(DIMENSION_PATTERN);
    if (!match) continue;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width > 0 && height > 0) return width / height;
  }
  return null;
}

export function closestAspectRatioOption<T extends AspectRatioValue>(
  ratio: number,
  options: readonly AspectRatioOption<T>[],
): AspectRatioOption<T> | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  let closest: AspectRatioOption<T> | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const optionRatio = parseAspectRatio(option);
    if (!optionRatio) continue;
    const distance = Math.abs(Math.log(ratio / optionRatio));
    if (distance < closestDistance) {
      closest = option;
      closestDistance = distance;
    }
  }
  return closest;
}

function ratioGlyphDimensions(ratio: number | null): {
  width: number;
  height: number;
} {
  const safeRatio = Math.min(2.4, Math.max(0.42, ratio ?? 1));
  if (safeRatio >= 1) return { width: 13, height: Math.max(6, 13 / safeRatio) };
  return { width: Math.max(6, 13 * safeRatio), height: 13 };
}

function previewDimensions(ratio: number, maximumExtent = 112): { width: number; height: number } {
  const safeRatio = Math.min(2.6, Math.max(0.38, ratio));
  if (safeRatio >= 1) return { width: maximumExtent, height: maximumExtent / safeRatio };
  return { width: maximumExtent * safeRatio, height: maximumExtent };
}

function ratioParts(option: AspectRatioOption<AspectRatioValue> | undefined): [string, string] {
  if (!option) return ['1', '1'];
  for (const candidate of [option.label, String(option.value)]) {
    const match = candidate.match(RATIO_PATTERN) ?? candidate.match(DIMENSION_PATTERN);
    if (match) return [match[1], match[2]];
  }
  return ['1', '1'];
}

function compactRatioParts(ratio: number): [string, string] {
  let bestWidth = Math.max(1, Math.round(ratio));
  let bestHeight = 1;
  let bestError = Math.abs(bestWidth / bestHeight - ratio);
  for (let height = 1; height <= 100; height += 1) {
    const width = Math.max(1, Math.round(ratio * height));
    const error = Math.abs(width / height - ratio);
    if (error / ratio <= 0.005) {
      return aspectRatioLabel({ width, height }).split(':') as [string, string];
    }
    if (error < bestError - Number.EPSILON) {
      bestWidth = width;
      bestHeight = height;
      bestError = error;
    }
  }
  return aspectRatioLabel({ width: bestWidth, height: bestHeight }).split(':') as [string, string];
}

function optionKey(option: AspectRatioOption<AspectRatioValue>): string {
  return `option:${String(option.value)}`;
}

function aspectRatiosMatch(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= Number.EPSILON * scale * 4;
}

function exactAspectRatioOption<T extends AspectRatioValue>(
  ratio: number,
  options: readonly AspectRatioOption<T>[],
): AspectRatioOption<T> | null {
  return options.find((option) => {
    const optionRatio = parseAspectRatio(option);
    return optionRatio !== null && aspectRatiosMatch(ratio, optionRatio);
  }) ?? null;
}

function dimensionRatioParts(dimensions: Pick<AspectRatioDimensions, 'height' | 'width'>): [string, string] {
  return aspectRatioLabel(dimensions).split(':') as [string, string];
}

function semanticRatioPreset(ratio: number | null) {
  if (!ratio) return null;
  return SEMANTIC_RATIO_PRESETS.find((preset) => Math.abs(Math.log(ratio / preset.ratio)) < 0.025) ?? null;
}

function canonicalRatioLabel(option: AspectRatioOption<AspectRatioValue>): string {
  for (const candidate of [option.label, String(option.value)]) {
    const ratioMatch = candidate.match(RATIO_PATTERN);
    if (ratioMatch) return `${ratioMatch[1]}:${ratioMatch[2]}`;
    const dimensionMatch = candidate.match(DIMENSION_PATTERN);
    if (dimensionMatch) {
      return aspectRatioLabel({
        width: Number(dimensionMatch[1]),
        height: Number(dimensionMatch[2]),
      });
    }
  }
  return semanticRatioPreset(parseAspectRatio(option))?.label ?? option.label;
}

type RatioCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const CORNER_PRESENTATION: Record<
  RatioCorner,
  {
    className: string;
    cursor: string;
    horizontalSign: number;
    verticalSign: number;
  }
> = {
  'top-left': {
    className: '-left-2.5 -top-2.5',
    cursor: 'cursor-nwse-resize',
    horizontalSign: -1,
    verticalSign: 1,
  },
  'top-right': {
    className: '-right-2.5 -top-2.5',
    cursor: 'cursor-nesw-resize',
    horizontalSign: 1,
    verticalSign: 1,
  },
  'bottom-left': {
    className: '-bottom-2.5 -left-2.5',
    cursor: 'cursor-nesw-resize',
    horizontalSign: -1,
    verticalSign: -1,
  },
  'bottom-right': {
    className: '-bottom-2.5 -right-2.5',
    cursor: 'cursor-nwse-resize',
    horizontalSign: 1,
    verticalSign: -1,
  },
};

function AspectRatioDragHandle({
  corner,
  currentRatio,
  maximumRatio,
  minimumRatio,
  onKeyDown,
  onRatioChange,
}: {
  corner: RatioCorner;
  currentRatio: number;
  maximumRatio: number;
  minimumRatio: number;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onRatioChange: (ratio: number, phase: 'cancel' | 'commit' | 'preview') => void;
}) {
  const originRatio = useRef(currentRatio);
  const presentation = CORNER_PRESENTATION[corner];
  const bindResize = useDragGesture<PointerEvent>(
    ({ canceled, event, first, last, movement: [x, y] }) => {
      event.preventDefault();
      event.stopPropagation();
      if (first) originRatio.current = currentRatio;
      const delta = x * presentation.horizontalSign + y * presentation.verticalSign;
      const ratio = originRatio.current * Math.exp(delta / 72);
      onRatioChange(
        Math.min(maximumRatio, Math.max(minimumRatio, ratio)),
        canceled ? 'cancel' : last ? 'commit' : 'preview',
      );
    },
    {
      eventOptions: { passive: false },
      pointer: { capture: false },
    },
  );

  const label =
    corner === 'bottom-right' ? 'Adjust aspect ratio' : `Adjust aspect ratio from ${corner.replace('-', ' ')}`;

  return (
    <button
      type="button"
      role="slider"
      aria-label={label}
      aria-valuemin={Number(minimumRatio.toFixed(3))}
      aria-valuemax={Number(maximumRatio.toFixed(3))}
      aria-valuenow={Number(currentRatio.toFixed(3))}
      onKeyDown={onKeyDown}
      className={`absolute ${presentation.className} ${presentation.cursor} grid h-5 w-5 touch-none place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/35`}
      {...bindResize()}
    >
      <span className="block h-2 w-2 rounded-full border border-content-muted bg-[#ededed] shadow-sm transition-transform hover:scale-125" />
    </button>
  );
}

export const AspectRatioPicker = <T extends AspectRatioValue>({
  allowCustom = false,
  ariaLabel = 'Aspect ratio',
  className = '',
  customDimensions,
  density = 'comfortable',
  onValueChange,
  options,
  value,
}: AspectRatioPickerProps<T>) => {
  const compact = density === 'compact';
  const selectedOption = options.find((option) => String(option.value) === String(value));
  const selectedValueOption = useMemo(() => selectedOption ?? { value, label: String(value) }, [selectedOption, value]);
  const selectedOptionRatio = parseAspectRatio(selectedValueOption);
  const selectedIdentity = `${selectedValueOption.label} ${String(selectedValueOption.value)}`.toLowerCase();
  const automatic = /\b(auto|adaptive)\b/.test(selectedIdentity) && selectedOptionRatio === null;
  const currentRatio = customDimensions
    ? customDimensions.width / Math.max(1, customDimensions.height)
    : (selectedOptionRatio ?? 1);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const displayedRatio = dragRatio ?? currentRatio;
  const preview = previewDimensions(displayedRatio, compact ? 80 : 112);
  const pickerRef = useRef<HTMLDivElement>(null);
  const numeratorRef = useRef<HTMLInputElement>(null);
  const [showCompactPresetHints, setShowCompactPresetHints] = useState(false);
  const initialSelectedPreset = customDimensions
    ? exactAspectRatioOption(currentRatio, options)
    : selectedOption;
  const [selectedPresetKey, setSelectedPresetKey] = useState<string | null>(
    initialSelectedPreset ? optionKey(initialSelectedPreset) : null,
  );
  const [draftRatio, setDraftRatio] = useState<[string, string]>(() =>
    customDimensions
      ? dimensionRatioParts(customDimensions)
      : ratioParts(selectedValueOption),
  );
  const previousValue = useRef(String(value));

  useEffect(() => {
    if (!compact) return;
    const picker = pickerRef.current;
    if (!picker) return;

    const updateVisibility = (width: number) => {
      const visible = width >= COMPACT_PRESET_HINT_MIN_WIDTH;
      setShowCompactPresetHints((current) => current === visible ? current : visible);
    };

    updateVisibility(picker.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? picker.getBoundingClientRect().width;
      updateVisibility(width);
    });
    observer.observe(picker);
    return () => observer.disconnect();
  }, [compact]);

  useEffect(() => {
    const nextValue = String(value);
    if (previousValue.current === nextValue) return;
    previousValue.current = nextValue;
    if (customDimensions) return;
    setSelectedPresetKey(selectedOption ? optionKey(selectedOption) : null);
    if (!customDimensions) setDraftRatio(ratioParts(selectedValueOption));
  }, [customDimensions, selectedOption, selectedValueOption, value]);

  useEffect(() => {
    if (!customDimensions) return;
    const nextDraftRatio = dimensionRatioParts(customDimensions);
    setDraftRatio((current) => (
      current[0] === nextDraftRatio[0] && current[1] === nextDraftRatio[1]
        ? current
        : nextDraftRatio
    ));
    const exactPreset = exactAspectRatioOption(currentRatio, options);
    setSelectedPresetKey(exactPreset ? optionKey(exactPreset) : null);
  }, [currentRatio, customDimensions, options]);

  const numericOptions = useMemo(
    () =>
      options
        .map((option) => ({ option, ratio: parseAspectRatio(option) }))
        .filter((entry): entry is { option: AspectRatioOption<T>; ratio: number } => entry.ratio !== null)
        .sort((left, right) => left.ratio - right.ratio),
    [options],
  );

  const presentedPresets = useMemo(() => {
    const result: PresentedPreset<T>[] = options.map((option, index) => {
      const identity = `${option.label} ${String(option.value)}`.toLowerCase();
      if (/\b(auto|adaptive)\b/.test(identity)) {
        return {
          key: optionKey(option),
          label: 'Auto',
          option,
          order: -100 + index / 100,
        };
      }
      if (/\bcustom\b/.test(identity)) {
        return {
          key: optionKey(option),
          label: 'Custom',
          option,
          order: 1000 + index,
        };
      }
      const semantic = semanticRatioPreset(parseAspectRatio(option));
      return {
        key: optionKey(option),
        label: canonicalRatioLabel(option),
        option,
        order: (semantic?.order ?? 500) + index / 100,
      };
    });
    if ((customDimensions || allowCustom) && !result.some((preset) => preset.label === 'Custom')) {
      result.push({
        key: 'custom',
        label: 'Custom',
        option: null,
        order: 1000,
      });
    }
    return result.sort((left, right) => left.order - right.order);
  }, [allowCustom, customDimensions, options]);

  const minimumRatio = Math.min(allowCustom ? 1 / 8 : 1 / 3, numericOptions[0]?.ratio ?? 1 / 3);
  const maximumRatio = Math.max(allowCustom ? 8 : 3, numericOptions[numericOptions.length - 1]?.ratio ?? 3);

  const commitRatio = (nextRatio: number) => {
    const safeRatio = Math.min(maximumRatio, Math.max(minimumRatio, nextRatio));
    const nextDimensions = customDimensions
      ? {
          width: Math.max(1, Math.round(customDimensions.height * safeRatio)),
          height: Math.max(1, customDimensions.height),
        }
      : null;
    const committedRatio = nextDimensions ? nextDimensions.width / nextDimensions.height : safeRatio;
    const closest = closestAspectRatioOption(committedRatio, options);
    const closestRatio = closest ? parseAspectRatio(closest) : null;
    const exactPreset = closest && closestRatio && aspectRatiosMatch(committedRatio, closestRatio) ? closest : null;
    if (customDimensions) {
      setSelectedPresetKey(exactPreset ? optionKey(exactPreset) : null);
      customDimensions.onChange(nextDimensions!);
      return;
    }
    if (exactPreset) {
      setSelectedPresetKey(optionKey(exactPreset));
      setDraftRatio(ratioParts(exactPreset));
      if (String(exactPreset.value) !== String(value)) onValueChange(exactPreset.value);
      return;
    }
    if (allowCustom) {
      const parts = compactRatioParts(safeRatio);
      const customValue = `${parts[0]}:${parts[1]}` as T;
      setSelectedPresetKey(null);
      setDraftRatio(parts);
      if (String(customValue) !== String(value)) onValueChange(customValue);
      return;
    }
    if (closest) {
      setSelectedPresetKey(optionKey(closest));
      setDraftRatio(ratioParts(closest));
      if (String(closest.value) !== String(value)) onValueChange(closest.value);
    }
  };

  const commitDraftRatio = () => {
    const numerator = Number(draftRatio[0]);
    const denominator = Number(draftRatio[1]);
    if (numerator > 0 && denominator > 0) commitRatio(numerator / denominator);
  };

  const handleDraggedRatio = (
    nextRatio: number,
    phase: 'cancel' | 'commit' | 'preview',
  ) => {
    if (!customDimensions) {
      if (phase !== 'cancel') commitRatio(nextRatio);
      return;
    }

    if (phase === 'cancel') {
      setDragRatio(null);
      setDraftRatio(dimensionRatioParts(customDimensions));
      const exactPreset = exactAspectRatioOption(currentRatio, options);
      setSelectedPresetKey(exactPreset ? optionKey(exactPreset) : null);
      return;
    }

    if (phase === 'commit') {
      setDragRatio(null);
      commitRatio(nextRatio);
      return;
    }

    const safeRatio = Math.min(maximumRatio, Math.max(minimumRatio, nextRatio));
    const previewDimensions = {
      width: Math.max(1, Math.round(customDimensions.height * safeRatio)),
      height: Math.max(1, customDimensions.height),
    };
    const previewRatio = previewDimensions.width / previewDimensions.height;
    const exactPreset = exactAspectRatioOption(previewRatio, options);
    setDragRatio(previewRatio);
    setDraftRatio(dimensionRatioParts(previewDimensions));
    setSelectedPresetKey(exactPreset ? optionKey(exactPreset) : null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const increases = event.key === 'ArrowRight' || event.key === 'ArrowUp';
    if (customDimensions) {
      commitRatio(currentRatio * (increases ? 1.1 : 1 / 1.1));
      return;
    }
    if (numericOptions.length === 0) return;
    const currentIndex = numericOptions.reduce(
      (bestIndex, entry, index) =>
        Math.abs(Math.log(currentRatio / entry.ratio)) <
        Math.abs(Math.log(currentRatio / numericOptions[bestIndex].ratio))
          ? index
          : bestIndex,
      0,
    );
    const nextIndex = Math.min(numericOptions.length - 1, Math.max(0, currentIndex + (increases ? 1 : -1)));
    const next = numericOptions[nextIndex]?.option;
    if (next && String(next.value) !== String(value)) onValueChange(next.value);
  };

  const choosePreset = (preset: PresentedPreset<T>) => {
    if (!preset.option) {
      setSelectedPresetKey(null);
      queueMicrotask(() => numeratorRef.current?.focus());
      return;
    }
    setSelectedPresetKey(preset.key);
    if (String(preset.option.value) !== String(value)) onValueChange(preset.option.value);
    setDraftRatio(ratioParts(preset.option));
  };

  return (
    <div
      ref={pickerRef}
      className={`[container-type:inline-size] ${className}`}
      aria-label={ariaLabel}
      data-aspect-ratio-density={density}
      data-aspect-ratio-layout="reference"
      data-aspect-ratio-mode={automatic ? 'automatic' : 'editable'}
      data-compact-preset-hints={showCompactPresetHints ? 'visible' : 'hidden'}
    >
      <div
        data-aspect-ratio-content=""
        className={`grid ${
          automatic
            ? 'grid-cols-1'
            : compact
              ? 'grid-cols-[minmax(0,1fr)_4rem] gap-2 @min-[15rem]:grid-cols-[minmax(0,1fr)_6rem] @min-[24rem]:grid-cols-[minmax(0,1fr)_10rem] @min-[24rem]:gap-4'
              : 'grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-5'
        }`}
      >
        <div
          className={`grid content-start grid-cols-2 ${compact ? 'gap-1 @min-[15rem]:gap-x-2' : 'gap-x-3 gap-y-1'}`}
          role="group"
          aria-label={`${ariaLabel} presets`}
        >
          {presentedPresets.map((preset) => {
            const optionRatio = preset.option ? parseAspectRatio(preset.option) : null;
            const glyph = ratioGlyphDimensions(optionRatio);
            const selected = selectedPresetKey === preset.key;
            const button = (
              <button
                type="button"
                aria-pressed={selected}
                aria-label={preset.label}
                onClick={() => choosePreset(preset)}
                className={`flex items-center rounded-md text-left font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 ${compact ? showCompactPresetHints ? 'h-7 w-full justify-start gap-1 px-1 text-[11px]' : 'h-7 w-7 justify-self-start justify-center px-0 text-[11px]' : 'h-10 gap-2.5 px-3 text-[12px]'} ${
                  selected
                    ? 'bg-warm-hover text-content-primary'
                    : 'text-content-secondary hover:bg-warm-muted hover:text-content-primary'
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                  <span
                    className={`block rounded-[1px] border ${selected ? 'border-content-primary/80' : 'border-content-muted/75'}`}
                    style={{ width: glyph.width, height: glyph.height }}
                  />
                </span>
                <span className={compact && !showCompactPresetHints ? 'hidden whitespace-nowrap' : 'whitespace-nowrap'}>{preset.label}</span>
              </button>
            );
            return compact ? (
              <Tooltip key={preset.key} label={preset.label}>
                {button}
              </Tooltip>
            ) : (
              <React.Fragment key={preset.key}>{button}</React.Fragment>
            );
          })}
        </div>

        {!automatic ? (
          <div
            data-aspect-ratio-editor=""
            className={`flex w-full min-w-0 justify-self-center flex-col items-center ${compact ? 'max-w-16 gap-1.5 [--aspect-ratio-preview-extent:3rem] @min-[15rem]:max-w-24 @min-[15rem]:gap-2 @min-[15rem]:[--aspect-ratio-preview-extent:4.5rem] @min-[24rem]:max-w-40 @min-[24rem]:[--aspect-ratio-preview-extent:7rem]' : 'max-w-56 gap-3'}`}
          >
              <div
                aria-label="Aspect ratio preview"
                data-ratio={String(displayedRatio)}
                className={`relative flex items-center justify-center bg-[radial-gradient(circle,var(--color-warm-border)_1px,transparent_1px)] [background-size:6px_6px] ${compact ? 'h-16 w-16 @min-[15rem]:h-20 @min-[15rem]:w-24 @min-[24rem]:h-28 @min-[24rem]:w-40' : 'h-36 w-36'}`}
              >
                <div
                  className="relative overflow-visible border border-content-muted/65 bg-[linear-gradient(155deg,#f2f1f1_2%,#ececed_48%,#70d9f2_76%,#d15ede_100%)] shadow-sm"
                  style={
                    compact
                      ? displayedRatio >= 1
                        ? {
                            width: 'var(--aspect-ratio-preview-extent)',
                            aspectRatio: displayedRatio,
                          }
                        : {
                            height: 'var(--aspect-ratio-preview-extent)',
                            aspectRatio: displayedRatio,
                          }
                      : { width: preview.width, height: preview.height }
                  }
                >
                  {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => (
                    <AspectRatioDragHandle
                      key={corner}
                      corner={corner}
                      currentRatio={displayedRatio}
                      minimumRatio={minimumRatio}
                      maximumRatio={maximumRatio}
                      onKeyDown={handleKeyDown}
                      onRatioChange={handleDraggedRatio}
                    />
                  ))}
                </div>
              </div>

              <div
                data-aspect-ratio-dimensions=""
                className={`w-full items-center ${compact ? 'flex flex-row gap-1' : 'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2'}`}
              >
                <label
                  className={
                    compact
                      ? 'block w-full min-w-0 @min-[24rem]:flex-1'
                      : 'contents'
                  }
                >
                  <input
                    ref={numeratorRef}
                    aria-label="Aspect ratio numerator"
                    type="number"
                    min={1}
                    step={1}
                    value={draftRatio[0]}
                    onChange={(event) => {
                      setSelectedPresetKey(null);
                      setDraftRatio([event.target.value, draftRatio[1]]);
                    }}
                    onBlur={commitDraftRatio}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitDraftRatio();
                    }}
                    className={`${compact ? 'h-7 w-full rounded-[var(--clash-workbench-control-radius)] px-1 text-[11px] @min-[15rem]:h-8 @min-[15rem]:text-[12px]' : 'h-10 rounded-lg px-2 text-[13px]'} min-w-0 appearance-none border border-transparent bg-warm-muted text-center tabular-nums text-content-primary outline-none [-moz-appearance:textfield] focus:border-warm-border focus:ring-1 focus:ring-content-muted/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                  />
                </label>
                <span
                  className="text-xs font-medium text-content-muted"
                  aria-hidden
                >
                  :
                </span>
                <label
                  className={
                    compact
                      ? 'block w-full min-w-0 @min-[24rem]:flex-1'
                      : 'contents'
                  }
                >
                  <input
                    aria-label="Aspect ratio denominator"
                    type="number"
                    min={1}
                    step={1}
                    value={draftRatio[1]}
                    onChange={(event) => {
                      setSelectedPresetKey(null);
                      setDraftRatio([draftRatio[0], event.target.value]);
                    }}
                    onBlur={commitDraftRatio}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitDraftRatio();
                    }}
                    className={`${compact ? 'h-7 w-full rounded-[var(--clash-workbench-control-radius)] px-1 text-[11px] @min-[15rem]:h-8 @min-[15rem]:text-[12px]' : 'h-10 rounded-lg px-2 text-[13px]'} min-w-0 appearance-none border border-transparent bg-warm-muted text-center tabular-nums text-content-primary outline-none [-moz-appearance:textfield] focus:border-warm-border focus:ring-1 focus:ring-content-muted/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                  />
                </label>
              </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
