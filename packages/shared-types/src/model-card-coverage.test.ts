import { describe, expect, it } from 'vitest';

import { MODEL_CARDS } from './models.js';

/**
 * Every model a route can serve must have a Card.
 *
 * A binding adds a route to an existing model; it does not introduce one. A route whose
 * `modelId` matches no Card is invisible: the catalogue never lists it, so nothing can be
 * generated with it, and the gap shows up only as a smaller number of available models
 * than the routes suggest. Seventeen such routes existed before these Cards were added.
 */
describe('model card coverage', () => {
  const byId = new Map(MODEL_CARDS.map(card => [card.id, card]));

  it('declares the Kling, Midjourney, Seedance tier, and music models', () => {
    const expected = [
      'kling-image-o1', 'kling-image-o3',
      'midjourney-7', 'midjourney-8.1', 'midjourney-niji-7',
      'seedance-2-fast-ref', 'seedance-2-fast-startend',
      'seedance-2-mini-ref', 'seedance-2-mini-startend',
      'kling-video-o1', 'kling-video-o3',
      'kling-avatar', 'kling-motion-control', 'jimeng-motion-control-2',
      'seed-audio-1', 'elevenlabs-music-v2', 'music-cover',
    ];
    expect(expected.filter(id => !byId.has(id))).toEqual([]);
  });

  it('gives every Card a unique id and no duplicate aliases', () => {
    const ids = MODEL_CARDS.map(card => card.id);
    expect(ids.length).toBe(new Set(ids).size);
    const aliases = MODEL_CARDS.flatMap(card => card.aliases ?? []);
    expect(aliases.filter(alias => byId.has(alias))).toEqual([]);
    expect(aliases.length).toBe(new Set(aliases).size);
  });

  it('keeps a Card in the kind its outputs belong to', () => {
    // A driven-performance model still produces video even though its subject is an
    // image and its driver an audio or video clip.
    expect(byId.get('kling-avatar')!.kind).toBe('video');
    expect(byId.get('kling-motion-control')!.kind).toBe('video');
    expect(byId.get('jimeng-motion-control-2')!.kind).toBe('video');
    expect(byId.get('music-cover')!.kind).toBe('audio');
    expect(byId.get('seed-audio-1')!.kind).toBe('audio');
  });

  it('asks for the references each model is driven by', () => {
    // Avatar needs a portrait and a voice clip; motion control needs a still and the
    // video whose motion is transferred. A Card that accepted neither would render the
    // model unusable while still appearing available.
    expect(byId.get('kling-avatar')!.input.inputMode.images?.max).toBe(1);
    expect(byId.get('kling-avatar')!.input.inputMode.audios?.max).toBe(1);
    expect(byId.get('kling-motion-control')!.input.inputMode.videos?.max).toBe(1);
    expect(byId.get('jimeng-motion-control-2')!.input.inputMode.videos?.max).toBe(1);
    expect(byId.get('music-cover')!.input.inputMode.audios?.max).toBe(1);
  });
});
