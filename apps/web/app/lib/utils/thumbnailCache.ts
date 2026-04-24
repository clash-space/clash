const THUMBNAIL_PREFIX = 'thumb_v2_';

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

export const thumbnailCache = {
    /**
     * Store a thumbnail for a given source URL
     */
    set(src: string | undefined, base64: string | undefined) {
        if (!src || !base64) return;
        try {
            const key = THUMBNAIL_PREFIX + hashString(src);
            localStorage.setItem(key, base64);
        } catch (_e) {
            console.warn('[thumbnailCache] Failed to save to localStorage:', _e);
        }
    },

    /**
     * Retrieve a thumbnail for a given source URL
     */
    get(src: string | undefined): string | null {
        if (!src) return null;
        try {
            const key = THUMBNAIL_PREFIX + hashString(src);
            return localStorage.getItem(key);
        } catch (_e) {
            return null;
        }
    },

    /**
     * Clear all cached thumbnails
     */
    clear() {
        Object.keys(localStorage)
            .filter(key => key.startsWith('thumb_')) // Clear v1 and v2
            .forEach(key => localStorage.removeItem(key));
    }
};
