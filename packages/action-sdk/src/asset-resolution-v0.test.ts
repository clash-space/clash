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
  it("builds a typed Document output locally without a Host round trip", async () => {
    const operations: unknown[] = [];
    const context = executorContextFrom({}, async (operation) => {
      operations.push(operation);
      throw new Error("Document output construction must not call the Host.");
    });

    await expect(
      context.document({
        slot: "transcript",
        documentKind: "media.transcript",
        schemaVersion: 1,
        body: { text: "hello" },
      }),
    ).resolves.toEqual({
      slot: "transcript",
      kind: "document",
      document: {
        documentKind: "media.transcript",
        schemaVersion: 1,
        body: { text: "hello" },
      },
    });
    expect(operations).toEqual([]);
  });

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

  it("passes an invocation-scoped executor URL through without fetching it", async () => {
    const operations: unknown[] = [];
    const context = executorContextFrom({}, async (operation) => {
      operations.push(operation);
      return {
        form: "executor-url",
        executorUrl:
          "http://127.0.0.1:49321/assets/capabilities/exact-resource",
        expiresAt: "2026-08-15T12:00:00.000Z",
        kind: "image",
        mediaType: "image/png",
      };
    });

    await expect(context.reference(reference)).resolves.toEqual({
      form: "executor-url",
      executorUrl: "http://127.0.0.1:49321/assets/capabilities/exact-resource",
      expiresAt: "2026-08-15T12:00:00.000Z",
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
    expect(resolved.form === "bytes" ? [...resolved.bytes] : []).toEqual([
      1, 2, 3,
    ]);
    expect(resolved).not.toHaveProperty("bytesBase64");
  });

  it("rejects an incomplete Provider URL at the SDK boundary", async () => {
    const context = executorContextFrom({}, async () => ({
      form: "provider-url",
      providerUrl: "https://objects.example.test/reference.png?sig=1",
    }));

    await expect(context.reference(reference)).rejects.toThrow(
      /resolved reference/i,
    );
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

    await expect(
      context.upload({
        slot: "media",
        kind: "image",
        mediaType: "image/png",
        url: "https://provider.example.test/output.png",
      }),
    ).rejects.toThrow(/Asset handle/i);
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

  it("resolves an exact typed Document revision without following its mutable head", async () => {
    const documentReference = {
      slot: "transcript",
      index: 0,
      document: {
        documentAssetId: "document-1",
        revisionId: "revision-2",
        documentKind: "media.transcript",
        schemaVersion: 1,
      },
    };
    const operations: unknown[] = [];
    const context = executorContextFrom({}, async (operation) => {
      operations.push(operation);
      return {
        form: "document",
        documentKind: "media.transcript",
        schemaVersion: 1,
        body: { text: "frozen words" },
      };
    });

    await expect(context.reference(documentReference)).resolves.toEqual({
      form: "document",
      documentKind: "media.transcript",
      schemaVersion: 1,
      body: { text: "frozen words" },
    });
    expect(operations).toEqual([
      { kind: "asset.resolve", reference: documentReference },
    ]);
  });
});
