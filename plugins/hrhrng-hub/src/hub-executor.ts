import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";
import {
  ProviderExecutionError,
  providerHttpError,
} from "@clash/action-sdk";

import type { ResolvedReference } from "./executor-contract";

function rejectedInvalidRequest(message: string): ProviderExecutionError {
  return new ProviderExecutionError({
    code: "invalid_request",
    message,
    retryable: false,
    requestState: "rejected",
  });
}

function invalidResponse(
  message: string,
  requestState: "rejected" | "unknown" | "accepted",
): ProviderExecutionError {
  return new ProviderExecutionError({
    code: "invalid_response",
    message,
    retryable: false,
    requestState,
  });
}

/**
 * MiniMax Hub's generation API, translated.
 *
 * Hub queues almost everything: a submit returns a `task_id`, and the result arrives at a status
 * endpoint some minutes later. Both halves live here and neither waits -- `submitHubModel` sends the
 * work and reports what Hub answered, `pollHubModel` asks once. The host decides when to ask again,
 * because after a restart it is the only party that still remembers the task.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * One authenticated call to Hub.
 *
 * The credential used to travel as a `credentialHandle` through fifteen signatures -- every helper
 * that might eventually make a request had to carry it, including the ones that only built a JSON
 * body. The token is now read once from the account's store and closed over here, so a function that
 * does not make requests does not mention credentials at all.
 */
export type HubRequest = (
  path: string,
  method: "GET" | "POST",
  body?: Record<string, Json>,
) => Promise<Record<string, unknown>>;

interface Route {
  kind: "image" | "video" | "audio";
  upstreamModel: string;
  submitPath: string;
  queryPath?: string;
  family:
    | "nano-banana"
    | "seedream"
    | "openai-image"
    | "midjourney"
    | "kling-image"
    | "h3"
    | "seedance"
    | "veo"
    | "kling-video"
    | "kling-avatar"
    | "kling-motion"
    | "jimeng-motion"
    | "tts"
    | "seedaudio"
    | "music"
    | "elevenlabs-music"
    | "music-cover";
  filePath?: string;
}

export const HILO_MODEL_ROUTES: readonly Route[] = [
  {
    kind: "image",
    upstreamModel: "nano_banana_2_flash",
    family: "nano-banana",
    submitPath: "/api/v2/image/nano_banana/generate",
    queryPath: "/api/v2/image/nano_banana/tasks",
  },
  {
    kind: "image",
    upstreamModel: "nano_banana_2",
    family: "nano-banana",
    submitPath: "/api/v2/image/nano_banana/generate",
    queryPath: "/api/v2/image/nano_banana/tasks",
  },
  {
    kind: "image",
    upstreamModel: "doubao-seedream-5-0-pro-260628",
    family: "seedream",
    submitPath: "/api/v2/image/seedream/generate",
    queryPath: "/api/v2/image/seedream/tasks",
  },
  {
    kind: "image",
    upstreamModel: "doubao-seedream-4-5-251128",
    family: "seedream",
    submitPath: "/api/v2/image/seedream/generate",
    queryPath: "/api/v2/image/seedream/tasks",
  },
  {
    kind: "image",
    upstreamModel: "gpt-image-2",
    family: "openai-image",
    submitPath: "/api/v2/image/openai/generate",
    queryPath: "/api/v2/image/openai/tasks",
  },
  {
    kind: "image",
    upstreamModel: "midjourney-8.1",
    family: "midjourney",
    submitPath: "/api/v1/image/midjourney/generate",
    queryPath: "/api/v1/image/midjourney/tasks",
  },
  {
    kind: "image",
    upstreamModel: "midjourney-7",
    family: "midjourney",
    submitPath: "/api/v1/image/midjourney/generate",
    queryPath: "/api/v1/image/midjourney/tasks",
  },
  {
    kind: "image",
    upstreamModel: "midjourney-niji7",
    family: "midjourney",
    submitPath: "/api/v1/image/midjourney/generate",
    queryPath: "/api/v1/image/midjourney/tasks",
  },
  {
    kind: "image",
    upstreamModel: "kling-image-o1",
    family: "kling-image",
    submitPath: "/api/v1/image/kling-omni/generate",
    queryPath: "/api/v1/image/kling-omni/tasks",
  },
  {
    kind: "image",
    upstreamModel: "kling-v3-omni",
    family: "kling-image",
    submitPath: "/api/v1/image/kling-omni/generate",
    queryPath: "/api/v1/image/kling-omni/tasks",
  },
  {
    kind: "video",
    upstreamModel: "MiniMax-H3",
    family: "h3",
    submitPath: "/api/v1/video/minimax-v3/generate",
    queryPath: "/api/v1/video/minimax-v3/tasks",
    filePath: "/api/v1/video/minimax/files",
  },
  {
    kind: "video",
    upstreamModel: "seedance2.0",
    family: "seedance",
    submitPath: "/api/v1/video/seedance/generate",
    queryPath: "/api/v1/video/seedance/tasks",
  },
  {
    kind: "video",
    upstreamModel: "seedance2.0-fast",
    family: "seedance",
    submitPath: "/api/v1/video/seedance/generate",
    queryPath: "/api/v1/video/seedance/tasks",
  },
  {
    kind: "video",
    upstreamModel: "seedance2.0-mini",
    family: "seedance",
    submitPath: "/api/v1/video/seedance/generate",
    queryPath: "/api/v1/video/seedance/tasks",
  },
  {
    kind: "video",
    upstreamModel: "veo-3.1-fast-generate-001",
    family: "veo",
    submitPath: "/api/v1/video/veo3/generate",
    queryPath: "/api/v1/video/veo3/tasks",
  },
  {
    kind: "video",
    upstreamModel: "veo-3.1-generate-001",
    family: "veo",
    submitPath: "/api/v1/video/veo3/generate",
    queryPath: "/api/v1/video/veo3/tasks",
  },
  {
    kind: "video",
    upstreamModel: "kling-video-o1",
    family: "kling-video",
    submitPath: "/api/v1/video/kling-omni/generate",
    queryPath: "/api/v1/video/kling-omni/tasks",
  },
  {
    kind: "video",
    upstreamModel: "kling-v3-omni",
    family: "kling-video",
    submitPath: "/api/v1/video/kling-omni/generate",
    queryPath: "/api/v1/video/kling-omni/tasks",
  },
  {
    kind: "video",
    upstreamModel: "kling-avatar",
    family: "kling-avatar",
    submitPath: "/api/v1/video/kling/avatar",
    queryPath: "/api/v1/video/kling/avatar",
  },
  {
    kind: "video",
    upstreamModel: "kling-motion-control",
    family: "kling-motion",
    submitPath: "/api/v1/video/kling/motion-control",
    queryPath: "/api/v1/video/kling/motion-control",
  },
  {
    kind: "video",
    upstreamModel: "jimeng_motion_control",
    family: "jimeng-motion",
    submitPath: "/api/v1/video/jimeng/generate",
    queryPath: "/api/v1/video/jimeng/tasks",
  },
  {
    kind: "audio",
    upstreamModel: "speech-2.8-hd",
    family: "tts",
    submitPath: "/api/v2/audio/tts",
    queryPath: "/api/v2/audio/tts/tasks",
  },
  {
    kind: "audio",
    upstreamModel: "seed-audio-1.0",
    family: "seedaudio",
    submitPath: "/api/v2/audio/seedaudio/tts",
    queryPath: "/api/v2/audio/seedaudio/tts/tasks",
  },
  {
    kind: "audio",
    upstreamModel: "music-3.0",
    family: "music",
    submitPath: "/api/v2/audio/music/minimax",
    queryPath: "/api/v2/audio/music/minimax/tasks",
  },
  {
    kind: "audio",
    upstreamModel: "elevenlabs-music-v2",
    family: "elevenlabs-music",
    submitPath: "/api/v2/audio/music/elevenlabs",
    queryPath: "/api/v2/audio/music/elevenlabs/tasks",
  },
  {
    kind: "audio",
    upstreamModel: "music-cover",
    family: "music-cover",
    submitPath: "/api/v2/audio/music/cover/generate",
    queryPath: "/api/v2/audio/music/cover/generate/tasks",
  },
] as const;

const HUB_ORIGIN = "https://hub.minimax.io";
const SUCCESS_STATUSES = new Set([
  "success",
  "succeed",
  "succeeded",
  "completed",
  "done",
]);
const FAILED_STATUSES = new Set([
  "failed",
  "fail",
  "cancelled",
  "canceled",
  "error",
]);
/**
 * The states worth waiting on. Everything outside this set ends the wait, including states nobody
 * has seen yet -- an unfamiliar word is a reason to stop and say so, not a reason to keep asking.
 */
const RUNNING_STATUSES = new Set([
  "",
  "processing",
  "pending",
  "queueing",
  "queued",
  "submitted",
  "preparing",
  "running",
  "waiting",
]);

/**
 * Hub keeps the envelope at message="success" even when the task itself failed,
 * so a literal "success" is never a usable failure reason.
 */
function failureReason(value: unknown): string | undefined {
  const text = string(value);
  if (!text) return undefined;
  return text.trim().toLowerCase() === "success" ? undefined : text;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function taskId(value: unknown): string | undefined {
  const input = record(value);
  return (
    string(input.task_id) ??
    string(input.taskId) ??
    string(record(input.data).task_id)
  );
}

function status(value: unknown): string {
  const input = record(value);
  const data = record(input.data);
  return (
    string(input.status) ??
    string(data.status) ??
    string(data.task_status) ??
    string(data.taskStatus) ??
    ""
  ).toLowerCase();
}

function firstUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = record(value);
  for (const key of [
    "video_url",
    "image_url",
    "audio_url",
    "download_url",
    "file_url",
    "url",
  ]) {
    const candidate = string(input[key]);
    if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
  }
  for (const key of [
    "video_urls",
    "image_urls",
    "audio_urls",
    "urls",
    "images",
    "videos",
    "audios",
    "files",
  ]) {
    const items = input[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const candidate =
        typeof item === "string" ? string(item) : firstUrl(item);
      if (candidate) return candidate;
    }
  }
  for (const key of ["file", "result", "task_result", "data", "output"]) {
    const candidate = firstUrl(input[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

function dimensions(value: unknown): Record<string, number> {
  const input = record(value);
  const data = record(input.data);
  const result: Record<string, number> = {};
  for (const key of ["width", "height"] as const) {
    const candidate = number(input[key]) ?? number(data[key]);
    if (candidate !== undefined) result[key] = candidate;
  }
  const durationMs = number(input.duration_ms) ?? number(data.duration_ms);
  const durationSeconds = number(input.duration) ?? number(data.duration);
  if (durationMs !== undefined) result.durationMs = durationMs;
  else if (durationSeconds !== undefined)
    result.durationMs = Math.round(durationSeconds * 1000);
  return result;
}

function cleanModelParams(value: unknown): Record<string, Json> {
  const input = record(value);
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, entry]) =>
        key !== "provider_id" &&
        key !== "require_real_provider" &&
        entry !== undefined,
    ),
  ) as Record<string, Json>;
}

function boolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  if (["true", "on", "yes", "instrumental"].includes(value.toLowerCase()))
    return true;
  if (["false", "off", "no", "vocal"].includes(value.toLowerCase()))
    return false;
  return undefined;
}

function jsonObject(value: unknown): Record<string, Json> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, Json>;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, Json>)
      : undefined;
  } catch {
    return undefined;
  }
}

function numberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter(
    (entry): entry is number =>
      typeof entry === "number" && Number.isFinite(entry),
  );
  return values.length === value.length ? values : undefined;
}

function dataUri(
  value: string,
): { mimeType: string; base64: string } | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  return match
    ? { mimeType: match[1].toLowerCase(), base64: match[2] }
    : undefined;
}

/**
 * The media type of a result, taken from the URL the upstream published.
 *
 * The upstream's JSON carries no media type, but the link it returns ends in a real extension --
 * `.mp3`, `.mp4`, `.png` -- which is evidence, unlike a guess from the model's category. Guessing
 * `audio/mpeg` for every audio model is what produced a reference the next model refused: the bytes
 * were an MP3, `audio/mpeg` is MP3's registered type, and the receiving upstream derived `.mpeg`
 * from it and rejected the file.
 *
 * Falls back to the category only when the link has no usable extension.
 */
const MEDIA_TYPES_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mp3",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
};

function mediaTypeFromUrl(
  url: string,
  kind: "image" | "video" | "audio",
): string {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Keep the raw value; the extension match below simply fails and we fall back.
  }
  const extension = /\.([A-Za-z0-9]+)$/.exec(pathname)?.[1]?.toLowerCase();
  const known = extension ? MEDIA_TYPES_BY_EXTENSION[extension] : undefined;
  if (known) return known;
  return kind === "image"
    ? "image/png"
    : kind === "video"
      ? "video/mp4"
      : "audio/mp3";
}

/**
 * One piece of input media, in the two forms Clash can resolve.
 *
 * Upload-based Hub families consume both forms identically: URLs are fetched to bytes first, then
 * sent through `/api/v1/files/upload`. Inline-only families still use the original URL or bytes in
 * their own request shape.
 */
export type HubMedia =
  | { form: "url"; url: string }
  | { form: "bytes"; bytes: Uint8Array; mediaType?: string };

function defaultMediaType(prefix: "image" | "video" | "audio"): string {
  return prefix === "image"
    ? "image/png"
    : prefix === "video"
      ? "video/mp4"
      : "audio/mp3";
}

/** Obtains the bytes, puts them where Hub can read them, and answers with the uploaded address. */
export async function uploadMedia(
  request: HubRequest,
  media: HubMedia,
  prefix: "image" | "video" | "audio",
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<string> {
  let bytes: Uint8Array;
  let mediaType: string;
  if (media.form === "bytes") {
    bytes = media.bytes;
    mediaType = media.mediaType ?? defaultMediaType(prefix);
  } else {
    const response = await fetchImpl(media.url);
    if (!response.ok) {
      throw providerHttpError({
        status: response.status,
        message: `Hilo Hub ${prefix} reference ${media.url} returned HTTP ${response.status}.`,
        operation: "submit",
      });
    }
    bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim();
    mediaType =
      contentType && contentType !== "application/octet-stream"
        ? contentType
        : mediaTypeFromUrl(media.url, prefix);
  }
  // Hub derives the uploaded file extension from the data-URI media type. `audio/mpeg` is the
  // registered MP3 type, but Hub spells that extension `.mpeg`; its downstream media endpoints
  // require `.mp3`, so use the equivalent Hub spelling at this boundary.
  const uploadMediaType =
    mediaType.toLowerCase() === "audio/mpeg" ? "audio/mp3" : mediaType;
  const inlineData = `data:${uploadMediaType};base64,${Buffer.from(bytes).toString("base64")}`;
  const uploaded = await request("/api/v1/files/upload", "POST", {
    file_data: inlineData,
    file_prefix: prefix,
  });
  const url = string(uploaded.url);
  if (!url) {
    throw invalidResponse(
      `Hilo Hub ${prefix} upload returned no URL.`,
      "rejected",
    );
  }
  return url;
}

/** Puts one reference where Hub can read it, and answers with the address to send. */
function uploadReference(
  request: HubRequest,
  media: HubMedia,
  prefix: "image" | "video" | "audio",
  fetchImpl: typeof globalThis.fetch,
): Promise<string> {
  return uploadMedia(request, media, prefix, fetchImpl);
}

function uploadReferences(
  request: HubRequest,
  media: readonly HubMedia[],
  prefix: "image" | "video" | "audio",
  fetchImpl: typeof globalThis.fetch,
): Promise<string[]> {
  return Promise.all(
    media.map((one) => uploadReference(request, one, prefix, fetchImpl)),
  );
}

/**
 * The families that send media in the request body rather than uploading it first.
 *
 * Nano Banana and GPT Image take the address or the inline data directly, so bytes have to be
 * rendered back into a `data:` URI here. A URL is passed through: these bodies reach Hub, which
 * fetches what they name, so an address Hub can read is cheaper than a round trip through upload.
 */
function inlineMedia(
  media: HubMedia,
  prefix: "image" | "video" | "audio",
): string {
  if (media.form === "url") return media.url;
  return (
    `data:${media.mediaType ?? defaultMediaType(prefix)};base64,` +
    Buffer.from(media.bytes).toString("base64")
  );
}

/** Veo's `bytes_base64_encoded`/`mime_type` pair, which has no URL form at all. */
function inlineParts(
  media: HubMedia,
  prefix: "image" | "video" | "audio",
): { base64: string; mimeType: string } {
  if (media.form === "bytes") {
    return {
      base64: Buffer.from(media.bytes).toString("base64"),
      mimeType: media.mediaType ?? defaultMediaType(prefix),
    };
  }
  const inline = dataUri(media.url);
  if (!inline) {
    throw rejectedInvalidRequest("Veo start/end frames must be inline media.");
  }
  return inline;
}

/** The five media slots a request can carry, in the form the vendor call needs. */
export interface HubReferences {
  images: HubMedia[];
  videos: HubMedia[];
  audios: HubMedia[];
  startFrame?: HubMedia;
  endFrame?: HubMedia;
}

/**
 * What the host resolved a reference into, mapped onto what Hub can be given.
 *
 * Deciding this used to be the plugin's own `^https?://` test, which is also true of the host's
 * `http://127.0.0.1:<port>/...` asset URLs -- addresses Hub cannot reach, sent to Hub as though it
 * could. The host answers `url` only for an address the vendor can actually fetch and hands over
 * bytes otherwise, so the guess is gone rather than relocated.
 */
function mediaFromResolved(
  resolved: ResolvedReference,
  prefix: "image" | "video" | "audio",
): HubMedia {
  if (resolved.form === "provider-url") {
    return { form: "url", url: resolved.providerUrl };
  }
  if (resolved.form === "bytes") {
    return {
      form: "bytes",
      bytes: resolved.bytes,
      ...(resolved.mediaType ? { mediaType: resolved.mediaType } : {}),
    };
  }
  // A text reference in a media slot is a wiring mistake upstream. Sending the words to an upload
  // endpoint would store them as a file and generate from a blank image.
  throw rejectedInvalidRequest(
    `Hilo Hub ${prefix} reference resolved to text, which is not media.`,
  );
}

const SLOT_PREFIXES: Record<string, "image" | "video" | "audio"> = {
  startFrame: "image",
  endFrame: "image",
  image: "image",
  video: "video",
  audio: "audio",
};

/** Resolve the protocol's one typed reference channel into Hub's media groups. */
export async function collectReferences(
  invocation: ExecutablePluginInvocation,
  resolve: ((reference: unknown) => Promise<ResolvedReference>) | undefined,
): Promise<HubReferences> {
  const collected: HubReferences = { images: [], videos: [], audios: [] };
  const references = invocation.input.references ?? [];

  if (!references.length) return collected;
  if (!resolve) {
    throw rejectedInvalidRequest(
      "Hilo Hub references require the Host reference resolver.",
    );
  }
  // Global content indexes interleave text and media. Stable sort preserves array position for
  // grouped slots that legitimately reuse the same per-slot index.
  const ordered = references
    .map((reference, position) => ({ reference, position }))
    .sort(
      (left, right) =>
        left.reference.index - right.reference.index ||
        left.position - right.position,
    )
    .map(({ reference }) => reference);
  for (const reference of ordered) {
    if (reference.slot === "content") {
      const resolved = await resolve(reference);
      if (resolved.form === "text") continue;
      if (!("asset" in reference)) {
        throw rejectedInvalidRequest(
          "Hilo Hub content media is missing its typed Asset handle.",
        );
      }
      const prefix = reference.asset.kind;
      if (prefix !== "image" && prefix !== "video" && prefix !== "audio") {
        throw rejectedInvalidRequest(
          `Hilo Hub does not accept ${prefix} content references.`,
        );
      }
      const media = mediaFromResolved(resolved, prefix);
      if (prefix === "image") collected.images.push(media);
      else if (prefix === "video") collected.videos.push(media);
      else collected.audios.push(media);
      continue;
    }
    const prefix = SLOT_PREFIXES[reference.slot];
    if (!prefix) continue;
    const media = mediaFromResolved(await resolve(reference), prefix);
    if (reference.slot === "startFrame") {
      if (collected.startFrame) {
        throw rejectedInvalidRequest(
          "Hilo Hub received more than one startFrame reference.",
        );
      }
      collected.startFrame = media;
    } else if (reference.slot === "endFrame") {
      if (collected.endFrame) {
        throw rejectedInvalidRequest(
          "Hilo Hub received more than one endFrame reference.",
        );
      }
      collected.endFrame = media;
    } else if (reference.slot === "image") collected.images.push(media);
    else if (reference.slot === "video") collected.videos.push(media);
    else collected.audios.push(media);
  }
  return collected;
}

const GPT_IMAGE_2_SIZE_MAP: Record<string, Record<string, string>> = {
  "1k": {
    "1:1": "1024x1024",
    "16:9": "1280x720",
    "9:16": "720x1280",
    "3:4": "864x1152",
    "4:3": "1152x864",
    "3:2": "1248x832",
    "2:3": "832x1248",
    "5:4": "1120x896",
    "4:5": "896x1120",
    "21:9": "1344x576",
    "2:1": "1440x720",
    "1:2": "720x1440",
    "3:1": "1728x576",
    "1:3": "576x1728",
  },
  "2k": {
    "1:1": "2048x2048",
    "16:9": "2560x1440",
    "9:16": "1440x2560",
    "3:4": "1728x2304",
    "4:3": "2304x1728",
    "3:2": "2496x1664",
    "2:3": "1664x2496",
    "5:4": "2240x1792",
    "4:5": "1792x2240",
    "21:9": "3024x1296",
    "2:1": "2880x1440",
    "1:2": "1440x2880",
    "3:1": "3552x1184",
    "1:3": "1184x3552",
  },
  "4k": {
    "1:1": "2880x2880",
    "16:9": "3840x2160",
    "9:16": "2160x3840",
    "3:4": "2448x3264",
    "4:3": "3264x2448",
    "3:2": "3504x2336",
    "2:3": "2336x3504",
    "5:4": "3200x2560",
    "4:5": "2560x3200",
    "21:9": "3696x1584",
    "2:1": "3840x1920",
    "1:2": "1920x3840",
    "3:1": "3840x1280",
    "1:3": "1280x3840",
  },
};

function gptImageSize(
  params: Record<string, Json>,
  aspectRatio: string,
): string {
  const resolution = (string(params.resolution) ?? "1k").toLowerCase();
  const ratio = aspectRatio && aspectRatio !== "auto" ? aspectRatio : "1:1";
  return GPT_IMAGE_2_SIZE_MAP[resolution]?.[ratio] ?? "1024x1024";
}

function appendFlag(
  prompt: string,
  pattern: RegExp,
  flag: string,
  value: unknown,
): string {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    pattern.test(prompt)
  )
    return prompt;
  return `${prompt} ${flag} ${String(value)}`;
}

async function buildBody(
  route: Route,
  values: Record<string, Json>,
  references: HubReferences,
  request: HubRequest,
  fetchImpl: typeof globalThis.fetch,
): Promise<Record<string, Json>> {
  const params = cleanModelParams(values.modelParams);
  const prompt = string(values.prompt) ?? "";
  const aspectRatio =
    string(values.aspectRatio) ?? string(params.aspect_ratio) ?? "";
  const duration = number(values.duration) ?? number(params.duration);
  const { images, videos, audios, startFrame, endFrame } = references;

  if (route.family === "nano-banana") {
    return {
      prompt,
      model_name: route.upstreamModel,
      image_paths: images.map((image) => inlineMedia(image, "image")),
      aspect_ratio: aspectRatio,
      resolution: string(params.resolution) ?? "1K",
    };
  }
  if (route.family === "seedream") {
    const imagePaths = await uploadReferences(
      request,
      images,
      "image",
      fetchImpl,
    );
    const body: Record<string, Json> = {
      prompt,
      image_paths: imagePaths,
      aspect_ratio: aspectRatio || "1:1",
      model: route.upstreamModel,
    };
    const size = string(params.resolution) ?? string(params.size);
    if (size) body.size = size;
    if (!route.upstreamModel.includes("5-0")) {
      body.seed = number(params.seed) ?? -1;
      body.guidance_scale = number(params.guidance_scale) ?? 5;
    }
    return body;
  }
  if (route.family === "openai-image") {
    const background = string(params.background);
    return {
      prompt,
      model: route.upstreamModel,
      size: gptImageSize(params, aspectRatio),
      image_paths: images.map((image) => inlineMedia(image, "image")),
      quality: string(params.quality) ?? "medium",
      n: Math.max(
        1,
        Math.min(4, number(params.count) ?? number(params.n) ?? 1),
      ),
      ...(background && background !== "auto" ? { background } : {}),
    };
  }
  if (route.family === "midjourney") {
    const imageUrls = await uploadReferences(
      request,
      images,
      "image",
      fetchImpl,
    );
    let finalPrompt = imageUrls.length
      ? `${imageUrls.join(" ")} ${prompt}`.trim()
      : prompt;
    if (aspectRatio && aspectRatio !== "auto") {
      finalPrompt = appendFlag(
        finalPrompt,
        /(^|\s)--ar\s/i,
        "--ar",
        aspectRatio,
      );
    }
    if (number(params.stylize) !== 100) {
      finalPrompt = appendFlag(
        finalPrompt,
        /(^|\s)--stylize\s/i,
        "--stylize",
        params.stylize,
      );
    }
    if (number(params.chaos) !== 0) {
      finalPrompt = appendFlag(
        finalPrompt,
        /(^|\s)--(?:chaos|c)\s/i,
        "--chaos",
        params.chaos,
      );
    }
    if (number(params.weird) !== 0) {
      finalPrompt = appendFlag(
        finalPrompt,
        /(^|\s)--(?:weird|w)\s/i,
        "--weird",
        params.weird,
      );
    }
    if (!/(^|\s)--(?:v|version|niji)(?:\s|=|$)/i.test(finalPrompt)) {
      finalPrompt +=
        route.upstreamModel === "midjourney-niji7"
          ? " --niji 7"
          : route.upstreamModel === "midjourney-7"
            ? " --v 7"
            : " --v 8.1";
    }
    return { prompt: finalPrompt, params };
  }
  if (route.family === "kling-image") {
    const imageList = await uploadReferences(
      request,
      images,
      "image",
      fetchImpl,
    );
    const ratio = aspectRatio || "auto";
    return {
      prompt,
      model_name: route.upstreamModel,
      resolution: string(params.resolution) ?? "1k",
      aspect_ratio: ratio === "auto" && !imageList.length ? "1:1" : ratio,
      ...(imageList.length ? { image_list: imageList } : {}),
    };
  }
  if (route.family === "h3") {
    const hasFrames = Boolean(startFrame || endFrame);
    const hasReferences = Boolean(
      images.length || videos.length || audios.length,
    );
    const requested = aspectRatio || "adaptive";
    // Official MiniMax-H3 contract: image-to-video is always adaptive, reference
    // scenarios may be adaptive, but text-to-video rejects adaptive outright.
    const ratio = hasFrames
      ? "adaptive"
      : hasReferences || requested !== "adaptive"
        ? requested
        : "16:9";
    const [
      firstFrameImage,
      lastFrameImage,
      referenceImages,
      referenceVideos,
      referenceAudios,
    ] = await Promise.all([
      startFrame
        ? uploadReference(request, startFrame, "image", fetchImpl)
        : undefined,
      endFrame
        ? uploadReference(request, endFrame, "image", fetchImpl)
        : undefined,
      uploadReferences(request, images, "image", fetchImpl),
      uploadReferences(request, videos, "video", fetchImpl),
      uploadReferences(request, audios, "audio", fetchImpl),
    ]);
    return {
      model: route.upstreamModel,
      prompt,
      ...(duration !== undefined ? { duration } : {}),
      ratio,
      resolution: string(params.resolution) ?? "2K",
      generate_audio:
        typeof params.generate_audio === "boolean"
          ? params.generate_audio
          : true,
      ...(firstFrameImage ? { first_frame_image: firstFrameImage } : {}),
      ...(lastFrameImage ? { last_frame_image: lastFrameImage } : {}),
      ...(!firstFrameImage && referenceImages.length
        ? { reference_images: referenceImages }
        : {}),
      ...(referenceVideos.length ? { reference_videos: referenceVideos } : {}),
      ...(referenceAudios.length ? { reference_audios: referenceAudios } : {}),
    };
  }
  if (route.family === "seedance") {
    if (startFrame && (images.length || videos.length || audios.length)) {
      throw rejectedInvalidRequest(
        "Seedance start/end frames cannot be mixed with reference media.",
      );
    }
    const [
      firstFrameImage,
      lastFrameImage,
      referenceImages,
      referenceVideos,
      referenceAudios,
    ] = await Promise.all([
      startFrame
        ? uploadReference(request, startFrame, "image", fetchImpl)
        : undefined,
      endFrame
        ? uploadReference(request, endFrame, "image", fetchImpl)
        : undefined,
      uploadReferences(request, images, "image", fetchImpl),
      uploadReferences(request, videos, "video", fetchImpl),
      uploadReferences(request, audios, "audio", fetchImpl),
    ]);
    const referenceVideoDurations = numberArray(
      params.reference_video_durations_ms,
    );
    return {
      model: route.upstreamModel,
      prompt,
      ratio: aspectRatio || "adaptive",
      duration: duration ?? 5,
      generate_audio: boolean(params.generate_audio) ?? false,
      ...(string(params.resolution)
        ? { resolution: string(params.resolution)! }
        : {}),
      ...(firstFrameImage ? { first_frame_image: firstFrameImage } : {}),
      ...(lastFrameImage ? { last_frame_image: lastFrameImage } : {}),
      ...(referenceImages.length ? { reference_images: referenceImages } : {}),
      ...(referenceVideos.length ? { reference_videos: referenceVideos } : {}),
      ...(referenceVideos.length && referenceVideoDurations
        ? { reference_video_durations_ms: referenceVideoDurations }
        : {}),
      ...(referenceAudios.length ? { reference_audios: referenceAudios } : {}),
    };
  }
  if (route.family === "veo") {
    const instance: Record<string, Json> = { prompt };
    for (const [key, media] of [
      ["image", startFrame],
      ["last_frame", endFrame],
    ] as const) {
      if (!media) continue;
      const inline = inlineParts(media, "image");
      instance[key] = {
        bytes_base64_encoded: inline.base64,
        mime_type: inline.mimeType,
      };
    }
    return {
      instances: [instance],
      parameters: {
        duration_seconds: duration ?? 8,
        aspect_ratio: aspectRatio || "16:9",
        resolution: string(params.resolution) ?? "720p",
        generate_audio: true,
        person_generation: "allow_all",
      },
    };
  }
  if (route.family === "kling-video") {
    if (audios.length) {
      throw rejectedInvalidRequest(
        "The Hilo Kling Omni endpoint does not accept standalone audio references.",
      );
    }
    const [imageUrls, videoUrls] = await Promise.all([
      uploadReferences(request, images, "image", fetchImpl),
      uploadReferences(request, videos, "video", fetchImpl),
    ]);
    const requestedSound =
      string(params.sound) ??
      ((boolean(params.generate_audio) ?? false) ? "on" : "off");
    const sound =
      route.upstreamModel === "kling-video-o1" ? "off" : requestedSound;
    const multiShot = boolean(params.multi_shot) ?? false;
    return {
      model_name: route.upstreamModel,
      prompt,
      mode: string(params.mode) ?? "pro",
      aspect_ratio: aspectRatio || "16:9",
      duration: String(duration ?? 5),
      sound,
      ...(multiShot ? { multi_shot: true, shot_type: "intelligence" } : {}),
      ...(imageUrls.length
        ? { image_list: imageUrls.map((image_url) => ({ image_url })) }
        : {}),
      ...(videoUrls.length
        ? { video_list: videoUrls.map((video_url) => ({ video_url })) }
        : {}),
    };
  }
  if (route.family === "kling-avatar") {
    const [imageUrl, audioUrl] = await Promise.all([
      images[0] ? uploadReference(request, images[0], "image", fetchImpl) : "",
      audios[0] ? uploadReference(request, audios[0], "audio", fetchImpl) : "",
    ]);
    return {
      image: imageUrl,
      sound_file: audioUrl,
      prompt,
      mode: string(params.mode) ?? "std",
    };
  }
  if (route.family === "kling-motion") {
    const [imageUrl, videoUrl] = await Promise.all([
      images[0] ? uploadReference(request, images[0], "image", fetchImpl) : "",
      videos[0] ? uploadReference(request, videos[0], "video", fetchImpl) : "",
    ]);
    return {
      mode: string(params.mode) ?? "std",
      image_url: imageUrl,
      video_url: videoUrl,
      keep_original_sound: string(params.keep_original_sound) ?? "yes",
      character_orientation: string(params.character_orientation) ?? "video",
      prompt,
    };
  }
  if (route.family === "jimeng-motion") {
    const [imageUrl, videoUrl] = await Promise.all([
      images[0] ? uploadReference(request, images[0], "image", fetchImpl) : "",
      videos[0] ? uploadReference(request, videos[0], "video", fetchImpl) : "",
    ]);
    return { image_urls: [imageUrl], video_url: videoUrl };
  }
  if (route.family === "tts") {
    const pronunciationDict = jsonObject(params.pronunciation_dict);
    const voiceModify = jsonObject(params.voice_modify);
    return {
      model: route.upstreamModel,
      text: prompt,
      voice_id: string(params.voice_id) ?? "English_Graceful_Lady",
      speed: number(params.speed) ?? 1,
      subtitle_enable: true,
      ...(string(params.emotion) ? { emotion: string(params.emotion)! } : {}),
      ...(number(params.vol) !== undefined ? { vol: number(params.vol)! } : {}),
      ...(number(params.pitch) !== undefined
        ? { pitch: number(params.pitch)! }
        : {}),
      ...(pronunciationDict ? { pronunciation_dict: pronunciationDict } : {}),
      ...(voiceModify ? { voice_modify: voiceModify } : {}),
    };
  }
  if (route.family === "seedaudio") {
    if (audios.length && images.length) {
      throw rejectedInvalidRequest(
        "SeedAudio audio and image references cannot be mixed.",
      );
    }
    const [audioUrls, imageUrls] = await Promise.all([
      uploadReferences(request, audios, "audio", fetchImpl),
      uploadReferences(request, images, "image", fetchImpl),
    ]);
    const references: Json[] = [
      ...audioUrls.map((audio_url) => ({ audio_url })),
      ...imageUrls.map((image_url) => ({ image_url })),
    ];
    const speed = number(params.speed);
    const volume = number(params.volume);
    const rate = (value: number | undefined) =>
      value === undefined || value === 1
        ? undefined
        : Math.min(100, Math.max(-50, Math.round((value - 1) * 100)));
    return {
      model: route.upstreamModel,
      text_prompt: prompt,
      ...(references.length ? { references } : {}),
      ...(rate(speed) !== undefined ? { speech_rate: rate(speed)! } : {}),
      ...(rate(volume) !== undefined ? { loudness_rate: rate(volume)! } : {}),
      ...(number(params.pitch) !== undefined
        ? { pitch_rate: Math.trunc(number(params.pitch)!) }
        : {}),
      ...(number(params.sample_rate) !== undefined
        ? { sample_rate: Math.trunc(number(params.sample_rate)!) }
        : {}),
      ...(string(params.format) ? { format: string(params.format)! } : {}),
    };
  }
  if (route.family === "music") {
    const instrumental = boolean(params.is_instrumental) ?? false;
    let lyrics = string(params.lyrics);
    if (!instrumental && !lyrics && boolean(params.lyrics_optimizer)) {
      const generated = await request("/api/v1/audio/lyrics/generate", "POST", {
        mode: "write_full_song",
        prompt,
      });
      lyrics = string(generated.lyrics);
      if (!lyrics)
        throw invalidResponse(
          "Hilo Hub automatic lyrics returned no lyrics.",
          "rejected",
        );
    }
    return {
      prompt,
      model: route.upstreamModel,
      is_instrumental: instrumental,
      ...(!instrumental && lyrics ? { lyrics } : {}),
    };
  }
  if (route.family === "elevenlabs-music") {
    const seconds = duration ?? number(params.duration) ?? 60;
    const instrumental = boolean(params.is_instrumental) ?? false;
    return {
      prompt,
      model_id: "music_v2",
      ...(seconds > 0 ? { music_length_ms: Math.round(seconds * 1000) } : {}),
      ...(instrumental ? { force_instrumental: true } : {}),
    };
  }
  if (route.family === "music-cover") {
    const audioUrl = audios[0]
      ? await uploadReference(request, audios[0], "audio", fetchImpl)
      : "";
    return {
      prompt,
      model: route.upstreamModel,
      ...(string(params.lyrics) ? { lyrics: string(params.lyrics)! } : {}),
      ...(string(params.cover_feature_id)
        ? { cover_feature_id: string(params.cover_feature_id)! }
        : {}),
      ...(audioUrl ? { audio_url: audioUrl } : {}),
    };
  }

  const inlineImages = images.map((image) => inlineMedia(image, "image"));
  const imageUrls = startFrame
    ? [
        inlineMedia(startFrame, "image"),
        ...(endFrame ? [inlineMedia(endFrame, "image")] : []),
        ...inlineImages,
      ]
    : inlineImages;
  const videoUrls = videos.map((video) => inlineMedia(video, "video"));
  const audioUrls = audios.map((audio) => inlineMedia(audio, "audio"));
  return {
    model: route.upstreamModel,
    model_name: route.upstreamModel,
    prompt,
    ...(duration !== undefined ? { duration } : {}),
    ...(aspectRatio ? { ratio: aspectRatio, aspect_ratio: aspectRatio } : {}),
    ...params,
    ...(imageUrls.length
      ? { image_paths: imageUrls, image_urls: imageUrls }
      : {}),
    ...(videoUrls.length
      ? { video_paths: videoUrls, video_urls: videoUrls }
      : {}),
    ...(audioUrls.length
      ? { audio_paths: audioUrls, audio_urls: audioUrls }
      : {}),
  };
}

/**
 * Binds a token to Hub's origin and query convention.
 *
 * Both headers, because Hub reads either depending on the endpoint: `authorization` on the v2
 * surfaces and a bare `token` on some v1 ones. The host used to attach these itself from the
 * account's `apiKey`; now the plugin holds the token it stored and sets them, which is the only
 * reason the declaration's key (`accessToken`) has to be read here rather than guessed.
 */
export function createHubRequest(
  fetchImpl: typeof globalThis.fetch,
  accessToken: string,
  operation: "submit" | "poll",
  origin = HUB_ORIGIN,
): HubRequest {
  return async (path, method, body) => {
    const url = new URL(path, origin);
    url.searchParams.set("version_code", "2.0.11");
    const response = await fetchImpl(url.toString(), {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        token: accessToken,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw providerHttpError({
        status: response.status,
        message: `Hilo Hub ${method} ${path} returned HTTP ${response.status}.`,
        operation,
      });
    }
    const raw = await response.text();
    if (!raw) return {};
    try {
      return record(JSON.parse(raw));
    } catch {
      // A proxy or a login page answers with HTML. Folding that into an empty object loses the only
      // explanation there was, and the caller then reports a missing task_id instead.
      throw invalidResponse(
        `Hilo Hub ${method} ${path} returned a non-JSON body: ${raw.slice(0, 200)}`,
        operation === "submit" ? "unknown" : "accepted",
      );
    }
  };
}

function routeFor(values: Record<string, Json>): Route {
  const upstreamModel = string(values.upstreamModel);
  if (!upstreamModel) {
    throw rejectedInvalidRequest(
      "Hilo Hub invocation is missing upstreamModel.",
    );
  }
  const modelId = string(values.modelId) ?? "";
  const kindHint =
    modelId.includes("image") || modelId.startsWith("midjourney")
      ? "image"
      : modelId.includes("music") ||
          modelId.includes("audio") ||
          modelId.includes("speech")
        ? "audio"
        : "video";
  const matches = HILO_MODEL_ROUTES.filter(
    (route) => route.upstreamModel === upstreamModel,
  );
  return (
    matches.find((route) => route.kind === kindHint) ??
    matches[0] ??
    (() => {
      throw new ProviderExecutionError({
        code: "invalid_request",
        message: `Unsupported Hilo Hub model: ${upstreamModel}`,
        retryable: false,
        requestState: "rejected",
      });
    })()
  );
}

/**
 * What a poll needs to know, read once.
 *
 * Exported because the adapter checks it before it reads the account's token: an unusable poll
 * state is a wiring fault that no credential fixes, and reporting a missing token for it sends the
 * reader to the account screen for a problem that is not there.
 */
export function readPollState(invocation: ExecutablePluginInvocation): {
  taskId: string;
  upstreamModel: string;
  fileId?: string;
  route: Route;
} {
  const state = record(invocation.pollState);
  const taskId = string(state.taskId);
  const upstreamModel = string(state.upstreamModel);
  const fileId = string(state.fileId);
  if (!taskId || !upstreamModel) {
    throw new ProviderExecutionError({
      code: "contract_violation",
      message: "Hilo Hub poll state is missing its task id or model.",
      retryable: false,
      requestState: "accepted",
    });
  }
  const route =
    HILO_MODEL_ROUTES.find(
      (candidate) => candidate.upstreamModel === upstreamModel,
    ) ??
    (() => {
      throw new ProviderExecutionError({
        code: "contract_violation",
        message: `Unsupported Hilo Hub model: ${upstreamModel}`,
        retryable: false,
        requestState: "accepted",
      });
    })();
  if (fileId && !route.filePath) {
    throw new ProviderExecutionError({
      code: "contract_violation",
      message: `Hilo Hub model ${upstreamModel} does not support file poll state.`,
      retryable: false,
      requestState: "accepted",
    });
  }
  return { taskId, upstreamModel, ...(fileId ? { fileId } : {}), route };
}

/** The route a submit will take, checked before anything is spent on it. */
export function readSubmitRoute(invocation: ExecutablePluginInvocation): Route {
  return routeFor(invocation.input.values as Record<string, Json>);
}

export type HubStep =
  | {
      status: "accepted";
      pollState: { taskId: string; upstreamModel: string; fileId?: string };
    }
  | {
      status: "completed";
      media: Record<
        string,
        { url: string; mediaType: string; kind: "image" | "video" | "audio" }
      >;
    };

export async function submitHubModel(
  invocation: ExecutablePluginInvocation,
  request: HubRequest,
  references: HubReferences,
  options: { fetch?: typeof globalThis.fetch } = {},
): Promise<HubStep> {
  const values = invocation.input.values as Record<string, Json>;
  const route = routeFor(values);
  const body = await buildBody(
    route,
    values,
    references,
    request,
    options.fetch ?? globalThis.fetch,
  );
  const submitPath =
    route.family === "veo"
      ? `${route.submitPath}?model=${encodeURIComponent(route.upstreamModel)}`
      : route.submitPath;
  const submitted = await request(submitPath, "POST", body);

  const url = firstUrl(submitted);
  if (!url && route.queryPath) {
    const submittedTaskId = taskId(submitted);
    if (!submittedTaskId) {
      throw invalidResponse(
        `Hilo Hub ${route.upstreamModel} submit response is missing task_id.`,
        "unknown",
      );
    }
    // The upstream has the work. Hand back what identifies it and let the host decide when to ask
    // again -- it is the only party that still exists after a restart.
    return {
      status: "accepted",
      pollState: {
        taskId: submittedTaskId,
        upstreamModel: route.upstreamModel,
      },
    };
  }
  if (!url) {
    // No queue to ask and nothing returned. Reporting completion would store an empty asset and
    // close the task as though it had worked.
    throw invalidResponse(
      `Hilo Hub ${route.upstreamModel} returned neither a task_id nor a URL.`,
      "accepted",
    );
  }
  return completedResult(route, url);
}

/**
 * One status question, answered.
 *
 * Everything the loop used to do per attempt happens here once: the same failure vocabulary, the
 * same success statuses, and the same second fetch for families that report a file id before they
 * report a URL. What is gone is the deciding of when to ask again.
 */
export async function pollHubModel(
  invocation: ExecutablePluginInvocation,
  request: HubRequest,
): Promise<HubStep> {
  const {
    taskId: submittedTaskId,
    upstreamModel,
    fileId: pendingFileId,
    route,
  } = readPollState(invocation);
  if (pendingFileId) {
    const file = await request(
      `${route.filePath!}/${encodeURIComponent(pendingFileId)}`,
      "GET",
    );
    const url = firstUrl(file);
    if (!url) {
      throw invalidResponse(
        `Hilo Hub file ${pendingFileId} returned no result URL.`,
        "accepted",
      );
    }
    return completedResult(route, url);
  }

  const final = await request(
    `${route.queryPath}/${encodeURIComponent(submittedTaskId)}`,
    "GET",
  );
  const currentStatus = status(final);
  if (FAILED_STATUSES.has(currentStatus)) {
    const base = record(final.base ?? final.base_resp);
    const data = record(final.data);
    throw new ProviderExecutionError({
      code: currentStatus === "cancelled" || currentStatus === "canceled"
        ? "cancelled"
        : "provider_failed",
      message: failureReason(final.error_message) ??
        failureReason(data.task_status_msg) ??
        failureReason(data.error_message) ??
        failureReason(final.message) ??
        failureReason(final.user_message) ??
        failureReason(base.message) ??
        failureReason(base.status_msg) ??
        `Hilo Hub task ${submittedTaskId} failed.`,
      retryable: false,
      requestState: "accepted",
      providerCode: currentStatus,
    });
  }
  const url = firstUrl(final);
  if (url) return completedResult(route, url);
  if (route.filePath && SUCCESS_STATUSES.has(currentStatus)) {
    const fileId = string(final.file_id) ?? string(record(final.data).file_id);
    if (!fileId)
      throw invalidResponse(
        `Hilo Hub task ${submittedTaskId} succeeded without file_id.`,
        "accepted",
      );
    // The status request consumed this Provider step. Persist the file identity and let the Host
    // schedule one later poll invocation for the file endpoint; doing both here would make a
    // single poll step perform two upstream requests and leave no checkpoint between them.
    return {
      status: "accepted",
      pollState: { taskId: submittedTaskId, upstreamModel, fileId },
    };
  }
  if (SUCCESS_STATUSES.has(currentStatus)) {
    throw invalidResponse(
      `Hilo Hub task ${submittedTaskId} succeeded without a result URL.`,
      "accepted",
    );
  }
  // Still running, or succeeded without a URL yet. Same state, asked again later.
  //
  // Hub's vocabulary is not a flat word: the envelope reports message="success" while the task
  // underneath has failed, so recognising states means reading several fields together. What must
  // not happen is the easy fallthrough -- treat whatever I do not recognise as still running --
  // because a status added upstream next month would then become an unbounded wait on work that
  // already died, with no symptom except that nothing ever happens.
  if (!RUNNING_STATUSES.has(currentStatus)) {
    throw new ProviderExecutionError({
      code: "invalid_response",
      message:
        `Hilo Hub task ${submittedTaskId} reported status "${currentStatus}", which this plugin ` +
        "does not recognise. Refusing to keep waiting on a task whose state is unknown.",
      retryable: false,
      requestState: "accepted",
      providerCode: currentStatus,
    });
  }
  return {
    status: "accepted",
    pollState: { taskId: submittedTaskId, upstreamModel },
  };
}

/**
 * The finished shape, shared by the call that never needed to wait and the poll that did.
 *
 * Named files rather than a hand-built output. The plugin used to invent the Asset identity and
 * assert that its upstream URL was publicly accessible. Both are the Host's to decide; what the
 * plugin knows is the address Hub published and what kind of media it is.
 */
function completedResult(route: Route, url: string): HubStep {
  return {
    status: "completed",
    media: {
      media: {
        url,
        mediaType: mediaTypeFromUrl(url, route.kind),
        kind: route.kind,
      },
    },
  };
}
