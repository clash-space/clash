import { beforeEach, describe, expect, it, vi } from 'vitest';
import { thumbnailCache } from './thumbnailCache';

class LocalStorageMock implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('thumbnailCache', () => {
  let now = 1_700_000_000_000;

  beforeEach(() => {
    now = 1_700_000_000_000;
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockImplementation(() => ++now);
    Object.defineProperty(globalThis, 'localStorage', {
      value: new LocalStorageMock(),
      configurable: true,
      writable: true,
    });
  });

  it('evicts least recently used entries when count exceeds the limit', () => {
    for (let i = 0; i < 52; i++) {
      thumbnailCache.set(`thumb:item-${i}`, `data-${i}`);
    }

    expect(thumbnailCache.has('thumb:item-0')).toBe(false);
    expect(thumbnailCache.has('thumb:item-1')).toBe(false);
    expect(thumbnailCache.has('thumb:item-51')).toBe(true);
    expect(thumbnailCache.getStats().count).toBeLessThanOrEqual(48);
  });

  it('prefers evicting old filmstrips before thumbnails', () => {
    thumbnailCache.set('filmstrip:video-a', 'filmstrip-a');
    thumbnailCache.set('filmstrip:video-b', 'filmstrip-b');

    for (let i = 0; i < 47; i++) {
      thumbnailCache.set(`thumb:item-${i}`, `data-${i}`);
    }

    expect(thumbnailCache.has('filmstrip:video-a')).toBe(false);
    expect(thumbnailCache.has('filmstrip:video-b')).toBe(true);
    expect(thumbnailCache.has('thumb:item-0')).toBe(true);
  });
});
