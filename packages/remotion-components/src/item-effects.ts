import type { CSSProperties } from 'react';
import {
  TIMELINE_SHARED_DEFAULTS,
  type EffectInstanceRef,
} from '@clash/remotion-core';
import {
  builtInEffectRegistry,
  computeEffectPresentation,
} from '@clash/remotion-effects';

export type ComputeItemEffectStyleOptions = {
  effects?: EffectInstanceRef[];
  frame: number;
  durationInFrames: number;
  width: number;
  height: number;
};

function appendStyleValue(
  current: CSSProperties,
  next: CSSProperties,
  property: 'transform' | 'filter',
): void {
  const currentValue = current[property];
  const nextValue = next[property];
  if (!nextValue) return;
  current[property] = [currentValue, nextValue].filter(Boolean).join(' ');
}

/**
 * Resolves the declarative effect stack stored on an item into a deterministic
 * Remotion style. Unknown packages are skipped so one missing optional effect
 * cannot make an otherwise valid timeline unrenderable.
 */
export function computeItemEffectStyle(
  options: ComputeItemEffectStyleOptions,
): CSSProperties {
  const effects = options.effects ?? TIMELINE_SHARED_DEFAULTS.itemBase.effects;
  if (effects.length === 0) return {};

  const progress = Math.min(
    1,
    Math.max(0, options.frame / Math.max(1, options.durationInFrames - 1)),
  );
  const merged: CSSProperties = {};

  for (const effect of effects) {
    try {
      const { definition, fallbackFrom } = builtInEffectRegistry.resolveForRenderer(
        effect.effectId,
        effect.effectVersion,
        'remotion',
      );
      if (definition.kind !== 'clip-effect') continue;
      const style = computeEffectPresentation({
        definition,
        params: fallbackFrom ? {} : effect.params ?? {},
        progress,
        frame: options.frame,
        width: options.width,
        height: options.height,
        role: 'from',
      }) as CSSProperties;

      appendStyleValue(merged, style, 'transform');
      appendStyleValue(merged, style, 'filter');
      for (const [key, value] of Object.entries(style)) {
        if (key === 'transform' || key === 'filter') continue;
        (merged as Record<string, unknown>)[key] = value;
      }
    } catch {
      // Installed effect packages are optional at document-open time. The
      // Inspector can surface the missing package while preview stays usable.
    }
  }

  return merged;
}
