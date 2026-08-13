import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  AssetKindSchema,
  ProjectAssetMetadataSchema,
  type AssetKind,
  type ProjectAssetMetadata,
} from "@clash/shared-types";

import {
  createLocalResourceStore,
  type LocalResourceProjection,
} from "./local-resource-store.js";

interface SqliteRunResult {
  changes: number | bigint;
}

interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export interface LocalDurableStagedOutput {
  projectId: string;
  actionRunId: string;
  outputSlot: string;
  projectAssetId: string;
  kind: AssetKind;
  metadata: ProjectAssetMetadata;
  result?: {
    provider?: string;
    modelEndpoint?: string;
    requestId?: string;
  };
  projection: LocalResourceProjection;
}

export interface LocalDurableOutputStagingStore {
  stage(input: {
    projectId: string;
    actionRunId: string;
    outputSlot: string;
    kind: AssetKind;
    bytes: Uint8Array;
    contentType: string;
    metadata?: ProjectAssetMetadata;
    result?: LocalDurableStagedOutput["result"];
  }): Promise<LocalDurableStagedOutput>;
  resolve(input: {
    projectId: string;
    actionRunId: string;
    outputSlot: string;
  }): Promise<LocalDurableStagedOutput | undefined>;
}

type StoredOutput = Omit<LocalDurableStagedOutput, "projection"> & {
  resourceId: string;
};

const nodeRequire = createRequire(import.meta.url);

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function projectAssetId(input: {
  projectId: string;
  actionRunId: string;
  outputSlot: string;
}): string {
  const digest = createHash("sha256")
    .update(input.projectId)
    .update("\0")
    .update(input.actionRunId)
    .update("\0")
    .update(input.outputSlot)
    .digest("hex");
  return `local-output:${digest}`;
}

function openDatabase(path: string): SqliteDatabase {
  const { DatabaseSync } = nodeRequire("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS local_durable_output_staging (
      project_id TEXT NOT NULL,
      action_run_id TEXT NOT NULL,
      output_slot TEXT NOT NULL,
      project_asset_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      result_json TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, action_run_id, output_slot)
    );
  `);
  return database;
}

function parseRow(row: Record<string, unknown>): StoredOutput {
  const projectId = row.project_id;
  const actionRunId = row.action_run_id;
  const outputSlot = row.output_slot;
  const projectAssetIdValue = row.project_asset_id;
  const resourceId = row.resource_id;
  const kind = AssetKindSchema.safeParse(row.kind);
  if (
    typeof projectId !== "string" ||
    typeof actionRunId !== "string" ||
    typeof outputSlot !== "string" ||
    typeof projectAssetIdValue !== "string" ||
    typeof resourceId !== "string" ||
    !kind.success ||
    typeof row.metadata_json !== "string" ||
    (row.result_json !== null && typeof row.result_json !== "string")
  ) {
    throw new Error("Local durable output staging row is corrupt.");
  }
  let metadataValue: unknown;
  try {
    metadataValue = JSON.parse(row.metadata_json);
  } catch {
    throw new Error("Local durable output staging metadata is corrupt.");
  }
  let result: LocalDurableStagedOutput["result"];
  if (typeof row.result_json === "string") {
    const value = JSON.parse(row.result_json) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Local durable output staging result is corrupt.");
    }
    const record = value as Record<string, unknown>;
    for (const field of ["provider", "modelEndpoint", "requestId"] as const) {
      if (record[field] !== undefined && typeof record[field] !== "string") {
        throw new Error("Local durable output staging result is corrupt.");
      }
    }
    result = record as LocalDurableStagedOutput["result"];
  }
  return {
    projectId,
    actionRunId,
    outputSlot,
    projectAssetId: projectAssetIdValue,
    resourceId,
    kind: kind.data,
    metadata: ProjectAssetMetadataSchema.parse(metadataValue),
    ...(result ? { result } : {}),
  };
}

export function createLocalDurableOutputStagingStore(options: {
  dataDir: string;
}): LocalDurableOutputStagingStore {
  const databasePath = join(options.dataDir, "local.sqlite");
  const resources = createLocalResourceStore({ dataDir: options.dataDir });

  async function withDatabase<T>(
    task: (database: SqliteDatabase) => T,
  ): Promise<T> {
    await mkdir(options.dataDir, { recursive: true });
    const database = openDatabase(databasePath);
    try {
      return task(database);
    } finally {
      database.close();
      await chmod(databasePath, 0o600).catch(() => undefined);
    }
  }

  async function load(input: {
    projectId: string;
    actionRunId: string;
    outputSlot: string;
  }): Promise<StoredOutput | undefined> {
    return withDatabase((database) => {
      const row = database
        .prepare(
          `SELECT project_id, action_run_id, output_slot, project_asset_id,
                  resource_id, kind, metadata_json, result_json
             FROM local_durable_output_staging
            WHERE project_id = ? AND action_run_id = ? AND output_slot = ?`,
        )
        .get(input.projectId, input.actionRunId, input.outputSlot);
      return row ? parseRow(row) : undefined;
    });
  }

  async function resolveStored(
    stored: StoredOutput,
  ): Promise<LocalDurableStagedOutput> {
    const projection = await resources.resolve(stored.resourceId);
    if (!projection || projection.resource.kind !== stored.kind) {
      throw new Error(
        `Durable output ${stored.actionRunId}/${stored.outputSlot} has no matching immutable Resource.`,
      );
    }
    return { ...stored, projection };
  }

  return {
    async stage(input) {
      const identity = {
        projectId: required(input.projectId, "projectId"),
        actionRunId: required(input.actionRunId, "actionRunId"),
        outputSlot: required(input.outputSlot, "outputSlot"),
      };
      const existing = await load(identity);
      if (existing) return resolveStored(existing);

      const projection = await resources.install({
        kind: input.kind,
        bytes: input.bytes,
        contentType: input.contentType,
      });
      const metadata = ProjectAssetMetadataSchema.parse({
        ...(input.metadata ?? {}),
        bytes: projection.resource.byteLength,
        contentType: projection.resource.contentType ?? input.contentType,
      });
      const intended: StoredOutput = {
        ...identity,
        projectAssetId: projectAssetId(identity),
        resourceId: projection.resource.id,
        kind: input.kind,
        metadata,
        ...(input.result ? { result: input.result } : {}),
      };
      await withDatabase((database) => {
        database
          .prepare(
            `INSERT OR IGNORE INTO local_durable_output_staging (
               project_id, action_run_id, output_slot, project_asset_id,
               resource_id, kind, metadata_json, result_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            intended.projectId,
            intended.actionRunId,
            intended.outputSlot,
            intended.projectAssetId,
            intended.resourceId,
            intended.kind,
            JSON.stringify(intended.metadata),
            intended.result ? JSON.stringify(intended.result) : null,
            Date.now(),
          );
      });
      const winner = await load(identity);
      if (!winner)
        throw new Error("Durable output staging receipt was not recorded.");
      return resolveStored(winner);
    },

    async resolve(input) {
      const identity = {
        projectId: required(input.projectId, "projectId"),
        actionRunId: required(input.actionRunId, "actionRunId"),
        outputSlot: required(input.outputSlot, "outputSlot"),
      };
      const stored = await load(identity);
      return stored ? resolveStored(stored) : undefined;
    },
  };
}
