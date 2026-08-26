import { describe, expect, it } from "vitest";

import type { ExecutorContext } from "@clash/action-sdk";
import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";

import { resolveVolcengineTypedReferences } from "./typed-references.js";

function invocation(
  references: ExecutablePluginInvocation["input"]["references"],
): ExecutablePluginInvocation {
  return {
    input: { values: {}, references },
  } as never;
}

function contextResolving(
  answer: (
    input: ExecutablePluginInvocation["input"]["references"][number],
  ) => Awaited<ReturnType<ExecutorContext["reference"]>>,
): ExecutorContext {
  return {
    reference: async (input: Parameters<typeof answer>[0]) => answer(input),
  } as never;
}

describe("resolveVolcengineTypedReferences", () => {
  it("forwards a provider-url image reference verbatim", async () => {
    const result = await resolveVolcengineTypedReferences(
      invocation([
        {
          slot: "image",
          index: 0,
          asset: { assetId: "image-1", uri: "clash-asset://image-1", kind: "image" },
        },
      ]),
      contextResolving(() => ({
        form: "provider-url",
        providerUrl: "https://media.test/image.png",
        expiresAt: "2026-08-13T12:00:00.000Z",
        kind: "image",
      })),
    );
    expect(result.images).toEqual(["https://media.test/image.png"]);
  });

  it("forwards an executor-url video reference the same way as a provider-url", async () => {
    const result = await resolveVolcengineTypedReferences(
      invocation([
        {
          slot: "video",
          index: 0,
          asset: { assetId: "video-1", uri: "clash-asset://video-1", kind: "video" },
        },
      ]),
      contextResolving(() => ({
        form: "executor-url",
        executorUrl: "https://host.local/executor/video-1",
        expiresAt: "2026-08-13T12:00:00.000Z",
        kind: "video",
      })),
    );
    expect(result.videos).toEqual(["https://host.local/executor/video-1"]);
  });

  it("builds a data URL for a bytes audio reference", async () => {
    const result = await resolveVolcengineTypedReferences(
      invocation([
        {
          slot: "audio",
          index: 0,
          asset: { assetId: "audio-1", uri: "clash-asset://audio-1", kind: "audio" },
        },
      ]),
      contextResolving(() => ({
        form: "bytes",
        bytes: Uint8Array.from([1, 2, 3, 4]),
        mediaType: "audio/mpeg",
        kind: "audio",
      })),
    );
    expect(result.audios).toEqual([
      `data:audio/mpeg;base64,${Buffer.from([1, 2, 3, 4]).toString("base64")}`,
    ]);
  });

  it("passes an unresolved content-slot text reference through without treating it as media", async () => {
    const result = await resolveVolcengineTypedReferences(
      invocation([
        { slot: "content", index: 0, text: { nodeId: "node-1", value: "hello" } },
      ]),
      contextResolving(() => ({ form: "text", text: "hello" })),
    );
    expect(result).toEqual({ images: [], videos: [], audios: [] });
  });

  it("rejects a document reference resolved for a media slot", async () => {
    await expect(
      resolveVolcengineTypedReferences(
        invocation([
          {
            slot: "image",
            index: 0,
            asset: { assetId: "doc-1", uri: "clash-asset://doc-1", kind: "image" },
          },
        ]),
        contextResolving(() => ({
          form: "document",
          documentKind: "media.description",
          schemaVersion: 1,
          body: { text: "not media" },
        })),
      ),
    ).rejects.toThrow(/resolved to a document instead of media/i);
  });

  it("rejects a non-text reference resolved for a media slot with a mismatched kind", async () => {
    await expect(
      resolveVolcengineTypedReferences(
        invocation([
          {
            slot: "image",
            index: 0,
            asset: { assetId: "image-1", uri: "clash-asset://image-1", kind: "image" },
          },
        ]),
        contextResolving(() => ({
          form: "provider-url",
          providerUrl: "https://media.test/clip.mp4",
          expiresAt: "2026-08-13T12:00:00.000Z",
          kind: "video",
        })),
      ),
    ).rejects.toThrow(/slot resolved to video media/i);
  });

  it("rejects a non-content media reference resolved to text", async () => {
    await expect(
      resolveVolcengineTypedReferences(
        invocation([
          {
            slot: "image",
            index: 0,
            asset: { assetId: "image-1", uri: "clash-asset://image-1", kind: "image" },
          },
        ]),
        contextResolving(() => ({ form: "text", text: "not an image" })),
      ),
    ).rejects.toThrow(/resolved to text instead of media/i);
  });
});
