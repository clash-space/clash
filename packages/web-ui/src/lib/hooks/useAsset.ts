
import { useEffect, useState } from 'react';
import type { Asset } from '@clash/shared-types';
import { fetchWithRetry } from './retryFetch';
import { primeSignedUrl } from './useSignedUrl';

/**
 * In-memory asset cache shared across all hook instances.
 * Asset rows are write-mostly-once (created on upload/generation, cover/desc patched once),
 * so we cache forever and invalidate manually when our own code mutates.
 */
const cache = new Map<string, Asset>();
const inflight = new Map<string, Promise<Asset>>();
const pending = new Map<string, {
  resolve: (asset: Asset) => void;
  reject: (err: unknown) => void;
}>();
let pendingTimer: ReturnType<typeof setTimeout> | undefined;

async function fetchAsset(id: string): Promise<Asset> {
  const res = await fetchWithRetry(`/api/v1/assets/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Asset fetch failed: ${res.status}`);
  return (await res.json()) as Asset;
}

async function fetchAssetsBatch(ids: string[]): Promise<Asset[]> {
  const res = await fetchWithRetry('/api/v1/assets/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Asset batch fetch failed: ${res.status}`);
  const json = (await res.json()) as { assets?: Asset[] };
  return json.assets ?? [];
}

function cacheAsset(asset: Asset): void {
  cache.set(asset.id, asset);
  primeSignedUrl(asset.srcR2Key, asset.signedUrl, asset.signedUrlExp);
  primeSignedUrl(asset.coverR2Key ?? undefined, asset.signedCoverUrl, asset.signedCoverUrlExp);
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

  const ids = entries.map(([id]) => id);
  try {
    if (ids.length === 1) {
      const asset = await fetchAsset(ids[0]);
      cacheAsset(asset);
      entries[0][1].resolve(asset);
      return;
    }

    const assets = await fetchAssetsBatch(ids);
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    for (const asset of assets) cacheAsset(asset);

    for (const [id, handlers] of entries) {
      const asset = byId.get(id);
      if (asset) {
        handlers.resolve(asset);
      } else {
        handlers.reject(new Error(`Asset ${id} not found`));
      }
    }
  } catch (err) {
    for (const [, handlers] of entries) handlers.reject(err);
  } finally {
    for (const id of ids) inflight.delete(id);
  }
}

function getOrFetch(id: string): Promise<Asset> {
  const cached = cache.get(id);
  if (cached) return Promise.resolve(cached);

  let p = inflight.get(id);
  if (!p) {
    p = new Promise<Asset>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      scheduleFlush();
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
  pending.delete(id);
}

/** Imperative read for non-React contexts (e.g. workflow callbacks). */
export async function getAsset(id: string): Promise<Asset> {
  return getOrFetch(id);
}
