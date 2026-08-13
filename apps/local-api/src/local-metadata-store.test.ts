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

function readSqlitePragma(
  dataDir: string,
  pragma: string,
): string | number | undefined {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      prepare(sql: string): {
        get(): Record<string, string | number> | undefined;
      };
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

function readMetadataMigrationMarker(
  dataDir: string,
): Record<string, unknown> | undefined {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      prepare(sql: string): {
        get(...params: unknown[]): Record<string, unknown> | undefined;
      };
      close(): void;
    };
  };
  const db = new DatabaseSync(join(dataDir, "local.sqlite"));
  try {
    return db
      .prepare("SELECT id, source_path FROM local_migration WHERE id = ?")
      .get("metadata-sqlite-v1");
  } finally {
    db.close();
  }
}

function readSqliteObjectName(
  dataDir: string,
  type: string,
  name: string,
): string | undefined {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      prepare(sql: string): {
        get(...params: unknown[]): Record<string, unknown> | undefined;
      };
      close(): void;
    };
  };
  const db = new DatabaseSync(join(dataDir, "local.sqlite"));
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?")
      .get(type, name);
    return typeof row?.name === "string" ? row.name : undefined;
  } finally {
    db.close();
  }
}

function readSqliteTableColumns(dataDir: string, table: string): string[] {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      prepare(sql: string): { all(): Array<Record<string, unknown>> };
      close(): void;
    };
  };
  const db = new DatabaseSync(join(dataDir, "local.sqlite"));
  try {
    return db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => String(row.name ?? ""));
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
      CREATE TABLE runtime_session (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE agent_member (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE chat_message (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        PRIMARY KEY (session_id, id)
      );
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
    });

    expect(readSqlitePragma(dataDir, "journal_mode")).toBe("wal");
    expect(readSqliteObjectName(dataDir, "table", "local_config")).toBe(
      "local_config",
    );
    expect(
      readSqliteObjectName(dataDir, "table", "timeline_revisions"),
    ).toBeUndefined();
  });

  it("keeps legacy Asset migration rows read-only during ordinary metadata saves", async () => {
    const dataDir = await tempDir();
    const store = createLocalMetadataStore(dataDir);
    const legacy = {
      projects: [],
      assets: [
        {
          id: "legacy-asset",
          userId: "legacy-user",
          kind: "image" as const,
          srcR2Key: "uploads/legacy.png",
          coverR2Key: null,
          metadata: { contentType: "image/png" },
          sourceModel: null,
          sourcePrompt: null,
          sourceTaskId: null,
          sources: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      assetRefs: [
        { assetId: "legacy-asset", projectId: "project-1", importedAt: 1 },
      ],
      libraryAssetRefs: [
        { assetId: "legacy-asset", userId: "legacy-user", addedAt: 1 },
      ],
      assetNodeRefs: [
        {
          assetId: "legacy-asset",
          projectId: "project-1",
          nodeId: "node-1",
          nodeType: "image",
          fieldPath: "data.assetId",
          referenceRole: "asset",
          observedAt: 1,
        },
      ],
      sessions: [],
      agentMembers: [],
      sessionMessages: [],
    };

    await store.save(legacy, { replaceLegacyAssetMigrationInput: true });
    await store.save({
      ...legacy,
      assets: [],
      assetRefs: [],
      libraryAssetRefs: [],
      assetNodeRefs: [],
      projects: [
        {
          id: "project-1",
          ownerId: "local-user",
          name: "Project",
          description: null,
          createdAt: "2026-08-13T00:00:00.000Z",
          updatedAt: "2026-08-13T00:00:00.000Z",
          assets: [],
        },
      ],
    });

    await expect(store.load()).resolves.toMatchObject({
      assets: [{ id: "legacy-asset", srcR2Key: "uploads/legacy.png" }],
      assetRefs: [{ assetId: "legacy-asset", projectId: "project-1" }],
      libraryAssetRefs: [
        { assetId: "legacy-asset", userId: "legacy-user" },
      ],
      assetNodeRefs: [
        {
          assetId: "legacy-asset",
          projectId: "project-1",
          nodeId: "node-1",
        },
      ],
      projects: [{ id: "project-1" }],
    });
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
    });
    await expect(
      store.save({
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
      }),
    ).resolves.toBeUndefined();
    await expect(store.load()).resolves.toMatchObject({
      projects: [
        {
          id: "project-upgraded",
          ownerId: "local-user",
        },
      ],
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

  it("persists sanitized local mutation audit records outside metadata rewrites", async () => {
    const dataDir = await tempDir();
    const store = createLocalMetadataStore(dataDir);

    await store.appendMutationAudit({
      id: "audit-project-purge",
      createdAt: 1783428000000,
      operation: "project_purge",
      entity: { kind: "project", id: "project-audit" },
      actorClientType: "agent",
      accepted: true,
      reason: "project purge",
      resultEntityId: "project-audit",
      error: null,
      mutation: {
        operation: "project_purge",
        entity: { kind: "project", id: "project-audit" },
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
    });

    await expect(
      store.listMutationAudit({ operation: "project_purge", limit: 10 }),
    ).resolves.toEqual([
      {
        id: "audit-project-purge",
        createdAt: 1783428000000,
        operation: "project_purge",
        entity: { kind: "project", id: "project-audit" },
        actorClientType: "agent",
        accepted: true,
        reason: "project purge",
        resultEntityId: "project-audit",
        error: null,
        mutation: {
          operation: "project_purge",
          entity: { kind: "project", id: "project-audit" },
          accepted: true,
          resultEntityId: "project-audit",
        },
      },
    ]);
    expect(readSqliteTableColumns(dataDir, "mutation_audit")).not.toContain(
      "forced",
    );
  });

  it("marks sqlite metadata authoritative after an audit-only write", async () => {
    const dataDir = await tempDir();
    const store = createLocalMetadataStore(dataDir);

    await store.appendMutationAudit({
      id: "audit-rejected-text-apply",
      createdAt: 1783428000000,
      operation: "text_revision_index",
      entity: { kind: "text", id: "project-text:script" },
      actorClientType: "agent",
      accepted: false,
      reason: "text revision rejected",
      resultEntityId: null,
      error: "text revision contentHash does not match content",
      mutation: {
        operation: "text_revision_index",
        entity: { kind: "text", id: "project-text:script" },
        accepted: false,
        error: "text revision contentHash does not match content",
      },
    });

    expect(readMetadataMigrationMarker(dataDir)).toMatchObject({
      id: "metadata-sqlite-v1",
      source_path: join(dataDir, "local.sqlite"),
    });
  });

  it("persists typed plugin SDK audit without credential material", async () => {
    const dataDir = await tempDir();
    const store = createLocalMetadataStore(dataDir) as ReturnType<
      typeof createLocalMetadataStore
    > & {
      appendPluginBrokerAudit(record: Record<string, unknown>): Promise<void>;
      listPluginBrokerAudit(filter?: {
        pluginId?: string;
        limit?: number;
      }): Promise<Array<Record<string, unknown>>>;
    };
    expect(typeof store.appendPluginBrokerAudit).toBe("function");
    expect(typeof store.listPluginBrokerAudit).toBe("function");
    if (!store.appendPluginBrokerAudit || !store.listPluginBrokerAudit) return;

    await store.appendPluginBrokerAudit({
      id: "broker-audit-1",
      occurredAt: "2026-08-04T12:00:00.000Z",
      pluginId: "test.broker-plugin",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      invocationId: "invocation-1",
      requestId: "store-1",
      operation: "store.get",
      target: "apiKey",
      status: "ok",
    });

    const records = await store.listPluginBrokerAudit({
      pluginId: "test.broker-plugin",
      limit: 10,
    });
    expect(records).toEqual([
      {
        id: "broker-audit-1",
        occurredAt: "2026-08-04T12:00:00.000Z",
        pluginId: "test.broker-plugin",
        pluginVersion: "1.0.0",
        projectId: "project-1",
        invocationId: "invocation-1",
        requestId: "store-1",
        operation: "store.get",
        target: "apiKey",
        status: "ok",
        error: null,
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("super-secret");
  });
});

describe("asset metadata index", () => {
  it("upserts one row per attached kind and lists by asset, kind, and project", async () => {
    const store = createLocalMetadataStore(await tempDir());
    const identity = {
      kind: "media.transcript",
      schemaVersion: 1,
      backendId: "mlx-whisper",
      contentHash: `sha256:${"b".repeat(64)}`,
      bodyHash: `sha256:${"c".repeat(64)}`,
      summary: { wordCount: 17, durationMs: 4_820 },
    };
    await store.upsertAssetMetadataIndex({
      assetId: "asset-speech",
      metadataKind: "media.transcript",
      projectId: "project-1",
      schemaVersion: 1,
      contentHash: identity.contentHash,
      bodyHash: identity.bodyHash,
      producer: "clash.local.asr",
      summary: identity.summary,
      identity,
    });
    // Re-attaching replaces the row instead of stacking a second one.
    await store.upsertAssetMetadataIndex({
      assetId: "asset-speech",
      metadataKind: "media.transcript",
      projectId: "project-1",
      schemaVersion: 1,
      contentHash: identity.contentHash,
      bodyHash: `sha256:${"d".repeat(64)}`,
      producer: "clash.local.asr",
      summary: { wordCount: 18, durationMs: 5_000 },
      identity: { ...identity, bodyHash: `sha256:${"d".repeat(64)}` },
    });
    await store.upsertAssetMetadataIndex({
      assetId: "asset-other",
      metadataKind: "team.shot-notes",
      producer: "qa",
      identity: { kind: "team.shot-notes", schemaVersion: 1, mood: "calm" },
    });

    const all = await store.listAssetMetadataIndex();
    expect(all).toHaveLength(2);

    const transcripts = await store.listAssetMetadataIndex({
      metadataKind: "media.transcript",
    });
    expect(transcripts).toHaveLength(1);
    expect(transcripts[0]).toMatchObject({
      assetId: "asset-speech",
      projectId: "project-1",
      bodyHash: `sha256:${"d".repeat(64)}`,
      summary: { wordCount: 18, durationMs: 5_000 },
    });

    const byAsset = await store.listAssetMetadataIndex({
      assetId: "asset-other",
    });
    expect(byAsset).toHaveLength(1);
    expect(byAsset[0].identity).toMatchObject({ mood: "calm" });
    expect(byAsset[0].projectId).toBeUndefined();
  });
});
