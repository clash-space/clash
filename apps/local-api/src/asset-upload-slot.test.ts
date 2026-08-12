import { describe, expect, it } from "vitest";

import { ExecutablePluginBrokerOperationSchema } from "@clash/shared-types";

/**
 * Somewhere to put bytes that is not the frame.
 *
 * `asset.write` carries `dataBase64`, so a result travels inside the JSON message that announces
 * it. One 30-second video from Gemini Omni is 3,470,456 characters that way, held at once by the
 * plugin, the pipe and the host while it is parsed.
 *
 * An upload slot separates the two: the host names a place, the plugin streams to it, and the
 * message carries only the handle. The same shape works hosted, where the place is presigned object
 * storage instead of a loopback port.
 */
describe("asset.upload-slot", () => {
  it("is an operation a plugin may request", () => {
    const parsed = ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "asset.upload-slot",
      slot: "media",
      assetKind: "video",
      mediaType: "video/mp4",
      byteLength: 2_602_842,
    });
    expect(parsed.success).toBe(true);
  });

  it("requires the size, so the host can refuse before the bytes arrive", () => {
    // A slot handed out without a size cannot enforce a quota, and the failure would land after the
    // upload rather than before it.
    const parsed = ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "asset.upload-slot",
      slot: "media",
      assetKind: "video",
    });
    expect(parsed.success).toBe(false);
  });

  it("lets asset.write finish an upload by naming it", () => {
    // The second half: the bytes are already stored, so this call carries an id rather than a
    // payload.
    const parsed = ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "asset.write",
      slot: "media",
      assetKind: "video",
      mediaType: "video/mp4",
      assetId: "asset-1",
    });
    expect(parsed.success).toBe(true);
  });
});
