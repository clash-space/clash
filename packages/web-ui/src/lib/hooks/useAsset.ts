
import { useEffect, useState } from 'react';
import type { Asset } from '@clash/shared-types';
import { fetchWithRetry } from './retryFetch';

/**
 * In-memory asset cache shared across all hook instances.
 * Asset rows are write-mostly-once (created on upload/generation, cover/desc patched once),
 * so we cache forever and invalidate manually when our own code mutates.
 */
const cache = new Map<string, Asset>();
const inflight = new Map<string, Promise<Asset>>();

async function fetchAsset(id: string): Promise<Asset> {
  const res = await fetchWithRetry(`/api/v1/assets/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Asset fetch failed: ${res.status}`);
  return (await res.json()) as Asset;
}

function getOrFetch(id: string): Promise<Asset> {
  const cached = cache.get(id);
  if (cached) return Promise.resolve(cached);

  let p = inflight.get(id);
  if (!p) {
    p = fetchAsset(id)
      .then((asset) => {
        cache.set(id, asset);
        inflight.delete(id);
        return asset;
      })
      .catch((err) => {
        inflight.delete(id);
        throw err;
      });
    inflight.set(id, p);
  }
  return p;
}

/**
 * React hook: resolve an assetId to its full Asset record.
 * Returns `undefined` while loading or if the id is missing.
 */
export function useAsset(assetId: string | undefined): Asset | undefined {
  const [asset, setAsset] = useState<Asset | undefined>(() => {
    if (!assetId) return undefined;
    return cache.get(assetId);
  });

  useEffect(() => {
    if (!assetId) {
      setAsset(undefined);
      return;
    }
    let cancelled = false;
    getOrFetch(assetId)
      .then((a) => {
        if (!cancelled) setAsset(a);
      })
      .catch(() => {
        if (!cancelled) setAsset(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  return asset;
}

/** Invalidate the cache entry for an asset (call after PATCH-style mutations). */
export function invalidateAsset(id: string): void {
  cache.delete(id);
  inflight.delete(id);
}

/** Imperative read for non-React contexts (e.g. workflow callbacks). */
export async function getAsset(id: string): Promise<Asset> {
  return getOrFetch(id);
}
