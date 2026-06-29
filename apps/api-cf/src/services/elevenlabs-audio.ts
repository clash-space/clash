export interface ElevenLabsAudioParams {
  prompt: string;
  modelName?: string;
  modelParams?: Record<string, unknown>;
  baseUrl?: string;
}

export interface ElevenLabsAudioResult {
  data: Uint8Array;
  mediaType: string;
  model: string;
}

const DEFAULT_ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
const ELEVENLABS_VOICE_IDS: Record<string, string> = {
  rachel: "21m00Tcm4TlvDq8ikWAM",
  drew: "29vD33N1CtxCmqQRPOHJ",
  clyde: "2EiwWnXFnvU5JabPnv8n",
  paul: "5Q0t7uMcjvnagumLfvZi",
};

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_ELEVENLABS_BASE_URL).replace(/\/$/, "");
}

function stringParam(params: Record<string, unknown> | undefined, key: string, fallback?: string): string | undefined {
  const value = params?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberParam(params: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = params?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function resolveVoiceId(value: string | undefined): string {
  const voice = value?.trim() || "rachel";
  return ELEVENLABS_VOICE_IDS[voice] ?? voice;
}

export async function generateElevenLabsAudio(
  apiKey: string | undefined,
  params: ElevenLabsAudioParams,
): Promise<ElevenLabsAudioResult> {
  const key = apiKey?.trim();
  if (!key) throw new Error("ElevenLabs provider account is missing apiKey.");
  const text = params.prompt.trim();
  if (!text) throw new Error("Prompt is required for ElevenLabs TTS.");

  const model = stringParam(params.modelParams, "model_id", DEFAULT_ELEVENLABS_MODEL) ?? DEFAULT_ELEVENLABS_MODEL;
  const voiceId = resolveVoiceId(stringParam(params.modelParams, "voice_id"));
  const stability = numberParam(params.modelParams, "stability");
  const similarityBoost = numberParam(params.modelParams, "similarity_boost");
  const voiceSettings =
    stability !== undefined || similarityBoost !== undefined
      ? {
          ...(stability !== undefined ? { stability } : {}),
          ...(similarityBoost !== undefined ? { similarity_boost: similarityBoost } : {}),
        }
      : undefined;
  const body = {
    text,
    model_id: model,
    ...(voiceSettings ? { voice_settings: voiceSettings } : {}),
  };

  const resp = await fetch(
    `${normalizeBaseUrl(params.baseUrl)}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!resp.ok) {
    const message = await resp.text();
    throw new Error(`ElevenLabs TTS request failed: ${message || `${resp.status} ${resp.statusText}`}`);
  }

  return {
    data: new Uint8Array(await resp.arrayBuffer()),
    mediaType: resp.headers.get("content-type") || "audio/mpeg",
    model,
  };
}
