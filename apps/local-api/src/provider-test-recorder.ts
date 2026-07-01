import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  listProviderModelSupport,
  type ModelKind,
} from "@clash/shared-types";

const PROVIDER_TEST_RECORDING_SCHEMA_VERSION = 1;

export interface ProviderConformanceInput {
  shape: ModelKind;
  model: string;
  prompt: string;
  aspectRatio?: string;
  duration?: number;
}

export interface ProviderConformanceStub {
  id: string;
  providerId: string;
  upstreamId?: string;
  region?: string;
  modelId: string;
  modelName: string;
  shape: ModelKind;
  apiShape: string;
  requiredCredentials: string[];
  requiredOAuth: string[];
  input: ProviderConformanceInput;
}

export type ProviderTestRecordingPayload =
  | null
  | string
  | number
  | boolean
  | ProviderTestRecordingPayload[]
  | { [key: string]: ProviderTestRecordingPayload };

export interface ProviderTestRecordingRequestEvent {
  schemaVersion: typeof PROVIDER_TEST_RECORDING_SCHEMA_VERSION;
  type: "request";
  timestamp: string;
  requestId: string;
  stub: ProviderConformanceStub;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: ProviderTestRecordingPayload;
  };
}

export interface ProviderTestRecordingResponseEvent {
  schemaVersion: typeof PROVIDER_TEST_RECORDING_SCHEMA_VERSION;
  type: "response";
  timestamp: string;
  requestId: string;
  response: {
    status: number;
    headers: Record<string, string>;
    body?: ProviderTestRecordingPayload;
  };
}

export interface ProviderTestRecordingCallbackEvent {
  schemaVersion: typeof PROVIDER_TEST_RECORDING_SCHEMA_VERSION;
  type: "callback";
  timestamp: string;
  requestId: string;
  callback: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: ProviderTestRecordingPayload;
  };
}

export type ProviderTestRecordingEvent =
  | ProviderTestRecordingRequestEvent
  | ProviderTestRecordingResponseEvent
  | ProviderTestRecordingCallbackEvent;

export interface ProviderTestRecorder {
  recordRequest(input: {
    stub: ProviderConformanceStub;
    url: string;
    method: string;
    headers?: HeadersInit | Record<string, string>;
    body?: unknown;
  }): Promise<string>;
  recordResponse(input: {
    requestId: string;
    status: number;
    headers?: HeadersInit | Record<string, string>;
    body?: unknown;
  }): Promise<void>;
  recordCallback(input: {
    requestId: string;
    url: string;
    method: string;
    headers?: HeadersInit | Record<string, string>;
    body?: unknown;
  }): Promise<void>;
}

export function createProviderConformanceStubs(options: { includeMock?: boolean } = {}): ProviderConformanceStub[] {
  const supports = listProviderModelSupport({ includeMock: options.includeMock ?? false });
  return supports.flatMap((support) =>
    support.models.map((model) => {
      const upstreamId = support.upstreamId ?? support.providerId;
      const id = [
        support.providerId,
        upstreamId,
        support.region ?? "",
        model.id,
      ].join(":");
      return {
        id,
        providerId: support.providerId,
        upstreamId,
        ...(support.region ? { region: support.region } : {}),
        modelId: model.id,
        modelName: model.name,
        shape: model.kind,
        apiShape: model.apiShape,
        requiredCredentials: [...(model.requiredCredentials ?? support.requiredCredentials ?? [])],
        requiredOAuth: [...(model.requiredOAuth ?? support.requiredOAuth ?? [])],
        input: providerConformanceInputForModel(model.kind, model.id, model.name),
      } satisfies ProviderConformanceStub;
    })
  );
}

export function providerTestRecordingEventToJsonl(event: unknown): string {
  return `${JSON.stringify(event)}\n`;
}

export function createProviderTestRecorder(options: {
  write: (event: ProviderTestRecordingEvent) => Promise<void> | void;
  now?: () => Date;
  requestId?: () => string;
}): ProviderTestRecorder {
  const now = options.now ?? (() => new Date());
  const nextRequestId = options.requestId ?? (() => `provider-test-${crypto.randomUUID()}`);
  const write = async (event: ProviderTestRecordingEvent) => {
    await options.write(event);
  };

  return {
    async recordRequest(input) {
      const requestId = nextRequestId();
      await write({
        schemaVersion: PROVIDER_TEST_RECORDING_SCHEMA_VERSION,
        type: "request",
        timestamp: now().toISOString(),
        requestId,
        stub: input.stub,
        request: {
          url: input.url,
          method: input.method,
          headers: normalizeHeaders(input.headers),
          ...(input.body === undefined ? {} : { body: normalizePayload(input.body) }),
        },
      });
      return requestId;
    },
    async recordResponse(input) {
      await write({
        schemaVersion: PROVIDER_TEST_RECORDING_SCHEMA_VERSION,
        type: "response",
        timestamp: now().toISOString(),
        requestId: input.requestId,
        response: {
          status: input.status,
          headers: normalizeHeaders(input.headers),
          ...(input.body === undefined ? {} : { body: normalizePayload(input.body) }),
        },
      });
    },
    async recordCallback(input) {
      await write({
        schemaVersion: PROVIDER_TEST_RECORDING_SCHEMA_VERSION,
        type: "callback",
        timestamp: now().toISOString(),
        requestId: input.requestId,
        callback: {
          url: input.url,
          method: input.method,
          headers: normalizeHeaders(input.headers),
          ...(input.body === undefined ? {} : { body: normalizePayload(input.body) }),
        },
      });
    },
  };
}

export async function createJsonlProviderTestRecorder(filePath: string): Promise<ProviderTestRecorder> {
  await mkdir(dirname(filePath), { recursive: true });
  return createProviderTestRecorder({
    write: async (event) => {
      await appendFile(filePath, providerTestRecordingEventToJsonl(event), "utf8");
    },
  });
}

function providerConformanceInputForModel(shape: ModelKind, model: string, modelName: string): ProviderConformanceInput {
  const prompt = `Provider conformance test for ${modelName}`;
  return {
    shape,
    model,
    prompt,
    ...(shape === "image" || shape === "video" ? { aspectRatio: "16:9" } : {}),
    ...(shape === "video" ? { duration: 4 } : {}),
    ...(shape === "audio" ? { duration: 5 } : {}),
  };
}

function normalizeHeaders(headers: HeadersInit | Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  const entries: [string, string][] = [];
  if (headers instanceof Headers) {
    headers.forEach((value, key) => entries.push([key, value]));
  } else if (Array.isArray(headers)) {
    entries.push(...headers.map(([key, value]) => [key, String(value)] as [string, string]));
  } else {
    entries.push(...Object.entries(headers));
  }
  return Object.fromEntries(entries.map(([key, value]) => [
    key,
    shouldRedactKey(key) ? "[redacted]" : String(value),
  ]));
}

function normalizePayload(value: unknown): ProviderTestRecordingPayload {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "string") {
      try {
        return normalizePayload(JSON.parse(value));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizePayload(item));
  if (value instanceof URLSearchParams) {
    return normalizePayload(Object.fromEntries(value.entries()));
  }
  if (value instanceof ArrayBuffer) {
    return `[arrayBuffer:${value.byteLength}]`;
  }
  if (ArrayBuffer.isView(value)) {
    return `[arrayBuffer:${value.byteLength}]`;
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        shouldRedactKey(key) ? "[redacted]" : normalizePayload(item),
      ]),
    );
  }
  return String(value);
}

function shouldRedactKey(key: string): boolean {
  return /authorization|api[-_]?key|access[-_]?key|secret|token|password/i.test(key);
}
