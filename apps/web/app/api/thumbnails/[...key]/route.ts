import { NextRequest, NextResponse } from 'next/server';

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

        // Forward to api-cf thumbnail endpoint
        const apiCfUrl = process.env.API_CF_URL || 'http://localhost:8789';
        const httpLoroUrl = apiCfUrl;

        const thumbnailUrl = `${httpLoroUrl}/thumbnails/${objectKey}`;

        console.log('[Thumbnail] Forwarding to:', thumbnailUrl);

        const response = await fetch(thumbnailUrl, {
            next: { revalidate: 3600 } // Cache for 1 hour
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
