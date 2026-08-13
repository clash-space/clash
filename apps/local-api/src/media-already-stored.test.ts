import { describe, expect, it } from "vitest";

import { mediaListFromResult } from "./provider-plugin-executor.js";

// Where this host serves what it has stored. `readAssetForPlugin` already had a `localUrl` hook for
// exactly this -- "the host's own asset endpoint, which it can fetch because it runs here" -- and
// nothing ever passed one in, so a stored asset had no address and the only way to describe one was
// to change the media type.
const ORIGIN = "http://127.0.0.1:8787";

/**
 * An asset the host already holds is not something for the host to fetch.
 *
 * `mediaFromOutput` required `asset.url` with `reach: "public"`, which was right when the plugin's
 * only way to return a file was to name a link the host would then download. It is no longer the
 * only way: a plugin now hands back declarative media, and where the vendor answered with a link
 * the *host* fetched it, stored the bytes, and issued an assetId.
 *
 * So the last step of a real generation failed with "Provider plugin media asset carries no url for
 * the host to fetch" -- about an asset that was already sitting in the store, 2 MB of it, fetched
 * by the host itself moments earlier. The generation had completed and been paid for.
 *
 * A stored asset has no public URL on a local host and never will; that is what `reach: "private"`
 * has meant all along.
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
      url: `${ORIGIN}/assets/projects/p/plugins/gen-1.png`,
      reach: "private",
    }));
    // The host serves it. An asset it stored moments ago is not something it must be handed a
    // vendor link for, and `url` stays required on the media because every consumer downstream
    // fetches one.
    expect(media[0]).toMatchObject({
      url: `${ORIGIN}/assets/projects/p/plugins/gen-1.png`,
      contentType: "image/png",
    });
  });

  it("prefers the vendor's published url over this host's copy", () => {
    // `assetId` is required on every handle, so "stored here" and "published there" are not two
    // shapes -- they are one handle that may also carry a url. A published address wins: it is a
    // CDN, the bytes are already there, and pointing at this host would put a laptop in front of a
    // link the vendor is already serving.
    const media = mediaListFromResult(output({
      assetId: "a-1",
      uri: "clash-asset://a-1",
      kind: "image",
      mediaType: "image/png",
      url: "https://cdn.example.test/a.png",
      reach: "public",
    }));
    expect(media[0]).toMatchObject({ url: "https://cdn.example.test/a.png" });
  });

  it("uses the host-private projection returned with its stored copy", () => {
    const media = mediaListFromResult(output({
      assetId: "a-2",
      uri: "clash-asset://a-2",
      kind: "image",
      url: `${ORIGIN}/assets/projects/p/plugins/a-2.png`,
      reach: "private",
    }));
    expect(media[0]).toMatchObject({
      url: `${ORIGIN}/assets/projects/p/plugins/a-2.png`,
    });
  });

  it("preserves a Host staging receipt without inventing a projection URL", () => {
    // The durable output store resolves the project-scoped receipt directly from CAS. Requiring a
    // loopback URL here would make the Host fetch bytes it already owns.
    expect(mediaListFromResult(output({
      assetId: "a-3",
      uri: "clash-asset://a-3",
      kind: "image",
    }))).toEqual([{ assetId: "a-3" }]);
  });

});
