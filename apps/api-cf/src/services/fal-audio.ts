import { fal } from "@fal-ai/client";

export interface FalAudioParams {
  prompt: string;
  modelEndpoint: string;
  modelParams?: Record<string, unknown>;
  onEnqueue?: (requestId: string) => void;
  onQueueUpdate?: (status: { status: string; position?: number }) => void;
}

export interface FalAudioResult {
  url: string;
  contentType: string;
  requestId: string;
  model: string;
}

function stringParam(params: Record<string, unknown> | undefined, key: string, fallback = ""): string {
  const value = params?.[key];
  return typeof value === "string" ? value : fallback;
}

function numberParam(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = params?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function booleanParam(params: Record<string, unknown> | undefined, key: string): boolean {
  return params?.[key] === true;
}

export async function generateFalAudio(
  falApiKey: string,
  params: FalAudioParams,
): Promise<FalAudioResult> {
  fal.config({ credentials: falApiKey });
  const format = stringParam(params.modelParams, "format", "mp3");
  const result = await fal.subscribe(params.modelEndpoint, {
    input: {
      prompt: params.prompt,
      lyrics: stringParam(params.modelParams, "lyrics"),
      lyrics_optimizer: booleanParam(params.modelParams, "lyrics_optimizer"),
      is_instrumental: booleanParam(params.modelParams, "is_instrumental"),
      audio_setting: {
        sample_rate: numberParam(params.modelParams, "sample_rate", 44100),
        bitrate: numberParam(params.modelParams, "bitrate", 256000),
        format,
      },
    },
    timeout: 10 * 60 * 1000,
    onEnqueue: params.onEnqueue,
    onQueueUpdate: params.onQueueUpdate as any,
  } as any);
  const data = result.data as {
    audio?: { url?: string; content_type?: string };
    audio_file?: { url?: string; content_type?: string };
    audios?: Array<{ url?: string; content_type?: string }>;
  };
  const audio = data.audio ?? data.audio_file ?? data.audios?.[0];
  if (!audio?.url) throw new Error("No audio in fal MiniMax Music response");

  return {
    url: audio.url,
    contentType: audio.content_type ?? (format === "wav" ? "audio/wav" : "audio/mpeg"),
    requestId: result.requestId,
    model: params.modelEndpoint,
  };
}
