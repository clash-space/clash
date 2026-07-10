import { createRequire } from "node:module";
import { chmod, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

type SqlitePrimitive = string | number | null;

type SqliteStatement = {
  run(...params: SqlitePrimitive[]): unknown;
  get(...params: SqlitePrimitive[]): Record<string, unknown> | undefined;
};

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
};

export interface SqliteLocalConfigStore {
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, updatedAt?: string): Promise<void>;
}

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
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS local_config (
      key TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    COMMIT;
  `);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function createSqliteLocalConfigStore(dataDir: string): SqliteLocalConfigStore {
  const path = sqlitePath(dataDir);

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

  return {
    async getJson<T>(key: string) {
      if (!(await exists(path))) return null;
      return withDb((db) => {
        const row = db.prepare("SELECT value_json FROM local_config WHERE key = ?").get(key);
        if (typeof row?.value_json !== "string") return null;
        try {
          return JSON.parse(row.value_json) as T;
        } catch {
          return null;
        }
      });
    },

    async setJson(key, value, updatedAt = new Date().toISOString()) {
      await withDb((db) => {
        db.prepare(`
          INSERT INTO local_config (key, value_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `).run(key, JSON.stringify(value), updatedAt);
      });
    },
  };
}
