import { describe, expect, it } from 'vitest';
import * as sharedTypes from './index.js';

describe('timeline library taxonomy', () => {
  it('covers the full editor library behind task-focused user groups', () => {
    const library = sharedTypes as unknown as {
      TIMELINE_LIBRARY_CATEGORIES?: readonly string[];
      TIMELINE_LIBRARY_GROUPS?: readonly unknown[];
    };

    expect(library.TIMELINE_LIBRARY_CATEGORIES).toEqual([
      'text',
      'stickers',
      'sound-effects',
      'transitions',
      'fx',
      'zoom',
      'luts',
      'audio-fx',
      'captions',
      'filters',
      'adjustments',
    ]);
    expect(library.TIMELINE_LIBRARY_GROUPS).toEqual([
      { id: 'recommended', label: 'Recommended', categories: [] },
      { id: 'text', label: 'Text & Captions', categories: ['text', 'captions'] },
      { id: 'graphics', label: 'Graphics', categories: ['stickers'] },
      { id: 'transitions', label: 'Transitions', categories: ['transitions'] },
      { id: 'visual-effects', label: 'Visual Effects', categories: ['fx', 'zoom'] },
      { id: 'color-looks', label: 'Color Looks', categories: ['filters', 'luts', 'adjustments'] },
      { id: 'audio', label: 'Audio', categories: ['sound-effects', 'audio-fx'] },
    ]);
  });

  it('validates one apply contract per internal category', () => {
    const library = sharedTypes as unknown as {
      TimelineLibraryItemSchema?: {
        safeParse: (value: unknown) => { success: boolean };
      };
    };
    const schema = library.TimelineLibraryItemSchema;

    expect(schema).toBeDefined();
    if (!schema) return;

    const base = { version: 1, tags: ['curated'] };
    const entries = [
      {
        ...base,
        id: 'library:text:editorial-title',
        label: 'Editorial Title',
        category: 'text',
        artifact: {
          kind: 'text-preset',
          text: 'Your title',
          color: '#ffffff',
          fontSize: 72,
          fontWeight: '700',
        },
        apply: { kind: 'insert-text-item' },
      },
      {
        ...base,
        id: 'library:sticker:spark',
        label: 'Spark',
        category: 'stickers',
        artifact: { kind: 'sticker-asset', src: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E' },
        apply: { kind: 'insert-sticker-item' },
      },
      {
        ...base,
        id: 'library:sound:whoosh-short',
        label: 'Short Whoosh',
        category: 'sound-effects',
        artifact: { kind: 'audio-asset', assetId: 'library:sound:whoosh-short' },
        apply: { kind: 'insert-audio-item' },
      },
      {
        ...base,
        id: 'clash:transition:whip-pan',
        label: 'Whip Pan',
        category: 'transitions',
        artifact: { kind: 'effect-ref', effectId: 'clash/whip-pan', effectVersion: 1 },
        apply: { kind: 'attach-transition', binding: 'between-items' },
      },
      {
        ...base,
        id: 'clash:fx:tilt-shift',
        label: 'Tilt-Shift',
        category: 'fx',
        artifact: { kind: 'effect-ref', effectId: 'clash/tilt-shift', effectVersion: 1 },
        apply: { kind: 'attach-visual-effect', binding: 'item-or-range' },
      },
      {
        ...base,
        id: 'clash:zoom:punch',
        label: 'Punch Zoom',
        category: 'zoom',
        artifact: { kind: 'effect-ref', effectId: 'clash/zoom', effectVersion: 1 },
        apply: { kind: 'attach-visual-effect', binding: 'track-range' },
      },
      {
        ...base,
        id: 'library:lut:film-2383',
        label: 'Film 2383',
        category: 'luts',
        artifact: { kind: 'lut-asset', assetId: 'library:lut:film-2383' },
        apply: { kind: 'attach-color-look', binding: 'item' },
      },
      {
        ...base,
        id: 'clash:audio-fx:voice-cleanup',
        label: 'Voice Cleanup',
        category: 'audio-fx',
        artifact: { kind: 'audio-processor-ref', processorId: 'clash/voice-cleanup', processorVersion: 1 },
        apply: { kind: 'attach-audio-effect', binding: 'audio-item-or-track' },
      },
      {
        ...base,
        id: 'library:caption:clean',
        label: 'Clean Captions',
        category: 'captions',
        artifact: {
          kind: 'caption-style',
          style: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.56)', position: 'bottom' },
        },
        apply: { kind: 'update-caption-style' },
      },
      {
        ...base,
        id: 'clash:filter:warm-film',
        label: 'Warm Film',
        category: 'filters',
        artifact: { kind: 'effect-ref', effectId: 'clash/warm-film', effectVersion: 1 },
        apply: { kind: 'attach-color-look', binding: 'item' },
      },
      {
        ...base,
        id: 'clash:adjustment:exposure',
        label: 'Exposure',
        category: 'adjustments',
        artifact: { kind: 'effect-ref', effectId: 'clash/adjust-exposure', effectVersion: 1 },
        apply: { kind: 'attach-visual-effect', binding: 'item' },
      },
    ];

    expect(entries.map((entry) => schema.safeParse(entry).success)).toEqual(
      Array.from({ length: entries.length }, () => true),
    );
  });

  it('rejects artifact and binding combinations from the wrong category', () => {
    const library = sharedTypes as unknown as {
      TimelineLibraryItemSchema?: {
        safeParse: (value: unknown) => { success: boolean };
      };
    };
    const schema = library.TimelineLibraryItemSchema;

    expect(schema).toBeDefined();
    if (!schema) return;

    expect(schema.safeParse({
      id: 'library:sound:not-a-sound',
      version: 1,
      label: 'Not a Sound',
      category: 'sound-effects',
      tags: [],
      artifact: { kind: 'effect-ref', effectId: 'clash/glow', effectVersion: 1 },
      apply: { kind: 'attach-visual-effect', binding: 'item-or-range' },
    }).success).toBe(false);

    expect(schema.safeParse({
      id: 'library:motion:legacy-lower-third',
      version: 1,
      label: 'Legacy Lower Third',
      category: 'motion-graphics',
      tags: [],
      artifact: {
        kind: 'mg-composition',
        spec: {
          id: 'legacy-lower-third',
          width: 1080,
          height: 1920,
          fps: 30,
          durationInFrames: 90,
          layers: [],
        },
      },
      apply: {
        kind: 'insert-composition-item',
        compositionKind: 'motion-graphics',
        runtime: 'html',
      },
    }).success).toBe(false);

    expect(schema.safeParse({
      id: 'library:template:legacy-title',
      version: 1,
      label: 'Legacy Title',
      category: 'templates',
      tags: [],
      artifact: { kind: 'mg-composition', spec: {} },
      apply: {
        kind: 'insert-composition-item',
        compositionKind: 'motion-graphics',
        runtime: 'html',
      },
    }).success).toBe(false);

    expect(schema.safeParse({
      id: 'clash:zoom:wrong-binding',
      version: 1,
      label: 'Wrong Zoom',
      category: 'zoom',
      tags: [],
      artifact: { kind: 'effect-ref', effectId: 'clash/zoom', effectVersion: 1 },
      apply: { kind: 'attach-visual-effect', binding: 'item' },
    }).success).toBe(false);

    expect(schema.safeParse({
      id: 'library:motion:duplicate-model',
      version: 1,
      label: 'Duplicate MG Model',
      category: 'motion-graphics',
      tags: [],
      artifact: { kind: 'motion-graphic-template', templateId: 'builtin:lower-third' },
      apply: { kind: 'insert-video-item' },
    }).success).toBe(false);
  });

  it('gives agents a catalog-first target contract before they choose an item', () => {
    const library = sharedTypes as unknown as {
      getTimelineLibraryCategoryContract?: (category: string) => unknown;
    };
    const getContract = library.getTimelineLibraryCategoryContract;

    expect(getContract).toBeDefined();
    if (!getContract) return;

    expect(getContract('sound-effects')).toEqual({
      domain: 'asset',
      target: 'audio-track',
      applyKind: 'insert-audio-item',
      catalogFirst: true,
    });
    expect(getContract('transitions')).toEqual({
      domain: 'visual-processor',
      target: 'clip-boundary',
      applyKind: 'attach-transition',
      catalogFirst: true,
    });
    expect(getContract('zoom')).toEqual({
      domain: 'visual-processor',
      target: 'visual-track-range',
      applyKind: 'attach-visual-effect',
      catalogFirst: true,
    });
    expect(getContract('audio-fx')).toEqual({
      domain: 'audio-processor',
      target: 'audio-item-or-track',
      applyKind: 'attach-audio-effect',
      catalogFirst: true,
    });
    expect(getContract('text')).toEqual({
      domain: 'preset',
      target: 'text-track',
      applyKind: 'insert-text-item',
      catalogFirst: true,
    });
    expect(getContract('captions')).toEqual({
      domain: 'preset',
      target: 'caption-item',
      applyKind: 'update-caption-style',
      catalogFirst: true,
    });
  });

  it('models CapCut-style sidebar collections as queries instead of new artifact types', () => {
    const library = sharedTypes as unknown as {
      TimelineLibraryCollectionSchema?: {
        safeParse: (value: unknown) => { success: boolean };
      };
    };
    const schema = library.TimelineLibraryCollectionSchema;

    expect(schema).toBeDefined();
    if (!schema) return;

    expect(schema.safeParse({
      id: 'favorites',
      label: 'Favorites',
      groupId: 'recommended',
      query: { favoriteOnly: true },
    }).success).toBe(true);
    expect(schema.safeParse({
      id: 'fx:basic',
      label: 'Basic',
      groupId: 'visual-effects',
      parentId: 'fx:video-effects',
      query: { categories: ['fx'], tags: ['basic'] },
    }).success).toBe(true);
    expect(schema.safeParse({
      id: 'empty',
      label: 'Empty Query',
      groupId: 'visual-effects',
      query: {},
    }).success).toBe(false);
  });

  it('keeps favorite, entitlement, and download progress outside immutable catalog items', () => {
    const library = sharedTypes as unknown as {
      TimelineLibraryItemViewStateSchema?: {
        safeParse: (value: unknown) => { success: boolean };
      };
    };
    const schema = library.TimelineLibraryItemViewStateSchema;

    expect(schema).toBeDefined();
    if (!schema) return;

    expect(schema.safeParse({
      itemId: 'clash:fx:tilt-shift',
      favorite: true,
      access: 'free',
      delivery: { state: 'installed' },
    }).success).toBe(true);
    expect(schema.safeParse({
      itemId: 'clash:fx:crt',
      favorite: false,
      access: 'entitled',
      delivery: { state: 'downloading', progress: 0.42 },
    }).success).toBe(true);
    expect(schema.safeParse({
      itemId: 'clash:fx:crt',
      favorite: false,
      access: 'requires-upgrade',
      delivery: { state: 'downloading', progress: 1.2 },
    }).success).toBe(false);
  });
});
