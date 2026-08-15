import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import type { DocumentAssetRevision } from "./document-assets.js";
import { registerDocumentKind } from "./document-kind-registry.js";
import type { GeneratorAssetType } from "./generator-v2.js";
import {
  createProjectAsset,
  purgeProjectAsset,
  trashProjectAsset,
} from "./project-assets.js";
import {
  DOCUMENT_ASSET_REVISIONS_CONTAINER,
  advanceDocumentAttachment,
  advanceProjectDocumentAssetHead,
  createProjectDocumentAsset,
  ensureDocumentAttachment,
  listDocumentAssetRevisions,
  listDocumentAttachments,
  listProjectDocumentAssets,
  markDocumentAssetAuthority,
  readDocumentAssetRevision,
  readDocumentAttachment,
  readProjectDocumentAsset,
} from "./project-document-assets.js";
import {
  createProjectGenerator,
  ensureActionRunRequest,
} from "./project-generators.js";

const BODY = {
  digest: `sha256:${"c".repeat(64)}`,
  byteLength: 128,
  contentType: "application/json",
} as const;

const GENERATOR_DEFINITION_REF = {
  pluginId: "clash.stage",
  definitionId: "director-stage",
  version: "1.0.0",
  schemaHash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
} as const;

function seedMediaAsset(doc: LoroDoc, id = "video-1"): void {
  expect(
    createProjectAsset(doc, {
      id,
      kind: "video",
      source: { kind: "owned", resourceId: `resource-${id}` },
      lifecycle: { state: "active" },
      metadata: {
        width: 1920,
        height: 1080,
        durationMs: 1_000,
        contentType: "video/mp4",
      },
    }),
  ).toMatchObject({ ok: true });
}

function seedActionRun(
  doc: LoroDoc,
  actionRunId = "run-1",
  outputAssetType: GeneratorAssetType = {
    kind: "media",
    mediaKind: "image",
  },
): void {
  expect(
    createProjectGenerator(doc, {
      head: { id: "stage-1", headRevisionId: "stage-revision-1" },
      revision: {
        id: "stage-revision-1",
        generatorId: "stage-1",
        definitionRef: GENERATOR_DEFINITION_REF,
        state: { scene: "courtyard" },
        persistentInputRefs: [],
      },
    }),
  ).toMatchObject({ ok: true });
  expect(
    ensureActionRunRequest(doc, {
      actionRunId,
      generatorRevision: {
        generatorId: "stage-1",
        generatorRevisionId: "stage-revision-1",
      },
      actionId: "render-still",
      executor: {
        pluginId: "clash.stage",
        version: "1.0.0",
        exportId: "render-still",
        schemaHash: GENERATOR_DEFINITION_REF.schemaHash,
      },
      invocationFingerprint:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      parameters: {},
      invocationInputRefs: [],
      outputContract: [
        {
          slot: outputAssetType.kind === "document" ? "document" : "image",
          assetType: outputAssetType,
          cardinality: { minItems: 1, maxItems: 1 },
        },
      ],
    }),
  ).toMatchObject({ ok: true });
}

function revision(input: {
  id: string;
  documentAssetId?: string;
  documentKind?: string;
  schemaVersion?: number;
  parentRevisionId?: string;
  mutability?: "immutable" | "versioned";
  digest?: string;
  producer?: DocumentAssetRevision["producer"];
  sourceRefs?: DocumentAssetRevision["sourceRefs"];
}): DocumentAssetRevision {
  return {
    id: input.id,
    documentAssetId: input.documentAssetId ?? "transcript",
    documentKind: input.documentKind ?? "media.transcript",
    schemaVersion: input.schemaVersion ?? 1,
    mutability: input.mutability ?? ("versioned" as const),
    ...(input.parentRevisionId
      ? { parentRevisionId: input.parentRevisionId }
      : {}),
    body: { ...BODY, ...(input.digest ? { digest: input.digest } : {}) },
    producer: input.producer ?? {
      kind: "actor",
      actor: { kind: "agent" },
    },
    sourceRefs: input.sourceRefs ?? [],
  };
}

describe("Project Document Asset authority", () => {
  it("advances a versioned head by CAS while retaining exact immutable revisions", () => {
    const doc = new LoroDoc();
    expect(markDocumentAssetAuthority(doc)).toMatchObject({ ok: true });
    expect(
      createProjectDocumentAsset(doc, revision({ id: "transcript:r1" })),
    ).toMatchObject({ ok: true, changed: true });

    const advanced = advanceProjectDocumentAssetHead(doc, {
      documentAssetId: "transcript",
      expectedHeadRevisionId: "transcript:r1",
      revision: revision({
        id: "transcript:r2",
        parentRevisionId: "transcript:r1",
        digest: `sha256:${"d".repeat(64)}`,
      }),
    });

    expect(advanced).toMatchObject({
      ok: true,
      changed: true,
      asset: { id: "transcript", headRevisionId: "transcript:r2" },
    });
    expect(
      readDocumentAssetRevision(doc, {
        documentAssetId: "transcript",
        revisionId: "transcript:r1",
      }),
    ).toMatchObject({ id: "transcript:r1" });
    expect(readProjectDocumentAsset(doc, "transcript")).toMatchObject({
      headRevisionId: "transcript:r2",
    });
  });

  it("rejects stale head CAS without inserting an orphan revision", () => {
    const doc = new LoroDoc();
    createProjectDocumentAsset(doc, revision({ id: "transcript:r1" }));

    const result = advanceProjectDocumentAssetHead(doc, {
      documentAssetId: "transcript",
      expectedHeadRevisionId: "stale",
      revision: revision({
        id: "transcript:r2",
        parentRevisionId: "stale",
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STALE_DOCUMENT_HEAD" },
    });
    expect(
      readDocumentAssetRevision(doc, {
        documentAssetId: "transcript",
        revisionId: "transcript:r2",
      }),
    ).toBeNull();
  });

  it("requires copy-on-write instead of advancing an immutable Document Asset", () => {
    const doc = new LoroDoc();
    createProjectDocumentAsset(doc, {
      ...revision({ id: "transcript:r1", mutability: "immutable" }),
      documentKind: "media.render-lineage",
    });

    expect(
      advanceProjectDocumentAssetHead(doc, {
        documentAssetId: "transcript",
        expectedHeadRevisionId: "transcript:r1",
        revision: {
          ...revision({
            id: "transcript:r2",
            parentRevisionId: "transcript:r1",
            mutability: "immutable",
          }),
          documentKind: "media.render-lineage",
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_COPY_ON_WRITE_REQUIRED" },
    });

    const fork = createProjectDocumentAsset(doc, {
      ...revision({ id: "copy:r1", mutability: "immutable" }),
      id: "copy:r1",
      documentAssetId: "copy",
      documentKind: "media.render-lineage",
      forkedFrom: {
        kind: "document",
        documentAssetId: "transcript",
        revisionId: "transcript:r1",
      },
    });
    expect(fork).toMatchObject({
      ok: true,
      revision: {
        forkedFrom: {
          documentAssetId: "transcript",
          revisionId: "transcript:r1",
        },
      },
    });
  });

  it("CAS-advances an attachment while every downstream ref remains an exact revision", () => {
    const doc = new LoroDoc();
    seedMediaAsset(doc);
    createProjectDocumentAsset(doc, revision({ id: "transcript:r1" }));
    advanceProjectDocumentAssetHead(doc, {
      documentAssetId: "transcript",
      expectedHeadRevisionId: "transcript:r1",
      revision: revision({
        id: "transcript:r2",
        parentRevisionId: "transcript:r1",
        digest: `sha256:${"e".repeat(64)}`,
      }),
    });
    const first = {
      id: "video-transcript",
      target: { kind: "project-asset" as const, projectAssetId: "video-1" },
      slot: "transcript",
      document: {
        kind: "document" as const,
        documentAssetId: "transcript",
        revisionId: "transcript:r1",
      },
    };
    expect(ensureDocumentAttachment(doc, first)).toMatchObject({
      ok: true,
      changed: true,
    });

    expect(
      advanceDocumentAttachment(doc, {
        attachmentId: "video-transcript",
        expectedRevisionId: "transcript:r1",
        document: {
          kind: "document",
          documentAssetId: "transcript",
          revisionId: "transcript:r2",
        },
      }),
    ).toMatchObject({ ok: true, changed: true });
    expect(readDocumentAttachment(doc, "video-transcript")).toMatchObject({
      document: { revisionId: "transcript:r2" },
    });
    expect(
      advanceDocumentAttachment(doc, {
        attachmentId: "video-transcript",
        expectedRevisionId: "transcript:r1",
        document: {
          kind: "document",
          documentAssetId: "transcript",
          revisionId: "transcript:r1",
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "STALE_DOCUMENT_ATTACHMENT" },
    });
  });

  it("treats revision and attachment replays as insert-or-compare facts", () => {
    const doc = new LoroDoc();
    const first = createProjectDocumentAsset(
      doc,
      revision({ id: "transcript:r1" }),
    );
    const replay = createProjectDocumentAsset(
      doc,
      revision({ id: "transcript:r1" }),
    );
    const collision = createProjectDocumentAsset(
      doc,
      revision({
        id: "transcript:r1",
        digest: `sha256:${"f".repeat(64)}`,
      }),
    );

    expect(first).toMatchObject({ ok: true, changed: true });
    expect(replay).toMatchObject({ ok: true, changed: false });
    expect(collision).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_REVISION_ID_COLLISION" },
    });
  });

  it("rejects an undeclared Document kind before creating authority facts", () => {
    const doc = new LoroDoc();

    expect(
      createProjectDocumentAsset(doc, {
        ...revision({ id: "unknown:r1" }),
        id: "unknown:r1",
        documentAssetId: "unknown",
        documentKind: "workspace.undeclared",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_KIND_NOT_DECLARED" },
    });
    expect(readProjectDocumentAsset(doc, "unknown")).toBeNull();
  });

  it("rejects a fork whose source belongs to another Document kind or schema version", () => {
    registerDocumentKind({
      definition: {
        kind: "test.fork-versioned",
        schemaVersion: 1,
        mutability: "versioned",
        projection: { format: "json", editable: true },
        allowedAttachmentTargets: ["project-asset"],
        productConsumers: [],
      },
      schema: { parse: (value) => value },
    });
    registerDocumentKind({
      definition: {
        kind: "test.fork-versioned",
        schemaVersion: 2,
        mutability: "versioned",
        projection: { format: "json", editable: true },
        allowedAttachmentTargets: ["project-asset"],
        productConsumers: [],
      },
      schema: { parse: (value) => value },
    });
    const doc = new LoroDoc();
    expect(
      createProjectDocumentAsset(
        doc,
        revision({
          id: "fork-source:r1",
          documentAssetId: "fork-source",
          documentKind: "test.fork-versioned",
        }),
      ),
    ).toMatchObject({ ok: true });

    const forkedFrom = {
      kind: "document" as const,
      documentAssetId: "fork-source",
      revisionId: "fork-source:r1",
    };

    expect(
      createProjectDocumentAsset(doc, {
        ...revision({
          id: "kind-mismatch:r1",
          documentAssetId: "kind-mismatch",
          documentKind: "media.description",
        }),
        forkedFrom,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_FORK_FAMILY_MISMATCH" },
    });
    expect(
      createProjectDocumentAsset(doc, {
        ...revision({
          id: "version-mismatch:r1",
          documentAssetId: "version-mismatch",
          documentKind: "test.fork-versioned",
          schemaVersion: 2,
        }),
        forkedFrom,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_FORK_FAMILY_MISMATCH" },
    });
    expect(readProjectDocumentAsset(doc, "kind-mismatch")).toBeNull();
    expect(readProjectDocumentAsset(doc, "version-mismatch")).toBeNull();
  });

  it("rejects a fork whose legacy source has different head mutability", () => {
    const doc = new LoroDoc();
    doc
      .getMap(DOCUMENT_ASSET_REVISIONS_CONTAINER)
      .ensureMergeableMap("legacy-source")
      .set(
        "legacy-source:r1",
        revision({
          id: "legacy-source:r1",
          documentAssetId: "legacy-source",
          mutability: "immutable",
        }),
      );

    expect(
      createProjectDocumentAsset(doc, {
        ...revision({
          id: "fork-target:r1",
          documentAssetId: "fork-target",
        }),
        forkedFrom: {
          kind: "document",
          documentAssetId: "legacy-source",
          revisionId: "legacy-source:r1",
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_FORK_FAMILY_MISMATCH" },
    });
    expect(readProjectDocumentAsset(doc, "fork-target")).toBeNull();
  });

  it.each([
    ["a missing Action Run", undefined],
    [
      "a media-only output contract",
      { kind: "media", mediaKind: "image" } as const,
    ],
    [
      "a wrong-kind output contract",
      {
        kind: "document",
        documentKind: "media.description",
        schemaVersion: 1,
      } as const,
    ],
    [
      "a wrong-version output contract",
      {
        kind: "document",
        documentKind: "media.transcript",
        schemaVersion: 2,
      } as const,
    ],
  ])("rejects an action-run producer with %s", (_label, outputAssetType) => {
    const doc = new LoroDoc();
    if (outputAssetType) seedActionRun(doc, "producer-run", outputAssetType);

    expect(
      createProjectDocumentAsset(
        doc,
        revision({
          id: "produced:r1",
          documentAssetId: "produced",
          producer: { kind: "action-run", actionRunId: "producer-run" },
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: {
        code: outputAssetType
          ? "DOCUMENT_PRODUCER_OUTPUT_MISMATCH"
          : "DOCUMENT_PRODUCER_NOT_FOUND",
      },
    });
    expect(readProjectDocumentAsset(doc, "produced")).toBeNull();
    expect(
      doc.getMap(DOCUMENT_ASSET_REVISIONS_CONTAINER).get("produced"),
    ).toBeUndefined();
  });

  it("accepts an existing Action Run whose Document output exactly matches the revision", () => {
    const doc = new LoroDoc();
    seedActionRun(doc, "producer-run", {
      kind: "document",
      documentKind: "media.transcript",
      schemaVersion: 1,
    });

    expect(
      createProjectDocumentAsset(
        doc,
        revision({
          id: "produced:r1",
          documentAssetId: "produced",
          producer: { kind: "action-run", actionRunId: "producer-run" },
        }),
      ),
    ).toMatchObject({ ok: true, changed: true });
  });

  it.each([
    { kind: "actor", actor: { kind: "user", id: "user-1" } } as const,
    { kind: "migration", source: "legacy-transcript" } as const,
  ])("allows a $kind producer without an Action Run", (producer) => {
    const doc = new LoroDoc();

    expect(
      createProjectDocumentAsset(
        doc,
        revision({
          id: "authored:r1",
          documentAssetId: "authored",
          producer,
        }),
      ),
    ).toMatchObject({ ok: true, changed: true });
  });

  it.each(["missing", "trashed", "purged"] as const)(
    "rejects a %s media source instead of pinning an inactive Project Asset",
    (lifecycle) => {
      const doc = new LoroDoc();
      if (lifecycle !== "missing") seedMediaAsset(doc);
      if (lifecycle === "trashed" || lifecycle === "purged") {
        expect(
          trashProjectAsset(doc, {
            id: "video-1",
            deleteOperationId: "delete-video-1",
            deletedAt: "2026-08-14T00:00:00.000Z",
            purgeAfter: "2026-08-21T00:00:00.000Z",
          }),
        ).toMatchObject({ ok: true });
      }
      if (lifecycle === "purged") {
        expect(
          purgeProjectAsset(doc, {
            id: "video-1",
            deleteOperationId: "delete-video-1",
            purgedAt: "2026-08-22T00:00:00.000Z",
          }),
        ).toMatchObject({ ok: true });
      }

      expect(
        createProjectDocumentAsset(
          doc,
          revision({
            id: "media-source:r1",
            documentAssetId: "media-source",
            sourceRefs: [
              {
                slot: "source",
                target: { kind: "media", projectAssetId: "video-1" },
              },
            ],
          }),
        ),
      ).toMatchObject({
        ok: false,
        error: {
          code:
            lifecycle === "missing"
              ? "DOCUMENT_SOURCE_NOT_FOUND"
              : "DOCUMENT_SOURCE_MEDIA_INACTIVE",
        },
      });
      expect(readProjectDocumentAsset(doc, "media-source")).toBeNull();
    },
  );

  it("rejects source refs to a missing exact Document or Generator revision", () => {
    const doc = new LoroDoc();
    seedActionRun(doc);

    expect(
      createProjectDocumentAsset(
        doc,
        revision({
          id: "missing-document-source:r1",
          documentAssetId: "missing-document-source",
          sourceRefs: [
            {
              slot: "source",
              target: {
                kind: "document",
                documentAssetId: "missing",
                revisionId: "missing:r1",
              },
            },
          ],
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_SOURCE_NOT_FOUND" },
    });
    expect(
      createProjectDocumentAsset(
        doc,
        revision({
          id: "missing-generator-source:r1",
          documentAssetId: "missing-generator-source",
          sourceRefs: [
            {
              slot: "source",
              target: {
                generatorId: "stage-1",
                generatorRevisionId: "missing-revision",
              },
            },
          ],
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_SOURCE_NOT_FOUND" },
    });
    expect(readProjectDocumentAsset(doc, "missing-document-source")).toBeNull();
    expect(
      readProjectDocumentAsset(doc, "missing-generator-source"),
    ).toBeNull();
  });

  it("accepts active media and exact Document and Generator revision sources", () => {
    const doc = new LoroDoc();
    seedMediaAsset(doc);
    seedActionRun(doc);
    expect(
      createProjectDocumentAsset(
        doc,
        revision({
          id: "description:r1",
          documentAssetId: "description",
          documentKind: "media.description",
        }),
      ),
    ).toMatchObject({ ok: true });

    expect(
      createProjectDocumentAsset(
        doc,
        revision({
          id: "transcript:r1",
          sourceRefs: [
            {
              slot: "media",
              target: { kind: "media", projectAssetId: "video-1" },
            },
            {
              slot: "description",
              target: {
                kind: "document",
                documentAssetId: "description",
                revisionId: "description:r1",
              },
            },
            {
              slot: "generator",
              target: {
                generatorId: "stage-1",
                generatorRevisionId: "stage-revision-1",
              },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: true, changed: true });
  });

  it("validates producer and source refs before advancing a Document head", () => {
    const doc = new LoroDoc();
    seedMediaAsset(doc);
    expect(
      createProjectDocumentAsset(doc, revision({ id: "transcript:r1" })),
    ).toMatchObject({ ok: true });
    expect(
      trashProjectAsset(doc, {
        id: "video-1",
        deleteOperationId: "delete-video-1",
        deletedAt: "2026-08-14T00:00:00.000Z",
        purgeAfter: "2026-08-21T00:00:00.000Z",
      }),
    ).toMatchObject({ ok: true });

    expect(
      advanceProjectDocumentAssetHead(doc, {
        documentAssetId: "transcript",
        expectedHeadRevisionId: "transcript:r1",
        revision: revision({
          id: "transcript:r2",
          parentRevisionId: "transcript:r1",
          producer: { kind: "action-run", actionRunId: "missing-run" },
        }),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_PRODUCER_NOT_FOUND" },
    });
    expect(
      advanceProjectDocumentAssetHead(doc, {
        documentAssetId: "transcript",
        expectedHeadRevisionId: "transcript:r1",
        revision: revision({
          id: "transcript:r3",
          parentRevisionId: "transcript:r1",
          sourceRefs: [
            {
              slot: "source",
              target: { kind: "media", projectAssetId: "video-1" },
            },
          ],
        }),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_SOURCE_MEDIA_INACTIVE" },
    });
    expect(
      readDocumentAssetRevision(doc, {
        documentAssetId: "transcript",
        revisionId: "transcript:r2",
      }),
    ).toBeNull();
    expect(
      readDocumentAssetRevision(doc, {
        documentAssetId: "transcript",
        revisionId: "transcript:r3",
      }),
    ).toBeNull();
  });

  it("lists stable Document heads, immutable history, and pinned attachments deterministically", () => {
    const doc = new LoroDoc();
    seedActionRun(doc);
    createProjectDocumentAsset(doc, revision({ id: "transcript:r1" }));
    advanceProjectDocumentAssetHead(doc, {
      documentAssetId: "transcript",
      expectedHeadRevisionId: "transcript:r1",
      revision: revision({
        id: "transcript:r2",
        parentRevisionId: "transcript:r1",
        digest: `sha256:${"d".repeat(64)}`,
      }),
    });
    createProjectDocumentAsset(doc, {
      ...revision({ id: "description:r1" }),
      id: "description:r1",
      documentAssetId: "description",
      documentKind: "media.description",
    });
    ensureDocumentAttachment(doc, {
      id: "attachment-z",
      target: { kind: "action-run", actionRunId: "run-1" },
      slot: "transcript",
      document: {
        kind: "document",
        documentAssetId: "transcript",
        revisionId: "transcript:r1",
      },
    });

    expect(listProjectDocumentAssets(doc).map((asset) => asset.id)).toEqual([
      "description",
      "transcript",
    ]);
    expect(
      listDocumentAssetRevisions(doc, "transcript").map(
        (candidate) => candidate.id,
      ),
    ).toEqual(["transcript:r1", "transcript:r2"]);
    expect(listDocumentAttachments(doc).map((entry) => entry.id)).toEqual([
      "attachment-z",
    ]);
  });

  it("rejects dangling attachment targets before writing a relation", () => {
    const doc = new LoroDoc();
    createProjectDocumentAsset(doc, revision({ id: "transcript:r1" }));

    expect(
      ensureDocumentAttachment(doc, {
        id: "dangling-transcript",
        target: { kind: "project-asset", projectAssetId: "missing-video" },
        slot: "transcript",
        document: {
          kind: "document",
          documentAssetId: "transcript",
          revisionId: "transcript:r1",
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_ATTACHMENT_TARGET_NOT_FOUND" },
    });
    expect(readDocumentAttachment(doc, "dangling-transcript")).toBeNull();
  });

  it("enforces each declared Document kind's allowed attachment targets", () => {
    registerDocumentKind({
      definition: {
        kind: "test.project-note",
        schemaVersion: 1,
        mutability: "versioned",
        projection: { format: "text", editable: true },
        allowedAttachmentTargets: ["project-asset"],
        productConsumers: [],
      },
      schema: { parse: (value) => value },
    });
    const doc = new LoroDoc();
    seedActionRun(doc);
    createProjectDocumentAsset(doc, {
      ...revision({ id: "note:r1" }),
      id: "note:r1",
      documentAssetId: "note",
      documentKind: "test.project-note",
    });

    expect(
      ensureDocumentAttachment(doc, {
        id: "run-note",
        target: { kind: "action-run", actionRunId: "run-1" },
        slot: "note",
        document: {
          kind: "document",
          documentAssetId: "note",
          revisionId: "note:r1",
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_ATTACHMENT_TARGET_NOT_ALLOWED" },
    });
    expect(readDocumentAttachment(doc, "run-note")).toBeNull();
  });
});
