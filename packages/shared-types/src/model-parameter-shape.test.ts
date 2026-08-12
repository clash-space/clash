import { describe, expect, it } from 'vitest';

import { MODEL_CARDS } from './models.js';
import { parseAspectRatio } from './gpt-image-size.js';

/**
 * Shared parameters have one shape.
 *
 * `aspect_ratio` spans image and video; `duration` spans video and audio;
 * `resolution` spans both. When each card re-spells the same concept, the drift is
 * invisible until something consumes it: one card labelled the ratio
 * "Aspect ratio" while twenty used "Aspect Ratio", and one card's durations were
 * strings while every other card's were numbers, so `value === 5` silently missed.
 *
 * Provider dialects (fal's `landscape_16_9`, MiniMax's `adaptive`) belong to the
 * adapter that talks to that provider, never to the catalogue.
 */
describe('shared model parameter shape', () => {
  const withParam = (id: string) =>
    MODEL_CARDS.filter(card => card.parameters.some(p => p.id === id));

  const paramOf = (card: (typeof MODEL_CARDS)[number], id: string) =>
    card.parameters.find(p => p.id === id)!;

  describe('aspect_ratio', () => {
    const cards = withParam('aspect_ratio');

    it('uses one label and one control type', () => {
      const shapes = new Set(cards.map(c => `${paramOf(c, 'aspect_ratio').label}/${paramOf(c, 'aspect_ratio').type}`));
      expect([...shapes]).toEqual(['Aspect Ratio/select']);
    });

    it('states a ratio as W:H and never folds resolution into it', () => {
      // The problem this guards is narrow. Image cards used to carry fal's preset
      // names (`landscape_16_9`, `square_hd`) and, worse, resolution tiers disguised
      // as ratios: `1:1 HD` sat next to `1:1`, so picking a shape also picked a size.
      // A card's own sentinel is not a ratio spelling and stays as the provider
      // names it -- MiniMax's `adaptive` means "match the reference", which no W:H
      // value can express.
      const presetSpelling = /^(landscape|portrait|square)(_|$)/;
      const offenders: string[] = [];
      for (const card of cards) {
        for (const option of paramOf(card, 'aspect_ratio').options ?? []) {
          const value = String(option.value);
          if (presetSpelling.test(value)) {
            offenders.push(`${card.id}: ${value} (provider preset)`);
            continue;
          }
          // A value carrying both a ratio and a size is the conflation being removed.
          if (value.includes(':') && parseAspectRatio(value) === undefined) {
            offenders.push(`${card.id}: ${value} (not a plain W:H)`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it('keeps the declared default ratio selectable', () => {
      // `defaultAspectRatio` sits on the card rather than inside `parameters`, so the
      // schema's candidate check does not reach it: a card could advertise a default
      // frame its own control cannot select.
      const offenders: string[] = [];
      for (const card of cards) {
        const values = (paramOf(card, 'aspect_ratio').options ?? []).map(o => String(o.value));
        if (values.length === 0) continue;
        if (!values.includes(card.defaultAspectRatio) && !values.includes('auto')) {
          offenders.push(`${card.id}: ${card.defaultAspectRatio} not in [${values.join(', ')}]`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('duration', () => {
    const cards = withParam('duration');

    it('uses one label', () => {
      const labels = new Set(cards.map(c => paramOf(c, 'duration').label));
      expect([...labels]).toEqual(['Duration']);
    });

    it('expresses seconds as numbers, never strings', () => {
      const offenders: string[] = [];
      for (const card of cards) {
        for (const option of paramOf(card, 'duration').options ?? []) {
          if (typeof option.value === 'number') continue;
          if (option.value === 'auto') continue;
          offenders.push(`${card.id}: ${JSON.stringify(option.value)}`);
        }
      }
      expect(offenders, 'a string second never equals a numeric one').toEqual([]);
    });

  });

  describe('resolution', () => {
    const cards = withParam('resolution');

    it('uses one label and one control type', () => {
      const shapes = new Set(cards.map(c => `${paramOf(c, 'resolution').label}/${paramOf(c, 'resolution').type}`));
      expect([...shapes]).toEqual(['Resolution/select']);
    });
  });

  it('no longer lets a card redirect the ratio parameter elsewhere', () => {
    // `aspectRatioParam` existed so a card could point at a provider-named field.
    // With one canonical name there is nothing left to redirect, and keeping the
    // field would leave a way back to per-card dialects.
    const offenders = MODEL_CARDS
      .filter(card => 'aspectRatioParam' in card && (card as Record<string, unknown>).aspectRatioParam !== undefined)
      .map(card => card.id);
    expect(offenders).toEqual([]);
  });
});
