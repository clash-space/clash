import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedAsset } from "@clash/shared-types";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalApiApp } from "./app.js";
import { createLocalGlobalAssetService } from "./local-global-assets.js";
import { createLocalMetadataStore } from "./local-metadata-store.js";
import { createLocalProjectAssetService } from "./local-project-assets.js";

const temporaryDirectories: string[] = [];
const origin = "http://127.0.0.1:49152";

async function fixture() {
  const clashRoot = await mkdtemp(join(tmpdir(), "clash-global-routes-"));
  temporaryDirectories.push(clashRoot);
  const dataDir = join(clashRoot, "local-api");
  const app = createLocalApiApp({
    dataDir,
    clashRoot,
    userId: "local-user",
    projectAssetProjectionOrigin: origin,
  });
  return { app, clashRoot, dataDir };
}

function mediaForm(name: string, type: string, kind: string, value: string) {
  const form = new FormData();
  form.set("file", new File([value], name, { type }));
  form.set("kind", kind);
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
      { method: "DELETE" },
    );
    expect(trashed.status).toBe(200);
    await expect(trashed.json()).resolves.toMatchObject({
      id: asset.id,
      status: "unavailable",
    });

    const restored = await app.request(
      `${collection}/${encodeURIComponent(asset.id)}/restore`,
      { method: "POST" },
    );
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      id: asset.id,
      status: "ready",
      url: asset.url,
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
      origin: { scope: "global", entryId: globalAsset.id },
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
      { method: "DELETE" },
    );
    const linkedMedia = await app.request(projectLink.url!);
    expect(linkedMedia.status).toBe(200);
    await expect(linkedMedia.text()).resolves.toBe("same-image-bytes");
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
    const rejectedDelete = await app.request(assetUrl, { method: "DELETE" });
    expect(
      rejectedDelete.status,
      await rejectedDelete.clone().text(),
    ).toBe(409);
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

    const removed = await app.request(assetUrl, { method: "DELETE" });
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
