import { readFile } from "node:fs/promises";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

import { HttpRequestInterceptor } from "@mswjs/interceptors/http";

import {
  createJsonlProviderTestRecorder,
  createProviderTestReplayFetchFromPath,
  providerTestFetchRequest,
  providerTestFetchResponseBody,
  type ProviderConformanceStub,
  type ProviderTestRecorder,
} from "./provider-test-recorder.js";

/**
 * Provider traffic instrumentation loaded outside a plugin with Node's `--import`.
 *
 * A plugin performs ordinary HTTP with whatever client it chooses. The test runner optionally
 * preloads this module into that process, so recording and replay never become a plugin API, an
 * ExecutorContext dependency, or a branch in provider business code.
 */

export interface ProviderHttpInstrumentationOptions {
  mode: "record" | "replay";
  trafficPath: string;
  /** JSON file rewritten by the harness before each live case begins. */
  activeStubPath?: string;
  /** Test-only escape hatch for exercising the interceptor against a loopback server. */
  includeLoopback?: boolean;
}

export interface ProviderHttpInstrumentation {
  dispose(): void;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function observes(url: string, includeLoopback: boolean): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (includeLoopback || !isLoopback(parsed.hostname))
    );
  } catch {
    return false;
  }
}

function fetchDecodedHeaders(headers: Headers): Headers {
  const decoded = new Headers(headers);
  decoded.delete("content-encoding");
  decoded.delete("content-length");
  decoded.delete("transfer-encoding");
  return decoded;
}

async function fetchDecodedResponseBody(response: Response): Promise<unknown> {
  const encodings = (response.headers.get("content-encoding") ?? "")
    .split(",")
    .map((encoding) => encoding.trim().toLowerCase())
    .filter(Boolean);
  if (encodings.length === 0) return providerTestFetchResponseBody(response);

  let bytes = Buffer.from(await response.clone().arrayBuffer());
  for (const encoding of encodings.reverse()) {
    if (encoding === "gzip" || encoding === "x-gzip") {
      bytes = gunzipSync(bytes);
    } else if (encoding === "deflate") {
      bytes = inflateSync(bytes);
    } else if (encoding === "br") {
      bytes = brotliDecompressSync(bytes);
    } else if (encoding !== "identity") {
      throw new Error(
        `Unsupported provider response content encoding: ${encoding}`,
      );
    }
  }

  const decoded = new Response(bytes, {
    status: response.status,
    statusText: response.statusText,
    headers: fetchDecodedHeaders(response.headers),
  });
  return providerTestFetchResponseBody(decoded);
}

async function activeStub(
  path: string | undefined,
): Promise<ProviderConformanceStub> {
  if (!path) {
    throw new Error("Provider traffic recording requires an active stub path.");
  }
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { id?: unknown }).id !== "string"
  ) {
    throw new Error(`Provider traffic active stub is invalid: ${path}`);
  }
  return parsed as ProviderConformanceStub;
}

export async function startProviderHttpInstrumentation(
  options: ProviderHttpInstrumentationOptions,
): Promise<ProviderHttpInstrumentation> {
  const interceptor = new HttpRequestInterceptor();
  const replayFetch =
    options.mode === "replay"
      ? createProviderTestReplayFetchFromPath(options.trafficPath)
      : undefined;
  let recorder: ProviderTestRecorder | undefined;
  const recorderRequestIds = new Map<string, string>();

  interceptor.on("request", async ({ request, requestId, controller }) => {
    if (!observes(request.url, options.includeLoopback ?? false)) return;
    if (replayFetch) {
      try {
        controller.respondWith(await replayFetch(request.clone()));
      } catch (error) {
        controller.errorWith(error);
      }
      return;
    }

    recorder ??= await createJsonlProviderTestRecorder(options.trafficPath);
    const normalized = await providerTestFetchRequest(request.clone());
    const recorderRequestId = await recorder.recordRequest({
      stub: await activeStub(options.activeStubPath),
      url: normalized.url,
      method: normalized.method,
      headers: normalized.headers,
      ...(normalized.body === undefined ? {} : { body: normalized.body }),
    });
    recorderRequestIds.set(requestId, recorderRequestId);
  });

  interceptor.on("response", async ({ response, requestId }) => {
    if (!recorder) return;
    const recorderRequestId = recorderRequestIds.get(requestId);
    if (!recorderRequestId) return;
    recorderRequestIds.delete(requestId);
    await recorder.recordResponse({
      requestId: recorderRequestId,
      status: response.status,
      headers: fetchDecodedHeaders(response.headers),
      body: await fetchDecodedResponseBody(response),
    });
  });

  interceptor.on("unhandledException", async ({ error, requestId }) => {
    if (!recorder) return;
    const recorderRequestId = recorderRequestIds.get(requestId);
    if (!recorderRequestId) return;
    recorderRequestIds.delete(requestId);
    await recorder.recordResponse({
      requestId: recorderRequestId,
      status: 0,
      headers: {},
      body: { error: error instanceof Error ? error.message : String(error) },
    });
  });

  interceptor.apply();
  return { dispose: () => interceptor.dispose() };
}

function optionsFromEnvironment(
  environment: NodeJS.ProcessEnv,
): ProviderHttpInstrumentationOptions | undefined {
  const mode = environment.CLASH_PROVIDER_TRAFFIC_MODE;
  if (mode !== "record" && mode !== "replay") return undefined;
  const trafficPath = environment.CLASH_PROVIDER_TRAFFIC_PATH?.trim();
  if (!trafficPath) {
    throw new Error(
      "CLASH_PROVIDER_TRAFFIC_PATH is required when provider traffic instrumentation is enabled.",
    );
  }
  const activeStubPath = environment.CLASH_PROVIDER_TRAFFIC_STUB_PATH?.trim();
  return {
    mode,
    trafficPath,
    ...(activeStubPath ? { activeStubPath } : {}),
  };
}

const automaticOptions = optionsFromEnvironment(process.env);
if (automaticOptions) await startProviderHttpInstrumentation(automaticOptions);
