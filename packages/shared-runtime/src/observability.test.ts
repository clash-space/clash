import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createBoundedJsonlLogSink,
  createDeduplicatedLogEmitter,
  installProcessStdioCapture,
} from "./observability.js";

describe("bounded observability", () => {
  it("rotates JSONL records and removes files beyond the configured retention", () => {
    const directory = mkdtempSync(join(tmpdir(), "clash-observability-"));

    try {
      let now = 1_000;
      const sink = createBoundedJsonlLogSink({
        directory,
        filePrefix: "test-host",
        maxBytes: 1,
        maxFiles: 2,
        now: () => now++,
        pid: 42,
      });
      sink.write({ event: "first" });
      sink.write({ event: "second" });
      sink.write({ event: "third" });
      sink.close();

      const files = readdirSync(directory)
        .filter((file) => file.endsWith(".jsonl"))
        .sort();
      expect(files).toHaveLength(2);
      const retained = files.map((file) =>
        readFileSync(join(directory, file), "utf8"),
      );
      expect(retained.join("\n")).not.toContain("first");
      expect(retained.join("\n")).toContain("second");
      expect(retained.join("\n")).toContain("third");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("emits one copy of a repeated message and a bounded suppression summary", () => {
    const emitted: string[] = [];
    const summaries: Array<{ suppressedCount: number; distinctCount: number }> =
      [];
    const emitter = createDeduplicatedLogEmitter<string>({
      emit: (message) => emitted.push(message),
      emitSuppressed: (summary) => summaries.push(summary),
      keyOf: (message) => message,
      maxEventsPerWindow: 2,
      windowMs: 1_000,
      now: () => 0,
    });

    emitter.emit("same");
    emitter.emit("same");
    emitter.emit("different");
    emitter.emit("overflow");
    emitter.flush();

    expect(emitted).toEqual(["same", "different"]);
    expect(summaries).toEqual([{ suppressedCount: 2, distinctCount: 2 }]);
  });

  it("captures process stdio as structured records while preserving the original streams", () => {
    const stdout = { write: vi.fn((_chunk: unknown) => true) };
    const stderr = { write: vi.fn((_chunk: unknown) => true) };
    const records: Array<Record<string, unknown>> = [];
    const sink = {
      write: (record: Record<string, unknown>) => records.push(record),
      close: vi.fn(),
    };
    const capture = installProcessStdioCapture({
      component: "local-api",
      stdout,
      stderr,
      sink,
      now: () => 1_000,
      maxEventsPerWindow: 10,
      windowMs: 1_000,
    });

    stdout.write("ready\n");
    stderr.write(Buffer.from("failed\n"));
    capture.event("error", "process.crashed", { exitCode: 5 });
    capture.close();

    expect(stdout.write).toHaveBeenCalledWith("ready\n");
    expect(stderr.write).toHaveBeenCalledWith(Buffer.from("failed\n"));
    expect(records).toEqual([
      {
        timestamp: "1970-01-01T00:00:01.000Z",
        component: "local-api",
        level: "info",
        message: "ready",
      },
      {
        timestamp: "1970-01-01T00:00:01.000Z",
        component: "local-api",
        level: "error",
        message: "failed",
      },
      {
        timestamp: "1970-01-01T00:00:01.000Z",
        component: "local-api",
        level: "error",
        event: "process.crashed",
        context: { exitCode: 5 },
      },
    ]);
    expect(sink.close).toHaveBeenCalledOnce();
  });
});
