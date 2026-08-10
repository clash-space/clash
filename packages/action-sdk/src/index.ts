import { ExecutablePluginAssetReadResultSchema } from "@clash/shared-types";
import type { AssetKind } from "@clash/shared-types";
/**
 * @clash/action-sdk — Types for building Clash canvas actions.
 *
 * Action authors import these types to build CF Workers that handle
 * canvas action execution.
 *
 * @example
 * ```typescript
 * import type { ActionRequest, ActionResponse } from '@clash/action-sdk';
 *
 * export default {
 *   async fetch(request: Request): Promise<Response> {
 *     const req: ActionRequest = await request.json();
 *     // ... process action ...
 *     return Response.json({ type: 'image', url: '...' } satisfies ActionResponse);
 *   }
 * };
 * ```
 */

import {
  ExecutablePluginBrokerResponseSchema,
  ExecutablePluginInvocationSchema,
  ExecutablePluginOutputSchema,
  ExecutablePluginResultSchema,
  type ExecutablePluginBrokerOperation,
  type ExecutablePluginInvocation,
  type ExecutablePluginJsonValue,
  type ExecutablePluginOutput,
  type ExecutablePluginResult,
} from "@clash/shared-types";

export { ExecutablePluginAssetReadResultSchema } from "@clash/shared-types";
export type {
  AssetKind,
  ExecutablePluginAssetHandle,
  ExecutablePluginBinding,
  ExecutablePluginBrokerOperation,
  ExecutablePluginInvocation,
  ExecutablePluginJsonValue,
  ExecutablePluginOutput,
  ExecutablePluginReference,
  ExecutablePluginResult,
} from "@clash/shared-types";

/**
 * An asset the host has resolved for the plugin, in whichever form the host could supply.
 *
 * How we can supply an asset and what a provider accepts are independent axes. We hold either
 * a local file or something already published; a provider takes inline bytes, a URL it fetches
 * itself, or an upload endpoint of its own. Only the plugin author knows the provider's
 * column, so the SDK states our side exactly and leaves the choice to them:
 *
 * ```ts
 * const reference = await resolveAssetReference(context, handle);
 * if (reference.form === "url" && reference.forwardable) {
 *   body.image_url = reference.url;              // provider fetches it
 * } else {
 *   body.image_url = await uploadToProvider(reference);   // bytes, or a URL only we can read
 * }
 * ```
 *
 * `forwardable` is the distinction that cannot be recovered by inspection: a local asset served
 * on loopback and a published asset are both `https?://` strings, and handing the former to a
 * provider points it at whatever answers on its own loopback.
 */
export type ResolvedAssetReference =
  | {
      form: "bytes";
      kind: AssetKind;
      mediaType?: string;
      byteLength: number;
      dataBase64: string;
    }
  | {
      form: "url";
      kind: AssetKind;
      mediaType?: string;
      byteLength: number;
      url: string;
      /** True when the provider may fetch this URL directly. */
      forwardable: boolean;
    };

/**
 * Resolves a `clash-asset://` handle through the broker into whichever form the host has.
 *
 * Validates the answer against the shared contract, so a plugin never has to guess the shape
 * or the handle prefix. The installed hilo plugin checks for `asset://` while the host emits
 * `clash-asset://`; a typed entry point removes the class of mistake rather than the instance.
 */
export async function resolveAssetReference(
  context: HostedExecutablePluginContext,
  asset: ExecutablePluginAssetHandle,
): Promise<ResolvedAssetReference> {
  const answer = await context.broker({ kind: "asset.read", asset });
  const result = ExecutablePluginAssetReadResultSchema.parse(answer);
  const common = {
    kind: result.kind,
    ...(result.mediaType ? { mediaType: result.mediaType } : {}),
    byteLength: result.byteLength,
  };
  if (result.dataBase64 !== undefined) {
    return { form: "bytes", ...common, dataBase64: result.dataBase64 };
  }
  return {
    form: "url",
    ...common,
    url: result.url!,
    forwardable: result.reach === "public",
  };
}

export interface HostedExecutablePluginContext {
  broker(operation: ExecutablePluginBrokerOperation): Promise<ExecutablePluginJsonValue>;
}

export type HostedExecutablePluginHandler = (
  invocation: ExecutablePluginInvocation,
  context: HostedExecutablePluginContext,
) => Promise<ExecutablePluginResult | ExecutablePluginOutput[]>;

export interface HostedExecutablePluginWorkerOptions {
  fetch?: typeof fetch;
}

/**
 * Minimal FaaS adapter for agent-authored hosted plugins. The handler sees the
 * same invocation/result ABI as a local stdio plugin and can access external
 * capabilities only through the Kernel broker advertised by request headers.
 */
export function defineHostedExecutablePlugin(
  handlers: Record<string, HostedExecutablePluginHandler>,
  options: HostedExecutablePluginWorkerOptions = {},
): { fetch(request: Request): Promise<Response> } {
  const brokerFetch = options.fetch ?? fetch;
  return {
    async fetch(request: Request): Promise<Response> {
      let invocationId = "unknown";
      try {
        const invocation = ExecutablePluginInvocationSchema.parse(await request.json());
        invocationId = invocation.invocationId;
        const handler = handlers[invocation.target.exportId];
        if (!handler) {
          throw new Error(`No hosted plugin handler is registered for ${invocation.target.exportId}.`);
        }
        const context: HostedExecutablePluginContext = {
          broker: async (operation) => {
            const endpoint = request.headers.get("x-clash-plugin-broker");
            const capability = request.headers.get("x-clash-plugin-capability");
            if (!endpoint || !capability) {
              throw new Error("Clash hosted capability broker is unavailable for this invocation.");
            }
            const requestId = crypto.randomUUID();
            const response = await brokerFetch(endpoint, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-clash-plugin-capability": capability,
              },
              body: JSON.stringify({
                protocol: "clash.plugin.broker-request/v1",
                requestId,
                invocationId: invocation.invocationId,
                operation,
              }),
            });
            if (!response.ok) {
              throw new Error(`Clash hosted broker returned HTTP ${response.status}.`);
            }
            const brokerResult = ExecutablePluginBrokerResponseSchema.parse(await response.json());
            if (brokerResult.requestId !== requestId) {
              throw new Error(`Clash hosted broker response does not match request ${requestId}.`);
            }
            if (brokerResult.status === "error") {
              throw new Error(`${brokerResult.error.code}: ${brokerResult.error.message}`);
            }
            return brokerResult.result;
          },
        };
        const output = await handler(invocation, context);
        const result = Array.isArray(output)
          ? {
              protocol: "clash.plugin.result/v1" as const,
              invocationId: invocation.invocationId,
              status: "completed" as const,
              outputs: output.map((entry) => ExecutablePluginOutputSchema.parse(entry)),
            }
          : ExecutablePluginResultSchema.parse(output);
        if (result.invocationId !== invocation.invocationId) {
          throw new Error(
            `Hosted plugin result invocationId=${result.invocationId} does not match ${invocation.invocationId}.`,
          );
        }
        return Response.json(result);
      } catch (error) {
        return Response.json({
          protocol: "clash.plugin.result/v1",
          invocationId,
          status: "failed",
          error: {
            code: "plugin_error",
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
          },
        } satisfies ExecutablePluginResult);
      }
    },
  };
}

// ─── Request (sent by platform to action worker) ─────────

export interface ActionInputNode {
  id: string;
  type: string;
  /** R2 storage key or public URL for image/video nodes */
  src?: string;
  /** Text content for text nodes */
  content?: string;
  /** Node label */
  label?: string;
}

export type ActionProvider =
  | "fal"
  | "replicate"
  | "kie"
  | "official"
  | "openai"
  | "google-ai-studio"
  | "google-agent-platform"
  | "anthropic"
  | "elevenlabs"
  | string;

export interface ActionModel {
  id: string;
  provider: ActionProvider;
  name?: string;
  secretId?: string;
  baseUrl?: string;
  endpoint?: string;
  [key: string]: unknown;
}

export interface ActionRequest {
  /** Unique task ID for this execution */
  taskId: string;
  /** Canvas node ID that triggered this action */
  nodeId: string;
  /** Project ID */
  projectId: string;
  /** Action ID (matches action.json `id` field) */
  actionId: string;
  /** User's prompt text from the action-badge node */
  prompt: string;
  /** User-configured parameters (defined in action.json `parameters`) */
  params: Record<string, unknown>;
  /** Optional MaaS / official model binding from action.json `model`. */
  model?: ActionModel;
  /** Platform-injected secrets (decrypted user variables matching action.json `secrets`) */
  secrets: Record<string, string>;
  /** R2 storage keys for upstream refs, grouped by modality. */
  refs?: {
    image?: string[];
    video?: string[];
    audio?: string[];
  };
  /** Connected upstream nodes (images, text, etc.) */
  inputNodes?: ActionInputNode[];
}

// ─── Response (returned by action worker to platform) ─────

export interface ActionResponse {
  /** Output type — determines what canvas node is created */
  type: "image" | "video" | "audio" | "text";
  /** URL to download the result (for image/video/audio). Platform will fetch + store in R2. */
  url?: string;
  /** Text content (for type='text' output) */
  content?: string;
  /** MIME type of the result */
  mimeType?: string;
  /** Human-readable description of the result */
  description?: string;
  /** Error message if the action failed */
  error?: string;
}

// ─── Action Manifest (action.json) ────────────────────────

export interface ActionManifestParameter {
  id: string;
  label: string;
  type: "text" | "number" | "slider" | "select" | "boolean";
  description?: string;
  defaultValue?: string | number | boolean;
  options?: Array<{ label: string; value: string | number }>;
  min?: number;
  max?: number;
  step?: number;
}

export interface ActionManifestSecret {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface ActionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  repository?: string;
  outputType: "image" | "video" | "audio" | "text";
  parameters?: ActionManifestParameter[];
  /** Optional MaaS / official model binding. Provider presets auto-declare the matching key. */
  model?: ActionModel;
  secrets?: ActionManifestSecret[];
  runtime: "local" | "worker";
  workerUrl?: string;
  icon?: string;
  color?: string;
  tags?: string[];
}
