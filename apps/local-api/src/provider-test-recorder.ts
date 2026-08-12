import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  listProviderModelSupport,
  type ModelKind,
  type ProviderCredentialRequirements,
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
  credentialRequirements?: ProviderCredentialRequirements;
  requiredOAuth: string[];
  input: ProviderConformanceInput;
}

export type ProviderTestRecordingPayload =
  | null
  | string
  | number
  | boolean
  | ProviderTestRecordingBinaryPayload
  | ProviderTestRecordingPayload[]
  | { [key: string]: ProviderTestRecordingPayload };

interface ProviderTestRecordingBinaryPayload {
  $binary: {
    encoding: "base64";
    data: string;
    byteLength: number;
  };
}

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

export function createProviderConformanceStubs(
  options: { includeMock?: boolean } = {},
): ProviderConformanceStub[] {
  const supports = listProviderModelSupport({
    includeMock: options.includeMock ?? false,
  });
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
        requiredCredentials: [
          ...(model.requiredCredentials ?? support.requiredCredentials ?? []),
        ],
        ...(model.credentialRequirements
          ? {
              credentialRequirements: {
                ...model.credentialRequirements,
                anyOf: model.credentialRequirements.anyOf.map((credentials) => [
                  ...credentials,
                ]),
              },
            }
          : {}),
        requiredOAuth: [
          ...(model.requiredOAuth ?? support.requiredOAuth ?? []),
        ],
        input: providerConformanceInputForModel(
          model.kind,
          model.id,
          model.name,
        ),
      } satisfies ProviderConformanceStub;
    }),
  );
}

export function providerTestRecordingEventToJsonl(event: unknown): string {
  // Normalize again at the serialization boundary so manually assembled fixtures and older live
  // captures receive the current redaction rules. Do it by transport field: recursively guessing
  // whether every string is JSON turns HTTP headers and legitimate text outputs into numbers or
  // booleans, corrupting an otherwise valid cassette.
  return `${JSON.stringify(normalizeRecordingEvent(event))}\n`;
}

export function createProviderTestRecorder(options: {
  write: (event: ProviderTestRecordingEvent) => Promise<void> | void;
  now?: () => Date;
  requestId?: () => string;
}): ProviderTestRecorder {
  const now = options.now ?? (() => new Date());
  const nextRequestId =
    options.requestId ?? (() => `provider-test-${crypto.randomUUID()}`);
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
          url: normalizeHttpUrlForRecording(input.url) ?? input.url,
          method: input.method,
          headers: normalizeHeaders(input.headers),
          ...(input.body === undefined
            ? {}
            : { body: normalizeTransportPayload(input.body) }),
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
          ...(input.body === undefined
            ? {}
            : { body: normalizeTransportPayload(input.body) }),
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
          url: normalizeHttpUrlForRecording(input.url) ?? input.url,
          method: input.method,
          headers: normalizeHeaders(input.headers),
          ...(input.body === undefined
            ? {}
            : { body: normalizeTransportPayload(input.body) }),
        },
      });
    },
  };
}

export async function createJsonlProviderTestRecorder(
  filePath: string,
): Promise<ProviderTestRecorder> {
  await mkdir(dirname(filePath), { recursive: true });
  let writeQueue: Promise<void> = Promise.resolve();
  return createProviderTestRecorder({
    write: (event) => {
      const write = writeQueue.then(() =>
        appendFile(filePath, providerTestRecordingEventToJsonl(event), "utf8"),
      );
      writeQueue = write.catch(() => undefined);
      return write;
    },
  });
}

export function createProviderTestRecordingFetch(options: {
  fetch: typeof fetch;
  recorder: ProviderTestRecorder;
  stub: ProviderConformanceStub;
}): typeof fetch {
  return (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
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

export async function readJsonlProviderTestRecording(
  filePath: string,
): Promise<ProviderTestRecordingEvent[]> {
  const raw = await readFile(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const events: ProviderTestRecordingEvent[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      events.push(parseProviderTestRecordingEvent(line, index + 1));
    } catch (error) {
      const interruptedTail = index === lines.length - 1 && !/\r?\n$/.test(raw);
      if (interruptedTail) break;
      throw error;
    }
  }
  return events;
}

export function createProviderTestReplayFixtures(
  events: readonly ProviderTestRecordingEvent[],
): ProviderTestReplayFixture[] {
  const byRequestId = new Map<
    string,
    {
      request?: ProviderTestRecordingRequestEvent;
      response?: ProviderTestRecordingResponseEvent;
      callbacks: ProviderTestRecordingCallbackEvent[];
    }
  >();

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
      throw new Error(
        `Provider test recording ${requestId} is missing request event`,
      );
    }
    if (!row.response) {
      throw new Error(
        `Provider test recording ${requestId} is missing response event`,
      );
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

export function createProviderTestReplayFetch(
  fixtures: readonly ProviderTestReplayFixture[],
): typeof fetch {
  const pending = [...fixtures];
  return (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = await providerTestFetchRequest(input, init);
    const index = pending.findIndex((fixture) =>
      providerTestReplayFixtureMatches(fixture, request),
    );
    if (index < 0) {
      throw new Error(
        `No provider test replay fixture for ${request.method} ${request.url}`,
      );
    }
    const [fixture] = pending.splice(index, 1);
    if (!fixture)
      throw new Error(
        `No provider test replay fixture for ${request.method} ${request.url}`,
      );
    if (fixture.response.status === 0) {
      throw new Error(providerTestReplayErrorMessage(fixture.response.body));
    }
    return new Response(providerTestReplayResponseBody(fixture.response.body), {
      status: fixture.response.status,
      headers: providerTestReplayHeaders(fixture.response.headers),
    });
  }) as typeof fetch;
}

function providerTestReplayHeaders(
  recorded: Record<string, string>,
): Headers {
  const headers = new Headers(recorded);
  // Fetch has already decoded the body before the recorder reads it. Replaying those decoded bytes
  // with the upstream compression framing makes Undici try to decode them a second time, which
  // aborts the body as `terminated`. Length and transfer framing describe the original wire body,
  // not the normalized cassette payload, so the replay transport must calculate them itself.
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return headers;
}

/**
 * Lazily opens one replay file and preserves its consumed-fixture state across requests.
 * A replay fixture list is ordered, consumable state shared by every intercepted HTTP call;
 * rebuilding the replay function per call would incorrectly make the first matching fixture
 * reusable forever.
 */
export function createProviderTestReplayFetchFromPath(
  filePath: string,
): typeof fetch {
  let replay: Promise<typeof fetch> | undefined;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    replay ??= readJsonlProviderTestRecording(filePath)
      .then(createProviderTestReplayFixtures)
      .then(createProviderTestReplayFetch);
    return (await replay)(input, init);
  }) as typeof fetch;
}

export async function replayProviderTestCallbacks(
  fixtures: readonly ProviderTestReplayFixture[],
  handler: typeof fetch,
): Promise<Response[]> {
  const responses: Response[] = [];
  for (const fixture of fixtures) {
    for (const callback of fixture.callbacks) {
      responses.push(
        await handler(callback.url, {
          method: callback.method,
          headers: callback.headers,
          ...(callback.body === undefined
            ? {}
            : { body: providerTestReplayResponseBody(callback.body) }),
        }),
      );
    }
  }
  return responses;
}

function providerConformanceInputForModel(
  shape: ModelKind,
  model: string,
  modelName: string,
): ProviderConformanceInput {
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

function normalizeHeaders(
  headers: HeadersInit | Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {};
  const entries: [string, string][] = [];
  if (headers instanceof Headers) {
    headers.forEach((value, key) => entries.push([key, value]));
  } else if (Array.isArray(headers)) {
    entries.push(
      ...headers.map(
        ([key, value]) => [key, String(value)] as [string, string],
      ),
    );
  } else {
    entries.push(...Object.entries(headers));
  }
  return Object.fromEntries(
    entries.map(([key, value]) => [
      key,
      shouldRedactKey(key)
        ? "[redacted]"
        : key.toLowerCase() === "content-type" && /^multipart\/form-data\b/i.test(String(value))
          ? "multipart/form-data"
          : String(value),
    ]),
  );
}

function normalizePayload(value: unknown): ProviderTestRecordingPayload {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "string") {
      const url = normalizeHttpUrlForRecording(value);
      return url ?? normalizeGoogleProjectResource(value);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizePayload(item));
  if (value instanceof URLSearchParams) {
    return normalizePayload(Object.fromEntries(value.entries()));
  }
  if (value instanceof ArrayBuffer) {
    return normalizeBinaryPayload(new Uint8Array(value));
  }
  if (ArrayBuffer.isView(value)) {
    return normalizeBinaryPayload(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
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

/** Parse only a transport's top-level body envelope; nested strings are provider data. */
function normalizeTransportPayload(
  value: unknown,
): ProviderTestRecordingPayload {
  if (typeof value !== "string") return normalizePayload(value);
  try {
    return normalizePayload(JSON.parse(value));
  } catch {
    return normalizeUrlEncodedPayload(value) ?? normalizePayload(value);
  }
}

function normalizeRecordingEvent(event: unknown): unknown {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return normalizePayload(event);
  }
  const record = event as Record<string, unknown>;
  if (record.type === "request") {
    return {
      ...record,
      request: normalizeRecordingRequestLike(record.request),
    };
  }
  if (record.type === "response") {
    const response = isObjectRecord(record.response) ? record.response : {};
    return {
      ...record,
      response: {
        ...response,
        headers: normalizeHeaders(recordingHeaders(response.headers)),
        ...(response.body === undefined
          ? {}
          : { body: normalizeTransportPayload(response.body) }),
      },
    };
  }
  if (record.type === "callback") {
    return {
      ...record,
      callback: normalizeRecordingRequestLike(record.callback),
    };
  }
  return normalizePayload(event);
}

function normalizeRecordingRequestLike(
  value: unknown,
): Record<string, unknown> {
  const request = isObjectRecord(value) ? value : {};
  const rawUrl =
    typeof request.url === "string" ? request.url : String(request.url ?? "");
  return {
    ...request,
    url: normalizeHttpUrlForRecording(rawUrl) ?? rawUrl,
    method:
      typeof request.method === "string"
        ? request.method
        : String(request.method ?? ""),
    headers: normalizeHeaders(recordingHeaders(request.headers)),
    ...(request.body === undefined
      ? {}
      : { body: normalizeTransportPayload(request.body) }),
  };
}

function recordingHeaders(value: unknown): Record<string, string> {
  if (!isObjectRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, String(item)]),
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeUrlEncodedPayload(
  value: string,
): ProviderTestRecordingPayload | null {
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
  // These are schema metadata containing credential *field names* (for example `apiKey`), never
  // credential values. Redacting them at the final JSONL boundary corrupts the conformance stub
  // and makes the recording impossible to load again.
  if (key === "requiredCredentials" || key === "credentialRequirements")
    return false;
  return (
    /authorization|api[-_]?key|access[-_]?key|private[-_]?key|secret|token|password|assertion|cookie|signature|credential/i.test(
      key,
    ) || /^key$/i.test(key)
  );
}

function normalizeHttpUrlForRecording(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.password) url.password = "[redacted]";
    url.pathname = normalizeGoogleProjectResource(url.pathname);
    for (const key of [...url.searchParams.keys()]) {
      if (shouldRedactKey(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeGoogleProjectResource(value: string): string {
  return value.replace(
    /projects\/[^/?#]+\/locations\//g,
    "projects/PROJECT_ID/locations/",
  );
}

/**
 * Convert any Fetch request into a stable cassette key.
 *
 * Native FormData chooses a fresh multipart boundary on every call. Recording the raw wire body
 * would therefore make an identical upload miss replay. Multipart is stored semantically instead:
 * ordered fields plus each file's public metadata and SHA-256. The plugin still sends the untouched
 * native request to the provider.
 */
export async function providerTestFetchRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}> {
  const request = new Request(input, init);
  const headers = normalizeHeaders(request.headers);
  const body = await providerTestRequestBody(request);
  return {
    url: request.url,
    method: request.method,
    headers,
    ...(body === undefined ? {} : { body }),
  };
}

async function providerTestRequestBody(request: Request): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD" || !request.body) {
    return undefined;
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (/^multipart\/form-data\b/i.test(contentType)) {
    const entries: ProviderTestRecordingPayload[] = [];
    const formEntries: Array<[string, FormDataEntryValue]> = [];
    (await request.clone().formData()).forEach((value, name) => {
      formEntries.push([name, value]);
    });
    for (const [name, value] of formEntries) {
      if (typeof value === "string") {
        entries.push({
          name,
          value: shouldRedactKey(name) ? "[redacted]" : value,
        });
        continue;
      }
      const bytes = new Uint8Array(await value.arrayBuffer());
      entries.push({
        name,
        file: shouldRedactKey(name)
          ? "[redacted]"
          : {
              name: value.name,
              type: value.type || "application/octet-stream",
              byteLength: bytes.byteLength,
              sha256: createHash("sha256").update(bytes).digest("hex"),
            },
      });
    }
    return { $multipart: entries };
  }
  if (/json|text|xml|javascript|x-www-form-urlencoded/i.test(contentType)) {
    return request.clone().text();
  }
  return request.clone().arrayBuffer();
}

export async function providerTestFetchResponseBody(
  response: Response,
): Promise<unknown> {
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

function parseProviderTestRecordingEvent(
  line: string,
  lineNumber: number,
): ProviderTestRecordingEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    throw new Error(
      `Invalid provider test recording JSONL at line ${lineNumber}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isProviderTestRecordingEvent(parsed)) {
    throw new Error(
      `Invalid provider test recording event at line ${lineNumber}`,
    );
  }
  return parsed;
}

function isProviderTestRecordingEvent(
  value: unknown,
): value is ProviderTestRecordingEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (event.schemaVersion !== PROVIDER_TEST_RECORDING_SCHEMA_VERSION)
    return false;
  if (
    typeof event.timestamp !== "string" ||
    typeof event.requestId !== "string"
  )
    return false;
  if (event.type === "request") {
    return (
      isProviderConformanceStub(event.stub) && isRequestLike(event.request)
    );
  }
  if (event.type === "response") {
    const response = event.response as Record<string, unknown> | undefined;
    return (
      !!response &&
      typeof response.status === "number" &&
      isHeadersLike(response.headers)
    );
  }
  if (event.type === "callback") {
    return isRequestLike(event.callback);
  }
  return false;
}

function isProviderConformanceStub(
  value: unknown,
): value is ProviderConformanceStub {
  if (!value || typeof value !== "object") return false;
  const stub = value as Record<string, unknown>;
  return (
    typeof stub.id === "string" &&
    typeof stub.providerId === "string" &&
    typeof stub.modelId === "string" &&
    typeof stub.modelName === "string" &&
    typeof stub.shape === "string" &&
    typeof stub.apiShape === "string" &&
    Array.isArray(stub.requiredCredentials) &&
    Array.isArray(stub.requiredOAuth) &&
    !!stub.input &&
    typeof stub.input === "object"
  );
}

function isRequestLike(value: unknown): value is {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: ProviderTestRecordingPayload;
} {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.url === "string" &&
    typeof request.method === "string" &&
    isHeadersLike(request.headers)
  );
}

function isHeadersLike(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (item) => typeof item === "string",
  );
}

function providerTestReplayFixtureMatches(
  fixture: ProviderTestReplayFixture,
  request: { url: string; method: string; body?: unknown },
): boolean {
  const fixtureUrl =
    normalizeHttpUrlForRecording(fixture.request.url) ?? fixture.request.url;
  const requestUrl = normalizeHttpUrlForRecording(request.url) ?? request.url;
  if (fixtureUrl !== requestUrl) return false;
  if (fixture.request.method.toUpperCase() !== request.method.toUpperCase())
    return false;
  if (!("body" in fixture.request)) return true;
  return (
    providerTestPayloadKey(fixture.request.body) ===
    providerTestPayloadKey(request.body)
  );
}

function providerTestPayloadKey(value: unknown): string {
  return JSON.stringify(
    normalizeReplayComparablePayload(normalizeTransportPayload(value)),
  );
}

function normalizeReplayComparablePayload(
  value: ProviderTestRecordingPayload,
): ProviderTestRecordingPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const body = value as Record<string, ProviderTestRecordingPayload>;
  const generationConfig = body.generationConfig;
  if (
    !generationConfig ||
    typeof generationConfig !== "object" ||
    Array.isArray(generationConfig)
  ) {
    return value;
  }
  const config = generationConfig as Record<
    string,
    ProviderTestRecordingPayload
  >;
  const responseModalities = config.responseModalities;
  const hasImageOutput =
    Array.isArray(responseModalities) &&
    responseModalities.some(
      (item) => typeof item === "string" && item.toUpperCase() === "IMAGE",
    );
  if (!hasImageOutput || config.imageConfig !== undefined) return value;

  return {
    ...body,
    generationConfig: {
      ...config,
      imageConfig: { aspectRatio: "16:9" },
    },
  };
}

function providerTestReplayResponseBody(
  body: ProviderTestRecordingPayload | undefined,
): BodyInit | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  if (typeof body === "number" || typeof body === "boolean")
    return String(body);
  if (isProviderTestRecordingBinaryPayload(body)) {
    return Uint8Array.from(
      Buffer.from(body.$binary.data, body.$binary.encoding),
    );
  }
  return JSON.stringify(body);
}

function normalizeBinaryPayload(
  value: Uint8Array,
): ProviderTestRecordingBinaryPayload {
  return {
    $binary: {
      encoding: "base64",
      data: Buffer.from(value).toString("base64"),
      byteLength: value.byteLength,
    },
  };
}

function isProviderTestRecordingBinaryPayload(
  value: ProviderTestRecordingPayload,
): value is ProviderTestRecordingBinaryPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const binary = (value as Record<string, unknown>).$binary;
  if (!binary || typeof binary !== "object" || Array.isArray(binary))
    return false;
  const fields = binary as Record<string, unknown>;
  return (
    fields.encoding === "base64" &&
    typeof fields.data === "string" &&
    typeof fields.byteLength === "number"
  );
}

function providerTestReplayErrorMessage(
  body: ProviderTestRecordingPayload | undefined,
): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const error = (body as Record<string, ProviderTestRecordingPayload>).error;
    if (typeof error === "string") return error;
  }
  return "Provider test replay fixture recorded a fetch failure";
}
