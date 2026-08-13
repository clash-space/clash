import {
  PROJECT_ASSET_READ_RECEIPT_HEADER as SHARED_PROJECT_ASSET_READ_RECEIPT_HEADER,
  createPersonalGlobalAssetHttpClient,
  createProjectAssetHttpClient,
} from "@clash/asset-sdk";
import type {
  ActionAssetBinding,
  AssetKind,
  ResolvedAsset,
} from "@clash/shared-types";

import {
  ProjectHostHttpError,
  resolveProjectHostContext,
  type ProjectHostConnection,
  type ProjectHostClient,
  type ResolvedProjectHostContext,
} from "./project-host-client.js";

export const PROJECT_ASSET_READ_RECEIPT_HEADER =
  SHARED_PROJECT_ASSET_READ_RECEIPT_HEADER;

export type AssetImportFileType = {
  kind: AssetKind;
  contentType: string;
};

const ASSET_IMPORT_FILE_TYPES: Record<string, AssetImportFileType> = {
  ".png": { kind: "image", contentType: "image/png" },
  ".jpg": { kind: "image", contentType: "image/jpeg" },
  ".jpeg": { kind: "image", contentType: "image/jpeg" },
  ".gif": { kind: "image", contentType: "image/gif" },
  ".webp": { kind: "image", contentType: "image/webp" },
  ".svg": { kind: "image", contentType: "image/svg+xml" },
  ".avif": { kind: "image", contentType: "image/avif" },
  ".mp4": { kind: "video", contentType: "video/mp4" },
  ".webm": { kind: "video", contentType: "video/webm" },
  ".mov": { kind: "video", contentType: "video/quicktime" },
  ".m4v": { kind: "video", contentType: "video/x-m4v" },
  ".mkv": { kind: "video", contentType: "video/x-matroska" },
  ".mp3": { kind: "audio", contentType: "audio/mpeg" },
  ".wav": { kind: "audio", contentType: "audio/wav" },
  ".m4a": { kind: "audio", contentType: "audio/mp4" },
  ".aac": { kind: "audio", contentType: "audio/aac" },
  ".flac": { kind: "audio", contentType: "audio/flac" },
  ".ogg": { kind: "audio", contentType: "audio/ogg" },
  ".glb": { kind: "model", contentType: "model/gltf-binary" },
  ".gltf": { kind: "model", contentType: "model/gltf+json" },
  ".fbx": { kind: "model", contentType: "application/octet-stream" },
  ".bvh": { kind: "model", contentType: "application/octet-stream" },
  ".obj": { kind: "model", contentType: "text/plain" },
  ".usdz": { kind: "model", contentType: "model/vnd.usdz+zip" },
};

export function resolveAssetImportFileType(
  filePath: string,
  requestedKind?: AssetKind,
): AssetImportFileType {
  const fileName = filePath.replace(/^.*[/\\]/u, "");
  const dot = fileName.lastIndexOf(".");
  const extension = dot > 0 ? fileName.slice(dot).toLowerCase() : "";
  const inferred = ASSET_IMPORT_FILE_TYPES[extension];
  if (!inferred) {
    if (requestedKind) {
      return { kind: requestedKind, contentType: "application/octet-stream" };
    }
    throw new Error(`Asset file type is unsupported: ${filePath}`);
  }
  if (requestedKind && requestedKind !== inferred.kind) {
    throw new Error(
      `Asset kind ${requestedKind} does not match the selected ${inferred.kind} file`,
    );
  }
  return { ...inferred, ...(requestedKind ? { kind: requestedKind } : {}) };
}

export type ProjectAssetHostScope = {
  cwd?: string;
  projectId?: string;
};

export type ProjectAssetHostResult<T> = {
  projectId: string;
  workspaceRoot?: string;
  value: T;
};

export type ProjectAssetHostObservation<T> = ProjectAssetHostResult<T> & {
  receipt: string;
};

export type ProjectAssetHostClient = {
  resolveContext(
    input?: ProjectAssetHostScope,
  ): Promise<ResolvedProjectHostContext>;
  list(
    input?: ProjectAssetHostScope,
  ): Promise<ProjectAssetHostResult<ResolvedAsset[]>>;
  batch(
    input: ProjectAssetHostScope & { assetIds: readonly string[] },
  ): Promise<ProjectAssetHostResult<ResolvedAsset[]>>;
  get(
    input: ProjectAssetHostScope & {
      assetId: string;
    },
  ): Promise<ProjectAssetHostObservation<ResolvedAsset>>;
  references(
    input: ProjectAssetHostScope & {
      assetId: string;
    },
  ): Promise<ProjectAssetHostObservation<ActionAssetBinding[]>>;
  importFile(
    input: ProjectAssetHostScope & {
      bytes: Uint8Array;
      fileName: string;
      contentType: string;
      kind: AssetKind;
    },
  ): Promise<ProjectAssetHostResult<ResolvedAsset>>;
  admit(
    input: ProjectAssetHostScope & {
      globalAssetId: string;
    },
  ): Promise<ProjectAssetHostResult<ResolvedAsset>>;
  trash(
    input: ProjectAssetHostScope & {
      assetId: string;
      actorClientType?: string;
      receipt?: string;
    },
  ): Promise<ProjectAssetHostObservation<ResolvedAsset>>;
  restore(
    input: ProjectAssetHostScope & {
      assetId: string;
      actorClientType?: string;
      receipt?: string;
    },
  ): Promise<ProjectAssetHostObservation<ResolvedAsset>>;
};

export type PersonalGlobalAssetHostClient = {
  list(): Promise<ResolvedAsset[]>;
  get(input: { globalAssetId: string }): Promise<ResolvedAsset>;
  importFile(input: {
    bytes: Uint8Array;
    fileName: string;
    contentType: string;
    kind: AssetKind;
  }): Promise<ResolvedAsset>;
  publish(input: {
    projectId: string;
    projectAssetId: string;
  }): Promise<ResolvedAsset>;
};

type ProjectAssetHostClientOptions = {
  endpoint?: string;
  token?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  hostClient?: Pick<ProjectHostClient, "resolveConnection" | "resolveContext">;
  resolveConnection?: () => Promise<ProjectHostConnection>;
};

function createAssetHostConnectionResolver(
  options: ProjectAssetHostClientOptions,
): () => Promise<ProjectHostConnection> {
  const env = options.env ?? process.env;
  return async () => {
    if (options.hostClient?.resolveConnection) {
      return options.hostClient.resolveConnection();
    }
    if (options.resolveConnection) return options.resolveConnection();
    return {
      endpoint:
        options.endpoint?.trim() ||
        env.CLASH_API_URL?.trim() ||
        "http://127.0.0.1:8789",
      ...(options.token?.trim() || env.CLASH_API_KEY?.trim()
        ? { token: options.token?.trim() || env.CLASH_API_KEY?.trim() }
        : {}),
    };
  };
}

export function createProjectAssetHostClient(
  options: ProjectAssetHostClientOptions = {},
): ProjectAssetHostClient {
  const env = options.env ?? process.env;
  const connection = createAssetHostConnectionResolver(options);
  const context = (input: ProjectAssetHostScope = {}) =>
    options.hostClient
      ? options.hostClient.resolveContext(input)
      : resolveProjectHostContext({
          cwd: input.cwd,
          projectId: input.projectId,
          env,
        });
  const http = createProjectAssetHttpClient({
    fetch: options.fetch,
    resolveConnection: connection,
    createHttpError: (status, body) => new ProjectHostHttpError(status, body),
  });
  const result = <T>(
    resolved: ResolvedProjectHostContext,
    value: T,
  ): ProjectAssetHostResult<T> => ({
    projectId: resolved.projectId,
    ...(resolved.workspaceRoot
      ? { workspaceRoot: resolved.workspaceRoot }
      : {}),
    value,
  });

  return {
    resolveContext: context,
    async list(input = {}) {
      const resolved = await context(input);
      return result(
        resolved,
        await http.list({ projectId: resolved.projectId }),
      );
    },
    async batch(input) {
      const resolved = await context(input);
      return result(
        resolved,
        await http.batch({
          projectId: resolved.projectId,
          assetIds: input.assetIds,
        }),
      );
    },
    async get(input) {
      const resolved = await context(input);
      const observed = await http.get({
        projectId: resolved.projectId,
        assetId: input.assetId,
      });
      return {
        ...result(resolved, observed.value),
        receipt: observed.receipt,
      };
    },
    async references(input) {
      const resolved = await context(input);
      const observed = await http.references({
        projectId: resolved.projectId,
        assetId: input.assetId,
      });
      return {
        ...result(resolved, observed.value),
        receipt: observed.receipt,
      };
    },
    async importFile(input) {
      const resolved = await context(input);
      const bytes = input.bytes.slice().buffer as ArrayBuffer;
      return result(
        resolved,
        await http.importFile({
          projectId: resolved.projectId,
          file: new Blob([bytes], { type: input.contentType }),
          fileName: input.fileName,
          kind: input.kind,
        }),
      );
    },
    async admit(input) {
      const resolved = await context(input);
      return result(
        resolved,
        await http.admit({
          projectId: resolved.projectId,
          globalAssetId: input.globalAssetId,
        }),
      );
    },
    async trash(input) {
      const resolved = await context(input);
      const observed = await http.trash({
        projectId: resolved.projectId,
        assetId: input.assetId,
        actorClientType: input.actorClientType,
        receipt: input.receipt,
      });
      return {
        ...result(resolved, observed.value),
        receipt: observed.receipt,
      };
    },
    async restore(input) {
      const resolved = await context(input);
      const observed = await http.restore({
        projectId: resolved.projectId,
        assetId: input.assetId,
        actorClientType: input.actorClientType,
        receipt: input.receipt,
      });
      return {
        ...result(resolved, observed.value),
        receipt: observed.receipt,
      };
    },
  };
}

export function createPersonalGlobalAssetHostClient(
  options: ProjectAssetHostClientOptions = {},
): PersonalGlobalAssetHostClient {
  const connection = createAssetHostConnectionResolver(options);
  const http = createPersonalGlobalAssetHttpClient({
    fetch: options.fetch,
    resolveConnection: connection,
    createHttpError: (status, body) => new ProjectHostHttpError(status, body),
  });

  return {
    list: () => http.list(),
    get: (input) => http.get(input),
    async importFile(input) {
      const bytes = input.bytes.slice().buffer as ArrayBuffer;
      return http.importFile({
        file: new Blob([bytes], { type: input.contentType }),
        fileName: input.fileName,
        kind: input.kind,
      });
    },
    publish: (input) => http.publish(input),
  };
}
