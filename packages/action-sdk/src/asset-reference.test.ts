import { describe, expect, it, vi } from "vitest";

import { resolveAssetReference } from "./index";

/**
 * The SDK hands the author both forms and lets them choose.
 *
 * How we can supply an asset and what a provider will accept are independent. We hold either
 * a local file or something already published; a provider takes inline bytes, a URL it fetches
 * itself, or an upload endpoint. Six combinations, one of them impossible -- a local asset and
 * a provider that only fetches URLs -- and only the plugin author knows which column applies,
 * because only they know the upstream.
 *
 * So the SDK's job is to state our side precisely and get out of the way. Previously it
 * exposed a bare `broker(operation)` returning untyped JSON, so every author re-derived the
 * shape by guessing; the installed hilo plugin tests `value.startsWith("asset://")` while the
 * host emits `clash-asset://`, a mismatch nothing catches, which means that branch has never
 * run.
 */
describe("resolveAssetReference exposes our side of the matrix", () => {
  const handle = {
    assetId: "local-gen-34019861",
    uri: "clash-asset://local-gen-34019861",
    kind: "image" as const,
  };

  it("reports inline bytes as bytes", async () => {
    const broker = vi.fn().mockResolvedValue({
      handle: "clash-plugin-asset://1",
      kind: "image",
      mediaType: "image/png",
      byteLength: 4,
      dataBase64: "AAAA",
    });
    const reference = await resolveAssetReference({ broker }, handle);
    expect(reference.form).toBe("bytes");
    if (reference.form !== "bytes") throw new Error("unreachable");
    expect(reference.dataBase64).toBe("AAAA");
    expect(reference.mediaType).toBe("image/png");
  });

  it("reports a public URL as forwardable", async () => {
    const broker = vi.fn().mockResolvedValue({
      handle: "clash-plugin-asset://2",
      kind: "image",
      byteLength: 4,
      url: "https://assets.example/a.png",
      reach: "public",
    });
    const reference = await resolveAssetReference({ broker }, handle);
    expect(reference.form).toBe("url");
    if (reference.form !== "url") throw new Error("unreachable");
    expect(reference.forwardable, "a provider may fetch this itself").toBe(true);
  });

  it("reports a private URL as not forwardable", async () => {
    const broker = vi.fn().mockResolvedValue({
      handle: "clash-plugin-asset://3",
      kind: "image",
      byteLength: 4,
      url: "http://127.0.0.1:57767/assets/a.png",
      reach: "private",
    });
    const reference = await resolveAssetReference({ broker }, handle);
    if (reference.form !== "url") throw new Error("unreachable");
    expect(reference.forwardable, "only this process can reach it").toBe(false);
  });

  it("asks the broker for the asset it was given", async () => {
    const broker = vi.fn().mockResolvedValue({
      handle: "clash-plugin-asset://4",
      kind: "image",
      byteLength: 4,
      dataBase64: "AAAA",
    });
    await resolveAssetReference({ broker }, handle);
    expect(broker).toHaveBeenCalledWith({ kind: "asset.read", asset: handle });
  });

  it("rejects a broker answer that violates the contract", async () => {
    const broker = vi.fn().mockResolvedValue({
      handle: "clash-plugin-asset://5",
      kind: "image",
      byteLength: 4,
      url: "https://assets.example/a.png",
    });
    await expect(resolveAssetReference({ broker }, handle)).rejects.toThrow(/reach/i);
  });
});
