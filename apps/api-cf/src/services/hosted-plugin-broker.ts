import {
  ExecutablePluginBrokerRequestSchema,
  ExecutablePluginManifestSchema,
  executablePluginBrokerPermissionError,
  type AssetKind,
  type ExecutablePluginAssetHandle,
  type ExecutablePluginBrokerRequest,
  type ExecutablePluginJsonValue,
} from "@clash/shared-types";

import {
  signHostedCredentialCapability,
  verifyHostedCredentialCapability,
  verifyHostedExecutablePluginCapability,
} from "./hosted-plugin-capabilities";

export interface HostedPluginBrokerCredential {
  providerId: string;
  accountId?: string;
  credentials: Record<string, string>;
}

export interface HostedPluginBrokerAssetReadResult {
  kind: AssetKind;
  mediaType?: string;
  bytes: Uint8Array;
}

export interface HostedPluginBrokerAuditRecord {
  capabilityId: string;
  pluginId: string;
  pluginVersion: string;
  projectId: string;
  invocationId: string;
  requestId: string;
  operation: ExecutablePluginBrokerRequest["operation"]["kind"];
  target: string;
  status: "ok" | "error";
  error?: string;
  occurredAt: string;
}

export interface HostedExecutablePluginBrokerOptions {
  capabilityKey: string;
  fetch?: typeof fetch;
  nowSeconds?: () => number;
  loadCredential: (input: {
    ownerUserId: string;
    secretId: string;
  }) => Promise<HostedPluginBrokerCredential>;
  readAsset?: (input: {
    ownerUserId: string;
    projectId: string;
    assetId: string;
  }) => Promise<HostedPluginBrokerAssetReadResult>;
  writeAsset?: (input: {
    ownerUserId: string;
    projectId: string;
    taskId: string;
    invocationId: string;
    pluginId: string;
    pluginVersion: string;
    slot: string;
    kind: AssetKind;
    mediaType?: string;
    bytes: Uint8Array;
  }) => Promise<ExecutablePluginAssetHandle>;
  audit?: (record: HostedPluginBrokerAuditRecord) => Promise<void> | void;
}

const CREDENTIAL_HEADER_NAMES = new Set([
  "authorization",
  "api-key",
  "x-api-key",
  "xi-api-key",
  "x-goog-api-key",
]);

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function credentialProvider(secretId: string): string | undefined {
  return secretId.startsWith("provider:") ? secretId.slice("provider:".length) : undefined;
}

function authorizationHeaders(credential: HostedPluginBrokerCredential): Record<string, string> {
  const apiKey = credential.credentials.apiKey?.trim();
  if (!apiKey) throw new Error(`Provider ${credential.providerId} has no configured apiKey.`);
  if (credential.providerId === "fal") return { authorization: `Key ${apiKey}` };
  if (credential.providerId === "replicate") return { authorization: `Token ${apiKey}` };
  if (credential.providerId === "elevenlabs") return { "xi-api-key": apiKey };
  if (credential.providerId === "google" || credential.providerId === "google-ai-studio") {
    return { "x-goog-api-key": apiKey };
  }
  return { authorization: `Bearer ${apiKey}` };
}

function safeRequestHeaders(
  input: Record<string, string>,
  credential?: HostedPluginBrokerCredential,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input)) {
    if (!CREDENTIAL_HEADER_NAMES.has(name.toLowerCase())) headers.set(name, value);
  }
  if (credential) {
    for (const [name, value] of Object.entries(authorizationHeaders(credential))) {
      headers.set(name, value);
    }
  }
  return headers;
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
  return { encoding: "base64", data: bytesToBase64(bytes) };
}

function operationTarget(request: ExecutablePluginBrokerRequest): string {
  const operation = request.operation;
  if (operation.kind === "credential.handle") return operation.secretId;
  if (operation.kind === "asset.read") return operation.asset.assetId;
  if (operation.kind === "asset.write") return operation.slot;
  return new URL(operation.url).hostname;
}

export function createHostedExecutablePluginBroker(options: HostedExecutablePluginBrokerOptions) {
  const brokerFetch = options.fetch ?? fetch;
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  return async (capabilityToken: string, requestInput: unknown): Promise<ExecutablePluginJsonValue> => {
    const capability = await verifyHostedExecutablePluginCapability(
      capabilityToken,
      options.capabilityKey,
      { nowSeconds: nowSeconds() },
    );
    const request = ExecutablePluginBrokerRequestSchema.parse(requestInput);
    const target = operationTarget(request);
    const audit = async (status: "ok" | "error", error?: string) => {
      await options.audit?.({
        capabilityId: capability.capabilityId,
        pluginId: capability.invocation.target.pluginId,
        pluginVersion: capability.invocation.target.version,
        projectId: capability.invocation.projectId,
        invocationId: request.invocationId,
        requestId: request.requestId,
        operation: request.operation.kind,
        target,
        status,
        ...(error ? { error } : {}),
        occurredAt: new Date(nowSeconds() * 1000).toISOString(),
      });
    };

    try {
      if (request.invocationId !== capability.invocation.invocationId) {
        throw new Error("Broker request invocation does not match its hosted capability.");
      }
      const manifest = ExecutablePluginManifestSchema.parse({
        apiVersion: "clash.plugin/v1",
        id: capability.invocation.target.pluginId,
        version: capability.invocation.target.version,
        name: capability.invocation.target.pluginId,
        runtime: { kind: "hosted", transport: "http", endpoint: capability.endpoint },
        exports: {
          cards: [],
          functions: [{
            id: capability.invocation.target.exportId,
            kind: capability.invocation.target.kind,
            handler: capability.invocation.target.exportId,
          }],
        },
        permissions: capability.permissions,
      });
      const permissionError = executablePluginBrokerPermissionError(manifest, request);
      if (permissionError) throw new Error(permissionError);

      const operation = request.operation;
      let result: ExecutablePluginJsonValue;
      if (operation.kind === "credential.handle") {
        const handle = await signHostedCredentialCapability({
          protocol: "clash.plugin.credential-capability/v1",
          capabilityId: crypto.randomUUID(),
          parentCapabilityId: capability.capabilityId,
          invocationId: request.invocationId,
          pluginId: capability.invocation.target.pluginId,
          secretId: operation.secretId,
          issuedAt: nowSeconds(),
          expiresAt: capability.expiresAt,
        }, options.capabilityKey);
        result = {
          handle,
          secretId: operation.secretId,
          ...(credentialProvider(operation.secretId)
            ? { providerId: credentialProvider(operation.secretId)! }
            : {}),
          expiresAt: new Date(capability.expiresAt * 1000).toISOString(),
        };
      } else if (operation.kind === "network.fetch") {
        let credential: HostedPluginBrokerCredential | undefined;
        if (operation.credentialHandle) {
          const credentialCapability = await verifyHostedCredentialCapability(
            operation.credentialHandle,
            options.capabilityKey,
            { nowSeconds: nowSeconds() },
          );
          if (credentialCapability.parentCapabilityId !== capability.capabilityId
            || credentialCapability.invocationId !== request.invocationId
            || credentialCapability.pluginId !== capability.invocation.target.pluginId) {
            throw new Error("Credential handle does not belong to this invocation and plugin.");
          }
          credential = await options.loadCredential({
            ownerUserId: capability.ownerUserId,
            secretId: credentialCapability.secretId,
          });
        }
        const body = operation.body === undefined
          ? undefined
          : typeof operation.body === "string"
            ? operation.body
            : JSON.stringify(operation.body);
        const response = await brokerFetch(operation.url, {
          method: operation.method,
          headers: safeRequestHeaders(operation.headers, credential),
          ...(body === undefined ? {} : { body }),
          redirect: "manual",
        });
        result = {
          status: response.status,
          headers: safeResponseHeaders(response.headers),
          body: await responseBody(response),
        };
      } else if (operation.kind === "asset.read") {
        if (!options.readAsset) throw new Error("Hosted asset read broker is unavailable.");
        const asset = await options.readAsset({
          ownerUserId: capability.ownerUserId,
          projectId: capability.invocation.projectId,
          assetId: operation.asset.assetId,
        });
        if (asset.kind !== operation.asset.kind) {
          throw new Error(
            `Asset ${operation.asset.assetId} kind ${asset.kind} does not match ${operation.asset.kind}.`,
          );
        }
        result = {
          handle: `clash-plugin-asset://${crypto.randomUUID()}`,
          kind: asset.kind,
          ...(asset.mediaType ? { mediaType: asset.mediaType } : {}),
          byteLength: asset.bytes.byteLength,
          dataBase64: bytesToBase64(asset.bytes),
        };
      } else {
        if (!options.writeAsset) throw new Error("Hosted asset write broker is unavailable.");
        if (!operation.dataBase64) {
          throw new Error("Hosted asset.write currently requires inline dataBase64.");
        }
        result = await options.writeAsset({
          ownerUserId: capability.ownerUserId,
          projectId: capability.invocation.projectId,
          taskId: capability.invocation.taskId,
          invocationId: capability.invocation.invocationId,
          pluginId: capability.invocation.target.pluginId,
          pluginVersion: capability.invocation.target.version,
          slot: operation.slot,
          kind: operation.assetKind,
          ...(operation.mediaType ? { mediaType: operation.mediaType } : {}),
          bytes: base64ToBytes(operation.dataBase64),
        });
      }
      await audit("ok");
      return result;
    } catch (error) {
      await audit("error", error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
}
