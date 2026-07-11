export type AgentReadProofResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code?: "READ_REQUIRED" | "STALE_READ" | "INVALID_READ_PROOF";
    };

export type AgentReadReceiptProof = {
  expectedReadToken: string;
  baseReadToken: string;
  namespace: string;
  version: string;
  hash: string;
  receipt: string;
};

export type AgentReadReceiptVerifier = (proof: AgentReadReceiptProof) => boolean;

export type ProjectReadProofLike = {
  id: string;
  name?: unknown;
  description?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
  deletedAt?: unknown;
  deleted_at?: unknown;
};

export type SessionReadProofLike = {
  id: string;
  projectId?: unknown;
  project_id?: unknown;
  title?: unknown;
  type?: unknown;
  runtimeId?: unknown;
  runtime_id?: unknown;
  agentId?: unknown;
  agent_id?: unknown;
  agentTemplateId?: unknown;
  agent_template_id?: unknown;
  permissionMode?: unknown;
  permission_mode?: unknown;
  acpSessionId?: unknown;
  acp_session_id?: unknown;
  status?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
};

export type LocalConfigReadProofLike = {
  id: string;
  config?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
};

export type ProviderAccountReadProofLike = {
  id?: unknown;
  providerId?: unknown;
  provider_id?: unknown;
  upstreamId?: unknown;
  upstream_id?: unknown;
  region?: unknown;
  label?: unknown;
  enabled?: unknown;
  configuredCredentials?: unknown;
  configured_credentials?: unknown;
  availableOAuth?: unknown;
  available_oauth?: unknown;
  supportedModelIds?: unknown;
  supported_model_ids?: unknown;
  modelPriorities?: unknown;
  model_priorities?: unknown;
  priority?: unknown;
  weight?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
};

export type ProviderOAuthReadProofLike = {
  providerId?: unknown;
  provider_id?: unknown;
  accountId?: unknown;
  account_id?: unknown;
  status?: unknown;
  verificationUri?: unknown;
  verification_uri?: unknown;
  userCode?: unknown;
  user_code?: unknown;
  deviceCode?: unknown;
  device_code?: unknown;
  intervalSeconds?: unknown;
  interval_seconds?: unknown;
  accountLabel?: unknown;
  account_label?: unknown;
  expiresAt?: unknown;
  expires_at?: unknown;
  error?: unknown;
  hasAccessToken?: unknown;
  has_access_token?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
};

export function agentReadToken(options: {
  namespace: string;
  subject: unknown;
  version?: string;
}): string {
  const namespace = normalizeTokenPart(options.namespace, "namespace");
  const version = normalizeTokenPart(options.version ?? "v1", "version");
  return `${namespace}-${version}:${fnv1a64(stableJson(options.subject))}`;
}

export function agentReadReceiptToken(options: {
  readToken: string;
  receipt: string;
}): string {
  const parsed = parseAgentReadToken(options.readToken);
  if (!parsed) {
    throw new Error(`Invalid agent read token: ${options.readToken}`);
  }
  const receipt = normalizeReceipt(options.receipt);
  return `${parsed.baseReadToken}:receipt:${receipt}`;
}

export function projectReadToken(project: ProjectReadProofLike): string {
  return agentReadToken({
    namespace: "project",
    subject: {
      id: project.id,
      name: normalizeProjectText(project.name),
      description: normalizeProjectText(project.description),
      updatedAt: normalizeProjectTimestamp(project.updatedAt ?? project.updated_at),
      deletedAt: normalizeProjectTimestamp(project.deletedAt ?? project.deleted_at),
    },
  });
}

export function sessionReadToken(session: SessionReadProofLike): string {
  return agentReadToken({
    namespace: "session",
    subject: {
      id: session.id,
      projectId: normalizeProjectText(session.projectId ?? session.project_id),
      title: normalizeProjectText(session.title),
      type: normalizeProjectText(session.type),
      runtimeId: normalizeProjectText(session.runtimeId ?? session.runtime_id),
      agentId: normalizeProjectText(session.agentId ?? session.agent_id),
      agentTemplateId: normalizeProjectText(session.agentTemplateId ?? session.agent_template_id),
      permissionMode: normalizeProjectText(session.permissionMode ?? session.permission_mode),
      acpSessionId: normalizeProjectText(session.acpSessionId ?? session.acp_session_id),
      status: normalizeProjectText(session.status),
      createdAt: normalizeProjectTimestamp(session.createdAt ?? session.created_at),
      updatedAt: normalizeProjectTimestamp(session.updatedAt ?? session.updated_at),
    },
  });
}

export function localConfigReadToken(config: LocalConfigReadProofLike): string {
  return agentReadToken({
    namespace: "local-config",
    subject: {
      id: config.id,
      config: config.config ?? null,
      updatedAt: normalizeProjectTimestamp(config.updatedAt ?? config.updated_at),
    },
  });
}

export function providerAccountReadToken(account: ProviderAccountReadProofLike): string {
  return agentReadToken({
    namespace: "provider-account",
    subject: normalizeProviderAccount(account),
  });
}

export function providerAccountsReadToken(accounts: ProviderAccountReadProofLike[]): string {
  const providers = accounts
    .map(normalizeProviderAccount)
    .sort((left, right) => providerAccountSortKey(left).localeCompare(providerAccountSortKey(right)));
  return agentReadToken({
    namespace: "provider-accounts",
    subject: { providers },
  });
}

export function providerOAuthReadToken(record: ProviderOAuthReadProofLike): string {
  return agentReadToken({
    namespace: "provider-oauth",
    subject: {
      providerId: normalizeProjectText(record.providerId ?? record.provider_id),
      accountId: normalizeProjectText(record.accountId ?? record.account_id),
      status: normalizeProjectText(record.status),
      verificationUri: normalizeProjectText(record.verificationUri ?? record.verification_uri),
      userCode: normalizeProjectText(record.userCode ?? record.user_code),
      deviceCode: normalizeProjectText(record.deviceCode ?? record.device_code),
      intervalSeconds: normalizeFiniteNumber(record.intervalSeconds ?? record.interval_seconds),
      accountLabel: normalizeProjectText(record.accountLabel ?? record.account_label),
      expiresAt: normalizeProjectTimestamp(record.expiresAt ?? record.expires_at),
      error: normalizeProjectText(record.error),
      hasAccessToken: typeof (record.hasAccessToken ?? record.has_access_token) === "boolean"
        ? record.hasAccessToken ?? record.has_access_token
        : null,
      updatedAt: normalizeProjectTimestamp(record.updatedAt ?? record.updated_at),
    },
  });
}

export function validateAgentReadProof(options: {
  actorClientType?: string;
  operation: string;
  currentReadToken: string;
  expectedReadToken?: string;
  requireReceipt?: boolean;
  readReceiptVerifier?: AgentReadReceiptVerifier;
  readCommandHint?: string;
}): AgentReadProofResult {
  const isAgent = options.actorClientType === "agent";
  const operation = options.operation.trim() || "write";
  const hint = options.readCommandHint?.trim() ||
    "re-read the target before writing.";
  if (typeof options.expectedReadToken !== "string" || options.expectedReadToken.trim().length === 0) {
    if (!isAgent) return { ok: true };
    return {
      ok: false,
      code: "READ_REQUIRED",
      error: `Missing ${operation} read proof for agent. ${hint}`,
    };
  }

  const expected = parseAgentReadToken(options.expectedReadToken);
  const current = parseAgentReadToken(options.currentReadToken);
  const expectedBase = expected?.baseReadToken ?? options.expectedReadToken;
  const currentBase = current?.baseReadToken ?? options.currentReadToken;

  if (expectedBase !== currentBase) {
    return {
      ok: false,
      code: "STALE_READ",
      error: `Stale ${operation} rejected (STALE_READ). The target changed after it was read. ${hint}`,
    };
  }

  if (options.requireReceipt && isAgent) {
    if (!expected?.receipt) {
      return {
        ok: false,
        code: "READ_REQUIRED",
        error: `Missing ${operation} read receipt for agent. ${hint}`,
      };
    }
    const proof: AgentReadReceiptProof = {
      expectedReadToken: options.expectedReadToken,
      baseReadToken: expected.baseReadToken,
      namespace: expected.namespace,
      version: expected.version,
      hash: expected.hash,
      receipt: expected.receipt,
    };
    let verified = false;
    try {
      verified = options.readReceiptVerifier?.(proof) === true;
    } catch {
      verified = false;
    }
    if (!verified) {
      return {
        ok: false,
        code: "INVALID_READ_PROOF",
        error: `Invalid ${operation} read receipt for agent. ${hint}`,
      };
    }
  }

  return { ok: true };
}

function normalizeProjectText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeProjectTimestamp(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : trimmed;
  }
  return null;
}

function normalizeProviderAccount(account: ProviderAccountReadProofLike) {
  return {
    id: normalizeProjectText(account.id),
    providerId: normalizeProjectText(account.providerId ?? account.provider_id),
    upstreamId: normalizeProjectText(account.upstreamId ?? account.upstream_id),
    region: normalizeProjectText(account.region),
    label: normalizeProjectText(account.label),
    enabled: typeof account.enabled === "boolean" ? account.enabled : null,
    configuredCredentials: normalizeStringList(account.configuredCredentials ?? account.configured_credentials),
    availableOAuth: normalizeStringList(account.availableOAuth ?? account.available_oauth),
    supportedModelIds: normalizeStringList(account.supportedModelIds ?? account.supported_model_ids),
    modelPriorities: normalizeNumberRecord(account.modelPriorities ?? account.model_priorities),
    priority: normalizeFiniteNumber(account.priority),
    weight: normalizeFiniteNumber(account.weight),
    createdAt: normalizeProjectTimestamp(account.createdAt ?? account.created_at),
    updatedAt: normalizeProjectTimestamp(account.updatedAt ?? account.updated_at),
  };
}

function providerAccountSortKey(account: ReturnType<typeof normalizeProviderAccount>): string {
  return [
    account.id,
    account.providerId,
    account.upstreamId,
    account.region,
  ].map((part) => part ?? "").join("\u0000");
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0))]
    .sort();
}

function normalizeFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] =>
      typeof entry[0] === "string" &&
      entry[0].trim().length > 0 &&
      typeof entry[1] === "number" &&
      Number.isFinite(entry[1])
    )
    .map(([key, number]) => [key.trim(), number] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function normalizeTokenPart(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(normalized)) {
    throw new Error(`Invalid agent read-token ${label}: ${value}`);
  }
  return normalized;
}

function normalizeReceipt(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._~-]{1,256}$/.test(normalized)) {
    throw new Error("Invalid agent read receipt");
  }
  return normalized;
}

function parseAgentReadToken(token: string): {
  baseReadToken: string;
  namespace: string;
  version: string;
  hash: string;
  receipt?: string;
} | null {
  const match = /^([a-z0-9][a-z0-9-]*)-([a-z0-9][a-z0-9-]*):([a-f0-9]{16})(?::receipt:([A-Za-z0-9._~-]+))?$/i.exec(token);
  if (!match) return null;
  const [, namespace, version, hash, receipt] = match;
  return {
    baseReadToken: `${namespace}-${version}:${hash}`,
    namespace,
    version,
    hash,
    ...(receipt ? { receipt } : {}),
  };
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item ?? null)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return "null";
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
