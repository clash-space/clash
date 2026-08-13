import { describe, expect, it } from "vitest";

import { mediaFromResult } from "./provider-plugin-executor";

/**
 * A generation result arrives through the asset channel, not through a free-form value.
 *
 * `kind: "asset"` is the typed channel: its identity is the Host-issued staging receipt and its
 * media type is an immutable fact. URL projections do not cross this boundary.
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

  it("reads a Host staging receipt from the asset channel", () => {
    const media = mediaFromResult(result([{
      slot: "media",
      kind: "asset",
      asset: {
        assetId: "upstream-1",
        uri: "clash-asset://upstream-1",
        kind: "video",
        mediaType: "video/mp4",
      },
    }]));
    expect(media).toEqual({
      assetId: "upstream-1",
      uri: "clash-asset://upstream-1",
      kind: "video",
      mediaType: "video/mp4",
    });
  });

  it("rejects the retired URL/reach Asset projection", () => {
    expect(() => mediaFromResult(result([{
      slot: "media",
      kind: "asset",
      asset: {
        assetId: "upstream-2",
        uri: "clash-asset://upstream-2",
        kind: "video",
        url: "https://cdn.example/out.mp4",
        reach: "private",
      },
    }]))).toThrow();
  });

  it("preserves a Host staging receipt without requiring a loopback projection", () => {
    expect(mediaFromResult(result([{
      slot: "media",
      kind: "asset",
      asset: {
        assetId: "upstream-2",
        uri: "clash-asset://upstream-2",
        kind: "video",
      },
    }]))).toEqual({
      assetId: "upstream-2",
      uri: "clash-asset://upstream-2",
      kind: "video",
    });
  });

  it("rejects the retired free-form URL value channel", () => {
    expect(() => mediaFromResult(result([{
      slot: "media",
      kind: "value",
      value: { url: "https://cdn.example/out.png", contentType: "image/png" },
    }]))).toThrow(/canonical Asset output envelope/i);
  });
});
