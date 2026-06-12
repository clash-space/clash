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
} from "@agentclientprotocol/sdk";

interface CodexSession {
  cwd: string;
  pending?: AbortController;
}

interface RunCodexDebugOptions {
  codexCommand: string;
  cwd: string;
  prompt: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
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
  let latest: string | null = null;
  const lines = output.split(/\r?\n/);
  let jsonBlock: string[] = [];
  let balance = 0;

  for (const line of lines) {
    const prefixed = stripCodexWirePrefix(line);
    if (prefixed) {
      const trimmed = prefixed.trim();
      if (jsonBlock.length > 0 || trimmed.startsWith("{")) {
        jsonBlock.push(prefixed);
        balance += braceDelta(prefixed);
        if (jsonBlock.length > 0 && balance <= 0) {
          try {
            const parsed = JSON.parse(jsonBlock.join("\n")) as {
              method?: string;
              params?: { item?: { type?: string; text?: string } };
            };
            const item = parsed.params?.item;
            if (parsed.method === "item/completed" && item?.type === "agentMessage" && item.text) {
              latest = item.text;
            }
          } catch {
            // Codex's debug helper also prints non-JSON diagnostic lines
            // with the same "< " prefix. Ignore those and keep scanning.
          } finally {
            jsonBlock = [];
            balance = 0;
          }
        }
      }
    }

    const completed = line.match(/< item completed: AgentMessage \{.* text: "((?:[^"\\]|\\.)*)"/);
    if (completed?.[1]) latest = unquoteDebugString(completed[1]);
  }

  return latest;
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
    ["debug", "app-server", "send-message-v2", options.prompt],
    {
      cwd: options.cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  const append = (chunk: Buffer) => {
    output += chunk.toString("utf8");
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

  return extractCodexFinalAgentText(output) ?? output.trim();
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
    this.sessions.set(sessionId, {
      cwd: params.cwd || process.cwd(),
    });
    return { sessionId };
  }

  async authenticate(): Promise<Record<string, never>> {
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
      const text = await runCodexDebug({
        codexCommand: this.codexCommand,
        cwd: session.cwd,
        prompt,
        signal: pending.signal,
      });
      if (text.length > 0) {
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
