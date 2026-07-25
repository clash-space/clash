import { describe, expect, it } from 'vitest';
import { builtInEffectRegistry } from '@master-clash/remotion-effects';
import { TimelineLibraryItemSchema } from '@clash/shared-types/timeline-library';
import {
  TIMELINE_LIBRARY_CATALOG,
  queryTimelineLibrary,
} from './timelineLibraryCatalog';

describe('Timeline Library catalog', () => {
  it('contains a valid, usable entry for every editor capability', () => {
    const categories = new Set(TIMELINE_LIBRARY_CATALOG.map((record) => record.item.category));
    expect([...categories]).toEqual(expect.arrayContaining([
      'text',
      'stickers',
      'motion-graphics',
      'sound-effects',
      'transitions',
      'fx',
      'zoom',
      'luts',
      'audio-fx',
      'captions',
      'filters',
      'adjustments',
      'templates',
    ]));

    for (const record of TIMELINE_LIBRARY_CATALOG) {
      expect(TimelineLibraryItemSchema.safeParse(record.item).success, record.item.id).toBe(true);
    }
  });

  it('derives transition cards from the real effect registry', () => {
    const transitionCards = queryTimelineLibrary({ categories: ['transitions'] });
    const transitionDefinitions = builtInEffectRegistry.list({ kind: 'transition' });

    expect(transitionCards).toHaveLength(transitionDefinitions.length);
    expect(transitionCards.map((record) => record.item.artifact.kind)).toEqual(
      Array.from({ length: transitionDefinitions.length }, () => 'effect-ref'),
    );
    for (const record of transitionCards) {
      if (record.item.category !== 'transitions') continue;
      const artifact = record.item.artifact;
      if (!('effectId' in artifact) || !('effectVersion' in artifact)) continue;
      expect(() => builtInEffectRegistry.resolve(
        artifact.effectId,
        artifact.effectVersion,
      )).not.toThrow();
    }
  });

  it('searches labels, descriptions, tags, and agent search terms within a group', () => {
    expect(queryTimelineLibrary({ search: 'whip' }).map((record) => record.item.label)).toContain('Whip Pan');
    expect(queryTimelineLibrary({ groupId: 'audio', search: 'click' }).map((record) => record.item.label)).toContain('Mouse Click');
    expect(queryTimelineLibrary({ groupId: 'color-looks' }).every((record) =>
      ['filters', 'luts', 'adjustments'].includes(record.item.category),
    )).toBe(true);
  });

  it('ships real data-URL media for bundled stickers and sound effects', () => {
    const stickers = queryTimelineLibrary({ categories: ['stickers'] });
    const sounds = queryTimelineLibrary({ categories: ['sound-effects'] });

    expect(stickers.every((record) => record.preview.kind === 'image')).toBe(true);
    expect(stickers.every((record) => record.preview.src?.startsWith('data:image/svg+xml'))).toBe(true);
    expect(sounds.every((record) => record.runtimeAsset?.src.startsWith('data:audio/wav;base64,'))).toBe(true);
    expect(sounds.every((record) => (record.runtimeAsset?.waveform?.length ?? 0) > 10)).toBe(true);
  });
});
