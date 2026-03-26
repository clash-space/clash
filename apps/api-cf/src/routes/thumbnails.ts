/**
 * Thumbnail serving routes.
 * Ported from loro-sync-server/src/routes/thumbnails.ts — R2 binding renamed to R2_BUCKET.
 */

import { Hono } from 'hono';
import type { Env } from '../config';

const thumbnailRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /thumbnails/*
 * Serve thumbnail for video assets
 */
thumbnailRoutes.get('/*', async (c) => {
  const path = c.req.path;
  const objectKey = path.startsWith('/thumbnails/')
    ? path.slice('/thumbnails/'.length)
    : path.slice(1);

  if (!objectKey) {
    return c.text('Missing asset key', 400);
  }

  // Check if a pre-generated thumbnail exists
  const thumbnailKey = objectKey.replace(/\.(mp4|mov|avi|webm)$/i, '.jpg');
  const thumbnailObject = await c.env.R2_BUCKET.get(`thumbnails/${thumbnailKey}`);

  if (thumbnailObject) {
    const contentType = thumbnailObject.httpMetadata?.contentType || 'image/jpeg';

    return new Response(thumbnailObject.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // Fallback: return original video (browser will handle with #t=0.1)
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

export { thumbnailRoutes };
