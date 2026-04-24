/**
 * Image metadata extraction — probes pixel dimensions for image assets.
 *
 * Reads the first 64 KiB of the R2 object directly from the worker and parses
 * the format header (PNG IHDR / JPEG SOF / WebP VP8* / GIF). No ffmpeg, no
 * network round-trip, no render-server dependency. The header is always
 * within the first few KB for standard encoders, so 64 KiB is a safe upper
 * bound.
 *
 * `parseImageDimensions` is also exported for callers that already hold
 * the bytes in memory (e.g. thumbnail's CF-MT path, which recovers the
 * source video's resolution by parsing the extracted frame's JPEG header).
 */
import type { Env } from "../config";
import { log } from "../logger";

export interface ImageMetadataResult {
  width: number;
  height: number;
}

/** Bytes read from R2 for header inspection. 64 KiB is well past any normal
 *  JPEG APP/SOF segment chain or PNG IHDR. */
const HEADER_BYTES = 64 * 1024;

// ─── Shared: in-memory header parser ─────────────────────────
//
// Zero-network fallback for callers that already hold the bytes. Handles PNG,
// JPEG (SOF0–3/5–7/9–11/13–15), WebP (VP8 / VP8L / VP8X), and GIF. Returns
// `null` on unrecognized formats so callers can decide whether to escalate
// to a network probe.

/**
 * Parse image pixel dimensions from raw bytes by inspecting format headers.
 * Returns null for unknown/unsupported formats — caller should fall back.
 */
export function parseImageDimensions(bytes: Uint8Array): ImageMetadataResult | null {
  if (bytes.length < 24) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR at offset 16, width@16 height@20 (big-endian u32)
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
  }

  // GIF: "GIF8" at start, width@6 height@8 (little-endian u16)
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  }

  // WebP: "RIFF" ... "WEBP" at offsets 0..12, then VP8 / VP8L / VP8X
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const fourCC = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (fourCC === "VP8 ") {
      // Lossy VP8: 26-byte frame header; width@26 height@28 (little-endian u16, 14 bits used).
      if (bytes.length < 30) return null;
      const w = dv.getUint16(26, true) & 0x3fff;
      const h = dv.getUint16(28, true) & 0x3fff;
      return { width: w, height: h };
    }
    if (fourCC === "VP8L") {
      // Lossless VP8L: signature 0x2f at offset 20, then 14-bit width-1 / height-1 packed.
      if (bytes.length < 25) return null;
      const b0 = bytes[21],
        b1 = bytes[22],
        b2 = bytes[23],
        b3 = bytes[24];
      const w = 1 + (((b1 & 0x3f) << 8) | b0);
      const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width: w, height: h };
    }
    if (fourCC === "VP8X") {
      // Extended VP8X: canvas width-1 at offset 24 (24-bit LE), height-1 at offset 27.
      if (bytes.length < 30) return null;
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width: w, height: h };
    }
    return null;
  }

  // JPEG: start-of-image FFD8, scan segments until a SOF marker.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 8 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      // Skip fill bytes (0xFF padding between markers is legal).
      while (i < bytes.length && bytes[i] === 0xff) i++;
      const marker = bytes[i];
      i++;
      // Standalone markers (no length field) — shouldn't appear before SOS but guard anyway.
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (i + 1 >= bytes.length) return null;
      const segLen = dv.getUint16(i, false);
      // SOF0..SOF15 excluding DHT (C4), JPG (C8), DAC (CC)
      if (
        (marker >= 0xc0 && marker <= 0xcf) &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        // Payload: precision(1) height(2) width(2) ...
        if (i + 7 >= bytes.length) return null;
        const h = dv.getUint16(i + 3, false);
        const w = dv.getUint16(i + 5, false);
        return { width: w, height: h };
      }
      i += segLen;
    }
    return null;
  }

  return null;
}

/**
 * Resolve an image's pixel dimensions by reading its R2 header. Same code
 * path for dev and prod — the image is already in our bucket, so the cheapest
 * thing to do is read the first 64 KiB and parse the format signature.
 */
export async function extractImageMetadata(
  env: Env,
  imageR2Key: string,
): Promise<ImageMetadataResult> {
  const object = await env.R2_BUCKET.get(imageR2Key, {
    range: { offset: 0, length: HEADER_BYTES },
  });
  if (!object) {
    throw new Error(`R2 object not found: ${imageR2Key}`);
  }
  const buf = await object.arrayBuffer();
  const dims = parseImageDimensions(new Uint8Array(buf));
  if (!dims) {
    throw new Error(
      `unsupported image format or malformed header: ${imageR2Key}`,
    );
  }
  log.info("image probe via R2 header", {
    r2Key: imageR2Key,
    width: dims.width,
    height: dims.height,
  });
  return dims;
}

