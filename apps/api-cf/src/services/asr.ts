import { fal } from "@fal-ai/client";

export interface AsrSegment {
  start: number;
  end: number;
  text: string;
}

export interface AsrResult {
  text: string;
  segments: AsrSegment[];
}

/**
 * Transcribe audio/video using fal.ai Whisper.
 * @param falApiKey fal.ai API key
 * @param audioUrl Public URL of the audio file (fal CDN or HTTP)
 * @param options Optional language hint
 */
export async function transcribeAudio(
  falApiKey: string,
  audioUrl: string,
  options?: { language?: string },
): Promise<AsrResult> {
  fal.config({ credentials: falApiKey });

  const input: Record<string, unknown> = {
    audio_url: audioUrl,
    task: "transcribe",
    chunk_level: "segment",
  };
  if (options?.language) {
    input.language = options.language;
  }

  const result = await fal.subscribe("fal-ai/whisper", {
    input: input as { audio_url: string },
  });

  const data = result.data;

  return {
    text: data.text,
    segments: (data.chunks || []).map((chunk) => ({
      start: Number(chunk.timestamp[0]) || 0,
      end: Number(chunk.timestamp[1]) || 0,
      text: chunk.text,
    })),
  };
}
