import {
  ActionAssetBindingSchema,
  ResolvedAssetSchema,
  type ActionAssetBinding,
  type AssetKind,
  type ResolvedAsset,
} from "@clash/shared-types";

export const PROJECT_ASSET_READ_RECEIPT_HEADER = "x-clash-read-receipt";

export interface ProjectAssetHttpConnection {
  endpoint: string;
  token?: string;
}

export interface ProjectAssetHttpScope {
  projectId: string;
}

export interface ProjectAssetHttpObservation<T> {
  value: T;
  receipt: string;
}

export interface ProjectAssetHttpClient {
  list(input: ProjectAssetHttpScope): Promise<ResolvedAsset[]>;
  batch(
    input: ProjectAssetHttpScope & { assetIds: readonly string[] },
  ): Promise<ResolvedAsset[]>;
  get(
    input: ProjectAssetHttpScope & { assetId: string },
  ): Promise<ProjectAssetHttpObservation<ResolvedAsset>>;
  references(
    input: ProjectAssetHttpScope & { assetId: string },
  ): Promise<ProjectAssetHttpObservation<ActionAssetBinding[]>>;
  importFile(
    input: ProjectAssetHttpScope & {
      file: Blob;
      fileName?: string;
      kind: AssetKind;
      projectAssetId?: string;
    },
  ): Promise<ResolvedAsset>;
  admit(
    input: ProjectAssetHttpScope & { globalAssetId: string },
  ): Promise<ResolvedAsset>;
  trash(
    input: ProjectAssetHttpScope & {
      assetId: string;
      actorClientType?: string;
      receipt?: string;
    },
  ): Promise<ProjectAssetHttpObservation<ResolvedAsset>>;
  restore(
    input: ProjectAssetHttpScope & {
      assetId: string;
      actorClientType?: string;
      receipt?: string;
    },
  ): Promise<ProjectAssetHttpObservation<ResolvedAsset>>;
}

export interface ProjectAssetHttpClientOptions {
  endpoint?: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
  resolveConnection?: () =>
    ProjectAssetHttpConnection | Promise<ProjectAssetHttpConnection>;
  createHttpError?: (status: number, body: unknown) => Error;
}

function cleanErrorField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export class ProjectAssetHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    const record =
      body !== null && typeof body === "object"
        ? (body as Record<string, unknown>)
        : undefined;
    const reason = [
      cleanErrorField(record?.code),
      cleanErrorField(record?.error),
    ]
      .filter(Boolean)
      .join(": ");
    super(
      reason
        ? `${reason} (Project Asset HTTP ${status})`
        : `Project Asset request failed with HTTP ${status}`,
    );
    this.name = "ProjectAssetHttpError";
  }
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function projectAssetsUrl(endpoint: string, projectId: string): string {
  return `${endpoint.trim().replace(/\/+$/, "")}/api/v1/projects/${encodeURIComponent(projectId)}/assets`;
}

function fileNameOf(file: Blob): string | undefined {
  return "name" in file && typeof file.name === "string"
    ? file.name
    : undefined;
}

export function createProjectAssetHttpClient(
  options: ProjectAssetHttpClientOptions = {},
): ProjectAssetHttpClient {
  const fetch = options.fetch ?? globalThis.fetch;
  const connection = async (): Promise<ProjectAssetHttpConnection> => {
    if (options.resolveConnection) return options.resolveConnection();
    return {
      endpoint: options.endpoint?.trim() ?? "",
      ...(options.token?.trim() ? { token: options.token.trim() } : {}),
    };
  };
  const target = async (projectIdInput: string, suffix = "") => {
    const projectId = required(projectIdInput, "project id");
    const connected = await connection();
    return {
      connected,
      url: `${projectAssetsUrl(connected.endpoint, projectId)}${suffix}`,
    };
  };
  const headers = (
    connected: ProjectAssetHttpConnection,
    additions: Record<string, string> = {},
  ): Record<string, string> => ({
    ...(connected.token ? { authorization: `Bearer ${connected.token}` } : {}),
    ...additions,
  });
  const requestInit = (input: RequestInit): RequestInit => ({
    ...input,
    ...(options.credentials === undefined
      ? {}
      : { credentials: options.credentials }),
  });
  const responseBody = async (response: Response): Promise<unknown> => {
    const body = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
      throw (
        options.createHttpError?.(response.status, body) ??
        new ProjectAssetHttpError(response.status, body)
      );
    }
    return body;
  };
  const receiptFrom = (response: Response): string => {
    const receipt = response.headers
      .get(PROJECT_ASSET_READ_RECEIPT_HEADER)
      ?.trim();
    if (!receipt)
      throw new Error("Project Asset Host read did not return a receipt");
    return receipt;
  };

  return {
    async list(input) {
      const { connected, url } = await target(input.projectId);
      const response = await fetch(
        url,
        requestInit({ method: "GET", headers: headers(connected) }),
      );
      const body = (await responseBody(response)) as { assets?: unknown };
      return ResolvedAssetSchema.array().parse(body.assets);
    },
    async batch(input) {
      const assetIds = input.assetIds.map((assetId) =>
        required(assetId, "asset id"),
      );
      const { connected, url } = await target(input.projectId, "/batch");
      const response = await fetch(
        url,
        requestInit({
          method: "POST",
          headers: headers(connected, { "content-type": "application/json" }),
          body: JSON.stringify({ ids: assetIds }),
        }),
      );
      const body = (await responseBody(response)) as { assets?: unknown };
      return ResolvedAssetSchema.array().parse(body.assets);
    },
    async get(input) {
      const assetId = required(input.assetId, "asset id");
      const { connected, url } = await target(
        input.projectId,
        `/${encodeURIComponent(assetId)}`,
      );
      const response = await fetch(
        url,
        requestInit({ method: "GET", headers: headers(connected) }),
      );
      const value = ResolvedAssetSchema.parse(await responseBody(response));
      return { value, receipt: receiptFrom(response) };
    },
    async references(input) {
      const assetId = required(input.assetId, "asset id");
      const { connected, url } = await target(
        input.projectId,
        `/${encodeURIComponent(assetId)}/references`,
      );
      const response = await fetch(
        url,
        requestInit({ method: "GET", headers: headers(connected) }),
      );
      const body = (await responseBody(response)) as {
        projectAssetId?: unknown;
        references?: unknown;
      };
      if (body.projectAssetId !== assetId) {
        throw new Error(
          "Project Asset Host returned references for a different Asset",
        );
      }
      return {
        value: ActionAssetBindingSchema.array().parse(body.references),
        receipt: receiptFrom(response),
      };
    },
    async importFile(input) {
      const projectAssetId = input.projectAssetId?.trim();
      const fileName = required(
        input.fileName ?? fileNameOf(input.file),
        "file name",
      );
      const { connected, url } = await target(input.projectId, "/import-file");
      const form = new FormData();
      if (input.fileName === undefined && fileNameOf(input.file) === fileName) {
        form.append("file", input.file);
      } else {
        form.append("file", input.file, fileName);
      }
      form.append("kind", input.kind);
      if (projectAssetId) form.append("projectAssetId", projectAssetId);
      const response = await fetch(
        url,
        requestInit({
          method: "POST",
          headers: headers(connected),
          body: form,
        }),
      );
      return ResolvedAssetSchema.parse(await responseBody(response));
    },
    async admit(input) {
      const globalAssetId = required(input.globalAssetId, "global asset id");
      const { connected, url } = await target(input.projectId, "/admit");
      const response = await fetch(
        url,
        requestInit({
          method: "POST",
          headers: headers(connected, { "content-type": "application/json" }),
          body: JSON.stringify({ globalAssetId }),
        }),
      );
      return ResolvedAssetSchema.parse(await responseBody(response));
    },
    async trash(input) {
      const assetId = required(input.assetId, "asset id");
      const actorClientType = input.actorClientType?.trim();
      const receipt = input.receipt?.trim();
      const { connected, url } = await target(
        input.projectId,
        `/${encodeURIComponent(assetId)}`,
      );
      const response = await fetch(
        url,
        requestInit({
          method: "DELETE",
          headers: headers(connected, {
            ...(actorClientType
              ? { "x-clash-client-type": actorClientType }
              : {}),
            ...(receipt ? { "x-clash-if-match": receipt } : {}),
          }),
        }),
      );
      const value = ResolvedAssetSchema.parse(await responseBody(response));
      return { value, receipt: receiptFrom(response) };
    },
    async restore(input) {
      const assetId = required(input.assetId, "asset id");
      const actorClientType = input.actorClientType?.trim();
      const receipt = input.receipt?.trim();
      const { connected, url } = await target(
        input.projectId,
        `/${encodeURIComponent(assetId)}/restore`,
      );
      const response = await fetch(
        url,
        requestInit({
          method: "POST",
          headers: headers(connected, {
            ...(actorClientType
              ? { "x-clash-client-type": actorClientType }
              : {}),
            ...(receipt ? { "x-clash-if-match": receipt } : {}),
          }),
        }),
      );
      const value = ResolvedAssetSchema.parse(await responseBody(response));
      return { value, receipt: receiptFrom(response) };
    },
  };
}
