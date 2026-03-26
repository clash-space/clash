type AssetType = "image" | "video" | "audio" | "text";

const EXTENSION_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

/** Upload a base64-encoded image to R2. Returns [storageKey, publicUrl]. */
export async function uploadBase64Image(
  bucket: R2Bucket,
  publicBaseUrl: string,
  base64Data: string,
  projectId: string,
  filename?: string,
  contentType = "image/png"
): Promise<[string, string]> {
  const name = filename ?? crypto.randomUUID();
  const ext = contentType.split("/").pop() === "jpeg" ? "jpg" : contentType.split("/").pop();
  const storageKey = `projects/${projectId}/assets/${name}.${ext}`;

  const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

  await bucket.put(storageKey, bytes, {
    httpMetadata: { contentType },
  });

  return [storageKey, `${publicBaseUrl}/${storageKey}`];
}

/** Upload video from an external URL to R2. Returns [storageKey, publicUrl]. */
export async function uploadVideoFromUrl(
  bucket: R2Bucket,
  publicBaseUrl: string,
  videoUrl: string,
  projectId: string,
  filename?: string
): Promise<[string, string]> {
  const resp = await fetch(videoUrl);
  if (!resp.ok) throw new Error(`Failed to fetch video: ${resp.status}`);
  const bytes = await resp.arrayBuffer();

  const name = filename ?? crypto.randomUUID();
  const storageKey = `projects/${projectId}/assets/${name}.mp4`;

  await bucket.put(storageKey, bytes, {
    httpMetadata: { contentType: "video/mp4" },
  });

  return [storageKey, `${publicBaseUrl}/${storageKey}`];
}

/** Delete an asset from R2. */
export async function deleteAsset(bucket: R2Bucket, storageKey: string): Promise<void> {
  await bucket.delete(storageKey);
}

/** Check if an asset exists in R2. */
export async function assetExists(bucket: R2Bucket, storageKey: string): Promise<boolean> {
  const obj = await bucket.head(storageKey);
  return obj !== null;
}
