/**
 * User Variables — encrypted key-value store for action secrets.
 *
 * Values are AES-GCM encrypted using ACTION_SECRET_KEY env var.
 * Actions declare required variables in their manifest (secrets[]).
 * At runtime, the platform decrypts and injects matching variables.
 */

import { log } from "../logger";

// ─── Encryption Helpers ──────────────────────────────────

async function deriveKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode("clash-user-vars"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(plaintext: string, secretKey: string): Promise<string> {
  const key = await deriveKey(secretKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  // Encode as base64: iv (12 bytes) + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(encrypted: string, secretKey: string): Promise<string> {
  const key = await deriveKey(secretKey);
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ─── CRUD Operations ─────────────────────────────────────

export async function setVariable(
  db: D1Database,
  userId: string,
  key: string,
  value: string,
  secretKey: string
): Promise<void> {
  const encryptedValue = await encrypt(value, secretKey);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO user_variable (id, user_id, key, encrypted_value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET encrypted_value = ?, updated_at = ?`
    )
    .bind(id, userId, key, encryptedValue, now, now, encryptedValue, now)
    .run();
}

export async function getVariable(
  db: D1Database,
  userId: string,
  key: string,
  secretKey: string
): Promise<string | null> {
  const row = await db
    .prepare("SELECT encrypted_value FROM user_variable WHERE user_id = ? AND key = ?")
    .bind(userId, key)
    .first<{ encrypted_value: string }>();

  if (!row) return null;
  return decrypt(row.encrypted_value, secretKey);
}

export async function listVariableKeys(
  db: D1Database,
  userId: string
): Promise<Array<{ key: string; createdAt: number | null }>> {
  const result = await db
    .prepare("SELECT key, created_at FROM user_variable WHERE user_id = ? ORDER BY key")
    .bind(userId)
    .all<{ key: string; created_at: number | null }>();

  return (result.results ?? []).map((r) => ({ key: r.key, createdAt: r.created_at }));
}

export async function deleteVariable(
  db: D1Database,
  userId: string,
  key: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM user_variable WHERE user_id = ? AND key = ?")
    .bind(userId, key)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Load and decrypt multiple variables by key names.
 * Used at action runtime to inject secrets into the request.
 */
export async function loadSecrets(
  db: D1Database,
  userId: string,
  keys: string[],
  secretKey: string
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};

  const placeholders = keys.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT key, encrypted_value FROM user_variable WHERE user_id = ? AND key IN (${placeholders})`
    )
    .bind(userId, ...keys)
    .all<{ key: string; encrypted_value: string }>();

  const secrets: Record<string, string> = {};
  for (const row of result.results ?? []) {
    try {
      secrets[row.key] = await decrypt(row.encrypted_value, secretKey);
    } catch (e) {
      log.error(`Failed to decrypt variable ${row.key}:`, e);
    }
  }
  return secrets;
}
