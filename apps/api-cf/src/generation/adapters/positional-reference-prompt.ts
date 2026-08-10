import {
  appendUnmentionedGlobalReferences,
  renderPositionalReferencePrompt,
  type OrderedPromptContentPart,
} from "@clash/shared-types";
import type { GenerationParams } from "../params";

/** Apply only the selected provider route's positional-token dialect. Other
 * bindings keep the clean prompt untouched and are handled by their adapter. */
export function positionalReferencePrompt(params: GenerationParams): string {
  const binding = params.selectedRoute?.referenceBinding;
  if (binding?.type !== "positional-tokens" || !params.promptParts?.length) {
    return params.prompt ?? "";
  }
  const parts: OrderedPromptContentPart[] = [];
  for (const part of params.promptParts) {
    if (part.type === "text") {
      if (part.text) parts.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type !== "asset_ref") continue;
    if (!part.r2Key || !part.modality) {
      throw new Error("Inline media reference could not be resolved for the selected provider.");
    }
    parts.push({ type: part.modality, url: part.r2Key });
  }
  const orderedParts = appendUnmentionedGlobalReferences(parts, [
      ...(params.referenceImageR2Keys ?? []).map((url) => ({ type: "image" as const, url })),
      ...(params.referenceVideoR2Keys ?? []).map((url) => ({ type: "video" as const, url })),
      ...(params.referenceAudioR2Keys ?? []).map((url) => ({ type: "audio" as const, url })),
    ]);
  if (!orderedParts.some((part) => part.type === "text") && params.prompt) {
    orderedParts.unshift({ type: "text", text: params.prompt });
  }
  if (!orderedParts.some((part) => part.type !== "text")) return params.prompt ?? "";
  return renderPositionalReferencePrompt({
    parts: orderedParts,
    references: {
      image: params.referenceImageR2Keys ?? [],
      video: params.referenceVideoR2Keys ?? [],
      audio: params.referenceAudioR2Keys ?? [],
    },
    tokens: binding.tokens ?? {},
  });
}
