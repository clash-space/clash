import { describe, expect, it } from "vitest";

import { executorContextFrom } from "./define-plugin.js";

const reference = {
  slot: "startFrame",
  index: 0,
  asset: {
    assetId: "asset-1",
    uri: "clash-asset://asset-1",
    kind: "image" as const,
    mediaType: "image/png",
  },
};

describe("v0 SDK Asset resolution", () => {
  it("passes the full reference to the Host and returns a Provider URL", async () => {
    const operations: unknown[] = [];
    const context = executorContextFrom({}, async (operation) => {
      operations.push(operation);
      return {
        form: "provider-url",
        providerUrl: "https://objects.example.test/reference.png?sig=1",
        expiresAt: "2026-08-13T12:00:00.000Z",
        kind: "image",
        mediaType: "image/png",
      };
    });

    await expect(context.reference(reference)).resolves.toEqual({
      form: "provider-url",
      providerUrl: "https://objects.example.test/reference.png?sig=1",
      expiresAt: "2026-08-13T12:00:00.000Z",
      kind: "image",
      mediaType: "image/png",
    });
    expect(operations).toEqual([{ kind: "asset.resolve", reference }]);
  });

  it("decodes the Host wire representation before plugin code receives bytes", async () => {
    const context = executorContextFrom({}, async () => ({
      form: "bytes",
      bytesBase64: "AQID",
      kind: "image",
      mediaType: "image/png",
    }));

    const resolved = await context.reference(reference);
    expect(resolved).toMatchObject({
      form: "bytes",
      kind: "image",
      mediaType: "image/png",
    });
    expect(resolved.form === "bytes" ? [...resolved.bytes] : []).toEqual([1, 2, 3]);
    expect(resolved).not.toHaveProperty("bytesBase64");
  });

  it("rejects an incomplete Provider URL at the SDK boundary", async () => {
    const context = executorContextFrom({}, async () => ({
      form: "provider-url",
      providerUrl: "https://objects.example.test/reference.png?sig=1",
    }));

    await expect(context.reference(reference)).rejects.toThrow(/resolved reference/i);
  });

  it("rejects a Host projection masquerading as an Asset output handle", async () => {
    const context = executorContextFrom({}, async () => ({
      assetId: "asset-output",
      uri: "clash-asset://asset-output",
      kind: "image",
      mediaType: "image/png",
      url: "https://objects.example.test/output.png",
      reach: "public",
    }));

    await expect(context.upload({
      slot: "media",
      kind: "image",
      mediaType: "image/png",
      url: "https://provider.example.test/output.png",
    })).rejects.toThrow(/Asset handle/i);
  });

  it("passes typed text references through the same Host resolver", async () => {
    const textReference = {
      slot: "prompt",
      index: 0,
      text: { nodeId: "text-1", value: "A paper moon" },
    };
    const operations: unknown[] = [];
    const context = executorContextFrom({}, async (operation) => {
      operations.push(operation);
      return { form: "text", text: "A paper moon" };
    });

    await expect(context.reference(textReference)).resolves.toEqual({
      form: "text",
      text: "A paper moon",
    });
    expect(operations).toEqual([
      { kind: "asset.resolve", reference: textReference },
    ]);
  });
});
