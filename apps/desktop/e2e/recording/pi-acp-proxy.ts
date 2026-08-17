import { spawn } from "node:child_process";
import { chmod, open, rm, writeFile, type FileHandle } from "node:fs/promises";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

type JsonRecord = Record<string, unknown>;

export interface PiAcpDiagnosticRecord {
  schemaVersion: 1;
  layer: "acp";
  method: string;
  outcome: "ok" | "error";
  toolKind?: "bundled_clash_mcp" | "shell" | "filesystem" | "other";
  decisionKind?:
    | "allow_always"
    | "allow_once"
    | "reject_once"
    | "cancelled"
    | "unrecognized";
  code?: number;
  errorKind?: string;
  httpStatus?: number;
  retryable?: boolean;
}

function recordValue(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function requestKey(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number"
    ? `${typeof value}:${String(value)}`
    : undefined;
}

function safeDiagnosticToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_./:-]{1,120}$/u.test(value)
    ? value
    : undefined;
}

type PermissionToolKind = NonNullable<PiAcpDiagnosticRecord["toolKind"]>;
type PermissionDecisionKind = NonNullable<
  PiAcpDiagnosticRecord["decisionKind"]
>;

function permissionToolKind(value: unknown): PermissionToolKind {
  const message = recordValue(value);
  const params = recordValue(message?.params);
  const toolCall = recordValue(params?.toolCall);
  const meta = recordValue(toolCall?._meta);
  const toolName =
    typeof meta?.toolName === "string"
      ? meta.toolName
      : typeof toolCall?.title === "string"
        ? toolCall.title
        : "";
  if (/^mcp__clash__clash(?:_[a-z0-9]+)*$/u.test(toolName)) {
    return "bundled_clash_mcp";
  }
  if (toolName === "bash") return "shell";
  if (["read", "write", "edit", "ls", "find", "grep"].includes(toolName)) {
    return "filesystem";
  }
  return "other";
}

function permissionDecisionKind(value: unknown): PermissionDecisionKind {
  const message = recordValue(value);
  const result = recordValue(message?.result);
  const outcome = recordValue(result?.outcome);
  if (outcome?.outcome === "cancelled") return "cancelled";
  switch (outcome?.optionId) {
    case "allow_always":
    case "allow_once":
    case "reject_once":
      return outcome.optionId;
    default:
      return "unrecognized";
  }
}

export function createPiAcpDiagnosticTracker(
  record: (value: PiAcpDiagnosticRecord) => void,
): {
  observeInbound: (value: unknown) => void;
  observeOutbound: (value: unknown) => void;
} {
  const methods = new Map<string, string>();
  const permissions = new Map<string, PermissionToolKind>();
  return {
    observeInbound(value) {
      const message = recordValue(value);
      const key = requestKey(message?.id);
      const toolKind = key ? permissions.get(key) : undefined;
      if (key && toolKind) {
        permissions.delete(key);
        const error = recordValue(message?.error);
        const code =
          error && Number.isSafeInteger(error.code)
            ? (error.code as number)
            : undefined;
        record({
          schemaVersion: 1,
          layer: "acp",
          method: "session/request_permission",
          outcome: error ? "error" : "ok",
          toolKind,
          decisionKind: error
            ? "unrecognized"
            : permissionDecisionKind(message),
          ...(code === undefined ? {} : { code }),
        });
        return;
      }
      const method = safeDiagnosticToken(message?.method);
      if (key && method) methods.set(key, method);
    },
    observeOutbound(value) {
      const message = recordValue(value);
      const key = requestKey(message?.id);
      if (!key) return;
      if (message?.method === "session/request_permission") {
        permissions.set(key, permissionToolKind(message));
        return;
      }
      const method = methods.get(key);
      if (!method) return;
      methods.delete(key);
      const error = recordValue(message?.error);
      if (!error) {
        record({
          schemaVersion: 1,
          layer: "acp",
          method,
          outcome: "ok",
        });
        return;
      }
      const data = recordValue(error.data);
      const code = Number.isSafeInteger(error.code)
        ? (error.code as number)
        : undefined;
      const errorKind = safeDiagnosticToken(data?.errorKind);
      const httpStatus =
        Number.isSafeInteger(data?.httpStatus) &&
        Number(data?.httpStatus) >= 100 &&
        Number(data?.httpStatus) <= 599
          ? Number(data?.httpStatus)
          : undefined;
      const retryable =
        typeof data?.retryable === "boolean" ? data.retryable : undefined;
      record({
        schemaVersion: 1,
        layer: "acp",
        method,
        outcome: "error",
        ...(code === undefined ? {} : { code }),
        ...(errorKind === undefined ? {} : { errorKind }),
        ...(httpStatus === undefined ? {} : { httpStatus }),
        ...(retryable === undefined ? {} : { retryable }),
      });
    },
  };
}

function withStoredPiCredentialsFirst(value: unknown): unknown {
  const message = recordValue(value);
  const result = recordValue(message?.result);
  if (
    !message ||
    !result ||
    typeof result.protocolVersion !== "number" ||
    !Array.isArray(result.authMethods)
  ) {
    return value;
  }
  const storedIndex = result.authMethods.findIndex(
    (method) => recordValue(method)?.id === "pi-stored-credentials",
  );
  if (storedIndex <= 0) return value;
  const authMethods = [...result.authMethods];
  const [stored] = authMethods.splice(storedIndex, 1);
  authMethods.unshift(stored);
  return {
    ...message,
    result: {
      ...result,
      authMethods,
    },
  };
}

function withClashMcpIdentity(value: unknown): unknown {
  const message = recordValue(value);
  const params = recordValue(message?.params);
  const update = recordValue(params?.update);
  const meta = recordValue(update?._meta);
  if (
    !message ||
    message.method !== "session/update" ||
    !params ||
    !update ||
    update.sessionUpdate !== "tool_call" ||
    !meta ||
    typeof meta.toolName !== "string"
  ) {
    return value;
  }
  const match = /^mcp__clash__(clash(?:_[a-z0-9]+)*)$/u.exec(meta.toolName);
  if (!match?.[1]) return value;
  return {
    ...message,
    params: {
      ...params,
      update: {
        ...update,
        _meta: {
          ...meta,
          is_mcp_tool_call: true,
          mcp_server_name: "clash",
          mcp_tool_name: match[1],
        },
      },
    },
  };
}

export function annotatePiAcpMessage(value: unknown): unknown {
  return withClashMcpIdentity(withStoredPiCredentialsFirst(value));
}

async function writeStdout(line: string): Promise<void> {
  if (process.stdout.write(line)) return;
  await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
}

async function writeChildStdin(
  stream: NodeJS.WritableStream,
  line: string,
): Promise<void> {
  if (stream.write(line)) return;
  await new Promise<void>((resolve) => stream.once("drain", resolve));
}

async function openDiagnosticFile(): Promise<FileHandle | undefined> {
  const filePath = process.env.CLASH_PI_ACP_DIAGNOSTICS_PATH?.trim();
  if (!filePath) return undefined;
  const file = await open(filePath, "a", 0o600);
  await file.chmod(0o600);
  return file;
}

export interface PiProcessSidecar {
  proxyPid: number;
  childPid: number;
}

export async function writePiProcessSidecar(
  filePath: string,
  record: PiProcessSidecar,
): Promise<void> {
  if (
    !Number.isSafeInteger(record.proxyPid) ||
    record.proxyPid <= 0 ||
    !Number.isSafeInteger(record.childPid) ||
    record.childPid <= 0 ||
    record.proxyPid === record.childPid
  ) {
    throw new Error("Pi process lifecycle record requires distinct valid PIDs");
  }
  await writeFile(filePath, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(filePath, 0o600);
}

export async function runPiAcpRecordingProxy(
  piAcpEntryPath: string,
): Promise<number> {
  if (piAcpEntryPath.trim().length === 0) {
    throw new Error("Pi ACP recording proxy requires an entry path");
  }
  const diagnosticFile = await openDiagnosticFile();
  let diagnosticWrites = Promise.resolve();
  const tracker = createPiAcpDiagnosticTracker((record) => {
    if (!diagnosticFile) return;
    diagnosticWrites = diagnosticWrites.then(async () => {
      await diagnosticFile.appendFile(`${JSON.stringify(record)}\n`, "utf8");
    });
  });
  const child = spawn(process.execPath, [piAcpEntryPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!Number.isSafeInteger(child.pid) || Number(child.pid) <= 0) {
    child.kill("SIGKILL");
    await diagnosticFile?.close();
    throw new Error("Pi ACP recording proxy child has no valid PID");
  }
  const processSidecarPath = process.env.CLASH_PI_ACP_PID_PATH?.trim();
  if (processSidecarPath) {
    try {
      await writePiProcessSidecar(processSidecarPath, {
        proxyPid: process.pid,
        childPid: child.pid as number,
      });
    } catch (error) {
      child.kill("SIGKILL");
      await diagnosticFile?.close();
      throw error;
    }
  }
  child.stderr.pipe(process.stderr);

  const inputLines = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  const forwardInput = (async () => {
    for await (const line of inputLines) {
      try {
        tracker.observeInbound(JSON.parse(line));
      } catch {
        // The proxy must preserve non-JSON input for the underlying ACP.
      }
      await writeChildStdin(child.stdin, `${line}\n`);
    }
    if (!child.stdin.destroyed) child.stdin.end();
  })();

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
  };
  const onSigint = () => forwardSignal("SIGINT");
  const onSigterm = () => forwardSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const forwardOutput = (async () => {
    for await (const line of lines) {
      let output = line;
      try {
        const parsed = JSON.parse(line);
        tracker.observeOutbound(parsed);
        output = JSON.stringify(annotatePiAcpMessage(parsed));
      } catch {
        // Preserve non-JSON diagnostics exactly; the underlying ACP owns stdout.
      }
      await writeStdout(`${output}\n`);
    }
  })();
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
  inputLines.close();
  await forwardOutput;
  await forwardInput;
  await diagnosticWrites;
  await diagnosticFile?.close();
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  if (processSidecarPath) {
    await rm(processSidecarPath, { force: true });
  }
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await runPiAcpRecordingProxy(process.argv[2] ?? "");
  } catch (error) {
    console.error(
      "Pi ACP recording proxy failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  }
}
