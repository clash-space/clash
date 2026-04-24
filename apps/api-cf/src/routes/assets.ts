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
 */
assetRoutes.get('/sign', async (c) => {
  const storageKey = c.req.query('key');
  if (!storageKey) return c.json({ error: 'Missing key' }, 400);

  const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL;
  const key = await getSigningKey(c.env);
  const sig = await computeSignature(key, storageKey, exp);

  return c.json({
    url: `/assets/${storageKey}?exp=${exp}&sig=${sig}`,
    exp,
  });
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

  // If prod (MEDIA_GATEWAY_URL is set), check if the object is an image.
  // Use R2.head() since we only need Content-Type to decide routing.
  const mediaGatewayUrl = c.env.MEDIA_GATEWAY_URL;
  if (mediaGatewayUrl) {
    const head = await c.env.R2_BUCKET.head(storageKey);
    if (!head) return c.text('Asset not found', 404);

    const contentType = head.httpMetadata?.contentType || '';
    if (contentType.startsWith('image/')) {
      // Rebuild the absolute signed URL and forward through CF Image
      // Transformations. CF strips EXIF/metadata and chooses the best format.
      const origin = mediaGatewayUrl.replace(/\/+$/, '');
      const signedSelfUrl = `${origin}/assets/${storageKey}?exp=${exp}&sig=${sig}`;
      const cfUrl = `${origin}/cdn-cgi/image/format=auto,metadata=none/${signedSelfUrl}`;

      try {
        const cfResp = await fetch(cfUrl);
        if (cfResp.ok) {
          const headers = new Headers();
          const respCt = cfResp.headers.get('Content-Type');
          if (respCt) headers.set('Content-Type', respCt);
          headers.set('Access-Control-Allow-Origin', '*');
          headers.set('Cache-Control', 'public, max-age=3600');
          return new Response(cfResp.body, {
            status: cfResp.status,
            headers,
          });
        }
        console.warn(
          `[assets] CF Image Transformations returned ${cfResp.status} for ${storageKey}; falling back to R2`,
        );
      } catch (err) {
        console.warn(
          `[assets] CF Image Transformations fetch failed for ${storageKey}; falling back to R2:`,
          err,
        );
      }
      // Fall through to R2.get below on CF failure.
    }
  }

  // Fetch from R2. Honor HTTP Range requests so byte-seek-capable clients
  // (ffmpeg reading mp4s with trailing moov atoms, <video> element seeks,
  // partial downloads) work correctly. Without this, ffmpeg gets the full
  // body when it asked for a tail slice and fails with "Stream ends
  // prematurely" during mp4 demuxing.
  const rangeHeader = c.req.header('range');
  const parsedRange = parseRangeHeader(rangeHeader);

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
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  const object = await c.env.R2_BUCKET.get(storageKey);
  if (!object) return c.text('Asset not found', 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Length': String(object.size),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
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
