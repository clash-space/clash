import {
  MgAnimationSchema,
  MgCompositionSpecSchema,
  MgShapeLayerSchema,
  MgTextLayerSchema,
  TIMELINE_DSL_FIELD_ANNOTATIONS,
  TIMELINE_DSL_ITEM_TYPES,
} from '@clash/shared-types';
import { describe, expect, it } from 'vitest';
import { TIMELINE_SHARED_DEFAULTS } from '@master-clash/remotion-core';
import * as components from './index';

type Classification = {
  consumers: readonly string[];
  note: string;
};
type ConsumerRegistry = Record<string, Record<string, Classification>>;

const registry = (
  components as unknown as { TIMELINE_RENDER_FIELD_CONSUMERS?: ConsumerRegistry }
).TIMELINE_RENDER_FIELD_CONSUMERS ?? {};
const rootTrackRegistry = (
  components as unknown as {
    TIMELINE_RENDER_ROOT_TRACK_FIELD_CONSUMERS?: ConsumerRegistry;
  }
).TIMELINE_RENDER_ROOT_TRACK_FIELD_CONSUMERS ?? {};

describe('renderer Timeline field consumer gate', () => {
  it('classifies every root and track field, including fields without defaults', () => {
    for (const scope of ['root', 'track'] as const) {
      expect(Object.keys(rootTrackRegistry[scope] ?? {}).sort(), scope).toEqual(
        Object.keys(TIMELINE_DSL_FIELD_ANNOTATIONS[scope]).sort(),
      );
    }
  });

  it('records root and track renderer behavior instead of treating persistence as output', () => {
    expect(rootTrackRegistry.root?.tracks?.consumers).toContain('rendered');
    expect(rootTrackRegistry.root?.primaryTrackId?.consumers).toContain('unsupported');
    expect(rootTrackRegistry.root?.assetTranscripts?.consumers).toContain('persistence');
    expect(rootTrackRegistry.root?.mediaAssetRefs?.consumers).toContain('meta');
    expect(rootTrackRegistry.track?.role?.consumers).toContain('rendered');
    expect(rootTrackRegistry.track?.category?.consumers).toContain('unsupported');
    expect(rootTrackRegistry.track?.items?.consumers).toContain('rendered');
    expect(rootTrackRegistry.track?.hidden?.consumers).toContain('rendered');
    expect(rootTrackRegistry.track?.locked?.consumers).toContain('unsupported');
  });

  it('classifies every base and variant field for every item type', () => {
    for (const itemType of TIMELINE_DSL_ITEM_TYPES) {
      const expectedFields = [
        ...Object.keys(TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase),
        ...Object.keys(TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes[itemType]),
      ].sort();
      expect(Object.keys(registry[itemType] ?? {}).sort(), itemType).toEqual(expectedFields);
    }
  });

  it('uses only explicit, non-empty classifications with an audit note', () => {
    const allowedKinds = new Set([
      'rendered',
      'editor',
      'meta',
      'persistence',
      'future',
      'unsupported',
    ]);
    for (const [itemType, fields] of Object.entries(registry)) {
      for (const [field, classification] of Object.entries(fields)) {
        expect(classification.consumers.length, `${itemType}.${field}`).toBeGreaterThan(0);
        expect(classification.note.trim().length, `${itemType}.${field}`).toBeGreaterThan(0);
        expect(
          classification.consumers.every((kind) => allowedKinds.has(kind)),
          `${itemType}.${field}`,
        ).toBe(true);
      }
    }
  });

  it('turns every preview/render annotation into an honest renderer disposition', () => {
    const rendererDispositions = new Set(['rendered', 'meta', 'future', 'unsupported']);
    for (const itemType of TIMELINE_DSL_ITEM_TYPES) {
      const annotations = {
        ...TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase,
        ...TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes[itemType],
      };
      for (const [field, annotation] of Object.entries(annotations)) {
        if (!annotation.runtimeConsumers.some(
          (consumer: string) => consumer === 'preview' || consumer === 'render',
        )) {
          continue;
        }
        expect(
          registry[itemType]?.[field]?.consumers.some((kind) => rendererDispositions.has(kind)),
          `${itemType}.${field}`,
        ).toBe(true);
      }
    }
  });

  it('records known non-pixel fields and unsupported renderer paths instead of implying support', () => {
    expect(registry.video?.waveform?.consumers).toContain('meta');
    expect(registry.text?.language?.consumers).toContain('meta');
    expect(registry.sticker?.sequence?.consumers).toContain('future');
    expect(registry.audio?.properties?.consumers).toContain('unsupported');
    expect(registry.transition?.keyframes?.consumers).toContain('unsupported');
    expect(registry.composition?.sourcePath?.consumers).toContain('unsupported');
    expect(registry.composition?.spec?.consumers).toContain('rendered');
    expect(registry.composition?.renderedAssetPath?.consumers).toContain('rendered');
    expect(registry['derived-overlay']?.derivation?.consumers).toContain('meta');
  });

  it('keeps transition content support aligned with semantic validation', () => {
    const supportedTypes = (
      components as unknown as { TIMELINE_TRANSITION_RENDER_ITEM_TYPES?: readonly string[] }
    ).TIMELINE_TRANSITION_RENDER_ITEM_TYPES ?? [];
    expect(supportedTypes).toEqual(['video', 'image', 'solid', 'text']);
  });

  it('audits the stripped transition-content renderer separately from normal clip rendering', () => {
    const transitionRegistry = (
      components as unknown as {
        TIMELINE_TRANSITION_CONTENT_FIELD_CONSUMERS?: ConsumerRegistry;
      }
    ).TIMELINE_TRANSITION_CONTENT_FIELD_CONSUMERS ?? {};
    for (const itemType of ['video', 'image', 'solid', 'text'] as const) {
      expect(Object.keys(transitionRegistry[itemType] ?? {}).sort()).toEqual([
        ...Object.keys(TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase),
        ...Object.keys(TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes[itemType]),
      ].sort());
    }
    expect(Object.keys(transitionRegistry).sort()).toEqual(['image', 'solid', 'text', 'video']);
    expect(transitionRegistry.video?.src?.consumers).toContain('rendered');
    expect(transitionRegistry.video?.mediaFit?.consumers).toContain('unsupported');
    expect(transitionRegistry.video?.properties?.consumers).toContain('unsupported');
    expect(transitionRegistry.video?.keyframes?.consumers).toContain('unsupported');
    expect(transitionRegistry.video?.mask?.consumers).toContain('rendered');
    expect(transitionRegistry.video?.effects?.consumers).toContain('unsupported');
    expect(transitionRegistry.image?.imageFadeIn?.consumers).toContain('unsupported');
    expect(transitionRegistry.text?.text?.consumers).toContain('rendered');
    expect(transitionRegistry.text?.fontWeight?.consumers).toContain('rendered');
    expect(transitionRegistry.text?.textAlign?.consumers).toContain('unsupported');
    expect(transitionRegistry.text?.cues?.consumers).toContain('unsupported');
  });

  it('classifies every first-party MG field used by the direct renderer', () => {
    const mgRegistry = (
      components as unknown as {
        TIMELINE_MG_RENDER_FIELD_CONSUMERS?: Record<string, Record<string, Classification>>;
      }
    ).TIMELINE_MG_RENDER_FIELD_CONSUMERS ?? {};

    expect(Object.keys(mgRegistry.spec ?? {}).sort()).toEqual(
      Object.keys(MgCompositionSpecSchema.shape).sort(),
    );
    expect(Object.keys(mgRegistry.textLayer ?? {}).sort()).toEqual(
      Object.keys(MgTextLayerSchema.shape).sort(),
    );
    expect(Object.keys(mgRegistry.shapeLayer ?? {}).sort()).toEqual(
      Object.keys(MgShapeLayerSchema.shape).sort(),
    );
    expect(Object.keys(mgRegistry.animation ?? {}).sort()).toEqual(
      Object.keys(MgAnimationSchema.shape).sort(),
    );
    expect(mgRegistry.spec?.background?.consumers).toContain('unsupported');
    expect(mgRegistry.textLayer?.letterSpacing?.consumers).toContain('unsupported');
    expect(mgRegistry.textLayer?.align?.consumers).toContain('unsupported');
    expect(mgRegistry.shapeLayer?.stroke?.consumers).toContain('unsupported');
    expect(mgRegistry.shapeLayer?.strokeWidth?.consumers).toContain('unsupported');
    expect(mgRegistry.animation?.property?.consumers).toContain('rendered');
  });

  it('classifies every shared fallback and exposes any renderer override explicitly', () => {
    const defaultCoverage = (
      components as unknown as {
        TIMELINE_RENDER_DEFAULT_COVERAGE?: Record<string, Record<string, { mode: string; note: string }>>;
      }
    ).TIMELINE_RENDER_DEFAULT_COVERAGE ?? {};
    for (const [scope, defaults] of Object.entries(TIMELINE_SHARED_DEFAULTS)) {
      expect(Object.keys(defaultCoverage[scope] ?? {}).sort(), scope)
        .toEqual(Object.keys(defaults).sort());
      for (const [field, coverage] of Object.entries(defaultCoverage[scope] ?? {})) {
        expect(['shared', 'schema-normalized', 'helper', 'not-read', 'override'], `${scope}.${field}`)
          .toContain(coverage.mode);
        expect(coverage.note.trim().length, `${scope}.${field}`).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(defaultCoverage).sort())
      .toEqual(Object.keys(TIMELINE_SHARED_DEFAULTS).sort());
    expect(
      Object.values(defaultCoverage).flatMap((fields) => Object.values(fields))
        .filter((coverage) => coverage.mode === 'override'),
    ).toEqual([]);
  });
});
