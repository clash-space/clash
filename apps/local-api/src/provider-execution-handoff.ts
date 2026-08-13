import { createRequire } from "node:module";
import { access, chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export interface ProviderExecutionHandoff {
  projectId: string;
  nodeId: string;
  accountId: string;
  createdAt: number;
}

export interface ProviderExecutionHandoffStore {
  put(handoff: ProviderExecutionHandoff): Promise<void>;
  load(projectId: string, nodeId: string): Promise<ProviderExecutionHandoff | undefined>;
  remove(projectId: string, nodeId: string): Promise<void>;
}

const nodeRequire = createRequire(import.meta.url);

function nonEmpty(value: string, field: string): string {
  if (!value.trim()) throw new Error(`Provider execution handoff ${field} is required.`);
  return value;
}

export function createProviderExecutionHandoffStore(
  dataDir: string,
): ProviderExecutionHandoffStore {
  const path = join(dataDir, "local.sqlite");

  async function databaseExists(): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async function withDatabase<T>(task: (database: SqliteDatabase) => T): Promise<T> {
    await mkdir(dataDir, { recursive: true });
    const { DatabaseSync } = nodeRequire("node:sqlite") as {
      DatabaseSync: new (path: string) => SqliteDatabase;
    };
    const database = new DatabaseSync(path);
    try {
      database.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS provider_execution_handoff (
          project_id TEXT NOT NULL,
          node_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (project_id, node_id)
        );
      `);
      return task(database);
    } finally {
      database.close();
      await chmod(path, 0o600).catch(() => undefined);
    }
  }

  return {
    async put(handoff) {
      const projectId = nonEmpty(handoff.projectId, "projectId");
      const nodeId = nonEmpty(handoff.nodeId, "nodeId");
      const accountId = nonEmpty(handoff.accountId, "accountId");
      if (!Number.isFinite(handoff.createdAt)) {
        throw new Error("Provider execution handoff createdAt must be finite.");
      }
      await withDatabase((database) => {
        database.prepare(`
          INSERT INTO provider_execution_handoff (
            project_id, node_id, account_id, created_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(project_id, node_id) DO UPDATE SET
            account_id = excluded.account_id,
            created_at = excluded.created_at
        `).run(projectId, nodeId, accountId, handoff.createdAt);
      });
    },

    async load(projectIdInput, nodeIdInput) {
      const projectId = nonEmpty(projectIdInput, "projectId");
      const nodeId = nonEmpty(nodeIdInput, "nodeId");
      if (!(await databaseExists())) return undefined;
      return withDatabase((database) => {
        const row = database.prepare(`
          SELECT project_id, node_id, account_id, created_at
          FROM provider_execution_handoff
          WHERE project_id = ? AND node_id = ?
        `).get(projectId, nodeId);
        if (!row) return undefined;
        return {
          projectId: String(row.project_id),
          nodeId: String(row.node_id),
          accountId: String(row.account_id),
          createdAt: Number(row.created_at),
        };
      });
    },

    async remove(projectIdInput, nodeIdInput) {
      const projectId = nonEmpty(projectIdInput, "projectId");
      const nodeId = nonEmpty(nodeIdInput, "nodeId");
      if (!(await databaseExists())) return;
      await withDatabase((database) => {
        database.prepare(`
          DELETE FROM provider_execution_handoff
          WHERE project_id = ? AND node_id = ?
        `).run(projectId, nodeId);
      });
    },
  };
}
