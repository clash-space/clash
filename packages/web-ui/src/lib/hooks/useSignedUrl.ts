
import { useState, useEffect } from 'react';
import { fetchWithRetry } from './retryFetch';

/**
 * In-memory signed URL cache shared across all hook instances.
 * Key: storageKey, Value: { url, exp (unix seconds) }
 */
const cache = new Map<string, { url: string; exp: number }>();
const inflight = new Map<string, Promise<{ url: string; exp: number }>>();

const REFRESH_MARGIN = 300; // refresh 5 min before expiry

function isAlreadyUrl(src: string): boolean {
  if (!src) return false;
  return src.startsWith('http') || src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('/');
}

async function fetchSigned(storageKey: string): Promise<{ url: string; exp: number }> {
  const res = await fetchWithRetry(`/assets/sign?key=${encodeURIComponent(storageKey)}`);
  if (!res.ok) throw new Error('Failed to sign URL');
  return res.json();
}

function getOrFetch(storageKey: string): Promise<{ url: string; exp: number }> {
  const cached = cache.get(storageKey);
  if (cached && cached.exp - Date.now() / 1000 > REFRESH_MARGIN) {
    return Promise.resolve(cached);
  }

  let p = inflight.get(storageKey);
  if (!p) {
    p = fetchSigned(storageKey).then(result => {
      cache.set(storageKey, result);
      inflight.delete(storageKey);
      return result;
    }).catch(err => {
      inflight.delete(storageKey);
      throw err;
    });
    inflight.set(storageKey, p);
  }
  return p;
}

/**
 * React hook that resolves a storageKey to a signed URL.
 * Returns the signed URL when ready, empty string while loading.
 *
 * If `src` is already a URL (http, blob, data, /path), returns it directly.
 */
export function useSignedUrl(src: string | undefined): string {
  const [url, setUrl] = useState<string>(() => {
    if (!src) return '';
    if (isAlreadyUrl(src)) return src;
    const cached = cache.get(src);
    if (cached && cached.exp - Date.now() / 1000 > REFRESH_MARGIN) return cached.url;
    return '';
  });

  useEffect(() => {
    if (!src || isAlreadyUrl(src)) {
      setUrl(src || '');
      return;
    }

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const loadAndScheduleRefresh = () => {
      getOrFetch(src).then(({ url: signed, exp }) => {
        if (cancelled) return;
        setUrl(signed);
        // Re-fetch REFRESH_MARGIN seconds before expiry to avoid serving stale URLs
        // to long-lived <img> / <video> elements.
        const msUntilRefresh = Math.max(1000, (exp - Math.floor(Date.now() / 1000) - REFRESH_MARGIN) * 1000);
        refreshTimer = setTimeout(() => {
          if (!cancelled) {
            cache.delete(src); // force fresh fetch
            loadAndScheduleRefresh();
          }
        }, msUntilRefresh);
      }).catch(() => {
        // Fallback: try unsigned (will 403 in prod but useful for debugging)
        if (!cancelled) setUrl(`/assets/${src}`);
      });
    };

    loadAndScheduleRefresh();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [src]);

  return url;
}

/**
 * Async version for non-React contexts (e.g. after upload).
 */
export async function getSignedUrl(storageKey: string): Promise<string> {
  if (isAlreadyUrl(storageKey)) return storageKey;
  const { url } = await getOrFetch(storageKey);
  return url;
}
