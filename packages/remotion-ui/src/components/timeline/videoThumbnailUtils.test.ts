import { describe, expect, it, vi } from 'vitest';
import {
  createFilmstripColumnMapping,
  createFilmstripCacheEntry,
  createSerializedTaskQueue,
  drawFilmstripColumnsForSample,
  getOrCreatePendingTask,
  getPersistentVideoCacheId,
  renderFilmstripToCanvas,
  type FilmstripCacheEntry,
} from './videoThumbnailUtils';

function createEntry(overrides: Partial<FilmstripCacheEntry> = {}): FilmstripCacheEntry {
  return {
    canvas: {} as HTMLCanvasElement,
    frameWidth: 120,
    frameHeight: 80,
    framesPerRow: 60,
    sampleCount: 5,
    duration: 10,
    ...overrides,
  };
}

describe('createFilmstripColumnMapping', () => {
  it('maps columns across the whole video and groups them by sample index', () => {
    const entry = createEntry({ sampleCount: 5, frameWidth: 100, frameHeight: 80 });

    const mapping = createFilmstripColumnMapping({
      entry,
      destHeight: 40,
      fullVideoPixelWidth: 200,
    });

    expect(mapping.destFrameWidth).toBe(50);
    expect(mapping.columns).toBe(4);
    expect(mapping.colToIdx).toEqual([0, 1, 3, 4]);
    expect(mapping.idxToCols).toEqual([[0], [1], [], [2], [3]]);
  });
});

describe('createFilmstripCacheEntry', () => {
  it('reconstructs frame dimensions from a cached single-row strip', () => {
    const canvas = {
      width: 4200,
      height: 80,
    } as HTMLCanvasElement;

    const entry = createFilmstripCacheEntry({
      canvas,
      sampleCount: 40,
      duration: 16,
    });

    expect(entry.frameWidth).toBe(105);
    expect(entry.frameHeight).toBe(80);
    expect(entry.framesPerRow).toBe(40);
    expect(entry.sampleCount).toBe(40);
  });
});

describe('drawFilmstripColumnsForSample', () => {
  it('draws only the columns mapped to the requested sample', () => {
    const drawImage = vi.fn();
    const entry = createEntry({ sampleCount: 5, frameWidth: 100, frameHeight: 80 });
    const mapping = createFilmstripColumnMapping({
      entry,
      destHeight: 40,
      fullVideoPixelWidth: 200,
    });

    const drawn = drawFilmstripColumnsForSample({
      target: { drawImage } as Pick<CanvasRenderingContext2D, 'drawImage'>,
      entry,
      mapping,
      sampleIndex: 3,
      destHeight: 40,
    });

    expect(drawn).toBe(1);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage.mock.calls[0]?.slice(1)).toEqual([300, 0, 100, 80, 100, 0, 50, 40]);
  });
});

describe('renderFilmstripToCanvas', () => {
  it('renders an aspect-preserving display strip instead of stretching the whole image', () => {
    const drawImage = vi.fn();
    const entry = createEntry({ sampleCount: 5, frameWidth: 100, frameHeight: 80 });

    const mapping = renderFilmstripToCanvas({
      target: { drawImage } as Pick<CanvasRenderingContext2D, 'drawImage'>,
      entry,
      destHeight: 40,
      fullVideoPixelWidth: 200,
    });

    expect(mapping.destFrameWidth).toBe(50);
    expect(mapping.columns).toBe(4);
    expect(drawImage).toHaveBeenCalledTimes(4);
    expect(drawImage.mock.calls.map((call) => call.slice(1))).toEqual([
      [0, 0, 100, 80, 0, 0, 50, 40],
      [100, 0, 100, 80, 50, 0, 50, 40],
      [300, 0, 100, 80, 100, 0, 50, 40],
      [400, 0, 100, 80, 150, 0, 50, 40],
    ]);
  });
});

describe('createSerializedTaskQueue', () => {
  it('runs queued tasks one at a time in insertion order', async () => {
    const enqueue = createSerializedTaskQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;

    const first = enqueue(async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('first:end');
      return 'first';
    });

    const second = enqueue(async () => {
      order.push('second:start');
      order.push('second:end');
      return 'second';
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);

    releaseFirst();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });
});

describe('getOrCreatePendingTask', () => {
  it('deduplicates concurrent work for the same key and clears it after resolve', async () => {
    const pending = new Map<string, Promise<number>>();
    const factory = vi.fn(async () => 42);

    const first = getOrCreatePendingTask(pending, 'video-a', factory);
    const second = getOrCreatePendingTask(pending, 'video-a', factory);

    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);

    await expect(first).resolves.toBe(42);
    expect(pending.has('video-a')).toBe(false);
  });
});

describe('getPersistentVideoCacheId', () => {
  it('prefers the real asset row id when it is available', () => {
    expect(
      getPersistentVideoCacheId(
        'asset-row-123',
        'source-node-123',
        'https://cdn.example.com/video.mp4?X-Amz-Signature=abc'
      )
    ).toBe('asset-row-123');
  });

  it('falls back to the unsigned media url before using the source node id', () => {
    expect(
      getPersistentVideoCacheId(
        undefined,
        'source-node-123',
        'https://cdn.example.com/video.mp4?X-Amz-Signature=abc&Expires=123'
      )
    ).toBe('https://cdn.example.com/video.mp4');
  });

  it('uses the source node id only when there is no stable media identity', () => {
    expect(
      getPersistentVideoCacheId(
        undefined,
        'source-node-123',
        undefined
      )
    ).toBe('source-node-123');
  });
});
