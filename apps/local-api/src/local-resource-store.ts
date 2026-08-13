import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  chmod,
  link,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { extname } from "node:path";

import {
  AssetKindSchema,
  ResourceSchema,
  type AssetKind,
  type Resource,
} from "@clash/shared-types";

import {
  assetPathForRead,
  assetPathForWrite,
  normalizeLocalBlobStorageKey,
} from "./local-asset-paths.js";

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

interface LocalResourceRow {
  resourceId: string;
  kind: AssetKind;
  digest: string;
  byteLength: number;
  contentType?: string;
  storageKey: string;
}

export interface LocalResourceProjection {
  resource: Resource;
  storageKey: string;
  path: string;
}

export interface LocalResourceStore {
  install(input: {
    kind: AssetKind;
    bytes: Uint8Array;
    contentType?: string;
    originalName?: string;
  }): Promise<LocalResourceProjection>;
  adopt(input: {
    kind: AssetKind;
    digest: string;
    byteLength: number;
    contentType?: string;
    localBlobKey: string;
  }): Promise<LocalResourceProjection>;
  resolve(resourceId: string): Promise<LocalResourceProjection | undefined>;
}

export function resourceIdForSha256(digest: string): string {
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("A Resource SHA-256 digest must be 64 lowercase hexadecimal characters.");
  }
  return `sha256:${digest}`;
}

const nodeRequire = createRequire(import.meta.url);

function openDatabase(path: string): SqliteDatabase {
  const { DatabaseSync } = nodeRequire("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS local_resources (
      resource_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      digest_sha256 TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      content_type TEXT,
      storage_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS local_resources_digest
      ON local_resources (digest_sha256);
  `);
  return database;
}

function parseRow(row: Record<string, unknown>): LocalResourceRow {
  const resourceId = row.resource_id;
  const kind = AssetKindSchema.safeParse(row.kind);
  const digest = row.digest_sha256;
  const byteLength = row.byte_length;
  const contentType = row.content_type;
  const storageKey = row.storage_key;
  if (
    typeof resourceId !== "string" ||
    !kind.success ||
    typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    typeof byteLength !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    (contentType !== null && typeof contentType !== "string") ||
    typeof storageKey !== "string"
  ) {
    throw new Error("Local Resource registry row is corrupt.");
  }
  if (resourceId !== resourceIdForSha256(digest)) {
    throw new Error(`Local Resource ${resourceId} has a mismatched digest identity.`);
  }
  return {
    resourceId,
    kind: kind.data,
    digest,
    byteLength,
    ...(typeof contentType === "string" && contentType
      ? { contentType }
      : {}),
    storageKey,
  };
}

function resourceFromRow(row: LocalResourceRow): Resource {
  return ResourceSchema.parse({
    id: row.resourceId,
    kind: row.kind,
    digest: { algorithm: "sha256", value: row.digest },
    byteLength: row.byteLength,
    ...(row.contentType ? { contentType: row.contentType } : {}),
  });
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedContentType(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function extensionFor(input: {
  contentType?: string;
  originalName?: string;
}): string {
  const named = extname(input.originalName ?? "").toLowerCase();
  if (/^\.[a-z0-9]{1,10}$/.test(named)) return named;
  const byType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "model/gltf-binary": ".glb",
  };
  return byType[normalizedContentType(input.contentType) ?? ""] ?? ".bin";
}

function sameFacts(
  existing: LocalResourceRow,
  intended: Omit<LocalResourceRow, "storageKey">,
): boolean {
  return (
    existing.resourceId === intended.resourceId &&
    existing.kind === intended.kind &&
    existing.digest === intended.digest &&
    existing.byteLength === intended.byteLength &&
    existing.contentType === intended.contentType
  );
}

export function createLocalResourceStore(options: {
  dataDir: string;
  clashRoot?: string;
}): LocalResourceStore {
  const databasePath = `${options.dataDir}/local.sqlite`;

  async function withDatabase<T>(task: (database: SqliteDatabase) => T): Promise<T> {
    await mkdir(options.dataDir, { recursive: true });
    const database = openDatabase(databasePath);
    try {
      return task(database);
    } finally {
      database.close();
      await chmod(databasePath, 0o600).catch(() => undefined);
    }
  }

  async function rowFor(resourceId: string): Promise<LocalResourceRow | undefined> {
    return withDatabase((database) => {
      const row = database
        .prepare(`
          SELECT resource_id, kind, digest_sha256, byte_length,
                 content_type, storage_key
          FROM local_resources
          WHERE resource_id = ?
        `)
        .get(resourceId);
      return row ? parseRow(row) : undefined;
    });
  }

  async function projection(row: LocalResourceRow): Promise<LocalResourceProjection> {
    let path: string;
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      path = await assetPathForRead(
        options.dataDir,
        row.storageKey,
        options.clashRoot,
      );
      info = await stat(path);
    } catch (error) {
      throw new Error(`Local Resource ${row.resourceId} is corrupt: immutable bytes are missing.`, {
        cause: error,
      });
    }
    if (!info.isFile() || info.size !== row.byteLength) {
      throw new Error(
        `Local Resource ${row.resourceId} is corrupt: byte length does not match its registry facts.`,
      );
    }
    try {
      await verifyBytes({
        path,
        digest: row.digest,
        byteLength: row.byteLength,
      });
    } catch (error) {
      throw new Error(
        `Local Resource ${row.resourceId} is corrupt: bytes do not match its immutable digest.`,
        { cause: error },
      );
    }
    return { resource: resourceFromRow(row), storageKey: row.storageKey, path };
  }

  async function persist(
    intended: Omit<LocalResourceRow, "storageKey">,
    storageKey: string,
  ): Promise<LocalResourceProjection> {
    await withDatabase((database) => {
      database
        .prepare(`
          INSERT OR IGNORE INTO local_resources (
            resource_id, kind, digest_sha256, byte_length,
            content_type, storage_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          intended.resourceId,
          intended.kind,
          intended.digest,
          intended.byteLength,
          intended.contentType ?? null,
          storageKey,
          Date.now(),
        );
    });
    const stored = await rowFor(intended.resourceId);
    if (!stored) {
      throw new Error(`Local Resource ${intended.resourceId} was not indexed.`);
    }
    if (!sameFacts(stored, intended)) {
      throw new Error(
        `Local Resource ${intended.resourceId} already exists with different immutable facts.`,
      );
    }
    return projection(stored);
  }

  async function verifyBytes(input: {
    path: string;
    digest: string;
    byteLength: number;
  }): Promise<void> {
    const bytes = new Uint8Array(await readFile(input.path));
    if (bytes.byteLength !== input.byteLength) {
      throw new Error("Local Resource byte length does not match the claimed immutable facts.");
    }
    if (sha256(bytes) !== input.digest) {
      throw new Error("Local Resource digest does not match the claimed immutable facts.");
    }
  }

  return {
    async install(input) {
      const kind = AssetKindSchema.parse(input.kind);
      const digest = sha256(input.bytes);
      const resourceId = resourceIdForSha256(digest);
      const contentType = normalizedContentType(input.contentType);
      const intended = {
        resourceId,
        kind,
        digest,
        byteLength: input.bytes.byteLength,
        ...(contentType ? { contentType } : {}),
      };
      const existing = await rowFor(resourceId);
      if (existing) {
        if (!sameFacts(existing, intended)) {
          throw new Error(
            `Local Resource ${resourceId} already exists with different immutable facts.`,
          );
        }
        return projection(existing);
      }

      const storageKey = `local-blobs/${digest}/original${extensionFor(input)}`;
      const path = await assetPathForWrite(
        options.dataDir,
        storageKey,
        options.clashRoot,
      );
      const temporaryPath = `${path}.staging-${randomUUID()}`;
      await writeFile(temporaryPath, input.bytes, { flag: "wx", mode: 0o444 });
      try {
        await link(temporaryPath, path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
      await chmod(path, 0o444);
      await verifyBytes({ path, digest, byteLength: input.bytes.byteLength });
      return persist(intended, storageKey);
    },

    async adopt(input) {
      const kind = AssetKindSchema.parse(input.kind);
      const resourceId = resourceIdForSha256(input.digest);
      if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0) {
        throw new Error("A Local Resource byte length must be a non-negative safe integer.");
      }
      const storageKey = normalizeLocalBlobStorageKey(input.localBlobKey);
      const path = await assetPathForRead(
        options.dataDir,
        storageKey,
        options.clashRoot,
      );
      await verifyBytes({
        path,
        digest: input.digest,
        byteLength: input.byteLength,
      });
      await chmod(path, 0o444);
      const contentType = normalizedContentType(input.contentType);
      return persist(
        {
          resourceId,
          kind,
          digest: input.digest,
          byteLength: input.byteLength,
          ...(contentType ? { contentType } : {}),
        },
        storageKey,
      );
    },

    async resolve(resourceId) {
      const normalized = resourceId.trim();
      if (!normalized) return undefined;
      const row = await rowFor(normalized);
      return row ? projection(row) : undefined;
    },
  };
}
