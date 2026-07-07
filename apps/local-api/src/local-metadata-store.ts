import { createRequire } from "node:module";
import { chmod, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
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
  url: string;
  type: "image" | "video";
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
export type LocalMetadataSessionStatus = "starting" | "active" | "closed" | "error";

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

export interface LocalMetadataRoomMention {
  user_id?: string;
  agent_member_id?: string;
  agent_template_id?: string;
}

export interface LocalMetadataRoomMessage {
  id: string;
  project_id: string;
  sender_kind: "user" | "agent";
  sender_id: string;
  sender_user_id: string;
  mentions: LocalMetadataRoomMention[];
  text: string;
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

export interface LocalMetadataDb {
  projects: LocalMetadataProject[];
  assets: Array<Asset & { projectId?: string }>;
  assetRefs: AssetRefRow[];
  assetNodeRefs: LocalMetadataAssetNodeRef[];
  sessions: LocalMetadataSession[];
  agentMembers: LocalMetadataAgentMember[];
  sessionMessages: LocalMetadataSessionMessage[];
  roomMessages: LocalMetadataRoomMessage[];
}

const EMPTY_METADATA_DB: LocalMetadataDb = {
  projects: [],
  assets: [],
  assetRefs: [],
  assetNodeRefs: [],
  sessions: [],
  agentMembers: [],
  sessionMessages: [],
  roomMessages: [],
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
  return new DatabaseSync(path);
}

function applySchema(db: SqliteDatabase): void {
  db.exec(`
    PRAGMA journal_mode = DELETE;

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
    CREATE INDEX IF NOT EXISTS project_owner_idx ON project(owner_id, updated_at);

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
    CREATE INDEX IF NOT EXISTS assets_user_idx ON assets(user_id, created_at);
    CREATE INDEX IF NOT EXISTS assets_task_idx ON assets(source_task_id);
    CREATE INDEX IF NOT EXISTS assets_project_idx ON assets(project_id, created_at);

    CREATE TABLE IF NOT EXISTS asset_refs (
      asset_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      PRIMARY KEY (asset_id, project_id)
    );
    CREATE INDEX IF NOT EXISTS asset_refs_project_idx ON asset_refs(project_id, imported_at);

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
    CREATE INDEX IF NOT EXISTS asset_node_refs_asset_idx ON asset_node_refs(asset_id, project_id);
    CREATE INDEX IF NOT EXISTS asset_node_refs_project_idx ON asset_node_refs(project_id, node_id);

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
    CREATE INDEX IF NOT EXISTS runtime_session_project_idx ON runtime_session(project_id, updated_at);

    CREATE TABLE IF NOT EXISTS agent_member (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      agent_id TEXT,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_member_user_idx ON agent_member(user_id, created_at);

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
    CREATE INDEX IF NOT EXISTS chat_message_session_idx ON chat_message(session_id, created_at);

    CREATE TABLE IF NOT EXISTS room_message (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      sender_kind TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_user_id TEXT NOT NULL,
      mentions_json TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS room_message_project_idx ON room_message(project_id, created_at);
  `);
  try {
    db.exec("ALTER TABLE project ADD COLUMN deleted_at TEXT");
  } catch {
    // Column already exists.
  }
  try {
    db.exec("ALTER TABLE asset_node_refs ADD COLUMN reference_role TEXT NOT NULL DEFAULT 'asset'");
  } catch {
    // Column already exists.
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function rowNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function rowOptionalString(row: Record<string, unknown>, key: string): string | undefined {
  return optionalString(row[key]);
}

function rowOptionalNumber(row: Record<string, unknown>, key: string): number | undefined {
  return optionalNumber(row[key]);
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

function hasRows(db: SqliteDatabase): boolean {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM project) +
      (SELECT COUNT(*) FROM assets) +
      (SELECT COUNT(*) FROM asset_refs) +
      (SELECT COUNT(*) FROM asset_node_refs) +
      (SELECT COUNT(*) FROM runtime_session) +
      (SELECT COUNT(*) FROM agent_member) +
      (SELECT COUNT(*) FROM chat_message) +
      (SELECT COUNT(*) FROM room_message) AS count
  `).get();
  return rowNumber(row ?? {}, "count") > 0;
}

function hasMigrationMarker(db: SqliteDatabase): boolean {
  return Boolean(db.prepare("SELECT id FROM local_migration WHERE id = ?").get(METADATA_MIGRATION_ID));
}

function markMigration(db: SqliteDatabase, dataDir: string, sourceSha256: string): void {
  db.prepare(`
    INSERT OR REPLACE INTO local_migration (id, completed_at, source_path, source_sha256)
    VALUES (?, ?, ?, ?)
  `).run(METADATA_MIGRATION_ID, Math.floor(Date.now() / 1000), sqlitePath(dataDir), sourceSha256);
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

  async function load(): Promise<LocalMetadataDb> {
    if (!(await exists())) return structuredClone(EMPTY_METADATA_DB);
    const loaded = await withDb<LocalMetadataDb | null>((db) => {
      if (!hasMigrationMarker(db) && !hasRows(db)) {
        return null;
      }
      const previewRows = db.prepare(`
        SELECT project_id, asset_id, url, type, storage_key, created_at, position
          FROM project_preview_asset
         ORDER BY project_id, position
      `).all();
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

      const projects = db.prepare(`
        SELECT id, owner_id, name, description, created_at, updated_at, deleted_at
          FROM project
         ORDER BY updated_at DESC, created_at DESC
      `).all().map((row) => ({
        id: rowString(row, "id"),
        ownerId: rowString(row, "owner_id"),
        name: rowString(row, "name"),
        description: rowOptionalString(row, "description") ?? null,
        createdAt: rowString(row, "created_at"),
        updatedAt: rowString(row, "updated_at"),
        deletedAt: rowOptionalString(row, "deleted_at") ?? null,
        assets: previewsByProject.get(rowString(row, "id")) ?? [],
      }));

      const assets = db.prepare(`
        SELECT id, user_id, kind, src_r2_key, cover_r2_key, metadata,
               source_model, source_prompt, source_task_id, sources, signed_url,
               signed_url_exp, created_at, updated_at, project_id
          FROM assets
         ORDER BY created_at DESC, id
      `).all().map((row) => ({
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
        ...(rowOptionalString(row, "project_id") ? { projectId: rowOptionalString(row, "project_id") } : {}),
      })) as Array<Asset & { projectId?: string }>;

      const assetRefs = db.prepare(`
        SELECT asset_id, project_id, imported_at
          FROM asset_refs
         ORDER BY imported_at DESC, asset_id
      `).all().map((row) => ({
        assetId: rowString(row, "asset_id"),
        projectId: rowString(row, "project_id"),
        importedAt: rowNumber(row, "imported_at"),
      }));

      const assetNodeRefs = db.prepare(`
        SELECT asset_id, project_id, node_id, node_type, field_path, reference_role, observed_at
          FROM asset_node_refs
         ORDER BY project_id, node_id, field_path, asset_id
      `).all().map((row) => ({
        assetId: rowString(row, "asset_id"),
        projectId: rowString(row, "project_id"),
        nodeId: rowString(row, "node_id"),
        nodeType: rowString(row, "node_type"),
        fieldPath: rowString(row, "field_path"),
        referenceRole: rowString(row, "reference_role") || "asset",
        observedAt: rowNumber(row, "observed_at"),
      }));

      const sessions = db.prepare(`
        SELECT id, project_id, title, type, runtime_id, agent_id,
               agent_template_id, permission_mode, acp_session_id, status,
               created_at, updated_at
          FROM runtime_session
         ORDER BY updated_at DESC, created_at DESC
      `).all().map((row) => ({
        id: rowString(row, "id"),
        projectId: rowString(row, "project_id"),
        title: rowString(row, "title"),
        type: rowString(row, "type") as LocalMetadataSessionType,
        ...(rowOptionalString(row, "runtime_id") ? { runtimeId: rowOptionalString(row, "runtime_id") } : {}),
        ...(rowOptionalString(row, "agent_id") ? { agentId: rowOptionalString(row, "agent_id") } : {}),
        ...(rowOptionalString(row, "agent_template_id") ? { agentTemplateId: rowOptionalString(row, "agent_template_id") } : {}),
        ...(rowOptionalString(row, "permission_mode") ? { permissionMode: rowOptionalString(row, "permission_mode") } : {}),
        ...(rowOptionalString(row, "acp_session_id") ? { acpSessionId: rowOptionalString(row, "acp_session_id") } : {}),
        ...(rowOptionalString(row, "status") ? { status: rowOptionalString(row, "status") as LocalMetadataSessionStatus } : {}),
        createdAt: rowString(row, "created_at"),
        updatedAt: rowString(row, "updated_at"),
      }));

      const agentMembers = db.prepare(`
        SELECT id, user_id, template_id, runtime_id, agent_id, display_name, created_at
          FROM agent_member
         ORDER BY created_at ASC, id
      `).all().map((row) => ({
        id: rowString(row, "id"),
        user_id: rowString(row, "user_id"),
        template_id: rowString(row, "template_id"),
        runtime_id: rowString(row, "runtime_id"),
        agent_id: rowOptionalString(row, "agent_id") ?? null,
        display_name: rowString(row, "display_name"),
        created_at: rowNumber(row, "created_at"),
      }));

      const sessionMessages = db.prepare(`
        SELECT session_id, id, sender_kind, sender_id, turn_id, events_json, created_at
          FROM chat_message
         ORDER BY session_id, created_at ASC, id
      `).all().map((row) => ({
        session_id: rowString(row, "session_id"),
        id: rowString(row, "id"),
        sender_kind: rowString(row, "sender_kind") === "user" ? "user" as const : "agent" as const,
        sender_id: rowString(row, "sender_id"),
        turn_id: rowOptionalString(row, "turn_id") ?? null,
        events: parseJson<unknown[]>(row.events_json, []),
        created_at: rowNumber(row, "created_at"),
      }));

      const roomMessages = db.prepare(`
        SELECT id, project_id, sender_kind, sender_id, sender_user_id, mentions_json, text, created_at
          FROM room_message
         ORDER BY project_id, created_at DESC, id
      `).all().map((row) => ({
        id: rowString(row, "id"),
        project_id: rowString(row, "project_id"),
        sender_kind: rowString(row, "sender_kind") === "agent" ? "agent" as const : "user" as const,
        sender_id: rowString(row, "sender_id"),
        sender_user_id: rowString(row, "sender_user_id"),
        mentions: parseJson<LocalMetadataRoomMention[]>(row.mentions_json, []),
        text: rowString(row, "text"),
        created_at: rowNumber(row, "created_at"),
      }));

      return {
        projects,
        assets,
        assetRefs,
        assetNodeRefs,
        sessions,
        agentMembers,
        sessionMessages,
        roomMessages,
      };
    });
    return loaded ?? structuredClone(EMPTY_METADATA_DB);
  }

  async function save(metadata: LocalMetadataDb): Promise<void> {
    await withDb((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM room_message").run();
        db.prepare("DELETE FROM chat_message").run();
        db.prepare("DELETE FROM agent_member").run();
        db.prepare("DELETE FROM runtime_session").run();
        db.prepare("DELETE FROM asset_node_refs").run();
        db.prepare("DELETE FROM asset_refs").run();
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

        const insertAssetNodeRef = db.prepare(`
          INSERT OR REPLACE INTO asset_node_refs (
            asset_id, project_id, node_id, node_type, field_path, reference_role, observed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const ref of metadata.assetNodeRefs) {
          insertAssetNodeRef.run(ref.assetId, ref.projectId, ref.nodeId, ref.nodeType, ref.fieldPath, ref.referenceRole, ref.observedAt);
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

        const insertRoomMessage = db.prepare(`
          INSERT INTO room_message (
            id, project_id, sender_kind, sender_id, sender_user_id, mentions_json, text, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const message of metadata.roomMessages) {
          insertRoomMessage.run(
            message.id,
            message.project_id,
            message.sender_kind,
            message.sender_id,
            message.sender_user_id,
            JSON.stringify(message.mentions),
            message.text,
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

  async function upsertAsset(asset: Asset & { projectId?: string }, ref: AssetRefRow): Promise<void> {
    await withDb((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`
          INSERT OR REPLACE INTO assets (
            id, user_id, kind, src_r2_key, cover_r2_key, metadata,
            source_model, source_prompt, source_task_id, sources, signed_url,
            signed_url_exp, created_at, updated_at, project_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
        db.prepare(`
          INSERT OR REPLACE INTO asset_refs (asset_id, project_id, imported_at)
          VALUES (?, ?, ?)
        `).run(ref.assetId, ref.projectId, ref.importedAt);
        markMigration(db, dataDir, "");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async function resolveStorageKeys(projectId: string, assetIds: string[]): Promise<string[]> {
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

  return {
    path,
    load,
    save,
    upsertAsset,
    resolveStorageKeys,
  };
}
