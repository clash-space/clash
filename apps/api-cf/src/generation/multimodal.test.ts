import { describe, expect, it, vi } from "vitest";

import { buildMultimodalUserMessage } from "./multimodal";

describe("buildMultimodalUserMessage", () => {
  it("preserves authored text/media order and deduplicates flat references", async () => {
    const media = new Map([
      ["images/first.png", { bytes: new Uint8Array([1]), contentType: "image/png" }],
      ["images/second.png", { bytes: new Uint8Array([2]), contentType: "image/png" }],
    ]);
    const get = vi.fn(async (key: string) => {
      const item = media.get(key);
      if (!item) return null;
      return {
        httpMetadata: { contentType: item.contentType },
        arrayBuffer: async () => item.bytes.buffer,
      };
    });
    const ctx = { env: { R2_BUCKET: { get } } } as any;

    const message = await buildMultimodalUserMessage(ctx, {
      prompt: "Compare First, then Second.",
      promptParts: [
        { type: "text", text: "Compare " },
        { type: "asset_ref", nodeId: "image-a", r2Key: "images/first.png" },
        { type: "text", text: ", then " },
        { type: "asset_ref", nodeId: "image-b", r2Key: "images/second.png" },
        { type: "text", text: "." },
      ],
      referenceImageR2Keys: ["images/first.png", "images/second.png"],
    } as any);

    expect(message.content.map((part) => part.type)).toEqual([
      "text",
      "image",
      "text",
      "image",
      "text",
    ]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("preserves repeated inline references while appending only unmentioned globals", async () => {
    const get = vi.fn(async (key: string) => ({
      httpMetadata: { contentType: "image/png" },
      arrayBuffer: async () => new Uint8Array([key === "global.png" ? 2 : 1]).buffer,
    }));
    const ctx = { env: { R2_BUCKET: { get } } } as any;

    const message = await buildMultimodalUserMessage(ctx, {
      promptParts: [
        { type: "text", text: "Return to " },
        { type: "asset_ref", nodeId: "image-a", r2Key: "inline.png" },
        { type: "text", text: " after " },
        { type: "asset_ref", nodeId: "image-a", r2Key: "inline.png" },
      ],
      referenceImageR2Keys: ["inline.png", "global.png"],
    } as any);

    expect(message.content.map((part) => part.type)).toEqual([
      "text",
      "image",
      "text",
      "image",
      "image",
    ]);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
