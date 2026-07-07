import { appendFile, mkdir, readFile } from "node:fs/promises";
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

export interface ProviderTestReplayFixture {
  schemaVersion: typeof PROVIDER_TEST_RECORDING_SCHEMA_VERSION;
  requestId: string;
  stub: ProviderConformanceStub;
  request: ProviderTestRecordingRequestEvent["request"];
  response: ProviderTestRecordingResponseEvent["response"];
  callbacks: ProviderTestRecordingCallbackEvent["callback"][];
}

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

export function createProviderTestRecordingFetch(options: {
  fetch: typeof fetch;
  recorder: ProviderTestRecorder;
  stub: ProviderConformanceStub;
}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = await providerTestFetchRequest(input, init);
    const requestId = await options.recorder.recordRequest({
      stub: options.stub,
      url: request.url,
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    try {
      const response = await options.fetch(input, init);
      await options.recorder.recordResponse({
        requestId,
        status: response.status,
        headers: response.headers,
        body: await providerTestFetchResponseBody(response),
      });
      return response;
    } catch (err) {
      await options.recorder.recordResponse({
        requestId,
        status: 0,
        headers: {},
        body: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }) as typeof fetch;
}

export async function readJsonlProviderTestRecording(filePath: string): Promise<ProviderTestRecordingEvent[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseProviderTestRecordingEvent(line, index + 1));
}

export function createProviderTestReplayFixtures(events: readonly ProviderTestRecordingEvent[]): ProviderTestReplayFixture[] {
  const byRequestId = new Map<string, {
    request?: ProviderTestRecordingRequestEvent;
    response?: ProviderTestRecordingResponseEvent;
    callbacks: ProviderTestRecordingCallbackEvent[];
  }>();

  for (const event of events) {
    const row = byRequestId.get(event.requestId) ?? { callbacks: [] };
    if (event.type === "request") {
      row.request = event;
    } else if (event.type === "response") {
      row.response = event;
    } else {
      row.callbacks.push(event);
    }
    byRequestId.set(event.requestId, row);
  }

  return [...byRequestId.entries()].map(([requestId, row]) => {
    if (!row.request) {
      throw new Error(`Provider test recording ${requestId} is missing request event`);
    }
    if (!row.response) {
      throw new Error(`Provider test recording ${requestId} is missing response event`);
    }
    return {
      schemaVersion: PROVIDER_TEST_RECORDING_SCHEMA_VERSION,
      requestId,
      stub: row.request.stub,
      request: row.request.request,
      response: row.response.response,
      callbacks: row.callbacks.map((event) => event.callback),
    };
  });
}

export function filterProviderTestReplayFixturesForStub(
  fixtures: readonly ProviderTestReplayFixture[],
  stubId: string,
): ProviderTestReplayFixture[] {
  return fixtures.filter((fixture) => fixture.stub.id === stubId);
}

export function createProviderTestReplayFetch(fixtures: readonly ProviderTestReplayFixture[]): typeof fetch {
  const pending = [...fixtures];
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = await providerTestFetchRequest(input, init);
    const index = pending.findIndex((fixture) => providerTestReplayFixtureMatches(fixture, request));
    if (index < 0) {
      throw new Error(`No provider test replay fixture for ${request.method} ${request.url}`);
    }
    const [fixture] = pending.splice(index, 1);
    if (!fixture) throw new Error(`No provider test replay fixture for ${request.method} ${request.url}`);
    if (fixture.response.status === 0) {
      throw new Error(providerTestReplayErrorMessage(fixture.response.body));
    }
    return new Response(providerTestReplayResponseBody(fixture.response.body), {
      status: fixture.response.status,
      headers: fixture.response.headers,
    });
  }) as typeof fetch;
}

export async function replayProviderTestCallbacks(
  fixtures: readonly ProviderTestReplayFixture[],
  handler: typeof fetch,
): Promise<Response[]> {
  const responses: Response[] = [];
  for (const fixture of fixtures) {
    for (const callback of fixture.callbacks) {
      responses.push(await handler(callback.url, {
        method: callback.method,
        headers: callback.headers,
        ...(callback.body === undefined ? {} : { body: providerTestReplayResponseBody(callback.body) }),
      }));
    }
  }
  return responses;
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
        const formBody = normalizeUrlEncodedPayload(value);
        return formBody ?? value;
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

function normalizeUrlEncodedPayload(value: string): ProviderTestRecordingPayload | null {
  if (!value.includes("=") || !value.includes("&")) return null;
  try {
    const params = new URLSearchParams(value);
    const entries = [...params.entries()];
    if (!entries.length) return null;
    return normalizePayload(Object.fromEntries(entries));
  } catch {
    return null;
  }
}

function shouldRedactKey(key: string): boolean {
  return /authorization|api[-_]?key|access[-_]?key|private[-_]?key|secret|token|password|assertion/i.test(key);
}

async function providerTestFetchRequest(input: RequestInfo | URL, init?: RequestInit): Promise<{
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}> {
  const requestInput = input instanceof Request ? input : null;
  const headers = {
    ...normalizeHeaders(requestInput?.headers),
    ...normalizeHeaders(init?.headers),
  };
  const body = init?.body !== undefined
    ? init.body
    : requestInput && requestInput.method !== "GET" && requestInput.method !== "HEAD"
      ? await requestInput.clone().text()
      : undefined;
  return {
    url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    method: init?.method ?? requestInput?.method ?? "GET",
    headers,
    ...(body === undefined ? {} : { body }),
  };
}

async function providerTestFetchResponseBody(response: Response): Promise<unknown> {
  const clone = response.clone();
  const contentType = response.headers.get("content-type") ?? "";
  if (
    /json|text|xml|javascript|svg|event-stream/i.test(contentType) ||
    contentType.trim() === ""
  ) {
    return clone.text();
  }
  return clone.arrayBuffer();
}

function parseProviderTestRecordingEvent(line: string, lineNumber: number): ProviderTestRecordingEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    throw new Error(`Invalid provider test recording JSONL at line ${lineNumber}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isProviderTestRecordingEvent(parsed)) {
    throw new Error(`Invalid provider test recording event at line ${lineNumber}`);
  }
  return parsed;
}

function isProviderTestRecordingEvent(value: unknown): value is ProviderTestRecordingEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (event.schemaVersion !== PROVIDER_TEST_RECORDING_SCHEMA_VERSION) return false;
  if (typeof event.timestamp !== "string" || typeof event.requestId !== "string") return false;
  if (event.type === "request") {
    return isProviderConformanceStub(event.stub) && isRequestLike(event.request);
  }
  if (event.type === "response") {
    const response = event.response as Record<string, unknown> | undefined;
    return !!response && typeof response.status === "number" && isHeadersLike(response.headers);
  }
  if (event.type === "callback") {
    return isRequestLike(event.callback);
  }
  return false;
}

function isProviderConformanceStub(value: unknown): value is ProviderConformanceStub {
  if (!value || typeof value !== "object") return false;
  const stub = value as Record<string, unknown>;
  return typeof stub.id === "string" &&
    typeof stub.providerId === "string" &&
    typeof stub.modelId === "string" &&
    typeof stub.modelName === "string" &&
    typeof stub.shape === "string" &&
    typeof stub.apiShape === "string" &&
    Array.isArray(stub.requiredCredentials) &&
    Array.isArray(stub.requiredOAuth) &&
    !!stub.input &&
    typeof stub.input === "object";
}

function isRequestLike(value: unknown): value is { url: string; method: string; headers: Record<string, string>; body?: ProviderTestRecordingPayload } {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return typeof request.url === "string" &&
    typeof request.method === "string" &&
    isHeadersLike(request.headers);
}

function isHeadersLike(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
}

function providerTestReplayFixtureMatches(
  fixture: ProviderTestReplayFixture,
  request: { url: string; method: string; body?: unknown },
): boolean {
  if (fixture.request.url !== request.url) return false;
  if (fixture.request.method.toUpperCase() !== request.method.toUpperCase()) return false;
  if (!("body" in fixture.request)) return true;
  return providerTestPayloadKey(fixture.request.body) === providerTestPayloadKey(request.body);
}

function providerTestPayloadKey(value: unknown): string {
  return JSON.stringify(normalizeReplayComparablePayload(normalizePayload(value)));
}

function normalizeReplayComparablePayload(value: ProviderTestRecordingPayload): ProviderTestRecordingPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const body = value as Record<string, ProviderTestRecordingPayload>;
  const generationConfig = body.generationConfig;
  if (!generationConfig || typeof generationConfig !== "object" || Array.isArray(generationConfig)) {
    return value;
  }
  const config = generationConfig as Record<string, ProviderTestRecordingPayload>;
  const responseModalities = config.responseModalities;
  const hasImageOutput = Array.isArray(responseModalities) &&
    responseModalities.some((item) => typeof item === "string" && item.toUpperCase() === "IMAGE");
  if (!hasImageOutput || config.imageConfig !== undefined) return value;

  return {
    ...body,
    generationConfig: {
      ...config,
      imageConfig: { aspectRatio: "16:9" },
    },
  };
}

function providerTestReplayResponseBody(body: ProviderTestRecordingPayload | undefined): BodyInit | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  if (typeof body === "number" || typeof body === "boolean") return String(body);
  return JSON.stringify(body);
}

function providerTestReplayErrorMessage(body: ProviderTestRecordingPayload | undefined): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const error = body.error;
    if (typeof error === "string") return error;
  }
  return "Provider test replay fixture recorded a fetch failure";
}
