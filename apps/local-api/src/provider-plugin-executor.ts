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
  ProviderPluginExecutor,
  ProviderPluginExecutorMedia,
} from "./local-aigc.js";
import { ProviderPluginHostUnavailableError } from "./local-aigc.js";

export interface BridgeProviderExecutorClient {
  resolveBinding(
    pluginId: string,
    exportId: string,
    kind: "provider-executor",
  ): Promise<ExecutablePluginBinding>;
  invoke(
    pluginId: string,
    invocation: ExecutablePluginInvocation,
    options?: { timeoutMs?: number },
  ): Promise<ExecutablePluginResult>;
}

const PROVIDER_PLUGIN_EXECUTION_TIMEOUT_MS = 30 * 60_000;

export function mediaFromResult(input: unknown): ProviderPluginExecutorMedia {
  const result = ExecutablePluginResultSchema.parse(input);
  if (result.status === "failed") {
    throw new Error(`Provider plugin failed (${result.error.code}): ${result.error.message}`);
  }
  const output = result.outputs.find((entry) => entry.slot === "media");
  if (!output) throw new Error("Provider plugin returned no media output.");

  // The asset channel is the typed one: the media type is a declared field and the URL states who
  // can fetch it. The value channel stays supported because installed plugins use it -- it was the
  // only way to return a published link before the asset channel accepted a url.
  if (output.kind === "asset") {
    const { asset } = output;
    if (!asset.url) {
      throw new Error("Provider plugin media asset carries no url for the host to fetch.");
    }
    if (asset.reach !== "public") {
      throw new Error(
        `Provider plugin media url is reachable only by the plugin (reach ${asset.reach}); the host cannot fetch it.`,
      );
    }
    return {
      url: new URL(asset.url).toString(),
      ...(asset.mediaType ? { contentType: asset.mediaType } : {}),
    };
  }

  if (!output.value || typeof output.value !== "object" || Array.isArray(output.value)) {
    throw new Error("Provider plugin returned no media value output.");
  }
  const value = output.value as Record<string, unknown>;
  if (typeof value.url !== "string") {
    throw new Error("Provider plugin media URL must be a string.");
  }
  const url = new URL(value.url).toString();
  const optionalString = (key: string) =>
    typeof value[key] === "string" && value[key] ? String(value[key]) : undefined;
  const optionalNumber = (key: string) =>
    typeof value[key] === "number" && Number.isFinite(value[key]) ? Number(value[key]) : undefined;
  const waveform = Array.isArray(value.waveform)
    && value.waveform.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    ? value.waveform as number[]
    : undefined;
  return {
    url,
    ...(optionalString("contentType") ? { contentType: optionalString("contentType") } : {}),
    ...(optionalString("requestId") ? { requestId: optionalString("requestId") } : {}),
    ...(optionalNumber("width") !== undefined ? { width: optionalNumber("width") } : {}),
    ...(optionalNumber("height") !== undefined ? { height: optionalNumber("height") } : {}),
    ...(optionalNumber("durationMs") !== undefined ? { durationMs: optionalNumber("durationMs") } : {}),
    ...(waveform ? { waveform } : {}),
    ...(optionalString("transcript") ? { transcript: optionalString("transcript") } : {}),
  };
}

export function createBridgeProviderPluginExecutor(options: {
  client: BridgeProviderExecutorClient;
}): ProviderPluginExecutor {
  return async (request) => {
    let binding: ExecutablePluginBinding;
    try {
      binding = request.binding
        ? ExecutablePluginBindingSchema.parse(request.binding)
        : await options.client.resolveBinding(
            request.pluginId,
            request.exportId,
            "provider-executor",
          );
    } catch (error) {
      if (bridgeHostUnavailable(error)) {
        throw new ProviderPluginHostUnavailableError((error as Error).message, { cause: error });
      }
      throw error;
    }
    if (binding.pluginId !== request.pluginId || binding.exportId !== request.exportId) {
      throw new Error(
        `Bridge resolved ${binding.pluginId}/${binding.exportId}, expected `
          + `${request.pluginId}/${request.exportId}.`,
      );
    }
    const invocation = ExecutablePluginInvocationSchema.parse({
      protocol: "clash.plugin.invoke/v1",
      invocationId: randomUUID(),
      taskId: request.taskId,
      projectId: request.projectId,
      ...(request.nodeId ? { nodeId: request.nodeId } : {}),
      target: { ...binding, kind: "provider-executor" },
      input: request.input,
      actor: { kind: "system", id: "local-aigc" },
    });
    let result: ExecutablePluginResult;
    try {
      result = await options.client.invoke(request.pluginId, invocation, {
        timeoutMs: PROVIDER_PLUGIN_EXECUTION_TIMEOUT_MS,
      });
    } catch (error) {
      if (bridgeHostUnavailable(error)) {
        throw new ProviderPluginHostUnavailableError((error as Error).message, { cause: error });
      }
      throw error;
    }
    return { binding, media: mediaFromResult(result) };
  };
}

function bridgeHostUnavailable(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "ENOENT"
    || code === "ECONNREFUSED"
    || /plugin host.*(closed|timed out)/i.test(message)
    || /executable plugin .* (is not installed|is not running)/i.test(message);
}
