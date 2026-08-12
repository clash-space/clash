import { describe, expect, it } from "vitest";

import { ExecutablePluginBrokerOperationSchema } from "@clash/shared-types";

/**
 * A vendor that answers with a link never hands over bytes.
 *
 * `asset.upload-slot` required `byteLength`, and rightly so for bytes: the host refuses an
 * oversized upload before the payload arrives rather than after. But a URL has no byte count until
 * someone fetches it, and fetching it to satisfy a schema pays for the transfer twice -- the host
 * is the side that knows whether it wants a copy at all.
 *
 * Every earlier test used bytes or base64, so the url form was first exercised by hrhrng.hub
 * against a real vendor. It failed with "Cannot read properties of undefined (reading
 * 'byteLength')" *after* the generation had completed and been paid for: the work was done and the
 * result dropped on the way home.
 */
describe("asset.upload-slot", () => {
  it("accepts a url with no byte count", () => {
    const parsed = ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "asset.upload-slot",
      slot: "media",
      assetKind: "image",
      mediaType: "image/png",
      url: "https://cdn.example.test/out.png",
    });
    expect(parsed.success).toBe(true);
  });

  it("still accepts bytes announced ahead of time", () => {
    const parsed = ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "asset.upload-slot",
      slot: "media",
      assetKind: "image",
      byteLength: 2048,
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a slot that names neither", () => {
    // Neither a count nor an address is a request for storage with nothing to store. Accepting it
    // would open a slot that can only ever be abandoned.
    const parsed = ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "asset.upload-slot",
      slot: "media",
      assetKind: "image",
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a plaintext url", () => {
    // The host will fetch this address. http means the bytes, and anything identifying in the
    // path, cross the network in the clear.
    const parsed = ExecutablePluginBrokerOperationSchema.safeParse({
      kind: "asset.upload-slot",
      slot: "media",
      assetKind: "image",
      url: "http://cdn.example.test/out.png",
    });
    expect(parsed.success).toBe(false);
  });
});
