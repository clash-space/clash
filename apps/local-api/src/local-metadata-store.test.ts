import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createLocalMetadataStore } from "./local-metadata-store";

const require = createRequire(import.meta.url);

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "clash-local-metadata-store-"));
}

function readSqlitePragma(dataDir: string, pragma: string): string | number | undefined {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      prepare(sql: string): { get(): Record<string, string | number> | undefined };
      close(): void;
    };
  };
  const db = new DatabaseSync(join(dataDir, "local.sqlite"));
  try {
    const row = db.prepare(`PRAGMA ${pragma}`).get();
    return row ? Object.values(row)[0] : undefined;
  } finally {
    db.close();
  }
}

function createPartialCoreMetadataSqlite(dataDir: string): void {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      close(): void;
    };
  };
  const db = new DatabaseSync(join(dataDir, "local.sqlite"));
  try {
    db.exec(`
      CREATE TABLE local_migration (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE project (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE project_preview_asset (project_id TEXT NOT NULL);
      CREATE TABLE assets (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE asset_refs (
        asset_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        PRIMARY KEY (asset_id, project_id)
      );
      CREATE TABLE asset_node_refs (asset_id TEXT NOT NULL);
      CREATE TABLE text_revisions (revision_id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE timeline_revisions (revision_id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE runtime_session (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE agent_member (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE chat_message (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        PRIMARY KEY (session_id, id)
      );
      CREATE TABLE room_message (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE mutation_audit (id TEXT PRIMARY KEY NOT NULL);
    `);
  } finally {
    db.close();
  }
}

describe("local metadata store", () => {
  it("initializes sqlite metadata with WAL journal mode for local multi-client safety", async () => {
    const dataDir = await tempDir();
    const store = createLocalMetadataStore(dataDir);

    await store.save({
      projects: [],
      assets: [],
      assetRefs: [],
      assetNodeRefs: [],
      sessions: [],
      agentMembers: [],
      sessionMessages: [],
      roomMessages: [],
    });

    expect(readSqlitePragma(dataDir, "journal_mode")).toBe("wal");
  });

  it("upgrades partial sqlite metadata and projection tables before local-api metadata access", async () => {
    const dataDir = await tempDir();
    createPartialCoreMetadataSqlite(dataDir);
    const store = createLocalMetadataStore(dataDir);

    await expect(store.load()).resolves.toMatchObject({
      projects: [],
      assets: [],
      assetRefs: [],
      sessions: [],
      roomMessages: [],
    });
    await expect(store.save({
      projects: [
        {
          id: "project-upgraded",
          ownerId: "local-user",
          name: "Upgraded Project",
          description: null,
          createdAt: "2026-07-08T00:00:00.000Z",
          updatedAt: "2026-07-08T00:01:00.000Z",
          assets: [],
        },
      ],
      assets: [],
      assetRefs: [],
      assetNodeRefs: [],
      sessions: [],
      agentMembers: [],
      sessionMessages: [],
      roomMessages: [],
    })).resolves.toBeUndefined();
    await expect(store.load()).resolves.toMatchObject({
      projects: [{ id: "project-upgraded", ownerId: "local-user" }],
    });
  });

  it("round-trips soft-deleted project metadata", async () => {
    const dataDir = await tempDir();
    const store = createLocalMetadataStore(dataDir);

    await store.save({
      projects: [
        {
          id: "project-deleted",
          ownerId: "local-user",
          name: "Deleted Project",
          description: null,
          createdAt: "2026-07-07T00:00:00.000Z",
          updatedAt: "2026-07-07T00:01:00.000Z",
          deletedAt: "2026-07-07T00:02:00.000Z",
          assets: [],
        },
      ],
      assets: [],
      assetRefs: [],
      assetNodeRefs: [],
      sessions: [],
      agentMembers: [],
      sessionMessages: [],
      roomMessages: [],
    });

    await expect(store.load()).resolves.toMatchObject({
      projects: [
        {
          id: "project-deleted",
          deletedAt: "2026-07-07T00:02:00.000Z",
        },
      ],
    });
  });

  it("resolves asset storage keys only through the requesting project's refs", async () => {
    const dataDir = await tempDir();
    const store = createLocalMetadataStore(dataDir);

    await store.save({
      projects: [],
      assets: [
        {
          id: "asset-shared-id",
          userId: "local-user",
          kind: "image",
          srcR2Key: "projects/project-a/images/frame.png",
          coverR2Key: null,
          metadata: null,
          sourceModel: null,
          sourcePrompt: null,
          sourceTaskId: null,
          sources: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      assetRefs: [
        { assetId: "asset-shared-id", projectId: "project-a", importedAt: 1 },
      ],
      assetNodeRefs: [],
      sessions: [],
      agentMembers: [],
      sessionMessages: [],
      roomMessages: [],
    });

    await expect(store.resolveStorageKeys("project-a", ["asset-shared-id"])).resolves.toEqual([
      "projects/project-a/images/frame.png",
    ]);
    await expect(store.resolveStorageKeys("project-b", ["asset-shared-id"])).resolves.toEqual([]);
  });

  it("persists sanitized local mutation audit records outside metadata rewrites", async () => {
    const dataDir = await tempDir();
    const store = createLocalMetadataStore(dataDir);

    await store.appendMutationAudit({
      id: "audit-project-purge",
      createdAt: 1783428000000,
      operation: "project_purge",
      entity: { kind: "project", id: "project-audit" },
      actorClientType: "agent",
      forced: true,
      accepted: true,
      reason: "project purge",
      resultEntityId: "project-audit",
      error: null,
      mutation: {
        operation: "project_purge",
        entity: { kind: "project", id: "project-audit" },
        forced: true,
        accepted: true,
        resultEntityId: "project-audit",
      },
    });

    await store.save({
      projects: [],
      assets: [],
      assetRefs: [],
      assetNodeRefs: [],
      sessions: [],
      agentMembers: [],
      sessionMessages: [],
      roomMessages: [],
    });

    await expect(store.listMutationAudit({ operation: "project_purge", limit: 10 })).resolves.toEqual([
      {
        id: "audit-project-purge",
        createdAt: 1783428000000,
        operation: "project_purge",
        entity: { kind: "project", id: "project-audit" },
        actorClientType: "agent",
        forced: true,
        accepted: true,
        reason: "project purge",
        resultEntityId: "project-audit",
        error: null,
        mutation: {
          operation: "project_purge",
          entity: { kind: "project", id: "project-audit" },
          forced: true,
          accepted: true,
          resultEntityId: "project-audit",
        },
      },
    ]);
  });

  it("persists room sync conflict resolutions outside metadata rewrites", async () => {
    const dataDir = await tempDir();
    const store = createLocalMetadataStore(dataDir);

    await store.upsertRoomSyncConflictResolution({
      projectId: "project-room",
      messageId: "room-conflict",
      strategy: "accept-divergence",
      localContentHash: "local-hash",
      remoteContentHash: "remote-hash",
      resolvedAt: 1783428000000,
      mutationId: "audit-room-conflict",
    });

    await store.save({
      projects: [],
      assets: [],
      assetRefs: [],
      assetNodeRefs: [],
      sessions: [],
      agentMembers: [],
      sessionMessages: [],
      roomMessages: [],
    });

    await expect(store.listRoomSyncConflictResolutions({ projectId: "project-room" })).resolves.toEqual([
      {
        projectId: "project-room",
        messageId: "room-conflict",
        strategy: "accept-divergence",
        localContentHash: "local-hash",
        remoteContentHash: "remote-hash",
        resolvedAt: 1783428000000,
        mutationId: "audit-room-conflict",
      },
    ]);
  });
});
