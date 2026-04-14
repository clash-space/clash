import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { uploadBufferToR2 } from '@/lib/r2-upload';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file');
        const projectId = formData.get('projectId') as string | null;
        const type = (formData.get('type') as string | null) || 'asset';

        if (!file || !(file instanceof File)) {
            return NextResponse.json(
                { error: 'Missing required field: file' },
                { status: 400 }
            );
        }

        const arrayBuffer = await file.arrayBuffer();
        const originalName = file.name || `${type}-upload`;
        const ext = path.extname(originalName);
        const inferredExt = !ext && file.type ? `.${file.type.split('/')[1] || 'bin'}` : '';
        const baseName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
        const finalFileName = `${type}-${Date.now()}-${baseName}${ext || inferredExt}`;

        const { storageKey, url } = await uploadBufferToR2({
            buffer: arrayBuffer,
            fileName: finalFileName,
            contentType: file.type || 'application/octet-stream',
        });

        return NextResponse.json({ storageKey, url });
    } catch (error: any) {
        console.error('Asset upload error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to upload asset' },
            { status: 500 }
        );
    }
}
