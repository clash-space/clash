export interface MiniMaxAudioParams {
  prompt: string;
  modelName?: string;
  modelParams?: Record<string, unknown>;
  baseUrl?: string;
}

export interface MiniMaxAudioResult {
  data: Uint8Array;
  mediaType: string;
  model: string;
}

const DEFAULT_MINIMAX_BASE_URL = "https://api.minimax.io";
const MINIMAX_MODEL_MAP: Record<string, string> = {
  "minimax-tts": "speech-02-hd",
};

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_MINIMAX_BASE_URL).replace(/\/$/, "");
}

function stringParam(params: Record<string, unknown> | undefined, key: string, fallback?: string): string | undefined {
  const value = params?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberParam(params: Record<string, unknown> | undefined, key: string, fallback?: number): number | undefined {
  const value = params?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function booleanParam(params: Record<string, unknown> | undefined, key: string, fallback = false): boolean {
  const value = params?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error("MiniMax audio response returned invalid hex audio.");
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < clean.length; index += 2) {
    const value = Number.parseInt(clean.slice(index, index + 2), 16);
    if (!Number.isFinite(value)) throw new Error("MiniMax audio response returned invalid hex audio.");
    bytes[index / 2] = value;
  }
  return bytes;
}

function mediaTypeForFormat(format: string | undefined): string {
  if (format === "wav") return "audio/wav";
  if (format === "flac") return "audio/flac";
  if (format === "pcm") return "audio/L16";
  return "audio/mpeg";
}

export async function generateMiniMaxAudio(
  apiKey: string | undefined,
  params: MiniMaxAudioParams,
): Promise<MiniMaxAudioResult> {
  const key = apiKey?.trim();
  if (!key) throw new Error("MiniMax provider account is missing apiKey.");
  const text = params.prompt.trim();
  const model = MINIMAX_MODEL_MAP[params.modelName ?? "minimax-tts"] ?? params.modelName ?? "speech-02-hd";
  const format = stringParam(params.modelParams, "format", "mp3") ?? "mp3";
  const isMusic = model.startsWith("music-");
  const lyrics = stringParam(params.modelParams, "lyrics", "") ?? "";
  if (!text && !isMusic) throw new Error("Prompt is required for MiniMax TTS.");
  const body = isMusic
    ? {
        model,
        prompt: text,
        lyrics,
        stream: false,
        output_format: "hex",
        lyrics_optimizer: booleanParam(params.modelParams, "lyrics_optimizer", false),
        is_instrumental: booleanParam(params.modelParams, "is_instrumental"),
        aigc_watermark: booleanParam(params.modelParams, "aigc_watermark"),
        audio_setting: {
          sample_rate: numberParam(params.modelParams, "sample_rate", 44100),
          bitrate: numberParam(params.modelParams, "bitrate", 256000),
          format,
        },
      }
    : {
        model,
        text,
        stream: false,
        output_format: "hex",
        voice_setting: {
          voice_id: stringParam(params.modelParams, "voice_id", "female-warm"),
          speed: numberParam(params.modelParams, "speed", 1),
          pitch: numberParam(params.modelParams, "pitch", 0),
        },
        audio_setting: {
          sample_rate: numberParam(params.modelParams, "sample_rate", 32000),
          bitrate: numberParam(params.modelParams, "bitrate", 128000),
          format,
          channel: numberParam(params.modelParams, "channel", 1),
        },
      };

  const resp = await fetch(`${normalizeBaseUrl(params.baseUrl)}${isMusic ? "/v1/music_generation" : "/v1/t2a_v2"}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const raw = await resp.text();
  let json: any;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { base_resp: { status_msg: raw } };
  }
  if (!resp.ok || json?.base_resp?.status_code !== 0) {
    const message = json?.base_resp?.status_msg ?? `${resp.status} ${resp.statusText}`;
    throw new Error(`MiniMax ${isMusic ? "music" : "TTS"} request failed: ${message}`);
  }
  const audio = json?.data?.audio;
  if (typeof audio !== "string" || !audio) {
    throw new Error(`MiniMax ${isMusic ? "music" : "TTS"} response returned no audio.`);
  }

  return {
    data: hexToBytes(audio),
    mediaType: mediaTypeForFormat(json?.extra_info?.audio_format ?? format),
    model,
  };
}
