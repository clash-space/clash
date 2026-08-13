import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import {
  ActionAssetBindingSchema,
  ActionBindingOwnerSchema,
  GlobalAssetEntrySchema,
  ProjectAssetEntrySchema,
  ResolvedAssetSchema,
  ResourceSchema,
} from "./assets.js";

import {
  createProjectAsset,
  listProjectAssets,
  markProjectAssetAuthority,
  projectAssetAuthorityVersion,
  purgeProjectAsset,
  readProjectAsset,
  restoreProjectAsset,
  trashProjectAsset,
} from "./project-assets.js";

function mergePeers(
  left: LoroDoc,
  right: LoroDoc,
  leftVersion: ReturnType<LoroDoc["version"]>,
  rightVersion: ReturnType<LoroDoc["version"]>,
): void {
  const leftUpdate = left.export({ mode: "update", from: leftVersion });
  const rightUpdate = right.export({ mode: "update", from: rightVersion });
  left.import(rightUpdate);
  right.import(leftUpdate);
}

const owned = (id: string, resourceId = `resource-${id}`) => ({
  id,
  kind: "image" as const,
  source: { kind: "owned" as const, resourceId },
  lifecycle: { state: "active" as const },
  name: `Asset ${id}`,
  metadata: { width: 1024, height: 768, contentType: "image/png" },
});

describe("Project Asset contract", () => {
  it("defines Global library entries without Project or storage topology", () => {
    const global = {
      id: "global-1",
      kind: "image",
      resourceId: "sha256:abc",
      lifecycle: { state: "active" },
      name: "Library image",
      metadata: { width: 100, height: 100 },
    };

    expect(GlobalAssetEntrySchema.parse(global)).toEqual(global);
    expect(GlobalAssetEntrySchema.safeParse({ ...global, projectId: "project-1" }).success)
      .toBe(false);
    expect(GlobalAssetEntrySchema.safeParse({ ...global, storageKey: "bucket/key" }).success)
      .toBe(false);
  });

  it("defines one semantic Action Asset binding shape", () => {
    expect(ActionBindingOwnerSchema.parse({
      kind: "run",
      actionId: "action-1",
      actionRevisionId: "revision-1",
      actionRunId: "run-1",
    })).toMatchObject({ kind: "run", actionRunId: "run-1" });
    expect(ActionAssetBindingSchema.parse({
      id: "binding-1",
      owner: { kind: "draft", actionId: "action-1" },
      direction: "input",
      slot: "timeline:item:item-1",
      projectAssetId: "asset-1",
      role: "primary",
    })).toMatchObject({ id: "binding-1", projectAssetId: "asset-1" });
    expect(ActionAssetBindingSchema.safeParse({
      id: "binding-1",
      owner: { kind: "draft", actionId: "action-1" },
      direction: "input",
      slot: "reference:0",
      projectAssetId: "asset-1",
      url: "https://forbidden.example/a.png",
    }).success).toBe(false);
  });

  it("keeps storage topology and projections out of synchronized entries", () => {
    expect(ProjectAssetEntrySchema.safeParse({
      ...owned("asset-1"),
      url: "http://127.0.0.1/assets/a.png",
    }).success).toBe(false);
    expect(ProjectAssetEntrySchema.safeParse({
      ...owned("asset-1"),
      storageKey: "projects/p/assets/a.png",
    }).success).toBe(false);
    expect(ProjectAssetEntrySchema.safeParse({
      ...owned("asset-1"),
      metadata: { localBlobKey: "cas/a", remoteUrl: "https://cdn.example/a.png" },
    }).success).toBe(false);
    expect(ProjectAssetEntrySchema.safeParse({
      ...owned("asset-1"),
      metadata: { transcript: "production metadata belongs in a typed attachment" },
    }).success).toBe(false);
  });

  it("represents an admitted Resource with a Project-local linked identity", () => {
    expect(ProjectAssetEntrySchema.parse({
      ...owned("project-asset-1", "resource-shared"),
      source: {
        kind: "linked",
        resourceId: "resource-shared",
        origin: { scope: "global", entryId: "global-asset-1" },
      },
    }).source).toEqual({
      kind: "linked",
      resourceId: "resource-shared",
      origin: { scope: "global", entryId: "global-asset-1" },
    });
  });

  it("defines immutable Resource facts without embedding storage", () => {
    const resource = {
      id: "resource-1",
      kind: "image" as const,
      digest: { algorithm: "sha256" as const, value: "a".repeat(64) },
      byteLength: 42,
      contentType: "image/png",
    };
    expect(ResourceSchema.parse(resource)).toEqual(resource);
    expect(ResourceSchema.safeParse({ ...resource, storageKey: "bucket/key" }).success).toBe(false);
    expect(ResourceSchema.safeParse({ ...resource, url: "https://cdn.example/a.png" }).success)
      .toBe(false);
  });

  it("defines one read-only resolved projection", () => {
    expect(ResolvedAssetSchema.parse({
      id: "asset-1",
      kind: "image",
      name: "Hero",
      metadata: { width: 1024, height: 768 },
      lifecycle: { state: "active" },
      status: "ready",
      url: "https://host.example/assets/asset-1",
    })).toMatchObject({
      id: "asset-1",
      lifecycle: { state: "active" },
      status: "ready",
    });
    expect(ResolvedAssetSchema.safeParse({
      id: "asset-1",
      kind: "image",
      metadata: {},
      status: "unavailable",
    }).success).toBe(false);
    expect(ResolvedAssetSchema.safeParse({
      id: "asset-1",
      kind: "image",
      metadata: {},
      lifecycle: { state: "active" },
      status: "ready",
      storageKey: "bucket/key",
    }).success).toBe(false);
  });
});

describe("Project Asset Loro authority", () => {
  it("stores entries in their own Project collection and marks the authority version", () => {
    const doc = new LoroDoc();

    expect(markProjectAssetAuthority(doc)).toEqual({ ok: true, version: 1 });
    expect(createProjectAsset(doc, owned("asset-1"))).toMatchObject({ ok: true });
    expect(readProjectAsset(doc, "asset-1")).toEqual(owned("asset-1"));
    expect(doc.getMap("projectAssets").get("asset-1")).toBeDefined();
    expect(doc.getMap("nodes").size).toBe(0);
    expect(projectAssetAuthorityVersion(doc)).toBe(1);
  });

  it("does not mark a partially materialized legacy Project as cut over", () => {
    const doc = new LoroDoc();

    expect(createProjectAsset(doc, owned("asset-1"))).toMatchObject({ ok: true });
    expect(projectAssetAuthorityVersion(doc)).toBeUndefined();
  });

  it("preserves a materialized terminal tombstone", () => {
    const doc = new LoroDoc();
    const entry = {
      ...owned("asset-purged"),
      lifecycle: {
        state: "purged" as const,
        deleteOperationId: "delete-old",
        deletedAt: "2026-08-01T00:00:00.000Z",
        purgedAt: "2026-08-08T00:00:00.000Z",
      },
    };

    expect(createProjectAsset(doc, entry)).toMatchObject({ ok: true });
    expect(readProjectAsset(doc, entry.id)).toEqual(entry);
  });

  it("marks an empty migrated Project without inventing an Asset", () => {
    const doc = new LoroDoc();

    expect(markProjectAssetAuthority(doc)).toEqual({ ok: true, version: 1 });
    expect(projectAssetAuthorityVersion(doc)).toBe(1);
    expect(listProjectAssets(doc)).toEqual([]);
  });

  it("does not overwrite an invalid authority marker", () => {
    const doc = new LoroDoc();
    doc.getMap("projectAssetSchema").set("authorityVersion", "future-format");

    expect(markProjectAssetAuthority(doc)).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_PROJECT_ASSET_AUTHORITY" },
    });
    expect(doc.getMap("projectAssetSchema").get("authorityVersion")).toBe("future-format");
  });

  it("keeps the highest authority version across a concurrent stale marker write", () => {
    const base = new LoroDoc();
    const snapshot = base.export({ mode: "snapshot" });
    const futurePeer = LoroDoc.fromSnapshot(snapshot);
    const stalePeer = LoroDoc.fromSnapshot(snapshot);
    const futureVersion = futurePeer.version();
    const staleVersion = stalePeer.version();

    futurePeer.getMap("projectAssetSchema").set("authorityVersion", 2);
    expect(markProjectAssetAuthority(stalePeer)).toEqual({ ok: true, version: 1 });
    mergePeers(futurePeer, stalePeer, futureVersion, staleVersion);

    for (const doc of [futurePeer, stalePeer]) {
      expect(projectAssetAuthorityVersion(doc)).toBe(2);
      expect(createProjectAsset(doc, owned("asset-1"))).toMatchObject({
        ok: false,
        error: { code: "UNSUPPORTED_PROJECT_ASSET_AUTHORITY" },
      });
    }
  });

  it("blocks every mutation against a future authority version", () => {
    const doc = new LoroDoc();
    createProjectAsset(doc, owned("asset-1"));
    doc.getMap("projectAssetSchema").set("authorityVersion", 2);

    expect(trashProjectAsset(doc, {
      id: "asset-1",
      deleteOperationId: "delete-1",
      deletedAt: "2026-08-13T01:00:00.000Z",
      purgeAfter: "2026-08-20T01:00:00.000Z",
    })).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_PROJECT_ASSET_AUTHORITY" } });
    expect(restoreProjectAsset(doc, "asset-1")).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_PROJECT_ASSET_AUTHORITY" },
    });
    expect(purgeProjectAsset(doc, {
      id: "asset-1",
      deleteOperationId: "delete-1",
      purgedAt: "2026-08-21T01:00:00.000Z",
    })).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_PROJECT_ASSET_AUTHORITY" } });
  });

  it("does not reinterpret an unknown lifecycle as active", () => {
    const doc = new LoroDoc();
    createProjectAsset(doc, owned("asset-1"));
    const raw = doc.getMap("projectAssets").get("asset-1");
    if (!raw || typeof raw !== "object" || !("set" in raw)) throw new Error("missing entry");
    (raw as { set(key: string, value: unknown): void }).set("lifecycleState", "archived");

    expect(() => readProjectAsset(doc, "asset-1")).toThrow(/lifecycle/i);
  });

  it("fails closed when a terminal tombstone is present but malformed", () => {
    const doc = new LoroDoc();
    createProjectAsset(doc, owned("asset-1"));
    const raw = doc.getMap("projectAssets").get("asset-1");
    if (!raw || typeof raw !== "object" || !("set" in raw)) throw new Error("missing entry");
    (raw as { set(key: string, value: unknown): void }).set("terminalLifecycle", {
      state: "purged",
      purgedAt: "2026-08-21T01:00:00.000Z",
    });

    expect(() => readProjectAsset(doc, "asset-1")).toThrow(/terminal lifecycle/i);
  });

  it("merges concurrent additions without turning one entry into the authority for another", () => {
    const base = new LoroDoc();
    markProjectAssetAuthority(base);
    const snapshot = base.export({ mode: "snapshot" });
    const left = LoroDoc.fromSnapshot(snapshot);
    const right = LoroDoc.fromSnapshot(snapshot);
    const leftVersion = left.version();
    const rightVersion = right.version();

    createProjectAsset(left, owned("asset-a"));
    createProjectAsset(right, owned("asset-b"));
    mergePeers(left, right, leftVersion, rightVersion);

    for (const doc of [left, right]) {
      expect(listProjectAssets(doc).map((entry) => entry.id)).toEqual(["asset-a", "asset-b"]);
    }
  });

  it("keeps a purged tombstone terminal across a concurrent stale restore", () => {
    const base = new LoroDoc();
    createProjectAsset(base, owned("asset-1"));
    trashProjectAsset(base, {
      id: "asset-1",
      deleteOperationId: "delete-1",
      deletedAt: "2026-08-13T01:00:00.000Z",
      purgeAfter: "2026-08-20T01:00:00.000Z",
    });
    const snapshot = base.export({ mode: "snapshot" });
    const left = LoroDoc.fromSnapshot(snapshot);
    const right = LoroDoc.fromSnapshot(snapshot);
    const leftVersion = left.version();
    const rightVersion = right.version();

    expect(purgeProjectAsset(left, {
      id: "asset-1",
      deleteOperationId: "delete-1",
      purgedAt: "2026-08-21T01:00:00.000Z",
    })).toMatchObject({ ok: true });
    expect(restoreProjectAsset(right, "asset-1")).toMatchObject({ ok: true });
    mergePeers(left, right, leftVersion, rightVersion);

    for (const doc of [left, right]) {
      expect(readProjectAsset(doc, "asset-1")?.lifecycle).toEqual({
        state: "purged",
        deleteOperationId: "delete-1",
        deletedAt: "2026-08-13T01:00:00.000Z",
        purgedAt: "2026-08-21T01:00:00.000Z",
      });
      expect(restoreProjectAsset(doc, "asset-1")).toMatchObject({
        ok: false,
        error: { code: "PROJECT_ASSET_PURGED" },
      });
    }
  });

  it("keeps one coherent tombstone across a stale restore and second trash", () => {
    const base = new LoroDoc();
    createProjectAsset(base, owned("asset-1"));
    trashProjectAsset(base, {
      id: "asset-1",
      deleteOperationId: "delete-1",
      deletedAt: "2026-08-13T01:00:00.000Z",
      purgeAfter: "2026-08-20T01:00:00.000Z",
    });
    const snapshot = base.export({ mode: "snapshot" });
    const purgingPeer = LoroDoc.fromSnapshot(snapshot);
    const stalePeer = LoroDoc.fromSnapshot(snapshot);
    const purgingVersion = purgingPeer.version();
    const staleVersion = stalePeer.version();

    expect(purgeProjectAsset(purgingPeer, {
      id: "asset-1",
      deleteOperationId: "delete-1",
      purgedAt: "2026-08-21T01:00:00.000Z",
    })).toMatchObject({ ok: true });
    expect(restoreProjectAsset(stalePeer, "asset-1")).toMatchObject({ ok: true });
    expect(trashProjectAsset(stalePeer, {
      id: "asset-1",
      deleteOperationId: "delete-2",
      deletedAt: "2026-08-22T01:00:00.000Z",
      purgeAfter: "2026-08-29T01:00:00.000Z",
    })).toMatchObject({ ok: true });
    mergePeers(purgingPeer, stalePeer, purgingVersion, staleVersion);

    for (const doc of [purgingPeer, stalePeer]) {
      expect(readProjectAsset(doc, "asset-1")?.lifecycle).toEqual({
        state: "purged",
        deleteOperationId: "delete-1",
        deletedAt: "2026-08-13T01:00:00.000Z",
        purgedAt: "2026-08-21T01:00:00.000Z",
      });
    }
  });
});
