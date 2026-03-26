/**
 * Asset upload & serving routes.
 * Ported from loro-sync-server/src/routes/assets.ts — R2 binding renamed to R2_BUCKET.
 */

import { Hono } from 'hono';
import type { Env } from '../config';

function getAssetUrl(env: Env, objectKey: string): string {
  if (env.WORKER_PUBLIC_URL) {
    const baseUrl = env.WORKER_PUBLIC_URL.replace(/\/$/, '');
    return `${baseUrl}/assets/${objectKey}`;
  }
  if (env.R2_PUBLIC_URL) {
    return `${env.R2_PUBLIC_URL}/${objectKey}`;
  }
  return `http://localhost:8789/assets/${objectKey}`;
}

const assetRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /upload
 * Upload files to R2 storage
 */
assetRoutes.post('/', async (c) => {
  const formData = await c.req.formData();
  const fileEntry = formData.get('file');
  const projectId = formData.get('projectId') as string;

  if (!fileEntry || typeof fileEntry === 'string' || !projectId) {
    return c.json({ error: 'Missing file or projectId' }, 400);
  }

  const file = fileEntry as File;

  const timestamp = Date.now();
  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `projects/${projectId}/assets/${timestamp}-${sanitizedFileName}`;

  const arrayBuffer = await file.arrayBuffer();
  await c.env.R2_BUCKET.put(objectKey, arrayBuffer, {
    httpMetadata: {
      contentType: file.type || 'application/octet-stream',
    },
  });

  const assetUrl = getAssetUrl(c.env, objectKey);

  return c.json({
    storageKey: objectKey,
    url: assetUrl,
  });
});

/**
 * GET /assets/*
 * Serve files from R2 storage
 */
assetRoutes.get('/*', async (c) => {
  const path = c.req.path;
  const objectKey = path.startsWith('/assets/')
    ? path.slice('/assets/'.length)
    : path.slice(1);

  if (!objectKey) {
    return c.text('Missing asset key', 400);
  }

  const object = await c.env.R2_BUCKET.get(objectKey);
  if (!object) {
    return c.text('Asset not found', 404);
  }

  const contentType = object.httpMetadata?.contentType || 'application/octet-stream';

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=31536000',
    },
  });
});

export { assetRoutes };
