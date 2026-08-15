import { randomBytes } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type { AssetKind } from "@clash/shared-types";

export interface LocalExecutorAssetCapabilityOpenRequest {
  invocationId: string;
  path: string;
  byteLength: number;
  kind: AssetKind;
  mediaType?: string;
}

export interface LocalExecutorAssetCapability {
  executorUrl: string;
  expiresAt: string;
  kind: AssetKind;
  mediaType?: string;
  release(): Promise<void>;
}

export interface LocalExecutorAssetCapabilityIssuer {
  open(
    input: LocalExecutorAssetCapabilityOpenRequest,
  ): Promise<LocalExecutorAssetCapability>;
  close(): Promise<void>;
}

interface CapabilityRecord {
  handle: FileHandle;
  byteLength: number;
  kind: AssetKind;
  mediaType?: string;
  expiresAt: number;
  release(): Promise<void>;
}

interface ByteRange {
  start: number;
  end: number;
}

function parseSingleRange(value: string, byteLength: number): ByteRange | null {
  if (byteLength === 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(0, byteLength - suffixLength);
    return { start, end: byteLength - 1 };
  }

  const start = Number(startText);
  if (!Number.isSafeInteger(start) || start < 0 || start >= byteLength) {
    return null;
  }
  if (!endText) return { start, end: byteLength - 1 };
  const requestedEnd = Number(endText);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, byteLength - 1) };
}

function setCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Range");
  response.setHeader(
    "Access-Control-Expose-Headers",
    "Accept-Ranges, Content-Length, Content-Range, Content-Type",
  );
}

export function createLocalExecutorAssetCapabilityIssuer(
  options: {
    now?: () => number;
    ttlMs?: number;
  } = {},
): LocalExecutorAssetCapabilityIssuer {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error(
      "Executor Asset capability ttlMs must be a positive integer.",
    );
  }
  const capabilities = new Map<string, CapabilityRecord>();
  let server: Server | undefined;
  let listening: Promise<number> | undefined;
  let closed = false;

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    setCors(response);
    response.setHeader("Cache-Control", "private, no-store");
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const match = /^\/assets\/([A-Za-z0-9_-]+)$/.exec(pathname);
    const token = match?.[1];
    const record = token ? capabilities.get(token) : undefined;
    if (!record || record.expiresAt <= now()) {
      if (record) await record.release();
      response.statusCode = 404;
      response.end();
      return;
    }

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.statusCode = 405;
      response.setHeader("Allow", "GET, HEAD, OPTIONS");
      response.end();
      return;
    }

    response.setHeader("Accept-Ranges", "bytes");
    if (record.mediaType) response.setHeader("Content-Type", record.mediaType);
    const rangeHeader = request.headers.range;
    let range: ByteRange | undefined;
    if (rangeHeader !== undefined) {
      range = parseSingleRange(rangeHeader, record.byteLength) ?? undefined;
      if (!range) {
        response.statusCode = 416;
        response.setHeader("Content-Range", `bytes */${record.byteLength}`);
        response.setHeader("Content-Length", "0");
        response.end();
        return;
      }
      response.statusCode = 206;
      response.setHeader(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${record.byteLength}`,
      );
      response.setHeader("Content-Length", String(range.end - range.start + 1));
    } else {
      response.statusCode = 200;
      response.setHeader("Content-Length", String(record.byteLength));
    }

    if (request.method === "HEAD" || record.byteLength === 0) {
      response.end();
      return;
    }
    const stream = record.handle.createReadStream({
      start: range?.start ?? 0,
      end: range?.end ?? record.byteLength - 1,
      autoClose: false,
    });
    stream.on("error", () => response.destroy());
    stream.pipe(response);
  };

  const ensureListening = async (): Promise<number> => {
    if (closed) throw new Error("Executor Asset capability issuer is closed.");
    if (listening) return await listening;
    server = createServer((request, response) => {
      void handleRequest(request, response).catch(() => {
        if (!response.headersSent) response.statusCode = 500;
        response.end();
      });
    });
    server.unref();
    listening = new Promise<number>((resolve, reject) => {
      const current = server!;
      const onError = (error: Error) => {
        current.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        current.off("error", onError);
        const address = current.address();
        if (!address || typeof address === "string") {
          reject(
            new Error("Executor Asset capability server has no TCP address."),
          );
          return;
        }
        resolve(address.port);
      };
      current.once("error", onError);
      current.once("listening", onListening);
      current.listen(0, "127.0.0.1");
    });
    return await listening;
  };

  return {
    async open(input) {
      if (!input.invocationId.trim()) {
        throw new Error("Executor Asset capability invocationId is required.");
      }
      if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0) {
        throw new Error(
          "Executor Asset capability byteLength must be a non-negative integer.",
        );
      }
      const handle = await open(input.path, "r");
      let keepHandle = false;
      try {
        const facts = await handle.stat();
        if (!facts.isFile() || facts.size !== input.byteLength) {
          throw new Error(
            "Executor Asset immutable Resource length no longer matches its projection.",
          );
        }
        const port = await ensureListening();
        const token = randomBytes(32).toString("base64url");
        const expiresAt = now() + ttlMs;
        let released = false;
        let expiryTimer: ReturnType<typeof setTimeout> | undefined;
        const record: CapabilityRecord = {
          handle,
          byteLength: input.byteLength,
          kind: input.kind,
          ...(input.mediaType ? { mediaType: input.mediaType } : {}),
          expiresAt,
          async release() {
            if (released) return;
            released = true;
            if (expiryTimer) clearTimeout(expiryTimer);
            capabilities.delete(token);
            await handle.close().catch(() => undefined);
          },
        };
        capabilities.set(token, record);
        expiryTimer = setTimeout(() => {
          void record.release().catch(() => undefined);
        }, ttlMs);
        expiryTimer.unref();
        keepHandle = true;
        return {
          executorUrl: `http://127.0.0.1:${port}/assets/${token}`,
          expiresAt: new Date(expiresAt).toISOString(),
          kind: input.kind,
          ...(input.mediaType ? { mediaType: input.mediaType } : {}),
          release: record.release,
        };
      } finally {
        if (!keepHandle) await handle.close().catch(() => undefined);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled(
        [...capabilities.values()].map((record) => record.release()),
      );
      if (!server) return;
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
    },
  };
}
