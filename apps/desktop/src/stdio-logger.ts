import { format } from "node:util";
import {
  createBoundedJsonlLogSink,
  createDeduplicatedLogEmitter,
  type LogSuppressionSummary,
  type StructuredLogSink,
} from "@clash/shared-runtime/observability";

export { createDeduplicatedLogEmitter };
export type { LogSuppressionSummary };

type WritableLogStream = NodeJS.WritableStream & {
  write(chunk: string): boolean;
};

export interface DesktopLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  event(
    level: "info" | "warn" | "error",
    event: string,
    context?: Record<string, unknown>,
  ): void;
  close(): void;
}

export type DesktopFileLogSink = StructuredLogSink;

export function createDesktopFileLogSink(options: {
  directory: string;
  maxBytes: number;
  maxFiles: number;
  now?: () => number;
  pid?: number;
}): DesktopFileLogSink {
  return createBoundedJsonlLogSink({
    ...options,
    filePrefix: "desktop",
  });
}

const CLOSED_STDIO_ERROR_CODES = new Set([
  "EPIPE",
  "EIO",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END",
]);

export function isClosedStdioError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && CLOSED_STDIO_ERROR_CODES.has(code);
}

export function createDesktopLogger(
  stdout: WritableLogStream = process.stdout,
  stderr: WritableLogStream = process.stderr,
  options: {
    fileSink?: DesktopFileLogSink;
    now?: () => number;
  } = {},
): DesktopLogger {
  let stdoutOpen = true;
  let stderrOpen = true;
  let fileSinkOpen = Boolean(options.fileSink);
  const now = options.now ?? Date.now;

  stdout.on("error", (error) => {
    if (isClosedStdioError(error)) {
      stdoutOpen = false;
      return;
    }
    throw error;
  });

  stderr.on("error", (error) => {
    if (isClosedStdioError(error)) {
      stderrOpen = false;
      return;
    }
    throw error;
  });

  function persist(record: Record<string, unknown>): void {
    if (fileSinkOpen && options.fileSink) {
      try {
        options.fileSink.write(record);
      } catch {
        fileSinkOpen = false;
      }
    }
  }

  function writeStream(stream: "stdout" | "stderr", message: string): void {
    if (stream === "stdout" && !stdoutOpen) return;
    if (stream === "stderr" && !stderrOpen) return;

    try {
      const target = stream === "stdout" ? stdout : stderr;
      target.write(`${message}\n`);
    } catch (error) {
      if (isClosedStdioError(error)) {
        if (stream === "stdout") stdoutOpen = false;
        else stderrOpen = false;
        return;
      }
      throw error;
    }
  }

  function write(
    level: "info" | "warn" | "error",
    stream: "stdout" | "stderr",
    ...args: unknown[]
  ): void {
    const message = format(...args);
    persist({
      timestamp: new Date(now()).toISOString(),
      level,
      message,
    });
    writeStream(stream, message);
  }

  return {
    info: (...args) => write("info", "stdout", ...args),
    warn: (...args) => write("warn", "stderr", ...args),
    error: (...args) => write("error", "stderr", ...args),
    event: (level, event, context = {}) => {
      persist({
        timestamp: new Date(now()).toISOString(),
        level,
        event,
        context,
      });
      writeStream(
        level === "info" ? "stdout" : "stderr",
        `[desktop:${event}] ${JSON.stringify(context)}`,
      );
    },
    close: () => {
      if (!fileSinkOpen || !options.fileSink) return;
      fileSinkOpen = false;
      options.fileSink.close();
    },
  };
}
