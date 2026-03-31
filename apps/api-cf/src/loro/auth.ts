/**
 * Authentication utilities for WebSocket connections.
 * Ported from loro-sync-server/src/auth.ts — adapted to api-cf Env.
 */

import * as jose from 'jose';
import type { Env } from '../config';

export interface AuthResult {
  userId: string;
  projectId: string;
  /** User display name (from Better Auth session, or "CLI Agent" for API tokens) */
  userName?: string;
  /** User avatar URL (from Better Auth session) */
  userAvatar?: string;
}

interface JWTPayload {
  sub: string;
  projectId: string;
  iat?: number;
  exp?: number;
}

/**
 * Verify JWT token using jose (HS256 signature verification).
 */
async function verifyJWT(token: string, secret: string): Promise<JWTPayload> {
  const secretKey = new TextEncoder().encode(secret);

  const { payload } = await jose.jwtVerify(token, secretKey, {
    algorithms: ['HS256'],
  });

  if (!payload.sub || !(payload as any).projectId) {
    throw new Error('Invalid JWT payload: missing required fields');
  }

  return {
    sub: payload.sub as string,
    projectId: (payload as any).projectId as string,
    iat: payload.iat,
    exp: payload.exp,
  };
}

function extractTokenFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  const tokenFromQuery = url.searchParams.get('token');
  if (tokenFromQuery) return tokenFromQuery;

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);

  return null;
}

type BetterAuthGetSessionResponse =
  | { session: unknown; user: { id: string } & Record<string, unknown> }
  | null;

async function getBetterAuthSession(request: Request, env: Env): Promise<BetterAuthGetSessionResponse> {
  const cookie = request.headers.get('cookie') ?? '';
  const authorization = request.headers.get('authorization') ?? '';

  if (!cookie && !authorization) return null;

  const origin = env.BETTER_AUTH_ORIGIN ?? new URL(request.url).origin;
  const basePath = env.BETTER_AUTH_BASE_PATH ?? '/api/better-auth';
  const sessionUrl = new URL(`${origin}${basePath}/get-session`);

  const res = await fetch(sessionUrl.toString(), {
    method: 'GET',
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
      accept: 'application/json',
    },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as unknown;
  if (!data || typeof data !== 'object') return null;

  const maybeUser = (data as any).user;
  if (!maybeUser || typeof maybeUser !== 'object') return null;

  const id = (maybeUser as any).id;
  if (typeof id !== 'string' || id.length === 0) return null;

  return data as BetterAuthGetSessionResponse;
}

async function assertProjectOwner(env: Env, projectId: string, userId: string): Promise<void> {
  if (!env.DB) return;

  const { results } = await env.DB
    .prepare('SELECT owner_id FROM project WHERE id = ? LIMIT 1')
    .bind(projectId)
    .all();

  const ownerId = (results?.[0] as any)?.owner_id as string | null | undefined;
  if (!ownerId || ownerId !== userId) {
    throw new Error('Forbidden');
  }
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

/**
 * Authenticate a request using API token (clsh_*), returning userId if valid.
 */
async function getUserIdFromApiToken(token: string, env: Env): Promise<string | null> {
  if (!token.startsWith('clsh_')) return null;
  if (!env.DB) return null;

  const hash = await sha256(token);
  const { results } = await env.DB
    .prepare('SELECT user_id FROM api_token WHERE token_hash = ? LIMIT 1')
    .bind(hash)
    .all();

  if (!results?.[0]) return null;
  const userId = (results[0] as any).user_id as string;

  // Fire-and-forget: update last_used_at
  env.DB.prepare('UPDATE api_token SET last_used_at = unixepoch() WHERE token_hash = ?').bind(hash).run();

  return userId;
}

export async function authenticateRequest(request: Request, env: Env, projectId: string): Promise<AuthResult> {
  const isDev = env.ENVIRONMENT === 'development';

  async function verifyOwnership(userId: string): Promise<void> {
    if (!isDev) await assertProjectOwner(env, projectId, userId);
  }

  // 1. Try BetterAuth session (cookie-based)
  const session = await getBetterAuthSession(request, env);
  if (session?.user?.id) {
    await verifyOwnership(session.user.id);
    return {
      userId: session.user.id,
      projectId,
      userName: (session.user as any).name as string | undefined,
      userAvatar: (session.user as any).image as string | undefined,
    };
  }

  // 2. Try API token (clsh_*)
  const rawToken = extractTokenFromRequest(request);
  if (rawToken?.startsWith('clsh_')) {
    const userId = await getUserIdFromApiToken(rawToken, env);
    if (userId) {
      await verifyOwnership(userId);
      return { userId, projectId, userName: 'CLI Agent' };
    }
  }

  // 3. Try JWT token (query param or Authorization header)
  if (rawToken && env.JWT_SECRET) {
    const payload = await verifyJWT(rawToken, env.JWT_SECRET);
    if (payload.projectId !== projectId) {
      throw new Error('Project ID mismatch');
    }
    await verifyOwnership(payload.sub);
    return { userId: payload.sub, projectId: payload.projectId };
  }

  // 4. Development mode fallback
  if (isDev) {
    return { userId: 'dev-user', projectId };
  }

  throw new Error('Unauthorized');
}
