export interface BoundedWaveformCache {
  get(key: string): number[] | undefined;
  set(key: string, waveform: readonly number[]): void;
  stats(): { entries: number; samples: number };
}

interface WaveformCacheEntry {
  waveform: number[];
  expiresAt: number;
}

export function createBoundedWaveformCache(options: {
  maxEntries: number;
  maxSamples: number;
  ttlMs: number;
  now?: () => number;
}): BoundedWaveformCache {
  if (
    !Number.isSafeInteger(options.maxEntries) ||
    options.maxEntries <= 0 ||
    !Number.isSafeInteger(options.maxSamples) ||
    options.maxSamples <= 0 ||
    !Number.isFinite(options.ttlMs) ||
    options.ttlMs <= 0
  ) {
    throw new TypeError('Waveform cache budgets must be positive.');
  }
  const now = options.now ?? Date.now;
  const entries = new Map<string, WaveformCacheEntry>();
  let samples = 0;

  const remove = (key: string): void => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    samples -= entry.waveform.length;
  };
  const expire = (): void => {
    const current = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= current) remove(key);
    }
  };
  const enforceBudgets = (): void => {
    while (
      entries.size > options.maxEntries ||
      samples > options.maxSamples
    ) {
      const oldest = entries.keys().next().value as string | undefined;
      if (!oldest) return;
      remove(oldest);
    }
  };

  return {
    get(key) {
      expire();
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return [...entry.waveform];
    },
    set(key, waveform) {
      expire();
      remove(key);
      const stored = [...waveform];
      entries.set(key, {
        waveform: stored,
        expiresAt: now() + options.ttlMs,
      });
      samples += stored.length;
      enforceBudgets();
    },
    stats() {
      expire();
      return { entries: entries.size, samples };
    },
  };
}
