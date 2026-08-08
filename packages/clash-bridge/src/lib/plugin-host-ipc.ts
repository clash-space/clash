import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ExecutablePluginBindingSchema,
  ExecutablePluginCardRegistrationSchema,
  ExecutablePluginInvocationSchema,
  ExecutablePluginResultSchema,
  type ExecutablePluginBinding,
  type ExecutablePluginCardRegistration,
  type ExecutablePluginInvocation,
  type ExecutablePluginResult,
} from "@clash/shared-types";

import { paths } from "./platform.js";

type PluginFunctionKind = "action" | "provider-projector";

export interface PluginInvocationHost {
  listCards(): ExecutablePluginCardRegistration[];
  resolveBinding(
    pluginId: string,
    exportId: string,
    kind: PluginFunctionKind,
  ): ExecutablePluginBinding;
  invoke(
    pluginId: string,
    invocation: unknown,
    options?: { timeoutMs?: number },
  ): Promise<ExecutablePluginResult>;
}

interface PluginHostRequestBase {
  protocol: "clash.plugin-host/v1";
  requestId: string;
}

type PluginHostRequest = PluginHostRequestBase & ({
  operation: "list-cards";
} | {
  operation: "resolve";
  pluginId: string;
  exportId: string;
  kind: PluginFunctionKind;
} | {
  operation: "invoke";
  pluginId: string;
  invocation: ExecutablePluginInvocation;
  timeoutMs?: number;
});

type PluginHostResponse = {
  protocol: "clash.plugin-host/v1";
  requestId: string;
  status: "ok";
  result: unknown;
} | {
  protocol: "clash.plugin-host/v1";
  requestId: string;
  status: "error";
  error: { code: string; message: string };
};

const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
// macOS permits at most 103 address bytes for a Unix-domain socket (Linux
// permits 107). Keep a little headroom so the same path is portable and Node
// never silently binds a truncated address that cannot subsequently be chmod'd.
const UNIX_SOCKET_PATH_BUDGET_BYTES = 96;

// Starting two embedded hosts for the same Unix socket must be one atomic
// operation. Without this queue, both callers can observe a stale/missing
// path, then one caller can unlink the socket after the other has started
// listening but before it chmods the path. The resulting ENOENT takes down
// the local daemon and leaves neither caller as a reliable owner.
const socketStartupTails = new Map<string, Promise<void>>();

async function withSocketStartupLock<T>(
  socketPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = socketStartupTails.get(socketPath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  socketStartupTails.set(socketPath, current);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (socketStartupTails.get(socketPath) === current) {
      socketStartupTails.delete(socketPath);
    }
  }
}

export function pluginHostSocketPath(
  env: Record<string, string | undefined> = process.env,
  configDir = paths().configDir,
): string {
  const explicit = env.CLASH_PLUGIN_HOST_SOCKET?.trim();
  if (explicit) return explicit;
  if (process.platform === "win32") {
    const suffix = createHash("sha256").update(configDir).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\clash-plugin-host-${suffix}`;
  }
  const preferred = join(configDir, "sockets", "plugin-host.sock");
  if (Buffer.byteLength(preferred) <= UNIX_SOCKET_PATH_BUDGET_BYTES) return preferred;

  const suffix = createHash("sha256").update(configDir).digest("hex").slice(0, 16);
  const basename = `clash-plugin-host-${suffix}.sock`;
  const temporary = join(tmpdir(), basename);
  return Buffer.byteLength(temporary) <= UNIX_SOCKET_PATH_BUDGET_BYTES
    ? temporary
    : join("/tmp", basename);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value;
}

function parseRequest(value: unknown): PluginHostRequest {
  if (!value || typeof value !== "object") throw new Error("Plugin host request must be an object.");
  const request = value as Record<string, unknown>;
  if (request.protocol !== "clash.plugin-host/v1") throw new Error("Unsupported plugin host protocol.");
  const requestId = nonEmptyString(request.requestId, "requestId");
  if (request.operation === "list-cards") {
    return {
      protocol: "clash.plugin-host/v1",
      requestId,
      operation: "list-cards",
    };
  }
  const pluginId = nonEmptyString(request.pluginId, "pluginId");
  if (request.operation === "resolve") {
    if (request.kind !== "action" && request.kind !== "provider-projector") {
      throw new Error("Invalid plugin function kind.");
    }
    return {
      protocol: "clash.plugin-host/v1",
      requestId,
      operation: "resolve",
      pluginId,
      exportId: nonEmptyString(request.exportId, "exportId"),
      kind: request.kind,
    };
  }
  if (request.operation === "invoke") {
    const timeoutMs = request.timeoutMs === undefined
      ? undefined
      : Number(request.timeoutMs);
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      throw new Error("timeoutMs must be positive.");
    }
    return {
      protocol: "clash.plugin-host/v1",
      requestId,
      operation: "invoke",
      pluginId,
      invocation: ExecutablePluginInvocationSchema.parse(request.invocation),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    };
  }
  throw new Error("Unknown plugin host operation.");
}

function writeResponse(socket: Socket, response: PluginHostResponse): void {
  socket.end(`${JSON.stringify(response)}\n`);
}

async function handleRequest(host: PluginInvocationHost, input: unknown): Promise<PluginHostResponse> {
  let requestId = "unknown";
  try {
    if (input && typeof input === "object" && "requestId" in input) {
      requestId = String((input as { requestId: unknown }).requestId);
    }
    const request = parseRequest(input);
    requestId = request.requestId;
    if (request.operation === "list-cards") {
      return {
        protocol: "clash.plugin-host/v1",
        requestId,
        status: "ok",
        result: ExecutablePluginCardRegistrationSchema.array().parse(host.listCards()),
      };
    }
    if (request.operation === "resolve") {
      return {
        protocol: "clash.plugin-host/v1",
        requestId,
        status: "ok",
        result: ExecutablePluginBindingSchema.parse(host.resolveBinding(
          request.pluginId,
          request.exportId,
          request.kind,
        )),
      };
    }
    return {
      protocol: "clash.plugin-host/v1",
      requestId,
      status: "ok",
      result: ExecutablePluginResultSchema.parse(await host.invoke(
        request.pluginId,
        request.invocation,
        request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs },
      )),
    };
  } catch (error) {
    return {
      protocol: "clash.plugin-host/v1",
      requestId,
      status: "error",
      error: {
        code: "plugin_host_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export interface PluginHostIpcServer {
  socketPath: string;
  close(): Promise<void>;
}

async function socketIsActive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const finish = (active: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(active);
    };
    const timer = setTimeout(() => finish(false), 200);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export async function startPluginHostIpcServer(options: {
  host: PluginInvocationHost;
  socketPath?: string;
}): Promise<PluginHostIpcServer> {
  const socketPath = options.socketPath ?? pluginHostSocketPath();
  return withSocketStartupLock(socketPath, async () => {
    if (process.platform !== "win32") {
      await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
      if (await socketIsActive(socketPath)) {
        const error = new Error(`Clash plugin host is already listening at ${socketPath}.`) as NodeJS.ErrnoException;
        error.code = "EADDRINUSE";
        throw error;
      }
      await unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    const server: Server = createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) {
          writeResponse(socket, {
            protocol: "clash.plugin-host/v1",
            requestId: "unknown",
            status: "error",
            error: { code: "message_too_large", message: "Plugin host request is too large." },
          });
          return;
        }
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = "";
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch (error) {
          writeResponse(socket, {
            protocol: "clash.plugin-host/v1",
            requestId: "unknown",
            status: "error",
            error: { code: "invalid_json", message: (error as Error).message },
          });
          return;
        }
        void handleRequest(options.host, message).then((response) => writeResponse(socket, response));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    if (process.platform !== "win32") await chmod(socketPath, 0o600);

    return {
      socketPath,
      close: async () => {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
        if (process.platform !== "win32") {
          await unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
        }
      },
    };
  });
}

export class PluginHostClient {
  private readonly socketPath: string;
  private readonly timeoutMs: number;

  constructor(options: { socketPath?: string; timeoutMs?: number } = {}) {
    this.socketPath = options.socketPath ?? pluginHostSocketPath();
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async listCards(): Promise<ExecutablePluginCardRegistration[]> {
    return ExecutablePluginCardRegistrationSchema.array().parse(await this.request({
      protocol: "clash.plugin-host/v1",
      requestId: randomUUID(),
      operation: "list-cards",
    }));
  }

  async resolveBinding(
    pluginId: string,
    exportId: string,
    kind: PluginFunctionKind,
  ): Promise<ExecutablePluginBinding> {
    return ExecutablePluginBindingSchema.parse(await this.request({
      protocol: "clash.plugin-host/v1",
      requestId: randomUUID(),
      operation: "resolve",
      pluginId,
      exportId,
      kind,
    }));
  }

  async invoke(
    pluginId: string,
    invocation: ExecutablePluginInvocation,
    options: { timeoutMs?: number } = {},
  ): Promise<ExecutablePluginResult> {
    return ExecutablePluginResultSchema.parse(await this.request({
      protocol: "clash.plugin-host/v1",
      requestId: randomUUID(),
      operation: "invoke",
      pluginId,
      invocation: ExecutablePluginInvocationSchema.parse(invocation),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    }));
  }

  private request(request: PluginHostRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      let buffer = "";
      let settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve(value);
      };
      const requestTimeoutMs = request.operation === "invoke" && request.timeoutMs
        ? Math.max(this.timeoutMs, request.timeoutMs + 1_000)
        : this.timeoutMs;
      const timer = setTimeout(
        () => finish(new Error("Clash plugin host IPC timed out.")),
        requestTimeoutMs,
      );
      socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) {
          finish(new Error("Clash plugin host response is too large."));
          return;
        }
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        try {
          const response = JSON.parse(buffer.slice(0, newline)) as PluginHostResponse;
          if (response.protocol !== "clash.plugin-host/v1" || response.requestId !== request.requestId) {
            throw new Error("Clash plugin host returned a mismatched response.");
          }
          if (response.status === "error") finish(new Error(response.error.message));
          else finish(undefined, response.result);
        } catch (error) {
          finish(error as Error);
        }
      });
      socket.once("error", (error) => finish(error));
      socket.once("close", () => {
        if (!settled) finish(new Error("Clash plugin host closed without a response."));
      });
    });
  }
}
