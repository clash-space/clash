import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createProjectAsset,
  markActionAssetBindingAuthority,
  markProjectAssetAuthority,
  type ResolvedAsset,
} from "@clash/shared-types";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalApiApp } from "./app.js";
import type { LocalAssetInspector } from "./local-asset-inspections.js";
import { createLocalGlobalAssetService } from "./local-global-assets.js";
import { createLocalMetadataStore } from "./local-metadata-store.js";
import { createLocalProjectAssetService } from "./local-project-assets.js";
import { FileReplicaStore } from "./loro/file-replica-store.js";

const temporaryDirectories: string[] = [];
const origin = "http://127.0.0.1:49152";

async function fixture(
  options: {
    inspectAssetResource?: LocalAssetInspector;
  } = {},
) {
  const clashRoot = await mkdtemp(join(tmpdir(), "clash-global-routes-"));
  temporaryDirectories.push(clashRoot);
  const dataDir = join(clashRoot, "local-api");
  const inspectAssetResource: LocalAssetInspector =
    options.inspectAssetResource ??
    (async ({ resource }) =>
      resource.kind === "image"
        ? {
            width: 1,
            height: 1,
            videoCodec: "png",
            ...(resource.contentType
              ? { contentType: resource.contentType }
              : {}),
          }
        : resource.kind === "video"
          ? {
              width: 1,
              height: 1,
              durationMs: 1_000,
              frameRate: 24,
              videoCodec: "h264",
              hasAudio: false,
              ...(resource.contentType
                ? { contentType: resource.contentType }
                : {}),
            }
          : resource.kind === "audio"
            ? {
                durationMs: 1_000,
                hasAudio: true,
                audioCodec: "aac",
                ...(resource.contentType
                  ? { contentType: resource.contentType }
                  : {}),
              }
            : resource.contentType
              ? { contentType: resource.contentType }
              : {});
  const app = createLocalApiApp({
    dataDir,
    clashRoot,
    userId: "local-user",
    projectAssetProjectionOrigin: origin,
    inspectAssetResource,
  });
  return { app, clashRoot, dataDir };
}

function mediaForm(name: string, type: string, kind: string, value: string) {
  const form = new FormData();
  form.set("file", new File([value], name, { type }));
  form.set("kind", kind);
  return form;
}

function globalMediaForm(
  globalAssetId: string,
  name: string,
  type: string,
  kind: string,
  value: string,
) {
  const form = mediaForm(name, type, kind, value);
  form.set("globalAssetId", globalAssetId);
  return form;
}

function expectStorageNeutralHttpShape(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(
    /"(?:resourceId|storageKey|path|signedUrl|srcR2Key|localBlobKey)"\s*:/,
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("personal Global Asset routes", () => {
  it("enriches Project and Global entries from one Resource inspection without synchronizing storage facts", async () => {
    let probes = 0;
    const { app } = await fixture({
      inspectAssetResource: async () => {
        probes += 1;
        return {
          width: 1280,
          height: 720,
          durationMs: 3_000,
          frameRate: 30,
          videoCodec: "h264",
          hasAudio: true,
          audioCodec: "aac",
        };
      },
    });
    const projectCollection = `${origin}/api/v1/projects/project-inspection/assets`;
    const globalCollection = `${origin}/api/v1/libraries/personal/assets`;
    const imported = await app.request(`${projectCollection}/import-file`, {
      method: "POST",
      body: mediaForm(
        "inspected.mp4",
        "video/mp4",
        "video",
        "one inspected Resource",
      ),
    });
    expect(imported.status, await imported.clone().text()).toBe(201);
    const projectAsset = (await imported.json()) as ResolvedAsset;
    expect(projectAsset.metadata).toMatchObject({
      width: 1280,
      height: 720,
      durationMs: 3_000,
      frameRate: 30,
      videoCodec: "h264",
      audioCodec: "aac",
      contentType: "video/mp4",
    });
    expectStorageNeutralHttpShape(projectAsset);

    const published = await app.request(`${globalCollection}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-inspection",
        projectAssetId: projectAsset.id,
      }),
    });
    expect(published.status, await published.clone().text()).toBe(201);
    const globalAsset = (await published.json()) as ResolvedAsset;
    expect(globalAsset.metadata).toMatchObject(projectAsset.metadata);
    expectStorageNeutralHttpShape(globalAsset);
    expect(probes).toBe(1);
  });

  it("leaves staged bytes retryable without publishing an Asset when the required probe fails", async () => {
    let probes = 0;
    const { app } = await fixture({
      inspectAssetResource: async () => {
        probes += 1;
        if (probes === 1) throw new Error("temporary decoder failure");
        return {
          width: 1_280,
          height: 720,
          durationMs: 3_000,
          frameRate: 30,
          videoCodec: "h264",
          hasAudio: false,
        };
      },
    });
    const collection = `${origin}/api/v1/projects/project-probe-failure/assets`;
    const projectAssetId = "asset:probe-retry";
    const importBody = () => {
      const form = mediaForm(
        "still-readable.mp4",
        "video/mp4",
        "video",
        "temporarily unprobeable bytes",
      );
      form.set("projectAssetId", projectAssetId);
      return form;
    };
    const imported = await app.request(`${collection}/import-file`, {
      method: "POST",
      body: importBody(),
    });
    expect(imported.status).toBe(500);

    const absent = await app.request(
      `${collection}/${encodeURIComponent(projectAssetId)}`,
    );
    expect(absent.status).toBe(404);

    const retried = await app.request(`${collection}/import-file`, {
      method: "POST",
      body: importBody(),
    });
    expect(retried.status, await retried.clone().text()).toBe(201);
    await expect(retried.json()).resolves.toMatchObject({
      status: "ready",
      kind: "video",
      id: projectAssetId,
      metadata: {
        width: 1_280,
        height: 720,
        durationMs: 3_000,
        frameRate: 30,
        videoCodec: "h264",
      },
    });
    expect(probes).toBe(2);
  });

  it("keeps video poster derivation frontend-only across Project and Global reads", async () => {
    const { app, dataDir } = await fixture();
    const projectCollection = `${origin}/api/v1/projects/project-poster/assets`;
    const globalCollection = `${origin}/api/v1/libraries/personal/assets`;
    const imported = await app.request(`${projectCollection}/import-file`, {
      method: "POST",
      body: mediaForm("source.mp4", "video/mp4", "video", "video source bytes"),
    });
    expect(imported.status, await imported.clone().text()).toBe(201);
    const projectAsset = (await imported.json()) as ResolvedAsset;
    expect(projectAsset).not.toHaveProperty("thumbnailUrl");
    expectStorageNeutralHttpShape(projectAsset);

    const projectPoster = await app.request(
      `${projectCollection}/${encodeURIComponent(projectAsset.id)}/thumbnail`,
    );
    expect(projectPoster.status).toBe(404);

    const published = await app.request(`${globalCollection}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-poster",
        projectAssetId: projectAsset.id,
      }),
    });
    expect(published.status, await published.clone().text()).toBe(201);
    const globalAsset = (await published.json()) as ResolvedAsset;
    expect(globalAsset).not.toHaveProperty("thumbnailUrl");
    expectStorageNeutralHttpShape(globalAsset);

    const globalPoster = await app.request(
      `${globalCollection}/${encodeURIComponent(globalAsset.id)}/thumbnail`,
    );
    expect(globalPoster.status).toBe(404);

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(join(dataDir, "local.sqlite"));
    try {
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          )
          .get("local_asset_representations"),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("keeps Project cover identity independent from this device's byte availability", async () => {
    const { app, clashRoot, dataDir } = await fixture();
    const created = await app.request(`${origin}/api/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Unavailable cover" }),
    });
    const { id: projectId } = (await created.json()) as { id: string };
    await new FileReplicaStore(join(dataDir, "projects")).updateSnapshotAtomic(
      projectId,
      (doc) => {
        expect(
          createProjectAsset(doc, {
            id: "cover-on-another-device",
            kind: "image",
            source: {
              kind: "linked",
              resourceId: `sha256:${"a".repeat(64)}`,
              origin: {
                scope: "global",
                libraryId: "personal",
                entryId: "global-on-another-device",
              },
            },
            lifecycle: { state: "active" },
            metadata: { contentType: "image/png" },
          }),
        ).toMatchObject({ ok: true });
        expect(markProjectAssetAuthority(doc)).toMatchObject({ ok: true });
        expect(markActionAssetBindingAuthority(doc)).toMatchObject({
          ok: true,
        });
        return { value: undefined };
      },
    );
    const unavailable = await createLocalProjectAssetService({
      dataDir,
      clashRoot,
      projectionOrigin: origin,
    }).read(projectId, "cover-on-another-device");
    expect(unavailable).not.toBeNull();
    expect(unavailable?.status).toBe("unavailable");
    if (!unavailable) throw new Error("Expected unavailable Project Asset");

    const response = await app.request(
      `${origin}/api/v1/projects/${encodeURIComponent(projectId)}/cover`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coverAssetId: unavailable.id }),
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      coverAssetId: unavailable.id,
    });
  });

  it("uses Project-scoped ResolvedAsset previews for project list and detail reads", async () => {
    const { app } = await fixture();
    const created = await app.request(`${origin}/api/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Resolved previews" }),
    });
    const { id: projectId } = (await created.json()) as { id: string };
    const projectCollection = `${origin}/api/v1/projects/${encodeURIComponent(projectId)}/assets`;
    const imported = await app.request(`${projectCollection}/import-file`, {
      method: "POST",
      body: mediaForm("cover.png", "image/png", "image", "project-cover"),
    });
    const asset = (await imported.json()) as ResolvedAsset;
    const cover = await app.request(
      `${origin}/api/v1/projects/${encodeURIComponent(projectId)}/cover`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coverAssetId: asset.id }),
      },
    );
    expect(cover.status, await cover.clone().text()).toBe(200);

    const list = await app.request(`${origin}/api/v1/projects`);
    expect(list.status, await list.clone().text()).toBe(200);
    const listBody = (await list.json()) as {
      projects: Array<{ id: string; assets: ResolvedAsset[] }>;
    };
    expect(
      listBody.projects.find((project) => project.id === projectId)?.assets,
    ).toEqual([asset]);

    const detail = await app.request(
      `${origin}/api/v1/projects/${encodeURIComponent(projectId)}`,
    );
    const detailBody = (await detail.json()) as { assets: ResolvedAsset[] };
    expect(detailBody.assets).toEqual([asset]);
    expect(JSON.stringify(detailBody.assets)).not.toMatch(
      /srcR2Key|storageKey|signedUrl|localBlobKey|path/,
    );
  });

  it("imports, lists, reads, serves, trashes, and restores one storage-neutral shape", async () => {
    const { app } = await fixture();
    const collection = `${origin}/api/v1/libraries/personal/assets`;
    const imported = await app.request(`${collection}/import-file`, {
      method: "POST",
      body: mediaForm("voice.mp3", "audio/mpeg", "audio", "0123456789"),
    });
    expect(imported.status, await imported.clone().text()).toBe(201);
    const asset = (await imported.json()) as ResolvedAsset;
    expect(asset).toMatchObject({
      kind: "audio",
      name: "voice.mp3",
      metadata: {
        bytes: 10,
        contentType: "audio/mpeg",
        originalName: "voice.mp3",
      },
      provenance: { kind: "import" },
      status: "ready",
    });
    expect(asset.url).toBe(
      `${collection}/${encodeURIComponent(asset.id)}/media`,
    );
    expect(asset).not.toHaveProperty("thumbnailUrl");
    expect(JSON.stringify(asset)).not.toMatch(
      /resourceId|storageKey|srcR2Key|signedUrl|localBlobKey|path/,
    );

    const listed = await app.request(collection);
    await expect(listed.json()).resolves.toEqual({ assets: [asset] });
    const read = await app.request(
      `${collection}/${encodeURIComponent(asset.id)}`,
    );
    await expect(read.json()).resolves.toEqual(asset);

    const media = await app.request(asset.url!, {
      headers: { range: "bytes=2-5" },
    });
    expect(media.status).toBe(206);
    expect(media.headers.get("content-type")).toBe("audio/mpeg");
    expect(media.headers.get("content-range")).toBe("bytes 2-5/10");
    await expect(media.text()).resolves.toBe("2345");

    const trashed = await app.request(
      `${collection}/${encodeURIComponent(asset.id)}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deleteOperationId: "delete:voice-test" }),
      },
    );
    expect(trashed.status).toBe(200);
    await expect(trashed.json()).resolves.toMatchObject({
      id: asset.id,
      status: "unavailable",
    });

    const restored = await app.request(
      `${collection}/${encodeURIComponent(asset.id)}/restore`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deleteOperationId: "delete:voice-test" }),
      },
    );
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      id: asset.id,
      status: "ready",
      url: asset.url,
    });
  });

  it("uses the observed delete operation as the restore CAS boundary", async () => {
    const { app } = await fixture();
    const collection = `${origin}/api/v1/libraries/personal/assets`;
    const imported = await app.request(`${collection}/import-file`, {
      method: "POST",
      body: globalMediaForm(
        "global:restore-cas-route",
        "restore.png",
        "image/png",
        "image",
        "restore route bytes",
      ),
    });
    const asset = (await imported.json()) as ResolvedAsset;
    const assetUrl = `${collection}/${encodeURIComponent(asset.id)}`;
    const trash = (deleteOperationId: string) =>
      app.request(assetUrl, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deleteOperationId }),
      });
    const restore = (deleteOperationId: string) =>
      app.request(`${assetUrl}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deleteOperationId }),
      });

    expect((await trash("delete:route-1")).status).toBe(200);
    const observed = (await (
      await app.request(assetUrl)
    ).json()) as ResolvedAsset;
    expect(observed.lifecycle).toMatchObject({
      state: "trashed",
      deleteOperationId: "delete:route-1",
    });
    expect((await restore("delete:route-1")).status).toBe(200);
    expect((await trash("delete:route-2")).status).toBe(200);

    const stale = await restore("delete:route-1");
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "GLOBAL_ASSET_FACT_MISMATCH",
    });
    const current = (await (
      await app.request(assetUrl)
    ).json()) as ResolvedAsset;
    expect(current.lifecycle).toMatchObject({
      state: "trashed",
      deleteOperationId: "delete:route-2",
    });
  });

  it("returns the canonical not-found code for unknown Global Asset lifecycle mutations", async () => {
    const { app } = await fixture();
    const restored = await app.request(
      `${origin}/api/v1/libraries/personal/assets/global%3Amissing/restore`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deleteOperationId: "delete:observed" }),
      },
    );
    const trashed = await app.request(
      `${origin}/api/v1/libraries/personal/assets/global%3Amissing`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deleteOperationId: "delete:observed" }),
      },
    );

    for (const response of [restored, trashed]) {
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "Global Asset not found",
        code: "GLOBAL_ASSET_NOT_FOUND",
      });
    }
  });

  it("uses a client Global Asset id to make import retries idempotent and rejects different facts", async () => {
    const { app } = await fixture();
    const collection = `${origin}/api/v1/libraries/personal/assets`;
    const globalAssetId = "global:client-import-retry";
    const importAsset = (value: string) =>
      app.request(`${collection}/import-file`, {
        method: "POST",
        body: globalMediaForm(
          globalAssetId,
          "retry.png",
          "image/png",
          "image",
          value,
        ),
      });

    const first = await importAsset("stable import bytes");
    const second = await importAsset("stable import bytes");
    expect(first.status, await first.clone().text()).toBe(201);
    expect(second.status, await second.clone().text()).toBe(201);
    const firstAsset = (await first.json()) as ResolvedAsset;
    const secondAsset = (await second.json()) as ResolvedAsset;
    expect(firstAsset.id).toBe(globalAssetId);
    expect(secondAsset).toEqual(firstAsset);

    const listed = await app.request(collection);
    await expect(listed.json()).resolves.toEqual({ assets: [firstAsset] });

    const conflicting = await importAsset("different immutable bytes");
    expect(conflicting.status, await conflicting.clone().text()).toBe(409);
    await expect(conflicting.json()).resolves.toMatchObject({
      code: "GLOBAL_ASSET_FACT_MISMATCH",
    });
  });

  it("requires one stable delete operation and returns the first trash result on retry", async () => {
    const { app } = await fixture();
    const collection = `${origin}/api/v1/libraries/personal/assets`;
    const imported = await app.request(`${collection}/import-file`, {
      method: "POST",
      body: globalMediaForm(
        "global:client-delete-retry",
        "delete-retry.png",
        "image/png",
        "image",
        "delete retry bytes",
      ),
    });
    expect(imported.status, await imported.clone().text()).toBe(201);
    const asset = (await imported.json()) as ResolvedAsset;
    const assetUrl = `${collection}/${encodeURIComponent(asset.id)}`;

    const missingOperation = await app.request(assetUrl, { method: "DELETE" });
    expect(missingOperation.status, await missingOperation.clone().text()).toBe(
      400,
    );
    await expect(missingOperation.json()).resolves.toEqual({
      error: "deleteOperationId is required",
      code: "INVALID_GLOBAL_ASSET_TRASH",
    });

    const trash = (deleteOperationId: string) =>
      app.request(assetUrl, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deleteOperationId }),
      });
    const first = await trash("delete:client-retry");
    const second = await trash("delete:client-retry");
    expect(first.status, await first.clone().text()).toBe(200);
    expect(second.status, await second.clone().text()).toBe(200);
    const firstResult = (await first.json()) as ResolvedAsset;
    const secondResult = (await second.json()) as ResolvedAsset;
    expect(firstResult.lifecycle).toMatchObject({
      state: "trashed",
      deleteOperationId: "delete:client-retry",
    });
    expect(secondResult).toEqual(firstResult);

    const conflicting = await trash("delete:another-operation");
    expect(conflicting.status, await conflicting.clone().text()).toBe(409);
    await expect(conflicting.json()).resolves.toMatchObject({
      code: "GLOBAL_ASSET_FACT_MISMATCH",
    });
  });

  it("publishes and admits independent entry identities over one immutable Resource", async () => {
    const { app, clashRoot, dataDir } = await fixture();
    const projectCollection = `${origin}/api/v1/projects/project-a/assets`;
    const globalCollection = `${origin}/api/v1/libraries/personal/assets`;
    const imported = await app.request(`${projectCollection}/import-file`, {
      method: "POST",
      body: mediaForm("hero.png", "image/png", "image", "same-image-bytes"),
    });
    expect(imported.status, await imported.clone().text()).toBe(201);
    const projectSource = (await imported.json()) as ResolvedAsset;

    const published = await app.request(`${globalCollection}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-a",
        projectAssetId: projectSource.id,
      }),
    });
    expect(published.status, await published.clone().text()).toBe(201);
    const globalAsset = (await published.json()) as ResolvedAsset;
    expect(globalAsset.id).not.toBe(projectSource.id);

    const admitted = await app.request(`${projectCollection}/admit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ globalAssetId: globalAsset.id }),
    });
    expect(admitted.status, await admitted.clone().text()).toBe(201);
    const projectLink = (await admitted.json()) as ResolvedAsset;
    expect(
      new Set([projectSource.id, globalAsset.id, projectLink.id]).size,
    ).toBe(3);

    const projects = createLocalProjectAssetService({
      dataDir,
      clashRoot,
      projectionOrigin: origin,
    });
    const globals = createLocalGlobalAssetService({
      dataDir,
      clashRoot,
      projectionOrigin: origin,
    });
    const sourceEntry = await projects.readEntry("project-a", projectSource.id);
    const globalEntry = await globals.readEntry("personal", globalAsset.id);
    const linkedEntry = await projects.readEntry("project-a", projectLink.id);
    expect(sourceEntry?.source.kind).toBe("owned");
    expect(globalEntry?.resourceId).toBe(sourceEntry?.source.resourceId);
    expect(linkedEntry?.source).toEqual({
      kind: "linked",
      resourceId: sourceEntry?.source.resourceId,
      origin: {
        scope: "global",
        libraryId: "personal",
        entryId: globalAsset.id,
      },
    });

    const sourceProjection = await projects.openProjection(
      "project-a",
      projectSource.id,
    );
    const globalProjection = await globals.openProjection(
      "personal",
      globalAsset.id,
    );
    const linkedProjection = await projects.openProjection(
      "project-a",
      projectLink.id,
    );
    expect(globalProjection.path).toBe(sourceProjection.path);
    expect(linkedProjection.path).toBe(sourceProjection.path);

    await app.request(
      `${globalCollection}/${encodeURIComponent(globalAsset.id)}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deleteOperationId: "delete:shared-link-test" }),
      },
    );
    const linkedMedia = await app.request(projectLink.url!);
    expect(linkedMedia.status).toBe(200);
    await expect(linkedMedia.text()).resolves.toBe("same-image-bytes");
  });

  it("returns one independent Global entry when Project publication is retried", async () => {
    const { app } = await fixture();
    const projectCollection = `${origin}/api/v1/projects/project-publish-retry/assets`;
    const globalCollection = `${origin}/api/v1/libraries/personal/assets`;
    const imported = await app.request(`${projectCollection}/import-file`, {
      method: "POST",
      body: mediaForm(
        "publish-once.png",
        "image/png",
        "image",
        "publish retry bytes",
      ),
    });
    expect(imported.status, await imported.clone().text()).toBe(201);
    const projectAsset = (await imported.json()) as ResolvedAsset;
    const publish = () =>
      app.request(`${globalCollection}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-publish-retry",
          projectAssetId: projectAsset.id,
        }),
      });

    const first = await publish();
    const second = await publish();
    expect(first.status, await first.clone().text()).toBe(201);
    expect(second.status, await second.clone().text()).toBe(201);
    const firstAsset = (await first.json()) as ResolvedAsset;
    const secondAsset = (await second.json()) as ResolvedAsset;
    expect(secondAsset.id).toBe(firstAsset.id);
    expect(firstAsset.id).not.toBe(projectAsset.id);

    const listed = await app.request(globalCollection);
    const body = (await listed.json()) as { assets: ResolvedAsset[] };
    expect(body.assets.map((asset) => asset.id)).toEqual([firstAsset.id]);
  });

  it("returns one Project-local linked entry when Global admission is retried", async () => {
    const { app } = await fixture();
    const globalCollection = `${origin}/api/v1/libraries/personal/assets`;
    const projectCollection = `${origin}/api/v1/projects/project-admit-retry/assets`;
    const imported = await app.request(`${globalCollection}/import-file`, {
      method: "POST",
      body: mediaForm(
        "admit-once.png",
        "image/png",
        "image",
        "admit retry bytes",
      ),
    });
    expect(imported.status, await imported.clone().text()).toBe(201);
    const globalAsset = (await imported.json()) as ResolvedAsset;
    const admit = () =>
      app.request(`${projectCollection}/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ globalAssetId: globalAsset.id }),
      });

    const first = await admit();
    const second = await admit();
    expect(first.status, await first.clone().text()).toBe(201);
    expect(second.status, await second.clone().text()).toBe(201);
    const firstAsset = (await first.json()) as ResolvedAsset;
    const secondAsset = (await second.json()) as ResolvedAsset;
    expect(secondAsset.id).toBe(firstAsset.id);
    expect(firstAsset.id).not.toBe(globalAsset.id);

    const listed = await app.request(projectCollection);
    const body = (await listed.json()) as { assets: ResolvedAsset[] };
    expect(body.assets.map((asset) => asset.id)).toEqual([firstAsset.id]);
  });

  it("edits an admitted link into a new owned Project Asset without changing the link", async () => {
    const { app, clashRoot, dataDir } = await fixture();
    const projectId = "project-linked-edit";
    const globalCollection = `${origin}/api/v1/libraries/personal/assets`;
    const projectCollection = `${origin}/api/v1/projects/${projectId}/assets`;
    const imported = await app.request(`${globalCollection}/import-file`, {
      method: "POST",
      body: mediaForm(
        "linked-source.png",
        "image/png",
        "image",
        "linked source bytes",
      ),
    });
    expect(imported.status, await imported.clone().text()).toBe(201);
    const globalAsset = (await imported.json()) as ResolvedAsset;
    const admitted = await app.request(`${projectCollection}/admit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ globalAssetId: globalAsset.id }),
    });
    expect(admitted.status, await admitted.clone().text()).toBe(201);
    const linked = (await admitted.json()) as ResolvedAsset;
    const projects = createLocalProjectAssetService({
      dataDir,
      clashRoot,
      projectionOrigin: origin,
    });
    const before = await projects.readEntry(projectId, linked.id);
    expect(before?.source).toMatchObject({
      kind: "linked",
      origin: {
        scope: "global",
        libraryId: "personal",
        entryId: globalAsset.id,
      },
    });

    const invocation = {
      actionId: "image-editor",
      projectId,
      source: { assetId: linked.id, kind: "image" },
      params: { rotation: 90 },
      surface: "asset-preview",
      mode: "implicit",
    };
    const editForm = new FormData();
    editForm.set(
      "file",
      new File(["edited linked bytes"], "edited-linked.png", {
        type: "image/png",
      }),
    );
    editForm.set("projectId", projectId);
    editForm.set("sourceAssetId", linked.id);
    editForm.set("editKind", "image-editor");
    editForm.set("outputKind", "image");
    editForm.set("editParams", JSON.stringify(invocation.params));
    editForm.set("origin", "asset-preview");
    editForm.set("invocation", JSON.stringify(invocation));
    editForm.set("actionRunId", "edit:global-linked-source-1");
    const edited = await app.request("/api/v1/edits", {
      method: "POST",
      body: editForm,
    });
    expect(edited.status, await edited.clone().text()).toBe(200);
    const output = (await edited.json()) as ResolvedAsset;

    expect(output.id).not.toBe(linked.id);
    expect(await projects.readEntry(projectId, linked.id)).toEqual(before);
    await expect(
      projects.readEntry(projectId, output.id),
    ).resolves.toMatchObject({
      source: { kind: "owned" },
      provenance: { kind: "edit" },
    });
  });

  it("preserves admitted media across the referenced delete, unbind, trash, and restore journey", async () => {
    const { app, clashRoot, dataDir } = await fixture();
    const projectId = "project-journey";
    const globalCollection = `${origin}/api/v1/libraries/personal/assets`;
    const projectCollection = `${origin}/api/v1/projects/${projectId}/assets`;

    const imported = await app.request(`${globalCollection}/import-file`, {
      method: "POST",
      body: mediaForm(
        "journey.mp3",
        "audio/mpeg",
        "audio",
        "immutable-journey-audio",
      ),
    });
    expect(imported.status, await imported.clone().text()).toBe(201);
    const globalAsset = (await imported.json()) as ResolvedAsset;
    expectStorageNeutralHttpShape(globalAsset);

    const admitted = await app.request(`${projectCollection}/admit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ globalAssetId: globalAsset.id }),
    });
    expect(admitted.status, await admitted.clone().text()).toBe(201);
    const projectAsset = (await admitted.json()) as ResolvedAsset;
    expectStorageNeutralHttpShape(projectAsset);

    const projectAssets = createLocalProjectAssetService({
      dataDir,
      clashRoot,
      projectionOrigin: origin,
    });
    const binding = {
      id: "binding:journey:source",
      owner: {
        kind: "run" as const,
        actionId: "journey:consume",
        actionRevisionId: "journey:consume:revision-1",
        actionRunId: "journey:consume:run-1",
      },
      direction: "input" as const,
      slot: "source",
      projectAssetId: projectAsset.id,
      role: "source" as const,
    };
    await expect(projectAssets.bind(projectId, binding)).resolves.toEqual(
      binding,
    );

    const assetUrl = `${projectCollection}/${encodeURIComponent(projectAsset.id)}`;
    const deleteRequest = {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deleteOperationId: "delete:journey" }),
    } as const;
    const rejectedDelete = await app.request(assetUrl, deleteRequest);
    expect(rejectedDelete.status, await rejectedDelete.clone().text()).toBe(
      409,
    );
    const rejectedBody = await rejectedDelete.json();
    expect(rejectedBody).toEqual({
      error: `Project Asset ${projectAsset.id} is still referenced.`,
      code: "ASSET_IN_USE",
      projectAssetId: projectAsset.id,
      references: [binding],
    });
    expectStorageNeutralHttpShape(rejectedBody);

    await expect(projectAssets.unbind(projectId, binding.id)).resolves.toEqual(
      binding,
    );

    const removed = await app.request(assetUrl, deleteRequest);
    expect(removed.status, await removed.clone().text()).toBe(200);
    const removedBody = (await removed.json()) as ResolvedAsset;
    expect(removedBody).toMatchObject({
      id: projectAsset.id,
      status: "unavailable",
    });
    expectStorageNeutralHttpShape(removedBody);

    const restored = await app.request(`${assetUrl}/restore`, {
      method: "POST",
    });
    expect(restored.status, await restored.clone().text()).toBe(200);
    const restoredBody = (await restored.json()) as ResolvedAsset;
    expect(restoredBody).toMatchObject({
      id: projectAsset.id,
      status: "ready",
      url: `${assetUrl}/media`,
    });
    expectStorageNeutralHttpShape(restoredBody);

    const media = await app.request(`${assetUrl}/media`);
    expect(media.status, await media.clone().text()).toBe(200);
    expect(media.headers.get("content-type")).toBe("audio/mpeg");
    await expect(media.text()).resolves.toBe("immutable-journey-audio");
  });

  it("retires the legacy Global/read/reference routes without writing legacy membership", async () => {
    const { app, dataDir } = await fixture();
    const retiredRequests: Array<[string, RequestInit | undefined]> = [
      [`${origin}/api/v1/assets`, undefined],
      [
        `${origin}/api/v1/assets`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            addToLibrary: true,
            kind: "image",
            srcR2Key: "uploads/legacy.png",
          }),
        },
      ],
      [`${origin}/api/v1/assets/legacy`, undefined],
      [`${origin}/api/v1/assets/legacy/library`, { method: "POST" }],
      [
        `${origin}/api/v1/assets/legacy/ref`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: "project-a" }),
        },
      ],
      [`${origin}/api/v1/assets/import`, { method: "POST" }],
      [`${origin}/api/v1/assets/replace`, { method: "POST" }],
      [`${origin}/api/v1/assets/gc`, { method: "POST" }],
      [`${origin}/api/v1/assets/legacy/references/refresh`, { method: "POST" }],
      [`${origin}/api/v1/assets/legacy/cover`, { method: "PATCH" }],
    ];

    for (const [url, init] of retiredRequests) {
      const response = await app.request(url, init);
      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        code: "LEGACY_ASSET_API_RETIRED",
      });
    }

    const state = await createLocalMetadataStore(dataDir).load();
    expect(state.assetRefs).toEqual([]);
    expect(state.libraryAssetRefs).toEqual([]);
  });
});
