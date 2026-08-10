import { describe, expect, it } from "vitest";

import { mediaFromResult } from "./provider-plugin-executor";

/**
 * A generation result arrives through the asset channel, not through a free-form value.
 *
 * `kind: "asset"` is the typed channel: its media type is a declared field, its URL carries a
 * stated reach, and zod checks both. Before the write contract had a `url`, a plugin whose upstream
 * published the result had no way to say so there, so it used `kind: "value"` and hand-rolled the
 * payload -- which is why `hilo-hub-media` guesses the media type from the model kind:
 *
 *   contentType: route.kind === "audio" ? "audio/mpeg" : ...
 *
 * That guess is the same one that broke reference audio at the other end of the pipe: the bytes were
 * an MP3, `audio/mpeg` is MP3's registered type, and the upstream derived `.mpeg` from it and
 * refused the file. Reading the response's own `content-type` is the fix, and it only becomes
 * expressible once the asset channel accepts a URL.
 */
describe("provider plugin media output", () => {
  function result(outputs: unknown[]) {
    return {
      protocol: "clash.plugin.result/v1",
      invocationId: "inv-1",
      status: "completed",
      outputs,
    };
  }

  it("reads a published URL from the asset channel", () => {
    const media = mediaFromResult(result([{
      slot: "media",
      kind: "asset",
      asset: {
        assetId: "upstream-1",
        uri: "clash-asset://upstream-1",
        kind: "video",
        mediaType: "video/mp4",
        url: "https://cdn.example/out.mp4",
        reach: "public",
      },
    }]));
    expect(media.url).toBe("https://cdn.example/out.mp4");
    expect(media.contentType).toBe("video/mp4");
  });

  it("refuses a URL the host cannot reach", () => {
    expect(() => mediaFromResult(result([{
      slot: "media",
      kind: "asset",
      asset: {
        assetId: "upstream-2",
        uri: "clash-asset://upstream-2",
        kind: "video",
        url: "http://127.0.0.1:9/out.mp4",
        reach: "private",
      },
    }]))).toThrow(/reach|private/i);
  });

  it("still accepts the value channel so installed plugins keep working", () => {
    const media = mediaFromResult(result([{
      slot: "media",
      kind: "value",
      value: { url: "https://cdn.example/out.png", contentType: "image/png" },
    }]));
    expect(media.url).toBe("https://cdn.example/out.png");
    expect(media.contentType).toBe("image/png");
  });
});
