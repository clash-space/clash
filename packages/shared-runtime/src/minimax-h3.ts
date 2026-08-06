export type MiniMaxH3OrderedContentPart =
  | { type: "text"; text: string }
  | { type: "image" | "video" | "audio"; url: string };

export interface MiniMaxH3ContentInput {
  prompt: string;
  orderedContentParts?: ReadonlyArray<MiniMaxH3OrderedContentPart>;
  startFrame?: string;
  endFrame?: string;
  referenceImages?: ReadonlyArray<string>;
  referenceVideos?: ReadonlyArray<string>;
  referenceAudios?: ReadonlyArray<string>;
}

function orderedPartToWire(part: MiniMaxH3OrderedContentPart): Record<string, unknown> {
  if (part.type === "text") return { type: "text", text: part.text };
  return {
    type: `${part.type}_url`,
    [`${part.type}_url`]: { url: part.url },
    role: `reference_${part.type}`,
  };
}

/** MiniMax-H3-specific wire adapter. Selection remains the responsibility of
 * the model/provider route; hosted and desktop runtimes compose this helper. */
export function buildMiniMaxH3Content(input: MiniMaxH3ContentInput): Array<Record<string, unknown>> {
  if (input.orderedContentParts?.length && !input.startFrame) {
    return input.orderedContentParts.map(orderedPartToWire);
  }
  return [
    { type: "text", text: input.prompt },
    ...(input.startFrame ? [{
      type: "image_url",
      image_url: { url: input.startFrame },
      role: "first_frame",
    }] : []),
    ...(input.endFrame ? [{
      type: "image_url",
      image_url: { url: input.endFrame },
      role: "last_frame",
    }] : []),
    ...(input.referenceImages ?? []).map((url) => ({
      type: "image_url",
      image_url: { url },
      role: "reference_image",
    })),
    ...(input.referenceVideos ?? []).map((url) => ({
      type: "video_url",
      video_url: { url },
      role: "reference_video",
    })),
    ...(input.referenceAudios ?? []).map((url) => ({
      type: "audio_url",
      audio_url: { url },
      role: "reference_audio",
    })),
  ];
}
