/**
 * Asset upload & serving routes with HMAC signed URLs.
 *
 * Upload: POST /upload → R2 put → returns { storageKey }
 * Sign:   GET /assets/sign?key=xxx → returns { url: "/assets/xxx?exp=...&sig=..." }
 * Serve:  GET /assets/xxx?exp=...&sig=... → verify sig → R2 get → response
 */

import { Hono } from 'hono';
import type { Env } from '../config';

// ─── HMAC Signing ────────────────────────────────────────────

const SIGNED_URL_TTL = 3600; // 1 hour

async function getSigningKey(env: Env): Promise<CryptoKey> {
  // Use JWT_SECRET as HMAC key (already in env for auth)
  const secret = env.JWT_SECRET || 'dev-asset-signing-key';
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function signUrl(key: CryptoKey, storageKey: string, exp: number): Promise<string> {
  const data = new TextEncoder().encode(`${storageKey}:${exp}`);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, c =>
    c === '+' ? '-' : c === '/' ? '_' : '',
  );
}

async function verifySignature(key: CryptoKey, storageKey: string, exp: number, sig: string): Promise<boolean> {
  const expected = await signUrl(key, storageKey, exp);
  return expected === sig;
}

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
  const sig = await signUrl(key, storageKey, exp);

  return c.json({
    url: `/assets/${storageKey}?exp=${exp}&sig=${sig}`,
    exp,
  });
});

/**
 * GET /* — Serve file from R2 (requires valid signature)
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

  // Fetch from R2
  const object = await c.env.R2_BUCKET.get(storageKey);
  if (!object) return c.text('Asset not found', 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

export { assetRoutes };
