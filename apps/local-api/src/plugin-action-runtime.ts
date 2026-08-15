import { randomUUID } from "node:crypto";

import {
  ExecutablePluginBindingSchema,
  ExecutablePluginInvocationSchema,
  ExecutablePluginResultSchema,
  type ExecutablePluginBinding,
  type ExecutablePluginInvocation,
  type ExecutablePluginReference,
  type ExecutablePluginResult,
  type ExecutablePluginJsonValue,
} from "@clash/shared-types";

export interface ExecutablePluginActionClient {
  invoke(
    pluginId: string,
    invocation: ExecutablePluginInvocation,
    options?: { timeoutMs?: number },
  ): Promise<ExecutablePluginResult>;
}

export interface ExecutablePluginActionRequest {
  binding: ExecutablePluginBinding;
  taskId: string;
  projectId: string;
  nodeId?: string;
  input: {
    values: Record<string, ExecutablePluginJsonValue>;
    references: ExecutablePluginReference[];
  };
  actor: ExecutablePluginInvocation["actor"];
  /** Generator Actions may be durable; legacy Actions always omit this and submit once. */
  operation?: "submit" | "poll";
  /** Opaque state returned by an accepted Generator Action invocation. */
  pollState?: ExecutablePluginJsonValue;
  /** Host-owned remaining durable attempt budget. */
  timeoutMs?: number;
}

export type ExecutablePluginActionInvoker = (
  request: ExecutablePluginActionRequest,
) => Promise<ExecutablePluginResult>;

export function createExecutablePluginActionInvoker(options: {
  client: ExecutablePluginActionClient;
  timeoutMs?: number;
}): ExecutablePluginActionInvoker {
  return async (request) => {
    const binding = ExecutablePluginBindingSchema.parse(request.binding);
    const invocation = ExecutablePluginInvocationSchema.parse({
      protocol: "clash.plugin.invoke/v1",
      invocationId: randomUUID(),
      taskId: request.taskId,
      projectId: request.projectId,
      ...(request.nodeId ? { nodeId: request.nodeId } : {}),
      target: { ...binding, kind: "action" },
      input: request.input,
      actor: request.actor,
      ...(request.operation === undefined
        ? {}
        : { operation: request.operation }),
      ...(request.pollState === undefined
        ? {}
        : { pollState: request.pollState }),
    });
    return ExecutablePluginResultSchema.parse(
      await options.client.invoke(binding.pluginId, invocation, {
        timeoutMs: request.timeoutMs ?? options.timeoutMs ?? 1_800_000,
      }),
    );
  };
}
