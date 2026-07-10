import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(process.execPath);

interface SqliteDatabase {
  prepare(sql: string): {
    get(...values: unknown[]): Record<string, unknown> | undefined;
  };
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

export interface ProductReplicationStateOptions {
  localApiDataDir: string;
  env?: Record<string, string | undefined>;
}

export function readProductReplicationState(
  options: ProductReplicationStateOptions,
): Record<string, unknown> {
  const fallback = syncStateFromEnv(options.env ?? {});
  const sqlitePath = join(options.localApiDataDir, "local.sqlite");
  if (!existsSync(sqlitePath)) return fallback;

  let db: SqliteDatabase | undefined;
  try {
    const { DatabaseSync } = require("node:sqlite") as SqliteModule;
    db = new DatabaseSync(sqlitePath, { readOnly: true });
    const row = db.prepare(
      "SELECT value_json FROM local_config WHERE key = ?",
    ).get("local-sync-config");
    if (!row || typeof row.value_json !== "string") return fallback;
    return syncStateFromStoredConfig(JSON.parse(row.value_json));
  } catch (error) {
    if (isMissingLocalConfigTable(error)) return fallback;
    return { mode: "unknown" };
  } finally {
    db?.close();
  }
}

function syncStateFromEnv(env: Record<string, string | undefined>): Record<string, unknown> {
  const remoteUrl = env.CLASH_REMOTE_LORO_URL?.trim();
  return remoteUrl
    ? { mode: "cloud-sync", capabilities: emptyCapabilities() }
    : { mode: "local-only", capabilities: emptyCapabilities() };
}

function syncStateFromStoredConfig(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { mode: "unknown" };
  if (value.mode === "local-only") {
    return { mode: "local-only", capabilities: emptyCapabilities() };
  }
  if (value.mode !== "cloud-sync" || !nonEmptyString(value.remoteLoroUrl)) {
    return { mode: "unknown" };
  }
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  return {
    mode: "cloud-sync",
    capabilities: {
      canvas: capabilities.canvas === true,
      asset_metadata: capabilities.asset_metadata === true,
      revision_content: capabilities.revision_content === true,
    },
  };
}

function emptyCapabilities(): Record<string, boolean> {
  return {
    canvas: false,
    asset_metadata: false,
    revision_content: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMissingLocalConfigTable(error: unknown): boolean {
  return error instanceof Error && /no such table:\s*local_config/i.test(error.message);
}
