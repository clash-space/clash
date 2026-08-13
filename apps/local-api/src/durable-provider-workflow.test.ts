import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createActionAssetBinding,
  createProjectAsset,
  listActionAssetReferences,
  listProjectAssets,
  MODEL_CARDS,
  readProjectAsset,
} from "@clash/shared-types";

import { createLocalApiApp } from "./app.js";
import { createSqliteDurableRunJournal } from "./durable-run-journal.js";
import { createProviderExecutionHandoffStore } from "./provider-execution-handoff.js";
import type {
  ExternalAigcService,
  ProviderPluginExecutionPlan,
  ProviderPluginExecutor,
} from "./local-aigc.js";
import { createLocalWorkflowProcessor } from "./local-processor.js";
import { FileReplicaStore } from "./loro/file-replica-store.js";
import { createLocalPluginAssetStagingStore } from "./local-plugin-asset-staging.js";

const temporaryDirectories: string[] = [];

async function temporaryDataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "clash-durable-provider-workflow-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const binding = {
  pluginId: "test.provider",
  version: "1.0.0",
  exportId: "execute",
  schemaHash: `sha256:${"d".repeat(64)}`,
} as const;

const plan: ProviderPluginExecutionPlan = {
  binding,
  accountId: "private-account",
  assetInputs: [],
  kind: "video",
  projectId: "project-1",
  nodeId: "node-1",
  provider: "test-provider",
  modelEndpoint: "video-v1",
  input: {
    values: {
      modelId: "test-video",
      upstreamModel: "video-v1",
      prompt: "A paper city",
      modelParams: {},
    },
    references: [],
  },
};

function aigc(planProviderPlugin: ExternalAigcService["planProviderPlugin"]): ExternalAigcService {
  return {
    planProviderPlugin,
    generateImage: vi.fn(),
    generateVideo: vi.fn(),
    generateAudio: vi.fn(),
    generateText: vi.fn(),
  };
}

function pendingDoc(): LoroDoc {
  const doc = new LoroDoc();
  doc.getMap("nodes").set("node-1", {
    id: "node-1",
    type: "video",
    position: { x: 0, y: 0 },
    data: {
      status: "pending",
      actionType: "video-gen",
      modelId: "test-video",
      prompt: "A paper city",
    },
  });
  return doc;
}

describe("durable executable Provider generation", () => {
  it("applies parameter-conditioned Model Card validation before planning", async () => {
    const dataDir = await temporaryDataDir();
    const doc = pendingDoc();
    const nodes = doc.getMap("nodes");
    const node = nodes.get("node-1") as Record<string, any>;
    nodes.set("node-1", {
      ...node,
      data: {
        ...node.data,
        modelId: "seedance-2.5-ref",
        modelParams: { edit_mode: true },
      },
    });
    const planner = vi.fn(async () => plan);
    const processor = createLocalWorkflowProcessor({
      dataDir,
      modelCards: async () => MODEL_CARDS,
      aigc: aigc(planner),
    });

    await processor.process({ doc, projectId: "project-1" });

    expect((nodes.get("node-1") as Record<string, any>).data).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/at least 1 reference video/i),
    });
    expect(planner).not.toHaveBeenCalled();
  });

  it("fails closed before submit when a Provider plan has no durable coordinator", async () => {
    const dataDir = await temporaryDataDir();
    const doc = pendingDoc();
    const service = aigc(vi.fn(async () => plan));
    const processor = createLocalWorkflowProcessor({ dataDir, aigc: service });

    await processor.process({ doc, projectId: "project-1" });

    expect((doc.getMap("nodes").get("node-1") as any).data).toMatchObject({
      status: "failed",
      error:
        "Provider-backed generation requires the Host durable run coordinator before submit.",
    });
    expect(service.generateVideo).not.toHaveBeenCalled();
  });

  it("freezes media sizing into the same input used by durable and direct execution", async () => {
    const dataDir = await temporaryDataDir();
    const doc = pendingDoc();
    const nodes = doc.getMap("nodes");
    const node = nodes.get("node-1") as Record<string, any>;
    nodes.set("node-1", {
      ...node,
      data: {
        ...node.data,
        aspectRatio: "9:16",
        modelParams: { aspect_ratio: "9:16", duration: 8 },
      },
    });
    const planner = vi.fn(async () => plan);
    const processor = createLocalWorkflowProcessor({
      dataDir,
      aigc: aigc(planner),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: async () => ({
          status: "accepted",
          binding,
          pollState: { taskId: "provider-task" },
        }),
      },
    });

    await processor.process({ doc, projectId: "project-1" });

    expect(planner).toHaveBeenCalledWith(
      expect.objectContaining({
        aspectRatio: "9:16",
        duration: 8,
        modelParams: { aspect_ratio: "9:16", duration: 8 },
      }),
      "video",
    );
  });

  it("publishes input bindings even when Project Asset authority materialization already changed the replica", async () => {
    const dataDir = await temporaryDataDir();
    const doc = pendingDoc();
    expect(createProjectAsset(doc, {
      id: "reference-asset",
      kind: "image",
      source: { kind: "owned", resourceId: `sha256:${"a".repeat(64)}` },
      lifecycle: { state: "active" },
      metadata: {},
    })).toMatchObject({ ok: true });

    const referencePlan: ProviderPluginExecutionPlan = {
      ...plan,
      input: {
        ...plan.input,
        references: [
          {
            slot: "image",
            index: 0,
            asset: {
              assetId: "reference-asset",
              uri: "clash-asset://reference-asset",
              kind: "image",
            },
          },
        ],
      },
    };
    const processor = createLocalWorkflowProcessor({
      dataDir,
      aigc: aigc(async () => referencePlan),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: async () => ({
          status: "accepted",
          binding,
          pollState: { providerTask: "task-with-reference" },
        }),
        now: () => 100,
      },
    });

    await expect(processor.process({ doc, projectId: "project-1" })).resolves.toBe(true);
    expect(listActionAssetReferences(doc, "reference-asset")).toEqual([
      expect.objectContaining({
        direction: "input",
        slot: "image:0",
        projectAssetId: "reference-asset",
        role: "reference",
      }),
    ]);
  });

  it("repairs and checkpoints frozen input bindings after a crash before Provider submit", async () => {
    const dataDir = await temporaryDataDir();
    const referencePlan: ProviderPluginExecutionPlan = {
      ...plan,
      input: {
        ...plan.input,
        references: [
          {
            slot: "image",
            index: 0,
            asset: {
              assetId: "reference-asset",
              uri: "clash-asset://reference-asset",
              kind: "image",
            },
          },
        ],
      },
    };
    const firstDoc = pendingDoc();
    expect(
      createProjectAsset(firstDoc, {
        id: "reference-asset",
        kind: "image",
        source: { kind: "owned", resourceId: `sha256:${"b".repeat(64)}` },
        lifecycle: { state: "active" },
        metadata: {},
      }),
    ).toMatchObject({ ok: true });
    const submit = vi.fn<ProviderPluginExecutor>(async () => ({
      status: "accepted",
      binding,
      pollState: { providerTask: "recovered-task" },
      retryAfterMs: 5_000,
    }));
    const first = createLocalWorkflowProcessor({
      dataDir,
      aigc: aigc(async () => referencePlan),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: submit,
        now: () => 100,
      },
    });

    await first.process({
      doc: firstDoc,
      projectId: "project-1",
      checkpoint: async () => {
        throw new Error("process crashed before binding snapshot commit");
      },
    });
    expect(submit).not.toHaveBeenCalled();
    await expect(
      createSqliteDurableRunJournal(dataDir).load({
        actionRunId: "project:project-1:node:node-1",
        outputSlot: "media",
      }),
    ).resolves.toMatchObject({ phase: "queued" });

    // Reopen the last durable Project snapshot: it predates the in-memory binding mutation above.
    const recoveredDoc = pendingDoc();
    expect(
      createProjectAsset(recoveredDoc, {
        id: "reference-asset",
        kind: "image",
        source: { kind: "owned", resourceId: `sha256:${"b".repeat(64)}` },
        lifecycle: { state: "active" },
        metadata: {},
      }),
    ).toMatchObject({ ok: true });
    const events: string[] = [];
    const recoveredSubmit = vi.fn<ProviderPluginExecutor>(async () => {
      events.push("submit");
      expect(listActionAssetReferences(recoveredDoc, "reference-asset")).toEqual([
        expect.objectContaining({ direction: "input", slot: "image:0" }),
      ]);
      return {
        status: "accepted",
        binding,
        pollState: { providerTask: "recovered-task" },
        retryAfterMs: 5_000,
      };
    });
    const recovered = createLocalWorkflowProcessor({
      dataDir,
      aigc: aigc(async () => referencePlan),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: recoveredSubmit,
        now: () => 100,
      },
    });

    await recovered.process({
      doc: recoveredDoc,
      projectId: "project-1",
      checkpoint: async () => {
        events.push("checkpoint");
      },
    });

    expect(recoveredSubmit).toHaveBeenCalledTimes(1);
    expect(events.indexOf("checkpoint")).toBeLessThan(events.indexOf("submit"));
  });

  it("freezes ordered content with global indexes and multiset Asset occurrences", async () => {
    const dataDir = await temporaryDataDir();
    const doc = pendingDoc();
    const nodes = doc.getMap("nodes");
    const pending = nodes.get("node-1") as Record<string, any>;
    nodes.set("node-1", {
      ...pending,
      data: {
        ...pending.data,
        modelId: "minimax-h3",
        prompt: "Before @[same](node:reference-node) after",
        referenceImageAssetIds: ["same-asset", "same-asset"],
      },
    });
    nodes.set("reference-node", {
      id: "reference-node",
      type: "image",
      position: { x: -100, y: 0 },
      data: { status: "completed", assetId: "same-asset" },
    });
    expect(
      createProjectAsset(doc, {
        id: "same-asset",
        kind: "image",
        source: { kind: "owned", resourceId: `sha256:${"c".repeat(64)}` },
        lifecycle: { state: "active" },
        metadata: { contentType: "image/png" },
      }),
    ).toMatchObject({ ok: true });
    const plannedInputs: ProviderPluginExecutionPlan["input"][] = [];
    const processor = createLocalWorkflowProcessor({
      dataDir,
      aigc: aigc(async (input) => {
        const plannedInput = {
          values: plan.input.values,
          references: input.references ?? [],
        };
        plannedInputs.push(plannedInput);
        return { ...plan, input: plannedInput };
      }),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: async () => ({
          status: "accepted",
          binding,
          pollState: { providerTask: "ordered-task" },
          retryAfterMs: 5_000,
        }),
        now: () => 100,
      },
    });

    await processor.process({ doc, projectId: "project-1" });

    expect(plannedInputs).toHaveLength(1);
    expect(plannedInputs[0]?.references).toEqual([
      {
        slot: "content",
        index: 0,
        text: { nodeId: "node-1:prompt:0", value: "Before " },
      },
      expect.objectContaining({
        slot: "content",
        index: 1,
        asset: expect.objectContaining({ assetId: "same-asset" }),
      }),
      {
        slot: "content",
        index: 2,
        text: { nodeId: "node-1:prompt:2", value: " after" },
      },
      expect.objectContaining({
        slot: "content",
        index: 3,
        asset: expect.objectContaining({ assetId: "same-asset" }),
      }),
    ]);
  });

  it("keeps a CLI-selected account out of Loro while freezing it into the durable run", async () => {
    const dataDir = await temporaryDataDir();
    const app = createLocalApiApp({ dataDir });
    const command = (body: Record<string, unknown>) => app.request(
      "/api/v1/projects/project-private-account/host-command",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const added = await command({
      action: "add",
      canvasId: "main",
      type: "image_gen",
      label: "Private account routing",
      prompt: "Private account routing",
    });
    const action = (await added.json()) as { node_id: string };
    expect(action).toEqual(
      expect.objectContaining({ node_id: expect.any(String) }),
    );
    const executed = await command({
      action: "execute",
      canvasId: "main",
      nodeId: action.node_id,
      providerAccountId: "private-account",
    });
    const execution = (await executed.json()) as { childNodeId: string };
    expect(execution).toEqual(
      expect.objectContaining({
        childNodeId: expect.any(String),
      }),
    );

    const replica = await new FileReplicaStore(join(dataDir, "projects"))
      .recover("project-private-account");
    const beforeProcessing = JSON.stringify(replica.getMap("nodes").toJSON());
    expect(beforeProcessing).not.toContain("private-account");
    expect(beforeProcessing).not.toContain("providerAccountId");
    expect(beforeProcessing).not.toContain("provider_id");
    await expect(
      createProviderExecutionHandoffStore(dataDir).load(
        "project-private-account",
        execution.childNodeId,
      ),
    ).resolves.toMatchObject({ accountId: "private-account" });

    const planner = vi.fn(
      async (
        input: Parameters<
          NonNullable<ExternalAigcService["planProviderPlugin"]>
        >[0],
      ) => ({
        ...plan,
        accountId: input.providerAccountId,
        kind: "image" as const,
        projectId: "project-private-account",
        nodeId: execution.childNodeId,
        input: {
          values: {
            modelId: input.model,
            upstreamModel: "image-v1",
            prompt: input.prompt,
            modelParams: input.modelParams ?? {},
          },
          references: [],
        },
      }),
    );
    const processor = createLocalWorkflowProcessor({
      dataDir,
      modelCards: async () => [],
      aigc: aigc(planner),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: async () => ({
          status: "accepted",
          binding,
          pollState: { taskId: "provider-task" },
          retryAfterMs: 5_000,
        }),
        now: () => 100,
      },
    });

    await processor.process({
      doc: replica,
      projectId: "project-private-account",
    });

    expect(planner).toHaveBeenCalledWith(
      expect.objectContaining({
        providerAccountId: "private-account",
        modelParams: expect.not.objectContaining({ provider_id: expect.anything() }),
      }),
      "image",
    );
    await expect(createSqliteDurableRunJournal(dataDir).load({
      actionRunId: `project:project-private-account:node:${execution.childNodeId}`,
      outputSlot: "media",
    })).resolves.toMatchObject({
      executorInput: { accountId: "private-account" },
    });
    const afterProcessing = JSON.stringify(replica.getMap("nodes").toJSON());
    expect(afterProcessing).not.toContain("private-account");
    expect(afterProcessing).not.toContain("providerAccountId");
    expect(afterProcessing).not.toContain("provider_id");
  });

  it("does not route from a legacy provider_id stored in Project Loro", async () => {
    const dataDir = await temporaryDataDir();
    const doc = pendingDoc();
    const nodes = doc.getMap("nodes");
    const node = nodes.get("node-1") as Record<string, any>;
    nodes.set("node-1", {
      ...node,
      data: {
        ...node.data,
        modelParams: {
          provider_id: "legacy-private-account",
          require_real_provider: true,
        },
      },
    });
    const planner = vi.fn(async () => plan);
    const processor = createLocalWorkflowProcessor({
      dataDir,
      aigc: aigc(planner),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: async () => ({
          status: "accepted",
          binding,
          pollState: { taskId: "provider-task" },
          retryAfterMs: 5_000,
        }),
      },
    });

    await processor.process({ doc, projectId: "project-1" });

    expect(planner).toHaveBeenCalledWith(
      expect.objectContaining({
        modelParams: { require_real_provider: true },
      }),
      "video",
    );
    expect(JSON.stringify(nodes.toJSON())).not.toContain(
      "legacy-private-account",
    );
  });

  it("persists private execution state before submit and resumes from SQLite without resubmitting", async () => {
    const dataDir = await temporaryDataDir();
    const now = { value: 100 };
    const requests: Parameters<ProviderPluginExecutor>[0][] = [];
    const firstExecutor: ProviderPluginExecutor = async (request) => {
      requests.push(structuredClone(request));
      return {
        status: "accepted",
        binding,
        pollState: { providerTask: "task-1" },
        retryAfterMs: 5,
      };
    };
    const firstPlanner = vi.fn(async () => plan);
    const doc = pendingDoc();
    const first = createLocalWorkflowProcessor({
      dataDir,
      aigc: aigc(firstPlanner),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: firstExecutor,
        now: () => now.value,
      },
    });

    await expect(first.process({ doc, projectId: "project-1" })).resolves.toBe(true);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      taskId: "project:project-1:node:node-1:media",
      binding,
      accountId: "private-account",
      input: plan.input,
    });
    expect(requests[0]).not.toHaveProperty("pollState");
    const generating = doc.getMap("nodes").get("node-1") as Record<string, any>;
    expect(generating.data).toMatchObject({ status: "generating" });
    for (const field of [
      "providerPollState",
      "providerPollAt",
      "providerAcceptedAt",
      "providerDeadlineAt",
      "providerFinalPolledAt",
      "providerAccountId",
    ]) {
      expect(generating.data).not.toHaveProperty(field);
    }
    const identity = {
      actionRunId: "project:project-1:node:node-1",
      outputSlot: "media",
    };
    await expect(createSqliteDurableRunJournal(dataDir).load(identity)).resolves.toMatchObject({
      phase: "polling",
      pollState: { providerTask: "task-1" },
      executorInput: {
        binding,
        accountId: "private-account",
        projectId: "project-1",
        nodeId: "node-1",
        input: plan.input,
      },
    });
    await expect(first.nextWakeAt!("project-1")).resolves.toBe(105);

    now.value = 106;
    const staged = await createLocalPluginAssetStagingStore({ dataDir }).stage({
      projectId: "project-1",
      taskId: "project:project-1:node:node-1:media",
      slot: "media",
      pluginId: binding.pluginId,
      pluginVersion: binding.version,
      invocationId: "provider-poll-result",
      kind: "video",
      mediaType: "video/mp4",
      bytes: new Uint8Array([0, 0, 0, 24]),
    });
    const reopenedPlanner = vi.fn(async () => plan);
    const reopenedExecutor: ProviderPluginExecutor = async (request) => {
      requests.push(structuredClone(request));
      return {
        status: "completed",
        binding,
        media: {
          assetId: staged.projectAssetId,
          uri: `clash-asset://${staged.projectAssetId}`,
          kind: "video",
          mediaType: "video/mp4",
        },
      };
    };
    const reopened = createLocalWorkflowProcessor({
      dataDir,
      aigc: aigc(reopenedPlanner),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: reopenedExecutor,
        now: () => now.value,
      },
    });

    await expect(reopened.process({ doc, projectId: "project-1" })).resolves.toBe(true);

    expect(reopenedPlanner).not.toHaveBeenCalled();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      taskId: "project:project-1:node:node-1:media",
      pollState: { providerTask: "task-1" },
      binding,
      accountId: "private-account",
    });
    const completed = doc.getMap("nodes").get("node-1") as Record<string, any>;
    expect(completed.data).toMatchObject({
      status: "completed",
      assetId: staged.projectAssetId,
    });
    expect(readProjectAsset(doc, completed.data.assetId)).toMatchObject({
      id: completed.data.assetId,
      source: { kind: "owned", resourceId: expect.stringMatching(/^sha256:/) },
      lifecycle: { state: "active" },
    });
    expect(listActionAssetReferences(doc, completed.data.assetId)).toEqual([
      expect.objectContaining({
        direction: "output",
        slot: "media",
        projectAssetId: completed.data.assetId,
        owner: expect.objectContaining({
          kind: "run",
          actionRunId: "project:project-1:node:node-1",
        }),
      }),
    ]);

    await expect(reopened.process({ doc, projectId: "project-1" })).resolves.toBe(false);
    expect(requests).toHaveLength(2);
    expect(listProjectAssets(doc).filter((asset) => asset.id === completed.data.assetId)).toHaveLength(1);
  });

  it("consumes a project-scoped plugin staging receipt without downloading local bytes over HTTP", async () => {
    const dataDir = await temporaryDataDir();
    const taskId = "project:project-1:node:node-1:media";
    const staged = await createLocalPluginAssetStagingStore({ dataDir }).stage({
      projectId: "project-1",
      taskId,
      slot: "media",
      pluginId: binding.pluginId,
      pluginVersion: binding.version,
      invocationId: "invoke-staged-provider-output",
      kind: "video",
      mediaType: "video/mp4",
      bytes: new Uint8Array([0, 0, 0, 24]),
    });
    const processor = createLocalWorkflowProcessor({
      dataDir,
      aigc: aigc(async () => plan),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: async () => ({
          status: "completed",
          binding,
          media: {
            assetId: staged.projectAssetId,
            uri: `clash-asset://${staged.projectAssetId}`,
            kind: "video",
            mediaType: "video/mp4",
          },
        }),
        now: () => 100,
      },
    });
    const doc = pendingDoc();

    await expect(processor.process({ doc, projectId: "project-1" })).resolves.toBe(true);

    expect(doc.getMap("nodes").get("node-1")).toMatchObject({
      data: { status: "completed", assetId: staged.projectAssetId },
    });
    expect(readProjectAsset(doc, staged.projectAssetId)).toMatchObject({
      id: staged.projectAssetId,
      source: { kind: "owned", resourceId: staged.resourceId },
    });
    expect(listActionAssetReferences(doc, staged.projectAssetId)).toEqual([
      expect.objectContaining({
        direction: "output",
        projectAssetId: staged.projectAssetId,
        owner: expect.objectContaining({ actionRunId: "project:project-1:node:node-1" }),
      }),
    ]);
  });

  it("does not publish a partial Project Asset when its output binding identity conflicts", async () => {
    const dataDir = await temporaryDataDir();
    const taskId = "project:project-1:node:node-1:media";
    const staged = await createLocalPluginAssetStagingStore({ dataDir }).stage({
      projectId: "project-1",
      taskId,
      slot: "media",
      pluginId: binding.pluginId,
      pluginVersion: binding.version,
      invocationId: "invoke-conflicting-output",
      kind: "video",
      mediaType: "video/mp4",
      bytes: new Uint8Array([0, 0, 0, 24]),
    });
    const doc = pendingDoc();
    expect(
      createProjectAsset(doc, {
        id: "existing-output",
        kind: "video",
        source: { kind: "owned", resourceId: `sha256:${"e".repeat(64)}` },
        lifecycle: { state: "active" },
        metadata: {},
      }),
    ).toMatchObject({ ok: true });
    expect(
      createActionAssetBinding(doc, {
        id: `action-asset:${taskId}:output`,
        owner: { kind: "draft", actionId: "different-action" },
        direction: "output",
        slot: "different-slot",
        projectAssetId: "existing-output",
      }),
    ).toMatchObject({ ok: true });
    const processor = createLocalWorkflowProcessor({
      dataDir,
      aigc: aigc(async () => plan),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: async () => ({
          status: "completed",
          binding,
          media: {
            assetId: staged.projectAssetId,
            uri: `clash-asset://${staged.projectAssetId}`,
            kind: "video",
            mediaType: "video/mp4",
          },
        }),
        now: () => 100,
      },
    });

    await expect(
      processor.process({ doc, projectId: "project-1" }),
    ).resolves.toBe(true);

    expect(readProjectAsset(doc, staged.projectAssetId)).toBeNull();
  });

  it("re-checkpoints an already projected node before marking the journal succeeded", async () => {
    const dataDir = await temporaryDataDir();
    const now = { value: 100 };
    const imagePlan: ProviderPluginExecutionPlan = {
      ...plan,
      kind: "image",
      input: {
        values: {
          modelId: "test-image",
          upstreamModel: "image-v1",
          prompt: "A paper city",
          modelParams: {},
        },
        references: [],
      },
    };
    const staged = await createLocalPluginAssetStagingStore({ dataDir }).stage({
      projectId: "project-1",
      taskId: "project:project-1:node:node-1:media",
      slot: "media",
      pluginId: binding.pluginId,
      pluginVersion: binding.version,
      invocationId: "image-provider-result",
      kind: "image",
      mediaType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    const execute = vi.fn<ProviderPluginExecutor>(async () => ({
      status: "completed",
      binding,
      media: {
        assetId: staged.projectAssetId,
        uri: `clash-asset://${staged.projectAssetId}`,
        kind: "image",
        mediaType: "image/png",
      },
    }));
    const doc = new LoroDoc();
    doc.getMap("nodes").set("node-1", {
      id: "node-1",
      type: "image",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "image-gen",
        modelId: "test-image",
        prompt: "A paper city",
      },
    });
    let completedCheckpoints = 0;
    const checkpoint = vi.fn(async () => {
      const node = doc.getMap("nodes").get("node-1") as Record<string, any>;
      if (node.data.status !== "completed") return;
      completedCheckpoints += 1;
      if (completedCheckpoints === 1) throw new Error("snapshot write interrupted");
    });
    const processor = createLocalWorkflowProcessor({
      dataDir,
      aigc: aigc(async () => imagePlan),
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: execute,
        now: () => now.value,
      },
    });
    const identity = {
      actionRunId: "project:project-1:node:node-1",
      outputSlot: "media",
    };

    await processor.process({ doc, projectId: "project-1", checkpoint });
    expect(completedCheckpoints).toBe(1);
    await expect(createSqliteDurableRunJournal(dataDir).load(identity)).resolves.toMatchObject({
      phase: "finalizing",
    });

    now.value = 1_101;
    await processor.process({ doc, projectId: "project-1", checkpoint });

    expect(completedCheckpoints).toBe(2);
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(createSqliteDurableRunJournal(dataDir).load(identity)).resolves.toMatchObject({
      phase: "succeeded",
      projectedAt: 1_101,
    });
    expect(listProjectAssets(doc)).toEqual([
      expect.objectContaining({
        id: staged.projectAssetId,
        source: {
          kind: "owned",
          resourceId: expect.stringMatching(/^sha256:/),
        },
      }),
    ]);
  });
});
