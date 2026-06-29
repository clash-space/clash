import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
} from "@agentclientprotocol/sdk";
import type {
  CancelNotification,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionModeState,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from "@agentclientprotocol/sdk";

interface CodexSession {
  cwd: string;
  modeId: string;
  pending?: AbortController;
}

interface RunCodexDebugOptions {
  codexCommand: string;
  cwd: string;
  prompt: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onEvent?: (event: CodexAcpUpdate) => void | Promise<void>;
}

export type CodexAcpUpdate =
  | { sessionUpdate: "agent_message_chunk"; messageId?: string; content: { type: "text"; text: string } }
  | { sessionUpdate: "agent_thought_chunk"; messageId?: string; content: { type: "text"; text: string } }
  | {
      sessionUpdate: "tool_call" | "tool_call_update";
      toolCallId: string;
      title: string;
      kind?: string;
      status?: string;
      rawInput?: unknown;
      rawOutput?: unknown;
      content?: Array<{ type: "content"; content: { type: "text"; text: string } }>;
    }
  | { sessionUpdate: "plan"; entries: Array<{ content: string; status: string }> };

export interface ParsedCodexAppServerOutput {
  finalText: string | null;
  events: CodexAcpUpdate[];
}

function codexPermissionArgs(permissionMode: string | undefined): string[] {
  const mode = permissionMode?.split(":").pop();
  switch (mode) {
    case "review":
      return ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"];
    case "full-access":
      return ["--dangerously-bypass-approvals-and-sandbox"];
    default:
      return [];
  }
}

const CODEX_DEFAULT_MODE_ID = "codex:review";
const CODEX_SESSION_MODES: SessionModeState["availableModes"] = [
  { id: "codex:review", name: "Review", description: "Ask before applying changes" },
  { id: "codex:full-access", name: "Full access", description: "Codex can edit and run tools" },
];

function codexSessionModeState(currentModeId: string): SessionModeState {
  return {
    currentModeId,
    availableModes: CODEX_SESSION_MODES.map((mode) => ({ ...mode })),
  };
}

function isCodexSessionMode(modeId: string): boolean {
  return CODEX_SESSION_MODES.some((mode) => mode.id === modeId);
}

function unquoteDebugString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function stripCodexWirePrefix(line: string): string | null {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("< ")) return null;
  return trimmed.slice(2);
}

function braceDelta(line: string): number {
  let delta = 0;
  let inString = false;
  let escaped = false;
  for (const char of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") delta += 1;
    if (char === "}") delta -= 1;
  }
  return delta;
}

export function extractCodexFinalAgentText(output: string): string | null {
  return parseCodexAppServerOutput(output).finalText;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        const record = asRecord(part);
        if (!record) return "";
        if (typeof record.text === "string") return record.text;
        if (typeof record.content === "string") return record.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.text === "string") return record.text;
  if (typeof record.summary === "string") return record.summary;
  if (typeof record.summaryText === "string") return record.summaryText;
  if (typeof record.content === "string") return record.content;
  return textFromContent(record.content);
}

function messageIdFromItem(item: Record<string, unknown> | null | undefined): string | undefined {
  const id = item?.id ?? item?.messageId ?? item?.message_id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function codexStatusToAcp(status: unknown, completed: boolean): string {
  if (typeof status !== "string") return completed ? "completed" : "in_progress";
  switch (status) {
    case "inProgress":
    case "in_progress":
    case "running":
      return "in_progress";
    case "completed":
    case "success":
      return "completed";
    case "failed":
    case "error":
    case "cancelled":
    case "canceled":
      return "failed";
    default:
      return completed ? "completed" : status;
  }
}

function toolKindForCodexItem(type: string): string {
  switch (type) {
    case "commandExecution":
      return "execute";
    case "fileChange":
    case "patchApply":
    case "fileEdit":
      return "edit";
    case "webSearch":
    case "search":
      return "search";
    case "mcpToolCall":
    case "toolCall":
    case "functionCall":
      return "execute";
    default:
      return "execute";
  }
}

function compactRawInput(item: Record<string, unknown>, type: string): Record<string, unknown> {
  if (type === "commandExecution") {
    return {
      ...(typeof item.command === "string" ? { command: item.command } : {}),
      ...(typeof item.cwd === "string" ? { cwd: item.cwd } : {}),
    };
  }
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (["aggregatedOutput", "output", "result", "status", "durationMs", "exitCode"].includes(key)) continue;
    raw[key] = value;
  }
  return raw;
}

function codexItemTitle(item: Record<string, unknown>, type: string): string {
  const title = item.title ?? item.name ?? item.toolName ?? item.command ?? item.path ?? item.id;
  if (typeof title === "string" && title.trim()) return title;
  return type.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function codexItemOutput(item: Record<string, unknown>): unknown {
  if (item.aggregatedOutput !== undefined && item.aggregatedOutput !== null) return item.aggregatedOutput;
  if (item.output !== undefined && item.output !== null) return item.output;
  if (item.result !== undefined && item.result !== null) return item.result;
  if (item.exitCode !== undefined || item.durationMs !== undefined) {
    return {
      ...(item.exitCode !== undefined ? { exitCode: item.exitCode } : {}),
      ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
    };
  }
  return undefined;
}

function codexItemToToolUpdate(method: string, item: Record<string, unknown>, type: string): CodexAcpUpdate | null {
  const id = typeof item.id === "string" && item.id ? item.id : `${type}-${randomUUID()}`;
  const completed = method === "item/completed";
  const rawOutput = completed ? codexItemOutput(item) : undefined;
  return {
    sessionUpdate: completed ? "tool_call_update" : "tool_call",
    toolCallId: id,
    title: codexItemTitle(item, type),
    kind: toolKindForCodexItem(type),
    status: codexStatusToAcp(item.status, completed),
    rawInput: compactRawInput(item, type),
    ...(rawOutput !== undefined ? { rawOutput } : {}),
  };
}

function methodEventToAcp(parsed: Record<string, unknown>): { events: CodexAcpUpdate[]; finalText?: string } {
  const method = typeof parsed.method === "string" ? parsed.method : "";
  const params = asRecord(parsed.params);
  const item = asRecord(params?.item);
  const events: CodexAcpUpdate[] = [];

  if (method === "item/agentMessage/delta") {
    const text = textFromContent(params?.delta ?? params?.text ?? params?.content);
    if (text) {
      const messageId = messageIdFromItem(item ?? params);
      events.push({
        sessionUpdate: "agent_message_chunk",
        ...(messageId ? { messageId } : {}),
        content: { type: "text", text },
      });
    }
    return { events };
  }

  if (method === "item/reasoning/textDelta" || method === "item/reasoning/summaryTextDelta") {
    const text = textFromContent(params?.delta ?? params?.text ?? params?.content);
    if (text) {
      const messageId = messageIdFromItem(item ?? params);
      events.push({
        sessionUpdate: "agent_thought_chunk",
        ...(messageId ? { messageId } : {}),
        content: { type: "text", text },
      });
    }
    return { events };
  }

  if (!item || (method !== "item/started" && method !== "item/completed")) {
    return { events };
  }

  const type = typeof item.type === "string" ? item.type : "";
  if (!type || type === "userMessage") return { events };

  if (type === "agentMessage") {
    if (method !== "item/completed") return { events };
    const text = textFromContent(item.text ?? item.content);
    if (text) {
      const messageId = messageIdFromItem(item);
      events.push({
        sessionUpdate: "agent_message_chunk",
        ...(messageId ? { messageId } : {}),
        content: { type: "text", text },
      });
    }
    return { events, finalText: text || undefined };
  }

  if (type === "reasoning") {
    if (method !== "item/completed") return { events };
    const text = textFromContent(item.text ?? item.summary ?? item.summaryText ?? item.content);
    if (text) {
      const messageId = messageIdFromItem(item);
      events.push({
        sessionUpdate: "agent_thought_chunk",
        ...(messageId ? { messageId } : {}),
        content: { type: "text", text },
      });
    }
    return { events };
  }

  if (type === "plan") {
    if (method !== "item/completed") return { events };
    const text = textFromContent(item.text ?? item.content ?? item.plan);
    if (text) {
      events.push({ sessionUpdate: "plan", entries: [{ content: text, status: "in_progress" }] });
    }
    return { events };
  }

  const tool = codexItemToToolUpdate(method, item, type);
  if (tool) events.push(tool);
  return { events };
}

class CodexAppServerOutputParser {
  finalText: string | null = null;
  readonly events: CodexAcpUpdate[] = [];

  #lineBuffer = "";
  #jsonBlock: string[] = [];
  #balance = 0;

  consume(chunk: string): CodexAcpUpdate[] {
    const text = this.#lineBuffer + chunk;
    const lines = text.split(/\n/);
    this.#lineBuffer = lines.pop() ?? "";
    const events: CodexAcpUpdate[] = [];
    for (const line of lines) {
      this.#consumeLine(line.replace(/\r$/, ""), events);
    }
    return events;
  }

  finish(): CodexAcpUpdate[] {
    const events: CodexAcpUpdate[] = [];
    if (this.#lineBuffer) {
      this.#consumeLine(this.#lineBuffer.replace(/\r$/, ""), events);
      this.#lineBuffer = "";
    }
    return events;
  }

  #consumeLine(line: string, events: CodexAcpUpdate[]): void {
    const completed = line.match(/< item completed: AgentMessage \{.* text: "((?:[^"\\]|\\.)*)"/);
    if (completed?.[1]) this.finalText = unquoteDebugString(completed[1]);

    const prefixed = stripCodexWirePrefix(line);
    if (prefixed !== null) {
      const trimmed = prefixed.trim();
      if (this.#jsonBlock.length > 0 || trimmed.startsWith("{")) {
        this.#jsonBlock.push(prefixed);
        this.#balance += braceDelta(prefixed);
        if (this.#jsonBlock.length > 0 && this.#balance <= 0) {
          try {
            const parsed = JSON.parse(this.#jsonBlock.join("\n")) as Record<string, unknown>;
            const normalized = methodEventToAcp(parsed);
            if (normalized.finalText) this.finalText = normalized.finalText;
            this.events.push(...normalized.events);
            events.push(...normalized.events);
          } catch {
            // Codex's debug helper also prints non-JSON diagnostic lines
            // with the same "< " prefix. Ignore those and keep scanning.
          } finally {
            this.#jsonBlock = [];
            this.#balance = 0;
          }
        }
      }
    }
  }
}

export function parseCodexAppServerOutput(output: string): ParsedCodexAppServerOutput {
  const parser = new CodexAppServerOutputParser();
  parser.consume(output);
  parser.finish();
  return { finalText: parser.finalText, events: parser.events };
}

function extractPromptText(params: PromptRequest): string {
  return params.prompt
    .map((part) => {
      if ((part as { type?: string }).type === "text") {
        return (part as { text?: string }).text ?? "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export async function runCodexDebug(options: RunCodexDebugOptions): Promise<string> {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.env ?? {}),
    CLASH_CODEX_APP_SERVER_ACP: "1",
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const child: ChildProcess = spawn(
    options.codexCommand,
    [
      ...codexPermissionArgs(childEnv.CLASH_PERMISSION_MODE),
      "debug",
      "app-server",
      "send-message-v2",
      options.prompt,
    ],
    {
      cwd: options.cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  const parser = options.onEvent ? new CodexAppServerOutputParser() : null;
  let eventQueue = Promise.resolve();
  const queueEvents = (events: CodexAcpUpdate[]) => {
    if (!options.onEvent || events.length === 0) return;
    eventQueue = eventQueue.then(async () => {
      for (const event of events) {
        await options.onEvent?.(event);
      }
    });
  };
  const append = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    output += text;
    if (parser) queueEvents(parser.consume(text));
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  const killOnAbort = () => child.kill("SIGTERM");
  options.signal?.addEventListener("abort", killOnAbort, { once: true });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  }).finally(() => {
    options.signal?.removeEventListener("abort", killOnAbort);
  });

  if (options.signal?.aborted) {
    throw new Error("Codex turn cancelled");
  }
  if (exit.code !== 0) {
    const tail = output.trim().split(/\r?\n/).slice(-12).join("\n");
    throw new Error(`Codex app-server exited with ${exit.signal ?? exit.code ?? "unknown"}${tail ? `\n${tail}` : ""}`);
  }

  const parsed = parser
    ? (() => {
        queueEvents(parser.finish());
        return { finalText: parser.finalText, events: parser.events };
      })()
    : parseCodexAppServerOutput(output);
  await eventQueue;
  return parsed.finalText ?? output.trim();
}

class CodexAppServerAcpAgent implements Agent {
  private readonly sessions = new Map<string, CodexSession>();

  constructor(
    private readonly connection: AgentSideConnection,
    private readonly codexCommand: string,
  ) {}

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {},
      },
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = randomUUID();
    const modeId = CODEX_DEFAULT_MODE_ID;
    this.sessions.set(sessionId, {
      cwd: params.cwd || process.cwd(),
      modeId,
    });
    return { sessionId, modes: codexSessionModeState(modeId) };
  }

  async authenticate(): Promise<Record<string, never>> {
    return {};
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Session ${params.sessionId} not found`);
    if (!isCodexSessionMode(params.modeId)) throw new Error(`Unknown Codex session mode: ${params.modeId}`);
    session.modeId = params.modeId;
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: params.modeId,
      },
    });
    return {};
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Session ${params.sessionId} not found`);

    session.pending?.abort();
    const pending = new AbortController();
    session.pending = pending;

    try {
      const prompt = extractPromptText(params);
      let emittedUpdate = false;
      const text = await runCodexDebug({
        codexCommand: this.codexCommand,
        cwd: session.cwd,
        prompt,
        env: { CLASH_PERMISSION_MODE: session.modeId },
        signal: pending.signal,
        onEvent: async (event) => {
          emittedUpdate = true;
          await this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: event as never,
          });
        },
      });
      if (!emittedUpdate && text.length > 0) {
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        });
      }
      return { stopReason: "end_turn" };
    } catch (error) {
      if (pending.signal.aborted) return { stopReason: "cancelled" };
      throw error;
    } finally {
      if (session.pending === pending) delete session.pending;
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    this.sessions.get(params.sessionId)?.pending?.abort();
  }
}

function parseArgs(argv: string[]): { codexCommand: string } {
  const codexFlag = argv.indexOf("--codex");
  if (codexFlag >= 0 && argv[codexFlag + 1]) {
    return { codexCommand: argv[codexFlag + 1] };
  }
  return { codexCommand: "codex" };
}

export function startCodexAppServerAcp(argv = process.argv.slice(2)): void {
  const { codexCommand } = parseArgs(argv);
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);
  new AgentSideConnection((conn) => new CodexAppServerAcpAgent(conn, codexCommand), stream);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  startCodexAppServerAcp();
}
