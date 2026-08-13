import { describe, expect, it } from "vitest";

import {
  ActionRevisionMetadataTargetSchema,
  MetadataAttachmentTargetSchema,
  MediaTranscriptMetadataSchema,
  ProjectAssetMetadataTargetSchema,
  listDeclaredAssetMetadataKinds,
  metadataAttachmentTargetKey,
  parseAssetMetadataFillAction,
  registerAssetMetadataKind,
  summarizeTranscript,
  transcriptContentHashInput,
} from "./asset-metadata-registry.js";
import { z } from "zod";

const body = {
  schemaVersion: 1 as const,
  kind: "clash.asr.timed-transcript" as const,
  timebase: "milliseconds" as const,
  alignment: "word" as const,
  text: "hello world",
  backendId: "funasr",
  modelId: "paraformer-zh",
  language: "en",
  durationMs: 2_000,
  words: [
    { id: "w1", text: "hello", startMs: 0, endMs: 800, confidence: 0.9 },
    { id: "w2", text: "world", startMs: 900, endMs: 1_800, confidence: 0.7 },
  ],
  segments: [
    {
      id: "s1",
      text: "hello world",
      startMs: 0,
      endMs: 1_800,
      wordIds: ["w1", "w2"],
    },
  ],
};

function transcriptAction(overrides: Record<string, unknown> = {}) {
  return {
    actionId: "action-1",
    target: {
      kind: "project-asset",
      projectId: "project-cut",
      assetId: "asset-talk",
    },
    metadataKind: "media.transcript",
    producer: "clash.local.asr",
    metadata: {
      schemaVersion: 1,
      kind: "media.transcript",
      backendId: "funasr",
      modelId: "paraformer-zh",
      language: "en",
      sourceHash: `sha256:${"a".repeat(64)}`,
      contentHash: `sha256:${"b".repeat(64)}`,
      bodyHash: `sha256:${"c".repeat(64)}`,
      summary: { wordCount: 2, durationMs: 2_000, segmentCount: 1 },
    },
    ...overrides,
  };
}

describe("declared asset metadata registry", () => {
  it("addresses attachments with storage-free ProjectAsset and ActionRevision targets", () => {
    const projectAsset = ProjectAssetMetadataTargetSchema.parse({
      kind: "project-asset",
      projectId: "project-cut",
      assetId: "shared-id",
    });
    const actionRevision = ActionRevisionMetadataTargetSchema.parse({
      kind: "action-revision",
      projectId: "project-cut",
      actionId: "shared-id",
      actionRevisionId: "sha256:revision",
    });

    expect(MetadataAttachmentTargetSchema.parse(projectAsset)).toEqual(
      projectAsset,
    );
    expect(MetadataAttachmentTargetSchema.parse(actionRevision)).toEqual(
      actionRevision,
    );
    expect(metadataAttachmentTargetKey(projectAsset)).not.toBe(
      metadataAttachmentTargetKey(actionRevision),
    );
    expect(() =>
      MetadataAttachmentTargetSchema.parse({
        ...projectAsset,
        path: "/tmp/private.mov",
      }),
    ).toThrow();
    expect(() =>
      MetadataAttachmentTargetSchema.parse({
        ...actionRevision,
        url: "https://storage.example/private.json",
      }),
    ).toThrow();
  });

  it("rejects the pre-target targetAssetId envelope on every new write", () => {
    const current = transcriptAction();
    const { target: _target, ...withoutTarget } = current;

    expect(() =>
      parseAssetMetadataFillAction({
        ...withoutTarget,
        targetAssetId: "asset-talk",
      }),
    ).toThrow();
  });

  it("carries transcription as a first-class kind attachable to any audio or video asset", () => {
    expect(listDeclaredAssetMetadataKinds()).toContain("media.transcript");

    const action = parseAssetMetadataFillAction(transcriptAction());
    expect(action.metadataKind).toBe("media.transcript");
    expect(
      MediaTranscriptMetadataSchema.parse(action.metadata).summary.wordCount,
    ).toBe(2);
  });

  it("keeps the word grid out of the attached metadata, so a manifest never carries a body", () => {
    const attached = MediaTranscriptMetadataSchema.parse(
      transcriptAction().metadata,
    );
    expect(Object.keys(attached)).not.toContain("transcript");
    expect(Object.keys(attached)).not.toContain("words");
    // Three hashes and a summary, whatever the transcript's length.
    expect(JSON.stringify(attached).length).toBeLessThan(600);
  });

  it("hashes only the words, so restating the same grid keeps one identity", () => {
    const reflowed = {
      ...body,
      text: "Hello world.",
      segments: [
        { id: "s1", text: "hello", startMs: 0, endMs: 800, wordIds: ["w1"] },
        {
          id: "s2",
          text: "world",
          startMs: 900,
          endMs: 1_800,
          wordIds: ["w2"],
        },
      ],
    };
    expect(transcriptContentHashInput(reflowed)).toBe(
      transcriptContentHashInput(body),
    );

    const renumbered = {
      ...body,
      words: [{ ...body.words[0], id: "w9" }, body.words[1]],
    };
    expect(transcriptContentHashInput(renumbered)).not.toBe(
      transcriptContentHashInput(body),
    );
  });

  it("summarizes a body into the small facts worth indexing", () => {
    expect(summarizeTranscript(body)).toEqual({
      wordCount: 2,
      durationMs: 2_000,
      segmentCount: 1,
      averageConfidence: 0.8,
    });
  });

  it("validates a declared kind against its own schema instead of accepting any payload", () => {
    expect(() =>
      parseAssetMetadataFillAction(
        transcriptAction({
          metadata: {
            schemaVersion: 1,
            kind: "media.transcript",
            backendId: "funasr",
            modelId: "paraformer-zh",
            sourceHash: "not-a-sha256",
            contentHash: `sha256:${"b".repeat(64)}`,
            bodyHash: `sha256:${"c".repeat(64)}`,
            summary: { wordCount: 2, durationMs: 2_000 },
          },
        }),
      ),
    ).toThrow();
  });

  it("refuses the retired workflow kinds like any other undeclared kind", () => {
    expect(() =>
      parseAssetMetadataFillAction({
        actionId: "action-2",
        target: {
          kind: "project-asset",
          projectId: "project-cut",
          assetId: "asset-song",
        },
        metadataKind: "audio.beat-analysis",
        producer: "clash.local.beat",
        metadata: { kind: "audio.beat-analysis", bpm: 120 },
      }),
    ).toThrow(/Undeclared asset metadata kind: audio\.beat-analysis/u);
    expect(listDeclaredAssetMetadataKinds()).not.toContain(
      "talking-head.analysis",
    );
  });

  it("declares media.description alongside the transcript", () => {
    const action = parseAssetMetadataFillAction({
      actionId: "action-desc",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-talk",
      },
      metadataKind: "media.description",
      producer: "clash.local.aigc",
      metadata: {
        schemaVersion: 1,
        kind: "media.description",
        text: "A host waves, then launches orbiting icons.",
        language: "en",
        sourceHash: `sha256:${"a".repeat(64)}`,
      },
    });
    expect(action.metadataKind).toBe("media.description");
    expect(() =>
      parseAssetMetadataFillAction({
        actionId: "action-desc-bad",
        target: {
          kind: "project-asset",
          projectId: "project-cut",
          assetId: "asset-talk",
        },
        metadataKind: "media.description",
        producer: "clash.local.aigc",
        metadata: { schemaVersion: 1, kind: "media.description", text: "" },
      }),
    ).toThrow();
  });

  it("rejects a kind nobody declared, so the open registry never becomes a free-for-all", () => {
    expect(() =>
      parseAssetMetadataFillAction({
        actionId: "action-3",
        target: {
          kind: "project-asset",
          projectId: "project-cut",
          assetId: "asset-talk",
        },
        metadataKind: "totally.invented",
        producer: "someone",
        metadata: { kind: "totally.invented", whatever: true },
      }),
    ).toThrow(/totally\.invented/u);
  });

  it("lets a new kind be declared as data, with no switch branch and no CLI command", () => {
    registerAssetMetadataKind({
      kind: "media.loudness",
      schema: z.object({
        schemaVersion: z.literal(1),
        kind: z.literal("media.loudness"),
        integratedLufs: z.number(),
      }),
    });

    expect(listDeclaredAssetMetadataKinds()).toContain("media.loudness");
    const action = parseAssetMetadataFillAction({
      actionId: "action-4",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-talk",
      },
      metadataKind: "media.loudness",
      producer: "clash.local.loudness",
      metadata: {
        schemaVersion: 1,
        kind: "media.loudness",
        integratedLufs: -14,
      },
    });
    expect(action.metadataKind).toBe("media.loudness");
    expect(() =>
      parseAssetMetadataFillAction({
        actionId: "action-5",
        target: {
          kind: "project-asset",
          projectId: "project-cut",
          assetId: "asset-talk",
        },
        metadataKind: "media.loudness",
        producer: "clash.local.loudness",
        metadata: {
          schemaVersion: 1,
          kind: "media.loudness",
          integratedLufs: "quiet",
        },
      }),
    ).toThrow();
  });

  it("refuses a declaration whose schema does not pin its own kind", () => {
    expect(() =>
      registerAssetMetadataKind({
        kind: "media.mismatched",
        schema: z.object({
          schemaVersion: z.literal(1),
          kind: z.literal("media.other"),
        }),
      }),
    ).toThrow(/media\.mismatched/u);
  });

  it("refuses a newly declared kind that carries no schemaVersion", () => {
    expect(() =>
      registerAssetMetadataKind({
        kind: "media.unversioned",
        schema: z.object({ kind: z.literal("media.unversioned") }),
      }),
    ).toThrow(/schemaVersion/u);
  });
});
