import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LoroDoc } from "loro-crdt";
import { readMetadataBody } from "@clash/shared-runtime";
import {
  createProjectGenerator,
  ensureActionRunRequest,
  listActionAssetBindings,
  readDocumentAssetRevision,
  readOutputCommit,
  readProjectActionRun,
  readProjectAsset,
  readProjectDocumentAsset,
  type ActionRunRequest,
} from "@clash/shared-types";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalDurableRun,
  type LocalDurableRunCreateCommand,
} from "./durable-run-coordinator.js";
import { createSqliteDurableRunJournal } from "./durable-run-journal.js";
import { createLocalAssetInspectionService } from "./local-asset-inspections.js";
import { createLocalPluginAssetStagingStore } from "./local-plugin-asset-staging.js";
import { createLocalWorkflowProcessor } from "./local-processor.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function dataDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "clash-generator-processor-"));
  temporaryDirectories.push(path);
  return path;
}

function request(): ActionRunRequest {
  return {
    actionRunId: "run-stage-1",
    generatorRevision: {
      generatorId: "stage-1",
      generatorRevisionId: "stage-rev-1",
    },
    actionId: "render-still",
    executor: binding,
    invocationFingerprint: `sha256:${"d".repeat(64)}`,
    parameters: { prompt: "a quiet courtyard" },
    invocationInputRefs: [],
    outputContract: [
      {
        slot: "image",
        assetType: { kind: "media", mediaKind: "image" },
        cardinality: { minItems: 1, maxItems: 1 },
      },
    ],
  };
}

const binding = {
  pluginId: "clash.stage",
  version: "1.0.0",
  exportId: "render-still",
  schemaHash: `sha256:${"a".repeat(64)}`,
};

function command(): LocalDurableRunCreateCommand {
  return {
    type: "create",
    actionRunId: "run-stage-1",
    outputSlot: "image",
    deadlineAt: Date.now() + 60_000,
    executor: {
      targetKind: "generator-action",
      binding,
      actionId: "render-still",
      actor: { kind: "system", id: "local-api" },
      publicOwner: {
        actionId: "stage-1",
        actionRevisionId: "stage-rev-1",
      },
      generatorOutputContract: request().outputContract,
      accountId: "owner-private-account",
      kind: "image",
      projectId: "project-1",
      delivery: {
        kind: "project-asset",
        actionId: "stage-1",
        name: "courtyard.png",
      },
      input: {
        values: { prompt: "a quiet courtyard" },
        references: [],
      },
    },
  };
}

function projectDoc(): LoroDoc {
  const doc = new LoroDoc();
  const generator = createProjectGenerator(doc, {
    head: { id: "stage-1", headRevisionId: "stage-rev-1" },
    revision: {
      id: "stage-rev-1",
      generatorId: "stage-1",
      definitionRef: {
        pluginId: "clash.stage",
        definitionId: "director-stage",
        version: "1.0.0",
        schemaHash: `sha256:${"a".repeat(64)}`,
      },
      state: { scene: "courtyard" },
      persistentInputRefs: [],
    },
  });
  if (!generator.ok) throw new Error(generator.error.message);
  const run = ensureActionRunRequest(doc, request());
  if (!run.ok) throw new Error(run.error.message);
  return doc;
}

const transcriptBody = {
  schemaVersion: 1,
  kind: "clash.asr.timed-transcript",
  timebase: "milliseconds",
  alignment: "word",
  text: "a quiet courtyard",
  backendId: "test-asr",
  modelId: "test-model",
  durationMs: 900,
  words: [
    {
      id: "word-1",
      text: "courtyard",
      startMs: 0,
      endMs: 900,
    },
  ],
  segments: [
    {
      id: "segment-1",
      text: "courtyard",
      startMs: 0,
      endMs: 900,
      wordIds: ["word-1"],
    },
  ],
};

function documentRequest(): ActionRunRequest {
  return {
    ...request(),
    actionRunId: "run-transcript-1",
    actionId: "transcribe",
    executor: { ...binding, exportId: "transcribe" },
    parameters: {},
    outputContract: [
      {
        slot: "transcript",
        assetType: {
          kind: "document",
          documentKind: "media.transcript",
          schemaVersion: 1,
        },
        cardinality: { minItems: 1, maxItems: 1 },
      },
    ],
  };
}

function documentCommand(): LocalDurableRunCreateCommand {
  const run = documentRequest();
  return {
    type: "create",
    actionRunId: run.actionRunId,
    outputSlot: "transcript",
    deadlineAt: Date.now() + 60_000,
    executor: {
      targetKind: "generator-action",
      binding: run.executor,
      actionId: run.actionId,
      actor: { kind: "system", id: "local-api" },
      publicOwner: {
        actionId: "stage-1",
        actionRevisionId: "stage-rev-1",
      },
      generatorOutputContract: run.outputContract,
      kind: "text",
      projectId: "project-1",
      input: { values: {}, references: [] },
    },
  };
}

describe("Local processor Generator v2 opt-in", () => {
  it("recovers a private Generator Action task into one complete public media winner", async () => {
    const directory = await dataDir();
    const doc = projectDoc();
    const journal = createSqliteDurableRunJournal(directory);
    await createLocalDurableRun({
      ownerId: "host-1",
      journal,
      command: command(),
    });
    const staged = await createLocalPluginAssetStagingStore({
      dataDir: directory,
    }).stage({
      projectId: "project-1",
      taskId: "run-stage-1",
      slot: "image",
      pluginId: binding.pluginId,
      pluginVersion: binding.version,
      invocationId: "invocation-1",
      kind: "image",
      mediaType: "image/png",
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    const processor = createLocalWorkflowProcessor({
      dataDir: directory,
      assetInspection: createLocalAssetInspectionService({
        dataDir: directory,
        inspectResource: async ({ resource }) => ({
          contentType: resource.contentType ?? "image/png",
          width: 1,
          height: 1,
          rotationDegrees: 0,
        }),
      }),
      executablePluginAction: async (invocation) => ({
        protocol: "clash.plugin.result/v1",
        invocationId: "generator-result",
        status: "completed",
        outputs: [
          {
            slot: "image",
            kind: "asset",
            asset: {
              assetId: staged.projectAssetId,
              uri: `clash-asset://${staged.projectAssetId}`,
              kind: "image",
              mediaType: "image/png",
            },
          },
        ],
      }),
      durableProviderRuns: {
        ownerId: "host-1",
        providerPluginExecutor: async () => {
          throw new Error("Generator Actions must not use Provider execution.");
        },
      },
      providerPollDelayCapMs: 0,
    });

    await processor.process({
      doc,
      projectId: "project-1",
      checkpoint: async () => undefined,
    });

    expect(readProjectActionRun(doc, "run-stage-1")?.status).toBe("succeeded");
    expect(
      readOutputCommit(doc, {
        actionRunId: "run-stage-1",
        outputSlot: "image",
      }),
    ).toEqual({
      actionRunId: "run-stage-1",
      outputSlot: "image",
      asset: { kind: "media", projectAssetId: staged.projectAssetId },
    });
    expect(readProjectAsset(doc, staged.projectAssetId)).toMatchObject({
      id: staged.projectAssetId,
      kind: "image",
      lifecycle: { state: "active" },
    });
    expect(
      listActionAssetBindings(doc).filter(
        (candidate) =>
          candidate.owner.kind === "run" &&
          candidate.owner.actionRunId === "run-stage-1" &&
          candidate.direction === "output",
      ),
    ).toMatchObject([
      {
        slot: "image",
        projectAssetId: staged.projectAssetId,
      },
    ]);
    expect(
      await journal.load({
        actionRunId: "run-stage-1",
        outputSlot: "image",
      }),
    ).toMatchObject({ phase: "succeeded", projectedAt: expect.any(Number) });
  });

  it("publishes a Generator document output as an immutable typed body and public revision", async () => {
    const directory = await dataDir();
    const doc = projectDoc();
    const requested = ensureActionRunRequest(doc, documentRequest());
    if (!requested.ok) throw new Error(requested.error.message);
    const journal = createSqliteDurableRunJournal(directory);
    await createLocalDurableRun({
      ownerId: "host-1",
      journal,
      command: documentCommand(),
    });
    const processor = createLocalWorkflowProcessor({
      dataDir: directory,
      executablePluginAction: async () => ({
        protocol: "clash.plugin.result/v1",
        invocationId: "transcript-result",
        status: "completed",
        outputs: [
          {
            slot: "transcript",
            kind: "document",
            document: {
              documentKind: "media.transcript",
              schemaVersion: 1,
              body: transcriptBody,
            },
          },
        ],
      }),
      durableProviderRuns: {
        ownerId: "host-1",
        providerPluginExecutor: async () => {
          throw new Error("Document Actions must not use Provider execution.");
        },
      },
      providerPollDelayCapMs: 0,
    });

    await processor.process({
      doc,
      projectId: "project-1",
      checkpoint: async () => undefined,
    });

    const commit = readOutputCommit(doc, {
      actionRunId: "run-transcript-1",
      outputSlot: "transcript",
    });
    expect(commit).toEqual({
      actionRunId: "run-transcript-1",
      outputSlot: "transcript",
      asset: {
        kind: "document",
        documentAssetId: "document:run-transcript-1:transcript",
        revisionId: "document-revision:run-transcript-1:transcript",
      },
    });
    expect(readProjectActionRun(doc, "run-transcript-1")?.status).toBe(
      "succeeded",
    );
    expect(
      readProjectDocumentAsset(doc, "document:run-transcript-1:transcript"),
    ).toMatchObject({
      documentKind: "media.transcript",
      mutability: "versioned",
    });
    const revision = readDocumentAssetRevision(doc, {
      documentAssetId: "document:run-transcript-1:transcript",
      revisionId: "document-revision:run-transcript-1:transcript",
    });
    expect(revision).toMatchObject({
      producer: { kind: "action-run", actionRunId: "run-transcript-1" },
      documentKind: "media.transcript",
      schemaVersion: 1,
    });
    await expect(
      readMetadataBody({
        dataDir: directory,
        contentHash: revision!.body.digest,
      }),
    ).resolves.toEqual(transcriptBody);
    expect(
      await journal.load({
        actionRunId: "run-transcript-1",
        outputSlot: "transcript",
      }),
    ).toMatchObject({ phase: "succeeded", projectedAt: expect.any(Number) });
  });

  it("rejects a Generator document whose returned kind differs from the frozen port", async () => {
    const directory = await dataDir();
    const doc = projectDoc();
    const requested = ensureActionRunRequest(doc, documentRequest());
    if (!requested.ok) throw new Error(requested.error.message);
    const journal = createSqliteDurableRunJournal(directory);
    await createLocalDurableRun({
      ownerId: "host-1",
      journal,
      command: documentCommand(),
    });
    const processor = createLocalWorkflowProcessor({
      dataDir: directory,
      executablePluginAction: async () => ({
        protocol: "clash.plugin.result/v1",
        invocationId: "wrong-document-result",
        status: "completed",
        outputs: [
          {
            slot: "transcript",
            kind: "document",
            document: {
              documentKind: "media.description",
              schemaVersion: 1,
              body: { text: "not a transcript" },
            },
          },
        ],
      }),
      durableProviderRuns: {
        ownerId: "host-1",
        providerPluginExecutor: async () => {
          throw new Error("Document Actions must not use Provider execution.");
        },
      },
      providerPollDelayCapMs: 0,
    });

    await processor.process({
      doc,
      projectId: "project-1",
      checkpoint: async () => undefined,
    });

    expect(
      readOutputCommit(doc, {
        actionRunId: "run-transcript-1",
        outputSlot: "transcript",
      }),
    ).toBeNull();
    expect(readProjectActionRun(doc, "run-transcript-1")?.status).toBe(
      "failed",
    );
    expect(
      await journal.load({
        actionRunId: "run-transcript-1",
        outputSlot: "transcript",
      }),
    ).toMatchObject({
      phase: "failed",
      failure: { code: "contract_violation", retryable: false },
    });
  });
});
