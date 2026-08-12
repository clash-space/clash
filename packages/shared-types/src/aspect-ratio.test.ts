import { describe, expect, it } from 'vitest';

import {
  aspectRatioEquals,
  aspectRatioLabel,
  parseAspectRatio,
  reduceAspectRatio,
  supportsAspectRatio,
} from './aspect-ratio.js';

describe('aspect ratio as two numbers', () => {
  it('reduces to smallest terms', () => {
    expect(reduceAspectRatio({ width: 1920, height: 1080 })).toEqual({ width: 16, height: 9 });
  });

  it('treats the same shape written two ways as equal', () => {
    // The string form could not do this, so a pixel-sized ratio matched no menu entry at all.
    expect(aspectRatioEquals({ width: 1920, height: 1080 }, { width: 16, height: 9 })).toBe(true);
  });

  it('writes the label vendors take verbatim', () => {
    // Google's imageConfig.aspectRatio and MiniMax's ratio both want "16:9" exactly.
    expect(aspectRatioLabel({ width: 1920, height: 1080 })).toBe('16:9');
  });

  it('reads both spellings found in the wild', () => {
    expect(parseAspectRatio('16:9')).toEqual({ width: 16, height: 9 });
    expect(parseAspectRatio('16x9')).toEqual({ width: 16, height: 9 });
  });

  it('refuses what it cannot read instead of guessing', () => {
    // A ratio guessed wrong is obeyed all the way to the vendor and paid for.
    expect(parseAspectRatio('adaptive')).toBeUndefined();
    expect(parseAspectRatio('16:0')).toBeUndefined();
    expect(parseAspectRatio('-16:9')).toBeUndefined();
  });

  it('checks support by shape, not by spelling', () => {
    const supported = [{ width: 16, height: 9 }, { width: 1, height: 1 }];
    expect(supportsAspectRatio(supported, { width: 1920, height: 1080 })).toBe(true);
    expect(supportsAspectRatio(supported, { width: 21, height: 9 })).toBe(false);
  });

  it('recognises 21:9 and 7:3 as one shape', () => {
    // They are: 21:9 reduces to 7:3. Written as strings they are two menu entries that can never
    // match, which is what reduction is for -- this test was first written asserting the opposite
    // and the arithmetic corrected it.
    expect(supportsAspectRatio([{ width: 21, height: 9 }], { width: 7, height: 3 })).toBe(true);
  });

  it('does not snap an unsupported ratio to a nearby one', () => {
    // 2:1 is near 21:9 and is not 21:9. Substituting it silently would produce a picture the caller
    // did not ask for and did pay for.
    expect(supportsAspectRatio([{ width: 21, height: 9 }], { width: 2, height: 1 })).toBe(false);
  });
});
