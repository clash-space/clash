/**
 * R2 Upload utility for frontend
 * Uses S3-compatible API to upload files to Cloudflare R2 directly
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const sanitizeFileName = (fileName: string) => fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

const buildStorageKey = (fileName: string) => {
    const uuid = crypto.randomUUID().slice(0, 8);
    return `uploads/${uuid}-${sanitizeFileName(fileName)}`;
};

// Initialize R2 client with environment variables
export function getR2Client() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const rawEndpoint = process.env.R2_ENDPOINT;

    if (!accountId || !accessKeyId || !secretAccessKey) {
        throw new Error('R2 credentials not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env');
    }

    return new S3Client({
        region: 'auto',
        endpoint: rawEndpoint,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
        forcePathStyle: true,
    });
}

/**
 * Upload base64 image to R2 using S3 API directly
 */
export async function uploadBase64ImageToR2(params: {
    base64Data: string;
    projectId?: string;
    fileName: string;
    contentType?: string;
}) {
    const { base64Data, fileName, contentType = 'image/png' } = params;

    console.log('[R2 Upload] Using S3 API directly');

    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrl = process.env.R2_PUBLIC_URL;

    if (!bucketName || !publicUrl) {
        throw new Error('R2 bucket not configured. Set R2_BUCKET_NAME and R2_PUBLIC_URL in .env');
    }

    const normalizedBase64 = base64Data.includes('base64,')
        ? base64Data.split('base64,')[1]
        : base64Data;

    const buffer = Buffer.from(normalizedBase64, 'base64');
    const storageKey = buildStorageKey(fileName);

    const client = getR2Client();
    await client.send(
        new PutObjectCommand({
            Bucket: bucketName,
            Key: storageKey,
            Body: buffer,
            ContentType: contentType,
        })
    );

    const url = `${publicUrl}/${storageKey}`;
    return { storageKey, url };
}

/**
 * Download video from URL and upload to R2 using S3 API
 */
export async function uploadVideoFromUrlToR2(params: {
    videoUrl: string;
    projectId?: string;
    fileName: string;
}) {
    const { videoUrl, fileName } = params;

    console.log('[R2 Upload] Downloading and uploading video via S3 API');

    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrl = process.env.R2_PUBLIC_URL;

    if (!bucketName || !publicUrl) {
        throw new Error('R2 bucket not configured. Set R2_BUCKET_NAME and R2_PUBLIC_URL in .env');
    }

    // Download video
    const response = await fetch(videoUrl);
    if (!response.ok) {
        throw new Error(`Failed to download video: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate storage key
    const storageKey = buildStorageKey(`${fileName}.mp4`);

    // Upload to R2
    const client = getR2Client();
    await client.send(
        new PutObjectCommand({
            Bucket: bucketName,
            Key: storageKey,
            Body: buffer,
            ContentType: 'video/mp4',
        })
    );

    const url = `${publicUrl}/${storageKey}`;
    return { storageKey, url };
}

/**
 * Upload arbitrary binary data (Buffer/ArrayBuffer/Uint8Array) to R2 using S3 API
 */
export async function uploadBufferToR2(params: {
    buffer: Buffer | ArrayBuffer | Uint8Array;
    projectId?: string;
    fileName: string;
    contentType?: string;
}) {
    const { buffer, fileName, contentType = 'application/octet-stream' } = params;

    console.log('[R2 Upload Buffer] Using S3 API directly');

    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrl = process.env.R2_PUBLIC_URL;

    if (!bucketName || !publicUrl) {
        throw new Error('R2 bucket not configured. Set R2_BUCKET_NAME and R2_PUBLIC_URL in .env');
    }

    const normalizedBuffer = Buffer.isBuffer(buffer)
        ? buffer
        : buffer instanceof ArrayBuffer
            ? Buffer.from(buffer)
            : Buffer.from(buffer);

    const storageKey = buildStorageKey(fileName);

    const client = getR2Client();
    await client.send(
        new PutObjectCommand({
            Bucket: bucketName,
            Key: storageKey,
            Body: normalizedBuffer,
            ContentType: contentType,
        })
    );

    const url = `${publicUrl}/${storageKey}`;
    return { storageKey, url };
}
