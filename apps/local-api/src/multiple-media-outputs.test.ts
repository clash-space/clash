import { describe, expect, it } from "vitest";

import {
  mediaFromResult,
  mediaListFromResult,
} from "./provider-plugin-executor";

/**
 * A generation can produce more than one file.
 *
 * `mediaFromResult` took `outputs.find(entry => entry.slot === "media")` — the first match, and
 * nothing else. Everything after it was dropped without a word, which is the failure mode this
 * codebase keeps finding: a result that looks complete and is missing what you paid for.
 *
 * It is not hypothetical. gpt-image takes an `n`; MiniMax returns a video and its cover frame; image
 * models routinely return four variations of one prompt. Each is several assets from one call.
 */
const completed = (outputs: unknown[]) => ({
  protocol: "clash.plugin.result/v1",
  invocationId: "i-1",
  status: "completed",
  outputs,
});

const asset = (slot: string, assetId: string) => ({
  slot,
  kind: "asset",
  asset: {
    assetId,
    uri: `clash-asset://${assetId}`,
    kind: "image",
    mediaType: "image/png",
  },
});

describe("multiple media outputs", () => {
  it("returns every media asset, in the order the plugin produced them", () => {
    const media = mediaListFromResult(completed([
      asset("media", "a"),
      asset("media", "b"),
      asset("media", "c"),
    ]));
    expect(media.map((entry) => entry.assetId)).toEqual(["a", "b", "c"]);
  });

  it("rejects multiple results at the one-slot Provider Run boundary instead of dropping them", () => {
    expect(() =>
      mediaFromResult(
        completed([
          asset("media", "a"),
          asset("media", "b"),
        ]),
      ),
    ).toThrow(/2 media outputs.*expected exactly one/i);
  });

  it("still returns one when there is one", () => {
    const media = mediaListFromResult(completed([asset("media", "only")]));
    expect(media).toHaveLength(1);
  });

  it("keeps a differently named slot out of the media list", () => {
    // A cover frame and the video it belongs to are not interchangeable; a plugin that names them
    // apart means them to stay apart.
    const media = mediaListFromResult(completed([
      asset("media", "video"),
      asset("thumbnail", "cover"),
    ]));
    expect(media).toHaveLength(1);
    expect(media[0]?.assetId).toBe("video");
  });

  it("refuses a completed result with no media at all", () => {
    // Completed with nothing in it is not a result. Returning an empty list would let a caller
    // attach zero assets and mark the node done.
    expect(() => mediaListFromResult(completed([]))).toThrow(/no media/i);
  });
});
