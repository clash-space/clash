import {
  ExecutablePluginBrokerRequestSchema,
  ExecutablePluginBrokerResponseSchema,
  ProviderAccountIdSchema,
  type AssetKind,
  type ExecutablePluginAssetHandle,
} from "@clash/shared-types";
import { Hono } from "hono";

import type { Env } from "../../config";
import { log } from "../../logger";
import { createAsset } from "../../services/assets";
import {
  createHostedExecutablePluginBroker,
  type HostedPluginBrokerAssetReadResult,
} from "../../services/hosted-plugin-broker";
import { verifyHostedExecutablePluginCapability } from "../../services/hosted-plugin-capabilities";
import {
  getProviderAccountCredentialsById,
  getProviderCredentials,
} from "../../services/provider-accounts";
import { loadSecrets } from "../../services/user-variables";

export const pluginBrokerRoutes = new Hono<{ Bindings: Env }>();

function capabilityKey(env: Env): string {
  const value = env.PLUGIN_CAPABILITY_KEY ?? env.ACTION_SECRET_KEY;
  if (!value) throw new Error("Hosted executable-plugin capability key is not configured.");
  return value;
}

function extension(kind: AssetKind, mediaType?: string): string {
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/webp") return "webp";
  if (mediaType === "audio/wav") return "wav";
  if (mediaType === "audio/mpeg") return "mp3";
  if (kind === "video") return "mp4";
  if (kind === "audio") return "bin";
  if (kind === "model") return "glb";
  return "png";
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "output";
}

async function deterministicAssetId(invocationId: string, slot: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${invocationId}\0${slot}`),
  );
  const hex = [...new Uint8Array(digest)].slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `plugin-${hex}`;
}

async function readHostedAsset(
  env: Env,
  input: { ownerUserId: string; projectId: string; assetId: string },
): Promise<HostedPluginBrokerAssetReadResult> {
  const row = await env.DB.prepare(
    `SELECT assets.kind, assets.src_r2_key as srcR2Key, assets.metadata
       FROM assets
       JOIN asset_refs ON asset_refs.asset_id = assets.id
      WHERE assets.id = ? AND assets.user_id = ? AND asset_refs.project_id = ?
      LIMIT 1`,
  ).bind(input.assetId, input.ownerUserId, input.projectId)
    .first<{ kind: AssetKind; srcR2Key: string; metadata: string | null }>();
  if (!row) throw new Error(`Asset ${input.assetId} is not available in project ${input.projectId}.`);
  const object = await env.R2_BUCKET.get(row.srcR2Key);
  if (!object) throw new Error(`Asset ${input.assetId} content is missing.`);
  let mediaType: string | undefined;
  if (row.metadata) {
    try {
      const metadata = JSON.parse(row.metadata) as { contentType?: unknown };
      if (typeof metadata.contentType === "string") mediaType = metadata.contentType;
    } catch { /* old metadata may be malformed; R2 headers remain authoritative */ }
  }
  mediaType = object.httpMetadata?.contentType ?? mediaType;
  return {
    kind: row.kind,
    ...(mediaType ? { mediaType } : {}),
    bytes: new Uint8Array(await object.arrayBuffer()),
  };
}

async function writeHostedAsset(
  env: Env,
  input: {
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
  },
): Promise<ExecutablePluginAssetHandle> {
  const assetId = await deterministicAssetId(input.invocationId, input.slot);
  const storageKey = [
    "projects",
    safeSegment(input.projectId),
    "plugins",
    safeSegment(input.invocationId),
    `${safeSegment(input.slot)}.${extension(input.kind, input.mediaType)}`,
  ].join("/");
  await env.R2_BUCKET.put(storageKey, input.bytes, {
    httpMetadata: input.mediaType ? { contentType: input.mediaType } : undefined,
  });
  await createAsset(env.DB, {
    id: assetId,
    userId: input.ownerUserId,
    projectId: input.projectId,
    kind: input.kind,
    srcR2Key: storageKey,
    metadata: {
      bytes: input.bytes.byteLength,
      ...(input.mediaType ? { contentType: input.mediaType } : {}),
    },
    sourceModel: `plugin:${input.pluginId}@${input.pluginVersion}`,
    sourceTaskId: input.taskId,
  });
  return {
    assetId,
    uri: `clash-asset://${assetId}`,
    kind: input.kind,
    ...(input.mediaType ? { mediaType: input.mediaType } : {}),
  };
}

function createBroker(env: Env) {
  return createHostedExecutablePluginBroker({
    capabilityKey: capabilityKey(env),
    loadCredential: async ({ ownerUserId, secretId }) => {
      if (secretId.startsWith("provider-account:")) {
        return getProviderAccountCredentialsById(
          env,
          ownerUserId,
          secretId.slice("provider-account:".length),
        );
      }
      if (secretId.startsWith("provider:")) {
        const providerId = ProviderAccountIdSchema.parse(secretId.slice("provider:".length));
        return {
          providerId,
          credentials: await getProviderCredentials(env, ownerUserId, { providerId }),
        };
      }
      if (!env.ACTION_SECRET_KEY) throw new Error("Action secret decryption is not configured.");
      const values = await loadSecrets(env.DB, ownerUserId, [secretId], env.ACTION_SECRET_KEY);
      const value = values[secretId];
      if (!value) throw new Error(`Secret ${secretId} is not configured.`);
      return { providerId: "custom", credentials: { apiKey: value } };
    },
    readAsset: (input) => readHostedAsset(env, input),
    writeAsset: (input) => writeHostedAsset(env, input),
    audit: async (record) => {
      await env.DB.prepare(
        `INSERT INTO plugin_broker_audit (
           id, capability_id, plugin_id, plugin_version, project_id,
           invocation_id, request_id, operation, target, status, error, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        record.capabilityId,
        record.pluginId,
        record.pluginVersion,
        record.projectId,
        record.invocationId,
        record.requestId,
        record.operation,
        record.target,
        record.status,
        record.error ?? null,
        Math.floor(new Date(record.occurredAt).getTime() / 1000),
      ).run();
    },
  });
}

pluginBrokerRoutes.post("/", async (c) => {
  const token = c.req.header("x-clash-plugin-capability") ?? "";
  if (!token) return c.json({ error: "Missing hosted plugin capability." }, 401);
  try {
    await verifyHostedExecutablePluginCapability(token, capabilityKey(c.env));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 401);
  }

  let request;
  try {
    request = ExecutablePluginBrokerRequestSchema.parse(await c.req.json());
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
  try {
    const result = await createBroker(c.env)(token, request);
    return c.json(ExecutablePluginBrokerResponseSchema.parse({
      protocol: "clash.plugin.broker-response/v1",
      requestId: request.requestId,
      status: "ok",
      result,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("hosted plugin broker request denied", {
      requestId: request.requestId,
      operation: request.operation.kind,
      error: message,
    });
    return c.json(ExecutablePluginBrokerResponseSchema.parse({
      protocol: "clash.plugin.broker-response/v1",
      requestId: request.requestId,
      status: "error",
      error: {
        code: message.includes("not declared") ? "permission_denied" : "broker_error",
        message,
      },
    }));
  }
});
