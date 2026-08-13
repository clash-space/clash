import type {
  Executor,
  ExecutorContext,
  ExecutorStep,
} from "@clash/action-sdk";
import {
  ProviderExecutionError,
  providerHttpError,
} from "@clash/action-sdk";
import {
  resolveVolcengineTypedReferences,
  type VolcengineTypedReferences,
} from "./typed-references";

function rejectedInvalidRequest(message: string): ProviderExecutionError {
  return new ProviderExecutionError({
    code: "invalid_request",
    message,
    retryable: false,
    requestState: "rejected",
  });
}

export const VOLCENGINE_SPEECH_DEFAULT_BASE_URL =
  "https://openspeech.bytedance.com/api/v3";

export interface SeedAudioRequestValues extends Record<string, unknown> {
  modelId?: string;
  upstreamModel?: string;
  prompt?: string;
  modelParams?: Record<string, unknown>;
}

const SEED_AUDIO_SAMPLE_RATES = new Set([
  8_000, 16_000, 24_000, 32_000, 44_100, 48_000,
]);
const SEED_AUDIO_FORMATS = new Set(["wav", "mp3", "pcm", "ogg_opus"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function baseUrl(value: string | undefined): string {
  return (value?.trim() || VOLCENGINE_SPEECH_DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return record(JSON.parse(raw));
  } catch {
    return { error: { message: raw } };
  }
}

function messageFrom(body: Record<string, unknown>, fallback: string): string {
  const error = record(body.error);
  if (typeof error.message === "string" && error.message) return error.message;
  if (typeof body.message === "string" && body.message) return body.message;
  return fallback;
}

function seedAudioRate(
  value: unknown,
  label: "speed" | "volume",
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw rejectedInvalidRequest(
      `Volcengine Seed Audio ${label} must be a number.`,
    );
  }
  if (value < 0.5 || value > 2) {
    throw rejectedInvalidRequest(
      `Volcengine Seed Audio ${label} must be between 0.5 and 2.`,
    );
  }
  return Math.round((value - 1) * 100);
}

function seedAudioReference(
  url: string,
  modality: "audio" | "image",
): Record<string, string> {
  const data = /^data:[^,]*;base64,([a-z0-9+/=_-]+)$/i.exec(url)?.[1];
  if (data) return { [`${modality}_data`]: data };
  return { [`${modality}_url`]: url };
}

export function buildSeedAudioRequest(
  values: SeedAudioRequestValues,
  typedReferences: Pick<
    VolcengineTypedReferences,
    "images" | "audios"
  > = { images: [], audios: [] },
): Record<string, unknown> {
  const model =
    typeof values.upstreamModel === "string" ? values.upstreamModel.trim() : "";
  if (!model) {
    throw rejectedInvalidRequest(
      "Volcengine Seed Audio needs an upstreamModel.",
    );
  }

  const prompt = typeof values.prompt === "string" ? values.prompt.trim() : "";
  if (!prompt) {
    throw rejectedInvalidRequest("Volcengine Seed Audio requires a prompt.");
  }
  if (prompt.length > 3_000) {
    throw rejectedInvalidRequest(
      "Volcengine Seed Audio prompts support at most 3000 characters.",
    );
  }

  const { images, audios } = typedReferences;
  const params = record(values.modelParams);
  const voiceId =
    typeof params.voice_id === "string" && params.voice_id.trim()
      ? params.voice_id.trim()
      : undefined;
  if (images.length > 0 && audios.length > 0) {
    throw rejectedInvalidRequest(
      "Volcengine Seed Audio image and audio references cannot be mixed.",
    );
  }
  if (images.length > 1) {
    throw rejectedInvalidRequest(
      "Volcengine Seed Audio accepts at most one reference image.",
    );
  }
  if (audios.length > 3) {
    throw rejectedInvalidRequest(
      "Volcengine Seed Audio accepts at most three reference audios.",
    );
  }
  if (images.length > 0 && voiceId) {
    throw rejectedInvalidRequest(
      "Volcengine Seed Audio image and speaker references cannot be mixed.",
    );
  }
  if (audios.length + (voiceId ? 1 : 0) > 3) {
    throw rejectedInvalidRequest(
      "Volcengine Seed Audio accepts at most three speaker or audio references.",
    );
  }

  const audioConfig: Record<string, unknown> = {};
  const format = params.format;
  if (format !== undefined) {
    if (typeof format !== "string" || !SEED_AUDIO_FORMATS.has(format)) {
      throw rejectedInvalidRequest(
        "Volcengine Seed Audio format must be wav, mp3, pcm, or ogg_opus.",
      );
    }
    audioConfig.format = format;
  }
  const sampleRate = params.sample_rate;
  if (sampleRate !== undefined) {
    if (
      typeof sampleRate !== "number" ||
      !Number.isInteger(sampleRate) ||
      !SEED_AUDIO_SAMPLE_RATES.has(sampleRate)
    ) {
      throw rejectedInvalidRequest(
        "Volcengine Seed Audio sample_rate is not supported.",
      );
    }
    audioConfig.sample_rate = sampleRate;
  }
  const speechRate = seedAudioRate(params.speed, "speed");
  if (speechRate !== undefined) audioConfig.speech_rate = speechRate;
  const loudnessRate = seedAudioRate(params.volume, "volume");
  if (loudnessRate !== undefined) audioConfig.loudness_rate = loudnessRate;
  if (params.pitch !== undefined) {
    if (
      typeof params.pitch !== "number" ||
      !Number.isInteger(params.pitch) ||
      params.pitch < -12 ||
      params.pitch > 12
    ) {
      throw rejectedInvalidRequest(
        "Volcengine Seed Audio pitch must be an integer between -12 and 12.",
      );
    }
    audioConfig.pitch_rate = params.pitch;
  }

  const references = images.length
    ? images.map((url) => seedAudioReference(url, "image"))
    : [
        ...(voiceId ? [{ speaker: voiceId }] : []),
        ...audios.map((url) => seedAudioReference(url, "audio")),
      ];
  return {
    model,
    text_prompt: prompt,
    ...(references.length ? { references } : {}),
    ...(Object.keys(audioConfig).length ? { audio_config: audioConfig } : {}),
  };
}

function seedAudioMediaType(body: Record<string, unknown>): string {
  const format = record(body.audio_config).format;
  if (format === "mp3") return "audio/mpeg";
  if (format === "pcm") return "audio/pcm";
  if (format === "ogg_opus") return "audio/ogg";
  return "audio/wav";
}

export async function seedAudioSubmit(options: {
  apiKey: string;
  baseUrl?: string;
  body: Record<string, unknown>;
  fetch: typeof globalThis.fetch;
}): Promise<ExecutorStep> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new ProviderExecutionError({
      code: "authentication_failed",
      message: "This Volcengine Speech account has no apiKey stored.",
      retryable: false,
      requestState: "rejected",
    });
  }
  const response = await options.fetch(`${baseUrl(options.baseUrl)}/tts/create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(options.body),
  });
  const body = await responseBody(response);
  const providerCode = typeof body.code === "number" && body.code !== 0
    ? String(body.code)
    : undefined;
  const message =
    `Volcengine Seed Audio generation failed: ${messageFrom(body, response.statusText)}`;
  if (!response.ok) {
    throw providerHttpError({
      status: response.status,
      message,
      operation: "submit",
      ...(providerCode ? { providerCode } : {}),
    });
  }
  if (providerCode) {
    throw new ProviderExecutionError({
      code: "provider_failed",
      message,
      retryable: false,
      requestState: "rejected",
      providerCode,
    });
  }

  const mediaType = seedAudioMediaType(options.body);
  const audio = typeof body.audio === "string" ? body.audio.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!audio && !url) {
    throw new ProviderExecutionError({
      code: "invalid_response",
      message: "Volcengine Seed Audio generation returned neither audio nor url.",
      retryable: false,
      requestState: "accepted",
    });
  }
  return {
    status: "completed",
    media: {
      media: audio ? { base64: audio, mediaType } : { url, mediaType },
    },
  };
}

async function accountState(
  context: ExecutorContext,
): Promise<{ apiKey: string; baseUrl?: string }> {
  const [apiKey, customBaseUrl] = await Promise.all([
    context.store.get("apiKey"),
    context.store.get("baseUrl"),
  ]);
  if (!apiKey?.trim()) {
    throw new ProviderExecutionError({
      code: "authentication_failed",
      message: "This Volcengine Speech account has no apiKey stored.",
      retryable: false,
      requestState: "rejected",
    });
  }
  return {
    apiKey: apiKey.trim(),
    ...(customBaseUrl?.trim() ? { baseUrl: customBaseUrl.trim() } : {}),
  };
}

export const volcengineSpeechAdapter: Executor = {
  async submit(invocation, context): Promise<ExecutorStep> {
    const values = invocation.input.values as SeedAudioRequestValues;
    const references = await resolveVolcengineTypedReferences(
      invocation,
      context,
    );
    if (references.videos.length || references.startFrame || references.endFrame) {
      throw rejectedInvalidRequest(
        "Volcengine Seed Audio accepts only image or audio references.",
      );
    }
    const account = await accountState(context);
    return seedAudioSubmit({
      ...account,
      body: buildSeedAudioRequest(values, references),
      fetch: globalThis.fetch,
    });
  },
};
