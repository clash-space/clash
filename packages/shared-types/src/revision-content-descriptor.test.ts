import { describe, expect, it } from "vitest";
import {
  TextRevisionContentDescriptorSchema,
  TimelineRevisionContentDescriptorSchema,
} from "./index";

describe("revision content descriptors", () => {
  it("marks text revision content as host-indexed revision storage, not media assets", () => {
    expect(
      TextRevisionContentDescriptorSchema.parse({
        kind: "text-revision-content",
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
      storage: {
        registry: "text_revisions",
        mediaAsset: false,
        agentWritable: false,
      },
    });
  });

  it("marks timeline revision content as host-indexed revision storage, not media assets", () => {
    expect(
      TimelineRevisionContentDescriptorSchema.parse({
        kind: "timeline-revision-content",
        timelineHash: "1234567890abcdef",
        mediaType: "application/yaml",
        url: "/api/v1/projects/project/timeline-revisions/tlrev-1/content",
        immutable: true,
        storage: {
          kind: "content-addressed-revision-blob",
          registry: "timeline_revisions",
          mediaAsset: false,
          agentWritable: false,
        },
      }),
    ).toMatchObject({
      storage: {
        registry: "timeline_revisions",
        mediaAsset: false,
        agentWritable: false,
      },
    });
  });
});
