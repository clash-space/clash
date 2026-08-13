import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ProjectAssetHostClient,
  ProjectAssetHostObservation,
  ProjectAssetHostResult,
} from "@clash/shared-runtime/project-asset-client";
import type { ActionAssetBinding, ResolvedAsset } from "@clash/shared-types";

const asset: ResolvedAsset = {
  id: "asset:one",
  kind: "audio",
  name: "voice.mp3",
  metadata: { bytes: 3, contentType: "audio/mpeg" },
  provenance: { kind: "import" },
  lifecycle: { state: "active" },
  status: "ready",
  url: "http://127.0.0.1:8789/api/v1/projects/project-a/assets/asset%3Aone/media",
};

const trashedAsset: ResolvedAsset = {
  ...asset,
  lifecycle: {
    state: "trashed",
    deleteOperationId: "delete:asset:one",
    deletedAt: "2026-08-13T00:00:00.000Z",
    purgeAfter: "2026-09-12T00:00:00.000Z",
  },
  status: "unavailable",
};

const globalAsset: ResolvedAsset = {
  ...asset,
  id: "global:one",
  url: "http://127.0.0.1:8789/api/v1/libraries/personal/assets/global%3Aone/media",
};

function fakeClient(
  calls: Array<{ method: string; input: unknown }>,
): ProjectAssetHostClient {
  const result = <T>(value: T): ProjectAssetHostResult<T> => ({
    projectId: "project-a",
    value,
  });
  const observed = <T>(
    value: T,
    receipt: string,
  ): ProjectAssetHostObservation<T> => ({
    ...result(value),
    receipt,
  });
  return {
    resolveContext: async ({ cwd } = {}) => ({
      projectId: "project-a",
      source: "marker",
      ...(cwd ? { workspaceRoot: cwd } : {}),
    }),
    async list(input) {
      calls.push({ method: "list", input });
      return result([asset]);
    },
    async batch(input) {
      calls.push({ method: "batch", input });
      return result(input.assetIds.includes(asset.id) ? [asset] : []);
    },
    async get(input) {
      calls.push({ method: "get", input });
      return observed(asset, "receipt-read");
    },
    async references(input) {
      calls.push({ method: "references", input });
      return observed([] as ActionAssetBinding[], "receipt-references");
    },
    async importFile(input) {
      calls.push({ method: "importFile", input });
      return result(asset);
    },
    async admit(input) {
      calls.push({ method: "admit", input });
      return result(asset);
    },
    async trash(input) {
      calls.push({ method: "trash", input });
      return observed(trashedAsset, "receipt-trashed");
    },
    async restore(input) {
      calls.push({ method: "restore", input });
      return observed(asset, "receipt-restored");
    },
  };
}

test("MCP Project Asset mutations consume an internal Host receipt and never expose it", async () => {
  const { createAssetProjectHostGateway } = await import("./asset-gateway");
  const calls: Array<{ method: string; input: any }> = [];
  const gateway = createAssetProjectHostGateway(fakeClient(calls));

  assert.deepEqual(
    await gateway.invoke("clash_assets_get", {
      projectId: "project-a",
      assetId: "asset:one",
    }),
    asset,
  );
  assert.deepEqual(
    await gateway.invoke("clash_assets_trash", {
      projectId: "project-a",
      assetId: "asset:one",
    }),
    trashedAsset,
  );
  assert.deepEqual(calls, [
    { method: "get", input: { projectId: "project-a", assetId: "asset:one" } },
    {
      method: "trash",
      input: {
        projectId: "project-a",
        assetId: "asset:one",
        actorClientType: "mcp",
        receipt: "receipt-read",
      },
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(
      await gateway.invoke("clash_assets_get", {
        projectId: "project-a",
        assetId: "asset:one",
      }),
    ),
    /receipt|readToken|ifMatch/i,
  );
});

test("MCP Project Asset mutation fails locally until get or references observed that Asset", async () => {
  const { createAssetProjectHostGateway } = await import("./asset-gateway");
  const calls: Array<{ method: string; input: unknown }> = [];
  const gateway = createAssetProjectHostGateway(fakeClient(calls));

  await assert.rejects(
    gateway.invoke("clash_assets_restore", {
      projectId: "project-a",
      assetId: "asset:one",
    }),
    /READ_REQUIRED.*clash_assets_(?:get|references)/i,
  );
  assert.deepEqual(calls, []);
});

test("MCP references authorizes restore and rotates the private observation", async () => {
  const { createAssetProjectHostGateway } = await import("./asset-gateway");
  const calls: Array<{ method: string; input: any }> = [];
  const gateway = createAssetProjectHostGateway(fakeClient(calls));

  assert.deepEqual(
    await gateway.invoke("clash_assets_references", {
      projectId: "project-a",
      assetId: "asset:one",
    }),
    { projectAssetId: "asset:one", references: [] },
  );
  assert.deepEqual(
    await gateway.invoke("clash_assets_restore", {
      projectId: "project-a",
      assetId: "asset:one",
    }),
    asset,
  );
  assert.deepEqual(calls, [
    {
      method: "references",
      input: { projectId: "project-a", assetId: "asset:one" },
    },
    {
      method: "restore",
      input: {
        projectId: "project-a",
        assetId: "asset:one",
        actorClientType: "mcp",
        receipt: "receipt-references",
      },
    },
  ]);
});

test("MCP imports a local workspace file through Host import-file without CLI execution", async () => {
  const { createAssetProjectHostGateway } = await import("./asset-gateway");
  const workspace = await mkdtemp(join(tmpdir(), "clash-mcp-assets-"));
  const filePath = join(workspace, "voice.mp3");
  await writeFile(filePath, new Uint8Array([4, 5, 6]));
  const calls: Array<{ method: string; input: any }> = [];
  const gateway = createAssetProjectHostGateway(fakeClient(calls));

  assert.deepEqual(
    await gateway.invoke("clash_assets_import_file", {
      cwd: workspace,
      filePath: "voice.mp3",
    }),
    asset,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "importFile");
  assert.deepEqual(
    {
      projectId: calls[0]?.input.projectId,
      kind: calls[0]?.input.kind,
      fileName: calls[0]?.input.fileName,
      contentType: calls[0]?.input.contentType,
      bytes: Array.from(calls[0]?.input.bytes ?? []),
    },
    {
      projectId: "project-a",
      kind: "audio",
      fileName: "voice.mp3",
      contentType: "audio/mpeg",
      bytes: [4, 5, 6],
    },
  );
});

test("MCP lists and reads the personal Global library without requiring Project context", async () => {
  const { createAssetProjectHostGateway } = await import("./asset-gateway");
  const projectCalls: Array<{ method: string; input: unknown }> = [];
  const globalCalls: Array<{ method: string; input?: unknown }> = [];
  const projectClient = fakeClient(projectCalls);
  projectClient.resolveContext = async () => {
    throw new Error("Global library reads must not resolve a Project");
  };
  const gateway = createAssetProjectHostGateway(projectClient, {
    async list() {
      globalCalls.push({ method: "list" });
      return [globalAsset];
    },
    async get(input: { globalAssetId: string }) {
      globalCalls.push({ method: "get", input });
      return globalAsset;
    },
  } as never) as unknown as {
    invoke(name: string, input: Record<string, unknown>): Promise<unknown>;
  };

  assert.deepEqual(await gateway.invoke("clash_assets_global_list", {}), [
    globalAsset,
  ]);
  assert.deepEqual(
    await gateway.invoke("clash_assets_global_get", {
      globalAssetId: "global:one",
    }),
    globalAsset,
  );
  assert.deepEqual(projectCalls, []);
  assert.deepEqual(globalCalls, [
    { method: "list" },
    { method: "get", input: { globalAssetId: "global:one" } },
  ]);
});

test("MCP imports a local file directly into the personal Global library", async () => {
  const { createAssetProjectHostGateway } = await import("./asset-gateway");
  const workspace = await mkdtemp(join(tmpdir(), "clash-mcp-global-assets-"));
  const filePath = join(workspace, "voice.mp3");
  await writeFile(filePath, new Uint8Array([7, 8, 9]));
  const globalCalls: Array<{ method: string; input: any }> = [];
  const gateway = createAssetProjectHostGateway(fakeClient([]), {
    async importFile(input: any) {
      globalCalls.push({ method: "importFile", input });
      return globalAsset;
    },
  } as never) as unknown as {
    invoke(name: string, input: Record<string, unknown>): Promise<unknown>;
  };

  assert.deepEqual(
    await gateway.invoke("clash_assets_global_import_file", {
      cwd: workspace,
      filePath: "voice.mp3",
    }),
    globalAsset,
  );
  assert.equal(globalCalls.length, 1);
  assert.deepEqual(
    {
      method: globalCalls[0]?.method,
      kind: globalCalls[0]?.input.kind,
      fileName: globalCalls[0]?.input.fileName,
      contentType: globalCalls[0]?.input.contentType,
      bytes: Array.from(globalCalls[0]?.input.bytes ?? []),
    },
    {
      method: "importFile",
      kind: "audio",
      fileName: "voice.mp3",
      contentType: "audio/mpeg",
      bytes: [7, 8, 9],
    },
  );
});

test("MCP admits Global Assets and publishes Project Assets through the shared Host clients", async () => {
  const { createAssetProjectHostGateway } = await import("./asset-gateway");
  const calls: Array<{ method: string; input: unknown }> = [];
  const projectClient = fakeClient(calls) as ProjectAssetHostClient & {
    admit(input: unknown): Promise<ProjectAssetHostResult<ResolvedAsset>>;
  };
  projectClient.admit = async (input) => {
    calls.push({ method: "admit", input });
    return { projectId: "project-a", value: asset };
  };
  const gateway = createAssetProjectHostGateway(projectClient, {
    async publish(input: unknown) {
      calls.push({ method: "publish", input });
      return globalAsset;
    },
  } as never) as unknown as {
    invoke(name: string, input: Record<string, unknown>): Promise<unknown>;
  };

  assert.deepEqual(
    await gateway.invoke("clash_assets_admit", {
      projectId: "project-a",
      globalAssetId: "global:one",
    }),
    asset,
  );
  assert.deepEqual(
    await gateway.invoke("clash_assets_publish", {
      projectId: "project-a",
      projectAssetId: "asset:one",
    }),
    globalAsset,
  );
  assert.deepEqual(calls, [
    {
      method: "admit",
      input: { projectId: "project-a", globalAssetId: "global:one" },
    },
    {
      method: "publish",
      input: { projectId: "project-a", projectAssetId: "asset:one" },
    },
  ]);
});
