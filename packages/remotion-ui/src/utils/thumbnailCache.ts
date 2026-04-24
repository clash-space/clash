/**
 * Thumbnail cache utility for video editor
 * Uses localStorage to persist generated thumbnails across sessions
 */

const THUMBNAIL_PREFIX = 'thumb_editor_v1_';
const CACHE_VERSION = 2;
const ACCESS_TOUCH_INTERVAL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 48;
const MAX_CACHE_SIZE_ESTIMATE = 4_000_000;
const FILMSTRIP_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const THUMBNAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type CacheKind = 'thumbnail' | 'filmstrip';

type CacheEntry = {
  thumbnail: string;
  createdAt: number;
  lastAccessed: number;
  version: number;
  kind: CacheKind;
};

/**
 * Simple hash function for consistent keys
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generate a cache key from a source URL
 */
function getCacheKey(src: string): string {
  return THUMBNAIL_PREFIX + hashString(src);
}

function getCacheKind(cacheId: string): CacheKind {
  return cacheId.startsWith('filmstrip:') ? 'filmstrip' : 'thumbnail';
}

function getCacheTtl(kind: CacheKind): number {
  return kind === 'filmstrip' ? FILMSTRIP_TTL_MS : THUMBNAIL_TTL_MS;
}

function listCacheKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(THUMBNAIL_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

function parseCacheEntry(cacheId: string, cachedData: string): CacheEntry | null {
  try {
    const data = JSON.parse(cachedData);
    if (!data || typeof data !== 'object' || typeof data.thumbnail !== 'string') {
      return null;
    }

    const createdAt =
      typeof data.createdAt === 'number'
        ? data.createdAt
        : (typeof data.timestamp === 'number' ? data.timestamp : Date.now());
    const lastAccessed =
      typeof data.lastAccessed === 'number'
        ? data.lastAccessed
        : createdAt;

    return {
      thumbnail: data.thumbnail,
      createdAt,
      lastAccessed,
      version: typeof data.version === 'number' ? data.version : 1,
      kind:
        data.kind === 'filmstrip' || data.kind === 'thumbnail'
          ? data.kind
          : getCacheKind(cacheId),
    };
  } catch {
    return null;
  }
}

function serializeCacheEntry(cacheId: string, thumbnail: string, now: number): string {
  return JSON.stringify({
    thumbnail,
    createdAt: now,
    lastAccessed: now,
    version: CACHE_VERSION,
    kind: getCacheKind(cacheId),
  } satisfies CacheEntry);
}

function isExpired(entry: CacheEntry, now: number): boolean {
  return now - entry.lastAccessed > getCacheTtl(entry.kind);
}

function collectCacheEntries(now = Date.now()) {
  const entries: Array<{
    key: string;
    cacheId: string;
    entry: CacheEntry;
    sizeEstimate: number;
  }> = [];

  for (const key of listCacheKeys()) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    const cacheId = key.slice(THUMBNAIL_PREFIX.length);
    const entry = parseCacheEntry(cacheId, raw);
    if (!entry || isExpired(entry, now)) {
      localStorage.removeItem(key);
      continue;
    }

    entries.push({
      key,
      cacheId,
      entry,
      sizeEstimate: raw.length,
    });
  }

  return entries;
}

function enforceCacheLimits() {
  const entries = collectCacheEntries();
  let totalSize = entries.reduce((sum, entry) => sum + entry.sizeEstimate, 0);

  entries.sort((a, b) => {
    if (a.entry.kind !== b.entry.kind) {
      return a.entry.kind === 'filmstrip' ? -1 : 1;
    }
    if (a.entry.lastAccessed !== b.entry.lastAccessed) {
      return a.entry.lastAccessed - b.entry.lastAccessed;
    }
    if (a.entry.createdAt !== b.entry.createdAt) {
      return a.entry.createdAt - b.entry.createdAt;
    }
    return b.sizeEstimate - a.sizeEstimate;
  });

  while (
    entries.length > MAX_CACHE_ENTRIES ||
    totalSize > MAX_CACHE_SIZE_ESTIMATE
  ) {
    const oldest = entries.shift();
    if (!oldest) {
      break;
    }
    localStorage.removeItem(oldest.key);
    totalSize -= oldest.sizeEstimate;
  }
}

export const thumbnailCache = {
  /**
   * Store a thumbnail for a given source URL
   */
  set(src: string, base64: string): void {
    if (!src || !base64) return;

    const now = Date.now();
    const key = getCacheKey(src);
    const data = serializeCacheEntry(src, base64, now);

    try {
      localStorage.setItem(key, data);
      enforceCacheLimits();
    } catch (e) {
      // Handle quota exceeded or other errors
      if (e instanceof Error && e.name === 'QuotaExceededError') {
        console.warn('[thumbnailCache] localStorage quota exceeded, clearing old thumbnails');
        thumbnailCache.clearOldest();
        // Retry once
        try {
          localStorage.setItem(key, data);
          enforceCacheLimits();
        } catch (retryError) {
          console.warn('[thumbnailCache] Still failed after clearing old cache:', retryError);
        }
      } else {
        console.warn('[thumbnailCache] Failed to save to localStorage:', e);
      }
    }
  },

  /**
   * Retrieve a thumbnail for a given source URL
   * Returns the base64 string if found and valid, null otherwise
   */
  get(src: string): string | null {
    if (!src) return null;

    try {
      const key = getCacheKey(src);
      const cached = localStorage.getItem(key);

      if (!cached) return null;

      const entry = parseCacheEntry(src, cached);
      if (!entry) {
        // Invalid cache, remove it
        localStorage.removeItem(key);
        return null;
      }

      const now = Date.now();
      if (isExpired(entry, now)) {
        localStorage.removeItem(key);
        return null;
      }

      if (now - entry.lastAccessed > ACCESS_TOUCH_INTERVAL_MS) {
        localStorage.setItem(
          key,
          JSON.stringify({
            ...entry,
            lastAccessed: now,
            version: CACHE_VERSION,
          })
        );
      }

      return entry.thumbnail;
    } catch (e) {
      console.warn('[thumbnailCache] Failed to read from localStorage:', e);
      return null;
    }
  },

  /**
   * Check if a thumbnail exists in cache
   */
  has(src: string): boolean {
    if (!src) return false;
    return thumbnailCache.get(src) !== null;
  },

  /**
   * Clear all cached thumbnails
   */
  clear(): void {
    try {
      listCacheKeys().forEach(key => localStorage.removeItem(key));
    } catch (e) {
      console.warn('[thumbnailCache] Failed to clear cache:', e);
    }
  },

  /**
   * Clear oldest thumbnails when quota is exceeded
   * Sorts by timestamp and removes the oldest 25%
   */
  clearOldest(): void {
    try {
      const entries = collectCacheEntries().sort((a, b) => {
        if (a.entry.kind !== b.entry.kind) {
          return a.entry.kind === 'filmstrip' ? -1 : 1;
        }
        return a.entry.lastAccessed - b.entry.lastAccessed;
      });

      const toRemove = Math.max(1, Math.ceil(entries.length * 0.25));
      for (let i = 0; i < toRemove; i++) {
        if (entries[i]) {
          localStorage.removeItem(entries[i].key);
        }
      }

    } catch (e) {
      console.warn('[thumbnailCache] Failed to clear oldest:', e);
    }
  },

  /**
   * Get storage usage statistics
   */
  getStats(): { count: number; sizeEstimate: number } {
    try {
      const entries = collectCacheEntries();
      const totalSize = entries.reduce((sum, entry) => sum + entry.sizeEstimate, 0);

      return {
        count: entries.length,
        sizeEstimate: totalSize // in bytes (rough estimate for UTF-16 strings)
      };
    } catch {
      return { count: 0, sizeEstimate: 0 };
    }
  }
};

/**
 * Generate a video thumbnail from the first frame
 * @param videoSrc - URL of the video file
 * @returns Promise resolving to base64 encoded JPEG thumbnail of the first frame
 */
export function generateVideoThumbnail(
  videoSrc: string
): Promise<string | undefined> {
  return generateVideoThumbnailAtTime(videoSrc, 0);
}

/**
 * Generate a video thumbnail at a specific time
 * @param videoSrc - URL of the video file
 * @param timeInSeconds - Time position to capture thumbnail from (default: 0 for first frame)
 * @returns Promise resolving to base64 encoded JPEG thumbnail
 */
export function generateVideoThumbnailAtTime(
  videoSrc: string,
  timeInSeconds: number = 0
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.crossOrigin = 'anonymous';

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };

    video.onloadedmetadata = () => {
      if (video.duration === 0) {
        cleanup();
        resolve(undefined);
        return;
      }

      // Seek to the specified time (first frame by default)
      video.currentTime = timeInSeconds;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 160;
        const ratio = video.videoWidth / video.videoHeight;
        canvas.width = size;
        canvas.height = size / ratio;
        const ctx = canvas.getContext('2d');

        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
          cleanup();
          resolve(thumbnail);
        } else {
          cleanup();
          resolve(undefined);
        }
      } catch {
        // ignore error
        cleanup();
        resolve(undefined);
      }
    };

    video.onerror = () => {
      cleanup();
      resolve(undefined);
    };

    video.src = videoSrc;
  });
}
