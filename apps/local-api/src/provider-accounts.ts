import type {
  ModelUpstreamId,
  ProviderAccountAvailability,
  ProviderAccountId,
} from "@clash/shared-types";

export interface LocalProviderAccountConfig {
  userId?: string;
  providerId: ProviderAccountId;
  upstreamId?: ModelUpstreamId;
  region?: string;
  enabled: boolean;
  priority?: number;
  weight?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface LocalVariableRecord {
  userId?: string;
  key?: string;
  value?: string;
}

const PROVIDER_IDS = new Set<ProviderAccountId>(["official", "fal", "kie", "replicate", "mock", "custom"]);
const UPSTREAM_IDS = new Set<ModelUpstreamId>(["mock", "fal", "google", "openai", "openrouter", "replicate", "kie"]);

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

export function providerAccountKey(account: Pick<LocalProviderAccountConfig, "providerId" | "upstreamId" | "region">): string {
  return [account.providerId, account.upstreamId ?? "", account.region ?? ""].join(":");
}

function defaultUpstream(providerId: ProviderAccountId): ModelUpstreamId | undefined {
  if (providerId === "fal" || providerId === "kie" || providerId === "replicate" || providerId === "mock") {
    return providerId;
  }
  return undefined;
}

export function normalizeProviderAccountInput(value: unknown): Omit<LocalProviderAccountConfig, "userId" | "createdAt" | "updatedAt"> | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const providerId = stringField(raw.providerId) as ProviderAccountId | undefined;
  if (!providerId || !PROVIDER_IDS.has(providerId)) return null;
  const rawUpstreamId = stringField(raw.upstreamId) as ModelUpstreamId | undefined;
  const upstreamId = rawUpstreamId && UPSTREAM_IDS.has(rawUpstreamId)
    ? rawUpstreamId
    : defaultUpstream(providerId);
  const region = stringField(raw.region);
  const priority = numberField(raw.priority);
  const weight = numberField(raw.weight);
  return {
    providerId,
    ...(upstreamId ? { upstreamId } : {}),
    ...(region ? { region } : {}),
    enabled: raw.enabled === undefined ? true : raw.enabled !== false,
    ...(priority !== undefined ? { priority } : {}),
    ...(weight !== undefined ? { weight } : {}),
  };
}

function variableKeys(variables: LocalVariableRecord[], userId: string): Set<string> {
  return new Set(
    variables
      .filter((variable) => (variable.userId ?? userId) === userId)
      .filter((variable) => typeof variable.key === "string" && typeof variable.value === "string" && variable.value.trim())
      .map((variable) => variable.key as string),
  );
}

function variablesForAccount(account: Pick<LocalProviderAccountConfig, "providerId" | "upstreamId">, keys: Set<string>): string[] {
  const candidates =
    account.providerId === "fal" ? ["FAL_API_KEY"]
      : account.providerId === "kie" ? ["KIE_API_KEY"]
        : account.providerId === "replicate" ? ["REPLICATE_API_TOKEN"]
          : account.providerId === "official" && account.upstreamId === "openai" ? ["OPENAI_API_KEY"]
            : account.providerId === "official" && account.upstreamId === "google" ? ["GOOGLE_VERTEX", "GOOGLE_API_KEY"]
              : account.providerId === "official" ? ["OFFICIAL_API_KEY"]
                : [];
  return candidates.filter((key) => keys.has(key));
}

function discoveredAccounts(keys: Set<string>): LocalProviderAccountConfig[] {
  const accounts: LocalProviderAccountConfig[] = [];
  if (keys.has("FAL_API_KEY")) accounts.push({ providerId: "fal", upstreamId: "fal", enabled: true });
  if (keys.has("OPENAI_API_KEY")) accounts.push({ providerId: "official", upstreamId: "openai", region: "global", enabled: true });
  if (keys.has("GOOGLE_VERTEX") || keys.has("GOOGLE_API_KEY")) accounts.push({ providerId: "official", upstreamId: "google", region: "global", enabled: true });
  if (keys.has("KIE_API_KEY")) accounts.push({ providerId: "kie", upstreamId: "kie", enabled: true });
  if (keys.has("REPLICATE_API_TOKEN")) accounts.push({ providerId: "replicate", upstreamId: "replicate", enabled: true });
  return accounts;
}

export function publicProviderAccounts(
  stored: LocalProviderAccountConfig[],
  variables: LocalVariableRecord[],
  userId: string,
): ProviderAccountAvailability[] {
  const keys = variableKeys(variables, userId);
  const merged = new Map<string, LocalProviderAccountConfig>();
  for (const account of discoveredAccounts(keys)) merged.set(providerAccountKey(account), account);
  for (const account of stored) {
    if ((account.userId ?? userId) !== userId) continue;
    merged.set(providerAccountKey(account), account);
  }
  return [...merged.values()]
    .sort((a, b) => providerAccountKey(a).localeCompare(providerAccountKey(b)))
    .map((account) => ({
      providerId: account.providerId,
      ...(account.upstreamId ? { upstreamId: account.upstreamId } : {}),
      ...(account.region ? { region: account.region } : {}),
      enabled: account.enabled,
      availableVariables: variablesForAccount(account, keys),
      ...(account.priority !== undefined ? { priority: account.priority } : {}),
      ...(account.weight !== undefined ? { weight: account.weight } : {}),
    }));
}
