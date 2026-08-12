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
 * the model/provider route; hosted and desktop runtimes compose this helper.
 *
 * The combination rules live here because this is the only function that turns these inputs into
 * H3's content array, and every host calls it before posting. They were previously inline in each
 * host, which meant two copies that could drift and, once the local host began delegating MiniMax to
 * a plugin executor, one copy about to be deleted — the executor is handed a finished body and has
 * no inputs left to check.
 */
export function buildMiniMaxH3Content(input: MiniMaxH3ContentInput): Array<Record<string, unknown>> {
  const orderedMediaParts = (input.orderedContentParts ?? []).filter((part) => part.type !== "text");

  if (input.endFrame && !input.startFrame) {
    // H3 interpolates from first_frame to last_frame. A last_frame on its own leaves it with no
    // starting image, and the request is billed before the API rejects it.
    throw new Error("MiniMax H3 end frame requires a start frame.");
  }

  if (input.startFrame && (
    input.referenceImages?.length
    || input.referenceVideos?.length
    || input.referenceAudios?.length
    || orderedMediaParts.length
  )) {
    // Frame interpolation and reference-guided generation are separate H3 modes; a request carrying
    // both is ambiguous. Ordered media parts matter as much as the explicit reference arrays: the
    // branch below only reads them when there is no start frame, so without this they would be
    // dropped silently and the user would pay for a generation that ignored their references.
    throw new Error("MiniMax H3 start/end frames cannot be mixed with omni references.");
  }

  if (input.orderedContentParts?.length && !input.startFrame) {
    // The prompt editor may place text around every @-mention, but MiniMax H3's
    // wire accepts at most one text item (business error 2013). Keep the
    // authored media order and carry the complete label-expanded prompt once.
    const media = input.orderedContentParts
      .filter((part) => part.type !== "text")
      .map(orderedPartToWire);
    const text = input.prompt || input.orderedContentParts
      .filter((part): part is Extract<MiniMaxH3OrderedContentPart, { type: "text" }> =>
        part.type === "text")
      .map((part) => part.text)
      .join("");
    return [
      ...(text ? [{ type: "text", text }] : []),
      ...media,
    ];
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
