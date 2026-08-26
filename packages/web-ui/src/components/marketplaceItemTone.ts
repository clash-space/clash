import type { RegistryItem } from "@clash/web-ui/lib/clientActions";

import type { SemanticTone } from "./ui/tone";

const AUDIO_METADATA = /\b(audio|music|sound|speech|tts|voice)\b/i;
const VIDEO_METADATA = /\b(film|motion|video)\b/i;
const MEDIA_METADATA = /\b(asset|image|media|photo|picture)\b/i;

function metadataText(item: Pick<RegistryItem, "outputType" | "tags">): string {
  return [item.outputType, ...(item.tags ?? [])].filter(Boolean).join(" ");
}

export function marketplaceItemTone(item: RegistryItem): SemanticTone {
  const metadata = metadataText(item);
  if (AUDIO_METADATA.test(metadata)) return "amber";
  if (VIDEO_METADATA.test(metadata)) return "blue";
  if (MEDIA_METADATA.test(metadata)) return "teal";
  return item.type === "action" ? "lilac" : "blue";
}
