import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

export type StructuredLogLevel = "info" | "warn" | "error";

export interface StructuredLogSink {
  write(record: Record<string, unknown>): void;
  close(): void;
}

export function createBoundedJsonlLogSink(options: {
  directory: string;
  filePrefix: string;
  maxBytes: number;
  maxFiles: number;
  now?: () => number;
  pid?: number;
}): StructuredLogSink {
  const now = options.now ?? Date.now;
  const pid = options.pid ?? process.pid;
  const maxBytes = Math.max(1, options.maxBytes);
  const maxFiles = Math.max(1, options.maxFiles);
  const filePrefix =
    options.filePrefix.replace(/[^a-zA-Z0-9._-]/g, "-") || "clash";
  let segment = 0;
  let currentBytes = 0;

  mkdirSync(options.directory, { recursive: true, mode: 0o700 });

  const nextPath = () =>
    join(
      options.directory,
      `${filePrefix}-${String(now()).padStart(16, "0")}-${pid}-${segment++}.jsonl`,
    );
  let currentPath = nextPath();

  const prune = () => {
    const files = readdirSync(options.directory)
      .filter(
        (file) => file.startsWith(`${filePrefix}-`) && file.endsWith(".jsonl"),
      )
      .map((file) => ({
        file,
        modifiedAt: statSync(join(options.directory, file)).mtimeMs,
      }))
      .sort(
        (left, right) =>
          left.modifiedAt - right.modifiedAt ||
          left.file.localeCompare(right.file),
      );
    for (const entry of files.slice(0, Math.max(0, files.length - maxFiles))) {
      rmSync(join(options.directory, entry.file), { force: true });
    }
  };

  prune();

  return {
    write(record) {
      const line = `${JSON.stringify(record)}\n`;
      const bytes = Buffer.byteLength(line);
      if (currentBytes > 0 && currentBytes + bytes > maxBytes) {
        currentPath = nextPath();
        currentBytes = 0;
      }
      appendFileSync(currentPath, line, { encoding: "utf8", mode: 0o600 });
      currentBytes += bytes;
      prune();
    },
    close() {},
  };
}

export interface LogSuppressionSummary {
  suppressedCount: number;
  distinctCount: number;
}

export function createDeduplicatedLogEmitter<T>(options: {
  emit: (value: T) => void;
  emitSuppressed: (summary: LogSuppressionSummary) => void;
  keyOf: (value: T) => string;
  maxEventsPerWindow: number;
  windowMs: number;
  now?: () => number;
}): { emit(value: T): void; flush(): void } {
  const now = options.now ?? Date.now;
  const maxEventsPerWindow = Math.max(1, options.maxEventsPerWindow);
  const windowMs = Math.max(1, options.windowMs);
  let windowStartedAt = now();
  let emittedCount = 0;
  let suppressedCount = 0;
  const emittedKeys = new Set<string>();
  const suppressedKeys = new Set<string>();

  const reset = () => {
    windowStartedAt = now();
    emittedCount = 0;
    suppressedCount = 0;
    emittedKeys.clear();
    suppressedKeys.clear();
  };

  const flush = () => {
    if (suppressedCount > 0) {
      options.emitSuppressed({
        suppressedCount,
        distinctCount: suppressedKeys.size,
      });
    }
    reset();
  };

  return {
    emit(value) {
      if (now() - windowStartedAt >= windowMs) flush();
      const key = options.keyOf(value);
      if (emittedKeys.has(key) || emittedCount >= maxEventsPerWindow) {
        suppressedCount += 1;
        suppressedKeys.add(key);
        return;
      }
      emittedKeys.add(key);
      emittedCount += 1;
      options.emit(value);
    },
    flush,
  };
}

type CapturableLogStream = Pick<NodeJS.WriteStream, "write">;

export interface ProcessStdioCapture {
  event(
    level: StructuredLogLevel,
    event: string,
    context?: Record<string, unknown>,
  ): void;
  close(): void;
}

function logMessage(chunk: unknown): string {
  const text =
    typeof chunk === "string"
      ? chunk
      : Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
        ? Buffer.from(chunk).toString("utf8")
        : String(chunk);
  return text.replace(/[\r\n]+$/, "");
}

export function installProcessStdioCapture(options: {
  component: string;
  stdout?: CapturableLogStream;
  stderr?: CapturableLogStream;
  sink: StructuredLogSink;
  maxEventsPerWindow: number;
  windowMs: number;
  now?: () => number;
}): ProcessStdioCapture {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const now = options.now ?? Date.now;
  const originalStdoutWrite = stdout.write;
  const originalStderrWrite = stderr.write;
  let open = true;
  let sinkOpen = true;

  const persist = (record: Record<string, unknown>) => {
    if (!sinkOpen) return;
    try {
      options.sink.write(record);
    } catch {
      sinkOpen = false;
    }
  };
  const emitter = createDeduplicatedLogEmitter<{
    level: StructuredLogLevel;
    message: string;
  }>({
    emit: ({ level, message }) =>
      persist({
        timestamp: new Date(now()).toISOString(),
        component: options.component,
        level,
        message,
      }),
    emitSuppressed: ({ suppressedCount, distinctCount }) =>
      persist({
        timestamp: new Date(now()).toISOString(),
        component: options.component,
        level: "warn",
        event: "logs.suppressed",
        context: { suppressedCount, distinctCount },
      }),
    keyOf: ({ level, message }) => `${level}:${message}`,
    maxEventsPerWindow: options.maxEventsPerWindow,
    windowMs: options.windowMs,
    now,
  });

  const wrap = (
    stream: CapturableLogStream,
    originalWrite: CapturableLogStream["write"],
    level: StructuredLogLevel,
  ): CapturableLogStream["write"] =>
    function capturedWrite(chunk, ...args) {
      if (open) {
        const message = logMessage(chunk);
        if (message) emitter.emit({ level, message });
      }
      return Reflect.apply(originalWrite, stream, [chunk, ...args]);
    } as CapturableLogStream["write"];

  stdout.write = wrap(stdout, originalStdoutWrite, "info");
  stderr.write = wrap(stderr, originalStderrWrite, "error");

  return {
    event(level, event, context = {}) {
      if (!open) return;
      persist({
        timestamp: new Date(now()).toISOString(),
        component: options.component,
        level,
        event,
        context,
      });
    },
    close() {
      if (!open) return;
      emitter.flush();
      open = false;
      stdout.write = originalStdoutWrite;
      stderr.write = originalStderrWrite;
      if (!sinkOpen) return;
      sinkOpen = false;
      options.sink.close();
    },
  };
}
