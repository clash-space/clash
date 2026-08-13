import {
  executablePluginDependencyError,
  type PluginBroker,
} from "./runtime/host/lib/actions-loader.js";
import { ExecutablePluginBrokerResolvedReferenceSchema } from "@clash/shared-types";
import type {
  AssetKind,
  ExecutablePluginAssetHandle,
  ExecutablePluginJsonValue,
} from "@clash/shared-types";

import type { RuntimeProviderAccountAvailability } from "./provider-accounts.js";

export interface LocalPluginBrokerAuditRecord {
  pluginId: string;
  pluginVersion: string;
  projectId: string;
  invocationId: string;
  requestId: string;
  operation:
    | "asset.resolve"
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

export interface LocalPluginBrokerResolvedAsset {
  kind: AssetKind;
  mediaType?: string;
  bytes: Uint8Array;
  providerUrl?: { providerUrl: string; expiresAt: string };
}

export class LocalPluginBrokerAuthorizationError extends Error {
  readonly code = "PLUGIN_REFERENCE_NOT_AUTHORIZED" as const;

  constructor(slot: string, index: number) {
    super(
      `Asset reference ${slot}:${index} is not authorized for the active invocation.`,
    );
    this.name = "LocalPluginBrokerAuthorizationError";
  }
}

export interface LocalExecutablePluginBrokerOptions {
  loadProviderAccounts: () => Promise<RuntimeProviderAccountAvailability[]>;
  readAsset?: (input: {
    assetId: string;
    projectId: string;
  }) => Promise<LocalPluginBrokerResolvedAsset>;
  /** Publish one immutable Resource when the binding requires a URL and no reusable one exists. */
  publishAsset?: (input: {
    pluginId: string;
    pluginVersion: string;
    projectId: string;
    invocationId: string;
    assetId: string;
    kind: AssetKind;
    mediaType?: string;
    bytes: Uint8Array;
  }) => Promise<{ url: string; expiresAt: string } | undefined>;
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
    pluginVersion: string;
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
  if (operation.kind === "asset.resolve") {
    return "asset" in operation.reference
      ? operation.reference.asset.assetId
      : `${operation.reference.slot}:${operation.reference.index}`;
  }
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
        operation: request.operation
          .kind as LocalPluginBrokerAuditRecord["operation"],
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
      if (operation.kind === "asset.resolve") {
        if ("text" in operation.reference) {
          result = ExecutablePluginBrokerResolvedReferenceSchema.parse({
            form: "text",
            text: operation.reference.text.value,
          });
          await audit("ok");
          return result;
        }
        if (!options.readAsset)
          throw new Error("Local asset broker is unavailable.");
        const reference = operation.reference;
        const authorized = context.invocation.input.references.some(
          (candidate) =>
            "asset" in candidate &&
            candidate.slot === reference.slot &&
            candidate.asset.assetId === reference.asset.assetId &&
            candidate.asset.kind === reference.asset.kind,
        );
        if (!authorized) {
          throw new LocalPluginBrokerAuthorizationError(
            reference.slot,
            reference.index,
          );
        }
        const asset = await options.readAsset({
          assetId: reference.asset.assetId,
          projectId: context.invocation.projectId,
        });
        if (asset.kind !== reference.asset.kind) {
          throw new Error(
            `Asset ${reference.asset.assetId} kind ${asset.kind} does not match ${reference.asset.kind}.`,
          );
        }
        const delivery = context.invocation.assetInputs.find((entry) => {
          const kindMatches =
            !entry.match.kinds?.length ||
            entry.match.kinds.includes(asset.kind);
          const slotMatches =
            !entry.match.slots?.length ||
            entry.match.slots.includes(reference.slot);
          const mediaTypeMatches =
            !entry.mediaTypes?.length ||
            (!!asset.mediaType && entry.mediaTypes.includes(asset.mediaType));
          return kindMatches && slotMatches && mediaTypeMatches;
        });
        if (!delivery) {
          throw new Error(
            `Provider binding declares no delivery for ${reference.slot} ${asset.kind}` +
              `${asset.mediaType ? ` (${asset.mediaType})` : ""}.`,
          );
        }
        if (delivery.representations.includes("provider-url")) {
          // Accepting a URL does not authorise a new public copy. When bytes are also accepted,
          // reuse an existing projection or stay local and send bytes. Publishing is reserved for
          // URL-only bindings, where the Provider cannot execute without a fetchable projection.
          const requiresProviderUrl =
            !delivery.representations.includes("bytes");
          const published =
            asset.providerUrl ??
            (requiresProviderUrl && options.publishAsset
              ? await options.publishAsset({
                  pluginId: context.manifest.id,
                  pluginVersion: context.manifest.version,
                  projectId: context.invocation.projectId,
                  invocationId: context.invocation.invocationId,
                  assetId: reference.asset.assetId,
                  kind: asset.kind,
                  ...(asset.mediaType ? { mediaType: asset.mediaType } : {}),
                  bytes: asset.bytes,
                })
              : undefined);
          if (published) {
            result = ExecutablePluginBrokerResolvedReferenceSchema.parse({
              form: "provider-url",
              providerUrl:
                "providerUrl" in published
                  ? published.providerUrl
                  : published.url,
              expiresAt: published.expiresAt,
              kind: asset.kind,
              ...(asset.mediaType ? { mediaType: asset.mediaType } : {}),
            });
            await audit("ok");
            return result;
          }
        }
        if (delivery.representations.includes("bytes")) {
          result = ExecutablePluginBrokerResolvedReferenceSchema.parse({
            form: "bytes",
            bytesBase64: Buffer.from(asset.bytes).toString("base64"),
            kind: asset.kind,
            ...(asset.mediaType ? { mediaType: asset.mediaType } : {}),
          });
        } else {
          throw new Error(
            `Provider binding requires a public URL for ${reference.slot}, but the Host cannot provide one.`,
          );
        }
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
        const account =
          stored === undefined
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
            pluginVersion: context.manifest.version,
            projectId: context.invocation.projectId,
            invocationId: context.invocation.invocationId,
            taskId: context.invocation.taskId,
            slot: operation.slot,
            kind: operation.assetKind,
            ...(operation.mediaType ? { mediaType: operation.mediaType } : {}),
            assetId: operation.assetId,
          })) as never;
          await audit("ok");
          return result;
        }
        if (operation.url) {
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
            url: operation.url,
          })) as never;
          await audit("ok");
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
        for (const [index, reference] of operation.references.entries()) {
          const authorized = context.invocation.input.references.some(
            (candidate) =>
              "asset" in candidate &&
              candidate.asset.assetId === reference.assetId &&
              candidate.asset.kind === reference.kind,
          );
          if (!authorized) {
            throw new LocalPluginBrokerAuthorizationError(
              "codex.imagegen",
              index,
            );
          }
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
