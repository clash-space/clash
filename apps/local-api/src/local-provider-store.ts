import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  providerAccountKey,
  type LocalProviderAccountConfig,
  type LocalProviderOAuthRecord,
} from "./provider-accounts.js";

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

const require = createRequire(import.meta.url);
const PROVIDER_ACCOUNTS_MIGRATION_ID = "provider-accounts-sqlite-v1";
const PROVIDER_OAUTH_MIGRATION_ID = "provider-oauth-sqlite-v1";
const SECRET_PREFIX = "enc:v1:";
const KEYCHAIN_SERVICE = "com.master-clash.local-api.provider-store";
const execFileAsync = promisify(execFile);
const secretKeyCache = new Map<string, Promise<Buffer>>();

function sqlitePath(dataDir: string): string {
  return join(dataDir, "local.sqlite");
}

function fallbackKeyPath(dataDir: string): string {
  return join(dataDir, "provider-secret.key");
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

    CREATE TABLE IF NOT EXISTS provider_accounts (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      id TEXT,
      provider_id TEXT NOT NULL,
      upstream_id TEXT,
      region TEXT,
      label TEXT,
      enabled INTEGER NOT NULL,
      priority REAL,
      weight REAL,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, account_key)
    );

    CREATE TABLE IF NOT EXISTS provider_account_credentials (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      credential_key TEXT NOT NULL,
      credential_value TEXT NOT NULL,
      PRIMARY KEY (user_id, account_key, credential_key)
    );

    CREATE TABLE IF NOT EXISTS provider_account_supported_models (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      model_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (user_id, account_key, model_id)
    );

    CREATE TABLE IF NOT EXISTS provider_account_model_priorities (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      model_id TEXT NOT NULL,
      priority REAL NOT NULL,
      PRIMARY KEY (user_id, account_key, model_id)
    );

    CREATE TABLE IF NOT EXISTS provider_oauth (
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_type TEXT,
      verification_uri TEXT,
      user_code TEXT,
      device_code TEXT,
      interval_seconds INTEGER,
      account_label TEXT,
      expires_at TEXT,
      error TEXT,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, provider_id, account_id)
    );
  `);
  try {
    ensureLocalProviderSqliteColumns(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function ensureSqliteColumn(db: SqliteDatabase, table: string, columnDefinition: string): void {
  const columnName = columnDefinition.trim().split(/\s+/)[0];
  if (!columnName) return;
  const columns = new Set(
    db.prepare(`PRAGMA table_info(${table})`).all()
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string"),
  );
  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`);
  }
}

function sqlitePrimaryKeyColumns(db: SqliteDatabase, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .map((row) => ({
      name: typeof row.name === "string" ? row.name : "",
      pk: typeof row.pk === "number" ? row.pk : 0,
    }))
    .filter((row) => row.name && row.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((row) => row.name);
}

function hasPrimaryKey(db: SqliteDatabase, table: string, expectedColumns: string[]): boolean {
  const actual = sqlitePrimaryKeyColumns(db, table);
  return actual.length === expectedColumns.length && actual.every((column, index) => column === expectedColumns[index]);
}

function rebuildProviderTableIfPrimaryKeyDiffers(
  db: SqliteDatabase,
  table: string,
  expectedPrimaryKey: string[],
  columns: string[],
  createTableSql: (tableName: string) => string,
): void {
  if (hasPrimaryKey(db, table, expectedPrimaryKey)) return;
  const tempTable = `${table}__schema_upgrade`;
  const columnList = columns.join(", ");
  db.exec(`
    DROP TABLE IF EXISTS ${tempTable};
    ${createTableSql(tempTable)}
    INSERT OR IGNORE INTO ${tempTable} (${columnList})
      SELECT ${columnList} FROM ${table};
    DROP TABLE ${table};
    ALTER TABLE ${tempTable} RENAME TO ${table};
  `);
}

function providerAccountsTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      id TEXT,
      provider_id TEXT NOT NULL,
      upstream_id TEXT,
      region TEXT,
      label TEXT,
      enabled INTEGER NOT NULL,
      priority REAL,
      weight REAL,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, account_key)
    );
  `;
}

function providerAccountCredentialsTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      credential_key TEXT NOT NULL,
      credential_value TEXT NOT NULL,
      PRIMARY KEY (user_id, account_key, credential_key)
    );
  `;
}

function providerAccountSupportedModelsTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      model_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (user_id, account_key, model_id)
    );
  `;
}

function providerAccountModelPrioritiesTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      model_id TEXT NOT NULL,
      priority REAL NOT NULL,
      PRIMARY KEY (user_id, account_key, model_id)
    );
  `;
}

function providerOAuthTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_type TEXT,
      verification_uri TEXT,
      user_code TEXT,
      device_code TEXT,
      interval_seconds INTEGER,
      account_label TEXT,
      expires_at TEXT,
      error TEXT,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, provider_id, account_id)
    );
  `;
}

function ensureLocalProviderSqliteColumns(db: SqliteDatabase): void {
  for (const column of [
    "completed_at INTEGER NOT NULL DEFAULT 0",
    "source_path TEXT NOT NULL DEFAULT ''",
    "source_sha256 TEXT NOT NULL DEFAULT ''",
  ]) {
    ensureSqliteColumn(db, "local_migration", column);
  }
  for (const column of [
    "account_key TEXT NOT NULL DEFAULT ''",
    "id TEXT",
    "provider_id TEXT NOT NULL DEFAULT ''",
    "upstream_id TEXT",
    "region TEXT",
    "label TEXT",
    "enabled INTEGER NOT NULL DEFAULT 1",
    "priority REAL",
    "weight REAL",
    "created_at TEXT",
    "updated_at TEXT",
  ]) {
    ensureSqliteColumn(db, "provider_accounts", column);
  }
  for (const column of [
    "account_key TEXT NOT NULL DEFAULT ''",
    "credential_key TEXT NOT NULL DEFAULT ''",
    "credential_value TEXT NOT NULL DEFAULT ''",
  ]) {
    ensureSqliteColumn(db, "provider_account_credentials", column);
  }
  for (const column of [
    "account_key TEXT NOT NULL DEFAULT ''",
    "model_id TEXT NOT NULL DEFAULT ''",
    "position INTEGER NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "provider_account_supported_models", column);
  }
  for (const column of [
    "account_key TEXT NOT NULL DEFAULT ''",
    "model_id TEXT NOT NULL DEFAULT ''",
    "priority REAL NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "provider_account_model_priorities", column);
  }
  for (const column of [
    "provider_id TEXT NOT NULL DEFAULT ''",
    "account_id TEXT NOT NULL DEFAULT ''",
    "status TEXT NOT NULL DEFAULT 'pending'",
    "access_token TEXT",
    "refresh_token TEXT",
    "token_type TEXT",
    "verification_uri TEXT",
    "user_code TEXT",
    "device_code TEXT",
    "interval_seconds INTEGER",
    "account_label TEXT",
    "expires_at TEXT",
    "error TEXT",
    "created_at TEXT",
    "updated_at TEXT",
  ]) {
    ensureSqliteColumn(db, "provider_oauth", column);
  }
  rebuildProviderTableIfPrimaryKeyDiffers(db, "provider_accounts", ["user_id", "account_key"], [
    "user_id",
    "account_key",
    "id",
    "provider_id",
    "upstream_id",
    "region",
    "label",
    "enabled",
    "priority",
    "weight",
    "created_at",
    "updated_at",
  ], providerAccountsTableSql);
  rebuildProviderTableIfPrimaryKeyDiffers(
    db,
    "provider_account_credentials",
    ["user_id", "account_key", "credential_key"],
    ["user_id", "account_key", "credential_key", "credential_value"],
    providerAccountCredentialsTableSql,
  );
  rebuildProviderTableIfPrimaryKeyDiffers(
    db,
    "provider_account_supported_models",
    ["user_id", "account_key", "model_id"],
    ["user_id", "account_key", "model_id", "position"],
    providerAccountSupportedModelsTableSql,
  );
  rebuildProviderTableIfPrimaryKeyDiffers(
    db,
    "provider_account_model_priorities",
    ["user_id", "account_key", "model_id"],
    ["user_id", "account_key", "model_id", "priority"],
    providerAccountModelPrioritiesTableSql,
  );
  rebuildProviderTableIfPrimaryKeyDiffers(db, "provider_oauth", ["user_id", "provider_id", "account_id"], [
    "user_id",
    "provider_id",
    "account_id",
    "status",
    "access_token",
    "refresh_token",
    "token_type",
    "verification_uri",
    "user_code",
    "device_code",
    "interval_seconds",
    "account_label",
    "expires_at",
    "error",
    "created_at",
    "updated_at",
  ], providerOAuthTableSql);
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

function rowOptionalString(row: Record<string, unknown>, key: string): string | undefined {
  return optionalString(row[key]);
}

function rowOptionalNumber(row: Record<string, unknown>, key: string): number | undefined {
  return optionalNumber(row[key]);
}

function keyFromString(value: string): Buffer {
  const trimmed = value.trim();
  if (trimmed.startsWith("base64:")) {
    const decoded = Buffer.from(trimmed.slice("base64:".length), "base64");
    if (decoded.byteLength === 32) return decoded;
  }
  return createHash("sha256").update(trimmed).digest();
}

function shouldUseKeychain(dataDir: string): boolean {
  if (process.env.CLASH_LOCAL_PROVIDER_SECRET_KEY || process.env.CLASH_LOCAL_SECRET_KEY) return false;
  if (process.env.CLASH_LOCAL_KEYCHAIN === "0") return false;
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return false;
  if (dataDir.includes("/.tmp/") || dataDir.includes("/var/folders/")) return false;
  return process.platform === "darwin";
}

function keychainAccount(dataDir: string): string {
  const digest = createHash("sha256").update(dataDir).digest("hex").slice(0, 24);
  return `local-api:${digest}`;
}

async function resolveKeyFromKeychain(dataDir: string): Promise<Buffer | null> {
  if (!shouldUseKeychain(dataDir)) return null;
  const account = keychainAccount(dataDir);
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      account,
      "-w",
    ]);
    const value = stdout.trim();
    if (value) return keyFromString(`base64:${value}`);
  } catch {
    // Missing keychain item: create one below.
  }

  const generated = randomBytes(32).toString("base64");
  await execFileAsync("security", [
    "add-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    account,
    "-w",
    generated,
    "-U",
  ]);
  return keyFromString(`base64:${generated}`);
}

async function resolveKeyFromFile(dataDir: string): Promise<Buffer> {
  const path = fallbackKeyPath(dataDir);
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing) return keyFromString(`base64:${existing}`);
  } catch {
    // Generate below.
  }
  await mkdir(dataDir, { recursive: true });
  const generated = randomBytes(32).toString("base64");
  await writeFile(path, `${generated}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
  return keyFromString(`base64:${generated}`);
}

async function resolveProviderSecretKey(dataDir: string): Promise<Buffer> {
  const cached = secretKeyCache.get(dataDir);
  if (cached) return cached;
  const task = (async () => {
    const envKey = process.env.CLASH_LOCAL_PROVIDER_SECRET_KEY || process.env.CLASH_LOCAL_SECRET_KEY;
    if (envKey) return keyFromString(envKey);
    const keychainKey = await resolveKeyFromKeychain(dataDir);
    if (keychainKey) return keychainKey;
    return resolveKeyFromFile(dataDir);
  })();
  secretKeyCache.set(dataDir, task);
  return task;
}

function encryptSecret(value: string, key: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_PREFIX.slice(0, -1),
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

function decryptSecret(value: string, key: Buffer, aad: string): string {
  if (!value.startsWith(SECRET_PREFIX)) return value;
  const parts = value.split(":");
  if (parts.length !== 5) throw new Error("Invalid encrypted local provider secret");
  const [, version, ivText, tagText, encryptedText] = parts;
  if (version !== "v1") throw new Error(`Unsupported encrypted local provider secret version: ${version}`);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new Error("Unable to decrypt local provider secret", { cause: error });
  }
}

function providerCredentialAad(userId: string, accountKey: string, credentialKey: string): string {
  return `provider-account-credential:${userId}:${accountKey}:${credentialKey}`;
}

function providerOAuthAad(userId: string, providerId: string, accountId: string, field: string): string {
  return `provider-oauth:${userId}:${providerId}:${accountId}:${field}`;
}

function rowCount(db: SqliteDatabase, sql: string): number {
  const row = db.prepare(sql).get();
  const value = row?.count;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasMigrationMarker(db: SqliteDatabase, id: string): boolean {
  return Boolean(db.prepare("SELECT id FROM local_migration WHERE id = ?").get(id));
}

function markMigration(db: SqliteDatabase, id: string, dataDir: string, sourceSha256: string): void {
  db.prepare(`
    INSERT OR REPLACE INTO local_migration (id, completed_at, source_path, source_sha256)
    VALUES (?, ?, ?, ?)
  `).run(id, Math.floor(Date.now() / 1000), sqlitePath(dataDir), sourceSha256);
}

function hasProviderAccountRows(db: SqliteDatabase): boolean {
  return rowCount(db, "SELECT COUNT(*) AS count FROM provider_accounts") > 0;
}

function hasProviderOAuthRows(db: SqliteDatabase): boolean {
  return rowCount(db, "SELECT COUNT(*) AS count FROM provider_oauth") > 0;
}

function hasPlaintextProviderAccountSecrets(db: SqliteDatabase): boolean {
  return rowCount(db, `
    SELECT COUNT(*) AS count
      FROM provider_account_credentials
     WHERE credential_value IS NOT NULL
       AND credential_value != ''
       AND credential_value NOT LIKE '${SECRET_PREFIX}%'
  `) > 0;
}

function hasPlaintextProviderOAuthSecrets(db: SqliteDatabase): boolean {
  return rowCount(db, `
    SELECT COUNT(*) AS count
      FROM provider_oauth
     WHERE (access_token IS NOT NULL AND access_token != '' AND access_token NOT LIKE '${SECRET_PREFIX}%')
        OR (refresh_token IS NOT NULL AND refresh_token != '' AND refresh_token NOT LIKE '${SECRET_PREFIX}%')
        OR (user_code IS NOT NULL AND user_code != '' AND user_code NOT LIKE '${SECRET_PREFIX}%')
        OR (device_code IS NOT NULL AND device_code != '' AND device_code NOT LIKE '${SECRET_PREFIX}%')
  `) > 0;
}

function replaceProviderAccountsUnsafe(db: SqliteDatabase, accounts: LocalProviderAccountConfig[], secretKey: Buffer): void {
  db.prepare("DELETE FROM provider_account_model_priorities").run();
  db.prepare("DELETE FROM provider_account_supported_models").run();
  db.prepare("DELETE FROM provider_account_credentials").run();
  db.prepare("DELETE FROM provider_accounts").run();

  const insertAccount = db.prepare(`
    INSERT INTO provider_accounts (
      user_id, account_key, id, provider_id, upstream_id, region, label,
      enabled, priority, weight, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCredential = db.prepare(`
    INSERT INTO provider_account_credentials (
      user_id, account_key, credential_key, credential_value
    ) VALUES (?, ?, ?, ?)
  `);
  const insertSupportedModel = db.prepare(`
    INSERT INTO provider_account_supported_models (
      user_id, account_key, model_id, position
    ) VALUES (?, ?, ?, ?)
  `);
  const insertModelPriority = db.prepare(`
    INSERT INTO provider_account_model_priorities (
      user_id, account_key, model_id, priority
    ) VALUES (?, ?, ?, ?)
  `);

  for (const account of accounts) {
    const userId = account.userId ?? "local-user";
    const accountKey = providerAccountKey(account);
    insertAccount.run(
      userId,
      accountKey,
      account.id ?? null,
      account.providerId,
      account.upstreamId ?? null,
      account.region ?? null,
      account.label ?? null,
      account.enabled ? 1 : 0,
      account.priority ?? null,
      account.weight ?? null,
      account.createdAt ?? null,
      account.updatedAt ?? null,
    );
    for (const [credentialKey, value] of Object.entries(account.credentials ?? {})) {
      insertCredential.run(
        userId,
        accountKey,
        credentialKey,
        encryptSecret(value, secretKey, providerCredentialAad(userId, accountKey, credentialKey)),
      );
    }
    account.supportedModelIds?.forEach((modelId, position) => {
      insertSupportedModel.run(userId, accountKey, modelId, position);
    });
    for (const [modelId, priority] of Object.entries(account.modelPriorities ?? {})) {
      insertModelPriority.run(userId, accountKey, modelId, priority);
    }
  }
}

function replaceProviderOAuthUnsafe(db: SqliteDatabase, records: LocalProviderOAuthRecord[], secretKey: Buffer): void {
  db.prepare("DELETE FROM provider_oauth").run();
  const insert = db.prepare(`
    INSERT INTO provider_oauth (
      user_id, provider_id, account_id, status, access_token, refresh_token,
      token_type, verification_uri, user_code, device_code, interval_seconds,
      account_label, expires_at, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const record of records) {
    const userId = record.userId ?? "local-user";
    const accountId = record.accountId ?? "";
    insert.run(
      userId,
      record.providerId,
      accountId,
      record.status,
      record.accessToken
        ? encryptSecret(record.accessToken, secretKey, providerOAuthAad(userId, record.providerId, accountId, "access_token"))
        : null,
      record.refreshToken
        ? encryptSecret(record.refreshToken, secretKey, providerOAuthAad(userId, record.providerId, accountId, "refresh_token"))
        : null,
      record.tokenType ?? null,
      record.verificationUri ?? null,
      record.userCode
        ? encryptSecret(record.userCode, secretKey, providerOAuthAad(userId, record.providerId, accountId, "user_code"))
        : null,
      record.deviceCode
        ? encryptSecret(record.deviceCode, secretKey, providerOAuthAad(userId, record.providerId, accountId, "device_code"))
        : null,
      record.intervalSeconds ?? null,
      record.accountLabel ?? null,
      record.expiresAt ?? null,
      record.error ?? null,
      record.createdAt ?? null,
      record.updatedAt ?? null,
    );
  }
}

function readProviderAccountsUnsafe(db: SqliteDatabase, secretKey: Buffer): LocalProviderAccountConfig[] {
  const accountRows = db.prepare(`
    SELECT user_id, account_key, id, provider_id, upstream_id, region, label,
           enabled, priority, weight, created_at, updated_at
      FROM provider_accounts
     ORDER BY user_id, provider_id, upstream_id, region, id
  `).all();
  const credentialRows = db.prepare(`
    SELECT user_id, account_key, credential_key, credential_value
      FROM provider_account_credentials
     ORDER BY user_id, account_key, credential_key
  `).all();
  const supportedRows = db.prepare(`
    SELECT user_id, account_key, model_id
      FROM provider_account_supported_models
     ORDER BY user_id, account_key, position
  `).all();
  const priorityRows = db.prepare(`
    SELECT user_id, account_key, model_id, priority
      FROM provider_account_model_priorities
     ORDER BY user_id, account_key, model_id
  `).all();

  const credentials = new Map<string, Record<string, string>>();
  for (const row of credentialRows) {
    const userId = rowString(row, "user_id");
    const accountKey = rowString(row, "account_key");
    const credentialKey = rowString(row, "credential_key");
    const key = `${userId}\n${accountKey}`;
    const values = credentials.get(key) ?? {};
    values[credentialKey] = decryptSecret(
      rowString(row, "credential_value"),
      secretKey,
      providerCredentialAad(userId, accountKey, credentialKey),
    );
    credentials.set(key, values);
  }

  const supportedModels = new Map<string, string[]>();
  for (const row of supportedRows) {
    const key = `${rowString(row, "user_id")}\n${rowString(row, "account_key")}`;
    const values = supportedModels.get(key) ?? [];
    values.push(rowString(row, "model_id"));
    supportedModels.set(key, values);
  }

  const modelPriorities = new Map<string, Record<string, number>>();
  for (const row of priorityRows) {
    const key = `${rowString(row, "user_id")}\n${rowString(row, "account_key")}`;
    const values = modelPriorities.get(key) ?? {};
    const priority = rowOptionalNumber(row, "priority");
    if (priority !== undefined) values[rowString(row, "model_id")] = priority;
    modelPriorities.set(key, values);
  }

  return accountRows.map((row) => {
    const userId = rowString(row, "user_id");
    const accountKey = rowString(row, "account_key");
    const childKey = `${userId}\n${accountKey}`;
    const account: LocalProviderAccountConfig = {
      userId,
      ...(rowOptionalString(row, "id") ? { id: rowOptionalString(row, "id") } : {}),
      providerId: rowString(row, "provider_id") as LocalProviderAccountConfig["providerId"],
      ...(rowOptionalString(row, "upstream_id") ? { upstreamId: rowOptionalString(row, "upstream_id") as LocalProviderAccountConfig["upstreamId"] } : {}),
      ...(rowOptionalString(row, "region") ? { region: rowOptionalString(row, "region") } : {}),
      ...(rowOptionalString(row, "label") ? { label: rowOptionalString(row, "label") } : {}),
      enabled: row.enabled !== 0,
      ...(rowOptionalNumber(row, "priority") !== undefined ? { priority: rowOptionalNumber(row, "priority") } : {}),
      ...(rowOptionalNumber(row, "weight") !== undefined ? { weight: rowOptionalNumber(row, "weight") } : {}),
      ...(rowOptionalString(row, "created_at") ? { createdAt: rowOptionalString(row, "created_at") } : {}),
      ...(rowOptionalString(row, "updated_at") ? { updatedAt: rowOptionalString(row, "updated_at") } : {}),
    };
    const accountCredentials = credentials.get(childKey);
    if (accountCredentials && Object.keys(accountCredentials).length > 0) account.credentials = accountCredentials;
    const accountSupportedModels = supportedModels.get(childKey);
    if (accountSupportedModels?.length) account.supportedModelIds = accountSupportedModels;
    const accountModelPriorities = modelPriorities.get(childKey);
    if (accountModelPriorities && Object.keys(accountModelPriorities).length > 0) account.modelPriorities = accountModelPriorities;
    return account;
  });
}

function decryptOAuthField(
  row: Record<string, unknown>,
  secretKey: Buffer,
  field: "access_token" | "refresh_token" | "user_code" | "device_code",
): string | undefined {
  const value = rowOptionalString(row, field);
  if (!value) return undefined;
  return decryptSecret(
    value,
    secretKey,
    providerOAuthAad(
      rowString(row, "user_id"),
      rowString(row, "provider_id"),
      rowString(row, "account_id"),
      field,
    ),
  );
}

function readProviderOAuthUnsafe(db: SqliteDatabase, secretKey: Buffer): LocalProviderOAuthRecord[] {
  return db.prepare(`
    SELECT user_id, provider_id, account_id, status, access_token, refresh_token,
           token_type, verification_uri, user_code, device_code, interval_seconds,
           account_label, expires_at, error, created_at, updated_at
      FROM provider_oauth
     ORDER BY user_id, provider_id, account_id
  `).all().map((row) => {
    const accessToken = decryptOAuthField(row, secretKey, "access_token");
    const refreshToken = decryptOAuthField(row, secretKey, "refresh_token");
    const userCode = decryptOAuthField(row, secretKey, "user_code");
    const deviceCode = decryptOAuthField(row, secretKey, "device_code");
    return {
      userId: rowString(row, "user_id"),
      providerId: rowString(row, "provider_id") as LocalProviderOAuthRecord["providerId"],
      ...(rowOptionalString(row, "account_id") ? { accountId: rowOptionalString(row, "account_id") } : {}),
      status: rowString(row, "status") as LocalProviderOAuthRecord["status"],
      ...(accessToken ? { accessToken } : {}),
      ...(refreshToken ? { refreshToken } : {}),
      ...(rowOptionalString(row, "token_type") ? { tokenType: rowOptionalString(row, "token_type") } : {}),
      ...(rowOptionalString(row, "verification_uri") ? { verificationUri: rowOptionalString(row, "verification_uri") } : {}),
      ...(userCode ? { userCode } : {}),
      ...(deviceCode ? { deviceCode } : {}),
      ...(rowOptionalNumber(row, "interval_seconds") !== undefined ? { intervalSeconds: rowOptionalNumber(row, "interval_seconds") } : {}),
      ...(rowOptionalString(row, "account_label") ? { accountLabel: rowOptionalString(row, "account_label") } : {}),
      ...(rowOptionalString(row, "expires_at") ? { expiresAt: rowOptionalString(row, "expires_at") } : {}),
      ...(rowOptionalString(row, "error") ? { error: rowOptionalString(row, "error") } : {}),
      ...(rowOptionalString(row, "created_at") ? { createdAt: rowOptionalString(row, "created_at") } : {}),
      ...(rowOptionalString(row, "updated_at") ? { updatedAt: rowOptionalString(row, "updated_at") } : {}),
    };
  });
}

export function createLocalProviderStore(dataDir: string) {
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

  async function ensureProviderAccountsMigrated(): Promise<void> {
    if (!(await exists())) return;
    const secretKey = await resolveProviderSecretKey(dataDir);
    await withDb((db) => {
      if (hasMigrationMarker(db, PROVIDER_ACCOUNTS_MIGRATION_ID) && !hasPlaintextProviderAccountSecrets(db)) return;
      if (!hasProviderAccountRows(db)) return;
      if (hasProviderAccountRows(db)) {
        const accounts = readProviderAccountsUnsafe(db, secretKey);
        db.exec("BEGIN IMMEDIATE");
        try {
          replaceProviderAccountsUnsafe(db, accounts, secretKey);
          markMigration(db, PROVIDER_ACCOUNTS_MIGRATION_ID, dataDir, "");
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return;
      }
    });
  }

  async function ensureProviderOAuthMigrated(): Promise<void> {
    if (!(await exists())) return;
    const secretKey = await resolveProviderSecretKey(dataDir);
    await withDb((db) => {
      if (hasMigrationMarker(db, PROVIDER_OAUTH_MIGRATION_ID) && !hasPlaintextProviderOAuthSecrets(db)) return;
      if (!hasProviderOAuthRows(db)) return;
      if (hasProviderOAuthRows(db)) {
        const records = readProviderOAuthUnsafe(db, secretKey);
        db.exec("BEGIN IMMEDIATE");
        try {
          replaceProviderOAuthUnsafe(db, records, secretKey);
          markMigration(db, PROVIDER_OAUTH_MIGRATION_ID, dataDir, "");
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return;
      }
    });
  }

  async function loadProviderAccounts(): Promise<LocalProviderAccountConfig[]> {
    if (!(await exists())) return [];
    await ensureProviderAccountsMigrated();
    const secretKey = await resolveProviderSecretKey(dataDir);
    return withDb((db) => readProviderAccountsUnsafe(db, secretKey));
  }

  async function saveProviderAccounts(accounts: LocalProviderAccountConfig[]): Promise<void> {
    if (accounts.length === 0 && !(await exists())) return;
    const secretKey = await resolveProviderSecretKey(dataDir);
    await withDb((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        replaceProviderAccountsUnsafe(db, accounts, secretKey);
        if (
          accounts.length > 0 ||
          hasMigrationMarker(db, PROVIDER_ACCOUNTS_MIGRATION_ID)
        ) {
          markMigration(db, PROVIDER_ACCOUNTS_MIGRATION_ID, dataDir, "");
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async function loadProviderOAuth(): Promise<LocalProviderOAuthRecord[]> {
    if (!(await exists())) return [];
    await ensureProviderOAuthMigrated();
    const secretKey = await resolveProviderSecretKey(dataDir);
    return withDb((db) => readProviderOAuthUnsafe(db, secretKey));
  }

  async function saveProviderOAuth(records: LocalProviderOAuthRecord[]): Promise<void> {
    if (records.length === 0 && !(await exists())) return;
    const secretKey = await resolveProviderSecretKey(dataDir);
    await withDb((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        replaceProviderOAuthUnsafe(db, records, secretKey);
        if (
          records.length > 0 ||
          hasMigrationMarker(db, PROVIDER_OAUTH_MIGRATION_ID)
        ) {
          markMigration(db, PROVIDER_OAUTH_MIGRATION_ID, dataDir, "");
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  return {
    path,
    exists,
    loadProviderAccounts,
    saveProviderAccounts,
    loadProviderOAuth,
    saveProviderOAuth,
  };
}
