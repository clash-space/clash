import { describe, expect, it } from "vitest";

import { mediaListFromResult } from "./provider-plugin-executor.js";

/**
 * An asset the host already holds is not something for the host to fetch.
 *
 * The plugin hands back declarative media; where the vendor answered with a link the Host fetched
 * it, stored the bytes, and issued an assetId before this result exists.
 *
 * So the last step of a real generation failed with "Provider plugin media asset carries no url for
 * the host to fetch" -- about an asset that was already sitting in the store, 2 MB of it, fetched
 * by the host itself moments earlier. The generation had completed and been paid for.
 *
 * The executor preserves that receipt for the durable publication step and never needs a storage
 * projection URL.
 */
const output = (asset: Record<string, unknown>) => ({
  protocol: "clash.plugin.result/v1",
  invocationId: "i-1",
  status: "completed" as const,
  outputs: [{ slot: "media", kind: "asset" as const, asset }],
});

describe("mediaListFromResult", () => {
  it("accepts an asset the host has already stored", () => {
    const media = mediaListFromResult(output({
      assetId: "gen-1.png",
      uri: "clash-asset://gen-1.png",
      kind: "image",
      mediaType: "image/png",
    }));
    expect(media[0]).toMatchObject({
      assetId: "gen-1.png",
      uri: "clash-asset://gen-1.png",
      kind: "image",
      mediaType: "image/png",
    });
  });

  it("rejects a legacy handle carrying a URL projection", () => {
    expect(() => mediaListFromResult(output({
      assetId: "a-1",
      uri: "clash-asset://a-1",
      kind: "image",
      mediaType: "image/png",
      url: "https://cdn.example.test/a.png",
      reach: "public",
    }))).toThrow();
  });

  it("preserves a Host staging receipt without inventing a projection URL", () => {
    // The durable output store resolves the project-scoped receipt directly from CAS. Requiring a
    // loopback URL here would make the Host fetch bytes it already owns.
    expect(mediaListFromResult(output({
      assetId: "a-3",
      uri: "clash-asset://a-3",
      kind: "image",
    }))).toEqual([{
      assetId: "a-3",
      uri: "clash-asset://a-3",
      kind: "image",
    }]);
  });

});
