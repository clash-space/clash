import type {
  ModelUpstreamId,
  ProviderAccountId,
  ProviderOAuthId,
} from "@clash/shared-types";

import type { PublicProviderAccount } from "./provider-accounts";

export interface ProviderOAuthRecord {
  id: string;
  userId: string;
  providerId: ProviderOAuthId;
  accountId?: string;
  status: "pending" | "authorized" | "expired" | "revoked" | "error";
  verificationUri?: string;
  userCode?: string;
  deviceCode?: string;
  intervalSeconds?: number;
  accountLabel?: string;
  expiresAt?: number;
  error?: string;
  hasTokens: boolean;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface PublicProviderOAuth {
  providerId: ProviderOAuthId;
  accountId?: string;
  status: ProviderOAuthRecord["status"];
  verificationUri?: string;
  userCode?: string;
  deviceCode?: string;
  intervalSeconds?: number;
  accountLabel?: string;
  expiresAt?: string;
  error?: string;
  hasAccessToken: boolean;
}

type ProviderOAuthRow = {
  id: string;
  user_id: string;
  provider_id: string;
  account_id: string | null;
  status: string;
  verification_uri: string | null;
  user_code: string | null;
  device_code: string | null;
  interval_seconds: number | null;
  account_label: string | null;
  expires_at: number | null;
  error: string | null;
  has_tokens: number | null;
  created_at: number | null;
  updated_at: number | null;
};

function providerAccountForOAuth(providerId: ProviderOAuthId): { providerId: ProviderAccountId; upstreamId: ModelUpstreamId } | null {
  if (providerId === "dreamina") return { providerId: "jimeng", upstreamId: "jimeng" };
  return null;
}

function statusValue(value: string): ProviderOAuthRecord["status"] {
  if (value === "authorized" || value === "expired" || value === "revoked" || value === "error") return value;
  return "pending";
}

function publicRecord(row: ProviderOAuthRow): ProviderOAuthRecord {
  return {
    id: row.id,
    userId: row.user_id,
    providerId: row.provider_id as ProviderOAuthId,
    ...(row.account_id ? { accountId: row.account_id } : {}),
    status: statusValue(row.status),
    ...(row.verification_uri ? { verificationUri: row.verification_uri } : {}),
    ...(row.user_code ? { userCode: row.user_code } : {}),
    ...(row.device_code ? { deviceCode: row.device_code } : {}),
    ...(row.interval_seconds !== null && row.interval_seconds !== undefined ? { intervalSeconds: row.interval_seconds } : {}),
    ...(row.account_label ? { accountLabel: row.account_label } : {}),
    ...(row.expires_at !== null && row.expires_at !== undefined ? { expiresAt: row.expires_at } : {}),
    ...(row.error ? { error: row.error } : {}),
    hasTokens: row.has_tokens === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProviderOAuthRecords(db: D1Database, userId: string): Promise<ProviderOAuthRecord[]> {
  const result = await db
    .prepare(
      `SELECT id, user_id, provider_id, account_id, status, verification_uri, user_code, device_code,
              interval_seconds, account_label, expires_at, error, has_tokens, created_at, updated_at
       FROM provider_oauth
       WHERE user_id = ?
       ORDER BY provider_id, COALESCE(account_id, ''), updated_at DESC`,
    )
    .bind(userId)
    .all<ProviderOAuthRow>();
  return (result.results ?? []).map(publicRecord);
}

export function publicProviderOAuth(record: ProviderOAuthRecord): PublicProviderOAuth {
  return {
    providerId: record.providerId,
    ...(record.accountId ? { accountId: record.accountId } : {}),
    status: record.status,
    ...(record.verificationUri ? { verificationUri: record.verificationUri } : {}),
    ...(record.userCode ? { userCode: record.userCode } : {}),
    ...(record.deviceCode ? { deviceCode: record.deviceCode } : {}),
    ...(record.intervalSeconds !== undefined ? { intervalSeconds: record.intervalSeconds } : {}),
    ...(record.accountLabel ? { accountLabel: record.accountLabel } : {}),
    ...(record.expiresAt !== undefined ? { expiresAt: new Date(record.expiresAt * 1000).toISOString() } : {}),
    ...(record.error ? { error: record.error } : {}),
    hasAccessToken: record.hasTokens,
  };
}

export function applyProviderOAuth(
  accounts: PublicProviderAccount[],
  oauthRecords: ProviderOAuthRecord[],
): PublicProviderAccount[] {
  const authorized = oauthRecords.filter((record) => record.status === "authorized");
  const merged = new Map<string, PublicProviderAccount>();
  for (const account of accounts) merged.set(account.id, { ...account });

  for (const record of authorized) {
    const mapped = providerAccountForOAuth(record.providerId);
    if (!mapped) continue;
    if (record.accountId && merged.has(record.accountId)) continue;
    const id = record.accountId ?? `oauth:${record.providerId}`;
    merged.set(id, {
      id,
      providerId: mapped.providerId,
      upstreamId: mapped.upstreamId,
      ...(record.accountLabel ? { label: record.accountLabel } : {}),
      enabled: true,
      configuredCredentials: [],
      availableOAuth: [record.providerId],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  return [...merged.values()]
    .map((account) => {
      const availableOAuth = authorized
        .filter((record) => {
          const mapped = providerAccountForOAuth(record.providerId);
          if (!mapped || mapped.providerId !== account.providerId) return false;
          if (!record.accountId) return true;
          return record.accountId === account.id;
        })
        .map((record) => record.providerId);
      return {
        ...account,
        availableOAuth,
      };
    })
    .sort((a, b) => {
      const provider = `${a.providerId}:${a.upstreamId ?? ""}:${a.region ?? ""}`
        .localeCompare(`${b.providerId}:${b.upstreamId ?? ""}:${b.region ?? ""}`);
      if (provider !== 0) return provider;
      const priority = (a.priority ?? 1000) - (b.priority ?? 1000);
      if (priority !== 0) return priority;
      return a.id.localeCompare(b.id);
    });
}

export async function deleteProviderOAuthRecord(
  db: D1Database,
  userId: string,
  providerId: ProviderOAuthId,
  accountId?: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM provider_oauth
       WHERE user_id = ? AND provider_id = ? AND COALESCE(account_id, '') = ?`,
    )
    .bind(userId, providerId, accountId ?? "")
    .run();
}
