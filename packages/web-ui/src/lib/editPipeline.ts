/**
 * Edit pipeline — client-side execution + server upload for image-editor /
 * video-clipper nodes. Parallel to (and intentionally separate from) the
 * generation pipeline:
 *
 *   GenerationPipeline: prompt → workflow → external model API → R2 → asset
 *   EditPipeline:       source asset → browser canvas → R2 PUT → asset
 *
 * Why split: generation is async (can take minutes, retry on the workflow
 * side), edits are deterministic and finish in a single round-trip. Sharing
 * `pendingTask`/`status:'generating'` lifecycle for these would force every
 * caller to handle async polling for what's effectively a synchronous op.
 *
 * Output is always a NEW asset (CoW). The source row is never mutated.
 */

import {
  type ImageEditParams,
  type VideoClipParams,
  type CropRect,
  EDIT_KIND,
  type EditKind,
} from '@clash/shared-types';
import { getSignedUrl } from './hooks/useSignedUrl';

export interface EditApplyResult {
  assetId: string;
  srcR2Key: string;
  coverR2Key: string | null;
}

/**
 * Apply an image edit (crop + rotation) entirely in the browser, then POST
 * the rendered PNG to /api/v1/edits which creates a new asset row pointing
 * at the source via `sources: [{ role: 'edit-source' }]`.
 *
 * Identity edit (no crop, rotation:0) still creates a new asset — that's the
 * caller's intent if they explicitly clicked Apply with default params.
 */
export async function applyImageEdit(input: {
  projectId: string;
  sourceAssetId: string;
  sourceR2Key: string;
  params: ImageEditParams;
}): Promise<EditApplyResult> {
  const blob = await renderImageEdit(input.sourceR2Key, input.params);
  return await postEdit({
    projectId: input.projectId,
    sourceAssetId: input.sourceAssetId,
    editKind: EDIT_KIND.ImageEditor,
    outputKind: 'image',
    blob,
    params: input.params,
  });
}

/**
 * Apply a video screenshot — pull a frame at `frameTimeSec` from the source
 * video element via canvas.drawImage, upload as a new image asset.
 *
 * Crop mode (time-range trimming) is not implemented client-side: it would
 * require ffmpeg.wasm (~25MB) for a quality-preserving re-encode. Caller
 * should route crop requests through a future server endpoint instead.
 */
export async function applyVideoScreenshot(input: {
  projectId: string;
  sourceAssetId: string;
  sourceR2Key: string;
  params: Extract<VideoClipParams, { mode: 'screenshot' }>;
}): Promise<EditApplyResult> {
  const blob = await renderVideoScreenshot(input.sourceR2Key, input.params.frameTimeSec);
  return await postEdit({
    projectId: input.projectId,
    sourceAssetId: input.sourceAssetId,
    editKind: EDIT_KIND.VideoClipper,
    outputKind: 'image',
    blob,
    params: input.params,
  });
}

// ─── Internal: client-side renderers ────────────────────────

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // crossOrigin so we can read pixels — signed R2 URL serves CORS-permissive.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${String(e)}`));
    img.src = url;
  });
}

/** Render image edit to a PNG blob. Pure browser canvas. */
async function renderImageEdit(sourceR2Key: string, params: ImageEditParams): Promise<Blob> {
  const url = await getSignedUrl(sourceR2Key);
  const img = await loadImage(url);

  // Order: crop first (in source pixel space), THEN rotate. Reverse order
  // would force callers to recompute the crop rect after rotation, which is
  // awkward in a UI that lets you crop on the rotated preview.
  const crop: CropRect = params.crop ?? {
    x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight,
  };
  const rotation = params.rotation ?? 0;

  // Stage 1: crop into an offscreen canvas.
  const cropped = document.createElement('canvas');
  cropped.width = crop.width;
  cropped.height = crop.height;
  const cropCtx = cropped.getContext('2d');
  if (!cropCtx) throw new Error('Canvas 2D context unavailable');
  cropCtx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);

  // Stage 2: rotate. 90/270 swaps dimensions; 0/180 keeps them.
  const out = document.createElement('canvas');
  const swap = rotation === 90 || rotation === 270;
  out.width = swap ? crop.height : crop.width;
  out.height = swap ? crop.width : crop.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(cropped, -crop.width / 2, -crop.height / 2);

  return await canvasToBlob(out, 'image/png');
}

/** Render a single frame from a video at the given time, as PNG. */
async function renderVideoScreenshot(sourceR2Key: string, frameTimeSec: number): Promise<Blob> {
  const url = await getSignedUrl(sourceR2Key);
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('Failed to load video')); };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
  });

  // Seek and wait for the frame to be ready. Some browsers fire `seeked`
  // before the new frame is actually decoded — `requestVideoFrameCallback`
  // (available in Chromium / recent Safari) is the correct signal, with a
  // `seeked` fallback for Firefox.
  video.currentTime = Math.min(frameTimeSec, Math.max(0, video.duration - 0.001));
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const onError = () => { if (!done) { done = true; reject(new Error('Seek failed')); } };
    const rvfc = (video as unknown as {
      requestVideoFrameCallback?: (cb: () => void) => void;
    }).requestVideoFrameCallback;
    if (typeof rvfc === 'function') {
      rvfc.call(video, finish);
    } else {
      video.addEventListener('seeked', finish, { once: true });
    }
    video.addEventListener('error', onError, { once: true });
    setTimeout(finish, 1500); // belt-and-suspenders timeout
  });

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(video, 0, 0);

  return await canvasToBlob(canvas, 'image/png');
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas toBlob returned null'));
    }, mime);
  });
}

// ─── Internal: server upload ────────────────────────────────

async function postEdit(input: {
  projectId: string;
  sourceAssetId: string;
  editKind: EditKind;
  outputKind: 'image' | 'video' | 'audio';
  blob: Blob;
  params: unknown;
}): Promise<EditApplyResult> {
  const form = new FormData();
  form.append('file', input.blob, `edit.${input.outputKind === 'image' ? 'png' : 'bin'}`);
  form.append('projectId', input.projectId);
  form.append('sourceAssetId', input.sourceAssetId);
  form.append('editKind', input.editKind);
  form.append('outputKind', input.outputKind);
  form.append('editParams', JSON.stringify(input.params));

  const res = await fetch('/api/v1/edits', { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Edit upload failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as EditApplyResult;
  return json;
}
