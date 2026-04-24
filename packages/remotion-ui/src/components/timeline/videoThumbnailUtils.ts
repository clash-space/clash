export type FilmstripCacheEntry = {
  canvas: HTMLCanvasElement;
  frameWidth: number;
  frameHeight: number;
  framesPerRow: number;
  sampleCount: number;
  duration: number;
};

export const DEFAULT_FILMSTRIP_SAMPLE_COUNT = 40;

export type FilmstripColumnMapping = {
  destFrameWidth: number;
  columns: number;
  colToIdx: number[];
  idxToCols: number[][];
};

export function createFilmstripColumnMapping({
  entry,
  destHeight,
  fullVideoPixelWidth,
}: {
  entry: FilmstripCacheEntry;
  destHeight: number;
  fullVideoPixelWidth: number;
}): FilmstripColumnMapping {
  const destFrameWidth = Math.max(
    1,
    Math.floor(entry.frameWidth * (destHeight / entry.frameHeight))
  );
  const columns = Math.max(1, Math.ceil(fullVideoPixelWidth / destFrameWidth));
  const colToIdx = new Array<number>(columns);
  const idxToCols: number[][] = Array.from({ length: entry.sampleCount }, () => []);

  for (let col = 0; col < columns; col++) {
    const ratio = columns === 1 ? 0 : col / (columns - 1);
    const idx = Math.min(
      entry.sampleCount - 1,
      Math.max(0, Math.round(ratio * (entry.sampleCount - 1)))
    );
    colToIdx[col] = idx;
    idxToCols[idx].push(col);
  }

  return {
    destFrameWidth,
    columns,
    colToIdx,
    idxToCols,
  };
}

export function createFilmstripCacheEntry({
  canvas,
  sampleCount,
  duration,
}: {
  canvas: HTMLCanvasElement;
  sampleCount: number;
  duration: number;
}): FilmstripCacheEntry {
  const effectiveSamples = Math.max(1, sampleCount);

  return {
    canvas,
    frameWidth: Math.max(1, Math.floor(canvas.width / effectiveSamples)),
    frameHeight: Math.max(1, canvas.height),
    framesPerRow: effectiveSamples,
    sampleCount: effectiveSamples,
    duration,
  };
}

export function drawFilmstripColumnsForSample({
  target,
  entry,
  mapping,
  sampleIndex,
  destHeight,
}: {
  target: Pick<CanvasRenderingContext2D, 'drawImage'>;
  entry: FilmstripCacheEntry;
  mapping: FilmstripColumnMapping;
  sampleIndex: number;
  destHeight: number;
}): number {
  const columns = mapping.idxToCols[sampleIndex];
  if (!columns?.length) {
    return 0;
  }

  for (const column of columns) {
    const sourceIndex = mapping.colToIdx[column];
    const sx = sourceIndex * entry.frameWidth;
    const dx = column * mapping.destFrameWidth;

    target.drawImage(
      entry.canvas,
      sx,
      0,
      entry.frameWidth,
      entry.frameHeight,
      dx,
      0,
      mapping.destFrameWidth,
      destHeight
    );
  }

  return columns.length;
}

export function renderFilmstripToCanvas({
  target,
  entry,
  destHeight,
  fullVideoPixelWidth,
}: {
  target: Pick<CanvasRenderingContext2D, 'drawImage'>;
  entry: FilmstripCacheEntry;
  destHeight: number;
  fullVideoPixelWidth: number;
}): FilmstripColumnMapping {
  const mapping = createFilmstripColumnMapping({
    entry,
    destHeight,
    fullVideoPixelWidth,
  });

  for (let sampleIndex = 0; sampleIndex < entry.sampleCount; sampleIndex++) {
    drawFilmstripColumnsForSample({
      target,
      entry,
      mapping,
      sampleIndex,
      destHeight,
    });
  }

  return mapping;
}

export function createSerializedTaskQueue() {
  let queue = Promise.resolve();

  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

export function getOrCreatePendingTask<T>(
  pendingTasks: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>
): Promise<T> {
  const existing = pendingTasks.get(key);
  if (existing) {
    return existing;
  }

  const task = factory().finally(() => {
    if (pendingTasks.get(key) === task) {
      pendingTasks.delete(key);
    }
  });

  pendingTasks.set(key, task);
  return task;
}

export function yieldToMainThread(timeout = 80): Promise<void> {
  return new Promise((resolve) => {
    if (
      typeof globalThis !== 'undefined' &&
      'requestIdleCallback' in globalThis &&
      typeof globalThis.requestIdleCallback === 'function'
    ) {
      globalThis.requestIdleCallback(() => resolve(), { timeout });
      return;
    }

    setTimeout(resolve, 16);
  });
}

export function getPersistentVideoCacheId(
  backingAssetId?: string,
  sourceNodeId?: string,
  videoSrc?: string
): string | null {
  if (backingAssetId) {
    return backingAssetId;
  }

  if (videoSrc) {
    try {
      const url = new URL(videoSrc, globalThis.location?.origin);
      return `${url.origin}${url.pathname}`;
    } catch {
      return videoSrc.split('#')[0]?.split('?')[0] ?? null;
    }
  }

  if (sourceNodeId) {
    return sourceNodeId;
  }

  return null;
}

export async function generateVideoFilmstrip({
  videoSrc,
  duration,
  sampleCount = DEFAULT_FILMSTRIP_SAMPLE_COUNT,
  frameHeight = 80,
  onSample,
}: {
  videoSrc: string;
  duration: number;
  sampleCount?: number;
  frameHeight?: number;
  onSample?: (snapshot: FilmstripCacheEntry, sampleIndex: number) => void;
}): Promise<string | undefined> {
  const video = document.createElement('video');
  video.src = videoSrc;
  video.crossOrigin = 'anonymous';
  video.preload = 'metadata';

  const cleanup = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => resolve();
      const onError = () => reject(new Error('video metadata error'));
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    });

    const effectiveSamples = Math.max(1, sampleCount);
    const frameWidth = Math.max(
      1,
      Math.floor((video.videoWidth / video.videoHeight) * frameHeight)
    );

    const canvas = document.createElement('canvas');
    canvas.width = frameWidth * effectiveSamples;
    canvas.height = frameHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return undefined;
    }

    const snapshot: FilmstripCacheEntry = {
      canvas,
      frameWidth,
      frameHeight,
      framesPerRow: effectiveSamples,
      sampleCount: effectiveSamples,
      duration,
    };

    const interval = duration / Math.max(effectiveSamples, 1);
    for (let i = 0; i < effectiveSamples; i++) {
      const time = Math.min(i * interval, Math.max(0, duration - 0.05));
      await new Promise<void>((resolveSeek) => {
        const seeked = () => {
          video.removeEventListener('seeked', seeked);
          resolveSeek();
        };
        video.addEventListener('seeked', seeked);
        video.currentTime = time;
      });

      ctx.drawImage(
        video,
        0,
        0,
        video.videoWidth,
        video.videoHeight,
        i * frameWidth,
        0,
        frameWidth,
        frameHeight
      );

      onSample?.(snapshot, i);

      if ((i + 1) % 4 === 0 && i < effectiveSamples - 1) {
        await yieldToMainThread();
      }
    }

    return canvas.toDataURL('image/jpeg', 0.75);
  } catch {
    return undefined;
  } finally {
    cleanup();
  }
}
