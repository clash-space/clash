import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

/**
 * Generate video thumbnail by proxying to Cloudflare Worker
 * This endpoint forwards the request to loro-sync-server which can:
 * 1. Extract video frames using Cloudflare Stream API
 * 2. Use Media Transformations if available
 * 3. Return a cached thumbnail from R2
 */
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ key: string[] }> }
) {
    try {
        const { key } = await context.params;
        const objectKey = key.join('/');

        console.log('[Thumbnail] Request:', { objectKey });

        if (!objectKey) {
            return NextResponse.json({ error: 'Missing object key' }, { status: 400 });
        }

        // Forward to api-cf via service binding or fallback URL
        const { env } = await getCloudflareContext({ async: true });
        const apiCf = (env as any).API_CF as { fetch: typeof fetch } | undefined;

        console.log('[Thumbnail] Forwarding:', objectKey);

        const response = apiCf
            ? await apiCf.fetch(`https://api-cf/thumbnails/${objectKey}`)
            : await fetch(`${process.env.API_CF_URL || 'http://localhost:8789'}/thumbnails/${objectKey}`, {
                next: { revalidate: 3600 }
            });

        if (!response.ok) {
            console.error('[Thumbnail] Upstream error:', response.status);
            return NextResponse.json({ error: 'Thumbnail not available' }, { status: response.status });
        }

        const imageBuffer = await response.arrayBuffer();

        return new NextResponse(imageBuffer, {
            status: 200,
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'image/jpeg',
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });

    } catch (error: any) {
        console.error('[Thumbnail] Error:', error);
        return NextResponse.json(
            { error: 'Failed to generate thumbnail' },
            { status: 500 }
        );
    }
}
