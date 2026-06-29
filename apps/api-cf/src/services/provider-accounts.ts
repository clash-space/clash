import type {
  ModelUpstreamId,
  ProviderAccountAvailability,
  ProviderAccountId,
} from "@clash/shared-types";

export interface ProviderAccountInput {
  id?: string;
  providerId: ProviderAccountId;
  upstreamId?: ModelUpstreamId;
  region?: string;
  label?: string;
  enabled?: boolean;
  priority?: number;
  weight?: number;
  credentials?: Record<string, string>;
}

export interface PublicProviderAccount extends ProviderAccountAvailability {
  id: string;
  label?: string;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface ProviderCredentialQuery {
  providerId: ProviderAccountId;
  upstreamId?: ModelUpstreamId;
  region?: string;
  requiredCredentials?: string[];
}

type ProviderAccountRow = {
  id: string;
  user_id: string;
  provider_id: string;
  upstream_id: string | null;
  region: string | null;
  label: string | null;
  enabled: number | null;
  priority: number | null;
  weight: number | null;
  encrypted_credentials: string | null;
  configured_credentials: string | null;
  created_at: number | null;
  updated_at: number | null;
};

const PROVIDER_ACCOUNT_SALT = "clash-provider-account-credentials";

function trimString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function cleanCredentials(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => [key.trim(), trimString(raw)] as const)
    .filter((entry): entry is readonly [string, string] => !!entry[0] && !!entry[1]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function configuredCredentialKeys(credentials: Record<string, string> | undefined): string[] {
  return Object.entries(credentials ?? {})
    .filter(([, value]) => value.trim().length > 0)
    .map(([key]) => key)
    .sort();
}

function parseConfiguredCredentials(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).sort()
      : [];
  } catch {
    return [];
  }
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode(PROVIDER_ACCOUNT_SALT), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptCredentials(credentials: Record<string, string>, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptCredentials(encrypted: string | null, secret: string): Promise<Record<string, string>> {
  if (!encrypted) return {};
  const key = await deriveKey(secret);
  const combined = Uint8Array.from(atob(encrypted), (char) => char.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  return cleanCredentials(parsed) ?? {};
}

function requireCredentialSecret(secretKey: string | undefined): string {
  if (!secretKey) throw new Error("Provider credential encryption key is not configured.");
  return secretKey;
}

export function normalizeProviderAccountInput(value: unknown): ProviderAccountInput | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const providerId = trimString(raw.providerId) as ProviderAccountId | undefined;
  if (!providerId) return null;
  const upstreamId = trimString(raw.upstreamId) as ModelUpstreamId | undefined;
  const region = trimString(raw.region);
  const id = trimString(raw.id);
  const label = trimString(raw.label);
  const priority = numberValue(raw.priority);
  const weight = numberValue(raw.weight);
  const credentials = cleanCredentials(raw.credentials);
  return {
    providerId,
    ...(id ? { id } : {}),
    ...(upstreamId ? { upstreamId } : {}),
    ...(region ? { region } : {}),
    ...(label ? { label } : {}),
    enabled: raw.enabled === undefined ? true : raw.enabled !== false,
    ...(priority !== undefined ? { priority } : {}),
    ...(weight !== undefined ? { weight } : {}),
    ...(credentials ? { credentials } : {}),
  };
}

function publicRow(row: ProviderAccountRow): PublicProviderAccount {
  return {
    id: row.id,
    providerId: row.provider_id as ProviderAccountId,
    ...(row.upstream_id ? { upstreamId: row.upstream_id as ModelUpstreamId } : {}),
    ...(row.region ? { region: row.region } : {}),
    ...(row.label ? { label: row.label } : {}),
    enabled: row.enabled !== 0,
    configuredCredentials: parseConfiguredCredentials(row.configured_credentials),
    ...(row.priority !== null && row.priority !== undefined ? { priority: row.priority } : {}),
    ...(row.weight !== null && row.weight !== undefined ? { weight: row.weight } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findExistingAccountId(db: D1Database, userId: string, input: ProviderAccountInput): Promise<string | null> {
  if (input.id) return input.id;
  const row = await db
    .prepare(
      `SELECT id FROM provider_account
       WHERE user_id = ? AND provider_id = ? AND COALESCE(upstream_id, '') = ? AND COALESCE(region, '') = ?
       ORDER BY COALESCE(priority, 1000), updated_at DESC
       LIMIT 1`,
    )
    .bind(userId, input.providerId, input.upstreamId ?? "", input.region ?? "")
    .first<{ id: string }>();
  return row?.id ?? null;
}

async function getAccountRow(db: D1Database, userId: string, id: string): Promise<ProviderAccountRow | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, provider_id, upstream_id, region, label, enabled, priority, weight,
              encrypted_credentials, configured_credentials, created_at, updated_at
       FROM provider_account
       WHERE user_id = ? AND id = ?`,
    )
    .bind(userId, id)
    .first<ProviderAccountRow>();
  return row ?? null;
}

export async function listProviderAccounts(db: D1Database, userId: string): Promise<PublicProviderAccount[]> {
  const result = await db
    .prepare(
      `SELECT id, user_id, provider_id, upstream_id, region, label, enabled, priority, weight,
              encrypted_credentials, configured_credentials, created_at, updated_at
       FROM provider_account
       WHERE user_id = ?
       ORDER BY provider_id, COALESCE(upstream_id, ''), COALESCE(region, ''), COALESCE(priority, 1000), updated_at DESC`,
    )
    .bind(userId)
    .all<ProviderAccountRow>();
  return (result.results ?? []).map(publicRow);
}

export async function upsertProviderAccount(
  env: { DB: D1Database; ACTION_SECRET_KEY?: string },
  userId: string,
  input: ProviderAccountInput,
): Promise<PublicProviderAccount> {
  const now = Math.floor(Date.now() / 1000);
  const existingId = await findExistingAccountId(env.DB, userId, input);
  const existing = existingId ? await getAccountRow(env.DB, userId, existingId) : null;
  const secret = input.credentials ? requireCredentialSecret(env.ACTION_SECRET_KEY) : undefined;
  let encryptedCredentials = existing?.encrypted_credentials ?? null;
  let configuredCredentials = existing?.configured_credentials ?? null;
  if (input.credentials && secret) {
    const previous = await decryptCredentials(existing?.encrypted_credentials ?? null, secret);
    const merged = { ...previous, ...input.credentials };
    encryptedCredentials = await encryptCredentials(merged, secret);
    configuredCredentials = JSON.stringify(configuredCredentialKeys(merged));
  }

  if (existing) {
    await env.DB
      .prepare(
        `UPDATE provider_account
         SET provider_id = ?, upstream_id = ?, region = ?, label = ?, enabled = ?, priority = ?, weight = ?,
             encrypted_credentials = ?, configured_credentials = ?, updated_at = ?
         WHERE user_id = ? AND id = ?`,
      )
      .bind(
        input.providerId,
        input.upstreamId ?? null,
        input.region ?? null,
        input.label ?? null,
        input.enabled === false ? 0 : 1,
        input.priority ?? null,
        input.weight ?? null,
        encryptedCredentials,
        configuredCredentials,
        now,
        userId,
        existing.id,
      )
      .run();
    const row = await getAccountRow(env.DB, userId, existing.id);
    if (!row) throw new Error("Provider account update failed.");
    return publicRow(row);
  }

  const id = input.id ?? crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO provider_account
       (id, user_id, provider_id, upstream_id, region, label, enabled, priority, weight,
        encrypted_credentials, configured_credentials, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      input.providerId,
      input.upstreamId ?? null,
      input.region ?? null,
      input.label ?? null,
      input.enabled === false ? 0 : 1,
      input.priority ?? null,
      input.weight ?? null,
      encryptedCredentials,
      configuredCredentials,
      now,
      now,
    )
    .run();
  const row = await getAccountRow(env.DB, userId, id);
  if (!row) throw new Error("Provider account insert failed.");
  return publicRow(row);
}

export async function upsertProviderAccounts(
  env: { DB: D1Database; ACTION_SECRET_KEY?: string },
  userId: string,
  inputs: ProviderAccountInput[],
): Promise<PublicProviderAccount[]> {
  for (const input of inputs) {
    await upsertProviderAccount(env, userId, input);
  }
  return listProviderAccounts(env.DB, userId);
}

export async function getProviderCredentials(
  env: { DB: D1Database; ACTION_SECRET_KEY?: string },
  userId: string | undefined,
  query: ProviderCredentialQuery,
): Promise<Record<string, string>> {
  if (!userId) throw new Error("Provider credentials require an authenticated actor user.");
  const secret = requireCredentialSecret(env.ACTION_SECRET_KEY);
  const result = await env.DB
    .prepare(
      `SELECT id, user_id, provider_id, upstream_id, region, label, enabled, priority, weight,
              encrypted_credentials, configured_credentials, created_at, updated_at
       FROM provider_account
       WHERE user_id = ? AND provider_id = ? AND enabled = 1
         AND (? IS NULL OR upstream_id = ?)
       ORDER BY COALESCE(priority, 1000), updated_at DESC`,
    )
    .bind(userId, query.providerId, query.upstreamId ?? null, query.upstreamId ?? null)
    .all<ProviderAccountRow>();

  const required = query.requiredCredentials ?? [];
  const rows = (result.results ?? []).filter((row) => !query.region || !row.region || row.region === query.region);
  for (const row of rows) {
    const credentials = await decryptCredentials(row.encrypted_credentials, secret);
    if (required.every((key) => credentials[key]?.trim())) return credentials;
  }

  const missing = required.length ? ` Missing: ${required.join(", ")}.` : "";
  throw new Error(
    `Provider credentials not configured for ${query.providerId}${query.upstreamId ? `/${query.upstreamId}` : ""}.${missing}`,
  );
}
