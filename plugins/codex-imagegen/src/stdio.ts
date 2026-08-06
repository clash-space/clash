import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import {
  ExecutablePluginAssetHandleSchema,
  ExecutablePluginBrokerResponseSchema,
  ExecutablePluginInvocationSchema,
  ExecutablePluginResultSchema,
  type ExecutablePluginBrokerOperation,
  type ExecutablePluginInvocation,
  type ExecutablePluginJsonValue,
  type ExecutablePluginResult,
} from "@clash/shared-types/executable-plugin";

export const CODEX_IMAGEGEN_ACTION_ID = "codex-imagegen";

export interface CodexImageGenServices {
  broker(operation: ExecutablePluginBrokerOperation): Promise<ExecutablePluginJsonValue>;
}

function promptValue(invocation: ExecutablePluginInvocation): string {
  const value = invocation.input.values.prompt;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Codex ImageGen requires a non-empty prompt.");
  }
  return value.trim();
}

function aspectRatioValue(invocation: ExecutablePluginInvocation) {
  const value = invocation.input.values.aspect_ratio;
  return value === "16:9" || value === "9:16" || value === "4:3"
    || value === "3:4" || value === "21:9"
    ? value
    : "1:1";
}

export async function runCodexImageGeneration(
  input: unknown,
  services: CodexImageGenServices,
): Promise<ExecutablePluginResult> {
  const invocation = ExecutablePluginInvocationSchema.parse(input);
  const references = invocation.input.references
    .filter((reference) => "asset" in reference && reference.asset.kind === "image")
    .sort((left, right) => left.index - right.index)
    .map((reference) => {
      if (!("asset" in reference)) throw new Error("Expected an image asset reference.");
      return { ...reference.asset, kind: "image" as const };
    });

  const asset = ExecutablePluginAssetHandleSchema.parse(await services.broker({
    kind: "codex.image.generate",
    prompt: promptValue(invocation),
    aspectRatio: aspectRatioValue(invocation),
    slot: "image",
    references,
  }));

  return ExecutablePluginResultSchema.parse({
    protocol: "clash.plugin.result/v1",
    invocationId: invocation.invocationId,
    status: "completed",
    outputs: [{ slot: "image", kind: "asset", asset }],
  });
}

class StdioBroker {
  private readonly pending = new Map<string, {
    resolve(value: ExecutablePluginJsonValue): void;
    reject(error: Error): void;
  }>();

  request(invocationId: string, operation: ExecutablePluginBrokerOperation) {
    const requestId = randomUUID();
    return new Promise<ExecutablePluginJsonValue>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      process.stdout.write(`${JSON.stringify({
        protocol: "clash.plugin.broker-request/v1",
        requestId,
        invocationId,
        operation,
      })}\n`);
    });
  }

  accept(input: unknown): boolean {
    const parsed = ExecutablePluginBrokerResponseSchema.safeParse(input);
    if (!parsed.success) return false;
    const pending = this.pending.get(parsed.data.requestId);
    if (!pending) return true;
    this.pending.delete(parsed.data.requestId);
    if (parsed.data.status === "error") {
      pending.reject(new Error(`${parsed.data.error.code}: ${parsed.data.error.message}`));
    } else {
      pending.resolve(parsed.data.result);
    }
    return true;
  }
}

function failed(invocationId: string, error: unknown): ExecutablePluginResult {
  return ExecutablePluginResultSchema.parse({
    protocol: "clash.plugin.result/v1",
    invocationId,
    status: "failed",
    error: {
      code: "codex_imagegen_failed",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    },
  });
}

if (process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const broker = new StdioBroker();
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      process.stdout.write(`${JSON.stringify(failed("unknown", error))}\n`);
      return;
    }
    if (broker.accept(message)) return;
    const invocationId = message && typeof message === "object" && "invocationId" in message
      ? String((message as { invocationId: unknown }).invocationId)
      : "unknown";
    void runCodexImageGeneration(message, {
      broker: (operation) => broker.request(invocationId, operation),
    }).then(
      (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
      (error) => process.stdout.write(`${JSON.stringify(failed(invocationId, error))}\n`),
    );
  });
}
