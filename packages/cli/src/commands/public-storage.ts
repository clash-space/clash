import { readFileSync } from "node:fs";
import { Command } from "commander";
import { getHostDiscoveryStatus } from "../lib/host-discovery";
import { printJson } from "../lib/output";

type PublicStorageProvider = "r2" | "aws-s3" | "tos" | "custom-s3";

interface PublicStorageCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface PublicStorageConfig {
  capability: "public-asset-storage";
  mode: "disabled" | "byos" | "managed";
  available: boolean;
  provider: PublicStorageProvider | null;
  account_id: string | null;
  endpoint: string | null;
  bucket: string | null;
  region: string | null;
  key_prefix: string;
  force_path_style: boolean;
  has_access_key_id: boolean;
  has_secret_access_key: boolean;
  has_session_token: boolean;
  managed: { available: boolean; authenticated: boolean };
}

const PUBLIC_STORAGE_PROVIDERS = new Set<PublicStorageProvider>([
  "r2",
  "aws-s3",
  "tos",
  "custom-s3",
]);

function asProvider(value: string): PublicStorageProvider {
  if (PUBLIC_STORAGE_PROVIDERS.has(value as PublicStorageProvider)) {
    return value as PublicStorageProvider;
  }
  throw new Error(
    `Unknown public-storage provider "${value}". Choose r2, aws-s3, tos, or custom-s3.`,
  );
}

function normalizedCredentialKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function credentialRecordFromFile(path: string): Record<string, string> {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8").trim();
  } catch {
    throw new Error(`Cannot read public-storage credentials file ${path}.`);
  }
  if (!contents) throw new Error(`Public-storage credentials file ${path} is empty.`);

  try {
    const parsed = JSON.parse(contents) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([key, value]) => [normalizedCredentialKey(key), unquote(value)]),
      );
    }
  } catch {
    // The common TOS export is a two-line key/value text file, not JSON.
  }

  const entries: Array<[string, string]> = [];
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || /^\[[^\]]+\]$/.test(trimmed)) continue;
    const match = /^([^:=\t]+?)\s*(?:=|:|\t)\s*(.+)$/.exec(trimmed);
    if (!match) continue;
    entries.push([normalizedCredentialKey(match[1]), unquote(match[2])]);
  }
  return Object.fromEntries(entries);
}

function readCredentialsFile(path: string): PublicStorageCredentials {
  const values = credentialRecordFromFile(path);
  const accessKeyId = values.accesskeyid ?? values.awsaccesskeyid;
  const secretAccessKey = values.secretaccesskey ?? values.awssecretaccesskey;
  const sessionToken = values.sessiontoken ?? values.awssessiontoken;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      `Public-storage credentials file ${path} must contain AccessKeyId and SecretAccessKey.`,
    );
  }
  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
}

async function activeHostEndpoint(): Promise<string> {
  const state = await getHostDiscoveryStatus();
  if (state.status !== "active") {
    throw new Error("No local-api host is active; open Clash Desktop or start local-api first.");
  }
  return state.record.endpoint;
}

async function requestPublicStorage<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const endpoint = await activeHostEndpoint();
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Local host rejected public-storage configuration (${response.status}): ${message}`);
  }
  return await response.json() as T;
}

export async function runPublicStorageConfigure(options: {
  provider: string;
  bucket: string;
  region?: string;
  accountId?: string;
  endpoint?: string;
  keyPrefix?: string;
  pathStyle?: boolean;
  credentialsFile?: string;
  json?: boolean;
}): Promise<PublicStorageConfig> {
  const provider = asProvider(options.provider);
  const region = provider === "r2" ? "auto" : options.region?.trim();
  if (!region) throw new Error(`--region is required for ${provider}.`);
  if (provider === "r2" && !options.accountId?.trim()) {
    throw new Error("--account-id is required for r2.");
  }
  if (provider === "custom-s3" && !options.endpoint?.trim()) {
    throw new Error("--endpoint is required for custom-s3.");
  }

  const credentials = options.credentialsFile
    ? readCredentialsFile(options.credentialsFile)
    : undefined;
  const body = {
    mode: "byos",
    provider,
    bucket: options.bucket.trim(),
    region,
    key_prefix: options.keyPrefix?.trim() || "clash-temporary",
    force_path_style: provider === "custom-s3" && options.pathStyle === true,
    ...(options.accountId?.trim() ? { account_id: options.accountId.trim() } : {}),
    ...(options.endpoint?.trim() ? { endpoint: options.endpoint.trim() } : {}),
    ...(credentials ? {
      access_key_id: credentials.accessKeyId,
      secret_access_key: credentials.secretAccessKey,
      ...(credentials.sessionToken ? { session_token: credentials.sessionToken } : {}),
    } : {}),
  };
  const config = await requestPublicStorage<PublicStorageConfig>("/api/v1/local/public-storage", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (options.json) printJson(config);
  else console.log(`Configured public storage: ${config.provider} ${config.bucket} (${config.region}).`);
  return config;
}

export async function runPublicStorageTest(options: {
  json?: boolean;
} = {}): Promise<{ ok: true }> {
  const result = await requestPublicStorage<{ ok: true }>(
    "/api/v1/local/public-storage/test",
    { method: "POST" },
  );
  if (options.json) printJson(result);
  else console.log("Public storage connection succeeded.");
  return result;
}

export const publicStorageCommand = new Command("public-storage")
  .description("Configure the local Host's public Asset storage");

publicStorageCommand
  .command("configure")
  .description("Configure an S3-compatible BYOS backend")
  .requiredOption("--provider <provider>", "r2, aws-s3, tos, or custom-s3")
  .requiredOption("--bucket <bucket>", "Bucket name")
  .option("--region <region>", "Bucket region (not needed for R2)")
  .option("--account-id <accountId>", "Cloudflare account id for R2")
  .option("--endpoint <url>", "Endpoint for custom-s3")
  .option("--key-prefix <prefix>", "Object key prefix", "clash-temporary")
  .option("--path-style", "Use path-style addressing for custom-s3")
  .option(
    "--credentials-file <path>",
    "JSON, AWS credentials, or key/value file containing AccessKeyId and SecretAccessKey",
  )
  .option("--json", "Machine-readable output")
  .action(async (options) => {
    await runPublicStorageConfigure(options);
  });

publicStorageCommand
  .command("test")
  .description("Test the configured backend")
  .option("--json", "Machine-readable output")
  .action(async (options) => {
    await runPublicStorageTest(options);
  });
