import React, { useEffect, useMemo, useRef, useState } from 'react';

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
  ariaLabel?: string;
  className?: string;
  customDimensions?: AspectRatioDimensions;
  onValueChange: (value: T) => void;
  options: readonly AspectRatioOption<T>[];
  value: T;
}

const RATIO_PATTERN = /(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/;
const DIMENSION_PATTERN = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i;

const SEMANTIC_RATIO_PRESETS = [
  { label: 'Widescreen', ratio: 16 / 9, order: 10 },
  { label: 'Photo', ratio: 4 / 3, order: 20 },
  { label: 'Landscape', ratio: 3 / 2, order: 30 },
  { label: 'Square', ratio: 1, order: 40 },
  { label: 'Portrait', ratio: 3 / 4, order: 50 },
  { label: 'Tall', ratio: 2 / 3, order: 60 },
  { label: 'Phone', ratio: 9 / 16, order: 70 },
  { label: 'Social portrait', ratio: 4 / 5, order: 80 },
  { label: 'Photo landscape', ratio: 5 / 4, order: 90 },
  { label: 'Ultrawide', ratio: 21 / 9, order: 100 },
  { label: 'Panoramic', ratio: 2, order: 110 },
  { label: 'Wide banner', ratio: 4, order: 120 },
  { label: 'Tall banner', ratio: 1 / 4, order: 130 },
  { label: 'Superwide', ratio: 8, order: 140 },
  { label: 'Super tall', ratio: 1 / 8, order: 150 },
] as const;

interface PresentedPreset<T extends AspectRatioValue> {
  key: string;
  label: string;
  option: AspectRatioOption<T> | null;
  order: number;
}

export function parseAspectRatio(option: Pick<AspectRatioOption<AspectRatioValue>, 'label' | 'ratio' | 'value'>): number | null {
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

function ratioGlyphDimensions(ratio: number | null): { width: number; height: number } {
  const safeRatio = Math.min(2.4, Math.max(0.42, ratio ?? 1));
  if (safeRatio >= 1) return { width: 13, height: Math.max(6, 13 / safeRatio) };
  return { width: Math.max(6, 13 * safeRatio), height: 13 };
}

function previewDimensions(ratio: number): { width: number; height: number } {
  const safeRatio = Math.min(2.6, Math.max(0.38, ratio));
  if (safeRatio >= 1) return { width: 112, height: 112 / safeRatio };
  return { width: 112 * safeRatio, height: 112 };
}

function ratioParts(option: AspectRatioOption<AspectRatioValue> | undefined): [string, string] {
  if (!option) return ['1', '1'];
  for (const candidate of [option.label, String(option.value)]) {
    const match = candidate.match(RATIO_PATTERN) ?? candidate.match(DIMENSION_PATTERN);
    if (match) return [match[1], match[2]];
  }
  return ['1', '1'];
}

function optionKey(option: AspectRatioOption<AspectRatioValue>): string {
  return `option:${String(option.value)}`;
}

function semanticRatioPreset(ratio: number | null) {
  if (!ratio) return null;
  return SEMANTIC_RATIO_PRESETS.find((preset) => Math.abs(Math.log(ratio / preset.ratio)) < 0.025) ?? null;
}

export const AspectRatioPicker = <T extends AspectRatioValue>({
  ariaLabel = 'Aspect ratio',
  className = '',
  customDimensions,
  onValueChange,
  options,
  value,
}: AspectRatioPickerProps<T>) => {
  const selectedOption = options.find((option) => String(option.value) === String(value));
  const selectedOptionRatio = selectedOption ? parseAspectRatio(selectedOption) : null;
  const currentRatio = customDimensions
    ? customDimensions.width / Math.max(1, customDimensions.height)
    : selectedOptionRatio ?? 1;
  const preview = previewDimensions(currentRatio);
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; ratio: number } | null>(null);
  const numeratorRef = useRef<HTMLInputElement>(null);
  const initialPresetKey = selectedOption ? optionKey(selectedOption) : 'custom';
  const [selectedPresetKey, setSelectedPresetKey] = useState(initialPresetKey);
  const [draftRatio, setDraftRatio] = useState<[string, string]>(() => (
    customDimensions
      ? [String(customDimensions.width), String(customDimensions.height)]
      : ratioParts(selectedOption)
  ));
  const previousValue = useRef(String(value));

  useEffect(() => {
    const nextValue = String(value);
    if (previousValue.current === nextValue) return;
    previousValue.current = nextValue;
    setSelectedPresetKey(selectedOption ? optionKey(selectedOption) : 'custom');
    if (!customDimensions) setDraftRatio(ratioParts(selectedOption));
  }, [customDimensions, selectedOption, value]);

  useEffect(() => {
    if (!customDimensions) return;
    setDraftRatio([String(customDimensions.width), String(customDimensions.height)]);
  }, [customDimensions?.height, customDimensions?.width]);

  const numericOptions = useMemo(
    () => options
      .map((option) => ({ option, ratio: parseAspectRatio(option) }))
      .filter((entry): entry is { option: AspectRatioOption<T>; ratio: number } => entry.ratio !== null)
      .sort((left, right) => left.ratio - right.ratio),
    [options],
  );

  const presentedPresets = useMemo(() => {
    const result: PresentedPreset<T>[] = options.map((option, index) => {
      const identity = `${option.label} ${String(option.value)}`.toLowerCase();
      if (/\b(auto|adaptive)\b/.test(identity)) {
        return { key: optionKey(option), label: 'Auto', option, order: -100 + index / 100 };
      }
      if (/\bcustom\b/.test(identity)) {
        return { key: optionKey(option), label: 'Custom', option, order: 1000 + index };
      }
      const semantic = semanticRatioPreset(parseAspectRatio(option));
      return {
        key: optionKey(option),
        label: semantic?.label ?? option.label,
        option,
        order: (semantic?.order ?? 500) + index / 100,
      };
    });
    if (customDimensions && !result.some((preset) => preset.label === 'Custom')) {
      result.push({ key: 'custom', label: 'Custom', option: null, order: 1000 });
    }
    return result.sort((left, right) => left.order - right.order);
  }, [customDimensions, options]);

  const minimumRatio = Math.min(1 / 3, numericOptions[0]?.ratio ?? 1 / 3);
  const maximumRatio = Math.max(3, numericOptions[numericOptions.length - 1]?.ratio ?? 3);

  const commitRatio = (nextRatio: number) => {
    const safeRatio = Math.min(maximumRatio, Math.max(minimumRatio, nextRatio));
    const closest = closestAspectRatioOption(safeRatio, options);
    const closestRatio = closest ? parseAspectRatio(closest) : null;
    const exactPreset = closest && closestRatio && Math.abs(Math.log(safeRatio / closestRatio)) < 0.025
      ? closest
      : null;
    setSelectedPresetKey(exactPreset ? optionKey(exactPreset) : 'custom');
    if (customDimensions) {
      customDimensions.onChange({
        width: Math.max(1, Math.round(customDimensions.height * safeRatio)),
        height: Math.max(1, customDimensions.height),
      });
      return;
    }
    if (closest && String(closest.value) !== String(value)) onValueChange(closest.value);
  };

  const commitDraftRatio = () => {
    const numerator = Number(draftRatio[0]);
    const denominator = Number(draftRatio[1]);
    if (numerator > 0 && denominator > 0) commitRatio(numerator / denominator);
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
    const currentIndex = numericOptions.reduce((bestIndex, entry, index) => (
      Math.abs(Math.log(currentRatio / entry.ratio))
        < Math.abs(Math.log(currentRatio / numericOptions[bestIndex].ratio)) ? index : bestIndex
    ), 0);
    const nextIndex = Math.min(
      numericOptions.length - 1,
      Math.max(0, currentIndex + (increases ? 1 : -1)),
    );
    const next = numericOptions[nextIndex]?.option;
    if (next && String(next.value) !== String(value)) onValueChange(next.value);
  };

  const choosePreset = (preset: PresentedPreset<T>) => {
    setSelectedPresetKey(preset.key);
    if (!preset.option) {
      queueMicrotask(() => numeratorRef.current?.focus());
      return;
    }
    if (String(preset.option.value) !== String(value)) onValueChange(preset.option.value);
    setDraftRatio(ratioParts(preset.option));
  };

  return (
    <div className={`[container-type:inline-size] ${className}`} aria-label={ariaLabel} data-aspect-ratio-layout="reference">
      <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-5">
        <div className="grid content-start grid-cols-2 gap-x-3 gap-y-1" role="group" aria-label={`${ariaLabel} presets`}>
          {presentedPresets.map((preset) => {
            const optionRatio = preset.option ? parseAspectRatio(preset.option) : currentRatio;
            const glyph = ratioGlyphDimensions(optionRatio);
            const selected = selectedPresetKey === preset.key;
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={selected}
                aria-label={preset.option?.label ?? preset.label}
                title={preset.option?.description}
                onClick={() => choosePreset(preset)}
                className={`flex h-10 items-center gap-2.5 rounded-md px-3 text-left text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 ${selected
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
                <span className="truncate">{preset.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-3">
          <div
            aria-label="Aspect ratio preview"
            data-ratio={String(currentRatio)}
            className="relative flex h-36 w-36 items-center justify-center bg-[radial-gradient(circle,var(--color-warm-border)_1px,transparent_1px)] [background-size:6px_6px]"
          >
            <div
              className="relative overflow-visible border border-content-muted/65 bg-[linear-gradient(155deg,#f2f1f1_2%,#ececed_48%,#70d9f2_76%,#d15ede_100%)] shadow-sm"
              style={{ width: preview.width, height: preview.height }}
            >
              {(['-left-1 -top-1', '-right-1 -top-1', '-left-1 -bottom-1'] as const).map((position) => (
                <span
                  key={position}
                  aria-hidden
                  className={`absolute ${position} h-2 w-2 rounded-full border border-content-muted bg-[#ededed] shadow-sm`}
                />
              ))}
              <button
                type="button"
                role="slider"
                aria-label="Adjust aspect ratio"
                aria-valuemin={Number(minimumRatio.toFixed(3))}
                aria-valuemax={Number(maximumRatio.toFixed(3))}
                aria-valuenow={Number(currentRatio.toFixed(3))}
                onKeyDown={handleKeyDown}
                onPointerDown={(event) => {
                  dragOrigin.current = {
                    pointerX: event.clientX,
                    pointerY: event.clientY,
                    ratio: currentRatio,
                  };
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const origin = dragOrigin.current;
                  if (!origin) return;
                  const delta = (event.clientX - origin.pointerX) - (event.clientY - origin.pointerY);
                  commitRatio(origin.ratio * Math.exp(delta / 72));
                }}
                onPointerUp={(event) => {
                  dragOrigin.current = null;
                  event.currentTarget.releasePointerCapture?.(event.pointerId);
                }}
                onPointerCancel={() => { dragOrigin.current = null; }}
                className="absolute -bottom-1 -right-1 h-2 w-2 cursor-nwse-resize rounded-full border border-content-muted bg-[#ededed] shadow-sm outline-none transition-transform hover:scale-125 focus-visible:ring-2 focus-visible:ring-brand/35"
              />
            </div>
          </div>

          <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
            <input
              ref={numeratorRef}
              aria-label={customDimensions ? 'Aspect ratio width' : 'Aspect ratio numerator'}
              type="number"
              min={1}
              step={1}
              value={customDimensions ? customDimensions.width : draftRatio[0]}
              onChange={(event) => {
                if (customDimensions) {
                  customDimensions.onChange({ width: Math.max(1, Number.parseInt(event.target.value, 10) || 1), height: customDimensions.height });
                } else {
                  setSelectedPresetKey('custom');
                  setDraftRatio([event.target.value, draftRatio[1]]);
                }
              }}
              onBlur={customDimensions ? undefined : commitDraftRatio}
              onKeyDown={customDimensions ? undefined : (event) => { if (event.key === 'Enter') commitDraftRatio(); }}
              className="h-10 min-w-0 rounded-lg border border-transparent bg-warm-muted px-2 text-center text-[13px] tabular-nums text-content-primary outline-none focus:border-warm-border focus:ring-1 focus:ring-content-muted/25"
            />
            <span className="text-xs font-medium text-content-muted" aria-hidden>:</span>
            <input
              aria-label={customDimensions ? 'Aspect ratio height' : 'Aspect ratio denominator'}
              type="number"
              min={1}
              step={1}
              value={customDimensions ? customDimensions.height : draftRatio[1]}
              onChange={(event) => {
                if (customDimensions) {
                  customDimensions.onChange({ width: customDimensions.width, height: Math.max(1, Number.parseInt(event.target.value, 10) || 1) });
                } else {
                  setSelectedPresetKey('custom');
                  setDraftRatio([draftRatio[0], event.target.value]);
                }
              }}
              onBlur={customDimensions ? undefined : commitDraftRatio}
              onKeyDown={customDimensions ? undefined : (event) => { if (event.key === 'Enter') commitDraftRatio(); }}
              className="h-10 min-w-0 rounded-lg border border-transparent bg-warm-muted px-2 text-center text-[13px] tabular-nums text-content-primary outline-none focus:border-warm-border focus:ring-1 focus:ring-content-muted/25"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
