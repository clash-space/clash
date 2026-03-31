'use server';

import { apiTokens, userVariables } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { headers } from 'next/headers';
import * as schema from '@/lib/db/schema';
import { DEV_USER_ID, getUserIdOrDevFromHeaders } from '@/lib/auth/session';

const getDb = async () => {
    const { env } = await getCloudflareContext({ async: true });
    const bindings = env as unknown as { DB?: Parameters<typeof drizzleD1>[0] };
    if (bindings.DB) {
        return drizzleD1(bindings.DB, { schema });
    }
    throw new Error('No database connection available');
};

async function requireUserId() {
    const h = new Headers(await headers());
    return getUserIdOrDevFromHeaders(h);
}

/**
 * Generate a random API token: clsh_ + 40 hex chars
 */
function generateToken(): string {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return `clsh_${hex}`;
}

/**
 * SHA-256 hash a string, returning hex.
 */
async function sha256(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export interface ApiTokenInfo {
    id: string;
    name: string;
    tokenPrefix: string;
    lastUsedAt: Date | null;
    createdAt: Date | null;
}

/**
 * Create a new API token. Returns the plaintext token (shown once).
 */
export async function createApiToken(name: string): Promise<{ token: string; info: ApiTokenInfo }> {
    const db = await getDb();
    const userId = await requireUserId();

    const plaintext = generateToken();
    const hash = await sha256(plaintext);
    const prefix = plaintext.slice(0, 13) + '...'; // "clsh_abc12345..."

    const [row] = await db.insert(apiTokens).values({
        userId,
        name: name || 'Untitled Token',
        tokenHash: hash,
        tokenPrefix: prefix,
    }).returning();

    return {
        token: plaintext,
        info: {
            id: row.id,
            name: row.name,
            tokenPrefix: row.tokenPrefix,
            lastUsedAt: row.lastUsedAt,
            createdAt: row.createdAt,
        },
    };
}

/**
 * List all API tokens for the current user (prefix only, not hash).
 */
export async function listApiTokens(): Promise<ApiTokenInfo[]> {
    const db = await getDb();
    const userId = await requireUserId();

    const rows = await db.query.apiTokens.findMany({
        where: eq(apiTokens.userId, userId),
        orderBy: [desc(apiTokens.createdAt)],
    });

    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        tokenPrefix: row.tokenPrefix,
        lastUsedAt: row.lastUsedAt,
        createdAt: row.createdAt,
    }));
}

/**
 * Revoke (delete) an API token.
 */
export async function revokeApiToken(tokenId: string): Promise<void> {
    const db = await getDb();
    const userId = await requireUserId();

    // Only delete if owned by current user
    const token = await db.query.apiTokens.findFirst({
        where: eq(apiTokens.id, tokenId),
    });

    if (!token || token.userId !== userId) {
        throw new Error('Token not found');
    }

    await db.delete(apiTokens).where(eq(apiTokens.id, tokenId));
}

// ─── User Variables ─────────────────────────────────────────

export interface VariableInfo {
    id: string;
    key: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}

/**
 * AES-GCM encrypt a value. In production, ACTION_SECRET_KEY comes from env.
 * For the frontend server actions, we use a simple key derivation.
 */
async function getEncryptionKey(): Promise<CryptoKey> {
    const { env } = await getCloudflareContext({ async: true });
    const secret = (env as any).ACTION_SECRET_KEY || 'dev-secret-key-change-in-prod';
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: encoder.encode('clash-user-vars'), iterations: 100000, hash: 'SHA-256' },
        keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
}

async function encryptValue(value: string): Promise<string> {
    const key = await getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(value);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return btoa(String.fromCharCode(...combined));
}

/**
 * Set or update a user variable (encrypted).
 */
export async function setVariable(varKey: string, value: string): Promise<VariableInfo> {
    const db = await getDb();
    const userId = await requireUserId();
    const encrypted = await encryptValue(value);

    // Upsert: delete existing, then insert
    await db.delete(userVariables).where(
        and(eq(userVariables.userId, userId), eq(userVariables.key, varKey))
    );

    const [row] = await db.insert(userVariables).values({
        userId,
        key: varKey,
        encryptedValue: encrypted,
    }).returning();

    return {
        id: row.id,
        key: row.key,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

/**
 * List all variable keys for the current user (values are never returned).
 */
export async function listVariables(): Promise<VariableInfo[]> {
    const db = await getDb();
    const userId = await requireUserId();

    const rows = await db.query.userVariables.findMany({
        where: eq(userVariables.userId, userId),
        orderBy: [desc(userVariables.createdAt)],
    });

    return rows.map((row) => ({
        id: row.id,
        key: row.key,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }));
}

/**
 * Delete a user variable.
 */
export async function deleteVariable(varId: string): Promise<void> {
    const db = await getDb();
    const userId = await requireUserId();

    const variable = await db.query.userVariables.findFirst({
        where: eq(userVariables.id, varId),
    });

    if (!variable || variable.userId !== userId) {
        throw new Error('Variable not found');
    }

    await db.delete(userVariables).where(eq(userVariables.id, varId));
}
