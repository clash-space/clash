
import { useState, useEffect } from 'react';
import { fetchWithRetry } from './retryFetch';

/**
 * In-memory signed URL cache shared across all hook instances.
 * Key: storageKey, Value: { url, exp (unix seconds) }
 */
const cache = new Map<string, { url: string; exp: number }>();
const inflight = new Map<string, Promise<{ url: string; exp: number }>>();
const pending = new Map<string, {
  resolve: (value: { url: string; exp: number }) => void;
  reject: (err: unknown) => void;
}>();
let pendingTimer: ReturnType<typeof setTimeout> | undefined;

const REFRESH_MARGIN = 300; // refresh 5 min before expiry

function isAlreadyUrl(src: string): boolean {
  if (!src) return false;
  return src.startsWith('http') || src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('/');
}

function parseExpFromUrl(url: string): number | undefined {
  try {
    const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const parsed = new URL(url, origin);
    const exp = Number(parsed.searchParams.get('exp'));
    return Number.isFinite(exp) ? exp : undefined;
  } catch {
    return undefined;
  }
}

export function primeSignedUrl(storageKey: string | undefined, url: string | undefined, exp?: number): void {
  if (!storageKey || !url) return;
  cache.set(storageKey, {
    url,
    exp: exp ?? parseExpFromUrl(url) ?? Math.floor(Date.now() / 1000) + REFRESH_MARGIN,
  });
  inflight.delete(storageKey);
  pending.delete(storageKey);
}

async function fetchSigned(storageKey: string): Promise<{ url: string; exp: number }> {
  const res = await fetchWithRetry(`/assets/sign?key=${encodeURIComponent(storageKey)}`);
  if (!res.ok) throw new Error('Failed to sign URL');
  return res.json();
}

async function fetchSignedBatch(storageKeys: string[]): Promise<Array<{ key: string; url: string; exp: number }>> {
  const res = await fetchWithRetry('/assets/sign-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keys: storageKeys }),
  });
  if (!res.ok) throw new Error('Failed to sign URLs');
  const json = (await res.json()) as { urls?: Array<{ key: string; url: string; exp: number }> };
  return json.urls ?? [];
}

function scheduleFlush(): void {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = undefined;
    void flushPending();
  }, 0);
}

async function flushPending(): Promise<void> {
  const entries = Array.from(pending.entries());
  pending.clear();
  if (entries.length === 0) return;

  const keys = entries.map(([key]) => key);
  try {
    if (keys.length === 1) {
      const signed = await fetchSigned(keys[0]);
      cache.set(keys[0], signed);
      entries[0][1].resolve(signed);
      return;
    }

    const signedUrls = await fetchSignedBatch(keys);
    const byKey = new Map(signedUrls.map((signed) => [signed.key, signed]));
    for (const signed of signedUrls) cache.set(signed.key, { url: signed.url, exp: signed.exp });

    for (const [key, handlers] of entries) {
      const signed = byKey.get(key);
      if (signed) {
        handlers.resolve({ url: signed.url, exp: signed.exp });
      } else {
        handlers.reject(new Error(`Signed URL for ${key} not returned`));
      }
    }
  } catch (err) {
    for (const [, handlers] of entries) handlers.reject(err);
  } finally {
    for (const key of keys) inflight.delete(key);
  }
}

function getOrFetch(storageKey: string): Promise<{ url: string; exp: number }> {
  const cached = cache.get(storageKey);
  if (cached && cached.exp - Date.now() / 1000 > REFRESH_MARGIN) {
    return Promise.resolve(cached);
  }

  let p = inflight.get(storageKey);
  if (!p) {
    p = new Promise<{ url: string; exp: number }>((resolve, reject) => {
      pending.set(storageKey, { resolve, reject });
      scheduleFlush();
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
