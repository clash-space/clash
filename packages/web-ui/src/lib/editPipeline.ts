/** Asset action client. Specs and invocation semantics live in shared-types;
 * this module contains browser/server executor adapters only. Outputs are
 * always new immutable assets (copy-on-write). */

import {
  type ImageEditParams,
  type VideoClipParams,
  type CropRect,
  ASSET_ACTION_ID,
  createAssetActionInvocation,
  legacyEditOriginForSurface,
  type AssetEditActionInvocation,
  type ActionSurface,
  ResolvedAssetSchema,
} from "@clash/shared-types";
import { runtimeApiUrl } from "./runtimeConfig";

export interface EditApplyResult {
  assetId: string;
}

const editRunIds = new WeakMap<object, string>();

function editActionRunId(input: object & { actionRunId?: string }): string {
  if (input.actionRunId) return input.actionRunId;
  const existing = editRunIds.get(input);
  if (existing) return existing;
  const created = `edit:${globalThis.crypto.randomUUID()}`;
  editRunIds.set(input, created);
  return created;
}

function actionSurface(
  origin?: "canvas-node" | "asset-preview",
): ActionSurface {
  return origin === "asset-preview" ? "asset-preview" : "canvas";
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
  actionRunId?: string;
  projectId: string;
  sourceAssetId: string;
  sourceUrl: string;
  params: ImageEditParams;
  origin?: "canvas-node" | "asset-preview";
}): Promise<EditApplyResult> {
  const blob = await renderImageEdit(input.sourceUrl, input.params);
  const invocation = createAssetActionInvocation({
    actionId: ASSET_ACTION_ID.ImageEditor,
    projectId: input.projectId,
    source: { assetId: input.sourceAssetId, kind: "image" },
    params: input.params,
    surface: actionSurface(input.origin),
  });
  return await postEdit({
    actionRunId: editActionRunId(input),
    invocation,
    outputKind: "image",
    blob,
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
  actionRunId?: string;
  projectId: string;
  sourceAssetId: string;
  sourceUrl: string;
  params: Extract<VideoClipParams, { mode: "screenshot" }>;
  origin?: "canvas-node" | "asset-preview";
}): Promise<EditApplyResult> {
  const blob = await renderVideoScreenshot(
    input.sourceUrl,
    input.params.frameTimeSec,
  );
  const invocation = createAssetActionInvocation({
    actionId: ASSET_ACTION_ID.VideoClipper,
    projectId: input.projectId,
    source: { assetId: input.sourceAssetId, kind: "video" },
    params: input.params,
    surface: actionSurface(input.origin),
  });
  return await postEdit({
    actionRunId: editActionRunId(input),
    invocation,
    outputKind: "image",
    blob,
  });
}

export async function applyVideoCrop(input: {
  actionRunId?: string;
  projectId: string;
  sourceAssetId: string;
  params: Extract<VideoClipParams, { mode: "crop" }>;
  origin?: "canvas-node" | "asset-preview";
}): Promise<EditApplyResult> {
  const surface = actionSurface(input.origin);
  const invocation = createAssetActionInvocation({
    actionId: ASSET_ACTION_ID.VideoClipper,
    projectId: input.projectId,
    source: { assetId: input.sourceAssetId, kind: "video" },
    params: input.params,
    surface,
  });
  const body = {
    actionRunId: editActionRunId(input),
    projectId: input.projectId,
    sourceAssetId: input.sourceAssetId,
    params: input.params,
    origin: input.origin ?? "canvas-node",
    invocation,
  };
  const res = await fetch(runtimeApiUrl("/api/v1/edits/video-crop"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Video crop failed (${res.status}): ${text}`);
  }
  const asset = ResolvedAssetSchema.parse(await res.json());
  return { assetId: asset.id };
}

// ─── Internal: client-side renderers ────────────────────────

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // crossOrigin so we can read pixels — signed R2 URL serves CORS-permissive.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) =>
      reject(new Error(`Failed to load image: ${String(e)}`));
    img.src = url;
  });
}

/** Render image edit to a PNG blob. Pure browser canvas. */
async function renderImageEdit(
  sourceUrl: string,
  params: ImageEditParams,
): Promise<Blob> {
  const url = sourceUrl;
  const img = await loadImage(url);

  // Order: crop first (in source pixel space), THEN rotate. Reverse order
  // would force callers to recompute the crop rect after rotation, which is
  // awkward in a UI that lets you crop on the rotated preview.
  const crop: CropRect = params.crop ?? {
    x: 0,
    y: 0,
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
  const rotation = params.rotation ?? 0;

  // Stage 1: crop into an offscreen canvas.
  const cropped = document.createElement("canvas");
  cropped.width = crop.width;
  cropped.height = crop.height;
  const cropCtx = cropped.getContext("2d");
  if (!cropCtx) throw new Error("Canvas 2D context unavailable");
  cropCtx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );

  // Stage 2: rotate. 90/270 swaps dimensions; 0/180 keeps them.
  const out = document.createElement("canvas");
  const swap = rotation === 90 || rotation === 270;
  out.width = swap ? crop.height : crop.width;
  out.height = swap ? crop.width : crop.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(cropped, -crop.width / 2, -crop.height / 2);

  return await canvasToBlob(out, "image/png");
}

/** Render a single frame from a video at the given time, as PNG. */
async function renderVideoScreenshot(
  sourceUrl: string,
  frameTimeSec: number,
): Promise<Blob> {
  const url = sourceUrl;
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Failed to load video"));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);
  });

  // Seek and wait for the frame to be ready. Some browsers fire `seeked`
  // before the new frame is actually decoded — `requestVideoFrameCallback`
  // (available in Chromium / recent Safari) is the correct signal, with a
  // `seeked` fallback for Firefox.
  video.currentTime = Math.min(
    frameTimeSec,
    Math.max(0, video.duration - 0.001),
  );
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    const onError = () => {
      if (!done) {
        done = true;
        reject(new Error("Seek failed"));
      }
    };
    const rvfc = (
      video as unknown as {
        requestVideoFrameCallback?: (cb: () => void) => void;
      }
    ).requestVideoFrameCallback;
    if (typeof rvfc === "function") {
      rvfc.call(video, finish);
    } else {
      video.addEventListener("seeked", finish, { once: true });
    }
    video.addEventListener("error", onError, { once: true });
    setTimeout(finish, 1500); // belt-and-suspenders timeout
  });

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(video, 0, 0);

  return await canvasToBlob(canvas, "image/png");
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas toBlob returned null"));
    }, mime);
  });
}

// ─── Internal: server upload ────────────────────────────────

async function postEdit(input: {
  actionRunId: string;
  invocation: AssetEditActionInvocation;
  outputKind: "image" | "video" | "audio";
  blob: Blob;
}): Promise<EditApplyResult> {
  const { invocation } = input;
  const form = new FormData();
  form.append(
    "file",
    input.blob,
    `edit.${input.outputKind === "image" ? "png" : "bin"}`,
  );
  form.append("actionRunId", input.actionRunId);
  form.append("projectId", invocation.projectId);
  form.append("sourceAssetId", invocation.source.assetId);
  form.append("editKind", invocation.actionId);
  form.append("outputKind", input.outputKind);
  form.append("editParams", JSON.stringify(invocation.params));
  form.append("origin", legacyEditOriginForSurface(invocation.surface));
  form.append("invocation", JSON.stringify(invocation));

  const res = await fetch(runtimeApiUrl("/api/v1/edits"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Edit upload failed (${res.status}): ${text}`);
  }
  const asset = ResolvedAssetSchema.parse(await res.json());
  return { assetId: asset.id };
}
