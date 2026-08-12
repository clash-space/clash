import { randomUUID } from "node:crypto";

import {
  ExecutablePluginBindingSchema,
  ExecutablePluginInvocationSchema,
  ExecutablePluginResultSchema,
  type ExecutablePluginBinding,
  type ExecutablePluginInvocation,
  type ExecutablePluginResult,
} from "@clash/shared-types";

import type {
  ProviderPluginProjector,
  ProviderPluginProjection,
} from "./local-aigc.js";
import { ProviderPluginHostUnavailableError } from "./local-aigc.js";

export interface PluginHostClient {
  resolveBinding(
    pluginId: string,
    exportId: string,
    kind: "action" | "provider-projector",
  ): Promise<ExecutablePluginBinding>;
  invoke(
    pluginId: string,
    invocation: ExecutablePluginInvocation,
  ): Promise<ExecutablePluginResult>;
}

function projectionFromResult(resultInput: unknown): ProviderPluginProjection {
  const result = ExecutablePluginResultSchema.parse(resultInput);
  if (result.status === "failed") {
    throw new Error(`Provider plugin failed (${result.error.code}): ${result.error.message}`);
  }
  if (result.status === "accepted") {
    // A projection maps a card's parameters onto a provider's request shape. It is pure translation
    // with nothing to wait for, so an acceptance here means the plugin answered a different
    // question than the one asked.
    throw new Error("A provider projection cannot be accepted for later; it must answer now.");
  }
  const output = result.outputs.find((entry) => entry.slot === "projection");
  if (!output || output.kind !== "value" || !output.value || typeof output.value !== "object" || Array.isArray(output.value)) {
    throw new Error("Provider plugin returned no projection value output.");
  }
  const value = output.value as Record<string, unknown>;
  if (typeof value.endpoint !== "string" || !value.endpoint.trim()) {
    throw new Error("Provider plugin projection endpoint must be a non-empty string.");
  }
  if (!value.input || typeof value.input !== "object" || Array.isArray(value.input)) {
    throw new Error("Provider plugin projection input must be an object.");
  }
  return {
    endpoint: value.endpoint,
    input: value.input as Record<string, unknown>,
  };
}

export function createProviderPluginProjector(options: {
  client: PluginHostClient;
}): ProviderPluginProjector {
  return async (request) => {
    let binding: ExecutablePluginBinding;
    try {
      binding = request.binding
        ? ExecutablePluginBindingSchema.parse(request.binding)
        : await options.client.resolveBinding(
            request.pluginId,
            request.exportId,
            "provider-projector",
          );
    } catch (error) {
      if (pluginHostUnavailable(error)) {
        throw new ProviderPluginHostUnavailableError((error as Error).message, { cause: error });
      }
      throw error;
    }
    if (binding.pluginId !== request.pluginId || binding.exportId !== request.exportId) {
      throw new Error(
        `Plugin host resolved ${binding.pluginId}/${binding.exportId}, expected `
          + `${request.pluginId}/${request.exportId}.`,
      );
    }
    const invocation = ExecutablePluginInvocationSchema.parse({
      protocol: "clash.plugin.invoke/v1",
      invocationId: randomUUID(),
      taskId: request.taskId,
      projectId: request.projectId,
      ...(request.nodeId ? { nodeId: request.nodeId } : {}),
      target: {
        ...binding,
        kind: "provider-projector",
      },
      input: request.input,
      actor: { kind: "system", id: "local-aigc" },
    });
    let result: ExecutablePluginResult;
    try {
      result = await options.client.invoke(request.pluginId, invocation);
    } catch (error) {
      if (pluginHostUnavailable(error)) {
        throw new ProviderPluginHostUnavailableError((error as Error).message, { cause: error });
      }
      throw error;
    }
    return {
      binding,
      projection: projectionFromResult(result),
    };
  };
}

function pluginHostUnavailable(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "ENOENT"
    || code === "ECONNREFUSED"
    || /plugin host.*(closed|timed out)/i.test(message)
    || /executable plugin .* (is not installed|is not running)/i.test(message);
}
