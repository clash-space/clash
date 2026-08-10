import { createRequire } from "node:module";
import { chmod, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { TextAppliedRevision } from "@clash/shared-types";
import type { Asset, AssetKind, AssetRefRow } from "@clash/shared-types/assets";

type SqlitePrimitive = string | number | null;

type SqliteStatement = {
  run(...params: SqlitePrimitive[]): unknown;
  get(...params: SqlitePrimitive[]): Record<string, unknown> | undefined;
  all(...params: SqlitePrimitive[]): Array<Record<string, unknown>>;
};

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
};

export interface LocalMetadataProjectAsset {
  id: string;
  name?: string;
  url: string;
  thumbnailUrl?: string;
  type: "image" | "video" | "audio";
  storageKey: string;
  createdAt: string | null;
}

export interface LocalMetadataProject {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  assets: LocalMetadataProjectAsset[];
}

export type LocalMetadataSessionType = "cloud" | "runtime";
export type LocalMetadataSessionStatus =
  "starting" | "active" | "closed" | "error";

export interface LocalMetadataSession {
  id: string;
  projectId: string;
  title: string;
  type?: LocalMetadataSessionType;
  runtimeId?: string;
  agentId?: string;
  agentTemplateId?: string;
  permissionMode?: string;
  acpSessionId?: string;
  status?: LocalMetadataSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMetadataSessionMessage {
  session_id: string;
  id: string;
  sender_kind: "user" | "agent";
  sender_id: string;
  turn_id: string | null;
  events: unknown[];
  created_at: number;
}

export interface LocalMetadataAgentMember {
  id: string;
  user_id: string;
  template_id: string;
  runtime_id: string;
  agent_id: string | null;
  display_name: string;
  created_at: number;
}

export interface LocalMetadataAssetNodeRef {
  assetId: string;
  projectId: string;
  nodeId: string;
  nodeType: string;
  fieldPath: string;
  referenceRole: string;
  observedAt: number;
}

export interface LocalMutationAuditRecord {
  id: string;
  createdAt: number;
  operation: string;
  entity: { kind: string; id: string };
  actorClientType: string | null;
  accepted: boolean;
  reason: string | null;
  resultEntityId: string | null;
  error: string | null;
  mutation: Record<string, unknown>;
}

export interface LocalMutationAuditFilter {
  operation?: string;
  entityId?: string;
  limit?: number;
}

export interface LocalPluginBrokerAuditRecord {
  id: string;
  occurredAt: string;
  pluginId: string;
  pluginVersion: string;
  projectId: string;
  invocationId: string;
  requestId: string;
  operation: string;
  target: string;
  status: "ok" | "error";
  error?: string | null;
}

export interface LocalPluginBrokerAuditFilter {
  pluginId?: string;
  invocationId?: string;
  limit?: number;
}

export interface LocalTextRevisionFilter {
  projectId: string;
  nodeId?: string;
  limit?: number;
}

export interface LocalMetadataDb {
  projects: LocalMetadataProject[];
  assets: Array<Asset & { projectId?: string }>;
  assetRefs: AssetRefRow[];
  libraryAssetRefs?: Array<{
    assetId: string;
    userId: string;
    addedAt: number;
  }>;
  assetNodeRefs: LocalMetadataAssetNodeRef[];
  sessions: LocalMetadataSession[];
  agentMembers: LocalMetadataAgentMember[];
  sessionMessages: LocalMetadataSessionMessage[];
}

const EMPTY_METADATA_DB: LocalMetadataDb = {
  projects: [],
  assets: [],
  assetRefs: [],
  libraryAssetRefs: [],
  assetNodeRefs: [],
  sessions: [],
  agentMembers: [],
  sessionMessages: [],
};

const METADATA_MIGRATION_ID = "metadata-sqlite-v1";
const require = createRequire(import.meta.url);

function sqlitePath(dataDir: string): string {
  return join(dataDir, "local.sqlite");
}

function openDatabase(path: string): SqliteDatabase {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const db = new DatabaseSync(path);
  configureDatabase(db);
  return db;
}

function configureDatabase(db: SqliteDatabase): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);
}

function applySchema(db: SqliteDatabase): void {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS local_migration (
      id TEXT PRIMARY KEY NOT NULL,
      completed_at INTEGER NOT NULL,
      source_path TEXT NOT NULL,
      source_sha256 TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS project_preview_asset (
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      created_at TEXT,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, asset_id, position)
    );

    CREATE TABLE IF NOT EXISTS asset_metadata_index (
      asset_id TEXT NOT NULL,
      metadata_kind TEXT NOT NULL,
      project_id TEXT,
      schema_version INTEGER,
      content_hash TEXT,
      body_hash TEXT,
      producer TEXT NOT NULL,
      summary_json TEXT,
      identity_json TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      PRIMARY KEY (asset_id, metadata_kind)
    );

    CREATE TABLE IF NOT EXISTS local_config (
      key TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      src_r2_key TEXT NOT NULL,
      cover_r2_key TEXT,
      metadata TEXT,
      source_model TEXT,
      source_prompt TEXT,
      source_task_id TEXT,
      sources TEXT,
      signed_url TEXT,
      signed_url_exp INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS asset_refs (
      asset_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      PRIMARY KEY (asset_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS asset_library_refs (
      asset_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (asset_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS asset_node_refs (
      asset_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      field_path TEXT NOT NULL,
      reference_role TEXT NOT NULL DEFAULT 'asset',
      observed_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, node_id, field_path, asset_id)
    );

    CREATE TABLE IF NOT EXISTS text_revisions (
      revision_id TEXT PRIMARY KEY NOT NULL,
      text_id TEXT NOT NULL,
      parent_revision_id TEXT,
      project_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      hash_algorithm TEXT NOT NULL,
      source_file_path TEXT NOT NULL,
      source_file_hash TEXT NOT NULL,
      actor_json TEXT
    );

    CREATE TABLE IF NOT EXISTS runtime_session (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      runtime_id TEXT,
      agent_id TEXT,
      agent_template_id TEXT,
      permission_mode TEXT,
      acp_session_id TEXT,
      status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_member (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      agent_id TEXT,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_message (
      session_id TEXT NOT NULL,
      id TEXT NOT NULL,
      sender_kind TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      turn_id TEXT,
      events_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, id)
    );

	    CREATE TABLE IF NOT EXISTS mutation_audit (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      operation TEXT NOT NULL,
      entity_kind TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      actor_client_type TEXT,
      accepted INTEGER NOT NULL,
      reason TEXT,
      result_entity_id TEXT,
      error TEXT,
	      mutation_json TEXT NOT NULL
	    );

    CREATE TABLE IF NOT EXISTS plugin_broker_audit (
      id TEXT PRIMARY KEY NOT NULL,
      occurred_at TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      plugin_version TEXT NOT NULL,
      project_id TEXT NOT NULL,
      invocation_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      target TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT
    );
    COMMIT;
  `);
  ensureLocalMetadataColumns(db);
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE INDEX IF NOT EXISTS project_owner_idx ON project(owner_id, updated_at);
    CREATE INDEX IF NOT EXISTS assets_user_idx ON assets(user_id, created_at);
    CREATE INDEX IF NOT EXISTS assets_task_idx ON assets(source_task_id);
    CREATE INDEX IF NOT EXISTS assets_project_idx ON assets(project_id, created_at);
    CREATE INDEX IF NOT EXISTS asset_refs_project_idx ON asset_refs(project_id, imported_at);
    CREATE INDEX IF NOT EXISTS asset_node_refs_asset_idx ON asset_node_refs(asset_id, project_id);
    CREATE INDEX IF NOT EXISTS asset_node_refs_project_idx ON asset_node_refs(project_id, node_id);
    CREATE INDEX IF NOT EXISTS text_revisions_project_node_idx ON text_revisions(project_id, node_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS text_revisions_text_idx ON text_revisions(text_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS runtime_session_project_idx ON runtime_session(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS agent_member_user_idx ON agent_member(user_id, created_at);
	    CREATE INDEX IF NOT EXISTS chat_message_session_idx ON chat_message(session_id, created_at);
	    CREATE INDEX IF NOT EXISTS mutation_audit_created_idx ON mutation_audit(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS mutation_audit_operation_idx ON mutation_audit(operation, created_at DESC);
    CREATE INDEX IF NOT EXISTS mutation_audit_entity_idx ON mutation_audit(entity_kind, entity_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS plugin_broker_audit_plugin_idx ON plugin_broker_audit(plugin_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS plugin_broker_audit_invocation_idx ON plugin_broker_audit(invocation_id, occurred_at DESC);
    COMMIT;
  `);
}

function ensureLocalMetadataColumns(db: SqliteDatabase): void {
  for (const column of [
    "completed_at INTEGER NOT NULL DEFAULT 0",
    "source_path TEXT NOT NULL DEFAULT ''",
    "source_sha256 TEXT NOT NULL DEFAULT ''",
  ]) {
    ensureSqliteColumn(db, "local_migration", column);
  }
  for (const column of [
    "owner_id TEXT NOT NULL DEFAULT ''",
    "name TEXT NOT NULL DEFAULT ''",
    "description TEXT",
    "created_at TEXT NOT NULL DEFAULT ''",
    "updated_at TEXT NOT NULL DEFAULT ''",
    "deleted_at TEXT",
  ]) {
    ensureSqliteColumn(db, "project", column);
  }
  for (const column of [
    "asset_id TEXT NOT NULL DEFAULT ''",
    "url TEXT NOT NULL DEFAULT ''",
    "type TEXT NOT NULL DEFAULT 'image'",
    "storage_key TEXT NOT NULL DEFAULT ''",
    "created_at TEXT",
    "position INTEGER NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "project_preview_asset", column);
  }
  for (const column of [
    "value_json TEXT NOT NULL DEFAULT '{}'",
    "updated_at TEXT NOT NULL DEFAULT ''",
  ]) {
    ensureSqliteColumn(db, "local_config", column);
  }
  for (const column of [
    "user_id TEXT NOT NULL DEFAULT ''",
    "kind TEXT NOT NULL DEFAULT 'image'",
    "src_r2_key TEXT NOT NULL DEFAULT ''",
    "cover_r2_key TEXT",
    "metadata TEXT",
    "source_model TEXT",
    "source_prompt TEXT",
    "source_task_id TEXT",
    "sources TEXT",
    "signed_url TEXT",
    "signed_url_exp INTEGER",
    "created_at INTEGER NOT NULL DEFAULT 0",
    "updated_at INTEGER NOT NULL DEFAULT 0",
    "project_id TEXT",
  ]) {
    ensureSqliteColumn(db, "assets", column);
  }
  ensureSqliteColumn(
    db,
    "asset_refs",
    "imported_at INTEGER NOT NULL DEFAULT 0",
  );
  for (const column of [
    "project_id TEXT NOT NULL DEFAULT ''",
    "node_id TEXT NOT NULL DEFAULT ''",
    "node_type TEXT NOT NULL DEFAULT ''",
    "field_path TEXT NOT NULL DEFAULT ''",
    "reference_role TEXT NOT NULL DEFAULT 'asset'",
    "observed_at INTEGER NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "asset_node_refs", column);
  }
  for (const column of [
    "text_id TEXT NOT NULL DEFAULT ''",
    "parent_revision_id TEXT",
    "project_id TEXT NOT NULL DEFAULT ''",
    "node_id TEXT NOT NULL DEFAULT ''",
    "created_at TEXT NOT NULL DEFAULT ''",
    "content_hash TEXT NOT NULL DEFAULT ''",
    "hash_algorithm TEXT NOT NULL DEFAULT 'sha256-64'",
    "source_file_path TEXT NOT NULL DEFAULT ''",
    "source_file_hash TEXT NOT NULL DEFAULT ''",
    "actor_json TEXT",
  ]) {
    ensureSqliteColumn(db, "text_revisions", column);
  }
  for (const column of [
    "project_id TEXT NOT NULL DEFAULT ''",
    "title TEXT NOT NULL DEFAULT ''",
    "type TEXT NOT NULL DEFAULT 'runtime'",
    "runtime_id TEXT",
    "agent_id TEXT",
    "agent_template_id TEXT",
    "permission_mode TEXT",
    "acp_session_id TEXT",
    "status TEXT",
    "created_at TEXT NOT NULL DEFAULT ''",
    "updated_at TEXT NOT NULL DEFAULT ''",
  ]) {
    ensureSqliteColumn(db, "runtime_session", column);
  }
  for (const column of [
    "user_id TEXT NOT NULL DEFAULT ''",
    "template_id TEXT NOT NULL DEFAULT ''",
    "runtime_id TEXT NOT NULL DEFAULT ''",
    "agent_id TEXT",
    "display_name TEXT NOT NULL DEFAULT ''",
    "created_at INTEGER NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "agent_member", column);
  }
  for (const column of [
    "sender_kind TEXT NOT NULL DEFAULT ''",
    "sender_id TEXT NOT NULL DEFAULT ''",
    "turn_id TEXT",
    "events_json TEXT NOT NULL DEFAULT '[]'",
    "created_at INTEGER NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "chat_message", column);
  }
  for (const column of [
    "created_at INTEGER NOT NULL DEFAULT 0",
    "operation TEXT NOT NULL DEFAULT ''",
    "entity_kind TEXT NOT NULL DEFAULT ''",
    "entity_id TEXT NOT NULL DEFAULT ''",
    "actor_client_type TEXT",
    "accepted INTEGER NOT NULL DEFAULT 0",
    "reason TEXT",
    "result_entity_id TEXT",
    "error TEXT",
    "mutation_json TEXT NOT NULL DEFAULT '{}'",
  ]) {
    ensureSqliteColumn(db, "mutation_audit", column);
  }
  dropSqliteColumnIfPresent(db, "mutation_audit", "forced");
}

function ensureSqliteColumn(
  db: SqliteDatabase,
  table: string,
  columnDefinition: string,
): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`);
  } catch {
    // Column already exists, or the existing table is too incompatible for safe repair.
  }
}

function dropSqliteColumnIfPresent(
  db: SqliteDatabase,
  table: string,
  column: string,
): void {
  const exists = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => rowString(row, "name") === column);
  if (exists) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function rowNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function rowOptionalString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  return optionalString(row[key]);
}

function rowOptionalNumber(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  return optionalNumber(row[key]);
}

function rowBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  return value === true || value === 1;
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mutationAuditLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(200, Math.floor(limit ?? 50)));
}

function textRevisionLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(200, Math.floor(limit ?? 50)));
}

function textRevisionFromRow(
  row: Record<string, unknown>,
): TextAppliedRevision {
  return {
    schemaVersion: 1,
    kind: "clash.text.revision",
    textId: rowString(row, "text_id"),
    revisionId: rowString(row, "revision_id"),
    ...(rowOptionalString(row, "parent_revision_id")
      ? { parentRevisionId: rowOptionalString(row, "parent_revision_id") }
      : {}),
    projectId: rowString(row, "project_id"),
    nodeId: rowString(row, "node_id"),
    createdAt: rowString(row, "created_at"),
    contentHash: rowString(row, "content_hash"),
    hashAlgorithm: "sha256-64",
    sourceFilePath: rowString(row, "source_file_path"),
    sourceFileHash: rowString(row, "source_file_hash"),
    ...(rowOptionalString(row, "actor_json")
      ? {
          actor: parseJson<TextAppliedRevision["actor"]>(
            row.actor_json,
            undefined,
          ),
        }
      : {}),
  };
}

function sameTextRevision(
  left: TextAppliedRevision,
  right: TextAppliedRevision,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasRows(db: SqliteDatabase): boolean {
  const row = db
    .prepare(
      `
    SELECT
      (SELECT COUNT(*) FROM project) +
      (SELECT COUNT(*) FROM assets) +
      (SELECT COUNT(*) FROM asset_refs) +
      (SELECT COUNT(*) FROM asset_node_refs) +
      (SELECT COUNT(*) FROM text_revisions) +
      (SELECT COUNT(*) FROM runtime_session) +
      (SELECT COUNT(*) FROM agent_member) +
      (SELECT COUNT(*) FROM chat_message) AS count
  `,
    )
    .get();
  return rowNumber(row ?? {}, "count") > 0;
}

function hasMigrationMarker(db: SqliteDatabase): boolean {
  return Boolean(
    db
      .prepare("SELECT id FROM local_migration WHERE id = ?")
      .get(METADATA_MIGRATION_ID),
  );
}

function markMigration(
  db: SqliteDatabase,
  dataDir: string,
  sourceSha256: string,
): void {
  db.prepare(
    `
    INSERT OR REPLACE INTO local_migration (id, completed_at, source_path, source_sha256)
    VALUES (?, ?, ?, ?)
  `,
  ).run(
    METADATA_MIGRATION_ID,
    Math.floor(Date.now() / 1000),
    sqlitePath(dataDir),
    sourceSha256,
  );
}

export function createLocalMetadataStore(dataDir: string) {
  const path = sqlitePath(dataDir);

  async function exists(): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async function withDb<T>(task: (db: SqliteDatabase) => T): Promise<T> {
    await mkdir(dataDir, { recursive: true });
    const db = openDatabase(path);
    try {
      applySchema(db);
      return task(db);
    } finally {
      db.close();
      await chmod(path, 0o600).catch(() => undefined);
    }
  }

  function insertMutationAudit(
    db: SqliteDatabase,
    record: LocalMutationAuditRecord,
  ): void {
    db.prepare(
      `
      INSERT INTO mutation_audit (
        id, created_at, operation, entity_kind, entity_id, actor_client_type,
        accepted, reason, result_entity_id, error, mutation_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      record.id,
      record.createdAt,
      record.operation,
      record.entity.kind,
      record.entity.id,
      record.actorClientType ?? null,
      record.accepted ? 1 : 0,
      record.reason ?? null,
      record.resultEntityId ?? null,
      record.error ?? null,
      JSON.stringify(record.mutation),
    );
  }

  async function load(): Promise<LocalMetadataDb> {
    if (!(await exists())) return structuredClone(EMPTY_METADATA_DB);
    const loaded = await withDb<LocalMetadataDb | null>((db) => {
      if (!hasMigrationMarker(db) && !hasRows(db)) {
        return null;
      }
      const previewRows = db
        .prepare(
          `
        SELECT project_id, asset_id, url, type, storage_key, created_at, position
          FROM project_preview_asset
         ORDER BY project_id, position
      `,
        )
        .all();
      const previewsByProject = new Map<string, LocalMetadataProjectAsset[]>();
      for (const row of previewRows) {
        const projectId = rowString(row, "project_id");
        const values = previewsByProject.get(projectId) ?? [];
        values.push({
          id: rowString(row, "asset_id"),
          url: rowString(row, "url"),
          type: rowString(row, "type") === "video" ? "video" : "image",
          storageKey: rowString(row, "storage_key"),
          createdAt: rowOptionalString(row, "created_at") ?? null,
        });
        previewsByProject.set(projectId, values);
      }

      const projects = db
        .prepare(
          `
        SELECT id, owner_id, name, description, created_at, updated_at, deleted_at
          FROM project
         ORDER BY updated_at DESC, created_at DESC
      `,
        )
        .all()
        .map((row) => ({
          id: rowString(row, "id"),
          ownerId: rowString(row, "owner_id"),
          name: rowString(row, "name"),
          description: rowOptionalString(row, "description") ?? null,
          createdAt: rowString(row, "created_at"),
          updatedAt: rowString(row, "updated_at"),
          deletedAt: rowOptionalString(row, "deleted_at") ?? null,
          assets: previewsByProject.get(rowString(row, "id")) ?? [],
        }));

      const assets = db
        .prepare(
          `
        SELECT id, user_id, kind, src_r2_key, cover_r2_key, metadata,
               source_model, source_prompt, source_task_id, sources, signed_url,
               signed_url_exp, created_at, updated_at, project_id
          FROM assets
         ORDER BY created_at DESC, id
      `,
        )
        .all()
        .map((row) => ({
          id: rowString(row, "id"),
          userId: rowString(row, "user_id"),
          kind: rowString(row, "kind") as AssetKind,
          srcR2Key: rowString(row, "src_r2_key"),
          coverR2Key: rowOptionalString(row, "cover_r2_key") ?? null,
          metadata: parseJson(row.metadata, null),
          sourceModel: rowOptionalString(row, "source_model") ?? null,
          sourcePrompt: rowOptionalString(row, "source_prompt") ?? null,
          sourceTaskId: rowOptionalString(row, "source_task_id") ?? null,
          sources: parseJson(row.sources, null),
          signedUrl: rowOptionalString(row, "signed_url"),
          signedUrlExp: rowOptionalNumber(row, "signed_url_exp"),
          createdAt: rowNumber(row, "created_at"),
          updatedAt: rowNumber(row, "updated_at"),
          ...(rowOptionalString(row, "project_id")
            ? { projectId: rowOptionalString(row, "project_id") }
            : {}),
        })) as Array<Asset & { projectId?: string }>;

      const assetRefs = db
        .prepare(
          `
        SELECT asset_id, project_id, imported_at
          FROM asset_refs
         ORDER BY imported_at DESC, asset_id
      `,
        )
        .all()
        .map((row) => ({
          assetId: rowString(row, "asset_id"),
          projectId: rowString(row, "project_id"),
          importedAt: rowNumber(row, "imported_at"),
        }));

      const libraryAssetRefs = db
        .prepare(
          `
        SELECT asset_id, user_id, added_at
          FROM asset_library_refs
         ORDER BY added_at DESC, asset_id
      `,
        )
        .all()
        .map((row) => ({
          assetId: rowString(row, "asset_id"),
          userId: rowString(row, "user_id"),
          addedAt: rowNumber(row, "added_at"),
        }));

      const assetNodeRefs = db
        .prepare(
          `
        SELECT asset_id, project_id, node_id, node_type, field_path, reference_role, observed_at
          FROM asset_node_refs
         ORDER BY project_id, node_id, field_path, asset_id
      `,
        )
        .all()
        .map((row) => ({
          assetId: rowString(row, "asset_id"),
          projectId: rowString(row, "project_id"),
          nodeId: rowString(row, "node_id"),
          nodeType: rowString(row, "node_type"),
          fieldPath: rowString(row, "field_path"),
          referenceRole: rowString(row, "reference_role") || "asset",
          observedAt: rowNumber(row, "observed_at"),
        }));

      const sessions = db
        .prepare(
          `
        SELECT id, project_id, title, type, runtime_id, agent_id,
               agent_template_id, permission_mode, acp_session_id, status,
               created_at, updated_at
          FROM runtime_session
         ORDER BY updated_at DESC, created_at DESC
      `,
        )
        .all()
        .map((row) => ({
          id: rowString(row, "id"),
          projectId: rowString(row, "project_id"),
          title: rowString(row, "title"),
          type: rowString(row, "type") as LocalMetadataSessionType,
          ...(rowOptionalString(row, "runtime_id")
            ? { runtimeId: rowOptionalString(row, "runtime_id") }
            : {}),
          ...(rowOptionalString(row, "agent_id")
            ? { agentId: rowOptionalString(row, "agent_id") }
            : {}),
          ...(rowOptionalString(row, "agent_template_id")
            ? { agentTemplateId: rowOptionalString(row, "agent_template_id") }
            : {}),
          ...(rowOptionalString(row, "permission_mode")
            ? { permissionMode: rowOptionalString(row, "permission_mode") }
            : {}),
          ...(rowOptionalString(row, "acp_session_id")
            ? { acpSessionId: rowOptionalString(row, "acp_session_id") }
            : {}),
          ...(rowOptionalString(row, "status")
            ? {
                status: rowOptionalString(
                  row,
                  "status",
                ) as LocalMetadataSessionStatus,
              }
            : {}),
          createdAt: rowString(row, "created_at"),
          updatedAt: rowString(row, "updated_at"),
        }));

      const agentMembers = db
        .prepare(
          `
        SELECT id, user_id, template_id, runtime_id, agent_id, display_name, created_at
          FROM agent_member
         ORDER BY created_at ASC, id
      `,
        )
        .all()
        .map((row) => ({
          id: rowString(row, "id"),
          user_id: rowString(row, "user_id"),
          template_id: rowString(row, "template_id"),
          runtime_id: rowString(row, "runtime_id"),
          agent_id: rowOptionalString(row, "agent_id") ?? null,
          display_name: rowString(row, "display_name"),
          created_at: rowNumber(row, "created_at"),
        }));

      const sessionMessages = db
        .prepare(
          `
        SELECT session_id, id, sender_kind, sender_id, turn_id, events_json, created_at
          FROM chat_message
         ORDER BY session_id, created_at ASC, id
      `,
        )
        .all()
        .map((row) => ({
          session_id: rowString(row, "session_id"),
          id: rowString(row, "id"),
          sender_kind:
            rowString(row, "sender_kind") === "user"
              ? ("user" as const)
              : ("agent" as const),
          sender_id: rowString(row, "sender_id"),
          turn_id: rowOptionalString(row, "turn_id") ?? null,
          events: parseJson<unknown[]>(row.events_json, []),
          created_at: rowNumber(row, "created_at"),
        }));

      return {
        projects,
        assets,
        assetRefs,
        libraryAssetRefs,
        assetNodeRefs,
        sessions,
        agentMembers,
        sessionMessages,
      };
    });
    return loaded ?? structuredClone(EMPTY_METADATA_DB);
  }

  async function save(metadata: LocalMetadataDb): Promise<void> {
    await withDb((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM chat_message").run();
        db.prepare("DELETE FROM agent_member").run();
        db.prepare("DELETE FROM runtime_session").run();
        db.prepare("DELETE FROM asset_node_refs").run();
        db.prepare("DELETE FROM asset_refs").run();
        db.prepare("DELETE FROM asset_library_refs").run();
        db.prepare("DELETE FROM assets").run();
        db.prepare("DELETE FROM project_preview_asset").run();
        db.prepare("DELETE FROM project").run();

        const insertProject = db.prepare(`
          INSERT INTO project (id, owner_id, name, description, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const insertPreview = db.prepare(`
          INSERT INTO project_preview_asset (project_id, asset_id, url, type, storage_key, created_at, position)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const project of metadata.projects) {
          insertProject.run(
            project.id,
            project.ownerId,
            project.name,
            project.description ?? null,
            project.createdAt,
            project.updatedAt,
            project.deletedAt ?? null,
          );
          project.assets.forEach((asset, index) => {
            insertPreview.run(
              project.id,
              asset.id,
              asset.url,
              asset.type,
              asset.storageKey,
              asset.createdAt,
              index,
            );
          });
        }

        const insertAsset = db.prepare(`
          INSERT INTO assets (
            id, user_id, kind, src_r2_key, cover_r2_key, metadata,
            source_model, source_prompt, source_task_id, sources, signed_url,
            signed_url_exp, created_at, updated_at, project_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const asset of metadata.assets) {
          insertAsset.run(
            asset.id,
            asset.userId,
            asset.kind,
            asset.srcR2Key,
            asset.coverR2Key ?? null,
            jsonOrNull(asset.metadata),
            asset.sourceModel ?? null,
            asset.sourcePrompt ?? null,
            asset.sourceTaskId ?? null,
            jsonOrNull(asset.sources),
            asset.signedUrl ?? null,
            asset.signedUrlExp ?? null,
            asset.createdAt,
            asset.updatedAt,
            asset.projectId ?? null,
          );
        }

        const insertAssetRef = db.prepare(`
          INSERT OR REPLACE INTO asset_refs (asset_id, project_id, imported_at)
          VALUES (?, ?, ?)
        `);
        for (const ref of metadata.assetRefs) {
          insertAssetRef.run(ref.assetId, ref.projectId, ref.importedAt);
        }

        const insertLibraryAssetRef = db.prepare(`
          INSERT OR REPLACE INTO asset_library_refs (asset_id, user_id, added_at)
          VALUES (?, ?, ?)
        `);
        for (const ref of metadata.libraryAssetRefs ?? []) {
          insertLibraryAssetRef.run(ref.assetId, ref.userId, ref.addedAt);
        }

        const insertAssetNodeRef = db.prepare(`
          INSERT OR REPLACE INTO asset_node_refs (
            asset_id, project_id, node_id, node_type, field_path, reference_role, observed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const ref of metadata.assetNodeRefs) {
          insertAssetNodeRef.run(
            ref.assetId,
            ref.projectId,
            ref.nodeId,
            ref.nodeType,
            ref.fieldPath,
            ref.referenceRole,
            ref.observedAt,
          );
        }

        const insertSession = db.prepare(`
          INSERT INTO runtime_session (
            id, project_id, title, type, runtime_id, agent_id, agent_template_id,
            permission_mode, acp_session_id, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const session of metadata.sessions) {
          insertSession.run(
            session.id,
            session.projectId,
            session.title,
            session.type ?? "cloud",
            session.runtimeId ?? null,
            session.agentId ?? null,
            session.agentTemplateId ?? null,
            session.permissionMode ?? null,
            session.acpSessionId ?? null,
            session.status ?? null,
            session.createdAt,
            session.updatedAt,
          );
        }

        const insertAgentMember = db.prepare(`
          INSERT INTO agent_member (id, user_id, template_id, runtime_id, agent_id, display_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const member of metadata.agentMembers) {
          insertAgentMember.run(
            member.id,
            member.user_id,
            member.template_id,
            member.runtime_id,
            member.agent_id,
            member.display_name,
            member.created_at,
          );
        }

        const insertMessage = db.prepare(`
          INSERT INTO chat_message (session_id, id, sender_kind, sender_id, turn_id, events_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const message of metadata.sessionMessages) {
          insertMessage.run(
            message.session_id,
            message.id,
            message.sender_kind,
            message.sender_id,
            message.turn_id,
            JSON.stringify(message.events),
            message.created_at,
          );
        }

        markMigration(db, dataDir, "");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async function upsertAsset(
    asset: Asset & { projectId?: string },
    ref: AssetRefRow,
    auditRecord?: LocalMutationAuditRecord,
  ): Promise<void> {
    await withDb((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `
          INSERT OR REPLACE INTO assets (
            id, user_id, kind, src_r2_key, cover_r2_key, metadata,
            source_model, source_prompt, source_task_id, sources, signed_url,
            signed_url_exp, created_at, updated_at, project_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          asset.id,
          asset.userId,
          asset.kind,
          asset.srcR2Key,
          asset.coverR2Key ?? null,
          jsonOrNull(asset.metadata),
          asset.sourceModel ?? null,
          asset.sourcePrompt ?? null,
          asset.sourceTaskId ?? null,
          jsonOrNull(asset.sources),
          asset.signedUrl ?? null,
          asset.signedUrlExp ?? null,
          asset.createdAt,
          asset.updatedAt,
          asset.projectId ?? null,
        );
        db.prepare(
          `
          INSERT OR REPLACE INTO asset_refs (asset_id, project_id, imported_at)
          VALUES (?, ?, ?)
        `,
        ).run(ref.assetId, ref.projectId, ref.importedAt);
        if (auditRecord) insertMutationAudit(db, auditRecord);
        markMigration(db, dataDir, "");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async function resolveStorageKeys(
    projectId: string,
    assetIds: string[],
  ): Promise<string[]> {
    if (assetIds.length === 0) return [];
    const metadata = await load();
    const projectAssetRefs = new Set(
      metadata.assetRefs
        .filter((ref) => ref.projectId === projectId)
        .map((ref) => ref.assetId),
    );
    const keys: string[] = [];
    for (const id of assetIds) {
      const asset = metadata.assets.find((item) => {
        if (item.id !== id) return false;
        if (item.projectId) return item.projectId === projectId;
        return projectAssetRefs.has(item.id);
      });
      if (asset?.srcR2Key) keys.push(asset.srcR2Key);
    }
    return keys;
  }

  async function appendMutationAudit(
    record: LocalMutationAuditRecord,
  ): Promise<void> {
    await withDb((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        insertMutationAudit(db, record);
        markMigration(db, dataDir, "");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async function listMutationAudit(
    filter: LocalMutationAuditFilter = {},
  ): Promise<LocalMutationAuditRecord[]> {
    const clauses: string[] = [];
    const params: SqlitePrimitive[] = [];
    if (filter.operation?.trim()) {
      clauses.push("operation = ?");
      params.push(filter.operation.trim());
    }
    if (filter.entityId?.trim()) {
      clauses.push("entity_id = ?");
      params.push(filter.entityId.trim());
    }
    params.push(mutationAuditLimit(filter.limit));
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return withDb((db) =>
      db
        .prepare(
          `
      SELECT id, created_at, operation, entity_kind, entity_id, actor_client_type,
             accepted, reason, result_entity_id, error, mutation_json
        FROM mutation_audit
        ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ?
    `,
        )
        .all(...params)
        .map((row) => ({
          id: rowString(row, "id"),
          createdAt: rowNumber(row, "created_at"),
          operation: rowString(row, "operation"),
          entity: {
            kind: rowString(row, "entity_kind"),
            id: rowString(row, "entity_id"),
          },
          actorClientType: rowOptionalString(row, "actor_client_type") ?? null,
          accepted: rowBoolean(row, "accepted"),
          reason: rowOptionalString(row, "reason") ?? null,
          resultEntityId: rowOptionalString(row, "result_entity_id") ?? null,
          error: rowOptionalString(row, "error") ?? null,
          mutation: parseJson<Record<string, unknown>>(row.mutation_json, {}),
        })),
    );
  }

  async function appendPluginBrokerAudit(
    record: LocalPluginBrokerAuditRecord,
  ): Promise<void> {
    await withDb((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`
          INSERT INTO plugin_broker_audit (
            id, occurred_at, plugin_id, plugin_version, project_id,
            invocation_id, request_id, operation, target, status, error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.id,
          record.occurredAt,
          record.pluginId,
          record.pluginVersion,
          record.projectId,
          record.invocationId,
          record.requestId,
          record.operation,
          record.target,
          record.status,
          record.error ?? null,
        );
        markMigration(db, dataDir, "");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async function listPluginBrokerAudit(
    filter: LocalPluginBrokerAuditFilter = {},
  ): Promise<LocalPluginBrokerAuditRecord[]> {
    const clauses: string[] = [];
    const params: SqlitePrimitive[] = [];
    if (filter.pluginId?.trim()) {
      clauses.push("plugin_id = ?");
      params.push(filter.pluginId.trim());
    }
    if (filter.invocationId?.trim()) {
      clauses.push("invocation_id = ?");
      params.push(filter.invocationId.trim());
    }
    params.push(mutationAuditLimit(filter.limit));
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return withDb((db) => db.prepare(`
      SELECT id, occurred_at, plugin_id, plugin_version, project_id,
             invocation_id, request_id, operation, target, status, error
        FROM plugin_broker_audit
        ${where}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?
    `).all(...params).map((row) => ({
      id: rowString(row, "id"),
      occurredAt: rowString(row, "occurred_at"),
      pluginId: rowString(row, "plugin_id"),
      pluginVersion: rowString(row, "plugin_version"),
      projectId: rowString(row, "project_id"),
      invocationId: rowString(row, "invocation_id"),
      requestId: rowString(row, "request_id"),
      operation: rowString(row, "operation"),
      target: rowString(row, "target"),
      status: rowString(row, "status") === "ok" ? "ok" as const : "error" as const,
      error: rowOptionalString(row, "error") ?? null,
    })));
  }

  async function upsertTextRevision(
    revision: TextAppliedRevision,
    auditRecord?: LocalMutationAuditRecord,
  ): Promise<TextAppliedRevision> {
    await withDb((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const existing = db
          .prepare(
            `
          SELECT revision_id, text_id, parent_revision_id, project_id, node_id,
                 created_at, content_hash, hash_algorithm, source_file_path,
                 source_file_hash, actor_json
            FROM text_revisions
           WHERE revision_id = ?
        `,
          )
          .get(revision.revisionId);
        if (
          existing &&
          !sameTextRevision(textRevisionFromRow(existing), revision)
        ) {
          throw new Error(
            `Text revision ${revision.revisionId} already exists with different metadata`,
          );
        }
        db.prepare(
          `
          INSERT OR REPLACE INTO text_revisions (
            revision_id, text_id, parent_revision_id, project_id, node_id,
            created_at, content_hash, hash_algorithm, source_file_path,
            source_file_hash, actor_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          revision.revisionId,
          revision.textId,
          revision.parentRevisionId ?? null,
          revision.projectId,
          revision.nodeId,
          revision.createdAt,
          revision.contentHash,
          revision.hashAlgorithm,
          revision.sourceFilePath,
          revision.sourceFileHash,
          jsonOrNull(revision.actor),
        );
        if (auditRecord) insertMutationAudit(db, auditRecord);
        markMigration(db, dataDir, "");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
    return revision;
  }

  async function listTextRevisions(
    filter: LocalTextRevisionFilter,
  ): Promise<TextAppliedRevision[]> {
    const clauses = ["project_id = ?"];
    const params: SqlitePrimitive[] = [filter.projectId];
    if (filter.nodeId?.trim()) {
      clauses.push("node_id = ?");
      params.push(filter.nodeId.trim());
    }
    params.push(textRevisionLimit(filter.limit));
    return withDb((db) =>
      db
        .prepare(
          `
      SELECT revision_id, text_id, parent_revision_id, project_id, node_id,
             created_at, content_hash, hash_algorithm, source_file_path,
             source_file_hash, actor_json
        FROM text_revisions
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC, revision_id DESC
       LIMIT ?
    `,
        )
        .all(...params)
        .map(textRevisionFromRow),
    );
  }

  async function getTextRevision(
    projectId: string,
    revisionId: string,
  ): Promise<TextAppliedRevision | null> {
    const row = await withDb((db) =>
      db
        .prepare(
          `
      SELECT revision_id, text_id, parent_revision_id, project_id, node_id,
             created_at, content_hash, hash_algorithm, source_file_path,
             source_file_hash, actor_json
        FROM text_revisions
       WHERE project_id = ? AND revision_id = ?
    `,
        )
        .get(projectId, revisionId),
    );
    return row ? textRevisionFromRow(row) : null;
  }

  /**
   * The queryable half of "manifest carries identities, blobs carry bodies":
   * one row per attached kind, so "which assets have a transcript" is a WHERE
   * clause instead of a walk over every workspace manifest.
   */
  async function upsertAssetMetadataIndex(record: {
    assetId: string;
    metadataKind: string;
    projectId?: string;
    schemaVersion?: number;
    contentHash?: string;
    bodyHash?: string;
    producer: string;
    summary?: unknown;
    identity: unknown;
  }): Promise<void> {
    await withDb((db) => {
      db.prepare(
        `
      INSERT INTO asset_metadata_index (
        asset_id, metadata_kind, project_id, schema_version, content_hash,
        body_hash, producer, summary_json, identity_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, metadata_kind) DO UPDATE SET
        project_id = excluded.project_id,
        schema_version = excluded.schema_version,
        content_hash = excluded.content_hash,
        body_hash = excluded.body_hash,
        producer = excluded.producer,
        summary_json = excluded.summary_json,
        identity_json = excluded.identity_json,
        recorded_at = excluded.recorded_at
    `,
      ).run(
        record.assetId,
        record.metadataKind,
        record.projectId ?? null,
        record.schemaVersion ?? null,
        record.contentHash ?? null,
        record.bodyHash ?? null,
        record.producer,
        record.summary === undefined ? null : JSON.stringify(record.summary),
        JSON.stringify(record.identity),
        Date.now(),
      );
    });
  }

  async function listAssetMetadataIndex(filter: {
    assetId?: string;
    metadataKind?: string;
    projectId?: string;
  } = {}): Promise<Array<Record<string, unknown>>> {
    return withDb((db) => {
      const conditions: string[] = [];
      const params: SqlitePrimitive[] = [];
      if (filter.assetId) {
        conditions.push("asset_id = ?");
        params.push(filter.assetId);
      }
      if (filter.metadataKind) {
        conditions.push("metadata_kind = ?");
        params.push(filter.metadataKind);
      }
      if (filter.projectId) {
        conditions.push("project_id = ?");
        params.push(filter.projectId);
      }
      const rows = db
        .prepare(
          `
      SELECT asset_id, metadata_kind, project_id, schema_version, content_hash,
             body_hash, producer, summary_json, identity_json, recorded_at
        FROM asset_metadata_index
        ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY asset_id, metadata_kind
    `,
        )
        .all(...params);
      return rows.map((row) => ({
        assetId: row.asset_id,
        metadataKind: row.metadata_kind,
        ...(row.project_id === null ? {} : { projectId: row.project_id }),
        ...(row.schema_version === null ? {} : { schemaVersion: row.schema_version }),
        ...(row.content_hash === null ? {} : { contentHash: row.content_hash }),
        ...(row.body_hash === null ? {} : { bodyHash: row.body_hash }),
        producer: row.producer,
        ...(typeof row.summary_json === "string"
          ? { summary: JSON.parse(row.summary_json) as unknown }
          : {}),
        identity: JSON.parse(String(row.identity_json)) as unknown,
        recordedAt: row.recorded_at,
      }));
    });
  }

  return {
    path,
    load,
    save,
    upsertAsset,
    resolveStorageKeys,
    appendMutationAudit,
    listMutationAudit,
    appendPluginBrokerAudit,
    listPluginBrokerAudit,
    upsertTextRevision,
    listTextRevisions,
    getTextRevision,
    upsertAssetMetadataIndex,
    listAssetMetadataIndex,
  };
}
