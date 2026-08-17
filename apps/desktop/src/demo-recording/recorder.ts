import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DemoViewport } from "./contracts.js";
import type { CdpTarget, ScreencastFrame } from "./video.js";
import { selectPageTarget } from "./video.js";

export interface CdpClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onEvent(handler: (method: string, params: Record<string, unknown>) => void): () => void;
}

export interface CdpScreencastRecorderOptions {
  client: CdpClient;
  frameDir: string;
  viewport: DemoViewport;
  now?: () => number;
  quality?: number;
  everyNthFrame?: number;
  minimumFrameIntervalMs?: number;
}

export interface CdpScreencastResult {
  frames: ScreencastFrame[];
  endMs: number;
  sourceFrameCount: number;
  usedFallback: boolean;
}

export async function waitForCdpReadiness(options: {
  client: CdpClient;
  source: string;
  label: string;
  timeoutMs: number;
  pollIntervalMs?: number;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
}): Promise<unknown> {
  if (!options.source.trim()) throw new Error("CDP readiness source must not be empty");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("CDP readiness timeout must be positive and finite");
  }
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error("CDP readiness poll interval must be positive and finite");
  }
  const now = options.now ?? Date.now;
  const delay =
    options.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + options.timeoutMs;

  while (true) {
    const response = (await options.client.send("Runtime.evaluate", {
      expression: options.source,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result?: { value?: unknown };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          `CDP evaluation failed while waiting for ${options.label}`,
      );
    }
    if (response.result?.value) return response.result.value;
    if (now() >= deadline) break;
    await delay(pollIntervalMs);
  }
  throw new Error(`timed out waiting for ${options.label}`);
}

export class CdpScreencastRecorder {
  readonly #client: CdpClient;
  readonly #frameDir: string;
  readonly #viewport: DemoViewport;
  readonly #now: () => number;
  readonly #quality: number;
  readonly #everyNthFrame: number;
  readonly #minimumFrameIntervalMs: number;
  readonly #frames: ScreencastFrame[] = [];
  readonly #writes = new Set<Promise<void>>();
  #startedAt: number | undefined;
  #unsubscribe: (() => void) | undefined;
  #failure: unknown;
  #lastAcceptedFrameMs: number | undefined;
  #pendingFrame: { data: string; monotonicMs: number } | undefined;

  constructor(options: CdpScreencastRecorderOptions) {
    this.#client = options.client;
    this.#frameDir = options.frameDir;
    this.#viewport = options.viewport;
    this.#now = options.now ?? (() => performance.now());
    this.#quality = options.quality ?? 90;
    this.#everyNthFrame = options.everyNthFrame ?? 1;
    if (!Number.isSafeInteger(this.#everyNthFrame) || this.#everyNthFrame < 1) {
      throw new Error("everyNthFrame must be a positive integer");
    }
    this.#minimumFrameIntervalMs = options.minimumFrameIntervalMs ?? 0;
    if (!Number.isFinite(this.#minimumFrameIntervalMs) || this.#minimumFrameIntervalMs < 0) {
      throw new Error("minimumFrameIntervalMs must be finite and non-negative");
    }
  }

  async start(): Promise<void> {
    if (this.#startedAt !== undefined) throw new Error("screencast recorder already started");
    await mkdir(this.#frameDir, { recursive: true });
    this.#startedAt = this.#now();
    this.#unsubscribe = this.#client.onEvent((method, params) => {
      if (method !== "Page.screencastFrame") return;
      this.#acceptFrame(params);
    });
    try {
      await this.#client.send("Page.enable");
      await this.#client.send("Page.startScreencast", {
        format: "jpeg",
        quality: this.#quality,
        maxWidth: this.#viewport.width,
        maxHeight: this.#viewport.height,
        everyNthFrame: this.#everyNthFrame,
      });
    } catch (error) {
      this.#unsubscribe?.();
      this.#unsubscribe = undefined;
      this.#startedAt = undefined;
      this.#frames.splice(0);
      this.#failure = undefined;
      this.#lastAcceptedFrameMs = undefined;
      this.#pendingFrame = undefined;
      throw error;
    }
  }

  #acceptFrame(params: Record<string, unknown>): void {
    if (this.#startedAt === undefined || typeof params.data !== "string") return;
    const sessionId = params.sessionId;
    if (typeof sessionId === "number") {
      void this.#client
        .send("Page.screencastFrameAck", { sessionId })
        .catch((error: unknown) => {
          this.#failure ??= error;
        });
    }

    const monotonicMs = Math.max(0, this.#now() - this.#startedAt);
    if (
      this.#lastAcceptedFrameMs !== undefined &&
      monotonicMs - this.#lastAcceptedFrameMs < this.#minimumFrameIntervalMs
    ) {
      this.#pendingFrame = { data: params.data, monotonicMs };
      return;
    }
    this.#pendingFrame = undefined;
    this.#lastAcceptedFrameMs = monotonicMs;
    this.#storeFrame(params.data, monotonicMs);
  }

  #storeFrame(data: string, monotonicMs: number): void {
    const path = join(this.#frameDir, `${String(this.#frames.length + 1).padStart(6, "0")}.jpg`);
    this.#frames.push({ path, monotonicMs });
    const write = writeFile(path, Buffer.from(data, "base64"))
      .catch((error: unknown) => {
        this.#failure ??= error;
      })
      .finally(() => this.#writes.delete(write));
    this.#writes.add(write);
  }

  #flushPendingFrame(): void {
    const pending = this.#pendingFrame;
    this.#pendingFrame = undefined;
    if (!pending) return;
    this.#lastAcceptedFrameMs = pending.monotonicMs;
    this.#storeFrame(pending.data, pending.monotonicMs);
  }

  async stop(): Promise<CdpScreencastResult> {
    if (this.#startedAt === undefined) throw new Error("screencast recorder has not started");
    const stoppedAt = this.#now();
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    await this.#client.send("Page.stopScreencast");
    this.#flushPendingFrame();
    await Promise.allSettled(this.#writes);
    if (this.#failure) throw this.#failure;

    const sourceFrameCount = this.#frames.length;
    const usedFallback = sourceFrameCount === 0;
    if (usedFallback) {
      const screenshot = (await this.#client.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: this.#quality,
      })) as { data?: unknown };
      if (typeof screenshot.data !== "string") {
        throw new Error("CDP screencast produced no frames and screenshot fallback failed");
      }
      const path = join(this.#frameDir, "000001.jpg");
      await writeFile(path, Buffer.from(screenshot.data, "base64"));
      this.#frames.push({ path, monotonicMs: 0 });
    }

    const elapsedMs = Math.max(0, stoppedAt - this.#startedAt);
    const lastFrameMs = this.#frames.at(-1)!.monotonicMs;
    return {
      frames: [...this.#frames],
      endMs: Math.max(elapsedMs, lastFrameMs + 1000 / 30),
      sourceFrameCount,
      usedFallback,
    };
  }
}

type CdpEventHandler = (method: string, params: Record<string, unknown>) => void;

export class CdpWebSocketClient implements CdpClient {
  readonly #socket: WebSocket;
  readonly #commandTimeoutMs: number;
  readonly #handlers = new Set<CdpEventHandler>();
  readonly #pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  #nextId = 1;

  private constructor(socket: WebSocket, commandTimeoutMs: number) {
    this.#socket = socket;
    this.#commandTimeoutMs = commandTimeoutMs;
    socket.addEventListener("message", (event) => void this.#onMessage(event.data));
    socket.addEventListener("close", () => {
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("CDP connection closed"));
      }
      this.#pending.clear();
    });
  }

  static async connect(
    url: string,
    timeoutMs = 10_000,
    commandTimeoutMs = 15_000,
  ): Promise<CdpWebSocketClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("timed out connecting to CDP"));
      }, timeoutMs);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          socket.close();
          reject(new Error("failed to connect to CDP"));
        },
        { once: true },
      );
    });
    return new CdpWebSocketClient(socket, commandTimeoutMs);
  }

  async #onMessage(data: unknown): Promise<void> {
    const text =
      typeof data === "string"
        ? data
        : data instanceof Blob
          ? await data.text()
          : Buffer.from(data as ArrayBuffer).toString("utf8");
    const message = JSON.parse(text) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { message?: string };
    };
    if (typeof message.id === "number") {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message ?? "CDP command failed"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      for (const handler of this.#handlers) handler(message.method, message.params ?? {});
    }
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, this.#commandTimeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });
      try {
        this.#socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  onEvent(handler: CdpEventHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  close(): void {
    this.#socket.close();
  }
}

export async function connectToClashPage(options: {
  debugPort: number;
  appBaseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ client: CdpWebSocketClient; target: CdpTarget }> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const response = await fetchFn(`http://127.0.0.1:${options.debugPort}/json`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`CDP target discovery failed with HTTP ${response.status}`);
  const targets = (await response.json()) as CdpTarget[];
  const target = selectPageTarget(targets, options.appBaseUrl);
  const client = await CdpWebSocketClient.connect(
    target.webSocketDebuggerUrl!,
    timeoutMs,
    timeoutMs,
  );
  return { client, target };
}
