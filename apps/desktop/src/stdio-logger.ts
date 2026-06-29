import { format } from "node:util";

type WritableLogStream = NodeJS.WritableStream & {
  write(chunk: string): boolean;
};

export interface DesktopLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function isEpipe(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "EPIPE";
}

export function createDesktopLogger(
  stdout: WritableLogStream = process.stdout,
  stderr: WritableLogStream = process.stderr,
): DesktopLogger {
  let stdoutOpen = true;
  let stderrOpen = true;

  stdout.on("error", (error) => {
    if (isEpipe(error)) {
      stdoutOpen = false;
      return;
    }
    throw error;
  });

  stderr.on("error", (error) => {
    if (isEpipe(error)) {
      stderrOpen = false;
      return;
    }
    throw error;
  });

  function write(stream: "stdout" | "stderr", ...args: unknown[]): void {
    if (stream === "stdout" && !stdoutOpen) return;
    if (stream === "stderr" && !stderrOpen) return;

    try {
      const target = stream === "stdout" ? stdout : stderr;
      target.write(`${format(...args)}\n`);
    } catch (error) {
      if (isEpipe(error)) {
        if (stream === "stdout") stdoutOpen = false;
        else stderrOpen = false;
        return;
      }
      throw error;
    }
  }

  return {
    info: (...args) => write("stdout", ...args),
    warn: (...args) => write("stderr", ...args),
    error: (...args) => write("stderr", ...args),
  };
}
