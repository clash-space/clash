/**
 * Build a Vercel AI SDK user message from a generation's prompt + refs.
 *
 * Order of preference:
 *   1. `params.promptParts` — preserves @-mention interleaving. Each
 *      `asset_ref` becomes an inline content part right where the user typed
 *      the @-mention; surrounding text becomes a `text` part.
 *   2. Otherwise, append flat refs (`referenceImageR2Keys`, `referenceVideoR2Keys`,
 *      `referenceAudioR2Keys`) after the prompt text.
 *
 * R2 bytes are inlined as `Uint8Array`. The AI SDK normalizes per provider:
 * OpenAI vision → image_url(data URI); Vertex Gemini → inline_data; etc.
 *
 * Audio/video parts use `{ type: 'file', mediaType }`; only providers whose
 * model accepts that modality should be invoked with such refs (the model
 * card's `inputMode` already gates this upstream).
 */
import type { GenerationContext } from "./context";
import type { GenerationParams } from "./params";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: Uint8Array; mediaType: string }
  | { type: "file"; data: Uint8Array; mediaType: string };

export interface UserMessage {
  role: "user";
  content: ContentPart[];
}

async function readBytes(
  ctx: GenerationContext,
  r2Key: string,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const obj = await ctx.env.R2_BUCKET.get(r2Key);
  if (!obj) throw new Error(`R2 object not found: ${r2Key}`);
  const mediaType = obj.httpMetadata?.contentType || "application/octet-stream";
  const bytes = new Uint8Array(await obj.arrayBuffer());
  return { bytes, mediaType };
}

function partForBytes(bytes: Uint8Array, mediaType: string): ContentPart {
  return mediaType.startsWith("image/")
    ? { type: "image", image: bytes, mediaType }
    : { type: "file", data: bytes, mediaType };
}

export async function buildMultimodalUserMessage(
  ctx: GenerationContext,
  params: GenerationParams,
): Promise<UserMessage> {
  const content: ContentPart[] = [];
  const seen = new Set<string>();

  const fetchAndAppend = async (r2Key: string) => {
    if (seen.has(r2Key)) return;
    seen.add(r2Key);
    const { bytes, mediaType } = await readBytes(ctx, r2Key);
    content.push(partForBytes(bytes, mediaType));
  };

  if (params.promptParts?.length) {
    for (const part of params.promptParts) {
      if (part.type === "text" && part.text) {
        content.push({ type: "text", text: part.text });
      } else if (part.type === "asset_ref" && part.r2Key) {
        await fetchAndAppend(part.r2Key);
      }
    }
  } else if (params.prompt) {
    content.push({ type: "text", text: params.prompt });
  }

  for (const k of params.referenceImageR2Keys ?? []) await fetchAndAppend(k);
  for (const k of params.referenceVideoR2Keys ?? []) await fetchAndAppend(k);
  for (const k of params.referenceAudioR2Keys ?? []) await fetchAndAppend(k);

  if (content.length === 0) content.push({ type: "text", text: "" });
  return { role: "user", content };
}
