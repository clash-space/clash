import { describe, expect, it } from 'vitest';

import { CANONICAL_RESOLUTION_TIERS } from './resolution-tiers.js';

import {
  GPT_IMAGE_ASPECT_RATIOS,
  GPT_IMAGE_EDGE_MULTIPLE,
  GPT_IMAGE_MAX_EDGE,
  GPT_IMAGE_MAX_PIXELS,
  GPT_IMAGE_MAX_RATIO,
  GPT_IMAGE_MIN_PIXELS,
  GPT_IMAGE_RESOLUTION_TIERS,
  GPT_IMAGE_SIZES,
  computeGptImageSize,
  formatGptImageSize,
  gptImageSizeForRatio,
  isSupportedGptImageRatio,
  parseAspectRatio,
  resolveGptImageSize,
} from './gpt-image-size.js';

/**
 * The size table is committed data, so these tests audit the data.
 *
 * Every cell has to be a request gpt-image-2 accepts, and has to actually be the
 * ratio it claims -- a cell whose ratio drifted would silently reframe the image,
 * which no provider error would reveal.
 */
describe('gpt-image-2 size table', () => {
  const tiers = GPT_IMAGE_RESOLUTION_TIERS.map(tier => tier.value);
  const ratios = GPT_IMAGE_ASPECT_RATIOS.map(ratio => ratio.value);

  function cells() {
    return tiers.flatMap(tier =>
      ratios.map(ratio => ({ tier, ratio, size: GPT_IMAGE_SIZES[tier][ratio] })),
    );
  }

  it('covers every declared ratio at every tier', () => {
    const missing = cells().filter(cell => !cell.size).map(cell => `${cell.tier} ${cell.ratio}`);
    expect(missing).toEqual([]);
    expect(cells()).toHaveLength(ratios.length * tiers.length);
  });

  it('lists no cell for an undeclared ratio', () => {
    const declared = new Set<string>(ratios);
    const extra = tiers.flatMap(tier =>
      Object.keys(GPT_IMAGE_SIZES[tier])
        .filter(ratio => !declared.has(ratio))
        .map(ratio => `${tier} ${ratio}`),
    );
    expect(extra).toEqual([]);
  });

  it('keeps every cell inside the documented limits', () => {
    const offenders: string[] = [];
    for (const { tier, ratio, size } of cells()) {
      const where = `${tier} ${ratio} (${formatGptImageSize(size)})`;
      const long = Math.max(size.width, size.height);
      const short = Math.min(size.width, size.height);
      const pixels = size.width * size.height;
      if (size.width % GPT_IMAGE_EDGE_MULTIPLE !== 0) offenders.push(`${where}: width not a multiple of 16`);
      if (size.height % GPT_IMAGE_EDGE_MULTIPLE !== 0) offenders.push(`${where}: height not a multiple of 16`);
      if (long > GPT_IMAGE_MAX_EDGE) offenders.push(`${where}: edge ${long} exceeds ${GPT_IMAGE_MAX_EDGE}`);
      if (long / short > GPT_IMAGE_MAX_RATIO + 1e-9) offenders.push(`${where}: ratio ${(long / short).toFixed(3)} exceeds 3:1`);
      if (pixels < GPT_IMAGE_MIN_PIXELS) offenders.push(`${where}: ${pixels} below the pixel floor`);
      if (pixels > GPT_IMAGE_MAX_PIXELS) offenders.push(`${where}: ${pixels} above the pixel ceiling`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every cell faithful to its ratio', () => {
    const offenders: string[] = [];
    for (const { tier, ratio, size } of cells()) {
      const wanted = parseAspectRatio(ratio)!;
      const actual = size.width / size.height;
      // 16px quantisation cannot express every ratio exactly; 2% keeps the frame
      // visually identical while still catching a transposed or mistyped cell.
      const drift = Math.abs(actual - wanted) / wanted;
      if (drift > 0.02) {
        offenders.push(`${tier} ${ratio}: ${formatGptImageSize(size)} is ${actual.toFixed(3)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reproduces 2:1 exactly, since a panorama cannot tolerate drift', () => {
    for (const tier of tiers) {
      const size = GPT_IMAGE_SIZES[tier]['2:1'];
      expect(size.width, `2:1 @ ${tier}`).toBe(size.height * 2);
    }
    // The panorama request asks for the 2K tier and the client normalizes to 2048x1024.
    expect(gptImageSizeForRatio('2:1', '2K')).toEqual({ width: 2880, height: 1440 });
  });

  it('grows with the tier', () => {
    const offenders: string[] = [];
    for (const ratio of ratios) {
      const areas = tiers.map(tier => {
        const size = GPT_IMAGE_SIZES[tier][ratio];
        return size.width * size.height;
      });
      for (let index = 1; index < areas.length; index += 1) {
        if (areas[index] <= areas[index - 1]) {
          offenders.push(`${ratio}: ${tiers[index]} is not larger than ${tiers[index - 1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reaches the documented 4K landscape size', () => {
    expect(GPT_IMAGE_SIZES['4K']['16:9']).toEqual({ width: 3840, height: 2160 });
  });

  it('lands the 16:9 row on standard broadcast sizes', () => {
    // These three deliberately spend less than the tier budget so the output is a
    // recognisable 720p/1440p/2160p frame. That trade is the reason a cell may sit
    // below its budget, and pinning them keeps a future "optimisation" from
    // rounding 1280x720 into something no player expects.
    expect(GPT_IMAGE_SIZES['1K']['16:9']).toEqual({ width: 1280, height: 720 });
    expect(GPT_IMAGE_SIZES['2K']['16:9']).toEqual({ width: 2560, height: 1440 });
    expect(GPT_IMAGE_SIZES['4K']['16:9']).toEqual({ width: 3840, height: 2160 });
  });

  it('spends a defensible share of each tier budget', () => {
    // A cell can legitimately fall short of its tier: the 3840px edge limit binds
    // first for very wide ratios, and the 16:9 row prefers standard sizes. What a
    // hand-written cell must not be is wildly small -- that is a typo, and no
    // provider error would reveal it.
    const offenders: string[] = [];
    for (const { tier, ratio, size } of cells()) {
      const budget = GPT_IMAGE_RESOLUTION_TIERS.find(entry => entry.value === tier)!.pixels;
      const value = parseAspectRatio(ratio)!;
      const longOverShort = value >= 1 ? value : 1 / value;
      // Largest area this ratio can reach before hitting the edge limit.
      const edgeBound =
        GPT_IMAGE_MAX_EDGE *
        Math.floor(GPT_IMAGE_MAX_EDGE / longOverShort / GPT_IMAGE_EDGE_MULTIPLE) *
        GPT_IMAGE_EDGE_MULTIPLE;
      const achievable = Math.min(budget, edgeBound, GPT_IMAGE_MAX_PIXELS);
      const share = (size.width * size.height) / achievable;
      if (share < 0.7) {
        offenders.push(
          `${tier} ${ratio}: ${formatGptImageSize(size)} uses ${(share * 100).toFixed(0)}% of ${(achievable / 1e6).toFixed(2)}MP`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * A custom ratio has no committed cell, so it is derived. The derivation is also
 * how a new table row should be computed before being committed, which is why it
 * has to obey the same limits.
 */
describe('derived sizes for custom ratios', () => {
  const custom = ['7:3', '5:2', '8:5', '2.35:1', '1:1.85', '11:8'];

  it('keeps derived sizes inside the documented limits', () => {
    const offenders: string[] = [];
    for (const ratio of custom) {
      for (const tier of GPT_IMAGE_RESOLUTION_TIERS.map(entry => entry.value)) {
        const size = computeGptImageSize(ratio, tier);
        const where = `${tier} ${ratio} (${formatGptImageSize(size)})`;
        const long = Math.max(size.width, size.height);
        const short = Math.min(size.width, size.height);
        const pixels = size.width * size.height;
        if (size.width % GPT_IMAGE_EDGE_MULTIPLE !== 0) offenders.push(`${where}: width not a multiple of 16`);
        if (size.height % GPT_IMAGE_EDGE_MULTIPLE !== 0) offenders.push(`${where}: height not a multiple of 16`);
        if (long > GPT_IMAGE_MAX_EDGE) offenders.push(`${where}: edge exceeds ${GPT_IMAGE_MAX_EDGE}`);
        if (long / short > GPT_IMAGE_MAX_RATIO + 1e-9) offenders.push(`${where}: ratio exceeds 3:1`);
        if (pixels < GPT_IMAGE_MIN_PIXELS) offenders.push(`${where}: below the pixel floor`);
        if (pixels > GPT_IMAGE_MAX_PIXELS) offenders.push(`${where}: above the pixel ceiling`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('stays close to the requested custom ratio', () => {
    const offenders: string[] = [];
    for (const ratio of custom) {
      const wanted = parseAspectRatio(ratio)!;
      for (const tier of GPT_IMAGE_RESOLUTION_TIERS.map(entry => entry.value)) {
        const size = computeGptImageSize(ratio, tier);
        const drift = Math.abs(size.width / size.height - wanted) / wanted;
        if (drift > 0.03) offenders.push(`${tier} ${ratio}: ${formatGptImageSize(size)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('prefers a committed cell over deriving one', () => {
    expect(gptImageSizeForRatio('16:9', '1K')).toEqual(GPT_IMAGE_SIZES['1K']['16:9']);
  });
});

describe('ratio parsing and request resolution', () => {
  it('rejects ratios beyond the documented 3:1 limit', () => {
    expect(isSupportedGptImageRatio('3:1')).toBe(true);
    expect(isSupportedGptImageRatio('1:3')).toBe(true);
    expect(isSupportedGptImageRatio('4:1')).toBe(false);
    expect(isSupportedGptImageRatio('not-a-ratio')).toBe(false);
  });

  it('parses ratios and refuses malformed input', () => {
    expect(parseAspectRatio('2:1')).toBe(2);
    expect(parseAspectRatio('1:2')).toBe(0.5);
    expect(parseAspectRatio('0:1')).toBeUndefined();
    expect(parseAspectRatio('auto')).toBeUndefined();
  });

  it('honours explicit dimensions over the declared ratio', () => {
    expect(resolveGptImageSize({ width: 2048, height: 1024, aspect_ratio: '1:1' })).toEqual({
      width: 2048,
      height: 1024,
    });
    expect(resolveGptImageSize({ size: '1536x1024' })).toEqual({ width: 1536, height: 1024 });
  });

  it('resolves a declared ratio and tier through the table', () => {
    expect(resolveGptImageSize({ aspect_ratio: '2:1', resolution: '2K' })).toEqual(
      GPT_IMAGE_SIZES['2K']['2:1'],
    );
    expect(resolveGptImageSize({ aspect_ratio: '16:9' })).toEqual(GPT_IMAGE_SIZES['2K']['16:9']);
  });

  it('keeps auto only when no ratio was named', () => {
    expect(resolveGptImageSize({})).toBe('auto');
    expect(resolveGptImageSize({ aspect_ratio: 'auto' })).toBe('auto');
    expect(resolveGptImageSize({}, '2:1')).toEqual(GPT_IMAGE_SIZES['2K']['2:1']);
  });
});

describe('resolution tiers', () => {
  it('orders tiers from smallest to largest', () => {
    // A tier is a pixel budget, not a long edge: at a fixed 2048 long edge, 1:1 is
    // 4.2MP while 3:1 is 1.4MP. Ordering by budget is what makes "2K is bigger than
    // 1K" true for every ratio.
    const budgets = CANONICAL_RESOLUTION_TIERS.map(tier => tier.pixels);
    expect(budgets).toEqual([...budgets].sort((left, right) => left - right));
  });
});
