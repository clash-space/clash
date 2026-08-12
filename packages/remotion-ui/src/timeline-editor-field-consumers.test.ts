import {
  TIMELINE_DSL_FIELD_ANNOTATIONS,
  TIMELINE_DSL_ITEM_TYPES,
} from '@clash/shared-types';
import { describe, expect, it } from 'vitest';
import { TIMELINE_SHARED_DEFAULTS } from '@clash/remotion-core';
import * as ui from './index';

type Classification = {
  consumers: readonly string[];
  note: string;
};
type ConsumerRegistry = Record<string, Record<string, Classification>>;

const registry = (
  ui as unknown as { TIMELINE_EDITOR_FIELD_CONSUMERS?: ConsumerRegistry }
).TIMELINE_EDITOR_FIELD_CONSUMERS ?? {};
const rootTrackRegistry = (
  ui as unknown as {
    TIMELINE_EDITOR_ROOT_TRACK_FIELD_CONSUMERS?: ConsumerRegistry;
  }
).TIMELINE_EDITOR_ROOT_TRACK_FIELD_CONSUMERS ?? {};

describe('editor Timeline field consumer gate', () => {
  it('classifies every root and track field, including fields without defaults', () => {
    for (const scope of ['root', 'track'] as const) {
      expect(Object.keys(rootTrackRegistry[scope] ?? {}).sort(), scope).toEqual(
        Object.keys(TIMELINE_DSL_FIELD_ANNOTATIONS[scope]).sort(),
      );
    }
  });

  it('records root and track editor behavior instead of hiding host metadata', () => {
    expect(rootTrackRegistry.root?.tracks?.consumers).toContain('editor');
    expect(rootTrackRegistry.root?.primaryTrackId?.consumers).toContain('editor');
    expect(rootTrackRegistry.root?.assetTranscripts?.consumers).toContain('editor');
    expect(rootTrackRegistry.root?.mediaAssetRefs?.consumers).toContain('meta');
    expect(rootTrackRegistry.track?.id?.consumers).toContain('editor');
    expect(rootTrackRegistry.track?.role?.consumers).toContain('editor');
    expect(rootTrackRegistry.track?.category?.consumers).toContain('editor');
    expect(rootTrackRegistry.track?.items?.consumers).toContain('editor');
    expect(rootTrackRegistry.track?.hidden?.consumers).toContain('editor');
    expect(rootTrackRegistry.track?.locked?.consumers).toContain('editor');
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

  it('requires every declared editor surface to be implemented or explicitly unsupported', () => {
    for (const itemType of TIMELINE_DSL_ITEM_TYPES) {
      const annotations = {
        ...TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase,
        ...TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes[itemType],
      };
      for (const [field, annotation] of Object.entries(annotations)) {
        if (annotation.editor.surface === 'none') continue;
        const consumers = registry[itemType]?.[field]?.consumers ?? [];
        expect(
          consumers.includes('editor') || consumers.includes('unsupported'),
          `${itemType}.${field}`,
        ).toBe(true);
      }
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

  it('records editor metadata, persistence, future, and unsupported paths explicitly', () => {
    expect(registry.video?.waveform?.consumers).toContain('meta');
    expect(registry.text?.wordRefs?.consumers).toContain('meta');
    expect(registry.sticker?.sequence?.consumers).toContain('future');
    expect(registry.video?.bakedAssetPath?.consumers).toContain('persistence');
    expect(registry.audio?.properties?.consumers).toContain('unsupported');
    expect(registry.transition?.mask?.consumers).toContain('unsupported');
    expect(registry.transition?.effect?.consumers).toContain('unsupported');
    expect(registry.composition?.spec?.consumers).toContain('unsupported');
    expect(registry.composition?.sourcePath?.consumers).toContain('meta');
    expect(registry['derived-overlay']?.derivation?.consumers).toContain('meta');
  });

  it('classifies every shared fallback and exposes any editor override explicitly', () => {
    const defaultCoverage = (
      ui as unknown as {
        TIMELINE_EDITOR_DEFAULT_COVERAGE?: Record<string, Record<string, { mode: string; note: string }>>;
      }
    ).TIMELINE_EDITOR_DEFAULT_COVERAGE ?? {};
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
      Object.entries(defaultCoverage).flatMap(([scope, fields]) => (
        Object.entries(fields).flatMap(([field, coverage]) => (
          coverage.mode === 'override' ? [{ scope, field, value: (coverage as { value?: unknown }).value }] : []
        ))
      )),
    ).toEqual([{ scope: 'root', field: 'durationInFrames', value: 1500 }]);
  });
});
