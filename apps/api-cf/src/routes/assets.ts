/**
 * Asset upload & serving routes with HMAC signed URLs.
 *
 * Upload: POST /upload → R2 put → returns { storageKey }
 * Sign:   GET /assets/sign?key=xxx → returns { url: "/assets/xxx?exp=...&sig=..." }
 * Serve:  GET /assets/xxx?exp=...&sig=... → verify sig → R2 get → response
 */

import { Hono } from 'hono';
import type { Env } from '../config';
import {
  SIGNED_URL_TTL,
  getSigningKey,
  computeSignature,
  verifySignature,
} from '../services/asset-signing';

// ─── Routes ──────────────────────────────────────────────────

const assetRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST / — Upload file to R2
 */
assetRoutes.post('/', async (c) => {
  const formData = await c.req.formData();
  const fileEntry = formData.get('file');

  if (!fileEntry || typeof fileEntry === 'string') {
    return c.json({ error: 'Missing file' }, 400);
  }

  const file = fileEntry as File;
  const uuid = crypto.randomUUID().slice(0, 8);
  const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = `uploads/${uuid}-${sanitized}`;

  await c.env.R2_BUCKET.put(storageKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  return c.json({ storageKey });
});

/**
 * GET /sign?key=xxx — Generate a signed URL for an asset
 *
 * The response is private-browser-cached so a page reload reuses signed
 * URLs for the in-memory `useSignedUrl` cache window without round-
 * tripping for every <img> on the canvas. Cache TTL is conservative
 * (5min) so revoked / rotated keys still propagate within reason; the
 * URL itself is good for SIGNED_URL_TTL (1h) so a cached signature is
 * still valid by the time the browser uses it.
 */
assetRoutes.get('/sign', async (c) => {
  const storageKey = c.req.query('key');
  if (!storageKey) return c.json({ error: 'Missing key' }, 400);

  const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL;
  const key = await getSigningKey(c.env);
  const sig = await computeSignature(key, storageKey, exp);

  c.header('Cache-Control', 'private, max-age=300');
  return c.json({
    url: `/assets/${storageKey}?exp=${exp}&sig=${sig}`,
    exp,
  });
});

/**
 * POST /sign-batch — Generate signed URLs for many assets in one Worker hit.
 * Body: { keys: string[] }
 */
assetRoutes.post('/sign-batch', async (c) => {
  const body = await c.req.json().catch(() => null) as { keys?: unknown } | null;
  const keys = Array.isArray(body?.keys)
    ? [...new Set(body.keys.filter((k): k is string => typeof k === 'string' && k.length > 0))].slice(0, 100)
    : [];
  if (keys.length === 0) return c.json({ error: 'Missing keys' }, 400);

  const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL;
  const key = await getSigningKey(c.env);
  const urls = await Promise.all(
    keys.map(async (storageKey) => ({
      key: storageKey,
      url: `/assets/${storageKey}?exp=${exp}&sig=${await computeSignature(key, storageKey, exp)}`,
      exp,
    })),
  );

  c.header('Cache-Control', 'private, max-age=300');
  return c.json({ urls });
});

/**
 * GET /* — Serve file from R2 (requires valid signature)
 *
 * For images in prod (MEDIA_GATEWAY_URL set), transparently proxy through
 * Cloudflare Image Transformations which strips EXIF (incl. GPS), re-encodes
 * to an optimal format (webp/avif), and handles CDN caching.
 * For non-images, or in dev (no MEDIA_GATEWAY_URL), stream direct from R2.
 */
assetRoutes.get('/*', async (c) => {
  const path = c.req.path;
  const storageKey = path.startsWith('/assets/')
    ? path.slice('/assets/'.length)
    : path.slice(1);

  if (!storageKey || storageKey === 'sign') return c.text('Not found', 404);

  // Verify signature
  const exp = c.req.query('exp');
  const sig = c.req.query('sig');

  if (!exp || !sig) {
    return c.text('Missing signature', 403);
  }

  const expNum = parseInt(exp, 10);
  if (Date.now() / 1000 > expNum) {
    return c.text('URL expired', 403);
  }

  const key = await getSigningKey(c.env);
  if (!(await verifySignature(key, storageKey, expNum, sig))) {
    return c.text('Invalid signature', 403);
  }

  // Fetch from R2. Honor HTTP Range requests so byte-seek-capable clients
  // (ffmpeg reading mp4s with trailing moov atoms, <video> element seeks,
  // partial downloads) work correctly. Without this, ffmpeg gets the full
  // body when it asked for a tail slice and fails with "Stream ends
  // prematurely" during mp4 demuxing.
  const rangeHeader = c.req.header('range');
  const parsedRange = parseRangeHeader(rangeHeader);

  // Edge cache hit-path. The cache key strips the signature/exp so the same
  // asset hits cache regardless of which signed-URL variant the browser asks
  // for. Range requests must skip this full-body cache; returning a cached 200
  // to a byte-range client breaks video seek/demux callers that require 206.
  const cacheKey = new Request(
    new URL(`/__asset_cache/${storageKey}`, c.req.url).toString(),
  );
  if (!parsedRange) {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      // Tag the cache hit so DevTools / curl can see it (caches.default
      // hits don't get a cf-cache-status header automatically).
      const tagged = new Response(cached.body, cached);
      tagged.headers.set('x-cache', 'HIT');
      return tagged;
    }
  }

  if (parsedRange) {
    const head = await c.env.R2_BUCKET.head(storageKey);
    if (!head) return c.text('Asset not found', 404);
    const total = head.size;
    const start = parsedRange.start ?? Math.max(0, total - (parsedRange.suffix ?? 0));
    const end = parsedRange.end ?? total - 1;
    if (start >= total || end < start) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }
    const clampedEnd = Math.min(end, total - 1);
    const length = clampedEnd - start + 1;
    const object = await c.env.R2_BUCKET.get(storageKey, {
      range: { offset: start, length },
    });
    if (!object) return c.text('Asset not found', 404);
    return new Response(object.body, {
      status: 206,
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Length': String(length),
        'Content-Range': `bytes ${start}-${clampedEnd}/${total}`,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        // Asset URLs include a unique gen-id / upload-uuid in the path, so the
        // bytes at a given key never change. Mark immutable + 1y so the browser
        // disk-caches forever (no revalidation). When an asset is deleted the
        // signed URL stops being issued, so the browser cache only holds bytes
        // the user is still authorized to see.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  const object = await c.env.R2_BUCKET.get(storageKey);
  if (!object) return c.text('Asset not found', 404);

  const resp = new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Length': String(object.size),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      // Asset URLs include a unique gen-id / upload-uuid in the path, so the
      // bytes at a given key never change. Mark immutable + 1y so the browser
      // disk-caches forever (no revalidation). When an asset is deleted the
      // signed URL stops being issued, so the browser cache only holds bytes
      // the user is still authorized to see.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-cache': 'MISS',
    },
  });
  // Write back to edge cache under the signature-stripped key. Worker
  // responses don't auto-cache; using caches.default.put is the way to
  // persist them. Range requests above intentionally skip the cache —
  // partial bodies can't satisfy a non-Range hit. The cached copy keeps
  // x-cache: MISS in its headers; we overwrite it to HIT in the match
  // branch above when serving from cache.
  try {
    c.executionCtx.waitUntil(caches.default.put(cacheKey, resp.clone()));
  } catch {
    // Unit tests using app.request() do not provide an ExecutionContext.
  }
  return resp;
});

/**
 * Parse an HTTP Range header of form `bytes=START-END` / `bytes=START-` /
 * `bytes=-SUFFIX`. Returns null for malformed / unsupported shapes (multi-range
 * is rejected — R2 only serves a single contiguous slice per request, so there
 * is no clean single-response representation for multi-range).
 */
function parseRangeHeader(
  h: string | undefined,
): { start?: number; end?: number; suffix?: number } | null {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m) return null;
  const [, s, e] = m;
  if (s === '' && e === '') return null;
  if (s === '' && e !== '') return { suffix: Number(e) };
  const start = Number(s);
  if (e === '') return { start };
  return { start, end: Number(e) };
}

export { assetRoutes };
