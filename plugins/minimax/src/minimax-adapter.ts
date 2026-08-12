import { minimaxBaseUrl } from "./base-url.js";
import {
  buildMiniMaxH3Content,
  type MiniMaxH3OrderedContentPart,
} from "@clash/shared-runtime";
import type { PluginAuthDeclaration } from "@clash/shared-types";
import { minimaxSubmit, minimaxPoll, type MinimaxPollState } from "./minimax-executor";
import { valueOutput, type ExecutorContext, type ExecutorStep, type ProviderExecutor } from "./executor-contract";

function readPollState(value: unknown): MinimaxPollState {
  if (!value || typeof value !== "object") throw new Error("MiniMax poll state is missing.");
  const taskId = (value as { taskId?: unknown }).taskId;
  if (typeof taskId !== "string" || !taskId) throw new Error("MiniMax poll state is missing its taskId.");
  return { taskId };
}

const RETRYABLE_TRANSPORT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * A transient transport failure while polling does not change the upstream
 * task's state. HTTP responses and MiniMax business verdicts are deliberately
 * excluded: those reached the provider and carry a real answer.
 */
function retryablePollTransportFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (typeof current !== "object") break;
    const record = current as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
    const code = typeof record.code === "string" ? record.code.toUpperCase() : "";
    if (RETRYABLE_TRANSPORT_CODES.has(code)) return true;
    const name = typeof record.name === "string" ? record.name : "";
    if (name === "AbortError" || name === "TimeoutError") return true;
    const message = typeof record.message === "string" ? record.message : "";
    if (/\bfetch failed\b|\bnetwork\.fetch\b.*\bwithin \d+ms\b|\bsocket hang up\b/i.test(message)) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

/**
 * What a MiniMax account needs.
 *
 * Two keys, and the region is one of them rather than a host column. Which MiniMax answers is the
 * account's fact: an international key is unknown to the domestic host, and the refusal arrives as
 * an authentication error rather than a routing one -- so the choice has to be made before the
 * request, by the person who holds the key.
 */
export const MINIMAX_AUTH: PluginAuthDeclaration = {
  /**
   * One method, because MiniMax has one way in.
   *
   * The region is not a second way of authenticating: the same key is presented the same way to
   * either host. Splitting them would ask the user to choose an authentication method in order to
   * express a deployment, and would duplicate `apiKey` across both.
   */
  methods: [{
    id: "api-key",
    label: "API key",
    form: [
    { kind: "field" as const, key: "apiKey", label: "API key", secret: true },
    {
      kind: "choice" as const,
      key: "service",
      label: "Region",
      options: [
        { value: "international", label: "International (api.minimax.io)" },
        { value: "domestic", label: "China (api.minimaxi.com)" },
      ],
      default: "international",
    },
    ],
  }],
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function orderedContentParts(value: unknown): MiniMaxH3OrderedContentPart[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): MiniMaxH3OrderedContentPart[] => {
    const part = record(entry);
    if (part.type === "text" && typeof part.text === "string") {
      return [{ type: "text", text: part.text }];
    }
    if ((part.type === "image" || part.type === "video" || part.type === "audio")
      && typeof part.url === "string") {
      return [{ type: part.type, url: part.url }];
    }
    return [];
  });
}

/** State resolved by the host for the exact account selected for this route. */
async function accountState(context: ExecutorContext): Promise<Record<string, string>> {
  const keys = ["apiKey", "service", "baseUrl"] as const;
  const values = await Promise.all(
    keys.map(async (key) => [key, await context.store?.get(key)] as const),
  );
  return Object.fromEntries(
    values.filter(
      (entry): entry is readonly [(typeof keys)[number], string] =>
        typeof entry[1] === "string" && entry[1].trim().length > 0,
    ),
  );
}

function requireApiKey(credentials: Record<string, string>): string {
  const apiKey = credentials.apiKey;
  // An empty string reaches MiniMax as an empty Authorization header, and comes back as an
  // authentication failure that names the key rather than its absence.
  if (!apiKey) throw new Error("This MiniMax account has no apiKey stored.");
  return apiKey;
}

function value(
  values: Record<string, unknown>,
  params: Record<string, unknown>,
  key: string,
): unknown {
  return params[key] ?? values[key];
}

/**
 * The shared card exposes stable product labels while MiniMax requires its
 * published built-in voice IDs on the wire. Keep that translation at the
 * provider boundary, just like upstream model names.
 *
 * Source: https://platform.minimax.io/docs/api-reference/speech-t2a-http
 */
const MINIMAX_TTS_VOICE_IDS: Readonly<Record<string, string>> = {
  "female-warm": "English_Graceful_Lady",
  "female-energetic": "English_radiant_girl",
  "male-calm": "English_Insightful_Speaker",
  "male-storyteller": "English_expressive_narrator",
};

function minimaxTtsVoiceId(value: unknown): string {
  const requested = String(value ?? "female-warm");
  return MINIMAX_TTS_VOICE_IDS[requested] ?? requested;
}

function requestBody(values: Record<string, unknown>): {
  body: Record<string, unknown>;
  musicEndpoint: boolean;
} {
  const explicit = record(values.body);
  if (Object.keys(explicit).length > 0) {
    return { body: explicit, musicEndpoint: values.musicEndpoint === true };
  }

  const modelId = typeof values.modelId === "string" ? values.modelId : "";
  const upstreamModel = typeof values.upstreamModel === "string"
    ? values.upstreamModel
    : typeof values.model === "string" ? values.model : "";
  if (!upstreamModel) throw new Error("MiniMax executor needs an upstreamModel.");
  const prompt = typeof values.prompt === "string" ? values.prompt : "";
  const params = record(values.modelParams);
  if (values.kind === "text") {
    const systemPrompt = value(values, params, "system_prompt");
    return {
      musicEndpoint: false,
      body: {
        model: upstreamModel,
        messages: [
          ...(typeof systemPrompt === "string" && systemPrompt.trim()
            ? [{ role: "system", content: systemPrompt.trim() }]
            : []),
          { role: "user", content: prompt },
        ],
        stream: false,
      },
    };
  }
  const audio = values.kind === "audio";
  const music = audio && (modelId === "minimax-music-3" || upstreamModel.startsWith("music-"));

  if (audio) {
    const format = String(value(values, params, "format") ?? (music ? "mp3" : "wav"));
    return {
      musicEndpoint: music,
      body: music
        ? {
            model: upstreamModel,
            prompt,
            lyrics: String(value(values, params, "lyrics") ?? ""),
            stream: false,
            output_format: "hex",
            lyrics_optimizer: value(values, params, "lyrics_optimizer") === true,
            is_instrumental: value(values, params, "is_instrumental") === true,
            aigc_watermark: value(values, params, "aigc_watermark") === true,
            audio_setting: {
              sample_rate: Number(value(values, params, "sample_rate") ?? 44100),
              bitrate: Number(value(values, params, "bitrate") ?? 256000),
              format,
            },
          }
        : {
            model: upstreamModel,
            text: prompt,
            stream: false,
            output_format: "hex",
            voice_setting: {
              voice_id: minimaxTtsVoiceId(value(values, params, "voice_id")),
              speed: Number(value(values, params, "speed") ?? 1),
              vol: Number(value(values, params, "vol") ?? 1),
              pitch: Number(value(values, params, "pitch") ?? 0),
            },
            audio_setting: {
              sample_rate: Number(value(values, params, "sample_rate") ?? 32000),
              bitrate: Number(value(values, params, "bitrate") ?? 128000),
              format,
              channel: Number(value(values, params, "channel") ?? 1),
            },
          },
    };
  }

  const startFrame = typeof values.startFrameUrl === "string" ? values.startFrameUrl : undefined;
  const endFrame = typeof values.endFrameUrl === "string" ? values.endFrameUrl : undefined;
  const referenceImages = stringList(values.referenceImageUrls);
  const referenceVideos = stringList(values.referenceVideoUrls);
  const referenceAudios = stringList(values.referenceAudioUrls);
  const ordered = orderedContentParts(values.orderedContentParts);
  return {
    musicEndpoint: false,
    body: {
      model: upstreamModel,
      content: buildMiniMaxH3Content({
        prompt,
        ...(ordered.length ? { orderedContentParts: ordered } : {}),
        ...(startFrame ? { startFrame } : {}),
        ...(endFrame ? { endFrame } : {}),
        ...(referenceImages.length ? { referenceImages } : {}),
        ...(referenceVideos.length ? { referenceVideos } : {}),
        ...(referenceAudios.length ? { referenceAudios } : {}),
      }),
      resolution: String(value(values, params, "resolution") ?? "2K"),
      duration: Number(value(values, params, "duration") ?? 5),
      ratio: startFrame
        ? "adaptive"
        : String(values.aspectRatio ?? value(values, params, "aspect_ratio") ?? "16:9"),
    },
  };
}

type MiniMaxFetch = typeof globalThis.fetch;

const REFERENCE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
};

function cleanMediaType(value: string | undefined): string | undefined {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType || undefined;
}

function responseHeader(
  response: Awaited<ReturnType<MiniMaxFetch>>,
  name: string,
): string | undefined {
  return response.headers?.get(name) ?? undefined;
}

function decodeDataUri(uri: string): { bytes: Uint8Array; mediaType: string } {
  const comma = uri.indexOf(",");
  if (!uri.startsWith("data:") || comma < 0) {
    throw new Error("MiniMax H3 reference is not a valid data URI.");
  }
  const metadata = uri.slice(5, comma).split(";");
  const mediaType = cleanMediaType(metadata[0]);
  if (!mediaType) throw new Error("MiniMax H3 data URI has no media type.");
  const payload = uri.slice(comma + 1);
  const bytes = metadata.some((entry) => entry.toLowerCase() === "base64")
    ? Uint8Array.from(Buffer.from(payload, "base64"))
    : new TextEncoder().encode(decodeURIComponent(payload));
  return { bytes, mediaType };
}

async function responseBytes(
  response: Awaited<ReturnType<MiniMaxFetch>>,
): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

async function downloadReference(
  initialUrl: string,
  fetch: MiniMaxFetch,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  let url = initialUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = responseHeader(response, "location");
      if (!location) {
        throw new Error(`MiniMax H3 reference download redirected without a location: ${url}`);
      }
      if (redirects === 5) {
        throw new Error(`MiniMax H3 reference download exceeded five redirects: ${initialUrl}`);
      }
      url = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      throw new Error(`MiniMax H3 reference download failed with HTTP ${response.status}: ${url}`);
    }
    const mediaType = cleanMediaType(responseHeader(response, "content-type"));
    if (!mediaType || !REFERENCE_EXTENSIONS[mediaType]) {
      throw new Error(
        `MiniMax H3 reference download returned unsupported content type ${mediaType ?? "(missing)"}: ${url}`,
      );
    }
    return { bytes: await responseBytes(response), mediaType };
  }
  throw new Error(`MiniMax H3 reference download failed: ${initialUrl}`);
}

async function materializeReference(
  url: string,
  fetch: MiniMaxFetch,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  if (url.startsWith("data:")) return decodeDataUri(url);
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`MiniMax H3 cannot upload reference URL scheme ${parsed.protocol}`);
  }
  return downloadReference(url, fetch);
}

function multipartUpload(
  reference: { bytes: Uint8Array; mediaType: string },
  index: number,
): FormData {
  const extension = REFERENCE_EXTENSIONS[reference.mediaType];
  if (!extension) {
    throw new Error(`MiniMax H3 cannot upload reference content type ${reference.mediaType}.`);
  }
  const filename = `reference-${index}.${extension}`;
  const bytes = reference.bytes.buffer.slice(
    reference.bytes.byteOffset,
    reference.bytes.byteOffset + reference.bytes.byteLength,
  ) as ArrayBuffer;
  const form = new FormData();
  form.append("purpose", "video_generation_input");
  form.append("file", new Blob([bytes], { type: reference.mediaType }), filename);
  return form;
}

function uploadedFileId(body: Record<string, unknown>): string | undefined {
  const file = record(body.file);
  const raw = file.file_id ?? body.file_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) return String(raw);
  return undefined;
}

async function uploadH3Reference(options: {
  url: string;
  index: number;
  apiKey: string;
  baseUrl: string;
  fetch: MiniMaxFetch;
  referenceFetch: MiniMaxFetch;
}): Promise<string> {
  if (options.url.startsWith("mm_file://")) return options.url;
  const reference = await materializeReference(options.url, options.referenceFetch);
  const multipart = multipartUpload(reference, options.index);
  const response = await options.fetch(`${options.baseUrl.replace(/\/+$/, "")}/v1/files/upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
    },
    // Leave Content-Type unset: fetch adds the boundary matching this FormData.
    body: multipart,
  });
  const raw = await response.text();
  let body: Record<string, unknown>;
  try {
    body = record(JSON.parse(raw));
  } catch {
    throw new Error(`MiniMax H3 file upload failed: ${raw || response.statusText}`);
  }
  const baseResp = record(body.base_resp);
  if (!response.ok || (baseResp.status_code !== undefined && baseResp.status_code !== 0)) {
    const message = typeof baseResp.status_msg === "string" && baseResp.status_msg
      ? baseResp.status_msg
      : typeof body.message === "string" && body.message ? body.message : response.statusText;
    throw new Error(`MiniMax H3 file upload failed: ${message}`);
  }
  const fileId = uploadedFileId(body);
  if (!fileId) throw new Error("MiniMax H3 file upload returned no file_id.");
  return `mm_file://${fileId}`;
}

async function uploadH3Content(options: {
  body: Record<string, unknown>;
  apiKey: string;
  baseUrl: string;
  fetch: MiniMaxFetch;
  referenceFetch: MiniMaxFetch;
}): Promise<Record<string, unknown>> {
  if (options.body.model !== "MiniMax-H3" || !Array.isArray(options.body.content)) {
    return options.body;
  }
  let index = 0;
  const content: Array<Record<string, unknown>> = [];
  for (const rawPart of options.body.content) {
    const part = record(rawPart);
    const type = typeof part.type === "string" ? part.type : "";
    if (type !== "image_url" && type !== "video_url" && type !== "audio_url") {
      content.push(part);
      continue;
    }
    const field = record(part[type]);
    if (typeof field.url !== "string" || !field.url) {
      throw new Error(`MiniMax H3 ${type} content has no URL.`);
    }
    index += 1;
    const url = await uploadH3Reference({
      url: field.url,
      index,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      fetch: options.fetch,
      referenceFetch: options.referenceFetch,
    });
    content.push({ ...part, [type]: { ...field, url } });
  }
  return { ...options.body, content };
}

export const minimaxAdapter: ProviderExecutor = {
  async submit(invocation, context: ExecutorContext): Promise<ExecutorStep> {
    const credentials = await accountState(context);
    const request = requestBody(invocation.input.values);
    const apiKey = requireApiKey(credentials);
    const baseUrl = minimaxBaseUrl({
      ...(credentials.service ? { service: credentials.service } : {}),
      ...(credentials.baseUrl ? { baseUrl: credentials.baseUrl } : {}),
    });
    const fetch = globalThis.fetch;
    const body = await uploadH3Content({
      body: request.body,
      apiKey,
      baseUrl,
      fetch,
      referenceFetch: fetch,
    });
    const submitted = await minimaxSubmit({
      kind: invocation.input.values.kind === "audio"
        ? "audio"
        : invocation.input.values.kind === "text" ? "text" : "video",
      apiKey,
      body,
      fetch: fetch as never,
      // Which MiniMax answers is the account's own fact, selected and injected by the host: an international
      // key is unknown to the domestic host, and the refusal arrives as an authentication error.
      baseUrl,
      ...(request.musicEndpoint ? { musicEndpoint: true } : {}),
    });
    // One provider, two lifecycles: video queues and is polled, speech hands back bytes on the
    // first call. Returning the finished arm rather than inventing a task id for the audio path is
    // what keeps the poll contract describing something real.
    if (submitted.status === "completed") {
      if ("text" in submitted) {
        return { status: "completed", outputs: valueOutput(submitted.text, "text") };
      }
      return {
        status: "completed",
        media: {
          media: { bytes: submitted.media.bytes, mediaType: submitted.media.contentType },
        },
      };
    }
    return { status: "accepted", pollState: submitted.pollState };
  },
  async poll(invocation, context: ExecutorContext): Promise<ExecutorStep> {
    const state = readPollState(invocation.pollState);
    // Reject unusable persisted state before touching the selected account. A
    // malformed poll can never make a provider request, so asking the broker
    // for credentials first only hides the actionable recovery error.
    const credentials = await accountState(context);
    let result: Awaited<ReturnType<typeof minimaxPoll>>;
    try {
      result = await minimaxPoll({
        state,
        apiKey: requireApiKey(credentials),
        fetch: globalThis.fetch as never,
        baseUrl: minimaxBaseUrl({
          ...(credentials.service ? { service: credentials.service } : {}),
          ...(credentials.baseUrl ? { baseUrl: credentials.baseUrl } : {}),
        }),
      });
    } catch (error) {
      if (!retryablePollTransportFailure(error)) throw error;
      return { status: "accepted", pollState: state, retryAfterMs: 5_000 };
    }
    if (result.status === "accepted") return { status: "accepted", pollState: result.pollState };
    return {
      status: "completed",
      media: {
        media: {
          url: result.media.url,
          mediaType: "video/mp4",
        },
      },
    };
  },
};
