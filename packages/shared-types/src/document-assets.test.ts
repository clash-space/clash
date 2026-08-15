import { describe, expect, it } from "vitest";

import {
  DocumentAssetRevisionSchema,
  DocumentAttachmentSchema,
  ProjectDocumentAssetSchema,
} from "./document-assets.js";

const BODY = {
  digest: `sha256:${"b".repeat(64)}`,
  byteLength: 512,
  contentType: "application/json",
} as const;

describe("typed Document Assets", () => {
  it("models a stable Asset head over immutable, content-addressed revisions", () => {
    const revision = DocumentAssetRevisionSchema.parse({
      id: "transcript:r1",
      documentAssetId: "transcript",
      documentKind: "media.transcript",
      schemaVersion: 1,
      mutability: "versioned",
      body: BODY,
      producer: { kind: "action-run", actionRunId: "asr-run-1" },
      sourceRefs: [
        {
          slot: "source",
          target: { kind: "media", projectAssetId: "video-1" },
        },
      ],
    });
    const asset = ProjectDocumentAssetSchema.parse({
      id: "transcript",
      headRevisionId: revision.id,
      documentKind: revision.documentKind,
      mutability: revision.mutability,
    });

    expect(asset).toEqual({
      id: "transcript",
      headRevisionId: "transcript:r1",
      documentKind: "media.transcript",
      mutability: "versioned",
    });
    expect(revision.body).toEqual(BODY);
    expect(JSON.stringify(revision)).not.toMatch(
      /(?:storageKey|storagePath|filePath|https?:\/\/)/,
    );
  });

  it("lets humans and agents author revisions without inventing an ActionRun", () => {
    for (const producer of [
      { kind: "actor", actor: { kind: "user", id: "user-1" } },
      { kind: "actor", actor: { kind: "agent", id: "agent-1" } },
    ] as const) {
      expect(
        DocumentAssetRevisionSchema.parse({
          id: `description:${producer.actor.kind}`,
          documentAssetId: "description",
          documentKind: "media.description",
          schemaVersion: 1,
          mutability: "versioned",
          body: BODY,
          producer,
          sourceRefs: [
            {
              slot: "source",
              target: { kind: "media", projectAssetId: "image-1" },
            },
          ],
        }).producer,
      ).toEqual(producer);
    }
  });

  it("attaches an exact Document revision to an Asset, Generator revision, or ActionRun", () => {
    const targets = [
      { kind: "project-asset", projectAssetId: "video-1" },
      {
        kind: "generator-revision",
        generatorId: "timeline-1",
        generatorRevisionId: "timeline:r7",
      },
      { kind: "action-run", actionRunId: "asr-run-1" },
    ] as const;

    for (const [index, target] of targets.entries()) {
      expect(
        DocumentAttachmentSchema.parse({
          id: `attachment-${index}`,
          target,
          slot: "transcript",
          document: {
            kind: "document",
            documentAssetId: "transcript",
            revisionId: "transcript:r1",
          },
        }).target,
      ).toEqual(target);
    }
  });

  it("rejects a mutable body locator or an attachment to a moving document head", () => {
    expect(
      DocumentAssetRevisionSchema.safeParse({
        id: "transcript:r1",
        documentAssetId: "transcript",
        documentKind: "media.transcript",
        schemaVersion: 1,
        mutability: "versioned",
        body: { ...BODY, url: "https://example.com/transcript.json" },
        producer: { kind: "action-run", actionRunId: "asr-run-1" },
        sourceRefs: [],
      }).success,
    ).toBe(false);
    expect(
      DocumentAttachmentSchema.safeParse({
        id: "attachment",
        target: { kind: "project-asset", projectAssetId: "video-1" },
        slot: "transcript",
        document: { documentAssetId: "transcript" },
      }).success,
    ).toBe(false);
  });
});
