import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { LoroDoc } from "loro-crdt";
import type {
  ExecutablePluginGeneratorRegistration,
  GeneratorDefinition,
} from "@clash/shared-types";
import {
  commitActionRunOutcome,
  createProjectAsset,
  ensureActionRunRequest,
  ensureOutputCommit,
  readGeneratorRevision,
  readProjectActionRun,
  resolveOutputCommitAssetType,
} from "@clash/shared-types";

import { createLocalApiApp } from "./app.js";
import { createSqliteDurableRunJournal } from "./durable-run-journal.js";
import { FileReplicaStore } from "./loro/file-replica-store.js";
import { LocalLoroRoomHub } from "./sync.js";
import { createLocalGeneratorProductService } from "./local-generator-product.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function dataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "clash-generator-product-"));
  temporaryDirectories.push(directory);
  return directory;
}

const definition: GeneratorDefinition = {
  pluginId: "clash.codex-imagegen",
  definitionId: "codex-imagegen",
  version: "0.1.0",
  schemaHash: `sha256:${"a".repeat(64)}`,
  stateSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1 },
      aspect_ratio: { type: "string", enum: ["1:1", "16:9"] },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  editPolicy: "fork-when-materialized",
  persistentInputs: [
    {
      slot: "image",
      accepts: [{ kind: "media", mediaKind: "image" }],
      cardinality: { minItems: 0, maxItems: 5 },
    },
  ],
  actions: [
    {
      id: "generate",
      executorExportId: "generate-image",
      parametersSchema: { type: "object", additionalProperties: false },
      invocationInputs: [],
      outputs: [
        {
          slot: "image",
          assetType: { kind: "media", mediaKind: "image" },
          cardinality: { minItems: 1, maxItems: 1 },
        },
      ],
    },
  ],
};

const registration: ExecutablePluginGeneratorRegistration = {
  pluginId: definition.pluginId,
  version: definition.version,
  schemaHash: definition.schemaHash,
  document: {
    apiVersion: "clash.generator/v1",
    kind: "generator",
    spec: {
      definitionId: definition.definitionId,
      stateSchema: definition.stateSchema,
      editPolicy: definition.editPolicy,
      persistentInputs: definition.persistentInputs,
      actions: definition.actions,
    },
  },
};

const stageDefinition: GeneratorDefinition = {
  pluginId: "clash.stage",
  definitionId: "director-stage",
  version: "1.0.0",
  schemaHash: `sha256:${"b".repeat(64)}`,
  stateSchema: {
    type: "object",
    properties: { scene: { type: "string", minLength: 1 } },
    required: ["scene"],
    additionalProperties: false,
  },
  editPolicy: "advance-head",
  persistentInputs: [],
  actions: [
    {
      id: "render-still",
      executorExportId: "render-still",
      parametersSchema: { type: "object", additionalProperties: false },
      invocationInputs: [],
      outputs: [
        {
          slot: "image",
          assetType: { kind: "media", mediaKind: "image" },
          cardinality: { minItems: 1, maxItems: 1 },
        },
      ],
    },
  ],
};

describe("Local Generator product surface", () => {
  it("lists and resolves only Host-owned semantic definitions", async () => {
    const app = createLocalApiApp({
      dataDir: await dataDir(),
      listPluginGenerators: async () => [registration],
      resolveGeneratorDefinition: async () => definition,
    } as Parameters<typeof createLocalApiApp>[0]);

    const listed = await app.request("/api/v1/generator-definitions");
    expect(listed.status, await listed.clone().text()).toBe(200);
    await expect(listed.json()).resolves.toEqual({ definitions: [definition] });

    const read = await app.request(
      "/api/v1/generator-definitions/clash.codex-imagegen/codex-imagegen",
    );
    expect(read.status, await read.clone().text()).toBe(200);
    const readBody = await read.json();
    expect(readBody).toEqual({ definition });
    expect(JSON.stringify(readBody)).not.toContain("runtime");
  });

  it("creates and reads a Project Generator whose definition provenance is Host-derived", async () => {
    const doc = new LoroDoc();
    const app = createLocalApiApp({
      dataDir: await dataDir(),
      resolveGeneratorDefinition: async () => definition,
      generatorProjectAuthority: {
        inspect: async (_projectId, read) => read(doc),
        mutate: async (_projectId, mutation) =>
          mutation(doc, async () => undefined),
      },
    } as Parameters<typeof createLocalApiApp>[0]);

    const created = await app.request("/api/v1/projects/project-1/generators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        generatorId: "imagegen-1",
        generatorRevisionId: "imagegen-1:r1",
        pluginId: "clash.codex-imagegen",
        definitionId: "codex-imagegen",
        state: { prompt: "a paper lighthouse", aspect_ratio: "16:9" },
        persistentInputRefs: [],
      }),
    });

    expect(created.status, await created.clone().text()).toBe(201);
    await expect(created.json()).resolves.toEqual({
      generator: {
        id: "imagegen-1",
        headRevisionId: "imagegen-1:r1",
        definitionRef: {
          pluginId: definition.pluginId,
          definitionId: definition.definitionId,
          version: definition.version,
          schemaHash: definition.schemaHash,
        },
      },
      revision: {
        id: "imagegen-1:r1",
        generatorId: "imagegen-1",
        definitionRef: {
          pluginId: definition.pluginId,
          definitionId: definition.definitionId,
          version: definition.version,
          schemaHash: definition.schemaHash,
        },
        state: { prompt: "a paper lighthouse", aspect_ratio: "16:9" },
        persistentInputRefs: [],
      },
    });

    const read = await app.request(
      "/api/v1/projects/project-1/generators/imagegen-1",
    );
    expect(read.status, await read.clone().text()).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      generator: { id: "imagegen-1", headRevisionId: "imagegen-1:r1" },
      revision: { id: "imagegen-1:r1", generatorId: "imagegen-1" },
    });
  });

  it("advances a Stage head under the Host-derived edit policy and preserves its old revision", async () => {
    const doc = new LoroDoc();
    const app = createLocalApiApp({
      dataDir: await dataDir(),
      resolveGeneratorDefinition: async () => stageDefinition,
      generatorProjectAuthority: {
        inspect: async (_projectId, read) => read(doc),
        mutate: async (_projectId, mutation) =>
          mutation(doc, async () => undefined),
      },
    } as Parameters<typeof createLocalApiApp>[0]);
    const collection = "/api/v1/projects/project-1/generators";
    const created = await app.request(collection, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        generatorId: "stage-1",
        generatorRevisionId: "stage-1:r1",
        pluginId: stageDefinition.pluginId,
        definitionId: stageDefinition.definitionId,
        state: { scene: "courtyard" },
        persistentInputRefs: [],
      }),
    });
    expect(created.status).toBe(201);

    const advanced = await app.request(`${collection}/stage-1/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedHeadRevisionId: "stage-1:r1",
        generatorRevisionId: "stage-1:r2",
        state: { scene: "courtyard at night" },
        persistentInputRefs: [],
      }),
    });

    expect(advanced.status, await advanced.clone().text()).toBe(201);
    await expect(advanced.json()).resolves.toMatchObject({
      generator: { id: "stage-1", headRevisionId: "stage-1:r2" },
      revision: {
        id: "stage-1:r2",
        parentRevisionId: "stage-1:r1",
        state: { scene: "courtyard at night" },
        definitionRef: {
          pluginId: stageDefinition.pluginId,
          definitionId: stageDefinition.definitionId,
          version: stageDefinition.version,
          schemaHash: stageDefinition.schemaHash,
        },
      },
    });
    expect(
      readGeneratorRevision(doc, {
        generatorId: "stage-1",
        generatorRevisionId: "stage-1:r1",
      }),
    ).toMatchObject({ state: { scene: "courtyard" } });

    const spoofedPolicy = await app.request(`${collection}/stage-1/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedHeadRevisionId: "stage-1:r2",
        generatorRevisionId: "stage-1:r3",
        state: { scene: "spoofed" },
        persistentInputRefs: [],
        editPolicy: "fork-when-materialized",
        definitionRef: { pluginId: "attacker.shadow" },
      }),
    });
    expect(spoofedPolicy.status).toBe(400);
    expect(
      readGeneratorRevision(doc, {
        generatorId: "stage-1",
        generatorRevisionId: "stage-1:r3",
      }),
    ).toBeNull();
  });

  it("returns copy-on-write for a materialized Codex head and accepts the fork through create", async () => {
    const doc = new LoroDoc();
    const app = createLocalApiApp({
      dataDir: await dataDir(),
      resolveGeneratorDefinition: async () => definition,
      generatorProjectAuthority: {
        inspect: async (_projectId, read) => read(doc),
        mutate: async (_projectId, mutation) =>
          mutation(doc, async () => undefined),
      },
    } as Parameters<typeof createLocalApiApp>[0]);
    const collection = "/api/v1/projects/project-1/generators";
    const initialState = { prompt: "a paper lighthouse", aspect_ratio: "16:9" };
    expect(
      (
        await app.request(collection, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            generatorId: "imagegen-materialized",
            generatorRevisionId: "imagegen-materialized:r1",
            pluginId: definition.pluginId,
            definitionId: definition.definitionId,
            state: initialState,
            persistentInputRefs: [],
          }),
        })
      ).status,
    ).toBe(201);
    expect(
      ensureActionRunRequest(doc, {
        actionRunId: "run-materialized",
        generatorRevision: {
          generatorId: "imagegen-materialized",
          generatorRevisionId: "imagegen-materialized:r1",
        },
        actionId: "generate",
        executor: {
          pluginId: definition.pluginId,
          version: definition.version,
          exportId: "generate-image",
          schemaHash: definition.schemaHash,
        },
        invocationFingerprint: `sha256:${"c".repeat(64)}`,
        parameters: {},
        invocationInputRefs: [],
        outputContract: definition.actions[0]!.outputs,
      }),
    ).toMatchObject({ ok: true });

    const blocked = await app.request(
      `${collection}/imagegen-materialized/revisions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedHeadRevisionId: "imagegen-materialized:r1",
          generatorRevisionId: "imagegen-materialized:r2",
          state: { ...initialState, prompt: "a blue paper lighthouse" },
          persistentInputRefs: [],
        }),
      },
    );
    expect(blocked.status, await blocked.clone().text()).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({
      code: "GENERATOR_FORK_REQUIRED",
      copyOnWrite: {
        required: true,
        forkedFrom: {
          generatorId: "imagegen-materialized",
          generatorRevisionId: "imagegen-materialized:r1",
        },
      },
    });
    expect(
      readGeneratorRevision(doc, {
        generatorId: "imagegen-materialized",
        generatorRevisionId: "imagegen-materialized:r2",
      }),
    ).toBeNull();

    const forked = await app.request(collection, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        generatorId: "imagegen-fork",
        generatorRevisionId: "imagegen-fork:r1",
        pluginId: definition.pluginId,
        definitionId: definition.definitionId,
        state: { ...initialState, prompt: "a blue paper lighthouse" },
        persistentInputRefs: [],
        forkedFrom: {
          generatorId: "imagegen-materialized",
          generatorRevisionId: "imagegen-materialized:r1",
        },
      }),
    });
    expect(forked.status, await forked.clone().text()).toBe(201);
    await expect(forked.json()).resolves.toMatchObject({
      generator: { id: "imagegen-fork", headRevisionId: "imagegen-fork:r1" },
      revision: {
        forkedFrom: {
          generatorId: "imagegen-materialized",
          generatorRevisionId: "imagegen-materialized:r1",
        },
      },
    });
  });

  it("rejects invalid initial state and client-supplied definition provenance", async () => {
    const doc = new LoroDoc();
    const app = createLocalApiApp({
      dataDir: await dataDir(),
      resolveGeneratorDefinition: async () => definition,
      generatorProjectAuthority: {
        inspect: async (_projectId, read) => read(doc),
        mutate: async (_projectId, mutation) =>
          mutation(doc, async () => undefined),
      },
    } as Parameters<typeof createLocalApiApp>[0]);
    const base = {
      generatorId: "imagegen-invalid",
      generatorRevisionId: "imagegen-invalid:r1",
      pluginId: definition.pluginId,
      definitionId: definition.definitionId,
      state: { prompt: "" },
      persistentInputRefs: [],
    };

    const invalidState = await app.request(
      "/api/v1/projects/project-1/generators",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(base),
      },
    );
    expect(invalidState.status, await invalidState.clone().text()).toBe(422);
    await expect(invalidState.json()).resolves.toMatchObject({
      error: expect.stringMatching(/state.*prompt/i),
    });

    const spoofed = await app.request("/api/v1/projects/project-1/generators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...base,
        state: { prompt: "valid" },
        definitionRef: {
          pluginId: "attacker.shadow",
          definitionId: "shadow",
          version: "9.9.9",
          schemaHash: `sha256:${"f".repeat(64)}`,
        },
      }),
    });
    expect(spoofed.status).toBe(400);

    const malformedReference = await app.request(
      "/api/v1/projects/project-1/generators",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...base,
          state: { prompt: "valid" },
          persistentInputRefs: [{ slot: "image", target: { kind: "media" } }],
        }),
      },
    );
    expect(
      malformedReference.status,
      await malformedReference.clone().text(),
    ).toBe(400);
  });

  it("persists public Run intent before the private task, wakes work, and reads the exact output winner", async () => {
    const directory = await dataDir();
    const doc = new LoroDoc();
    const journal = createSqliteDurableRunJournal(directory);
    const checkpoints: Array<{
      status: string | null;
      privateTaskExists: boolean;
    }> = [];
    const processProjectWork = vi.fn(async () => undefined);
    const app = createLocalApiApp({
      dataDir: directory,
      userId: "local-user",
      resolveGeneratorDefinition: async () => definition,
      processProjectWork,
      generatorProjectAuthority: {
        inspect: async (_projectId, read) => read(doc),
        mutate: async (_projectId, mutation) =>
          mutation(doc, async () => {
            const run = readProjectActionRun(doc, "run-imagegen-1");
            const task = await journal.load({
              actionRunId: "run-imagegen-1",
              outputSlot: "image",
            });
            checkpoints.push({
              status: run?.status ?? null,
              privateTaskExists: task !== undefined,
            });
          }),
      },
    } as Parameters<typeof createLocalApiApp>[0]);

    const created = await app.request("/api/v1/projects/project-1/generators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        generatorId: "imagegen-1",
        generatorRevisionId: "imagegen-1:r1",
        pluginId: definition.pluginId,
        definitionId: definition.definitionId,
        state: { prompt: "a paper lighthouse", aspect_ratio: "16:9" },
        persistentInputRefs: [],
      }),
    });
    expect(created.status).toBe(201);
    checkpoints.length = 0;

    const spoofedSubmission = await app.request(
      "/api/v1/projects/project-1/generators/imagegen-1/actions/generate/runs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionRunId: "run-imagegen-spoofed",
          generatorRevisionId: "imagegen-1:r1",
          parameters: {},
          invocationInputRefs: [],
          definitionRef: { pluginId: "attacker.shadow" },
          executor: { pluginId: "attacker.shadow", exportId: "steal" },
          outputContract: [],
          invocationFingerprint: `sha256:${"f".repeat(64)}`,
          realm: "process-stdio",
        }),
      },
    );
    expect(spoofedSubmission.status).toBe(400);
    expect(readProjectActionRun(doc, "run-imagegen-spoofed")).toBeNull();

    const submitted = await app.request(
      "/api/v1/projects/project-1/generators/imagegen-1/actions/generate/runs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionRunId: "run-imagegen-1",
          generatorRevisionId: "imagegen-1:r1",
          parameters: {},
          invocationInputRefs: [],
        }),
      },
    );

    expect(submitted.status, await submitted.clone().text()).toBe(202);
    await expect(submitted.json()).resolves.toMatchObject({
      run: {
        actionRunId: "run-imagegen-1",
        actionId: "generate",
        status: "running",
        executor: {
          pluginId: definition.pluginId,
          version: definition.version,
          exportId: "generate-image",
          schemaHash: definition.schemaHash,
        },
      },
    });
    expect(checkpoints).toEqual([
      { status: "pending", privateTaskExists: false },
      { status: "running", privateTaskExists: true },
    ]);

    const task = await journal.load({
      actionRunId: "run-imagegen-1",
      outputSlot: "image",
    });
    expect(task?.executorInput).toMatchObject({
      targetKind: "generator-action",
      binding: {
        pluginId: definition.pluginId,
        version: definition.version,
        exportId: "generate-image",
        schemaHash: definition.schemaHash,
      },
      actionId: "generate",
      publicOwner: {
        actionId: "imagegen-1",
        actionRevisionId: "imagegen-1:r1",
      },
      kind: "image",
      projectId: "project-1",
      input: {
        values: { prompt: "a paper lighthouse", aspect_ratio: "16:9" },
        references: [],
      },
    });
    await vi.waitFor(() =>
      expect(processProjectWork).toHaveBeenCalledWith("project-1"),
    );

    const runRead = await app.request(
      "/api/v1/projects/project-1/generator-runs/run-imagegen-1",
    );
    expect(runRead.status).toBe(200);
    await expect(runRead.json()).resolves.toMatchObject({
      run: { actionRunId: "run-imagegen-1", status: "running" },
    });

    const missingOutput = await app.request(
      "/api/v1/projects/project-1/generator-runs/run-imagegen-1/outputs/image",
    );
    expect(missingOutput.status).toBe(404);

    expect(
      createProjectAsset(doc, {
        id: "asset:imagegen-1",
        kind: "image",
        source: { kind: "owned", resourceId: "resource:imagegen-1" },
        lifecycle: { state: "active" },
        metadata: { contentType: "image/png", width: 1, height: 1 },
      }),
    ).toMatchObject({ ok: true });
    expect(
      ensureOutputCommit(
        doc,
        {
          actionRunId: "run-imagegen-1",
          outputSlot: "image",
          asset: { kind: "media", projectAssetId: "asset:imagegen-1" },
        },
        resolveOutputCommitAssetType,
      ),
    ).toMatchObject({ ok: true });
    expect(
      commitActionRunOutcome(doc, {
        actionRunId: "run-imagegen-1",
        status: "succeeded",
      }),
    ).toMatchObject({ ok: true });

    const output = await app.request(
      "/api/v1/projects/project-1/generator-runs/run-imagegen-1/outputs/image",
    );
    expect(output.status, await output.clone().text()).toBe(200);
    await expect(output.json()).resolves.toEqual({
      commit: {
        actionRunId: "run-imagegen-1",
        outputSlot: "image",
        asset: { kind: "media", projectAssetId: "asset:imagegen-1" },
      },
    });
  });

  it("persists and broadcasts a live-room checkpoint before the mutation continues", async () => {
    const directory = await dataDir();
    const projectId = "checkpointed-generator-project";
    const hub = new LocalLoroRoomHub(directory, undefined, null);
    const peer = new LoroDoc();
    const room = await hub.room(projectId);
    room.addPeer((update) => peer.import(update));
    const store = new FileReplicaStore(join(directory, "projects"));

    await hub.mutateProjectWithCheckpoint(
      projectId,
      async (doc, checkpoint) => {
        doc.getMap("generator-product-test").set("phase", "public-intent");
        await checkpoint();

        const persisted = await store.recover(projectId);
        expect(persisted.getMap("generator-product-test").get("phase")).toBe(
          "public-intent",
        );
        expect(peer.getMap("generator-product-test").get("phase")).toBe(
          "public-intent",
        );
        doc.getMap("generator-product-test").set("phase", "private-created");
        return "done";
      },
    );

    const finalPersisted = await store.recover(projectId);
    expect(finalPersisted.getMap("generator-product-test").get("phase")).toBe(
      "private-created",
    );
    expect(peer.getMap("generator-product-test").get("phase")).toBe(
      "private-created",
    );
    await hub.close();
  });

  it("replays a pending public intent after crashing before private task creation", async () => {
    const directory = await dataDir();
    const durableJournal = createSqliteDurableRunJournal(directory);
    let crashBeforeCreate = true;
    const crashingJournal = {
      ...durableJournal,
      async create(
        run: Parameters<typeof durableJournal.create>[0],
      ): Promise<void> {
        if (crashBeforeCreate) {
          crashBeforeCreate = false;
          throw new Error("simulated crash before private journal create");
        }
        await durableJournal.create(run);
      },
    };
    const firstHub = new LocalLoroRoomHub(directory, undefined, null);
    const firstAuthority = {
      inspect: <T>(
        projectId: string,
        read: (project: LoroDoc) => T | Promise<T>,
      ) => firstHub.inspectProject(projectId, read),
      mutate: <T>(
        projectId: string,
        mutation: (
          project: LoroDoc,
          checkpoint: () => Promise<void>,
        ) => T | Promise<T>,
      ) => firstHub.mutateProjectWithCheckpoint(projectId, mutation),
    };
    const firstHost = createLocalGeneratorProductService({
      authority: firstAuthority,
      resolveDefinition: async () => definition,
      ownerId: "host-1",
      journal: crashingJournal,
      actor: { kind: "user", id: "local-user" },
    });
    await firstHost.create("project-1", {
      generatorId: "imagegen-replay",
      generatorRevisionId: "imagegen-replay:r1",
      pluginId: definition.pluginId,
      definitionId: definition.definitionId,
      state: { prompt: "a resilient lighthouse" },
      persistentInputRefs: [],
    });

    const submission = {
      actionRunId: "run-imagegen-replay",
      generatorRevisionId: "imagegen-replay:r1",
      parameters: {},
      invocationInputRefs: [],
    };
    await expect(
      firstHost.submit("project-1", "imagegen-replay", "generate", submission),
    ).rejects.toThrow(/simulated crash/);
    await firstHub.close();

    const persistedAfterCrash = await new FileReplicaStore(
      join(directory, "projects"),
    ).recover("project-1");
    expect(
      readProjectActionRun(persistedAfterCrash, submission.actionRunId)?.status,
    ).toBe("pending");
    await expect(
      durableJournal.load({
        actionRunId: submission.actionRunId,
        outputSlot: "image",
      }),
    ).resolves.toBeUndefined();

    const recoveredHub = new LocalLoroRoomHub(directory, undefined, null);
    const recoveredHost = createLocalGeneratorProductService({
      authority: {
        inspect: (projectId, read) =>
          recoveredHub.inspectProject(projectId, read),
        mutate: (projectId, mutation) =>
          recoveredHub.mutateProjectWithCheckpoint(projectId, mutation),
      },
      resolveDefinition: async () => definition,
      ownerId: "host-1",
      journal: durableJournal,
      actor: { kind: "user", id: "local-user" },
    });
    const recovered = await recoveredHost.submit(
      "project-1",
      "imagegen-replay",
      "generate",
      submission,
    );

    expect(recovered.status).toBe("running");
    await expect(
      durableJournal.load({
        actionRunId: submission.actionRunId,
        outputSlot: "image",
      }),
    ).resolves.toMatchObject({
      actionRunId: submission.actionRunId,
      phase: "queued",
      executorInput: {
        targetKind: "generator-action",
        binding: { exportId: "generate-image" },
      },
    });
    await recoveredHub.close();
  });
});
