import { randomUUID } from "node:crypto";

import {
  createGlobalAssetClient,
  type GlobalAssetAuthorityPort,
} from "@clash/asset-sdk";
import {
  GlobalAssetEntrySchema,
  type AssetKind,
  type GlobalAssetEntry,
  type ProjectAssetMetadata,
  type ProjectAssetProvenance,
  type ResolvedAsset,
} from "@clash/shared-types";

import { createLocalMetadataStore } from "./local-metadata-store.js";
import {
  createLocalResourceStore,
  type LocalResourceProjection,
} from "./local-resource-store.js";

export type LocalGlobalAssetErrorCode =
  | "GLOBAL_ASSET_NOT_FOUND"
  | "GLOBAL_ASSET_UNAVAILABLE"
  | "GLOBAL_ASSET_FACT_MISMATCH";

export class LocalGlobalAssetError extends Error {
  readonly code: LocalGlobalAssetErrorCode;

  constructor(
    code: LocalGlobalAssetErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LocalGlobalAssetError";
    this.code = code;
  }
}

export interface LocalGlobalAssetService {
  importBytes(input: {
    libraryId: string;
    globalAssetId?: string;
    kind: AssetKind;
    bytes: Uint8Array;
    contentType?: string;
    originalName?: string;
    name?: string;
    metadata?: ProjectAssetMetadata;
    provenance?: ProjectAssetProvenance;
  }): Promise<ResolvedAsset>;
  publishResource(input: {
    libraryId: string;
    globalAssetId?: string;
    resourceId: string;
    kind: AssetKind;
    name?: string;
    metadata?: ProjectAssetMetadata;
    provenance?: ProjectAssetProvenance;
  }): Promise<ResolvedAsset>;
  /** Host-private entry lookup for semantic publish/admit operations. */
  readEntry(
    libraryId: string,
    globalAssetId: string,
  ): Promise<GlobalAssetEntry | null>;
  read(libraryId: string, globalAssetId: string): Promise<ResolvedAsset | null>;
  list(libraryId: string): Promise<ResolvedAsset[]>;
  trash(input: {
    libraryId: string;
    globalAssetId: string;
    deleteOperationId: string;
    deletedAt: string;
    purgeAfter: string;
  }): Promise<ResolvedAsset>;
  restore(libraryId: string, globalAssetId: string): Promise<ResolvedAsset>;
  purge(input: {
    libraryId: string;
    globalAssetId: string;
    deleteOperationId: string;
    purgedAt: string;
  }): Promise<ResolvedAsset>;
  openProjection(
    libraryId: string,
    globalAssetId: string,
  ): Promise<LocalResourceProjection>;
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function mediaUrl(
  origin: string,
  libraryId: string,
  globalAssetId: string,
): string {
  return `${origin.replace(/\/+$/, "")}/api/v1/libraries/${encodeURIComponent(libraryId)}/assets/${encodeURIComponent(globalAssetId)}/media`;
}

function metadataForResource(input: {
  metadata?: ProjectAssetMetadata;
  byteLength: number;
  contentType?: string;
  originalName?: string;
}): ProjectAssetMetadata {
  if (
    input.metadata?.bytes !== undefined &&
    input.metadata.bytes !== input.byteLength
  ) {
    throw new LocalGlobalAssetError(
      "GLOBAL_ASSET_FACT_MISMATCH",
      "Global Asset metadata byte length does not match its immutable Resource.",
    );
  }
  if (
    input.metadata?.contentType !== undefined &&
    input.metadata.contentType !== input.contentType
  ) {
    throw new LocalGlobalAssetError(
      "GLOBAL_ASSET_FACT_MISMATCH",
      "Global Asset metadata content type does not match its immutable Resource.",
    );
  }
  return {
    ...(input.metadata ?? {}),
    bytes: input.byteLength,
    ...(input.contentType ? { contentType: input.contentType } : {}),
    ...(input.originalName ? { originalName: input.originalName } : {}),
  };
}

export function createLocalGlobalAssetService(options: {
  dataDir: string;
  clashRoot?: string;
  projectionOrigin: string | (() => string);
}): LocalGlobalAssetService {
  const metadata = createLocalMetadataStore(options.dataDir);
  const resources = createLocalResourceStore({
    dataDir: options.dataDir,
    ...(options.clashRoot ? { clashRoot: options.clashRoot } : {}),
  });

  const authority: GlobalAssetAuthorityPort = {
    read: metadata.readGlobalAsset,
    list: metadata.listGlobalAssets,
    create: metadata.createGlobalAsset,
    trash: metadata.trashGlobalAsset,
    restore: metadata.restoreGlobalAsset,
    purge: metadata.purgeGlobalAsset,
  };

  const client = createGlobalAssetClient({
    authority,
    registry: {
      async resolve({ entry }) {
        try {
          const projection = await resources.resolve(entry.resourceId);
          return projection
            ? { status: "ready" as const, resource: projection.resource }
            : {
                status: "unavailable" as const,
                error:
                  "Immutable Resource bytes are not installed on this Host.",
              };
        } catch (error) {
          return {
            status: "failed" as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },
    projection: {
      async resolve({ libraryId, entry }) {
        const origin =
          typeof options.projectionOrigin === "function"
            ? options.projectionOrigin()
            : options.projectionOrigin;
        const url = mediaUrl(origin, libraryId, entry.id);
        return { status: "ready" as const, url, thumbnailUrl: url };
      },
    },
  });

  async function requireResolved(
    libraryId: string,
    globalAssetId: string,
  ): Promise<ResolvedAsset> {
    const resolved = await client.read({ libraryId, globalAssetId });
    if (!resolved) {
      throw new LocalGlobalAssetError(
        "GLOBAL_ASSET_NOT_FOUND",
        `Global Asset ${globalAssetId} was not found in library ${libraryId}.`,
      );
    }
    return resolved;
  }

  async function publish(input: {
    libraryId: string;
    globalAssetId?: string;
    resourceId: string;
    kind: AssetKind;
    name?: string;
    metadata?: ProjectAssetMetadata;
    provenance?: ProjectAssetProvenance;
    originalName?: string;
  }): Promise<ResolvedAsset> {
    const libraryId = nonEmpty(input.libraryId, "libraryId");
    const globalAssetId = nonEmpty(
      input.globalAssetId ?? `global:${randomUUID()}`,
      "globalAssetId",
    );
    const projection = await resources.resolve(
      nonEmpty(input.resourceId, "resourceId"),
    );
    if (!projection) {
      throw new LocalGlobalAssetError(
        "GLOBAL_ASSET_UNAVAILABLE",
        `Resource ${input.resourceId} is not installed on this Host.`,
      );
    }
    if (projection.resource.kind !== input.kind) {
      throw new LocalGlobalAssetError(
        "GLOBAL_ASSET_FACT_MISMATCH",
        `Resource ${input.resourceId} is ${projection.resource.kind}, not ${input.kind}.`,
      );
    }
    const entry = GlobalAssetEntrySchema.parse({
      id: globalAssetId,
      kind: input.kind,
      resourceId: projection.resource.id,
      lifecycle: { state: "active" },
      ...(input.name ? { name: input.name } : {}),
      metadata: metadataForResource({
        metadata: input.metadata,
        byteLength: projection.resource.byteLength,
        ...(projection.resource.contentType
          ? { contentType: projection.resource.contentType }
          : {}),
        ...(input.originalName ? { originalName: input.originalName } : {}),
      }),
      ...(input.provenance ? { provenance: input.provenance } : {}),
    } satisfies GlobalAssetEntry);
    await client.create({ libraryId, entry });
    return requireResolved(libraryId, globalAssetId);
  }

  return {
    async importBytes(input) {
      const projection = await resources.install({
        kind: input.kind,
        bytes: input.bytes,
        ...(input.contentType ? { contentType: input.contentType } : {}),
        ...(input.originalName ? { originalName: input.originalName } : {}),
      });
      return publish({
        libraryId: input.libraryId,
        ...(input.globalAssetId ? { globalAssetId: input.globalAssetId } : {}),
        resourceId: projection.resource.id,
        kind: input.kind,
        ...((input.name ?? input.originalName)
          ? { name: input.name ?? input.originalName }
          : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(input.provenance ? { provenance: input.provenance } : {}),
        ...(input.originalName ? { originalName: input.originalName } : {}),
      });
    },

    publishResource: publish,

    async readEntry(libraryIdInput, globalAssetIdInput) {
      const libraryId = nonEmpty(libraryIdInput, "libraryId");
      const globalAssetId = nonEmpty(globalAssetIdInput, "globalAssetId");
      const entry = await authority.read(libraryId, globalAssetId);
      return entry ? GlobalAssetEntrySchema.parse(entry) : null;
    },

    read(libraryId, globalAssetId) {
      return client.read({ libraryId, globalAssetId });
    },

    list(libraryId) {
      return client.list({ libraryId });
    },

    async trash(input) {
      await client.trash(input);
      return requireResolved(input.libraryId, input.globalAssetId);
    },

    async restore(libraryId, globalAssetId) {
      await client.restore({ libraryId, globalAssetId });
      return requireResolved(libraryId, globalAssetId);
    },

    async purge(input) {
      await client.purge(input);
      return requireResolved(input.libraryId, input.globalAssetId);
    },

    async openProjection(libraryIdInput, globalAssetIdInput) {
      const libraryId = nonEmpty(libraryIdInput, "libraryId");
      const globalAssetId = nonEmpty(globalAssetIdInput, "globalAssetId");
      const entry = await authority.read(libraryId, globalAssetId);
      if (!entry) {
        throw new LocalGlobalAssetError(
          "GLOBAL_ASSET_NOT_FOUND",
          `Global Asset ${globalAssetId} was not found in library ${libraryId}.`,
        );
      }
      if (entry.lifecycle.state !== "active") {
        throw new LocalGlobalAssetError(
          "GLOBAL_ASSET_UNAVAILABLE",
          `Global Asset ${globalAssetId} is not active.`,
        );
      }
      const projection = await resources.resolve(entry.resourceId);
      if (!projection) {
        throw new LocalGlobalAssetError(
          "GLOBAL_ASSET_UNAVAILABLE",
          `Resource ${entry.resourceId} is not installed on this Host.`,
        );
      }
      metadataForResource({
        metadata: entry.metadata,
        byteLength: projection.resource.byteLength,
        ...(projection.resource.contentType
          ? { contentType: projection.resource.contentType }
          : {}),
      });
      if (projection.resource.kind !== entry.kind) {
        throw new LocalGlobalAssetError(
          "GLOBAL_ASSET_FACT_MISMATCH",
          `Global Asset ${globalAssetId} kind does not match its Resource.`,
        );
      }
      return projection;
    },
  };
}
