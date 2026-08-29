export interface DesktopControllerLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  event?(
    level: "info" | "warn" | "error",
    event: string,
    context?: Record<string, unknown>,
  ): void;
}
