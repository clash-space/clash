import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LoroDoc } from "loro-crdt";
import { createBoundedRetryPolicy } from "@clash/shared-runtime";
import {
  commitActionRunOutcome,
  createProjectGenerator,
  readDocumentAssetRevision,
  ensureActionRunRequest,
  markActionRunStarted,
  readActionAssetBinding,
  readOutputCommit,
  readProjectAsset,
  readProjectActionRun,
  readProjectDocumentAsset,
  type ActionAssetBinding,
  type ActionRunRequest,
  type ProjectAssetEntry,
} from "@clash/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSqliteDurableRunJournal } from "./durable-run-journal.js";
import {
  createLocalDurableRun,
  createLocalDurableRunCoordinator,
} from "./durable-run-coordinator.js";
import { createLocalGeneratorRunBridge } from "./local-generator-run-bridge.js";

const temporaryDirectories: string[] = [];

async function temporaryDataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "clash-generator-run-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const definitionRef = {
  pluginId: "clash.stage",
  definitionId: "director-stage",
  version: "1.0.0",
  schemaHash: `sha256:${"a".repeat(64)}`,
} as const;

function projectDoc(): LoroDoc {
  const doc = new LoroDoc();
  const created = createProjectGenerator(doc, {
    head: { id: "stage-1", headRevisionId: "stage-rev-1" },
    revision: {
      id: "stage-rev-1",
      generatorId: "stage-1",
      definitionRef,
      state: { scene: "courtyard" },
      persistentInputRefs: [],
    },
  });
  if (!created.ok) throw new Error(created.error.message);
  return doc;
}

function request(actionRunId = "run-stage-1"): ActionRunRequest {
  return {
    actionRunId,
    generatorRevision: {
      generatorId: "stage-1",
      generatorRevisionId: "stage-rev-1",
    },
    actionId: "render-still",
    executor: {
      pluginId: "clash.stage",
      version: "1.0.0",
      exportId: "render-still",
      schemaHash: `sha256:${"a".repeat(64)}`,
    },
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

function durableCommand(actionRunId = "run-stage-1") {
  return {
    type: "create" as const,
    actionRunId,
    outputSlot: "image",
    deadlineAt: Date.now() + 60_000,
    executor: {
      targetKind: "generator-action" as const,
      binding: {
        pluginId: "clash.stage",
        version: "1.0.0",
        exportId: "render-still",
        schemaHash: `sha256:${"a".repeat(64)}`,
      },
      accountId: "owner-private-account",
      actionId: "render-still",
      actor: { kind: "system" as const, id: "local-api" },
      publicOwner: {
        actionId: "stage-1",
        actionRevisionId: "stage-rev-1",
      },
      generatorOutputContract: request(actionRunId).outputContract,
      kind: "image" as const,
      projectId: "project-1",
      delivery: {
        kind: "project-asset" as const,
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

function generatorActionCommand(actionRunId = "run-stage-1") {
  return durableCommand(actionRunId);
}

function generatedAsset(id = "asset-courtyard"): ProjectAssetEntry {
  return {
    id,
    kind: "image",
    source: {
      kind: "owned",
      resourceId: `sha256:${"c".repeat(64)}`,
    },
    lifecycle: { state: "active" },
    name: "courtyard.png",
    metadata: { bytes: 42, contentType: "image/png" },
    provenance: { kind: "generation", actionRunId: "run-stage-1" },
  };
}

function legacyOutputBinding(
  projectAssetId = "asset-courtyard",
): ActionAssetBinding {
  return {
    id: "action-asset:run-stage-1:image:output",
    owner: {
      kind: "run",
      actionId: "stage-1",
      actionRevisionId: "stage-rev-1",
      actionRunId: "run-stage-1",
    },
    direction: "output",
    slot: "image",
    projectAssetId,
    role: "primary",
  };
}

describe("Local Generator Run bridge", () => {
  it("checkpoints public pending before the private journal and projects only coarse running afterwards", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const journal = createSqliteDurableRunJournal(dataDir);
    const persistedStatuses: Array<string | null> = [];
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal,
    });

    const publicRun = await bridge.enqueue({
      doc,
      request: request(),
      command: durableCommand(),
      checkpoint: async () => {
        persistedStatuses.push(
          readProjectActionRun(doc, "run-stage-1")?.status ?? null,
        );
      },
    });

    expect(persistedStatuses).toEqual(["pending", "running"]);
    expect(publicRun.status).toBe("running");
    expect(readProjectActionRun(doc, "run-stage-1")).toEqual(publicRun);
    expect(JSON.stringify(doc.toJSON())).not.toContain("owner-private-account");

    const privateTask = await journal.load({
      actionRunId: "run-stage-1",
      outputSlot: "image",
    });
    expect(privateTask).toMatchObject({
      phase: "queued",
      owner: { realm: "local", id: "host-1" },
      executorInput: { accountId: "owner-private-account" },
    });
  });

  it("checkpoints the media Asset, legacy binding, OutputCommit, and succeeded outcome as one public mutation", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal: createSqliteDurableRunJournal(dataDir),
    });
    await bridge.enqueue({
      doc,
      request: request(),
      command: durableCommand(),
      checkpoint: async () => undefined,
    });
    const snapshots: Array<Record<string, boolean | string | null>> = [];
    const entry = generatedAsset();
    const binding = legacyOutputBinding();

    const published = await bridge.publishMediaSuccess({
      doc,
      actionRunId: "run-stage-1",
      outputSlot: "image",
      entry,
      legacyBinding: binding,
      checkpoint: async () => {
        snapshots.push({
          asset: readProjectAsset(doc, entry.id) !== null,
          binding: readActionAssetBinding(doc, binding.id) !== null,
          commit:
            readOutputCommit(doc, {
              actionRunId: "run-stage-1",
              outputSlot: "image",
            }) !== null,
          status: readProjectActionRun(doc, "run-stage-1")?.status ?? null,
        });
      },
    });

    expect(snapshots).toEqual([
      { asset: true, binding: true, commit: true, status: "succeeded" },
    ]);
    expect(published).toEqual({
      entry,
      legacyBinding: binding,
      commit: {
        actionRunId: "run-stage-1",
        outputSlot: "image",
        asset: { kind: "media", projectAssetId: entry.id },
      },
      run: { ...request(), status: "succeeded" },
      changed: true,
    });
  });

  it("does not let a late private failure retract an already published winner", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal: createSqliteDurableRunJournal(dataDir),
    });
    await bridge.enqueue({
      doc,
      request: request(),
      command: durableCommand(),
      checkpoint: async () => undefined,
    });
    await bridge.publishMediaSuccess({
      doc,
      actionRunId: "run-stage-1",
      outputSlot: "image",
      entry: generatedAsset(),
      legacyBinding: legacyOutputBinding(),
      checkpoint: async () => undefined,
    });

    const failure = await bridge.publishFailure({
      doc,
      actionRunId: "run-stage-1",
      checkpoint: async () => undefined,
    });

    expect(failure).toMatchObject({
      changed: false,
      winnerPreserved: true,
      run: { actionRunId: "run-stage-1", status: "succeeded" },
    });
    expect(readProjectAsset(doc, "asset-courtyard")).toEqual(generatedAsset());
    expect(
      readOutputCommit(doc, {
        actionRunId: "run-stage-1",
        outputSlot: "image",
      }),
    ).toEqual({
      actionRunId: "run-stage-1",
      outputSlot: "image",
      asset: { kind: "media", projectAssetId: "asset-courtyard" },
    });
  });

  it("returns the existing output winner when restart recovery receives an unknown duplicate result", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const journal = createSqliteDurableRunJournal(dataDir);
    const firstHost = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal,
    });
    await firstHost.enqueue({
      doc,
      request: request(),
      command: durableCommand(),
      checkpoint: async () => undefined,
    });
    await firstHost.publishMediaSuccess({
      doc,
      actionRunId: "run-stage-1",
      outputSlot: "image",
      entry: generatedAsset(),
      legacyBinding: legacyOutputBinding(),
      checkpoint: async () => undefined,
    });

    const recoveredHost = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal: createSqliteDurableRunJournal(dataDir),
    });
    const duplicate = generatedAsset("asset-duplicate-result");
    const recovered = await recoveredHost.publishMediaSuccess({
      doc,
      actionRunId: "run-stage-1",
      outputSlot: "image",
      entry: duplicate,
      legacyBinding: legacyOutputBinding(duplicate.id),
      checkpoint: async () => undefined,
    });

    expect(recovered).toMatchObject({
      entry: { id: "asset-courtyard" },
      legacyBinding: { projectAssetId: "asset-courtyard" },
      commit: {
        asset: { kind: "media", projectAssetId: "asset-courtyard" },
      },
      run: { status: "succeeded" },
      changed: false,
    });
    expect(readProjectAsset(doc, duplicate.id)).toBeNull();
    expect(
      readActionAssetBinding(doc, "action-asset:run-stage-1:image:output"),
    ).toEqual(legacyOutputBinding());
  });

  it("runs an accepted Generator Action through the same export on poll and publishes its contracted output", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const journal = createSqliteDurableRunJournal(dataDir);
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal,
    });
    await bridge.enqueue({
      doc,
      request: request(),
      command: generatorActionCommand(),
      checkpoint: async () => undefined,
    });
    const operations: string[] = [];
    const coordinator = createLocalDurableRunCoordinator({
      ownerId: "host-1",
      journal,
      providerPluginExecutor: async () => {
        throw new Error("Generator Actions must not use the Provider adapter.");
      },
      executablePluginAction: async (invocation) => {
        const operation = (invocation as { operation?: string }).operation;
        operations.push(operation ?? "missing");
        if (operation === "submit") {
          return {
            protocol: "clash.plugin.result/v1",
            invocationId: "submit-result",
            status: "accepted",
            pollState: { upstreamTaskId: "vendor-task-1" },
            retryAfterMs: 0,
          };
        }
        if (
          operation !== "poll" ||
          JSON.stringify((invocation as { pollState?: unknown }).pollState) !==
            JSON.stringify({ upstreamTaskId: "vendor-task-1" })
        ) {
          throw new Error("poll must carry the accepted opaque state");
        }
        return {
          protocol: "clash.plugin.result/v1",
          invocationId: "poll-result",
          status: "completed",
          outputs: [
            {
              slot: "image",
              kind: "asset",
              asset: {
                assetId: "asset-courtyard",
                uri: "clash-asset://asset-courtyard",
                kind: "image",
                mediaType: "image/png",
              },
            },
          ],
        };
      },
      outputStore: {
        async stage({ outputs }) {
          expect(outputs).toMatchObject([
            { slot: "image", kind: "asset", asset: { kind: "image" } },
          ]);
          return { kind: "asset", projectAsset: generatedAsset() };
        },
      },
      publisher: {
        async publish({ run }) {
          await bridge.publishMediaSuccess({
            doc,
            actionRunId: run.actionRunId,
            outputSlot: run.outputSlot,
            entry: generatedAsset(),
            legacyBinding: legacyOutputBinding(),
            checkpoint: async () => undefined,
          });
        },
        async publishFailure({ run }) {
          await bridge.publishFailure({
            doc,
            actionRunId: run.actionRunId,
            checkpoint: async () => undefined,
          });
        },
      },
      retryPolicy: createBoundedRetryPolicy({
        maxFailures: { submit: 1, poll: 1, stage: 1, publish: 1 },
        baseDelayMs: 0,
        maxDelayMs: 0,
      }),
    });
    const identity = { actionRunId: "run-stage-1", outputSlot: "image" };

    for (let step = 0; step < 6; step += 1) {
      const advanced = await coordinator.coordinate({
        type: "advance",
        identity,
      });
      if (advanced.kind === "terminal") break;
    }

    expect(operations).toEqual(["submit", "poll"]);
    expect(await journal.load(identity)).toMatchObject({
      phase: "succeeded",
      providerOutputs: [
        { slot: "image", kind: "asset", asset: { kind: "image" } },
      ],
    });
    expect(readProjectActionRun(doc, "run-stage-1")?.status).toBe("succeeded");
  });

  it.each([
    {
      name: "wrong slot",
      output: {
        slot: "thumbnail",
        kind: "asset" as const,
        asset: {
          assetId: "asset-wrong",
          uri: "clash-asset://asset-wrong",
          kind: "image" as const,
          mediaType: "image/png",
        },
      },
    },
    {
      name: "wrong media kind",
      output: {
        slot: "image",
        kind: "asset" as const,
        asset: {
          assetId: "asset-wrong",
          uri: "clash-asset://asset-wrong",
          kind: "video" as const,
          mediaType: "video/mp4",
        },
      },
    },
  ])(
    "fails a Generator Action that completes with $name",
    async ({ output }) => {
      const doc = projectDoc();
      const dataDir = await temporaryDataDir();
      const journal = createSqliteDurableRunJournal(dataDir);
      const bridge = createLocalGeneratorRunBridge({
        ownerId: "host-1",
        journal,
      });
      await bridge.enqueue({
        doc,
        request: request(),
        command: generatorActionCommand(),
        checkpoint: async () => undefined,
      });
      let staged = 0;
      let published = 0;
      const coordinator = createLocalDurableRunCoordinator({
        ownerId: "host-1",
        journal,
        providerPluginExecutor: async () => {
          throw new Error(
            "Generator Actions must not use the Provider adapter.",
          );
        },
        executablePluginAction: async () => ({
          protocol: "clash.plugin.result/v1",
          invocationId: "wrong-result",
          status: "completed",
          outputs: [output],
        }),
        outputStore: {
          async stage() {
            staged += 1;
            return {};
          },
        },
        publisher: {
          async publish() {
            published += 1;
          },
          async publishFailure({ run }) {
            await bridge.publishFailure({
              doc,
              actionRunId: run.actionRunId,
              checkpoint: async () => undefined,
            });
          },
        },
        retryPolicy: createBoundedRetryPolicy({
          maxFailures: { submit: 1, poll: 1, stage: 1, publish: 1 },
          baseDelayMs: 0,
          maxDelayMs: 0,
        }),
      });
      const identity = { actionRunId: "run-stage-1", outputSlot: "image" };

      for (let step = 0; step < 4; step += 1) {
        const advanced = await coordinator.coordinate({
          type: "advance",
          identity,
        });
        if (advanced.kind === "terminal") break;
      }

      expect(staged).toBe(0);
      expect(published).toBe(0);
      expect(await journal.load(identity)).toMatchObject({
        phase: "failed",
        failure: { code: "contract_violation" },
      });
      expect(readProjectActionRun(doc, "run-stage-1")?.status).toBe("failed");
    },
  );

  it("repairs public running after restart only when the owner-private task already exists", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const journal = createSqliteDurableRunJournal(dataDir);
    const pending = ensureActionRunRequest(doc, request());
    if (!pending.ok) throw new Error(pending.error.message);
    await createLocalDurableRun({
      ownerId: "host-1",
      journal,
      command: generatorActionCommand(),
    });
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal,
    });
    const checkpoints: string[] = [];

    const running = await bridge.projectRunning({
      doc,
      identity: { actionRunId: "run-stage-1", outputSlot: "image" },
      checkpoint: async () => {
        checkpoints.push(readProjectActionRun(doc, "run-stage-1")!.status);
      },
    });

    expect(checkpoints).toEqual(["running"]);
    expect(running).toMatchObject({
      actionRunId: "run-stage-1",
      status: "running",
    });
  });

  it("rejects a private task whose frozen output contract differs from the public ActionRun", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const journal = createSqliteDurableRunJournal(dataDir);
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal,
    });
    const mismatched = generatorActionCommand();
    mismatched.executor.generatorOutputContract = [
      {
        slot: "other-image",
        assetType: { kind: "media", mediaKind: "image" },
        cardinality: { minItems: 1, maxItems: 1 },
      },
    ];

    await expect(
      bridge.enqueue({
        doc,
        request: request(),
        command: mismatched,
        checkpoint: async () => undefined,
      }),
    ).rejects.toThrow(/exact.*output contract/i);
    expect(readProjectActionRun(doc, "run-stage-1")).toBeNull();
    await expect(
      journal.load({ actionRunId: "run-stage-1", outputSlot: "image" }),
    ).resolves.toBeUndefined();
  });

  it("rejects a private task whose executor differs from the immutable public ActionRun", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const journal = createSqliteDurableRunJournal(dataDir);
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal,
    });
    const mismatched = generatorActionCommand();
    mismatched.executor.binding = {
      ...mismatched.executor.binding,
      exportId: "other-export",
    };

    await expect(
      bridge.enqueue({
        doc,
        request: request(),
        command: mismatched,
        checkpoint: async () => undefined,
      }),
    ).rejects.toThrow(/exact.*executor/i);
    expect(readProjectActionRun(doc, "run-stage-1")).toBeNull();
    await expect(
      journal.load({ actionRunId: "run-stage-1", outputSlot: "image" }),
    ).resolves.toBeUndefined();
  });

  it("rejects a private task whose legacy public owner differs from the Generator revision", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const journal = createSqliteDurableRunJournal(dataDir);
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal,
    });
    const mismatched = generatorActionCommand();
    mismatched.executor.publicOwner = {
      actionId: "other-generator",
      actionRevisionId: "other-revision",
    };

    await expect(
      bridge.enqueue({
        doc,
        request: request(),
        command: mismatched,
        checkpoint: async () => undefined,
      }),
    ).rejects.toThrow(/public owner.*Generator revision/i);
    expect(readProjectActionRun(doc, "run-stage-1")).toBeNull();
    await expect(
      journal.load({ actionRunId: "run-stage-1", outputSlot: "image" }),
    ).resolves.toBeUndefined();
  });

  it("replays an exact retry on the same Run id and keeps a rerun with the same fingerprint distinct", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const journal = createSqliteDurableRunJournal(dataDir);
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal,
    });
    const firstRequest = request();
    const firstCommand = generatorActionCommand();

    const first = await bridge.enqueue({
      doc,
      request: firstRequest,
      command: firstCommand,
      checkpoint: async () => undefined,
    });
    const retry = await bridge.enqueue({
      doc,
      request: structuredClone(firstRequest),
      command: structuredClone(firstCommand),
      checkpoint: async () => undefined,
    });
    const rerunRequest = request("run-stage-2");
    const rerun = await bridge.enqueue({
      doc,
      request: rerunRequest,
      command: generatorActionCommand("run-stage-2"),
      checkpoint: async () => undefined,
    });

    expect(retry).toEqual(first);
    expect(rerun).toMatchObject({
      actionRunId: "run-stage-2",
      invocationFingerprint: first.invocationFingerprint,
      status: "running",
    });
    expect(doc.getMap("generatorActionRuns").size).toBe(2);
    await expect(
      journal.load({ actionRunId: "run-stage-1", outputSlot: "image" }),
    ).resolves.toMatchObject({ actionRunId: "run-stage-1" });
    await expect(
      journal.load({ actionRunId: "run-stage-2", outputSlot: "image" }),
    ).resolves.toMatchObject({ actionRunId: "run-stage-2" });
  });

  it("does not recreate a private task when an exact retry finds a terminal public Run", async () => {
    const doc = projectDoc();
    expect(ensureActionRunRequest(doc, request())).toMatchObject({ ok: true });
    expect(
      commitActionRunOutcome(doc, {
        actionRunId: "run-stage-1",
        status: "failed",
      }),
    ).toMatchObject({ ok: true, run: { status: "failed" } });
    const dataDir = await temporaryDataDir();
    const journal = createSqliteDurableRunJournal(dataDir);
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal,
    });
    const checkpoint = vi.fn(async () => undefined);

    await expect(
      bridge.enqueue({
        doc,
        request: request(),
        command: durableCommand(),
        checkpoint,
      }),
    ).resolves.toMatchObject({ status: "failed" });
    await expect(
      journal.load({ actionRunId: "run-stage-1", outputSlot: "image" }),
    ).resolves.toBeUndefined();
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it("rejects a legacy output binding that points at a different Generator revision owner", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal: createSqliteDurableRunJournal(dataDir),
    });
    await bridge.enqueue({
      doc,
      request: request(),
      command: generatorActionCommand(),
      checkpoint: async () => undefined,
    });
    const wrongOwner = legacyOutputBinding();
    wrongOwner.owner = {
      kind: "run",
      actionId: "other-generator",
      actionRevisionId: "other-revision",
      actionRunId: "run-stage-1",
    };

    await expect(
      bridge.publishMediaSuccess({
        doc,
        actionRunId: "run-stage-1",
        outputSlot: "image",
        entry: generatedAsset(),
        legacyBinding: wrongOwner,
        checkpoint: async () => undefined,
      }),
    ).rejects.toThrow(/legacy.*Generator.*revision/i);
    expect(readProjectAsset(doc, "asset-courtyard")).toBeNull();
    expect(
      readOutputCommit(doc, {
        actionRunId: "run-stage-1",
        outputSlot: "image",
      }),
    ).toBeNull();
    expect(readProjectActionRun(doc, "run-stage-1")?.status).toBe("running");
  });

  it("atomically publishes a typed Document revision, OutputCommit, and succeeded outcome", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal: createSqliteDurableRunJournal(dataDir),
    });
    const documentRequest = {
      ...request(),
      actionId: "transcribe",
      executor: { ...request().executor, exportId: "transcribe" },
      outputContract: [
        {
          slot: "transcript",
          assetType: {
            kind: "document" as const,
            documentKind: "media.transcript",
            schemaVersion: 1,
          },
          cardinality: { minItems: 1, maxItems: 1 },
        },
      ],
    };
    const requested = ensureActionRunRequest(doc, documentRequest);
    if (!requested.ok) throw new Error(requested.error.message);
    const started = markActionRunStarted(doc, documentRequest.actionRunId);
    if (!started.ok) throw new Error(started.error.message);
    const checkpoints: string[] = [];

    const published = await bridge.publishDocumentSuccess({
      doc,
      actionRunId: documentRequest.actionRunId,
      outputSlot: "transcript",
      revision: {
        id: "document-revision:run-stage-1:transcript",
        documentAssetId: "document:run-stage-1:transcript",
        documentKind: "media.transcript",
        schemaVersion: 1,
        mutability: "versioned",
        body: {
          digest: `sha256:${"e".repeat(64)}`,
          byteLength: 512,
          contentType: "application/json",
        },
        producer: { kind: "action-run", actionRunId: "run-stage-1" },
        sourceRefs: [],
      },
      checkpoint: async () => {
        checkpoints.push(
          JSON.stringify({
            document: readProjectDocumentAsset(
              doc,
              "document:run-stage-1:transcript",
            ),
            commit: readOutputCommit(doc, {
              actionRunId: "run-stage-1",
              outputSlot: "transcript",
            }),
            status: readProjectActionRun(doc, "run-stage-1")?.status,
          }),
        );
      },
    });

    expect(checkpoints).toHaveLength(1);
    expect(published).toMatchObject({
      revision: {
        id: "document-revision:run-stage-1:transcript",
        documentKind: "media.transcript",
      },
      commit: {
        asset: {
          kind: "document",
          documentAssetId: "document:run-stage-1:transcript",
          revisionId: "document-revision:run-stage-1:transcript",
        },
      },
      run: { status: "succeeded" },
    });
    expect(
      readDocumentAssetRevision(doc, {
        documentAssetId: "document:run-stage-1:transcript",
        revisionId: "document-revision:run-stage-1:transcript",
      }),
    ).not.toBeNull();
  });

  it("rejects a Document output whose kind differs from the frozen Run contract", async () => {
    const doc = projectDoc();
    const dataDir = await temporaryDataDir();
    const bridge = createLocalGeneratorRunBridge({
      ownerId: "host-1",
      journal: createSqliteDurableRunJournal(dataDir),
    });
    const documentRequest = {
      ...request(),
      outputContract: [
        {
          slot: "document",
          assetType: {
            kind: "document" as const,
            documentKind: "media.description",
            schemaVersion: 1,
          },
          cardinality: { minItems: 1, maxItems: 1 },
        },
      ],
    };
    const requested = ensureActionRunRequest(doc, documentRequest);
    if (!requested.ok) throw new Error(requested.error.message);

    await expect(
      bridge.publishDocumentSuccess({
        doc,
        actionRunId: "run-stage-1",
        outputSlot: "document",
        revision: {
          id: "wrong:r1",
          documentAssetId: "wrong",
          documentKind: "media.transcript",
          schemaVersion: 1,
          mutability: "versioned",
          body: {
            digest: `sha256:${"f".repeat(64)}`,
            byteLength: 10,
            contentType: "application/json",
          },
          producer: { kind: "action-run", actionRunId: "run-stage-1" },
          sourceRefs: [],
        },
        checkpoint: async () => undefined,
      }),
    ).rejects.toThrow(/Document.*output contract/i);
    expect(readProjectDocumentAsset(doc, "wrong")).toBeNull();
  });
});
