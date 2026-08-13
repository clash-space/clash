import {
  PROJECT_ASSET_READ_RECEIPT_HEADER as SHARED_PROJECT_ASSET_READ_RECEIPT_HEADER,
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

type ProjectAssetHostClientOptions = {
  endpoint?: string;
  token?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  hostClient?: Pick<ProjectHostClient, "resolveConnection" | "resolveContext">;
  resolveConnection?: () => Promise<ProjectHostConnection>;
};

export function createProjectAssetHostClient(
  options: ProjectAssetHostClientOptions = {},
): ProjectAssetHostClient {
  const env = options.env ?? process.env;
  const connection = async (): Promise<ProjectHostConnection> => {
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
