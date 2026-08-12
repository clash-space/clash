import { describe, expect, it } from "vitest";
import { TextRevisionContentDescriptorSchema } from "./index.js";

describe("revision content descriptors", () => {
  it("marks text revision content as host-indexed revision storage, not media assets", () => {
    expect(
      TextRevisionContentDescriptorSchema.parse({
        kind: "text-revision-content",
        stored: true,
        contentHash: "1234567890abcdef",
        mediaType: "text/markdown",
        url: "/api/v1/projects/project/text-revisions/txrev-1/content",
        immutable: true,
        storage: {
          kind: "content-addressed-revision-blob",
          registry: "text_revisions",
          mediaAsset: false,
          agentWritable: false,
        },
      }),
    ).toMatchObject({
      stored: true,
      storage: {
        registry: "text_revisions",
        mediaAsset: false,
        agentWritable: false,
      },
    });
  });
});
