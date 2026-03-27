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

/** Upload a base64-encoded image to R2. Returns the storage key. */
export async function uploadBase64Image(
  bucket: R2Bucket,
  base64Data: string,
  projectId: string,
  filename?: string,
  contentType = "image/png"
): Promise<string> {
  const name = filename ?? crypto.randomUUID();
  const ext = contentType.split("/").pop() === "jpeg" ? "jpg" : contentType.split("/").pop();
  const storageKey = `projects/${projectId}/assets/${name}.${ext}`;

  const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

  await bucket.put(storageKey, bytes, {
    httpMetadata: { contentType },
  });

  return storageKey;
}

/** Upload video from an external URL to R2. Returns the storage key. */
export async function uploadVideoFromUrl(
  bucket: R2Bucket,
  videoUrl: string,
  projectId: string,
  filename?: string
): Promise<string> {
  const resp = await fetch(videoUrl);
  if (!resp.ok) throw new Error(`Failed to fetch video: ${resp.status}`);
  const bytes = await resp.arrayBuffer();

  const name = filename ?? crypto.randomUUID();
  const storageKey = `projects/${projectId}/assets/${name}.mp4`;

  await bucket.put(storageKey, bytes, {
    httpMetadata: { contentType: "video/mp4" },
  });

  return storageKey;
}

/** Upload from an external URL to R2 (streaming, no base64). Returns the storage key. */
export async function uploadFromUrl(
  bucket: R2Bucket,
  sourceUrl: string,
  projectId: string,
  filename?: string,
  contentType?: string
): Promise<string> {
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error(`Failed to fetch ${sourceUrl}: ${resp.status}`);

  const ct = contentType || resp.headers.get("content-type") || "application/octet-stream";
  const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg"
    : ct.includes("png") ? "png"
    : ct.includes("mp4") ? "mp4"
    : ct.includes("webm") ? "webm"
    : "bin";

  const name = filename ?? crypto.randomUUID();
  const storageKey = `projects/${projectId}/assets/${name}.${ext}`;

  await bucket.put(storageKey, resp.body, {
    httpMetadata: { contentType: ct },
  });

  return storageKey;
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
