import { randomUUID } from "node:crypto";

import {
  executablePluginBrokerPermissionError,
  type PluginBroker,
} from "@clash-space/bridge/actions-host";
import type {
  AssetKind,
  ExecutablePluginAssetHandle,
  ExecutablePluginJsonValue,
} from "@clash/shared-types";

import type { LocalProviderAccountConfig } from "./provider-accounts.js";

export interface LocalPluginBrokerAuditRecord {
  pluginId: string;
  pluginVersion: string;
  projectId: string;
  invocationId: string;
  requestId: string;
  operation: "credential.handle" | "asset.read" | "asset.write" | "network.fetch" | "codex.image.generate";
  target: string;
  status: "ok" | "error";
  error?: string;
  occurredAt: string;
}

export interface LocalPluginBrokerAssetReadResult {
  kind: AssetKind;
  mediaType?: string;
  bytes: Uint8Array;
}

export interface LocalExecutablePluginBrokerOptions {
  loadProviderAccounts: () => Promise<LocalProviderAccountConfig[]>;
  fetch?: typeof fetch;
  readAsset?: (input: {
    assetId: string;
    projectId: string;
  }) => Promise<LocalPluginBrokerAssetReadResult>;
  writeAsset?: (input: {
    pluginId: string;
    pluginVersion: string;
    projectId: string;
    invocationId: string;
    taskId: string;
    slot: string;
    kind: AssetKind;
    mediaType?: string;
    bytes: Uint8Array;
  }) => Promise<ExecutablePluginAssetHandle>;
  generateCodexImage?: (input: {
    prompt: string;
    aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "21:9";
    references: Array<{
      asset: ExecutablePluginAssetHandle;
      mediaType?: string;
      bytes: Uint8Array;
    }>;
  }) => Promise<{ mediaType: string; bytes: Uint8Array }>;
  audit?: (record: LocalPluginBrokerAuditRecord) => Promise<void> | void;
  credentialHandleTtlMs?: number;
  now?: () => number;
}

interface CredentialCapability {
  invocationId: string;
  pluginId: string;
  providerId: string;
  accountId?: string;
  credentials: Record<string, string>;
  expiresAt: number;
}

const CREDENTIAL_HEADER_NAMES = new Set([
  "authorization",
  "api-key",
  "x-api-key",
  "xi-api-key",
  "x-goog-api-key",
]);

function credentialTarget(secretId: string): { providerId?: string; accountId?: string } {
  if (secretId.startsWith("provider:")) {
    return { providerId: secretId.slice("provider:".length) };
  }
  if (secretId.startsWith("provider-account:")) {
    return { accountId: secretId.slice("provider-account:".length) };
  }
  throw new Error(
    `Unsupported secret id ${secretId}; use provider:<id> or provider-account:<id>.`,
  );
}

function authorizationHeaders(
  providerId: string,
  credentials: Record<string, string>,
): Record<string, string> {
  const apiKey = credentials.apiKey?.trim();
  if (!apiKey) throw new Error(`Provider ${providerId} has no configured apiKey.`);
  if (providerId === "fal") return { authorization: `Key ${apiKey}` };
  if (providerId === "replicate") return { authorization: `Token ${apiKey}` };
  if (providerId === "elevenlabs") return { "xi-api-key": apiKey };
  if (providerId === "google" || providerId === "google-ai-studio") {
    return { "x-goog-api-key": apiKey };
  }
  return { authorization: `Bearer ${apiKey}` };
}

function safeRequestHeaders(
  headers: Record<string, string>,
  credential?: CredentialCapability,
): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (CREDENTIAL_HEADER_NAMES.has(name.toLowerCase())) continue;
    result.set(name, value);
  }
  if (credential) {
    for (const [name, value] of Object.entries(
      authorizationHeaders(credential.providerId, credential.credentials),
    )) result.set(name, value);
  }
  return result;
}

function safeResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ["content-type", "location", "retry-after", "x-request-id", "x-fal-request-id"]) {
    const value = headers.get(name);
    if (value !== null) result[name] = value;
  }
  return result;
}

async function responseBody(response: Response): Promise<ExecutablePluginJsonValue> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const text = new TextDecoder().decode(bytes);
    try {
      return JSON.parse(text) as ExecutablePluginJsonValue;
    } catch {
      return { encoding: "utf8", data: text };
    }
  }
  if (contentType.startsWith("text/")) {
    return { encoding: "utf8", data: new TextDecoder().decode(bytes) };
  }
  return { encoding: "base64", data: Buffer.from(bytes).toString("base64") };
}

function requestTarget(operation: Parameters<PluginBroker>[0]["operation"]): string {
  if (operation.kind === "credential.handle") return operation.secretId;
  if (operation.kind === "asset.read") return operation.asset.assetId;
  if (operation.kind === "asset.write") return operation.slot;
  if (operation.kind === "codex.image.generate") return "codex.imagegen";
  return new URL(operation.url).hostname;
}

export function createLocalExecutablePluginBroker(
  options: LocalExecutablePluginBrokerOptions,
): PluginBroker {
  const credentialCapabilities = new Map<string, CredentialCapability>();
  const now = options.now ?? Date.now;
  const credentialHandleTtlMs = options.credentialHandleTtlMs ?? 15 * 60_000;
  const brokerFetch = options.fetch ?? fetch;

  return async (request, context) => {
    const target = requestTarget(request.operation);
    const permissionError = executablePluginBrokerPermissionError(context.manifest, request);
    const audit = async (status: "ok" | "error", error?: string) => {
      await options.audit?.({
        pluginId: context.manifest.id,
        pluginVersion: context.manifest.version,
        projectId: context.invocation.projectId,
        invocationId: request.invocationId,
        requestId: request.requestId,
        operation: request.operation.kind,
        target,
        status,
        ...(error ? { error } : {}),
        occurredAt: new Date(now()).toISOString(),
      });
    };

    try {
      if (permissionError) throw new Error(permissionError);
      if (request.invocationId !== context.invocation.invocationId) {
        throw new Error("Broker request invocation does not match the active invocation.");
      }
      for (const [handle, capability] of credentialCapabilities) {
        if (capability.expiresAt <= now()) credentialCapabilities.delete(handle);
      }

      let result: ExecutablePluginJsonValue;
      const operation = request.operation;
      if (operation.kind === "credential.handle") {
        const selector = credentialTarget(operation.secretId);
        const accounts = await options.loadProviderAccounts();
        const account = accounts.find((candidate) => candidate.enabled && (
          selector.accountId
            ? candidate.id === selector.accountId
            : candidate.providerId === selector.providerId
        ));
        if (!account?.credentials) {
          throw new Error(`No enabled provider account satisfies ${operation.secretId}.`);
        }
        const handle = `clash-secret://${randomUUID()}`;
        credentialCapabilities.set(handle, {
          invocationId: request.invocationId,
          pluginId: context.manifest.id,
          providerId: account.providerId,
          ...(account.id ? { accountId: account.id } : {}),
          credentials: { ...account.credentials },
          expiresAt: now() + credentialHandleTtlMs,
        });
        result = {
          handle,
          providerId: account.providerId,
          ...(account.id ? { accountId: account.id } : {}),
          expiresAt: new Date(now() + credentialHandleTtlMs).toISOString(),
        };
      } else if (operation.kind === "network.fetch") {
        const credential = operation.credentialHandle
          ? credentialCapabilities.get(operation.credentialHandle)
          : undefined;
        if (operation.credentialHandle && !credential) {
          throw new Error("Credential handle is unknown or expired.");
        }
        if (credential && (
          credential.invocationId !== request.invocationId
          || credential.pluginId !== context.manifest.id
        )) {
          throw new Error("Credential handle does not belong to invocation or plugin.");
        }
        const headers = safeRequestHeaders(operation.headers, credential);
        const body = operation.body === undefined
          ? undefined
          : typeof operation.body === "string"
            ? operation.body
            : JSON.stringify(operation.body);
        const response = await brokerFetch(operation.url, {
          method: operation.method,
          headers,
          ...(body !== undefined ? { body } : {}),
          redirect: "manual",
        });
        result = {
          status: response.status,
          headers: safeResponseHeaders(response.headers),
          body: await responseBody(response),
        };
      } else if (operation.kind === "asset.read") {
        if (!options.readAsset) throw new Error("Local asset broker is unavailable.");
        const asset = await options.readAsset({
          assetId: operation.asset.assetId,
          projectId: context.invocation.projectId,
        });
        if (asset.kind !== operation.asset.kind) {
          throw new Error(
            `Asset ${operation.asset.assetId} kind ${asset.kind} does not match ${operation.asset.kind}.`,
          );
        }
        result = {
          handle: `clash-plugin-asset://${randomUUID()}`,
          kind: asset.kind,
          ...(asset.mediaType ? { mediaType: asset.mediaType } : {}),
          byteLength: asset.bytes.byteLength,
          dataBase64: Buffer.from(asset.bytes).toString("base64"),
        };
      } else if (operation.kind === "asset.write") {
        if (!options.writeAsset) throw new Error("Local asset write broker is unavailable.");
        if (!operation.dataBase64) {
          throw new Error("Local asset.write currently requires inline dataBase64.");
        }
        const bytes = new Uint8Array(Buffer.from(operation.dataBase64, "base64"));
        result = await options.writeAsset({
          pluginId: context.manifest.id,
          pluginVersion: context.manifest.version,
          projectId: context.invocation.projectId,
          invocationId: context.invocation.invocationId,
          taskId: context.invocation.taskId,
          slot: operation.slot,
          kind: operation.assetKind,
          ...(operation.mediaType ? { mediaType: operation.mediaType } : {}),
          bytes,
        });
      } else {
        if (!options.generateCodexImage) {
          throw new Error("Codex ImageGen is unavailable in this Clash runtime.");
        }
        if (!options.readAsset || !options.writeAsset) {
          throw new Error("Codex ImageGen requires local asset read and write brokers.");
        }
        const references = await Promise.all(operation.references.map(async (asset) => {
          const resolved = await options.readAsset!({
            assetId: asset.assetId,
            projectId: context.invocation.projectId,
          });
          if (resolved.kind !== "image") {
            throw new Error(`Codex ImageGen reference ${asset.assetId} is not an image.`);
          }
          return {
            asset,
            ...(resolved.mediaType ? { mediaType: resolved.mediaType } : {}),
            bytes: resolved.bytes,
          };
        }));
        const generated = await options.generateCodexImage({
          prompt: operation.prompt,
          aspectRatio: operation.aspectRatio,
          references,
        });
        result = await options.writeAsset({
          pluginId: context.manifest.id,
          pluginVersion: context.manifest.version,
          projectId: context.invocation.projectId,
          invocationId: context.invocation.invocationId,
          taskId: context.invocation.taskId,
          slot: operation.slot,
          kind: "image",
          mediaType: generated.mediaType,
          bytes: generated.bytes,
        });
      }
      await audit("ok");
      return result;
    } catch (error) {
      await audit("error", (error as Error).message);
      throw error;
    }
  };
}
