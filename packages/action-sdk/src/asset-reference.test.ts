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
 * exposed a transport operation returning untyped JSON, so every author re-derived the shape by
 * guessing. The public helper now consumes the same typed reference primitive as executors.
 */
describe("resolveAssetReference exposes our side of the matrix", () => {
  const handle = {
    assetId: "local-gen-34019861",
    uri: "clash-asset://local-gen-34019861",
    kind: "image" as const,
  };

  const context = (reference: (input: unknown) => Promise<unknown>) => ({ reference } as never);

  it("reports inline bytes as bytes", async () => {
    const referenceMethod = vi.fn().mockResolvedValue({
      form: "bytes",
      kind: "image",
      mediaType: "image/png",
      bytes: Uint8Array.from([0, 0, 0]),
    });
    const reference = await resolveAssetReference(context(referenceMethod), handle);
    expect(reference.form).toBe("bytes");
    if (reference.form !== "bytes") throw new Error("unreachable");
    expect(reference.dataBase64).toBe("AAAA");
    expect(reference.mediaType).toBe("image/png");
  });

  it("reports a public URL as forwardable", async () => {
    const referenceMethod = vi.fn().mockResolvedValue({
      form: "url",
      kind: "image",
      url: "https://assets.example/a.png",
    });
    const reference = await resolveAssetReference(context(referenceMethod), handle);
    expect(reference.form).toBe("url");
    if (reference.form !== "url") throw new Error("unreachable");
    expect(reference.forwardable, "a provider may fetch this itself").toBe(true);
  });

  it("asks the typed reference context for the asset it was given", async () => {
    const referenceMethod = vi.fn().mockResolvedValue({
      form: "bytes",
      kind: "image",
      bytes: Uint8Array.from([0, 0, 0]),
    });
    await resolveAssetReference(context(referenceMethod), handle);
    expect(referenceMethod).toHaveBeenCalledWith({ asset: handle });
  });

  it("rejects text when the caller supplied an asset", async () => {
    const referenceMethod = vi.fn().mockResolvedValue({ form: "text", text: "not an asset" });
    await expect(resolveAssetReference(context(referenceMethod), handle)).rejects.toThrow(/text/i);
  });
});
