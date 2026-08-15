import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import * as sharedTypes from "./index.js";

type GeneratorAuthorityApi = {
  GENERATOR_AUTHORITY_VERSION?: number;
  generatorAuthorityVersion?: (doc: LoroDoc) => number | undefined;
  markGeneratorAuthority?: (
    doc: LoroDoc,
  ) => { ok: true; version: number } | { ok: false; error: { code: string } };
  createProjectGenerator?: (
    doc: LoroDoc,
    input: { head: unknown; revision: unknown },
  ) =>
    | {
        ok: true;
        generator: Record<string, unknown>;
        revision: Record<string, unknown>;
        changed: boolean;
      }
    | { ok: false; error: { code: string } };
  readProjectGenerator?: (
    doc: LoroDoc,
    generatorId: string,
  ) => Record<string, unknown> | null;
  readGeneratorRevision?: (
    doc: LoroDoc,
    ref: { generatorId: string; generatorRevisionId: string },
  ) => Record<string, unknown> | null;
  advanceProjectGeneratorHead?: (
    doc: LoroDoc,
    input: {
      generatorId: string;
      expectedHeadRevisionId: string;
      revision: unknown;
      editPolicy: "advance-head" | "fork-when-materialized";
    },
  ) =>
    | {
        ok: true;
        generator: Record<string, unknown>;
        revision: Record<string, unknown>;
        changed: boolean;
      }
    | { ok: false; error: { code: string } };
  deleteProjectGenerator?: (
    doc: LoroDoc,
    input: {
      generatorId: string;
      expectedHeadRevisionId: string;
      operationId: string;
    },
  ) =>
    | { ok: true; tombstone: Record<string, unknown>; changed: boolean }
    | { ok: false; error: { code: string } };
  isGeneratorRevisionMaterialized?: (
    doc: LoroDoc,
    ref: { generatorId: string; generatorRevisionId: string },
  ) => boolean;
  ensureActionRunRequest?: (
    doc: LoroDoc,
    request: Record<string, unknown>,
  ) =>
    | { ok: true; run: Record<string, unknown>; changed: boolean }
    | { ok: false; error: { code: string } };
  readProjectActionRun?: (
    doc: LoroDoc,
    actionRunId: string,
  ) => Record<string, unknown> | null;
  markActionRunStarted?: (
    doc: LoroDoc,
    actionRunId: string,
  ) =>
    | { ok: true; run: Record<string, unknown>; changed: boolean }
    | { ok: false; error: { code: string } };
  commitActionRunOutcome?: (
    doc: LoroDoc,
    outcome: Record<string, unknown>,
  ) =>
    | { ok: true; run: Record<string, unknown>; changed: boolean }
    | { ok: false; error: { code: string } };
  ensureOutputCommit?: (
    doc: LoroDoc,
    commit: Record<string, unknown>,
    resolveAssetType: (
      doc: LoroDoc,
      asset: Record<string, unknown>,
    ) => Record<string, unknown> | null,
  ) =>
    | { ok: true; commit: Record<string, unknown>; changed: boolean }
    | { ok: false; error: { code: string } };
  readOutputCommit?: (
    doc: LoroDoc,
    input: { actionRunId: string; outputSlot: string; itemKey?: string },
  ) => Record<string, unknown> | null;
  resolveOutputCommitAssetType?: (
    doc: LoroDoc,
    asset: Record<string, unknown>,
  ) => Record<string, unknown> | null;
};

const authority = sharedTypes as typeof sharedTypes & GeneratorAuthorityApi;

const definitionRef = {
  pluginId: "clash.stage",
  definitionId: "director-stage",
  version: "1.0.0",
  schemaHash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

function stageRevision(overrides: Record<string, unknown> = {}) {
  return {
    id: "stage-rev-1",
    generatorId: "stage-1",
    definitionRef,
    state: { scene: "courtyard" },
    persistentInputRefs: [],
    ...overrides,
  };
}

function actionRunRequest(overrides: Record<string, unknown> = {}) {
  return {
    actionRunId: "run-stage-1",
    generatorRevision: {
      generatorId: "stage-1",
      generatorRevisionId: "stage-rev-1",
    },
    actionId: "render-still",
    executor: {
      pluginId: "clash.stage",
      version: "1.0.0",
      exportId: "render-still",
      schemaHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    invocationFingerprint:
      "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    parameters: {},
    invocationInputRefs: [],
    outputContract: [
      {
        slot: "image",
        assetType: { kind: "media", mediaKind: "image" },
        cardinality: { minItems: 1, maxItems: 1 },
      },
    ],
    ...overrides,
  };
}

describe("Project Generator Loro authority", () => {
  it("records the supported authority as a grow-only version fact", () => {
    expect(authority.markGeneratorAuthority).toBeTypeOf("function");
    expect(authority.generatorAuthorityVersion).toBeTypeOf("function");

    const doc = new LoroDoc();
    expect(authority.markGeneratorAuthority!(doc)).toEqual({
      ok: true,
      version: authority.GENERATOR_AUTHORITY_VERSION,
    });
    expect(authority.generatorAuthorityVersion!(doc)).toBe(
      authority.GENERATOR_AUTHORITY_VERSION,
    );
  });

  it("fails closed instead of overwriting a future authority version", () => {
    const doc = new LoroDoc();
    doc
      .getMap("generatorSchema")
      .ensureMergeableMap("authorityVersions")
      .set("2", true);

    expect(authority.generatorAuthorityVersion!(doc)).toBe(2);
    expect(authority.markGeneratorAuthority!(doc)).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_GENERATOR_AUTHORITY" },
    });
  });

  it("creates one Generator head with an immutable addressable initial revision", () => {
    expect(authority.createProjectGenerator).toBeTypeOf("function");
    expect(authority.readProjectGenerator).toBeTypeOf("function");
    expect(authority.readGeneratorRevision).toBeTypeOf("function");

    const doc = new LoroDoc();
    const revision = stageRevision();
    expect(
      authority.createProjectGenerator!(doc, {
        head: { id: "stage-1", headRevisionId: "stage-rev-1" },
        revision,
      }),
    ).toMatchObject({
      ok: true,
      changed: true,
      generator: {
        id: "stage-1",
        headRevisionId: "stage-rev-1",
        definitionRef,
      },
    });
    expect(
      authority.readGeneratorRevision!(doc, {
        generatorId: "stage-1",
        generatorRevisionId: "stage-rev-1",
      }),
    ).toEqual(revision);

    const stored = doc.getMap("projectGenerators").get("stage-1") as {
      get(key: string): unknown;
    };
    expect(stored.get("head")).toEqual({ revisionId: "stage-rev-1" });
    expect(stored.get("definitionRef")).toBeUndefined();
  });

  it("replays the same Generator and revision facts idempotently", () => {
    const doc = new LoroDoc();
    const input = {
      head: { id: "stage-1", headRevisionId: "stage-rev-1" },
      revision: stageRevision(),
    };

    expect(authority.createProjectGenerator!(doc, input)).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(authority.createProjectGenerator!(doc, input)).toMatchObject({
      ok: true,
      changed: false,
    });
  });

  it("rejects reuse of one revision id for different immutable state", () => {
    const doc = new LoroDoc();
    expect(
      authority.createProjectGenerator!(doc, {
        head: { id: "stage-1", headRevisionId: "stage-rev-1" },
        revision: stageRevision(),
      }),
    ).toMatchObject({ ok: true });

    expect(
      authority.createProjectGenerator!(doc, {
        head: { id: "stage-1", headRevisionId: "stage-rev-1" },
        revision: stageRevision({ state: { scene: "rooftop" } }),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "GENERATOR_REVISION_ID_COLLISION" },
    });
    expect(
      authority.readGeneratorRevision!(doc, {
        generatorId: "stage-1",
        generatorRevisionId: "stage-rev-1",
      }),
    ).toEqual(stageRevision());
  });

  it("does not overwrite a concurrently inserted immutable revision fact", () => {
    const doc = new LoroDoc();
    const concurrent = stageRevision({ state: { scene: "rooftop" } });
    doc
      .getMap("generatorRevisions")
      .ensureMergeableMap("stage-1")
      .set("stage-rev-1", concurrent);

    expect(
      authority.createProjectGenerator!(doc, {
        head: { id: "stage-1", headRevisionId: "stage-rev-1" },
        revision: stageRevision(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "GENERATOR_REVISION_ID_COLLISION" },
    });
    expect(
      authority.readGeneratorRevision!(doc, {
        generatorId: "stage-1",
        generatorRevisionId: "stage-rev-1",
      }),
    ).toEqual(concurrent);
    expect(authority.readProjectGenerator!(doc, "stage-1")).toBeNull();
  });

  it("blocks Generator mutations under an unsupported authority version", () => {
    const doc = new LoroDoc();
    doc
      .getMap("generatorSchema")
      .ensureMergeableMap("authorityVersions")
      .set("2", true);

    expect(
      authority.createProjectGenerator!(doc, {
        head: { id: "stage-1", headRevisionId: "stage-rev-1" },
        revision: stageRevision(),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_GENERATOR_AUTHORITY" },
    });
    expect(authority.readProjectGenerator!(doc, "stage-1")).toBeNull();
  });

  it("rejects a stale head CAS without inserting an orphan revision", () => {
    expect(authority.advanceProjectGeneratorHead).toBeTypeOf("function");
    const doc = new LoroDoc();
    authority.createProjectGenerator!(doc, {
      head: { id: "stage-1", headRevisionId: "stage-rev-1" },
      revision: stageRevision(),
    });

    expect(
      authority.advanceProjectGeneratorHead!(doc, {
        generatorId: "stage-1",
        expectedHeadRevisionId: "stage-rev-stale",
        revision: stageRevision({
          id: "stage-rev-2",
          parentRevisionId: "stage-rev-stale",
          state: { scene: "rooftop" },
        }),
        editPolicy: "advance-head",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "STALE_GENERATOR_HEAD" },
    });
    expect(authority.readProjectGenerator!(doc, "stage-1")).toMatchObject({
      headRevisionId: "stage-rev-1",
    });
    expect(
      authority.readGeneratorRevision!(doc, {
        generatorId: "stage-1",
        generatorRevisionId: "stage-rev-2",
      }),
    ).toBeNull();
  });

  it("advances the head while retaining both revisions by exact address", () => {
    const doc = new LoroDoc();
    const first = stageRevision();
    const second = stageRevision({
      id: "stage-rev-2",
      parentRevisionId: "stage-rev-1",
      state: { scene: "rooftop" },
    });
    authority.createProjectGenerator!(doc, {
      head: { id: "stage-1", headRevisionId: first.id },
      revision: first,
    });

    expect(
      authority.advanceProjectGeneratorHead!(doc, {
        generatorId: "stage-1",
        expectedHeadRevisionId: "stage-rev-1",
        revision: second,
        editPolicy: "advance-head",
      }),
    ).toMatchObject({
      ok: true,
      changed: true,
      generator: { headRevisionId: "stage-rev-2", definitionRef },
    });
    expect(
      authority.readGeneratorRevision!(doc, {
        generatorId: "stage-1",
        generatorRevisionId: "stage-rev-1",
      }),
    ).toEqual(first);
    expect(
      authority.readGeneratorRevision!(doc, {
        generatorId: "stage-1",
        generatorRevisionId: "stage-rev-2",
      }),
    ).toEqual(second);
  });

  it("replays an already-applied head transition idempotently", () => {
    const doc = new LoroDoc();
    authority.createProjectGenerator!(doc, {
      head: { id: "stage-1", headRevisionId: "stage-rev-1" },
      revision: stageRevision(),
    });
    const input = {
      generatorId: "stage-1",
      expectedHeadRevisionId: "stage-rev-1",
      revision: stageRevision({
        id: "stage-rev-2",
        parentRevisionId: "stage-rev-1",
        state: { scene: "rooftop" },
      }),
      editPolicy: "advance-head" as const,
    };

    expect(authority.advanceProjectGeneratorHead!(doc, input)).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(authority.advanceProjectGeneratorHead!(doc, input)).toMatchObject({
      ok: true,
      changed: false,
      generator: { headRevisionId: "stage-rev-2" },
    });
  });

  it("requires a fork when another Generator revision materializes the head", () => {
    expect(authority.isGeneratorRevisionMaterialized).toBeTypeOf("function");
    const doc = new LoroDoc();
    authority.createProjectGenerator!(doc, {
      head: { id: "badge-1", headRevisionId: "badge-rev-1" },
      revision: stageRevision({
        id: "badge-rev-1",
        generatorId: "badge-1",
      }),
    });
    authority.createProjectGenerator!(doc, {
      head: { id: "consumer-1", headRevisionId: "consumer-rev-1" },
      revision: stageRevision({
        id: "consumer-rev-1",
        generatorId: "consumer-1",
        persistentInputRefs: [
          {
            slot: "source",
            target: {
              generatorId: "badge-1",
              generatorRevisionId: "badge-rev-1",
            },
          },
        ],
      }),
    });

    expect(
      authority.isGeneratorRevisionMaterialized!(doc, {
        generatorId: "badge-1",
        generatorRevisionId: "badge-rev-1",
      }),
    ).toBe(true);
    expect(
      authority.advanceProjectGeneratorHead!(doc, {
        generatorId: "badge-1",
        expectedHeadRevisionId: "badge-rev-1",
        revision: stageRevision({
          id: "badge-rev-2",
          generatorId: "badge-1",
          parentRevisionId: "badge-rev-1",
          state: { prompt: "new prompt" },
        }),
        editPolicy: "fork-when-materialized",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "GENERATOR_FORK_REQUIRED" },
    });
    expect(
      authority.readGeneratorRevision!(doc, {
        generatorId: "badge-1",
        generatorRevisionId: "badge-rev-2",
      }),
    ).toBeNull();
  });

  it("tombstones a Generator by head CAS while retaining immutable history", () => {
    expect(authority.deleteProjectGenerator).toBeTypeOf("function");
    const doc = new LoroDoc();
    const revision = stageRevision();
    authority.createProjectGenerator!(doc, {
      head: { id: "stage-1", headRevisionId: revision.id },
      revision,
    });
    const input = {
      generatorId: "stage-1",
      expectedHeadRevisionId: "stage-rev-1",
      operationId: "delete-stage-1",
    };

    expect(authority.deleteProjectGenerator!(doc, input)).toEqual({
      ok: true,
      tombstone: {
        state: "deleted",
        operationId: "delete-stage-1",
        headRevisionId: "stage-rev-1",
      },
      changed: true,
    });
    expect(authority.readProjectGenerator!(doc, "stage-1")).toBeNull();
    expect(
      authority.readGeneratorRevision!(doc, {
        generatorId: "stage-1",
        generatorRevisionId: "stage-rev-1",
      }),
    ).toEqual(revision);
    expect(authority.deleteProjectGenerator!(doc, input)).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(
      authority.advanceProjectGeneratorHead!(doc, {
        generatorId: "stage-1",
        expectedHeadRevisionId: "stage-rev-1",
        revision: stageRevision({
          id: "stage-rev-2",
          parentRevisionId: "stage-rev-1",
        }),
        editPolicy: "advance-head",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PROJECT_GENERATOR_DELETED" },
    });
    expect(
      authority.readGeneratorRevision!(doc, {
        generatorId: "stage-1",
        generatorRevisionId: "stage-rev-2",
      }),
    ).toBeNull();
  });

  it("rejects a stale tombstone CAS without leaving a terminal fact", () => {
    const doc = new LoroDoc();
    authority.createProjectGenerator!(doc, {
      head: { id: "stage-1", headRevisionId: "stage-rev-1" },
      revision: stageRevision(),
    });

    expect(
      authority.deleteProjectGenerator!(doc, {
        generatorId: "stage-1",
        expectedHeadRevisionId: "stage-rev-stale",
        operationId: "delete-stage-1",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "STALE_GENERATOR_HEAD" },
    });
    const stored = doc.getMap("projectGenerators").get("stage-1") as {
      get(key: string): unknown;
    };
    expect(stored.get("terminal")).toBeUndefined();
    expect(authority.readProjectGenerator!(doc, "stage-1")).toMatchObject({
      headRevisionId: "stage-rev-1",
    });
  });

  it("accepts only an addressable cross-Generator revision as a COW origin", () => {
    const doc = new LoroDoc();
    const missingFork = stageRevision({
      id: "badge-copy-rev-1",
      generatorId: "badge-copy",
      forkedFrom: {
        generatorId: "badge-source",
        generatorRevisionId: "badge-source-rev-1",
      },
    });

    expect(
      authority.createProjectGenerator!(doc, {
        head: { id: "badge-copy", headRevisionId: "badge-copy-rev-1" },
        revision: missingFork,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "GENERATOR_FORK_SOURCE_NOT_FOUND" },
    });
    expect(authority.readProjectGenerator!(doc, "badge-copy")).toBeNull();

    authority.createProjectGenerator!(doc, {
      head: { id: "badge-source", headRevisionId: "badge-source-rev-1" },
      revision: stageRevision({
        id: "badge-source-rev-1",
        generatorId: "badge-source",
      }),
    });
    expect(
      authority.createProjectGenerator!(doc, {
        head: { id: "badge-copy", headRevisionId: "badge-copy-rev-1" },
        revision: missingFork,
      }),
    ).toMatchObject({ ok: true, changed: true });
    expect(
      authority.readGeneratorRevision!(doc, {
        generatorId: "badge-copy",
        generatorRevisionId: "badge-copy-rev-1",
      }),
    ).toMatchObject({
      forkedFrom: {
        generatorId: "badge-source",
        generatorRevisionId: "badge-source-rev-1",
      },
    });
  });

  it("rejects a COW fork from another Generator definition family without persisting it", () => {
    const doc = new LoroDoc();
    authority.createProjectGenerator!(doc, {
      head: { id: "source", headRevisionId: "source-rev-1" },
      revision: stageRevision({
        id: "source-rev-1",
        generatorId: "source",
      }),
    });

    for (const [generatorId, definitionRefOverride] of [
      [
        "other-plugin-copy",
        { ...definitionRef, pluginId: "clash.other-plugin" },
      ],
      [
        "other-definition-copy",
        { ...definitionRef, definitionId: "other-definition" },
      ],
    ] as const) {
      expect(
        authority.createProjectGenerator!(doc, {
          head: { id: generatorId, headRevisionId: `${generatorId}-rev-1` },
          revision: stageRevision({
            id: `${generatorId}-rev-1`,
            generatorId,
            definitionRef: definitionRefOverride,
            forkedFrom: {
              generatorId: "source",
              generatorRevisionId: "source-rev-1",
            },
          }),
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "GENERATOR_FORK_FAMILY_MISMATCH" },
      });
      expect(authority.readProjectGenerator!(doc, generatorId)).toBeNull();
      expect(
        authority.readGeneratorRevision!(doc, {
          generatorId,
          generatorRevisionId: `${generatorId}-rev-1`,
        }),
      ).toBeNull();
    }
  });

  it("allows a COW fork to evolve version and schema within one definition family", () => {
    const doc = new LoroDoc();
    authority.createProjectGenerator!(doc, {
      head: { id: "source", headRevisionId: "source-rev-1" },
      revision: stageRevision({
        id: "source-rev-1",
        generatorId: "source",
      }),
    });
    const evolvedDefinitionRef = {
      ...definitionRef,
      version: "2.0.0",
      schemaHash:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    };

    expect(
      authority.createProjectGenerator!(doc, {
        head: { id: "copy", headRevisionId: "copy-rev-1" },
        revision: stageRevision({
          id: "copy-rev-1",
          generatorId: "copy",
          definitionRef: evolvedDefinitionRef,
          forkedFrom: {
            generatorId: "source",
            generatorRevisionId: "source-rev-1",
          },
        }),
      }),
    ).toMatchObject({
      ok: true,
      changed: true,
      generator: { definitionRef: evolvedDefinitionRef },
    });
  });

  it("rejects a Run whose executor provenance differs from its frozen Generator revision", () => {
    const doc = new LoroDoc();
    authority.createProjectGenerator!(doc, {
      head: { id: "stage-1", headRevisionId: "stage-rev-1" },
      revision: stageRevision(),
    });

    for (const [actionRunId, executor] of [
      [
        "run-wrong-plugin",
        { ...actionRunRequest().executor, pluginId: "clash.other-plugin" },
      ],
      [
        "run-wrong-version",
        { ...actionRunRequest().executor, version: "2.0.0" },
      ],
      [
        "run-wrong-schema",
        {
          ...actionRunRequest().executor,
          schemaHash:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      ],
    ] as const) {
      expect(
        authority.ensureActionRunRequest!(doc, {
          ...actionRunRequest(),
          actionRunId,
          executor,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "ACTION_RUN_EXECUTOR_MISMATCH" },
      });
      expect(authority.readProjectActionRun!(doc, actionRunId)).toBeNull();
    }
  });

  it("stores one immutable Run request and derives pending/running state", () => {
    expect(authority.ensureActionRunRequest).toBeTypeOf("function");
    expect(authority.readProjectActionRun).toBeTypeOf("function");
    expect(authority.markActionRunStarted).toBeTypeOf("function");
    const doc = new LoroDoc();
    authority.createProjectGenerator!(doc, {
      head: { id: "stage-1", headRevisionId: "stage-rev-1" },
      revision: stageRevision(),
    });
    const request = actionRunRequest();

    expect(authority.ensureActionRunRequest!(doc, request)).toMatchObject({
      ok: true,
      changed: true,
      run: { ...request, status: "pending" },
    });
    expect(authority.ensureActionRunRequest!(doc, request)).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(
      authority.ensureActionRunRequest!(doc, {
        ...request,
        parameters: { changed: true },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "ACTION_RUN_REQUEST_COLLISION" },
    });

    const stored = doc.getMap("generatorActionRuns").get("run-stage-1") as {
      get(key: string): unknown;
    };
    expect(stored.get("request")).toEqual(request);
    expect(stored.get("status")).toBeUndefined();
    expect(authority.markActionRunStarted!(doc, "run-stage-1")).toMatchObject({
      ok: true,
      changed: true,
      run: { status: "running" },
    });
    expect(authority.markActionRunStarted!(doc, "run-stage-1")).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(stored.get("started")).toBe(true);
  });

  it("treats an Action Run request as materialization of its exact Generator revision", () => {
    const doc = new LoroDoc();
    authority.createProjectGenerator!(doc, {
      head: { id: "stage-1", headRevisionId: "stage-rev-1" },
      revision: stageRevision(),
    });
    authority.ensureActionRunRequest!(doc, actionRunRequest());

    expect(
      authority.isGeneratorRevisionMaterialized!(doc, {
        generatorId: "stage-1",
        generatorRevisionId: "stage-rev-1",
      }),
    ).toBe(true);
  });

  it("inserts terminal outcomes and required output commits idempotently", () => {
    expect(authority.commitActionRunOutcome).toBeTypeOf("function");
    expect(authority.ensureOutputCommit).toBeTypeOf("function");
    expect(authority.readOutputCommit).toBeTypeOf("function");
    const doc = new LoroDoc();
    authority.createProjectGenerator!(doc, {
      head: { id: "stage-1", headRevisionId: "stage-rev-1" },
      revision: stageRevision(),
    });
    authority.ensureActionRunRequest!(doc, actionRunRequest());
    sharedTypes.createProjectAsset(doc, {
      id: "asset-result",
      kind: "image",
      source: { kind: "owned", resourceId: "resource-result" },
      lifecycle: { state: "active" },
      metadata: {},
    });

    expect(
      authority.commitActionRunOutcome!(doc, {
        actionRunId: "run-stage-1",
        status: "succeeded",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REQUIRED_OUTPUT_NOT_COMMITTED" },
    });

    const commit = {
      actionRunId: "run-stage-1",
      outputSlot: "image",
      asset: { kind: "media", projectAssetId: "asset-result" },
    };
    expect(
      authority.ensureOutputCommit!(
        doc,
        commit,
        authority.resolveOutputCommitAssetType!,
      ),
    ).toEqual({
      ok: true,
      commit,
      changed: true,
    });
    expect(
      authority.ensureOutputCommit!(
        doc,
        commit,
        authority.resolveOutputCommitAssetType!,
      ),
    ).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(
      authority.ensureOutputCommit!(
        doc,
        {
          ...commit,
          asset: { kind: "media", projectAssetId: "asset-other" },
        },
        authority.resolveOutputCommitAssetType!,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "OUTPUT_COMMIT_ID_COLLISION" },
    });
    expect(
      authority.readOutputCommit!(doc, {
        actionRunId: "run-stage-1",
        outputSlot: "image",
      }),
    ).toEqual(commit);

    const outcome = { actionRunId: "run-stage-1", status: "succeeded" };
    expect(authority.commitActionRunOutcome!(doc, outcome)).toMatchObject({
      ok: true,
      changed: true,
      run: { status: "succeeded" },
    });
    expect(authority.commitActionRunOutcome!(doc, outcome)).toMatchObject({
      ok: true,
      changed: false,
    });
    const stored = doc.getMap("generatorActionRuns").get("run-stage-1") as {
      get(key: string): unknown;
    };
    expect(stored.get("outcome")).toEqual(outcome);
    expect(
      authority.commitActionRunOutcome!(doc, {
        actionRunId: "run-stage-1",
        status: "failed",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "ACTION_RUN_OUTCOME_COLLISION" },
    });
  });

  it("rejects a missing or wrong-kind Asset before an output can satisfy success", () => {
    expect(authority.resolveOutputCommitAssetType).toBeTypeOf("function");
    const doc = new LoroDoc();
    authority.createProjectGenerator!(doc, {
      head: { id: "stage-1", headRevisionId: "stage-rev-1" },
      revision: stageRevision(),
    });
    authority.ensureActionRunRequest!(doc, actionRunRequest());

    expect(
      authority.ensureOutputCommit!(
        doc,
        {
          actionRunId: "run-stage-1",
          outputSlot: "image",
          asset: { kind: "media", projectAssetId: "missing" },
        },
        authority.resolveOutputCommitAssetType!,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_OUTPUT_COMMIT" },
    });

    sharedTypes.createProjectAsset(doc, {
      id: "video-result",
      kind: "video",
      source: { kind: "owned", resourceId: "resource-video" },
      lifecycle: { state: "active" },
      metadata: {},
    });
    expect(
      authority.ensureOutputCommit!(
        doc,
        {
          actionRunId: "run-stage-1",
          outputSlot: "image",
          asset: { kind: "media", projectAssetId: "video-result" },
        },
        authority.resolveOutputCommitAssetType!,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_OUTPUT_COMMIT" },
    });
    expect(
      authority.commitActionRunOutcome!(doc, {
        actionRunId: "run-stage-1",
        status: "succeeded",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REQUIRED_OUTPUT_NOT_COMMITTED" },
    });
  });

  it("allows failure without an output and blocks new commits after terminal", () => {
    const doc = new LoroDoc();
    authority.createProjectGenerator!(doc, {
      head: { id: "stage-1", headRevisionId: "stage-rev-1" },
      revision: stageRevision(),
    });
    authority.ensureActionRunRequest!(doc, actionRunRequest());

    expect(
      authority.commitActionRunOutcome!(doc, {
        actionRunId: "run-stage-1",
        status: "failed",
      }),
    ).toMatchObject({
      ok: true,
      run: { status: "failed" },
    });
    expect(authority.markActionRunStarted!(doc, "run-stage-1")).toMatchObject({
      ok: true,
      changed: false,
      run: { status: "failed" },
    });
    expect(
      authority.ensureOutputCommit!(
        doc,
        {
          actionRunId: "run-stage-1",
          outputSlot: "image",
          asset: { kind: "media", projectAssetId: "asset-too-late" },
        },
        authority.resolveOutputCommitAssetType!,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "ACTION_RUN_TERMINAL" },
    });
  });
});
