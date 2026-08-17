import {
  isSafeClashOperation,
  type ClashDispatcherMode,
} from "./dispatcher-observation.js";

export type DemoEventSource = "runner" | "acp" | "product";

export const DEMO_EVENT_ERROR_KINDS = [
  "invalid_arguments",
  "read_required",
  "stale_read",
  "immutable_node",
  "not_found",
  "conflict",
  "timeout",
  "permission_denied",
  "unknown_operation",
  "tool_error",
] as const;

export type DemoEventErrorKind = (typeof DEMO_EVENT_ERROR_KINDS)[number];

export interface DemoEventInput {
  source: DemoEventSource;
  type: string;
  chapterId?: string;
  label?: string;
  toolCallId?: string;
  turnId?: string;
  status?: "started" | "completed" | "failed";
  errorKind?: DemoEventErrorKind;
  dispatcherMode?: ClashDispatcherMode;
  requestedOperation?: string;
}

export interface DemoEvent extends DemoEventInput {
  schemaVersion: 1;
  sequence: number;
  monotonicMs: number;
}

export interface DemoEventJournalOptions {
  now?: () => number;
  onRecord?: (event: DemoEvent) => void;
}

const ALLOWED_FIELDS = new Set<keyof DemoEventInput>([
  "source",
  "type",
  "chapterId",
  "label",
  "toolCallId",
  "turnId",
  "status",
  "errorKind",
  "dispatcherMode",
  "requestedOperation",
]);

const SOURCES = new Set<DemoEventSource>(["runner", "acp", "product"]);
const ERROR_KINDS = new Set<DemoEventErrorKind>(DEMO_EVENT_ERROR_KINDS);

function assertSafeText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`demo event ${field} must be a non-empty string`);
  }
  if (/\r|\n/u.test(value)) {
    throw new Error(`demo event ${field} must be a single line`);
  }
}

function sanitizeLabel(value: string): string {
  return value
    .replace(
      /(?:\/(?:Users|home|private|tmp|var\/folders)\/[^\s,;'"()[\]{}]+|[A-Za-z]:\\[^\s,;'"()[\]{}]+)/gu,
      "[local-path]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(
      /\b(api[-_ ]?key|token|authorization|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "$1=[redacted]",
    )
    .slice(0, 240);
}

export class DemoEventJournal {
  readonly #now: () => number;
  readonly #onRecord?: (event: DemoEvent) => void;
  #originMs: number | undefined;
  #lastMonotonicMs = 0;
  #sequence = 0;

  constructor(options: DemoEventJournalOptions = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#onRecord = options.onRecord;
  }

  record(input: DemoEventInput): DemoEvent {
    const unsupported = Object.keys(input).filter(
      (key) => !ALLOWED_FIELDS.has(key as keyof DemoEventInput),
    );
    if (unsupported.length > 0) {
      throw new Error(`unsupported demo event fields: ${unsupported.sort().join(", ")}`);
    }
    if (!SOURCES.has(input.source)) {
      throw new Error(`unsupported demo event source: ${String(input.source)}`);
    }
    assertSafeText(input.type, "type");
    for (const field of ["chapterId", "label", "toolCallId", "turnId"] as const) {
      const value = input[field];
      if (value !== undefined) assertSafeText(value, field);
    }
    if (
      input.status !== undefined &&
      input.status !== "started" &&
      input.status !== "completed" &&
      input.status !== "failed"
    ) {
      throw new Error(`unsupported demo event status: ${String(input.status)}`);
    }
    if (input.errorKind !== undefined && !ERROR_KINDS.has(input.errorKind)) {
      throw new Error(
        `unsupported demo event errorKind: ${String(input.errorKind)}`,
      );
    }
    if (
      input.dispatcherMode !== undefined &&
      input.dispatcherMode !== "index" &&
      input.dispatcherMode !== "contract" &&
      input.dispatcherMode !== "contracts" &&
      input.dispatcherMode !== "execute"
    ) {
      throw new Error(
        `unsupported demo event dispatcherMode: ${String(input.dispatcherMode)}`,
      );
    }
    if (
      input.requestedOperation !== undefined &&
      !isSafeClashOperation(input.requestedOperation)
    ) {
      throw new Error("demo event requestedOperation is not a safe Clash operation");
    }
    if (
      input.requestedOperation !== undefined &&
      input.dispatcherMode !== "contract" &&
      input.dispatcherMode !== "execute"
    ) {
      throw new Error(
        "demo event requestedOperation requires contract or execute dispatcherMode",
      );
    }

    const now = this.#now();
    if (!Number.isFinite(now)) throw new Error("demo event clock returned a non-finite value");
    this.#originMs ??= now;
    this.#lastMonotonicMs = Math.max(this.#lastMonotonicMs, now - this.#originMs);

    const safeInput: DemoEventInput = input.label
      ? { ...input, label: sanitizeLabel(input.label) }
      : input;
    const event: DemoEvent = {
      schemaVersion: 1,
      sequence: ++this.#sequence,
      monotonicMs: this.#lastMonotonicMs,
      ...safeInput,
    };
    this.#onRecord?.(event);
    return event;
  }
}
