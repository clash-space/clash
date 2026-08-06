// First-party provider projectors are intentionally pure. Provider network,
// credentials, assets, retries, and task lifecycle remain Kernel-owned.

export interface ProjectorReference {
  slot: string;
  index: number;
  asset?: {
    assetId: string;
    uri: string;
    kind: "image" | "video" | "audio" | "model";
    mediaType?: string;
  };
  text?: { nodeId: string; value: string };
}

export interface ProjectorInput {
  values: Record<string, unknown>;
  references?: ProjectorReference[];
}

export interface ProviderProjection {
  endpoint: string;
  input: Record<string, unknown>;
}

function stringValue(values: Record<string, unknown>, key: string, fallback = ""): string {
  return typeof values[key] === "string" ? values[key] as string : fallback;
}

function numberValue(values: Record<string, unknown>, key: string, fallback: number): number {
  return typeof values[key] === "number" && Number.isFinite(values[key])
    ? values[key] as number
    : fallback;
}

function booleanValue(values: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof values[key] === "boolean" ? values[key] as boolean : fallback;
}

function aliasedValue(values: Record<string, unknown>, primary: string, legacy: string): unknown {
  return values[primary] !== undefined ? values[primary] : values[legacy];
}

function aliasedStringValue(
  values: Record<string, unknown>,
  primary: string,
  legacy: string,
  fallback = "",
): string {
  const value = aliasedValue(values, primary, legacy);
  return typeof value === "string" ? value : fallback;
}

function aliasedNumberValue(
  values: Record<string, unknown>,
  primary: string,
  legacy: string,
  fallback: number,
): number {
  const value = aliasedValue(values, primary, legacy);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function aliasedBooleanValue(
  values: Record<string, unknown>,
  primary: string,
  legacy: string,
  fallback: boolean,
): boolean {
  const value = aliasedValue(values, primary, legacy);
  return typeof value === "boolean" ? value : fallback;
}

function referenceUrls(input: ProjectorInput, slot: string): string[] {
  return (input.references ?? [])
    .filter((reference) => reference.slot === slot && reference.asset)
    .sort((left, right) => left.index - right.index)
    .map((reference) => reference.asset!.uri);
}

export function projectFalH3(input: ProjectorInput): ProviderProjection {
  const values = input.values;
  const prompt = stringValue(values, "prompt");
  const duration = numberValue(values, "duration", 5);
  const resolution = stringValue(values, "resolution", "768P");
  const startFrame = referenceUrls(input, "startFrame")[0];
  const endFrame = referenceUrls(input, "endFrame")[0];

  if (startFrame) {
    return {
      endpoint: "minimax/h3/image-to-video",
      input: {
        prompt,
        duration,
        resolution,
        image_url: startFrame,
        ...(endFrame ? { end_image_url: endFrame } : {}),
      },
    };
  }

  const imageUrls = referenceUrls(input, "image");
  const videoUrls = referenceUrls(input, "video");
  const audioUrls = referenceUrls(input, "audio");
  const hasReferences = imageUrls.length + videoUrls.length + audioUrls.length > 0;
  const aspectRatio = aliasedStringValue(values, "aspect_ratio", "aspectRatio", "16:9");
  if (!hasReferences && aspectRatio === "adaptive") {
    throw new Error("MiniMax H3 adaptive aspect ratio requires at least one reference on fal.ai.");
  }
  return {
    endpoint: hasReferences ? "minimax/h3/reference-to-video" : "minimax/h3/text-to-video",
    input: {
      prompt,
      duration,
      resolution,
      aspect_ratio: aspectRatio,
      ...(imageUrls.length ? { reference_image_urls: imageUrls } : {}),
      ...(videoUrls.length ? { reference_video_urls: videoUrls } : {}),
      ...(audioUrls.length ? { reference_audio_urls: audioUrls } : {}),
    },
  };
}

export function projectFalSeedance2(input: ProjectorInput): ProviderProjection {
  const values = input.values;
  const startFrame = referenceUrls(input, "startFrame")[0];
  const endFrame = referenceUrls(input, "endFrame")[0];
  const imageUrls = referenceUrls(input, "image");
  const videoUrls = referenceUrls(input, "video");
  const audioUrls = referenceUrls(input, "audio");
  const hasReferences = imageUrls.length + videoUrls.length + audioUrls.length > 0;
  const duration = values.duration === "auto"
    ? "auto"
    : numberValue(values, "duration", 5);
  const common = {
    prompt: stringValue(values, "prompt"),
    duration,
    resolution: stringValue(values, "resolution", "720p"),
    generate_audio: aliasedBooleanValue(values, "generate_audio", "generateAudio", true),
    ...(typeof values.seed === "number" && Number.isFinite(values.seed)
      ? { seed: values.seed }
      : {}),
  };

  if (startFrame) {
    return {
      endpoint: "bytedance/seedance-2.0/image-to-video",
      input: {
        ...common,
        image_url: startFrame,
        ...(endFrame ? { end_image_url: endFrame } : {}),
      },
    };
  }
  return {
    endpoint: hasReferences
      ? "bytedance/seedance-2.0/reference-to-video"
      : "bytedance/seedance-2.0/text-to-video",
    input: {
      ...common,
      aspect_ratio: aliasedStringValue(values, "aspect_ratio", "aspectRatio", "auto"),
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
      ...(videoUrls.length ? { video_urls: videoUrls } : {}),
      ...(audioUrls.length ? { audio_urls: audioUrls } : {}),
    },
  };
}

export function projectFalMiniMaxMusic3(input: ProjectorInput): ProviderProjection {
  const values = input.values;
  return {
    endpoint: "fal-ai/minimax-music/v3",
    input: {
      prompt: stringValue(values, "prompt"),
      lyrics: stringValue(values, "lyrics"),
      lyrics_optimizer: aliasedBooleanValue(values, "lyrics_optimizer", "lyricsOptimizer", false),
      is_instrumental: aliasedBooleanValue(values, "is_instrumental", "instrumental", false),
      audio_setting: {
        sample_rate: aliasedNumberValue(values, "sample_rate", "sampleRate", 44_100),
        bitrate: numberValue(values, "bitrate", 256_000),
        format: stringValue(values, "format", "mp3"),
      },
    },
  };
}
