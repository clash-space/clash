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

export interface LocalProjectAsset {
  id: string;
  url: string;
  type: "image" | "video";
  storageKey: string;
  createdAt: string | null;
}

export interface LocalProject {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  assets: LocalProjectAsset[];
}

export interface LocalSession {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalCrewMember {
  id: string;
  user_id: string;
  template_id: string;
  runtime_id: string;
  agent_id: string | null;
  display_name: string;
  created_at: number;
}

export interface LocalRoomMention {
  user_id: string;
  crew_member_id?: string;
  crew_id?: string;
}

export interface LocalRoomMessage {
  id: string;
  project_id: string;
  sender_kind: "user" | "crew";
  sender_id: string;
  sender_user_id: string;
  mentions: LocalRoomMention[];
  text: string;
  at: number;
}

export interface LocalUserVariable {
  id: string;
  userId: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalDb {
  projects: LocalProject[];
  assets: Array<Asset & { projectId?: string }>;
  assetRefs: AssetRefRow[];
  sessions: LocalSession[];
  crewMembers: LocalCrewMember[];
  roomMessages: LocalRoomMessage[];
  variables: LocalUserVariable[];
}

const EMPTY_LOCAL_DB: LocalDb = {
  projects: [],
  assets: [],
  assetRefs: [],
  sessions: [],
  crewMembers: [],
  roomMessages: [],
  variables: [],
};

const require = createRequire(import.meta.url);

function sqlitePath(dataDir: string): string {
  return join(dataDir, "local.sqlite");
}

function openDatabase(path: string): SqliteDatabase {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);
  return db;
}

function applySchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS asset (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      src_r2_key TEXT NOT NULL,
      cover_r2_key TEXT,
      metadata_json TEXT,
      source_model TEXT,
      source_prompt TEXT,
      source_task_id TEXT,
      sources_json TEXT,
      signed_url TEXT,
      signed_url_exp INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS asset_ref (
      asset_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      PRIMARY KEY (asset_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS runtime_session (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crew_member (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      agent_id TEXT,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_message (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      sender_kind TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_user_id TEXT NOT NULL,
      mentions_json TEXT NOT NULL,
      text TEXT NOT NULL,
      at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_variable (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function rowOptionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function rowNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function rowOptionalNumber(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
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

  async function load(): Promise<LocalDb> {
    if (!(await exists())) return structuredClone(EMPTY_LOCAL_DB);
    return withDb((db) => {
      const previewRows = db.prepare(`
        SELECT project_id, asset_id, url, type, storage_key, created_at, position
          FROM project_preview_asset
         ORDER BY project_id, position
      `).all();
      const previewsByProject = new Map<string, LocalProjectAsset[]>();
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

      return {
        projects: db.prepare(`
          SELECT id, owner_id, name, description, created_at, updated_at
            FROM project
           ORDER BY updated_at DESC, created_at DESC
        `).all().map((row) => ({
          id: rowString(row, "id"),
          ownerId: rowString(row, "owner_id"),
          name: rowString(row, "name"),
          description: rowOptionalString(row, "description") ?? null,
          createdAt: rowString(row, "created_at"),
          updatedAt: rowString(row, "updated_at"),
          assets: previewsByProject.get(rowString(row, "id")) ?? [],
        })),
        assets: db.prepare(`
          SELECT id, user_id, kind, src_r2_key, cover_r2_key, metadata_json,
                 source_model, source_prompt, source_task_id, sources_json,
                 signed_url, signed_url_exp, created_at, updated_at, project_id
            FROM asset
           ORDER BY created_at DESC, id
        `).all().map((row) => ({
          id: rowString(row, "id"),
          userId: rowString(row, "user_id"),
          kind: rowString(row, "kind") as AssetKind,
          srcR2Key: rowString(row, "src_r2_key"),
          coverR2Key: rowOptionalString(row, "cover_r2_key") ?? null,
          metadata: parseJson(row.metadata_json, null),
          sourceModel: rowOptionalString(row, "source_model") ?? null,
          sourcePrompt: rowOptionalString(row, "source_prompt") ?? null,
          sourceTaskId: rowOptionalString(row, "source_task_id") ?? null,
          sources: parseJson(row.sources_json, null),
          signedUrl: rowOptionalString(row, "signed_url"),
          signedUrlExp: rowOptionalNumber(row, "signed_url_exp"),
          createdAt: rowNumber(row, "created_at"),
          updatedAt: rowNumber(row, "updated_at"),
          ...(rowOptionalString(row, "project_id") ? { projectId: rowOptionalString(row, "project_id") } : {}),
        })) as Array<Asset & { projectId?: string }>,
        assetRefs: db.prepare(`
          SELECT asset_id, project_id, imported_at
            FROM asset_ref
           ORDER BY imported_at DESC, asset_id
        `).all().map((row) => ({
          assetId: rowString(row, "asset_id"),
          projectId: rowString(row, "project_id"),
          importedAt: rowNumber(row, "imported_at"),
        })),
        sessions: db.prepare(`
          SELECT id, project_id, title, created_at, updated_at
            FROM runtime_session
           ORDER BY updated_at DESC, created_at DESC
        `).all().map((row) => ({
          id: rowString(row, "id"),
          projectId: rowString(row, "project_id"),
          title: rowString(row, "title"),
          createdAt: rowString(row, "created_at"),
          updatedAt: rowString(row, "updated_at"),
        })),
        crewMembers: db.prepare(`
          SELECT id, user_id, template_id, runtime_id, agent_id, display_name, created_at
            FROM crew_member
           ORDER BY created_at ASC, id
        `).all().map((row) => ({
          id: rowString(row, "id"),
          user_id: rowString(row, "user_id"),
          template_id: rowString(row, "template_id"),
          runtime_id: rowString(row, "runtime_id"),
          agent_id: rowOptionalString(row, "agent_id") ?? null,
          display_name: rowString(row, "display_name"),
          created_at: rowNumber(row, "created_at"),
        })),
        roomMessages: db.prepare(`
          SELECT id, project_id, sender_kind, sender_id, sender_user_id, mentions_json, text, at
            FROM room_message
           ORDER BY project_id, at DESC, id
        `).all().map((row) => ({
          id: rowString(row, "id"),
          project_id: rowString(row, "project_id"),
          sender_kind: rowString(row, "sender_kind") === "crew" ? "crew" as const : "user" as const,
          sender_id: rowString(row, "sender_id"),
          sender_user_id: rowString(row, "sender_user_id"),
          mentions: parseJson<LocalRoomMention[]>(row.mentions_json, []),
          text: rowString(row, "text"),
          at: rowNumber(row, "at"),
        })),
        variables: db.prepare(`
          SELECT id, user_id, key, value, created_at, updated_at
            FROM user_variable
           ORDER BY updated_at DESC, created_at DESC
        `).all().map((row) => ({
          id: rowString(row, "id"),
          userId: rowString(row, "user_id"),
          key: rowString(row, "key"),
          value: rowString(row, "value"),
          createdAt: rowString(row, "created_at"),
          updatedAt: rowString(row, "updated_at"),
        })),
      };
    });
  }

  async function save(state: LocalDb): Promise<void> {
    await withDb((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM user_variable").run();
        db.prepare("DELETE FROM room_message").run();
        db.prepare("DELETE FROM crew_member").run();
        db.prepare("DELETE FROM runtime_session").run();
        db.prepare("DELETE FROM asset_ref").run();
        db.prepare("DELETE FROM asset").run();
        db.prepare("DELETE FROM project_preview_asset").run();
        db.prepare("DELETE FROM project").run();

        const insertProject = db.prepare(`
          INSERT INTO project (id, owner_id, name, description, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const insertPreview = db.prepare(`
          INSERT INTO project_preview_asset (project_id, asset_id, url, type, storage_key, created_at, position)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        state.projects.forEach((project) => {
          insertProject.run(
            project.id,
            project.ownerId,
            project.name,
            project.description ?? null,
            project.createdAt,
            project.updatedAt,
          );
          project.assets.forEach((asset, position) => {
            insertPreview.run(project.id, asset.id, asset.url, asset.type, asset.storageKey, asset.createdAt, position);
          });
        });

        const insertAsset = db.prepare(`
          INSERT INTO asset (
            id, user_id, kind, src_r2_key, cover_r2_key, metadata_json,
            source_model, source_prompt, source_task_id, sources_json,
            signed_url, signed_url_exp, created_at, updated_at, project_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        state.assets.forEach((asset) => {
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
        });

        const insertAssetRef = db.prepare(`
          INSERT OR REPLACE INTO asset_ref (asset_id, project_id, imported_at)
          VALUES (?, ?, ?)
        `);
        state.assetRefs.forEach((ref) => insertAssetRef.run(ref.assetId, ref.projectId, ref.importedAt));

        const insertSession = db.prepare(`
          INSERT INTO runtime_session (id, project_id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        state.sessions.forEach((session) => {
          insertSession.run(session.id, session.projectId, session.title, session.createdAt, session.updatedAt);
        });

        const insertCrew = db.prepare(`
          INSERT INTO crew_member (id, user_id, template_id, runtime_id, agent_id, display_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        state.crewMembers.forEach((member) => {
          insertCrew.run(
            member.id,
            member.user_id,
            member.template_id,
            member.runtime_id,
            member.agent_id,
            member.display_name,
            member.created_at,
          );
        });

        const insertRoomMessage = db.prepare(`
          INSERT INTO room_message (id, project_id, sender_kind, sender_id, sender_user_id, mentions_json, text, at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        state.roomMessages.forEach((message) => {
          insertRoomMessage.run(
            message.id,
            message.project_id,
            message.sender_kind,
            message.sender_id,
            message.sender_user_id,
            JSON.stringify(message.mentions),
            message.text,
            message.at,
          );
        });

        const insertVariable = db.prepare(`
          INSERT INTO user_variable (id, user_id, key, value, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        state.variables.forEach((variable) => {
          insertVariable.run(
            variable.id,
            variable.userId,
            variable.key,
            variable.value,
            variable.createdAt,
            variable.updatedAt,
          );
        });

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  return { load, save };
}
