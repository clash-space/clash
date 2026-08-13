import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  listActionAssetReferences,
  listProjectAssets,
  readProjectAsset,
} from "@clash/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalApiApp } from "./app.js";
import { createSqliteDurableRunJournal } from "./durable-run-journal.js";
import type { ProviderPluginExecutor } from "./local-aigc.js";
import { createLocalPluginAssetStagingStore } from "./local-plugin-asset-staging.js";
import { createLocalWorkflowProcessor } from "./local-processor.js";
import { FileReplicaStore } from "./loro/file-replica-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const binding = {
  pluginId: "clash.fal",
  version: "0.1.0",
  exportId: "fal-execute",
  schemaHash: `sha256:${"f".repeat(64)}`,
} as const;

describe("Director durable model generation", () => {
  it("resumes by polling once and idempotently publishes a staged GLB after a checkpoint crash", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-director-durable-"));
    temporaryDirectories.push(root);
    const dataDir = join(root, "local-api");
    const actionRunId = "director:durable-model-1";
    const processProjectWork = vi.fn(async () => undefined);
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      resolvePluginBinding: async () => binding,
      processProjectWork,
      projectAssetProjectionOrigin: "http://127.0.0.1:49152",
    });

    const createdProject = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Durable Director model" }),
    });
    expect(createdProject.status).toBe(201);
    const { id: projectId } = (await createdProject.json()) as { id: string };
    const configured = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "fal-director",
            providerId: "fal",
            upstreamId: "fal",
            enabled: true,
            priority: 1,
            credentials: { apiKey: "must-never-leak" },
          },
        ],
      }),
    });
    expect(configured.status, await configured.clone().text()).toBe(200);

    const staged = await createLocalPluginAssetStagingStore({ dataDir }).stage({
      projectId,
      taskId: `${actionRunId}:media`,
      slot: "media",
      pluginId: binding.pluginId,
      pluginVersion: binding.version,
      invocationId: "fal-hunyuan-poll-1",
      kind: "model",
      mediaType: "model/gltf-binary",
      bytes: new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]),
    });

    const accepted = await app.request("/api/v1/director-model-generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionRunId,
        projectId,
        prompt: "A chestnut horse",
        quality: "low-poly",
      }),
    });
    expect(accepted.status, await accepted.clone().text()).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({
      status: "queued",
      actionRunId,
      statusUrl: expect.stringContaining("director%3Adurable-model-1"),
    });
    expect(processProjectWork).toHaveBeenCalledWith(projectId);

    const now = { value: Date.now() };
    const providerRequests: Parameters<ProviderPluginExecutor>[0][] = [];
    const submit: ProviderPluginExecutor = async (request) => {
      providerRequests.push(structuredClone(request));
      return {
        status: "accepted",
        binding,
        pollState: { requestId: "fal-request-1" },
        retryAfterMs: 5,
      };
    };
    const replicaStore = new FileReplicaStore(join(dataDir, "projects"));
    const submittedDoc = await replicaStore.recover(projectId);
    const submitProcessor = createLocalWorkflowProcessor({
      dataDir,
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: submit,
        now: () => now.value,
      },
    });

    await submitProcessor.process({ doc: submittedDoc, projectId });
    expect(providerRequests).toEqual([
      expect.objectContaining({
        taskId: `${actionRunId}:media`,
        accountId: "fal-director",
        kind: "model",
        binding,
      }),
    ]);
    expect(providerRequests[0]).not.toHaveProperty("pollState");

    now.value += 6;
    const poll: ProviderPluginExecutor = async (request) => {
      providerRequests.push(structuredClone(request));
      return {
        status: "completed",
        binding,
        media: {
          assetId: staged.projectAssetId,
          uri: `clash-asset://${staged.projectAssetId}`,
          kind: "model",
          mediaType: "model/gltf-binary",
        },
      };
    };
    const polledDoc = await replicaStore.recover(projectId);
    let failedPublicationCheckpoint = false;
    const pollProcessor = createLocalWorkflowProcessor({
      dataDir,
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: poll,
        now: () => now.value,
      },
    });

    await expect(
      pollProcessor.process({
        doc: polledDoc,
        projectId,
        checkpoint: async () => {
          if (!readProjectAsset(polledDoc, staged.projectAssetId)) return;
          failedPublicationCheckpoint = true;
          throw new Error("snapshot write interrupted");
        },
      }),
    ).resolves.toBe(true);
    expect(failedPublicationCheckpoint).toBe(true);
    expect(providerRequests[1]).toMatchObject({
      taskId: `${actionRunId}:media`,
      pollState: { requestId: "fal-request-1" },
      binding,
    });
    expect(providerRequests).toHaveLength(2);
    await expect(
      createSqliteDurableRunJournal(dataDir).load({
        actionRunId,
        outputSlot: "media",
      }),
    ).resolves.toMatchObject({ phase: "finalizing" });

    const recoveredDoc = await replicaStore.recover(projectId);
    expect(readProjectAsset(recoveredDoc, staged.projectAssetId)).toBeNull();
    now.value += 1_001;
    const unexpectedProviderCall = vi.fn<ProviderPluginExecutor>(async () => {
      throw new Error("finalization recovery must not call the Provider");
    });
    const recoveredProcessor = createLocalWorkflowProcessor({
      dataDir,
      durableProviderRuns: {
        ownerId: "local-api",
        providerPluginExecutor: unexpectedProviderCall,
        now: () => now.value,
      },
    });

    await expect(
      recoveredProcessor.process({
        doc: recoveredDoc,
        projectId,
        checkpoint: async () => {
          await replicaStore.saveSnapshotAtomic(
            projectId,
            recoveredDoc.export({ mode: "snapshot" }),
          );
        },
      }),
    ).resolves.toBe(true);
    expect(unexpectedProviderCall).not.toHaveBeenCalled();

    const published = readProjectAsset(recoveredDoc, staged.projectAssetId);
    expect(published).toMatchObject({
      id: staged.projectAssetId,
      kind: "model",
      name: "generated-model.glb",
      source: { kind: "owned", resourceId: staged.resourceId },
      lifecycle: { state: "active" },
      metadata: {
        contentType: "model/gltf-binary",
        originalName: "generated-model.glb",
      },
      provenance: {
        kind: "generation",
        actionRunId,
        model: "fal-ai/hunyuan3d-v3/text-to-3d",
        prompt: "A chestnut horse",
      },
    });
    expect(
      listProjectAssets(recoveredDoc).filter(
        (asset) => asset.id === staged.projectAssetId,
      ),
    ).toHaveLength(1);
    expect(listActionAssetReferences(recoveredDoc, staged.projectAssetId)).toEqual([
      expect.objectContaining({
        direction: "output",
        slot: "media",
        projectAssetId: staged.projectAssetId,
        owner: expect.objectContaining({
          kind: "run",
          actionId: "director:model-generation",
          actionRunId,
        }),
      }),
    ]);

    const journalRun = await createSqliteDurableRunJournal(dataDir).load({
      actionRunId,
      outputSlot: "media",
    });
    expect(journalRun).toMatchObject({
      phase: "succeeded",
      projectedAt: now.value,
    });
    expect(JSON.stringify(journalRun)).not.toMatch(
      /must-never-leak|credentials|https?:\/\/|r2Key|storageKey/i,
    );

    const status = await app.request(
      `/api/v1/director-model-generations/${encodeURIComponent(actionRunId)}` +
        `?projectId=${encodeURIComponent(projectId)}`,
    );
    expect(status.status, await status.clone().text()).toBe(200);
    const publicResult = await status.json();
    expect(publicResult).toMatchObject({
      status: "completed",
      actionRunId,
      provider: "fal",
      modelEndpoint: "fal-ai/hunyuan3d-v3/text-to-3d",
      asset: {
        id: staged.projectAssetId,
        kind: "model",
        name: "generated-model.glb",
        status: "ready",
        url: expect.stringContaining(
          `/api/v1/projects/${projectId}/assets/${encodeURIComponent(staged.projectAssetId)}/media`,
        ),
      },
    });
    expect(JSON.stringify(publicResult)).not.toMatch(
      /must-never-leak|credentials|resourceId|r2Key|storageKey/i,
    );
  });
});
