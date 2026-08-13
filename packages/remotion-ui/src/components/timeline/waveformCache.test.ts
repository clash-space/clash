import { describe, expect, it } from 'vitest';

import { createBoundedWaveformCache } from './waveformCache';

describe('bounded Timeline waveform cache', () => {
  it('evicts the least-recently-used entry when the entry budget is exceeded', () => {
    const cache = createBoundedWaveformCache({
      maxEntries: 2,
      maxSamples: 10,
      ttlMs: 1_000,
      now: () => 0,
    });
    cache.set('first', [0.1]);
    cache.set('second', [0.2]);
    expect(cache.get('first')).toEqual([0.1]);

    cache.set('third', [0.3]);

    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('first')).toEqual([0.1]);
    expect(cache.get('third')).toEqual([0.3]);
  });

  it('evicts old entries until the aggregate sample budget is satisfied', () => {
    const cache = createBoundedWaveformCache({
      maxEntries: 10,
      maxSamples: 4,
      ttlMs: 1_000,
      now: () => 0,
    });
    cache.set('first', [0.1, 0.2]);
    cache.set('second', [0.3, 0.4]);
    cache.set('third', [0.5, 0.6]);

    expect(cache.get('first')).toBeUndefined();
    expect(cache.stats()).toEqual({ entries: 2, samples: 4 });
  });

  it('expires disposable device data and does not expose mutable stored arrays', () => {
    let now = 0;
    const cache = createBoundedWaveformCache({
      maxEntries: 2,
      maxSamples: 10,
      ttlMs: 100,
      now: () => now,
    });
    const waveform = [0.1, 0.2];
    cache.set('asset', waveform);
    waveform[0] = 1;
    expect(cache.get('asset')).toEqual([0.1, 0.2]);

    now = 101;
    expect(cache.get('asset')).toBeUndefined();
    expect(cache.stats()).toEqual({ entries: 0, samples: 0 });
  });
});
