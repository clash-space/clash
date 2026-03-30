'use server';

import { apiTokens } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
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
