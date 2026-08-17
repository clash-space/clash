import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CdpScreencastRecorder,
  waitForCdpReadiness,
} from "./recorder.js";

const temporaryDirectories: string[] = [];

async function frameDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "clash-demo-frames-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("CDP screencast recorder", () => {
  it("polls recording readiness through the recorder CDP session", async () => {
    const results: unknown[] = [false, { width: 1_440, height: 900 }];
    const client = {
      async send(method: string, params?: Record<string, unknown>) {
        expect(method).toBe("Runtime.evaluate");
        expect(params).toEqual({
          expression: "window.__recordingReady",
          returnByValue: true,
          awaitPromise: true,
        });
        return { result: { value: results.shift() } };
      },
      onEvent() {
        return () => {};
      },
    };
    const delays: number[] = [];

    await expect(
      waitForCdpReadiness({
        client,
        source: "window.__recordingReady",
        label: "recording viewport",
        timeoutMs: 1_000,
        pollIntervalMs: 25,
        now: (() => {
          let value = 0;
          return () => value++ * 25;
        })(),
        delay: async (milliseconds) => {
          delays.push(milliseconds);
        },
      }),
    ).resolves.toEqual({ width: 1_440, height: 900 });
    expect(delays).toEqual([25]);
  });

  it("acks frames and writes their receipt times without opening another page", async () => {
    const frameDir = await frameDirectory();
    const handlers = new Set<(method: string, params: Record<string, unknown>) => void>();
    const client = {
      send: vi.fn(async (_method: string, _params?: Record<string, unknown>) => ({})),
      onEvent(handler: (method: string, params: Record<string, unknown>) => void) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
    const clock = [1_000, 1_120, 2_620, 3_000];
    const recorder = new CdpScreencastRecorder({
      client,
      frameDir,
      viewport: { width: 1440, height: 900 },
      now: () => clock.shift() ?? 3_000,
      everyNthFrame: 3,
    });

    await recorder.start();
    for (const handler of handlers) {
      handler("Page.screencastFrame", {
        data: Buffer.from("frame-one").toString("base64"),
        sessionId: 41,
      });
      handler("Page.screencastFrame", {
        data: Buffer.from("frame-two").toString("base64"),
        sessionId: 42,
      });
    }
    const result = await recorder.stop();

    expect(client.send).toHaveBeenCalledWith("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      maxWidth: 1440,
      maxHeight: 900,
      everyNthFrame: 3,
    });
    expect(client.send).toHaveBeenCalledWith("Page.screencastFrameAck", { sessionId: 41 });
    expect(client.send).toHaveBeenCalledWith("Page.screencastFrameAck", { sessionId: 42 });
    expect(result.frames.map((frame) => frame.monotonicMs)).toEqual([120, 1_620]);
    expect(result.endMs).toBe(2_000);
    expect(result.sourceFrameCount).toBe(2);
    expect(result.usedFallback).toBe(false);
    expect(await readFile(result.frames[0]!.path, "utf8")).toBe("frame-one");
  });

  it("rolls back its subscription when CDP start fails", async () => {
    const frameDir = await frameDirectory();
    const handlers = new Set<(method: string, params: Record<string, unknown>) => void>();
    let failStart = true;
    const client = {
      async send(method: string) {
        if (method === "Page.startScreencast" && failStart) {
          failStart = false;
          throw new Error("start failed");
        }
        return {};
      },
      onEvent(handler: (method: string, params: Record<string, unknown>) => void) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
    const recorder = new CdpScreencastRecorder({
      client,
      frameDir,
      viewport: { width: 1440, height: 900 },
    });

    await expect(recorder.start()).rejects.toThrow(/start failed/iu);
    expect(handlers.size).toBe(0);
    await expect(recorder.start()).resolves.toBeUndefined();
  });

  it("caps on-disk frame cadence while acknowledging every CDP frame", async () => {
    const frameDir = await frameDirectory();
    const handlers = new Set<(method: string, params: Record<string, unknown>) => void>();
    const client = {
      send: vi.fn(async (_method: string, _params?: Record<string, unknown>) => ({})),
      onEvent(handler: (method: string, params: Record<string, unknown>) => void) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
    const clock = [1_000, 1_050, 1_100, 1_250, 1_300];
    const recorder = new CdpScreencastRecorder({
      client,
      frameDir,
      viewport: { width: 1440, height: 900 },
      now: () => clock.shift() ?? 1_300,
      minimumFrameIntervalMs: 150,
    });
    await recorder.start();
    for (const handler of handlers) {
      for (const sessionId of [1, 2, 3]) {
        handler("Page.screencastFrame", {
          data: Buffer.from(`frame-${sessionId}`).toString("base64"),
          sessionId,
        });
      }
    }

    const result = await recorder.stop();
    expect(result.frames.map((frame) => frame.monotonicMs)).toEqual([50, 250]);
    expect(
      client.send.mock.calls.filter(([method]) => method === "Page.screencastFrameAck"),
    ).toHaveLength(3);
  });

  it("flushes the latest throttled screencast frame before a static final-result hold", async () => {
    const frameDir = await frameDirectory();
    const handlers = new Set<(method: string, params: Record<string, unknown>) => void>();
    const client = {
      send: vi.fn(async (_method: string, _params?: Record<string, unknown>) => ({})),
      onEvent(handler: (method: string, params: Record<string, unknown>) => void) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
    const clock = [1_000, 1_100, 1_200, 5_000];
    const recorder = new CdpScreencastRecorder({
      client,
      frameDir,
      viewport: { width: 1440, height: 900 },
      now: () => clock.shift() ?? 5_000,
      everyNthFrame: 1,
      minimumFrameIntervalMs: 200,
    });

    await recorder.start();
    for (const handler of handlers) {
      handler("Page.screencastFrame", {
        data: Buffer.from("agent-work").toString("base64"),
        sessionId: 51,
      });
      handler("Page.screencastFrame", {
        data: Buffer.from("final-canvas").toString("base64"),
        sessionId: 52,
      });
    }
    const result = await recorder.stop();

    expect(result.sourceFrameCount).toBe(2);
    expect(result.usedFallback).toBe(false);
    expect(result.frames).toHaveLength(2);
    expect(result.endMs).toBe(4_000);
    expect(result.frames.map((frame) => frame.monotonicMs)).toEqual([100, 200]);
    expect(await readFile(result.frames.at(-1)!.path, "utf8")).toBe("final-canvas");
  });

  it("identifies a lone screenshot as fallback rather than a screencast frame", async () => {
    const frameDir = await frameDirectory();
    const fallback = Buffer.from("fallback-frame");
    const client = {
      async send(method: string) {
        if (method === "Page.captureScreenshot") {
          return { data: fallback.toString("base64") };
        }
        return {};
      },
      onEvent() {
        return () => {};
      },
    };
    const clock = [1_000, 1_300];
    const recorder = new CdpScreencastRecorder({
      client,
      frameDir,
      viewport: { width: 1440, height: 900 },
      now: () => clock.shift() ?? 1_300,
    });

    await recorder.start();
    const result = await recorder.stop();

    expect(result.frames).toHaveLength(1);
    expect(await readFile(result.frames[0]!.path)).toEqual(fallback);
    expect(result.sourceFrameCount).toBe(0);
    expect(result.usedFallback).toBe(true);
  });
});
