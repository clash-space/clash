import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import {
  ExecutablePluginBrokerRequestSchema,
  ExecutablePluginBrokerResponseSchema,
  ExecutablePluginInvocationSchema,
  ExecutablePluginManifestSchema,
  ExecutablePluginResultSchema,
  executablePluginBrokerPermissionError,
  type ExecutablePluginBrokerRequest,
  type ExecutablePluginInvocation,
  type ExecutablePluginJsonValue,
  type ExecutablePluginManifest,
  type ExecutablePluginResult,
} from "@clash/shared-types";

export type PluginBroker = (
  request: ExecutablePluginBrokerRequest,
  context: {
    manifest: ExecutablePluginManifest;
    invocation: ExecutablePluginInvocation;
  },
) => Promise<ExecutablePluginJsonValue>;

export interface PluginStdioSessionOptions {
  manifest: unknown;
  stdin: Writable;
  stdout: Readable;
  broker: PluginBroker;
}

interface PendingInvocation {
  invocation: ExecutablePluginInvocation;
  resolve: (result: ExecutablePluginResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export { executablePluginBrokerPermissionError };

export class PluginStdioSession {
  readonly manifest: ExecutablePluginManifest;
  private readonly stdin: Writable;
  private readonly broker: PluginBroker;
  private readonly lines: ReadlineInterface;
  private readonly pending = new Map<string, PendingInvocation>();
  private closed = false;

  constructor(options: PluginStdioSessionOptions) {
    this.manifest = ExecutablePluginManifestSchema.parse(options.manifest);
    if (this.manifest.runtime.kind !== "local" || this.manifest.runtime.transport !== "stdio") {
      throw new Error(`Plugin ${this.manifest.id} is not a local stdio plugin.`);
    }
    this.stdin = options.stdin;
    this.broker = options.broker;
    this.lines = createInterface({ input: options.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => {
      void this.onLine(line);
    });
    this.lines.on("close", () => {
      this.failAll(new Error(`Plugin ${this.manifest.id} closed its stdio channel.`));
    });
  }

  invoke(input: unknown, options: { timeoutMs?: number } = {}): Promise<ExecutablePluginResult> {
    if (this.closed) return Promise.reject(new Error(`Plugin ${this.manifest.id} session is closed.`));
    const invocation = ExecutablePluginInvocationSchema.parse(input);
    if (invocation.target.pluginId !== this.manifest.id
      || invocation.target.version !== this.manifest.version) {
      return Promise.reject(new Error(
        `Invocation target ${invocation.target.pluginId}@${invocation.target.version} does not match `
          + `${this.manifest.id}@${this.manifest.version}.`,
      ));
    }
    const exported = this.manifest.exports.functions.find(
      (entry) => entry.id === invocation.target.exportId && entry.kind === invocation.target.kind,
    );
    if (!exported) {
      return Promise.reject(new Error(
        `Plugin ${this.manifest.id} does not export ${invocation.target.kind} ${invocation.target.exportId}.`,
      ));
    }
    if (this.pending.has(invocation.invocationId)) {
      return Promise.reject(new Error(`Invocation ${invocation.invocationId} is already running.`));
    }

    return new Promise<ExecutablePluginResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(invocation.invocationId);
        reject(new Error(`Plugin invocation ${invocation.invocationId} timed out.`));
      }, options.timeoutMs ?? 120_000);
      this.pending.set(invocation.invocationId, { invocation, resolve, reject, timer });
      this.write(invocation);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    this.failAll(new Error(`Plugin ${this.manifest.id} session closed.`));
  }

  private async onLine(line: string): Promise<void> {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.failAll(new Error(`Plugin ${this.manifest.id} emitted invalid JSON on stdout.`));
      return;
    }
    if (!message || typeof message !== "object") return;
    const protocol = (message as { protocol?: unknown }).protocol;
    if (protocol === "clash.plugin.result/v1") {
      this.acceptResult(message);
      return;
    }
    if (protocol === "clash.plugin.broker-request/v1") {
      await this.acceptBrokerRequest(message);
    }
  }

  private acceptResult(message: unknown): void {
    const result = ExecutablePluginResultSchema.parse(message);
    const pending = this.pending.get(result.invocationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(result.invocationId);
    pending.resolve(result);
  }

  private async acceptBrokerRequest(message: unknown): Promise<void> {
    let request: ExecutablePluginBrokerRequest;
    try {
      request = ExecutablePluginBrokerRequestSchema.parse(message);
    } catch (error) {
      this.failAll(new Error(`Plugin ${this.manifest.id} emitted an invalid broker request: ${(error as Error).message}`));
      return;
    }
    const pending = this.pending.get(request.invocationId);
    if (!pending) {
      this.writeBrokerError(request.requestId, "unknown_invocation", "Invocation is not active.");
      return;
    }
    const permissionError = executablePluginBrokerPermissionError(this.manifest, request);
    if (permissionError) {
      this.writeBrokerError(request.requestId, "permission_denied", permissionError);
      return;
    }
    try {
      const result = await this.broker(request, {
        manifest: this.manifest,
        invocation: pending.invocation,
      });
      this.write(ExecutablePluginBrokerResponseSchema.parse({
        protocol: "clash.plugin.broker-response/v1",
        requestId: request.requestId,
        status: "ok",
        result,
      }));
    } catch (error) {
      this.writeBrokerError(request.requestId, "broker_error", (error as Error).message);
    }
  }

  private writeBrokerError(requestId: string, code: string, message: string): void {
    this.write(ExecutablePluginBrokerResponseSchema.parse({
      protocol: "clash.plugin.broker-response/v1",
      requestId,
      status: "error",
      error: { code, message },
    }));
  }

  private write(message: ExecutablePluginInvocation | object): void {
    this.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
