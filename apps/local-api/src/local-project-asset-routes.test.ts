import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import {
  createActionAssetBinding,
  listActionAssetReferences,
  readProjectAsset,
} from "@clash/shared-types";

import { createLocalApiApp } from "./app.js";
import { createSqliteDurableRunJournal } from "./durable-run-journal.js";
import {
  createLocalProjectAssetService,
  type LocalProjectAssetReplica,
} from "./local-project-assets.js";
import { FileReplicaStore } from "./loro/file-replica-store.js";
import { LocalLoroRoomHub } from "./sync.js";

const temporaryDirectories: string[] = [];
const PROJECT_ASSET_RECEIPT_RE =
  /^project-asset-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;

async function fixture() {
  const clashRoot = await mkdtemp(
    join(tmpdir(), "clash-project-asset-routes-"),
  );
  temporaryDirectories.push(clashRoot);
  const dataDir = join(clashRoot, "local-api");
  const service = createLocalProjectAssetService({
    dataDir,
    clashRoot,
    projectionOrigin: "http://seed.invalid",
  });
  const asset = await service.installOwned({
    projectId: "project-a",
    projectAssetId: "result:one",
    kind: "audio",
    bytes: new TextEncoder().encode("0123456789"),
    contentType: "audio/mpeg",
    name: "result.unusual",
    metadata: { durationMs: 2_000 },
    provenance: { kind: "generation", actionRunId: "run-1" },
  });
  const appOptions = {
    dataDir,
    clashRoot,
    userId: "local-user",
    projectAssetProjectionOrigin: () => "http://127.0.0.1:49152",
  };
  return {
    app: createLocalApiApp(appOptions),
    asset,
    clashRoot,
    dataDir,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Project-scoped ResolvedAsset routes", () => {
  it("commits HTTP Asset lifecycle writes through the open Project room", async () => {
    const clashRoot = await mkdtemp(
      join(tmpdir(), "clash-project-asset-live-room-"),
    );
    temporaryDirectories.push(clashRoot);
    const dataDir = join(clashRoot, "local-api");
    const projectId = "live-project";
    const hub = new LocalLoroRoomHub(dataDir, undefined, null);
    const room = await hub.room(projectId);
    const peer = new LoroDoc();
    room.addPeer((update) => peer.import(update));

    const replica: LocalProjectAssetReplica = {
      inspect: (id, read) => hub.inspectProject(id, read),
      mutate: (id, mutation) => hub.mutateProject(id, mutation),
    };
    const app = createLocalApiApp({
      dataDir,
      clashRoot,
      userId: "local-user",
      projectAssetProjectionOrigin: "http://127.0.0.1:49152",
      projectAssetReplica: replica,
    });

    const bytes = new TextEncoder().encode("live room image");
    const collectionUrl = `http://127.0.0.1:49152/api/v1/projects/${projectId}/assets`;
    const assetUrl = `${collectionUrl}/live%3Aasset`;

    const form = new FormData();
    form.set("file", new File([bytes], "live.png", { type: "image/png" }));
    form.set("kind", "image");
    form.set("projectAssetId", "live:asset");

    const imported = await app.request(`${collectionUrl}/import-file`, {
      method: "POST",
      body: form,
    });
    expect(imported.status).toBe(201);
    expect(readProjectAsset(peer, "live:asset")?.lifecycle).toEqual({
      state: "active",
    });

    const trashed = await app.request(assetUrl, { method: "DELETE" });
    expect(trashed.status, await trashed.clone().text()).toBe(200);
    expect(readProjectAsset(peer, "live:asset")?.lifecycle.state).toBe(
      "trashed",
    );

    const restored = await app.request(`${assetUrl}/restore`, {
      method: "POST",
    });
    expect(restored.status).toBe(200);
    expect(readProjectAsset(peer, "live:asset")?.lifecycle).toEqual({
      state: "active",
    });
  });

  it("lists and reads the same storage-free ResolvedAsset shape at the configured Host origin", async () => {
    const { app, asset } = await fixture();
    const baseUrl = "http://127.0.0.1:49152/api/v1/projects/project-a/assets";
    const mediaUrl = `${baseUrl}/${encodeURIComponent(asset.id)}/media`;
    const expected = {
      id: "result:one",
      kind: "audio",
      name: "result.unusual",
      metadata: {
        durationMs: 2_000,
        bytes: 10,
        contentType: "audio/mpeg",
        originalName: "result.unusual",
      },
      provenance: { kind: "generation", actionRunId: "run-1" },
      lifecycle: { state: "active" },
      status: "ready",
      url: mediaUrl,
      thumbnailUrl: mediaUrl,
    };

    const listed = await app.request(
      "http://localhost:49152/api/v1/projects/project-a/assets",
    );
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({
      assets: [expected],
    });

    const read = await app.request(
      `${baseUrl}/${encodeURIComponent(asset.id)}`,
    );
    expect(read.status).toBe(200);
    expect(read.headers.get("x-clash-read-receipt")).toMatch(
      PROJECT_ASSET_RECEIPT_RE,
    );
    expect(await read.json()).toEqual(expected);
  });

  it("serves the immutable projection with Resource content type and byte ranges", async () => {
    const { app, asset } = await fixture();
    const mediaUrl = `http://127.0.0.1:49152/api/v1/projects/project-a/assets/${encodeURIComponent(asset.id)}/media`;

    const full = await app.request(mediaUrl);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("audio/mpeg");
    expect(full.headers.get("content-length")).toBe("10");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    await expect(full.text()).resolves.toBe("0123456789");

    const partial = await app.request(mediaUrl, {
      headers: { range: "bytes=2-5" },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-type")).toBe("audio/mpeg");
    expect(partial.headers.get("content-length")).toBe("4");
    expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
    await expect(partial.text()).resolves.toBe("2345");

    const unsatisfiable = await app.request(mediaUrl, {
      headers: { range: "bytes=99-100" },
    });
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get("content-range")).toBe("bytes */10");
  });

  it("batch reads only requested Asset entries from the selected Project", async () => {
    const { app, asset } = await fixture();
    const baseUrl = "http://127.0.0.1:49152/api/v1/projects/project-a/assets";

    const response = await app.request(`${baseUrl}/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["missing", asset.id, asset.id] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assets: [
        expect.objectContaining({
          id: "result:one",
          kind: "audio",
          status: "ready",
          url: `${baseUrl}/${encodeURIComponent(asset.id)}/media`,
        }),
      ],
    });
  });

  it("imports multipart bytes idempotently under an explicit Project Asset id", async () => {
    const { app } = await fixture();
    const url =
      "http://127.0.0.1:49152/api/v1/projects/project-a/assets/import-file";
    const request = () => {
      const form = new FormData();
      form.set(
        "file",
        new File(["multipart image"], "hero.png", { type: "image/png" }),
      );
      form.set("kind", "image");
      form.set("projectAssetId", "imported:multipart");
      return app.request(url, { method: "POST", body: form });
    };

    const first = await request();
    const second = await request();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const expected = {
      id: "imported:multipart",
      kind: "image",
      name: "hero.png",
      metadata: {
        bytes: 15,
        contentType: "image/png",
        originalName: "hero.png",
      },
      provenance: { kind: "import" },
      lifecycle: { state: "active" },
      status: "ready",
      url: "http://127.0.0.1:49152/api/v1/projects/project-a/assets/imported%3Amultipart/media",
      thumbnailUrl:
        "http://127.0.0.1:49152/api/v1/projects/project-a/assets/imported%3Amultipart/media",
    };
    await expect(first.json()).resolves.toEqual(expected);
    await expect(second.json()).resolves.toEqual(expected);
    expect(JSON.stringify(expected)).not.toMatch(
      /storageKey|localBlobKey|signedUrl|\/Users\//,
    );
  });

  it("publishes edit outputs as ResolvedAsset and records Action input/output bindings", async () => {
    const { app, dataDir } = await fixture();
    const importForm = new FormData();
    importForm.set(
      "file",
      new File(["source image"], "source.png", { type: "image/png" }),
    );
    importForm.set("kind", "image");
    importForm.set("projectAssetId", "source:image");
    const imported = await app.request(
      "http://127.0.0.1:49152/api/v1/projects/project-a/assets/import-file",
      { method: "POST", body: importForm },
    );
    expect(imported.status).toBe(201);

    const invocation = {
      actionId: "image-editor",
      projectId: "project-a",
      source: { assetId: "source:image", kind: "image" },
      params: { rotation: 90 },
      surface: "asset-preview",
      mode: "implicit",
    };
    const editForm = new FormData();
    editForm.set(
      "file",
      new File(["edited image"], "edited.png", { type: "image/png" }),
    );
    editForm.set("projectId", "project-a");
    editForm.set("sourceAssetId", "source:image");
    editForm.set("editKind", "image-editor");
    editForm.set("outputKind", "image");
    editForm.set("editParams", JSON.stringify(invocation.params));
    editForm.set("origin", "asset-preview");
    editForm.set("invocation", JSON.stringify(invocation));

    const response = await app.request("/api/v1/edits", {
      method: "POST",
      body: editForm,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const output = (await response.json()) as { id: string };
    expect(output).toMatchObject({
      id: expect.stringMatching(/^asset:/),
      kind: "image",
      name: "edited.png",
      provenance: {
        kind: "edit",
        actionRunId: expect.stringMatching(/^edit:/),
        model: "implicit:image-editor",
      },
      status: "ready",
      url: expect.stringContaining("/api/v1/projects/project-a/assets/"),
    });
    expect(JSON.stringify(output)).not.toMatch(
      /srcR2Key|storageKey|signedUrl|coverR2Key/,
    );

    const doc = await new FileReplicaStore(join(dataDir, "projects")).recover(
      "project-a",
    );
    expect(listActionAssetReferences(doc, "source:image")).toMatchObject([
      {
        direction: "input",
        slot: "source",
        projectAssetId: "source:image",
        role: "source",
      },
    ]);
    expect(listActionAssetReferences(doc, output.id)).toMatchObject([
      {
        direction: "output",
        slot: "output",
        projectAssetId: output.id,
        role: "primary",
      },
    ]);
  });

  it("enqueues Director generation through the shared durable Provider journal", async () => {
    const clashRoot = await mkdtemp(
      join(tmpdir(), "clash-director-project-asset-"),
    );
    temporaryDirectories.push(clashRoot);
    const dataDir = join(clashRoot, "local-api");
    let wakes = 0;
    const binding = {
      pluginId: "clash.fal",
      version: "0.1.0",
      exportId: "fal-execute",
      schemaHash: `sha256:${"a".repeat(64)}`,
    } as const;
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      resolvePluginBinding: async () => binding,
      processProjectWork: async () => {
        wakes += 1;
      },
      projectAssetProjectionOrigin: "http://127.0.0.1:49152",
    });
    const createdProject = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Generated Director models" }),
    });
    const { id: projectId } = (await createdProject.json()) as { id: string };
    await app.request("/api/v1/model-providers", {
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
            credentials: { apiKey: "fal-director-secret" },
          },
        ],
      }),
    });

    const response = await app.request("/api/v1/director-model-generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actionRunId: "director:request-1",
        projectId,
        prompt: "A chestnut horse",
        quality: "low-poly",
      }),
    });
    expect(response.status, await response.clone().text()).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "queued",
      actionRunId: "director:request-1",
      requestId: "director:request-1",
      statusUrl: expect.stringContaining("director%3Arequest-1"),
    });
    const journal = createSqliteDurableRunJournal(dataDir);
    const run = await journal.load({
      actionRunId: "director:request-1",
      outputSlot: "media",
    });
    expect(run).toMatchObject({
      phase: "queued",
      owner: { realm: "local", id: "local-api" },
      executorInput: {
        binding,
        accountId: "fal-director",
        kind: "model",
        projectId,
        delivery: {
          kind: "project-asset",
          actionId: "director:model-generation",
          name: "generated-model.glb",
          prompt: "A chestnut horse",
        },
      },
    });
    expect(JSON.stringify(run?.executorInput)).not.toMatch(
      /apiKey|fal-director-secret|credentials/,
    );

    const status = await app.request(
      `/api/v1/director-model-generations/director%3Arequest-1?projectId=${encodeURIComponent(projectId)}`,
    );
    expect(status.status).toBe(202);
    expect(wakes).toBeGreaterThanOrEqual(1);

    const conflict = await app.request(
      "/api/v1/director-model-generations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionRunId: "director:request-1",
          projectId,
          prompt: "A different model",
        }),
      },
    );
    expect(conflict.status).toBe(409);
  });

  it("creates distinct Project Asset identities while deduplicating identical Resources", async () => {
    const { app, dataDir } = await fixture();
    const url =
      "http://127.0.0.1:49152/api/v1/projects/project-a/assets/import-file";
    const request = () => {
      const form = new FormData();
      form.set(
        "file",
        new File(["same immutable bytes"], "same.png", {
          type: "image/png",
        }),
      );
      form.set("kind", "image");
      return app.request(url, { method: "POST", body: form });
    };

    const firstResponse = await request();
    const secondResponse = await request();
    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    const first = (await firstResponse.json()) as { id: string };
    const second = (await secondResponse.json()) as { id: string };
    expect(first.id).toMatch(/^asset:[0-9a-f-]{36}$/);
    expect(second.id).toMatch(/^asset:[0-9a-f-]{36}$/);
    expect(second.id).not.toBe(first.id);

    const doc = await new FileReplicaStore(join(dataDir, "projects")).recover(
      "project-a",
    );
    expect(readProjectAsset(doc, first.id)?.source).toEqual(
      readProjectAsset(doc, second.id)?.source,
    );
  });

  it("rejects empty, mismatched, and invalidly identified multipart imports", async () => {
    const { app } = await fixture();
    const url =
      "http://127.0.0.1:49152/api/v1/projects/project-a/assets/import-file";
    const requests: FormData[] = [];

    const empty = new FormData();
    empty.set("file", new File([], "empty.png", { type: "image/png" }));
    empty.set("kind", "image");
    requests.push(empty);

    const mismatched = new FormData();
    mismatched.set(
      "file",
      new File(["not a video"], "still.png", { type: "image/png" }),
    );
    mismatched.set("kind", "video");
    requests.push(mismatched);

    const invalidId = new FormData();
    invalidId.set(
      "file",
      new File(["image"], "still.png", { type: "image/png" }),
    );
    invalidId.set("kind", "image");
    invalidId.set("projectAssetId", " ");
    requests.push(invalidId);

    for (const form of requests) {
      const response = await app.request(url, { method: "POST", body: form });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "INVALID_PROJECT_ASSET_IMPORT",
      });
    }
  });

  it("lists Action references and rejects logical deletion while the Asset is in use", async () => {
    const { app, asset, dataDir } = await fixture();
    const replicas = new FileReplicaStore(join(dataDir, "projects"));
    await replicas.updateSnapshotAtomic("project-a", (doc) => {
      const result = createActionAssetBinding(doc, {
        id: "binding:timeline:primary",
        owner: {
          kind: "revision",
          actionId: "timeline:main",
          actionRevisionId: "timeline-revision:1",
        },
        direction: "input",
        slot: "track:video:0",
        projectAssetId: asset.id,
        role: "primary",
      });
      if (!result.ok) throw new Error(result.error.code);
      return { value: undefined };
    });

    const baseUrl = `http://127.0.0.1:49152/api/v1/projects/project-a/assets/${encodeURIComponent(asset.id)}`;
    const references = await app.request(`${baseUrl}/references`);
    expect(references.status).toBe(200);
    expect(references.headers.get("x-clash-read-receipt")).toMatch(
      PROJECT_ASSET_RECEIPT_RE,
    );
    const expectedReference = {
      id: "binding:timeline:primary",
      owner: {
        kind: "revision",
        actionId: "timeline:main",
        actionRevisionId: "timeline-revision:1",
      },
      direction: "input",
      slot: "track:video:0",
      projectAssetId: "result:one",
      role: "primary",
    };
    await expect(references.json()).resolves.toEqual({
      projectAssetId: "result:one",
      references: [expectedReference],
    });

    const removed = await app.request(baseUrl, { method: "DELETE" });
    expect(removed.status, await removed.clone().text()).toBe(409);
    await expect(removed.json()).resolves.toEqual({
      error: "Project Asset result:one is still referenced.",
      code: "ASSET_IN_USE",
      projectAssetId: "result:one",
      references: [expectedReference],
    });
    expect(
      readProjectAsset(await replicas.recover("project-a"), asset.id)
        ?.lifecycle,
    ).toEqual({ state: "active" });
  });

  it("logically trashes and restores an unreferenced Asset without deleting its bytes", async () => {
    const { app, asset, clashRoot, dataDir } = await fixture();
    const baseUrl = `http://127.0.0.1:49152/api/v1/projects/project-a/assets/${encodeURIComponent(asset.id)}`;
    const digest = createHash("sha256").update("0123456789").digest("hex");
    const resourcePath = join(
      clashRoot,
      "assets",
      "blobs",
      digest,
      "original.unusual",
    );

    const removed = await app.request(baseUrl, { method: "DELETE" });
    expect(removed.status, await removed.clone().text()).toBe(200);
    await expect(removed.json()).resolves.toMatchObject({
      id: "result:one",
      kind: "audio",
      name: "result.unusual",
      metadata: {
        durationMs: 2_000,
        bytes: 10,
        contentType: "audio/mpeg",
        originalName: "result.unusual",
      },
      provenance: { kind: "generation", actionRunId: "run-1" },
      lifecycle: {
        state: "trashed",
        deleteOperationId: expect.any(String),
        deletedAt: expect.any(String),
        purgeAfter: expect.any(String),
      },
      status: "unavailable",
    });
    expect(await readFile(resourcePath, "utf8")).toBe("0123456789");
    const trashed = readProjectAsset(
      await new FileReplicaStore(join(dataDir, "projects")).recover(
        "project-a",
      ),
      asset.id,
    );
    expect(trashed?.lifecycle).toMatchObject({
      state: "trashed",
      deleteOperationId: expect.any(String),
      deletedAt: expect.any(String),
      purgeAfter: expect.any(String),
    });

    const restored = await app.request(`${baseUrl}/restore`, {
      method: "POST",
    });
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      id: "result:one",
      lifecycle: { state: "active" },
      status: "ready",
      url: `${baseUrl}/media`,
    });
    expect(
      readProjectAsset(
        await new FileReplicaStore(join(dataDir, "projects")).recover(
          "project-a",
        ),
        asset.id,
      )?.lifecycle,
    ).toEqual({ state: "active" });
    expect(await readFile(resourcePath, "utf8")).toBe("0123456789");
  });

  it("requires and rotates a Host receipt for agent delete and restore", async () => {
    const { app, asset } = await fixture();
    const baseUrl = `http://127.0.0.1:49152/api/v1/projects/project-a/assets/${encodeURIComponent(asset.id)}`;

    const missing = await app.request(baseUrl, {
      method: "DELETE",
      headers: { "x-clash-client-type": "agent" },
    });
    expect(missing.status).toBe(409);
    await expect(missing.json()).resolves.toMatchObject({
      code: "READ_REQUIRED",
    });

    const read = await app.request(baseUrl);
    const activeReceipt = read.headers.get("x-clash-read-receipt");
    expect(activeReceipt).toMatch(PROJECT_ASSET_RECEIPT_RE);
    expect(JSON.stringify(await read.json())).not.toContain("readToken");

    const removed = await app.request(baseUrl, {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": activeReceipt!,
      },
    });
    expect(removed.status, await removed.clone().text()).toBe(200);
    const trashedReceipt = removed.headers.get("x-clash-read-receipt");
    expect(trashedReceipt).toMatch(PROJECT_ASSET_RECEIPT_RE);
    expect(trashedReceipt).not.toBe(activeReceipt);
    expect(JSON.stringify(await removed.json())).not.toContain("readToken");

    const restored = await app.request(`${baseUrl}/restore`, {
      method: "POST",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": trashedReceipt!,
      },
    });
    expect(restored.status, await restored.clone().text()).toBe(200);
    expect(restored.headers.get("x-clash-read-receipt")).toMatch(
      PROJECT_ASSET_RECEIPT_RE,
    );
    expect(JSON.stringify(await restored.json())).not.toContain("readToken");
  });

  it("rejects tampered and stale Project Asset receipts inside the mutation", async () => {
    const tamperedFixture = await fixture();
    const tamperedUrl = `http://127.0.0.1:49152/api/v1/projects/project-a/assets/${encodeURIComponent(tamperedFixture.asset.id)}`;
    const initialRead = await tamperedFixture.app.request(tamperedUrl);
    const receipt = initialRead.headers.get("x-clash-read-receipt")!;
    const tampered = `${receipt.slice(0, -1)}${receipt.endsWith("A") ? "B" : "A"}`;
    const rejectedTampered = await tamperedFixture.app.request(tamperedUrl, {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": tampered,
      },
    });
    expect(rejectedTampered.status).toBe(409);
    await expect(rejectedTampered.json()).resolves.toMatchObject({
      code: "INVALID_READ_PROOF",
    });

    const staleFixture = await fixture();
    const staleUrl = `http://127.0.0.1:49152/api/v1/projects/project-a/assets/${encodeURIComponent(staleFixture.asset.id)}`;
    const staleRead = await staleFixture.app.request(staleUrl);
    const staleReceipt = staleRead.headers.get("x-clash-read-receipt")!;
    const replicas = new FileReplicaStore(
      join(staleFixture.dataDir, "projects"),
    );
    await replicas.updateSnapshotAtomic("project-a", (doc) => {
      const result = createActionAssetBinding(doc, {
        id: "binding:concurrent-input",
        owner: { kind: "draft", actionId: "action:concurrent" },
        direction: "input",
        slot: "image:0",
        projectAssetId: staleFixture.asset.id,
        role: "reference",
      });
      if (!result.ok) throw new Error(result.error.code);
      return { value: undefined };
    });

    const rejectedStale = await staleFixture.app.request(staleUrl, {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": staleReceipt,
      },
    });
    expect(rejectedStale.status).toBe(409);
    await expect(rejectedStale.json()).resolves.toMatchObject({
      code: "STALE_READ",
    });
    expect(
      readProjectAsset(
        await replicas.recover("project-a"),
        staleFixture.asset.id,
      )?.lifecycle.state,
    ).toBe("active");
  });

  it("does not resolve a Project Asset through another Project", async () => {
    const { app, asset } = await fixture();
    const otherProjectUrl = `http://127.0.0.1:49152/api/v1/projects/project-b/assets/${encodeURIComponent(asset.id)}`;

    const read = await app.request(otherProjectUrl);
    expect(read.status).toBe(404);
    await expect(read.json()).resolves.toEqual({
      error: "Project Asset not found",
      code: "PROJECT_ASSET_NOT_FOUND",
    });

    const media = await app.request(`${otherProjectUrl}/media`);
    expect(media.status).toBe(404);
    await expect(media.json()).resolves.toEqual({
      error: "Project Asset not found",
      code: "PROJECT_ASSET_NOT_FOUND",
    });
  });
});
