import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import {
  createActionAssetBinding,
  createProjectAsset,
  createProjectTimeline,
  listActionAssetReferences,
  listProjectAssets,
  markActionAssetBindingAuthority,
  markProjectAssetAuthority,
  PROJECT_PRESENTATION_CONTAINER,
  projectAssetAuthorityVersion,
  readActionAssetBinding,
  readProjectAsset,
  type Asset,
  type ActionAssetBinding,
  type ProjectAssetEntry,
} from "@clash/shared-types";

import { FileReplicaStore } from "./loro/file-replica-store.js";
import { createLocalMetadataStore } from "./local-metadata-store.js";
import {
  LocalProjectAssetMigrationError,
  createLocalProjectAssetService,
  publishLocalProjectAssetWithBindings,
} from "./local-project-assets.js";

async function fixture() {
  const clashRoot = await mkdtemp(join(tmpdir(), "clash-project-assets-"));
  const dataDir = join(clashRoot, "local-api");
  return {
    clashRoot,
    dataDir,
    replicas: new FileReplicaStore(join(dataDir, "projects")),
    metadata: createLocalMetadataStore(dataDir),
    service: createLocalProjectAssetService({
      dataDir,
      clashRoot,
      projectionOrigin: "http://127.0.0.1:49152",
    }),
  };
}

function legacyAsset(input: {
  id: string;
  storageKey: string;
  digest?: string;
  bytes: number;
}): Asset {
  return {
    id: input.id,
    userId: "local-user",
    kind: "image",
    srcR2Key: input.storageKey,
    coverR2Key: null,
    metadata: {
      bytes: input.bytes,
      contentType: "image/png",
      ...(input.digest ? { contentHash: input.digest } : {}),
      originalName: "legacy.png",
    },
    sourceModel: null,
    sourcePrompt: null,
    sourceTaskId: null,
    sources: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function seedLegacyAsset(
  store: ReturnType<typeof createLocalMetadataStore>,
  asset: Asset,
  ref: { assetId: string; projectId: string; importedAt: number },
): Promise<void> {
  const state = await store.load();
  state.assets = [
    ...state.assets.filter((item) => item.id !== asset.id),
    asset,
  ];
  state.assetRefs = [
    ...state.assetRefs.filter(
      (item) =>
        item.assetId !== ref.assetId || item.projectId !== ref.projectId,
    ),
    ref,
  ];
  await store.save(state, { replaceLegacyAssetMigrationInput: true });
}

describe("Local Project Asset service", () => {
  it("publishes one Project Asset and its immutable bindings atomically and idempotently", () => {
    const doc = new LoroDoc();
    const entry: ProjectAssetEntry = {
      id: "generated-output",
      kind: "image",
      source: {
        kind: "owned",
        resourceId: `sha256:${"a".repeat(64)}`,
      },
      lifecycle: { state: "active" },
      metadata: { bytes: 10, contentType: "image/png" },
    };
    const output: ActionAssetBinding = {
      id: "run-1:output:0",
      owner: {
        kind: "run",
        actionId: "action-1",
        actionRevisionId: "revision-1",
        actionRunId: "run-1",
      },
      direction: "output",
      slot: "output:0",
      projectAssetId: entry.id,
      role: "primary",
    };

    expect(publishLocalProjectAssetWithBindings(doc, entry, [output])).toEqual({
      entry,
      bindings: [output],
      changed: true,
    });
    expect(publishLocalProjectAssetWithBindings(doc, entry, [output])).toEqual({
      entry,
      bindings: [output],
      changed: false,
    });

    const conflictDoc = new LoroDoc();
    const otherEntry: ProjectAssetEntry = {
      ...entry,
      id: "other-output",
      source: {
        kind: "owned",
        resourceId: `sha256:${"b".repeat(64)}`,
      },
    };
    const laterConflict: ActionAssetBinding = {
      ...output,
      id: "run-1:output:1",
      slot: "output:1",
    };
    expect(createProjectAsset(conflictDoc, otherEntry)).toMatchObject({
      ok: true,
    });
    expect(
      createActionAssetBinding(conflictDoc, {
        ...laterConflict,
        projectAssetId: otherEntry.id,
      }),
    ).toMatchObject({ ok: true });

    expect(() =>
      publishLocalProjectAssetWithBindings(conflictDoc, entry, [
        output,
        laterConflict,
      ]),
    ).toThrow(/already identifies different facts/);
    expect(readProjectAsset(conflictDoc, entry.id)).toBeNull();
    expect(readActionAssetBinding(conflictDoc, output.id)).toBeNull();
    expect(readActionAssetBinding(conflictDoc, laterConflict.id)).toMatchObject(
      {
        projectAssetId: otherEntry.id,
      },
    );
  });

  it("persists an invalid Project cover selector cleanup after authority cutover", async () => {
    const doc = new LoroDoc();
    expect(markProjectAssetAuthority(doc)).toMatchObject({ ok: true });
    expect(markActionAssetBindingAuthority(doc)).toMatchObject({ ok: true });
    doc
      .getMap(PROJECT_PRESENTATION_CONTAINER)
      .set("coverBindingId", "missing-cover-binding");
    let save = false;
    const { dataDir } = await fixture();
    const service = createLocalProjectAssetService({
      dataDir,
      projectionOrigin: "http://127.0.0.1:49152",
      replica: {
        inspect: async (_projectId, read) => read(doc),
        mutate: async (_projectId, mutation) => {
          const result = await mutation(doc);
          save = result.save === true;
          return result.value;
        },
      },
    });

    await service.materialize("project-with-stale-cover");

    expect(save).toBe(true);
    expect(
      doc.getMap(PROJECT_PRESENTATION_CONTAINER).get("coverBindingId"),
    ).toBeUndefined();
  });

  it("does not treat legacy Timeline fields as a live binding index after cutover", async () => {
    const doc = new LoroDoc();
    expect(
      createProjectAsset(doc, {
        id: "timeline-source",
        kind: "video",
        source: {
          kind: "owned",
          resourceId: `sha256:${"a".repeat(64)}`,
        },
        lifecycle: { state: "active" },
        metadata: { bytes: 1, contentType: "video/mp4" },
      }),
    ).toMatchObject({ ok: true });
    expect(
      createProjectTimeline(doc, {
        id: "timeline-1",
        name: "Timeline",
        state: {
          tracks: [
            {
              id: "track-1",
              items: [{ id: "clip-1", assetId: "timeline-source" }],
            },
          ],
        },
      }),
    ).toMatchObject({ ok: true });
    expect(markProjectAssetAuthority(doc)).toMatchObject({ ok: true });
    expect(markActionAssetBindingAuthority(doc)).toMatchObject({ ok: true });
    expect(listActionAssetReferences(doc, "timeline-source")).toEqual([]);

    const { dataDir } = await fixture();
    const service = createLocalProjectAssetService({
      dataDir,
      projectionOrigin: "http://127.0.0.1:49152",
      replica: {
        inspect: async (_projectId, read) => read(doc),
        mutate: async (_projectId, mutation) => (await mutation(doc)).value,
      },
    });
    await service.materialize("project-after-cutover");

    expect(listActionAssetReferences(doc, "timeline-source")).toEqual([]);
  });

  it("materializes legacy rows and their bytes before marking Project Loro authoritative", async () => {
    const { dataDir, metadata, replicas, service } = await fixture();
    const projectId = "legacy-project";
    const bytes = new TextEncoder().encode("legacy image bytes");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const storageKey = "generated/legacy.png";
    const path = join(dataDir, "assets", storageKey);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, bytes);
    const asset = legacyAsset({
      id: "legacy-asset",
      storageKey,
      digest,
      bytes: bytes.byteLength,
    });
    await seedLegacyAsset(metadata, asset, {
      assetId: asset.id,
      projectId,
      importedAt: 1,
    });

    await service.materialize(projectId);

    const doc = await replicas.recover(projectId);
    expect(projectAssetAuthorityVersion(doc)).toBe(1);
    expect(listProjectAssets(doc)).toEqual([
      expect.objectContaining({
        id: "legacy-asset",
        source: { kind: "owned", resourceId: `sha256:${digest}` },
      }),
    ]);
    await expect(service.list(projectId)).resolves.toEqual([
      expect.objectContaining({ id: "legacy-asset", status: "ready" }),
    ]);
  });

  it("leaves the authority marker absent when legacy digest verification fails", async () => {
    const { dataDir, metadata, replicas, service } = await fixture();
    const projectId = "bad-legacy-project";
    const bytes = new TextEncoder().encode("actual bytes");
    const storageKey = "generated/bad.png";
    const path = join(dataDir, "assets", storageKey);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, bytes);
    const asset = legacyAsset({
      id: "bad-asset",
      storageKey,
      digest: "a".repeat(64),
      bytes: bytes.byteLength,
    });
    await seedLegacyAsset(metadata, asset, {
      assetId: asset.id,
      projectId,
      importedAt: 1,
    });

    await expect(service.materialize(projectId)).rejects.toMatchObject({
      code: "RESOURCE_DIGEST_MISMATCH",
    });
    expect(
      projectAssetAuthorityVersion(await replicas.recover(projectId)),
    ).toBeUndefined();
  });

  it("never falls back to legacy membership after the one-way cutover", async () => {
    const { dataDir, metadata, service } = await fixture();
    const projectId = "cut-over-project";
    await service.materialize(projectId);
    const bytes = new TextEncoder().encode("late legacy write");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const storageKey = "generated/late.png";
    const path = join(dataDir, "assets", storageKey);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, bytes);
    const asset = legacyAsset({
      id: "late-asset",
      storageKey,
      digest,
      bytes: bytes.byteLength,
    });
    await seedLegacyAsset(metadata, asset, {
      assetId: asset.id,
      projectId,
      importedAt: 2,
    });

    await expect(service.list(projectId)).resolves.toEqual([]);
  });

  it("scopes media projection reads to the Project authority", async () => {
    const { service } = await fixture();
    const installed = await service.installOwned({
      projectId: "project-a",
      projectAssetId: "output-1",
      kind: "video",
      bytes: new TextEncoder().encode("video bytes"),
      contentType: "video/mp4",
      name: "result.mp4",
      metadata: { durationMs: 1000 },
      provenance: { kind: "generation", actionRunId: "run-1" },
    });

    await expect(
      service.openProjection("project-a", installed.id),
    ).resolves.toMatchObject({ resource: { kind: "video" } });
    await expect(
      service.openProjection("project-b", installed.id),
    ).rejects.toMatchObject({ code: "PROJECT_ASSET_NOT_FOUND" });
  });

  it("resolves a Host-private staged Resource without writing Loro", async () => {
    const { replicas, service } = await fixture();
    const bytes = new TextEncoder().encode("staged plugin output");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const staged = await service.stageOwned({
      kind: "image",
      bytes,
      contentType: "image/png",
      name: "result.png",
    });

    await expect(
      service.resolveStagedOwned(`sha256:${digest}`),
    ).resolves.toEqual(staged);
    expect(
      projectAssetAuthorityVersion(await replicas.recover("project-a")),
    ).toBeUndefined();
  });

  it("reads the Host-private Project membership entry after materialization", async () => {
    const { service } = await fixture();
    const installed = await service.installOwned({
      projectId: "project-a",
      projectAssetId: "owned-entry",
      kind: "image",
      bytes: new TextEncoder().encode("owned bytes"),
      contentType: "image/png",
      name: "owned.png",
      metadata: {},
    });

    const entry = await service.readEntry("project-a", installed.id);

    expect(entry).toMatchObject({
      id: "owned-entry",
      kind: "image",
      name: "owned.png",
      source: {
        kind: "owned",
        resourceId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
      lifecycle: { state: "active" },
    });
  });

  it("uses immutable ensure semantics for authority binding retries", async () => {
    const { service } = await fixture();
    const installed = await service.installOwned({
      projectId: "binding-project",
      projectAssetId: "binding-target",
      kind: "image",
      bytes: new TextEncoder().encode("binding target"),
      contentType: "image/png",
      metadata: {},
    });
    const expected: ActionAssetBinding = {
      id: "stable-output-binding",
      owner: {
        kind: "run",
        actionId: "action-1",
        actionRevisionId: "revision-1",
        actionRunId: "run-1",
      },
      direction: "output",
      slot: "output:0",
      projectAssetId: installed.id,
    };

    await expect(service.bind("binding-project", expected)).resolves.toEqual(
      expected,
    );
    await expect(service.bind("binding-project", expected)).resolves.toEqual(
      expected,
    );
    await expect(
      service.bind("binding-project", {
        ...expected,
        slot: "output:1",
      }),
    ).rejects.toMatchObject({ code: "ACTION_ASSET_BINDING_ID_COLLISION" });
  });

  it("admits a linked Global Resource without copying bytes or exposing storage identity", async () => {
    const { service } = await fixture();
    const bytes = new TextEncoder().encode("shared global bytes");
    const global = await service.installOwned({
      projectId: "global-catalog",
      projectAssetId: "global-entry",
      kind: "image",
      bytes,
      contentType: "image/png",
      name: "shared.png",
      metadata: {},
    });
    const globalEntry = await service.readEntry("global-catalog", global.id);
    expect(globalEntry?.source.kind).toBe("owned");
    const resourceId = globalEntry!.source.resourceId;

    const linked = await service.admitLinked({
      projectId: "project-a",
      kind: "image",
      resourceId,
      originEntryId: "global-entry",
      name: "shared.png",
      metadata: {
        bytes: bytes.byteLength,
        contentType: "image/png",
        originalName: "shared.png",
      },
    });

    expect(linked.id).toMatch(/^asset:[0-9a-f-]{36}$/);
    expect(linked).toMatchObject({
      kind: "image",
      name: "shared.png",
      status: "ready",
    });
    expect(JSON.stringify(linked)).not.toMatch(/resourceId|storageKey|sha256:/);
    await expect(
      service.readEntry("project-a", linked.id),
    ).resolves.toMatchObject({
      id: linked.id,
      source: {
        kind: "linked",
        resourceId,
        origin: { scope: "global", entryId: "global-entry" },
      },
    });

    const globalProjection = await service.openProjection(
      "global-catalog",
      global.id,
    );
    const linkedProjection = await service.openProjection(
      "project-a",
      linked.id,
    );
    expect(linkedProjection.path).toBe(globalProjection.path);
    expect(linkedProjection.storageKey).toBe(globalProjection.storageKey);
  });

  it("fails a migration with a structured error when legacy bytes are missing", async () => {
    const { metadata, service } = await fixture();
    const projectId = "missing-bytes";
    const asset = legacyAsset({
      id: "missing-asset",
      storageKey: "generated/missing.png",
      bytes: 10,
    });
    await seedLegacyAsset(metadata, asset, {
      assetId: asset.id,
      projectId,
      importedAt: 1,
    });

    await expect(service.materialize(projectId)).rejects.toBeInstanceOf(
      LocalProjectAssetMigrationError,
    );
    await expect(service.materialize(projectId)).rejects.toMatchObject({
      code: "RESOURCE_DIGEST_UNAVAILABLE",
    });
  });

  it("refuses to reinterpret an already-published Project Asset as different bytes", async () => {
    const { service } = await fixture();
    await service.installOwned({
      projectId: "project-a",
      projectAssetId: "stable-output",
      kind: "image",
      bytes: new TextEncoder().encode("first output"),
      contentType: "image/png",
      metadata: {},
    });

    await expect(
      service.installOwned({
        projectId: "project-a",
        projectAssetId: "stable-output",
        kind: "image",
        bytes: new TextEncoder().encode("different output"),
        contentType: "image/png",
        metadata: {},
      }),
    ).rejects.toMatchObject({ code: "PROJECT_ASSET_ID_COLLISION" });
  });
});
