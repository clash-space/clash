import type {
  DemoEventErrorKind,
  DemoEventInput,
  DemoEventJournal,
} from "./events.js";
import {
  projectClashDispatcherCall,
  type ClashDispatcherCallProjection,
} from "./dispatcher-observation.js";

type JsonRecord = Record<string, unknown>;

export type SessionTerminalResult =
  | { kind: "ignored" }
  | { kind: "event" }
  | {
      kind: "untrusted-tool";
      turnId: string;
      toolKind: "shell" | "filesystem" | "other";
    }
  | { kind: "completed"; turnId: string }
  | { kind: "failed"; turnId: string; message: string };

interface ProjectedTool {
  artifactId: string;
  label: string;
  trusted: boolean;
  dispatcherCall?: ClashDispatcherCallProjection;
  terminal?: "completed" | "failed";
}

export interface PersistedSessionMessage {
  sender_kind?: unknown;
  turn_id?: unknown;
  events?: unknown;
}

export interface PersistedSessionMessages {
  messages: PersistedSessionMessage[];
}

export interface WaitForPersistedTurnOptions {
  apiBaseUrl: string;
  sessionId: string;
  turnId: string;
  timeoutMs: number;
  pollIntervalMs?: number;
  stabilityMs?: number;
  fetchFn?: typeof fetch;
  readyWhen?: (body: PersistedSessionMessages) => boolean;
  signal?: AbortSignal;
}

function recordValue(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function eventPayload(value: unknown): JsonRecord | undefined {
  const outer = recordValue(value);
  return recordValue(outer?.update) ?? outer;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

const SAFE_OPERATION_NAMES = new Set([
  "add",
  "apply",
  "attach",
  "capture",
  "copy",
  "create",
  "delete",
  "delete_batch",
  "delete_plan",
  "edges",
  "execute",
  "get",
  "import_file",
  "list",
  "move",
  "pull",
  "render",
  "replace_asset",
  "save",
  "schema",
  "search",
  "snapshot",
  "update",
  "validate",
]);

function shortOperation(toolName: string, rawInput: JsonRecord | undefined): string | undefined {
  const requested = nonEmptyString(rawInput?.operation);
  const candidate = requested ?? toolName;
  const short = candidate.replace(
    /^clash_(?:assets|canvas|director|timeline)_/u,
    "",
  );
  return SAFE_OPERATION_NAMES.has(short) ? short : undefined;
}

function trustedToolIdentity(
  event: JsonRecord,
  previous?: ProjectedTool,
): {
  label: string;
  trusted: boolean;
  dispatcherCall?: ClashDispatcherCallProjection;
} {
  const meta = recordValue(event._meta);
  if (
    meta?.["clash.host_trusted_mcp"] !== true ||
    meta?.["clash.renderer"] !== "product"
  ) {
    return previous
      ? {
          label: previous.label,
          trusted: previous.trusted,
          ...(previous.dispatcherCall
            ? { dispatcherCall: previous.dispatcherCall }
            : {}),
        }
      : { label: "Agent tool", trusted: false };
  }
  const rawInput = recordValue(event.rawInput ?? event.raw_input ?? event.input ?? event.args);
  const toolName =
    nonEmptyString(meta.mcp_tool_name) ??
    nonEmptyString(meta.mcpToolName) ??
    nonEmptyString(rawInput?.tool);
  const dispatcherCall = projectClashDispatcherCall(toolName, rawInput);
  const requestedOperation = nonEmptyString(rawInput?.operation);
  const familySource =
    dispatcherCall?.canonicalOperation ??
    (requestedOperation?.startsWith("clash_")
      ? requestedOperation
      : toolName);
  const kind = nonEmptyString(rawInput?.kind);
  const family = familySource?.startsWith("clash_canvas")
    ? "Canvas"
    : familySource?.startsWith("clash_timeline") ||
        (familySource === "clash_composition" && kind === "timeline")
      ? "Timeline"
      : familySource?.startsWith("clash_director") ||
          (familySource === "clash_composition" && kind === "director-stage")
        ? "Director Stage"
        : familySource?.startsWith("clash_composition")
          ? "Composition"
          : familySource?.startsWith("clash_generator")
            ? "Generator"
            : familySource?.startsWith("clash_asset")
              ? "Assets"
              : "Clash tool";
  const operation =
    dispatcherCall?.requestedOperation ??
    (toolName ? shortOperation(toolName, rawInput) : undefined);
  return {
    label: operation ? `${family} · ${operation}` : family,
    trusted: true,
    ...(dispatcherCall ? { dispatcherCall } : {}),
  };
}

function dispatcherEventFields(
  call: ClashDispatcherCallProjection | undefined,
): Pick<
  DemoEventInput,
  "dispatcherMode" | "requestedOperation"
> {
  return call
    ? {
        dispatcherMode: call.mode,
        ...(call.requestedOperation
          ? { requestedOperation: call.requestedOperation }
          : {}),
      }
    : {};
}

function untrustedToolKind(
  event: JsonRecord,
): "shell" | "filesystem" | "other" {
  const meta = recordValue(event._meta);
  const toolName = nonEmptyString(meta?.toolName)?.toLowerCase();
  if (toolName === "bash" || toolName === "shell" || toolName === "terminal") {
    return "shell";
  }
  if (
    toolName &&
    ["read", "write", "edit", "ls", "find", "grep", "glob"].includes(
      toolName,
    )
  ) {
    return "filesystem";
  }
  return "other";
}

function diagnosticProjection(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 50_000);
  } catch {
    return "";
  }
}

function classifyToolError(event: JsonRecord): DemoEventErrorKind {
  const diagnostic = diagnosticProjection([event.content, event.rawOutput]);
  if (/\b(?:invalid arguments?|invalid params?|validation error)\b/iu.test(diagnostic)) {
    return "invalid_arguments";
  }
  if (/\bREAD_REQUIRED\b/iu.test(diagnostic)) return "read_required";
  if (/\bSTALE_READ\b/iu.test(diagnostic)) return "stale_read";
  if (/\bIMMUTABLE_NODE\b/iu.test(diagnostic)) return "immutable_node";
  if (/\bnot[ _-]?found\b/iu.test(diagnostic)) return "not_found";
  if (/\bconflict\b/iu.test(diagnostic)) return "conflict";
  if (/\btime(?:d[ _-]?out|out)\b/iu.test(diagnostic)) return "timeout";
  if (/\b(?:permission denied|rejected|unauthorized|forbidden)\b/iu.test(diagnostic)) {
    return "permission_denied";
  }
  if (/\b(?:unknown|unavailable|not registered).*\boperation\b/iu.test(diagnostic)) {
    return "unknown_operation";
  }
  return "tool_error";
}

function toolTerminalStatus(value: unknown): "completed" | "failed" | undefined {
  if (value === "completed" || value === "succeeded") return "completed";
  if (
    value === "failed" ||
    value === "error" ||
    value === "cancelled" ||
    value === "rejected"
  ) {
    return "failed";
  }
  return undefined;
}

export class SessionEventProjector {
  readonly #journal: DemoEventJournal;
  readonly #tools = new Map<string, ProjectedTool>();
  #turnId: string | undefined;
  #terminal = false;

  constructor(journal: DemoEventJournal) {
    this.#journal = journal;
  }

  arm(turnId: string): void {
    if (turnId.trim().length === 0) throw new Error("demo turn id must not be empty");
    this.#turnId = turnId;
    this.#terminal = false;
    this.#tools.clear();
    this.#journal.record({ source: "acp", type: "agent.turn.started", turnId });
  }

  consume(value: unknown): SessionTerminalResult {
    const message = recordValue(value);
    const type = nonEmptyString(message?.type);
    const turnId = nonEmptyString(message?.turn_id);
    if (!this.#turnId || turnId !== this.#turnId || this.#terminal) {
      return { kind: "ignored" };
    }

    if (type === "session.complete") {
      this.#terminal = true;
      this.#journal.record({ source: "acp", type: "agent.turn.completed", turnId });
      return { kind: "completed", turnId };
    }
    if (type === "session.error") {
      this.#terminal = true;
      this.#journal.record({ source: "acp", type: "agent.turn.failed", turnId });
      return {
        kind: "failed",
        turnId,
        message: "Agent turn failed",
      };
    }
    if (type !== "session.event") return { kind: "ignored" };

    const event = eventPayload(message?.event);
    const sessionUpdate = nonEmptyString(event?.sessionUpdate);
    if (sessionUpdate !== "tool_call" && sessionUpdate !== "tool_call_update") {
      return { kind: "event" };
    }
    const toolCallId =
      nonEmptyString(event?.toolCallId) ??
      nonEmptyString(event?.tool_call_id) ??
      nonEmptyString(event?.id);
    if (!toolCallId) return { kind: "event" };

    const previous = this.#tools.get(toolCallId);
    const identity = trustedToolIdentity(event!, previous);
    const label = identity.label;
    const artifactId = previous?.artifactId ?? `tool-${this.#tools.size + 1}`;
    if (!previous) {
      this.#journal.record({
        source: "acp",
        type: "agent.tool.started",
        turnId,
        toolCallId: artifactId,
        label,
        status: "started",
        ...dispatcherEventFields(identity.dispatcherCall),
      });
    }

    const terminal = toolTerminalStatus(event?.status);
    const current: ProjectedTool = {
      artifactId,
      label,
      trusted: previous?.trusted ?? identity.trusted,
      dispatcherCall: previous?.dispatcherCall ?? identity.dispatcherCall,
      terminal: previous?.terminal ?? terminal,
    };
    this.#tools.set(toolCallId, current);
    if (terminal && !previous?.terminal) {
      this.#journal.record({
        source: "acp",
        type: terminal === "completed" ? "agent.tool.completed" : "agent.tool.failed",
        turnId,
        toolCallId: artifactId,
        label,
        status: terminal,
        ...dispatcherEventFields(current.dispatcherCall),
        ...(terminal === "failed"
          ? {
              errorKind: current.trusted
                ? classifyToolError(event!)
                : "tool_error",
            }
          : {}),
      });
    }
    if (!previous && !current.trusted) {
      return {
        kind: "untrusted-tool",
        turnId,
        toolKind: untrustedToolKind(event!),
      };
    }
    return { kind: "event" };
  }
}

function persistedEventIsTerminal(value: unknown): boolean {
  const event = eventPayload(value);
  if (!event) return false;
  const update = nonEmptyString(event.sessionUpdate);
  if (update === "agent_message_chunk") {
    const content = recordValue(event.content);
    return nonEmptyString(content?.text) !== undefined || nonEmptyString(event.text) !== undefined;
  }
  if (event.type === "text") return nonEmptyString(event.text) !== undefined;
  if (update === "tool_call" || update === "tool_call_update") {
    return toolTerminalStatus(event.status) !== undefined;
  }
  return false;
}

export function persistedTurnIsReady(value: unknown, turnId: string): value is PersistedSessionMessages {
  const body = recordValue(value);
  if (!Array.isArray(body?.messages)) return false;
  return body.messages.some((rawMessage) => {
    const message = recordValue(rawMessage);
    if (
      message?.sender_kind !== "agent" ||
      message.turn_id !== turnId ||
      !Array.isArray(message.events)
    ) {
      return false;
    }
    return message.events.some(persistedEventIsTerminal);
  });
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function fetchBeforeDeadline(options: {
  fetchFn: typeof fetch;
  url: URL;
  deadline: number;
  signal?: AbortSignal;
}): Promise<Response> {
  const remainingMs = Math.max(1, options.deadline - Date.now());
  const deadlineSignal = AbortSignal.timeout(remainingMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadlineSignal])
    : deadlineSignal;
  return await new Promise<Response>((resolve, reject) => {
    const onAbort = () =>
      reject(new Error("persisted turn request deadline exceeded"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    void options
      .fetchFn(options.url, { signal })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function waitForPersistedTurn(
  options: WaitForPersistedTurnOptions,
): Promise<PersistedSessionMessages> {
  const fetchFn = options.fetchFn ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const stabilityMs = options.stabilityMs ?? 250;
  if (stabilityMs < 0 || !Number.isFinite(stabilityMs)) {
    throw new Error("persisted turn stabilityMs must be finite and non-negative");
  }
  const deadline = Date.now() + options.timeoutMs;
  const url = new URL(
    `/api/v1/local-sessions/${encodeURIComponent(options.sessionId)}/messages`,
    options.apiBaseUrl,
  );
  let lastProblem = "target turn is not durable yet";
  let stableCandidate: string | undefined;
  let stableSince = 0;

  while (Date.now() <= deadline) {
    if (options.signal?.aborted) throw options.signal.reason;
    try {
      const response = await fetchBeforeDeadline({
        fetchFn,
        url,
        deadline,
        signal: options.signal,
      });
      const body = (await response.json()) as unknown;
      const record = recordValue(body);
      if (!response.ok || typeof record?.error === "string") {
        lastProblem =
          typeof record?.error === "string"
            ? record.error
            : `messages readback failed with HTTP ${response.status}`;
      } else {
        const parsed = Array.isArray(record?.messages)
          ? ({ messages: record.messages as PersistedSessionMessage[] } satisfies PersistedSessionMessages)
          : undefined;
        const ready = parsed
          ? options.readyWhen?.(parsed) ?? persistedTurnIsReady(parsed, options.turnId)
          : false;
        if (ready && parsed) {
          const candidate = JSON.stringify(
            parsed.messages.filter((message) => message.turn_id === options.turnId),
          );
          const now = Date.now();
          if (candidate !== stableCandidate) {
            stableCandidate = candidate;
            stableSince = now;
          }
          if (stabilityMs === 0 || now - stableSince >= stabilityMs) return parsed;
        } else {
          stableCandidate = undefined;
          stableSince = 0;
        }
      }
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      lastProblem = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline) break;
    await wait(pollIntervalMs, options.signal);
  }

  throw new Error(
    `timed out waiting for persisted agent turn ${options.turnId}: ${lastProblem}`,
  );
}
