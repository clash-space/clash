/**
 * Thumbnail cache utility for video editor
 * Uses localStorage to persist generated thumbnails across sessions
 */

const THUMBNAIL_PREFIX = 'thumb_editor_v1_';
// const CACHE_VERSION_KEY = 'thumb_editor_version'; // unused

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

/**
 * Check if cached thumbnail is valid (not expired)
 * For now, we don't implement expiration, but this could be extended
 */
function isValidCache(cachedData: string): boolean {
  try {
    const data = JSON.parse(cachedData);
    // Check if data has the expected structure
    return data && typeof data === 'object' && 'thumbnail' in data;
  } catch {
    return false;
  }
}

export const thumbnailCache = {
  /**
   * Store a thumbnail for a given source URL
   */
  set(src: string, base64: string): void {
    if (!src || !base64) return;

    try {
      const key = getCacheKey(src);
      const data = {
        thumbnail: base64,
        timestamp: Date.now(),
        version: 1
      };
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      // Handle quota exceeded or other errors
      if (e instanceof Error && e.name === 'QuotaExceededError') {
        console.warn('[thumbnailCache] localStorage quota exceeded, clearing old thumbnails');
        thumbnailCache.clearOldest();
        // Retry once
        try {
          const key = getCacheKey(src);
          const data = {
            thumbnail: base64,
            timestamp: Date.now(),
            version: 1
          };
          localStorage.setItem(key, JSON.stringify(data));
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

      // Validate cache structure
      if (!isValidCache(cached)) {
        // Invalid cache, remove it
        localStorage.removeItem(key);
        return null;
      }

      const data = JSON.parse(cached);
      return data.thumbnail;
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
    const key = getCacheKey(src);
    const cached = localStorage.getItem(key);
    return cached !== null && isValidCache(cached);
  },

  /**
   * Clear all cached thumbnails
   */
  clear(): void {
    try {
      const keysToRemove = Object.keys(localStorage)
        .filter(key => key.startsWith(THUMBNAIL_PREFIX));

      keysToRemove.forEach(key => localStorage.removeItem(key));
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
      const cacheEntries: Array<{ key: string; timestamp: number }> = [];

      Object.keys(localStorage)
        .filter(key => key.startsWith(THUMBNAIL_PREFIX))
        .forEach(key => {
          try {
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            if (data.timestamp) {
              cacheEntries.push({ key, timestamp: data.timestamp });
            }
          } catch {
            // If we can't parse, remove it
            localStorage.removeItem(key);
          }
        });

      // Sort by timestamp (oldest first)
      cacheEntries.sort((a, b) => a.timestamp - b.timestamp);

      // Remove the oldest 25%
      const toRemove = Math.ceil(cacheEntries.length * 0.25);
      for (let i = 0; i < toRemove; i++) {
        localStorage.removeItem(cacheEntries[i].key);
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
      const keys = Object.keys(localStorage).filter(key => key.startsWith(THUMBNAIL_PREFIX));
      let totalSize = 0;

      keys.forEach(key => {
        totalSize += localStorage.getItem(key)?.length || 0;
      });

      return {
        count: keys.length,
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
