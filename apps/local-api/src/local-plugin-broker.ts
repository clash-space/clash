import { randomUUID } from "node:crypto";

import {
  executablePluginDependencyError,
  type PluginBroker,
} from "./runtime/host/lib/actions-loader.js";
import {
  assetReachForRuntime,
  ExecutablePluginAssetReadResultSchema,
} from "@clash/shared-types";
import type {
  AssetKind,
  ExecutablePluginAssetHandle,
  ExecutablePluginAssetReadResult,
  ExecutablePluginJsonValue,
} from "@clash/shared-types";

import type { RuntimeProviderAccountAvailability } from "./provider-accounts.js";

/**
 * Resolves one asset into something the plugin can use, decided by its run mode.
 *
 * A published URL wins whenever one exists: nothing is read, encoded, or copied. Otherwise a
 * `local` plugin gets the host's own asset endpoint, which it can fetch because it runs here, and
 * a `hosted` plugin gets bytes -- handing it that same address would point it at whatever answers
 * on its own network, and both forms are `https?://` strings that nothing downstream can
 * distinguish.
 *
 * Nothing here reads a manifest field. `runtime.kind` is mandatory and already settles the
 * question; a second declaration could only repeat it or disagree with it.
 */
export async function readAssetForPlugin(options: {
  asset: ExecutablePluginAssetHandle;
  runtimeKind: "local" | "hosted";
  readAsset: (asset: { assetId: string; projectId?: string }) => Promise<{
    kind: AssetKind;
    bytes: Uint8Array;
    mediaType?: string;
  }>;
  projectId?: string;
  publicUrl?: () => string | undefined;
  localUrl?: () => string | undefined;
}): Promise<ExecutablePluginAssetReadResult> {
  const reachable = assetReachForRuntime(options.runtimeKind);
  const publicUrl = options.publicUrl?.();
  const localUrl = reachable.includes("private")
    ? options.localUrl?.()
    : undefined;
  const asset = await options.readAsset({
    assetId: options.asset.assetId,
    ...(options.projectId ? { projectId: options.projectId } : {}),
  });
  const common = {
    handle: `clash-plugin-asset://${randomUUID()}`,
    kind: asset.kind,
    ...(asset.mediaType ? { mediaType: asset.mediaType } : {}),
    byteLength: asset.bytes.byteLength,
  };
  if (publicUrl) {
    return ExecutablePluginAssetReadResultSchema.parse({
      ...common,
      url: publicUrl,
      reach: "public",
    });
  }
  if (localUrl) {
    return ExecutablePluginAssetReadResultSchema.parse({
      ...common,
      url: localUrl,
      reach: "private",
    });
  }
  return ExecutablePluginAssetReadResultSchema.parse({
    ...common,
    dataBase64: Buffer.from(asset.bytes).toString("base64"),
  });
}

export interface LocalPluginBrokerAuditRecord {
  pluginId: string;
  pluginVersion: string;
  projectId: string;
  invocationId: string;
  requestId: string;
  operation:
    | "asset.read"
    | "asset.write"
    | "asset.upload-slot"
    | "store.get"
    | "store.put"
    | "codex.image.generate";
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
  loadProviderAccounts: () => Promise<RuntimeProviderAccountAvailability[]>;
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
  /**
   * Hand out somewhere to stream bytes, and collect them afterwards.
   *
   * The alternative is `dataBase64` inside the broker frame, which for one 30-second video is
   * 3,470,456 characters held at once by the plugin, the pipe and this process.
   */
  openUploadSlot?: (input: {
    pluginId: string;
    pluginVersion: string;
    projectId: string;
    invocationId: string;
    taskId: string;
    slot: string;
    kind: AssetKind;
    mediaType?: string;
    /** How many bytes are coming, when the plugin holds them. */
    byteLength?: number;
    /** Where they are, when the vendor answered with a link and there is nothing to count yet. */
    url?: string;
  }) => Promise<{
    /** Where to PUT the bytes. Absent when the host already holds them -- a vendor link is fetched
     * by the host, and there is nobody left to upload. */
    uploadUrl?: string;
    assetId: string;
  }>;
  finishUpload?: (input: {
    pluginId: string;
    projectId: string;
    invocationId: string;
    taskId: string;
    slot: string;
    kind: AssetKind;
    mediaType?: string;
    assetId: string;
  }) => Promise<ExecutablePluginAssetHandle>;
  /**
   * This plugin's own stored values, for this account.
   *
   * Bound to the active invocation. The request carries a key and nothing else, so a plugin cannot
   * reach another plugin's credentials or another account's by asking -- the pair is decided before
   * the key is read.
   */
  storeGet?: (input: {
    pluginId: string;
    accountId: string;
    key: string;
  }) => Promise<string | undefined>;
  storePut?: (input: {
    pluginId: string;
    accountId: string;
    key: string;
    value: string;
    secret?: boolean;
    expiresAt?: string;
  }) => Promise<void>;
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
  now?: () => number;
}

function requestTarget(
  operation: Parameters<PluginBroker>[0]["operation"],
): string {
  if (operation.kind === "store.get" || operation.kind === "store.put")
    return operation.key;
  if (operation.kind === "asset.read") return operation.asset.assetId;
  if (
    operation.kind === "asset.write" ||
    operation.kind === "asset.upload-slot"
  )
    return operation.slot;
  if (operation.kind === "codex.image.generate") return "codex.imagegen";
  throw new Error(
    `Unsupported plugin broker operation ${String(
      (operation as unknown as { kind?: unknown }).kind,
    )}.`,
  );
}

export function createLocalExecutablePluginBroker(
  options: LocalExecutablePluginBrokerOptions,
): PluginBroker {
  const now = options.now ?? Date.now;

  return async (request, context) => {
    const target = requestTarget(request.operation);
    const dependencyError = executablePluginDependencyError(
      context.manifest,
      request,
    );
    const audit = async (status: "ok" | "error", error?: string) => {
      await options.audit?.({
        pluginId: context.manifest.id,
        pluginVersion: context.manifest.version,
        projectId: context.invocation.projectId,
        invocationId: request.invocationId,
        requestId: request.requestId,
        operation:
          request.operation.kind as LocalPluginBrokerAuditRecord["operation"],
        target,
        status,
        ...(error ? { error } : {}),
        occurredAt: new Date(now()).toISOString(),
      });
    };

    try {
      if (dependencyError) throw new Error(dependencyError);
      if (request.invocationId !== context.invocation.invocationId) {
        throw new Error(
          "Broker request invocation does not match the active invocation.",
        );
      }
      let result: ExecutablePluginJsonValue;
      const operation = request.operation;
      if (operation.kind === "asset.read") {
        if (!options.readAsset)
          throw new Error("Local asset broker is unavailable.");
        const asset = await options.readAsset({
          assetId: operation.asset.assetId,
          projectId: context.invocation.projectId,
        });
        if (asset.kind !== operation.asset.kind) {
          throw new Error(
            `Asset ${operation.asset.assetId} kind ${asset.kind} does not match ${operation.asset.kind}.`,
          );
        }
        // Validated against the shared contract so the hosted broker can answer the same
        // request with a short-lived `url` and no bytes, without any plugin change.
        result = ExecutablePluginAssetReadResultSchema.parse({
          handle: `clash-plugin-asset://${randomUUID()}`,
          kind: asset.kind,
          ...(asset.mediaType ? { mediaType: asset.mediaType } : {}),
          byteLength: asset.bytes.byteLength,
          dataBase64: Buffer.from(asset.bytes).toString("base64"),
        });
      } else if (operation.kind === "store.get") {
        if (!options.storeGet)
          throw new Error("Local plugin store is unavailable.");
        if (!context.accountId) {
          throw new Error(
            "Plugin store access requires a Host-selected provider account.",
          );
        }
        const stored = await options.storeGet({
          pluginId: context.manifest.id,
          accountId: context.accountId,
          key: operation.key,
        });
        const account = stored === undefined
          ? (await options.loadProviderAccounts()).find(
              (candidate) =>
                candidate.enabled && candidate.id === context.accountId,
            )
          : undefined;
        if (stored === undefined && !account) {
          throw new Error(
            `Host-selected provider account ${context.accountId} is unavailable.`,
          );
        }
        const value = stored ?? account?.credentials?.[operation.key];
        result = {
          // `null`, not `undefined`. An unset key used to answer `{ value: undefined }`, which
          // serialises to `{}` -- the plugin then saw a value-shaped object with no value in it.
          // clash.google asks for `service` and `region`, and an account holding a service account
          // key has neither, so the first optional lookup any Google account made killed the
          // invocation with a wall of union errors about a key that was simply not set.
          value: value ?? null,
        } as never;
      } else if (operation.kind === "store.put") {
        if (!options.storePut)
          throw new Error("Local plugin store is unavailable.");
        if (!context.accountId) {
          throw new Error(
            "Plugin store access requires a Host-selected provider account.",
          );
        }
        await options.storePut({
          pluginId: context.manifest.id,
          accountId: context.accountId,
          key: operation.key,
          value: operation.value,
          ...(operation.secret === undefined
            ? {}
            : { secret: operation.secret }),
          ...(operation.expiresAt === undefined
            ? {}
            : { expiresAt: operation.expiresAt }),
        });
        result = { ok: true } as never;
      } else if (operation.kind === "asset.upload-slot") {
        if (!options.openUploadSlot)
          throw new Error("Local upload slots are unavailable.");
        result = (await options.openUploadSlot({
          pluginId: context.manifest.id,
          pluginVersion: context.manifest.version,
          projectId: context.invocation.projectId,
          invocationId: context.invocation.invocationId,
          taskId: context.invocation.taskId,
          slot: operation.slot,
          kind: operation.assetKind,
          ...(operation.mediaType ? { mediaType: operation.mediaType } : {}),
          // Only what the plugin actually said. A url has no byte count until someone fetches it,
          // and inventing a zero here would announce a size the host would then enforce.
          ...(operation.byteLength === undefined
            ? {}
            : { byteLength: operation.byteLength }),
          ...(operation.url === undefined ? {} : { url: operation.url }),
        })) as never;
      } else if (operation.kind === "asset.write") {
        if (operation.assetId) {
          // The bytes are already stored; this only names them.
          if (!options.finishUpload)
            throw new Error("Local upload slots are unavailable.");
          result = (await options.finishUpload({
            pluginId: context.manifest.id,
            projectId: context.invocation.projectId,
            invocationId: context.invocation.invocationId,
            taskId: context.invocation.taskId,
            slot: operation.slot,
            kind: operation.assetKind,
            ...(operation.mediaType ? { mediaType: operation.mediaType } : {}),
            assetId: operation.assetId,
          })) as never;
          return result;
        }
        if (!options.writeAsset)
          throw new Error("Local asset write broker is unavailable.");
        if (!operation.dataBase64) {
          throw new Error(
            "Local asset.write requires dataBase64, or an assetId from an upload slot.",
          );
        }
        const bytes = new Uint8Array(
          Buffer.from(operation.dataBase64, "base64"),
        );
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
      } else if (operation.kind === "codex.image.generate") {
        if (!options.generateCodexImage) {
          throw new Error(
            "Codex ImageGen is unavailable in this Clash runtime.",
          );
        }
        if (!options.readAsset || !options.writeAsset) {
          throw new Error(
            "Codex ImageGen requires local asset read and write brokers.",
          );
        }
        const references = await Promise.all(
          operation.references.map(async (asset) => {
            const resolved = await options.readAsset!({
              assetId: asset.assetId,
              projectId: context.invocation.projectId,
            });
            if (resolved.kind !== "image") {
              throw new Error(
                `Codex ImageGen reference ${asset.assetId} is not an image.`,
              );
            }
            return {
              asset,
              ...(resolved.mediaType ? { mediaType: resolved.mediaType } : {}),
              bytes: resolved.bytes,
            };
          }),
        );
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
      } else {
        throw new Error(
          `Unsupported plugin broker operation ${String(
            (operation as unknown as { kind?: unknown }).kind,
          )}.`,
        );
      }
      await audit("ok");
      return result;
    } catch (error) {
      await audit("error", (error as Error).message);
      throw error;
    }
  };
}
