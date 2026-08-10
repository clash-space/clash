import { randomUUID } from "node:crypto";

import {
  classifyProviderStatus,
  type ExecutablePluginFunctionExport,
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
  /** Declared entry points, used to check an acceptance against what the plugin says it supports. */
  listFunctionExports?(pluginId: string): Promise<ExecutablePluginFunctionExport[]>;
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
  if (result.status === "accepted") {
    // Reading media off an accepted result would invent an answer the provider has not given yet.
    // The caller decides what to do with an acceptance; this function only reads finished work.
    throw new Error("Provider plugin accepted the work; no media is available yet.");
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

/**
 * Whether this entry says it can be asked about work it accepted.
 *
 * Read from the manifest rather than carried on the binding: a binding is an identity -- four
 * fields that hash into a contract check -- and adding capability to it would make two plugins with
 * identical contracts hash differently.
 *
 * Fails closed. If the declaration cannot be read, the answer is no, because the cost of being
 * wrong runs one way: accepting work nobody can collect loses money, while refusing an acceptance
 * costs a round trip on the path that already worked.
 */
async function pollableEntry(
  client: BridgeProviderExecutorClient,
  pluginId: string,
  exportId: string,
): Promise<ExecutablePluginFunctionExport | undefined> {
  const entries = await client.listFunctionExports?.(pluginId).catch(() => undefined);
  const entry = entries?.find((candidate) => candidate.id === exportId);
  return entry?.operations?.includes("poll") ? entry : undefined;
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
      // Passed through untouched. The host stores whatever the plugin handed back and returns it
      // verbatim, so a provider identified by a URL, a region pair, or nothing resembling an id at
      // all needs no accommodation here.
      ...(request.pollState === undefined
        ? {}
        : { operation: "poll" as const, pollState: request.pollState }),
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
    if (result.status === "accepted") {
      // A plugin that never said it could be polled has just taken money for work nobody can
      // collect. Refusing here turns a silent loss into a loud one, at the only moment it is still
      // cheap to notice.
      const entry = await pollableEntry(options.client, request.pluginId, request.exportId);
      if (!entry) {
        throw new Error(
          `Provider plugin ${request.pluginId}/${request.exportId} accepted work but does not `
            + "declare the poll operation, so its result could never be collected.",
        );
      }
      // The plugin reported the provider's word; the decision is read off the vocabulary the entry
      // declared. Keeping it here is the point -- a plugin left to judge for itself reaches for
      // "anything I do not recognise is still running", and waits out work that already died.
      if (result.providerStatus && entry.statusMapping) {
        const verdict = classifyProviderStatus(result.providerStatus, entry.statusMapping);
        if (verdict.state === "failed") {
          throw new Error(
            verdict.reason
              ?? `Provider reported "${result.providerStatus}", which ${request.pluginId} maps to `
                + "failed.",
          );
        }
        if (verdict.state === "completed") {
          throw new Error(
            `Provider reported "${result.providerStatus}", which ${request.pluginId} maps to `
              + "completed, but the plugin returned an acceptance rather than the result. The work "
              + "is finished upstream and asking again will not produce it.",
          );
        }
      }
      return {
        status: "accepted",
        binding,
        pollState: result.pollState,
        ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
      };
    }
    return { status: "completed", binding, media: mediaFromResult(result) };
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
