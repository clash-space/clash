import React from "react";
import type { Item, Asset } from "@clash/remotion-core";

// Each item renderer receives the item, its bound asset (if any),
// and layout info precomputed by the parent container.
export type ItemRenderProps = {
  item: Item;
  asset: Asset | null;
  width: number; // pixels
  height: number; // pixels (inner content area)
  pixelsPerFrame: number;
};

export type ItemRenderer = React.FC<ItemRenderProps>;

// Renderers (implemented per type)
import { AudioRenderer } from "./renderers/AudioRenderer";
import { ImageRenderer } from "./renderers/ImageRenderer";
import { TextRenderer } from "./renderers/TextRenderer";
import { SolidRenderer } from "./renderers/SolidRenderer";
import { StickerRenderer } from "./renderers/StickerRenderer";
import { TransitionRenderer } from "./renderers/TransitionRenderer";
import { CaptionRenderer } from "./renderers/CaptionRenderer";
import { CompositionRenderer } from "./renderers/CompositionRenderer";
import { DerivedOverlayRenderer } from "./renderers/DerivedOverlayRenderer";

// Registry: map item.type to its renderer.
// Adding a new type only requires wiring here and implementing its renderer.
export const itemRendererRegistry: Record<string, ItemRenderer> = {
  audio: AudioRenderer,
  image: ImageRenderer,
  text: TextRenderer,
  solid: SolidRenderer,
  sticker: StickerRenderer,
  transition: TransitionRenderer,
  composition: CompositionRenderer,
  "derived-overlay": DerivedOverlayRenderer,
} as const;

export function getRendererForItem(item: Item): ItemRenderer {
  if (item.type === "text" && Array.isArray(item.cues)) return CaptionRenderer;
  const Renderer = itemRendererRegistry[item.type] as ItemRenderer | undefined;
  // Default to SolidRenderer if unknown type to avoid runtime crash.
  return Renderer ?? SolidRenderer;
}
