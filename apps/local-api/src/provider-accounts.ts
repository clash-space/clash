import type {
  ModelUpstreamId,
  ProviderOAuthId,
  ProviderAccountAvailability,
  ProviderAccountId,
} from "@clash/shared-types";

export interface LocalProviderAccountConfig {
  id?: string;
  userId?: string;
  providerId: ProviderAccountId;
  upstreamId?: ModelUpstreamId;
  region?: string;
  label?: string;
  enabled: boolean;
  priority?: number;
  weight?: number;
  credentials?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface LocalVariableRecord {
  userId?: string;
  key?: string;
  value?: string;
}

export interface LocalProviderOAuthRecord {
  userId?: string;
  providerId: ProviderOAuthId;
  status: "pending" | "authorized" | "expired" | "revoked" | "error";
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  verificationUri?: string;
  userCode?: string;
  deviceCode?: string;
  intervalSeconds?: number;
  accountLabel?: string;
  expiresAt?: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type RuntimeProviderAccountAvailability = ProviderAccountAvailability & {
  id?: string;
  label?: string;
  credentials?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
};

const PROVIDER_IDS = new Set<ProviderAccountId>([
  "local",
  "official",
  "fal",
  "kie",
  "replicate",
  "kling",
  "minimax",
  "jimeng",
  "volcengine",
  "elevenlabs",
  "mock",
  "custom",
]);
const UPSTREAM_IDS = new Set<ModelUpstreamId>([
  "local",
  "mock",
  "fal",
  "google",
  "openai",
  "anthropic",
  "openrouter",
  "replicate",
  "kie",
  "kling",
  "minimax",
  "jimeng",
  "volcengine",
  "elevenlabs",
]);

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function credentialsField(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => [key.trim(), stringField(raw)] as const)
    .filter((entry): entry is readonly [string, string] => !!entry[0] && !!entry[1]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function providerAccountBaseKey(account: Pick<LocalProviderAccountConfig, "providerId" | "upstreamId" | "region">): string {
  return [account.providerId, account.upstreamId ?? "", account.region ?? ""].join(":");
}

export function providerAccountKey(account: Pick<LocalProviderAccountConfig, "id" | "providerId" | "upstreamId" | "region">): string {
  return account.id ? `id:${account.id}` : providerAccountBaseKey(account);
}

function defaultUpstream(providerId: ProviderAccountId): ModelUpstreamId | undefined {
  if (
    providerId === "fal" ||
    providerId === "local" ||
    providerId === "kie" ||
    providerId === "replicate" ||
    providerId === "kling" ||
    providerId === "minimax" ||
    providerId === "jimeng" ||
    providerId === "volcengine" ||
    providerId === "elevenlabs" ||
    providerId === "mock"
  ) {
    return providerId;
  }
  return undefined;
}

export function normalizeProviderAccountInput(value: unknown): Omit<LocalProviderAccountConfig, "userId" | "createdAt" | "updatedAt"> | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const providerId = stringField(raw.providerId) as ProviderAccountId | undefined;
  if (!providerId || !PROVIDER_IDS.has(providerId)) return null;
  const id = stringField(raw.id);
  const label = stringField(raw.label);
  const rawUpstreamId = stringField(raw.upstreamId) as ModelUpstreamId | undefined;
  const upstreamId = rawUpstreamId && UPSTREAM_IDS.has(rawUpstreamId)
    ? rawUpstreamId
    : defaultUpstream(providerId);
  const region = stringField(raw.region);
  const priority = numberField(raw.priority);
  const weight = numberField(raw.weight);
  const credentials = credentialsField(raw.credentials);
  return {
    ...(id ? { id } : {}),
    providerId,
    ...(upstreamId ? { upstreamId } : {}),
    ...(region ? { region } : {}),
    ...(label ? { label } : {}),
    enabled: raw.enabled === undefined ? true : raw.enabled !== false,
    ...(priority !== undefined ? { priority } : {}),
    ...(weight !== undefined ? { weight } : {}),
    ...(credentials ? { credentials } : {}),
  };
}

function configuredCredentialsForAccount(account: Pick<LocalProviderAccountConfig, "credentials">): string[] {
  return Object.entries(account.credentials ?? {})
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key]) => key)
    .sort();
}

function oauthProviders(records: LocalProviderOAuthRecord[], userId: string): Set<ProviderOAuthId> {
  return new Set(
    records
      .filter((record) => (record.userId ?? userId) === userId)
      .filter((record) => record.status === "authorized")
      .map((record) => record.providerId),
  );
}

function oauthAccounts(records: LocalProviderOAuthRecord[], userId: string): LocalProviderAccountConfig[] {
  const providers = oauthProviders(records, userId);
  const accounts: LocalProviderAccountConfig[] = [];
  if (providers.has("dreamina")) accounts.push({ providerId: "jimeng", upstreamId: "jimeng", enabled: true });
  return accounts;
}

function oauthForAccount(account: Pick<LocalProviderAccountConfig, "providerId">, providers: Set<ProviderOAuthId>): ProviderOAuthId[] {
  if (account.providerId === "jimeng" && providers.has("dreamina")) return ["dreamina"];
  return [];
}

export function publicProviderAccounts(
  stored: LocalProviderAccountConfig[],
  userId: string,
  oauthRecords: LocalProviderOAuthRecord[] = [],
): ProviderAccountAvailability[] {
  return providerAccountsForRuntime(stored, userId, oauthRecords).map(({ credentials: _credentials, ...account }) => account);
}

export function providerAccountsForRuntime(
  stored: LocalProviderAccountConfig[],
  userId: string,
  oauthRecords: LocalProviderOAuthRecord[] = [],
): RuntimeProviderAccountAvailability[] {
  const connectedOAuth = oauthProviders(oauthRecords, userId);
  const merged = new Map<string, LocalProviderAccountConfig>();
  for (const account of oauthAccounts(oauthRecords, userId)) merged.set(providerAccountKey(account), account);
  for (const account of stored) {
    if ((account.userId ?? userId) !== userId) continue;
    merged.set(providerAccountKey(account), account);
  }
  return [...merged.values()]
    .sort((a, b) => {
      const base = providerAccountBaseKey(a).localeCompare(providerAccountBaseKey(b));
      if (base !== 0) return base;
      const priority = (a.priority ?? 1000) - (b.priority ?? 1000);
      if (priority !== 0) return priority;
      return 0;
    })
    .map((account) => ({
      ...(account.id ? { id: account.id } : {}),
      providerId: account.providerId,
      ...(account.upstreamId ? { upstreamId: account.upstreamId } : {}),
      ...(account.region ? { region: account.region } : {}),
      ...(account.label ? { label: account.label } : {}),
      enabled: account.enabled,
      configuredCredentials: configuredCredentialsForAccount(account),
      ...(account.credentials ? { credentials: account.credentials } : {}),
      availableOAuth: oauthForAccount(account, connectedOAuth),
      ...(account.priority !== undefined ? { priority: account.priority } : {}),
      ...(account.weight !== undefined ? { weight: account.weight } : {}),
      ...(account.createdAt ? { createdAt: account.createdAt } : {}),
      ...(account.updatedAt ? { updatedAt: account.updatedAt } : {}),
    }));
}
