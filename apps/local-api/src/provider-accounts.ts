import type {
  ModelUpstreamApiShape,
  ModelUpstreamId,
  ProviderOAuthId,
  ProviderAccountAvailability,
  ProviderAccountId,
  UserModelCardConfig,
} from "@clash/shared-types";

export type LocalUserModelCardConfig = UserModelCardConfig & {
  userId?: string;
};

export interface LocalProviderAccountConfig {
  id?: string;
  userId?: string;
  providerId: ProviderAccountId;
  upstreamId?: ModelUpstreamId;
  apiShape?: ModelUpstreamApiShape;
  region?: string;
  label?: string;
  enabled: boolean;
  priority?: number;
  weight?: number;
  supportedModelIds?: string[];
  modelPriorities?: Record<string, number>;
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
  accountId?: string;
  status: "pending" | "authorized" | "expired" | "revoked" | "error";
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  verificationUri?: string;
  userCode?: string;
  deviceCode?: string;
  /** Encrypted-at-rest CLI continuation state required to finish device OAuth. */
  oauthState?: string;
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
  "suno",
  "mock",
  "custom",
]);
const UPSTREAM_IDS = new Set<ModelUpstreamId>([
  "local",
  "mock",
  "fal",
  "bfl",
  "google-ai-studio",
  "google-agent-platform",
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
  "suno",
]);
const API_SHAPES = new Set<ModelUpstreamApiShape>([
  "local-asr",
  "local-tts",
  "fal",
  "bfl",
  "google-agent-platform",
  "google-ai-studio",
  "google-ai-studio-interactions",
  "openai-images",
  "openai-compatible",
  "anthropic-compatible",
  "replicate",
  "kie",
  "kling",
  "minimax",
  "modelark",
  "dreamina-cli",
  "elevenlabs",
  "suno",
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

function stringArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of value) {
    const normalized = stringField(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(normalized);
  }
  return values;
}

function numberRecordField(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries: Array<[string, number]> = [];
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = stringField(rawKey);
    const number = numberField(rawValue);
    if (!key || number === undefined) continue;
    entries.push([key, number]);
  }
  return Object.fromEntries(entries);
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
    providerId === "pika" ||
    providerId === "local" ||
    providerId === "kie" ||
    providerId === "replicate" ||
    providerId === "kling" ||
    providerId === "minimax" ||
    providerId === "jimeng" ||
    providerId === "volcengine" ||
    providerId === "elevenlabs" ||
    providerId === "suno" ||
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
  const rawApiShape = stringField(raw.apiShape) as ModelUpstreamApiShape | undefined;
  const apiShape = rawApiShape && API_SHAPES.has(rawApiShape) ? rawApiShape : undefined;
  if (providerId === "custom" && (
    !upstreamId ||
    (apiShape !== "openai-compatible" && apiShape !== "anthropic-compatible")
  )) return null;
  const region = stringField(raw.region);
  const priority = numberField(raw.priority);
  const weight = numberField(raw.weight);
  const supportedModelIds = stringArrayField(raw.supportedModelIds);
  const modelPriorities = numberRecordField(raw.modelPriorities);
  const credentials = credentialsField(raw.credentials);
  return {
    ...(id ? { id } : {}),
    providerId,
    ...(upstreamId ? { upstreamId } : {}),
    ...(apiShape ? { apiShape } : {}),
    ...(region ? { region } : {}),
    ...(label ? { label } : {}),
    enabled: raw.enabled === undefined ? true : raw.enabled !== false,
    ...(priority !== undefined ? { priority } : {}),
    ...(weight !== undefined ? { weight } : {}),
    ...(supportedModelIds !== undefined ? { supportedModelIds } : {}),
    ...(modelPriorities !== undefined ? { modelPriorities } : {}),
    ...(credentials ? { credentials } : {}),
  };
}

function configuredCredentialsForAccount(account: Pick<LocalProviderAccountConfig, "credentials">): string[] {
  return Object.entries(account.credentials ?? {})
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key]) => key)
    .sort();
}

function authorizedOAuthRecords(records: LocalProviderOAuthRecord[], userId: string): LocalProviderOAuthRecord[] {
  return records
    .filter((record) => (record.userId ?? userId) === userId)
    .filter((record) => record.status === "authorized");
}

function oauthAccounts(records: LocalProviderOAuthRecord[], userId: string): LocalProviderAccountConfig[] {
  const record = authorizedOAuthRecords(records, userId)
    .find((candidate) => candidate.providerId === "dreamina");
  if (!record) return [];
  return [{
    providerId: "jimeng",
    upstreamId: "jimeng",
    ...(record.accountLabel ? { label: record.accountLabel } : {}),
    enabled: true,
  }];
}

function oauthForAccount(account: Pick<LocalProviderAccountConfig, "id" | "providerId">, records: LocalProviderOAuthRecord[]): ProviderOAuthId[] {
  if (account.providerId !== "jimeng") return [];
  const hasDreamina = records.some((record) => {
    return record.providerId === "dreamina";
  });
  return hasDreamina ? ["dreamina"] : [];
}

function isRuntimeProviderAccount(account: LocalProviderAccountConfig): boolean {
  if (!PROVIDER_IDS.has(account.providerId)) return false;
  if (account.providerId === "official") {
    return Boolean(account.upstreamId && UPSTREAM_IDS.has(account.upstreamId));
  }
  return !account.upstreamId || UPSTREAM_IDS.has(account.upstreamId);
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
  const connectedOAuth = authorizedOAuthRecords(oauthRecords, userId);
  const merged = new Map<string, LocalProviderAccountConfig>();
  for (const account of stored) {
    if ((account.userId ?? userId) !== userId) continue;
    if (!isRuntimeProviderAccount(account)) continue;
    merged.set(providerAccountKey(account), account);
  }
  if (![...merged.values()].some((account) => account.providerId === "jimeng")) {
    for (const account of oauthAccounts(oauthRecords, userId)) merged.set(providerAccountKey(account), account);
  }
  return [...merged.values()]
    .sort((a, b) => {
      const base = providerAccountBaseKey(a).localeCompare(providerAccountBaseKey(b));
      if (base !== 0) return base;
      const priority = (a.priority ?? 1000) - (b.priority ?? 1000);
      if (priority !== 0) return priority;
      return providerAccountKey(a).localeCompare(providerAccountKey(b));
    })
    .map((account) => ({
      ...(account.id ? { id: account.id } : {}),
      providerId: account.providerId,
      ...(account.upstreamId ? { upstreamId: account.upstreamId } : {}),
      ...(account.apiShape ? { apiShape: account.apiShape } : {}),
      ...(account.region ? { region: account.region } : {}),
      ...(account.label ? { label: account.label } : {}),
      enabled: account.enabled,
      configuredCredentials: configuredCredentialsForAccount(account),
      ...(account.credentials ? { credentials: account.credentials } : {}),
      availableOAuth: oauthForAccount(account, connectedOAuth),
      ...(account.priority !== undefined ? { priority: account.priority } : {}),
      ...(account.weight !== undefined ? { weight: account.weight } : {}),
      ...(account.supportedModelIds?.length ? { supportedModelIds: account.supportedModelIds } : {}),
      ...(account.modelPriorities && Object.keys(account.modelPriorities).length ? { modelPriorities: account.modelPriorities } : {}),
      ...(account.createdAt ? { createdAt: account.createdAt } : {}),
      ...(account.updatedAt ? { updatedAt: account.updatedAt } : {}),
    }));
}
