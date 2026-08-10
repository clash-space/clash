import { describe, expect, it, vi } from "vitest";

import { readAssetForPlugin } from "./local-plugin-broker";

/**
 * The host hands over an address the plugin can actually reach.
 *
 * Run mode is the whole input: a `local` plugin runs on this machine and can fetch the host's own
 * asset endpoint, a `hosted` plugin cannot, and both are `https?://` strings that nothing
 * downstream can tell apart. Forwarding a loopback address to a hosted plugin points it at
 * whatever answers on its own network.
 *
 * A published URL is preferred whenever one exists, for either mode: it is the only case where no
 * bytes are read, encoded, or copied at all.
 */
describe("asset reach is decided by run mode", () => {
  const asset = { assetId: "local-gen-1", uri: "clash-asset://local-gen-1", kind: "image" as const };
  const bytes = { kind: "image" as const, bytes: new Uint8Array([1, 2, 3, 4]), mediaType: "image/png" };

  it("gives a local plugin the host's own URL and reads nothing", async () => {
    const readAsset = vi.fn().mockResolvedValue(bytes);
    const result = await readAssetForPlugin({
      asset,
      runtimeKind: "local",
      readAsset,
      localUrl: () => "http://127.0.0.1:57767/assets/a.png",
    });
    expect(result.url).toBe("http://127.0.0.1:57767/assets/a.png");
    expect(result.reach).toBe("private");
    expect(result.dataBase64).toBeUndefined();
  });

  it("never gives a hosted plugin a host-private URL", async () => {
    const result = await readAssetForPlugin({
      asset,
      runtimeKind: "hosted",
      readAsset: vi.fn().mockResolvedValue(bytes),
      localUrl: () => "http://127.0.0.1:57767/assets/a.png",
    });
    expect(result.url).toBeUndefined();
    expect(result.dataBase64, "bytes are the only thing it can use").toBeDefined();
  });

  it("prefers a published URL for either mode", async () => {
    for (const runtimeKind of ["local", "hosted"] as const) {
      const result = await readAssetForPlugin({
        asset,
        runtimeKind,
        readAsset: vi.fn().mockResolvedValue(bytes),
        publicUrl: () => "https://assets.example/a.png",
        localUrl: () => "http://127.0.0.1:57767/assets/a.png",
      });
      expect(result.url, runtimeKind).toBe("https://assets.example/a.png");
      expect(result.reach).toBe("public");
    }
  });

  it("falls back to bytes when there is no URL at all", async () => {
    const result = await readAssetForPlugin({
      asset,
      runtimeKind: "local",
      readAsset: vi.fn().mockResolvedValue(bytes),
    });
    expect(result.dataBase64).toBeDefined();
    expect(result.reach).toBeUndefined();
  });
});
