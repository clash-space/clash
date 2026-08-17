import { createHash } from "node:crypto";

export const OPENMA_EVENT_SCHEMA_VERSION = "oma.event.v1" as const;

export interface OpenMAAgentEvent {
  schema: typeof OPENMA_EVENT_SCHEMA_VERSION;
  schema_version: typeof OPENMA_EVENT_SCHEMA_VERSION;
  event_id: string;
  seq: number;
  type: string;
  session_id: string;
  turn_id?: string;
  work_item_id?: string;
  parent_id?: string;
  source: {
    kind: "harness";
    harness: string;
    adapter: string;
  };
  occurred_at: string;
  data: Record<string, unknown>;
  raw?: {
    kind: "raw";
    source: "adapter";
    method?: string;
    event_type?: string;
    payload: unknown;
    received_at: string;
    reason: "unknown";
  };
}

export interface AgentEventAdapterOptions {
  sessionId: string;
  harnessId: string;
  now?: () => string;
}

type Provider =
  | "codex"
  | "claude"
  | "opencode"
  | "kilo"
  | "cursor"
  | "pi"
  | "kimi"
  | "generic-acp";

interface ToolState {
  toolCallId: string;
  title?: string;
  toolName?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  meta: Record<string, unknown>;
}

interface WorkItemState {
  turnId: string;
  status: "running" | "completed" | "failed" | "cancelled" | "unknown";
  parentId?: string;
}

interface LifecycleUpdate {
  childId: string;
  toolCallId?: string;
  status: WorkItemState["status"];
  task?: string;
  agentType?: string;
  forkContext?: boolean;
  result?: unknown;
  error?: string;
  reason?: string;
  progress?: unknown;
  raw: unknown;
}

export class AgentEventAdapter {
  readonly #sessionId: string;
  readonly #harnessId: string;
  readonly #provider: Provider;
  readonly #now: () => string;
  readonly #tools = new Map<string, ToolState>();
  readonly #workItems = new Map<string, WorkItemState>();
  readonly #childByParentTool = new Map<string, string>();
  #sequence = 0;

  constructor(options: AgentEventAdapterOptions) {
    this.#sessionId = options.sessionId;
    this.#harnessId = options.harnessId;
    this.#provider = providerForHarness(options.harnessId);
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  ingest(turnId: string, event: unknown): OpenMAAgentEvent[] {
    const inner = unwrapEvent(event);
    const callback = this.#callbackEvent(turnId, inner, event);
    if (callback) return [callback];

    if (this.#provider === "claude") {
      const transcript = this.#claudeTranscript(turnId, inner, event);
      if (transcript) return [transcript];
    }

    if (this.#provider === "codex") {
      const rawUpdates = codexRawLifecycle(inner, event);
      if (rawUpdates.length > 0) {
        return rawUpdates.flatMap((update) => this.#lifecycleEvents(turnId, update));
      }
    }

    if (this.#provider === "cursor") {
      const extension = cursorExtensionLifecycle(inner, event);
      if (extension) return this.#lifecycleEvents(turnId, extension);
    }

    const tool = this.#mergeTool(inner);
    if (!tool) return [];
    const updates = this.#provider === "codex"
      ? codexToolLifecycle(tool, event)
      : this.#provider === "claude"
        ? claudeToolLifecycle(tool, event)
        : this.#provider === "opencode" || this.#provider === "kilo"
          ? openCodeFamilyLifecycle(this.#provider, tool, event)
          : [];
    return updates.flatMap((update) => this.#lifecycleEvents(turnId, update));
  }

  finishTurn(turnId: string, stopReason?: string): OpenMAAgentEvent[] {
    if (
      this.#provider !== "codex"
      && this.#provider !== "claude"
      && this.#provider !== "opencode"
      && this.#provider !== "kilo"
    ) {
      return [];
    }
    const cancelled = stopReason === "cancelled";
    return [...this.#workItems.entries()].flatMap(([childId, state]) => {
      if (state.turnId !== turnId || state.status !== "running") return [];
      const occurredAt = this.#now();
      state.status = cancelled ? "cancelled" : "unknown";
      return [this.#event({
        type: cancelled ? "work_item.cancelled" : "work_item.missing_terminal",
        turnId,
        childId,
        parentId: state.parentId,
        occurredAt,
        data: cancelled
          ? { kind: "agent", reason: "parent_turn_cancelled" }
          : { reason: "parent_turn_ended_without_child_terminal" },
      })];
    });
  }

  #mergeTool(inner: Record<string, unknown>): ToolState | null {
    const kind = stringValue(inner.sessionUpdate) ?? stringValue(inner.type);
    if (kind !== "tool_call" && kind !== "tool_call_update") return null;
    const toolCallId = stringValue(inner.toolCallId)
      ?? stringValue(inner.tool_call_id)
      ?? stringValue(inner.id);
    if (!toolCallId) return null;
    const previous = this.#tools.get(toolCallId);
    const incomingMeta = recordValue(inner._meta ?? inner.meta);
    const rawInput = inner.rawInput ?? inner.raw_input;
    const next: ToolState = {
      toolCallId,
      title: stringValue(inner.title) ?? previous?.title,
      toolName: stringValue(inner.toolName)
        ?? stringValue(inner.tool_name)
        ?? previous?.toolName,
      status: stringValue(inner.status) ?? previous?.status,
      rawInput: isEmptyRecord(rawInput) && !isEmptyRecord(previous?.rawInput)
        ? previous?.rawInput
        : rawInput ?? previous?.rawInput,
      rawOutput: inner.rawOutput ?? inner.raw_output ?? previous?.rawOutput,
      meta: mergeRecords(previous?.meta, incomingMeta),
    };
    this.#tools.set(toolCallId, next);
    return next;
  }

  #lifecycleEvents(turnId: string, update: LifecycleUpdate): OpenMAAgentEvent[] {
    const occurredAt = this.#now();
    let previous = this.#workItems.get(update.childId);
    const events: OpenMAAgentEvent[] = [];
    if (update.toolCallId) {
      const oldChild = this.#childByParentTool.get(update.toolCallId);
      if (oldChild && oldChild !== update.childId) {
        const oldState = this.#workItems.get(oldChild);
        if (oldState) {
          this.#workItems.delete(oldChild);
          this.#workItems.set(update.childId, oldState);
          previous = oldState;
        }
        events.push(this.#event({
          type: "work_item.reidentified",
          turnId,
          childId: update.childId,
          parentId: update.toolCallId,
          occurredAt,
          data: { previous_work_item_id: oldChild },
          raw: update.raw,
        }));
      }
      this.#childByParentTool.set(update.toolCallId, update.childId);
    }

    if (update.progress !== undefined) {
      if (!previous) {
        events.push(this.#startedEvent(turnId, update, occurredAt));
      }
      events.push(this.#event({
        type: "work_item.progress",
        turnId,
        childId: update.childId,
        parentId: update.toolCallId,
        occurredAt,
        data: { output: update.progress },
        raw: update.raw,
      }));
      this.#workItems.set(update.childId, {
        turnId,
        status: "running",
        ...(update.toolCallId ? { parentId: update.toolCallId } : {}),
      });
      return events;
    }

    if (update.status === "running") {
      if (!previous || previous.status !== "running") {
        events.push(this.#startedEvent(turnId, update, occurredAt));
      }
      this.#workItems.set(update.childId, {
        turnId,
        status: "running",
        ...(update.toolCallId ? { parentId: update.toolCallId } : {}),
      });
      return events;
    }

    if (!previous) events.push(this.#startedEvent(turnId, update, occurredAt));
    if (previous?.status === update.status) return events;
    const type = update.status === "completed"
      ? "work_item.completed"
      : update.status === "cancelled"
        ? "work_item.cancelled"
        : update.status === "unknown"
          ? "work_item.missing_terminal"
          : "work_item.failed";
    const data: Record<string, unknown> = {
      kind: "agent",
      ...(update.result !== undefined ? { result: update.result } : {}),
      ...(update.error ? { error: update.error } : {}),
      ...(update.reason ? { reason: update.reason } : {}),
      ...(update.status === "unknown" && !update.reason
        ? { reason: "provider_terminal_state_unknown" }
        : {}),
    };
    events.push(this.#event({
      type,
      turnId,
      childId: update.childId,
      parentId: update.toolCallId,
      occurredAt,
      data,
      raw: update.raw,
    }));
    this.#workItems.set(update.childId, {
      turnId,
      status: update.status,
      ...(update.toolCallId ? { parentId: update.toolCallId } : {}),
    });
    return events;
  }

  #startedEvent(
    turnId: string,
    update: LifecycleUpdate,
    occurredAt: string,
  ): OpenMAAgentEvent {
    return this.#event({
      type: "work_item.started",
      turnId,
      childId: update.childId,
      parentId: update.toolCallId,
      occurredAt,
      data: {
        kind: "agent",
        ...(update.task ? { title: update.task } : {}),
        ...(update.agentType ? { agent_type: update.agentType } : {}),
        ...(update.forkContext !== undefined
          ? { fork_context: update.forkContext }
          : {}),
        ...(update.toolCallId ? { tool_call_id: update.toolCallId } : {}),
      },
      raw: update.raw,
    });
  }

  #claudeTranscript(
    turnId: string,
    inner: Record<string, unknown>,
    raw: unknown,
  ): OpenMAAgentEvent | null {
    const claudeMeta = recordValue(recordValue(inner._meta).claudeCode);
    const parentToolUseId = stringValue(claudeMeta.parentToolUseId)
      ?? stringValue(inner.parentToolUseId)
      ?? stringValue(inner.parent_tool_use_id);
    if (!parentToolUseId) return null;
    const childId = this.#childByParentTool.get(parentToolUseId)
      ?? `claude:${parentToolUseId}`;
    const kind = stringValue(inner.sessionUpdate) ?? stringValue(inner.type);
    const occurredAt = this.#now();
    if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
      const content = recordValue(inner.content);
      const text = stringValue(content.text)
        ?? stringValue(inner.text)
        ?? stringValue(inner.delta)
        ?? stringValue(inner.content);
      if (!text) return null;
      return this.#event({
        type: kind === "agent_thought_chunk" ? "agent.thinking" : "agent.message_chunk",
        turnId,
        childId,
        parentId: parentToolUseId,
        occurredAt,
        data: {
          text,
          ...(stringValue(inner.messageId) ?? stringValue(inner.message_id)
            ? { message_id: stringValue(inner.messageId) ?? stringValue(inner.message_id) }
            : {}),
        },
        raw,
        rawMethod: "nested_transcript",
      });
    }
    if (kind === "usage_update") {
      const usage = normalizedUsage(inner.usage ?? inner._usage);
      if (!usage) return null;
      return this.#event({
        type: "usage.updated",
        turnId,
        childId,
        parentId: parentToolUseId,
        occurredAt,
        data: usage,
        raw,
        rawMethod: "nested_transcript",
      });
    }
    if (kind === "tool_call" || kind === "tool_call_update") {
      const toolCallId = stringValue(inner.toolCallId)
        ?? stringValue(inner.tool_call_id)
        ?? stringValue(inner.id);
      if (!toolCallId) return null;
      return this.#event({
        type: "work_item.progress",
        turnId,
        childId,
        parentId: parentToolUseId,
        occurredAt,
        data: {
          output: {
            kind: "child_tool",
            tool_call_id: toolCallId,
            tool_name: stringValue(claudeMeta.toolName)
              ?? stringValue(inner.toolName)
              ?? stringValue(inner.title),
          },
        },
        raw,
        rawMethod: "nested_transcript",
      });
    }
    return null;
  }

  #callbackEvent(
    turnId: string,
    inner: Record<string, unknown>,
    raw: unknown,
  ): OpenMAAgentEvent | null {
    const kind = stringValue(inner.type);
    if (
      kind !== "acp.client_request"
      && kind !== "acp.client_response"
      && kind !== "acp.client_error"
      && kind !== "acp.client_notification"
    ) {
      return null;
    }
    const method = stringValue(inner.method);
    if (!method) return null;
    const requestId = stringValue(inner.requestId);
    const type = kind === "acp.client_request"
      ? "callback.requested"
      : kind === "acp.client_response"
        ? "callback.completed"
        : kind === "acp.client_error"
          ? "callback.failed"
          : "callback.notification";
    const data: Record<string, unknown> = {
      ...(requestId ? { callback_id: requestId } : {}),
      method,
      category: callbackCategory(method),
      ...(inner.params !== undefined ? { params: inner.params } : {}),
      ...(inner.result !== undefined ? { result: inner.result } : {}),
      ...(inner.error !== undefined ? { error: inner.error } : {}),
    };
    return this.#event({
      type,
      turnId,
      occurredAt: this.#now(),
      data,
      raw,
      rawMethod: method,
    });
  }

  #event(input: {
    type: string;
    turnId?: string;
    childId?: string;
    parentId?: string;
    occurredAt: string;
    data: Record<string, unknown>;
    raw?: unknown;
    rawMethod?: string;
  }): OpenMAAgentEvent {
    const seq = ++this.#sequence;
    const identity = {
      sessionId: this.#sessionId,
      seq,
      turnId: input.turnId,
      type: input.type,
      childId: input.childId,
      parentId: input.parentId,
      data: input.data,
      raw: input.raw,
    };
    const eventId = createHash("sha256")
      .update(stableJson(identity))
      .digest("hex")
      .slice(0, 32);
    return {
      schema: OPENMA_EVENT_SCHEMA_VERSION,
      schema_version: OPENMA_EVENT_SCHEMA_VERSION,
      event_id: eventId,
      seq,
      type: input.type,
      session_id: this.#sessionId,
      ...(input.turnId ? { turn_id: input.turnId } : {}),
      ...(input.childId ? { work_item_id: input.childId } : {}),
      ...(input.parentId ? { parent_id: input.parentId } : {}),
      source: {
        kind: "harness",
        harness: this.#harnessId,
        adapter: this.#provider,
      },
      occurred_at: input.occurredAt,
      data: input.data,
      ...(input.raw !== undefined
        ? {
            raw: {
              kind: "raw",
              source: "adapter",
              ...(input.rawMethod ? { method: input.rawMethod } : {}),
              event_type: input.type,
              payload: input.raw,
              received_at: input.occurredAt,
              reason: "unknown",
            },
          }
        : {}),
    };
  }
}

function providerForHarness(harnessId: string): Provider {
  const normalized = harnessId.trim().toLowerCase();
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("claude") || normalized === "cc" || normalized.startsWith("cc-")) {
    return "claude";
  }
  if (normalized === "opencode" || normalized.includes("opencode")) return "opencode";
  if (normalized === "kilo" || normalized.includes("kilo")) return "kilo";
  if (normalized.includes("cursor")) return "cursor";
  if (normalized === "pi" || normalized.includes("pi-acp")) return "pi";
  if (normalized.includes("kimi")) return "kimi";
  return "generic-acp";
}

function codexRawLifecycle(
  inner: Record<string, unknown>,
  raw: unknown,
): LifecycleUpdate[] {
  if (inner.type !== "collab_tool_call") return [];
  const tool = normalizeToolName(inner.tool);
  const children = stringArray(inner.receiver_thread_ids);
  if (tool === "spawn_agent") {
    return children.map((childId) => ({
      childId,
      status: "running",
      task: stringValue(inner.prompt),
      raw,
    }));
  }
  if (tool === "wait" || tool === "wait_agent") {
    return codexStateUpdates(children, inner.agents_states, raw);
  }
  if (tool === "close_agent") {
    return children.map((childId) => ({ childId, status: "completed", raw }));
  }
  return [];
}

function codexToolLifecycle(tool: ToolState, raw: unknown): LifecycleUpdate[] {
  const meta = recordValue(tool.meta.codex);
  const subagent = recordValue(meta.subagent);
  const subagentChild = stringValue(subagent.threadId);
  const activity = stringValue(subagent.activity);
  if (subagentChild && activity) {
    return [{
      childId: subagentChild,
      toolCallId: tool.toolCallId,
      status: activity === "interrupted" ? "cancelled" : "running",
      task: stringValue(subagent.path),
      reason: activity === "interrupted" ? "provider_interrupted" : undefined,
      raw,
    }];
  }

  const collaboration = recordValue(meta.collaboration);
  const collaborationTool = stringValue(collaboration.tool);
  const children = stringArray(collaboration.receiverThreadIds);
  const input = recordValue(tool.rawInput);
  if (!collaborationTool || children.length === 0) return [];
  if (collaborationTool === "spawnAgent") {
    const states = codexStateUpdates(children, input.agentsStates, raw);
    return children.map((childId) => {
      const state = states.find((candidate) => candidate.childId === childId);
      return {
        childId,
        toolCallId: tool.toolCallId,
        status: state?.status ?? (tool.status === "failed" ? "failed" : "running"),
        task: stringValue(input.message) ?? stringValue(input.prompt) ?? stringValue(input.task),
        agentType: stringValue(input.agent_type) ?? stringValue(input.agentType),
        forkContext: booleanValue(input.fork_context) ?? booleanValue(input.forkContext),
        result: state?.result,
        error: state?.error,
        raw,
      };
    });
  }
  if (collaborationTool === "wait" || collaborationTool === "sendInput" || collaborationTool === "resumeAgent") {
    return codexStateUpdates(children, input.agentsStates, raw).map((update) => ({
      ...update,
      toolCallId: tool.toolCallId,
    }));
  }
  if (collaborationTool === "closeAgent") {
    return children.map((childId) => ({
      childId,
      toolCallId: tool.toolCallId,
      status: "completed",
      raw,
    }));
  }
  return [];
}

function codexStateUpdates(
  childIds: string[],
  states: unknown,
  raw: unknown,
): LifecycleUpdate[] {
  const records = recordValue(states);
  const ids = childIds.length > 0 ? childIds : Object.keys(records);
  const fallback = ids.length === 1
    ? Object.values(records).find((value) => isRecord(value))
    : undefined;
  return ids.map((childId) => {
    const state = recordValue(records[childId] ?? fallback);
    const status = stringValue(state.status) ?? stringValue(state.state);
    const message = stringifyResult(state.message);
    if (status === "completed" || status === "shutdown") {
      return { childId, status: "completed", result: message, raw };
    }
    if (["failed", "error", "errored", "notFound"].includes(status ?? "")) {
      return { childId, status: "failed", error: message, raw };
    }
    if (["cancelled", "canceled", "interrupted"].includes(status ?? "")) {
      return { childId, status: "cancelled", reason: status, raw };
    }
    return { childId, status: "running", raw };
  });
}

function claudeToolLifecycle(tool: ToolState, raw: unknown): LifecycleUpdate[] {
  const claudeMeta = recordValue(tool.meta.claudeCode);
  const name = normalizeToolName(claudeMeta.toolName ?? tool.toolName ?? tool.title);
  if (name !== "task" && name !== "agent") return [];
  const input = recordValue(tool.rawInput);
  const response = recordValue(claudeMeta.toolResponse);
  const childId = stringValue(response.agentId)
    ?? stringValue(response.agent_id)
    ?? stringValue(claudeMeta.agentId)
    ?? `claude:${tool.toolCallId}`;
  const retry = recordValue(response.subagentRetry);
  const elapsedTimeSeconds = numberValue(response.elapsedTimeSeconds);
  const subagentType = stringValue(response.subagentType);
  if (Object.keys(retry).length > 0 || elapsedTimeSeconds !== undefined || subagentType) {
    return [{
      childId,
      toolCallId: tool.toolCallId,
      status: "running",
      task: stringValue(input.description) ?? stringValue(input.prompt),
      agentType: stringValue(input.subagent_type) ?? subagentType,
      progress: {
        kind: Object.keys(retry).length > 0 ? "subagent_retry" : "subagent_progress",
        ...(elapsedTimeSeconds !== undefined ? { elapsed_time_seconds: elapsedTimeSeconds } : {}),
        ...(subagentType ? { subagent_type: subagentType } : {}),
        ...(Object.keys(retry).length > 0 ? { retry } : {}),
      },
      raw,
    }];
  }
  const failed = tool.status === "failed" || tool.status === "error";
  const nonExecutionKind = stringValue(claudeMeta.nonExecutionKind);
  const asyncLaunch = booleanValue(response.isAsync) === true
    || stringValue(response.status) === "async_launched";
  const completed = !asyncLaunch
    && (tool.status === "completed" || stringValue(response.status) === "completed");
  return [{
    childId,
    toolCallId: tool.toolCallId,
    status: failed
      ? nonExecutionKind ? "cancelled" : "failed"
      : completed ? "completed" : "running",
    task: stringValue(input.description)
      ?? stringValue(input.activeForm)
      ?? stringValue(input.prompt)
      ?? stringValue(response.description)
      ?? name,
    agentType: stringValue(input.subagent_type)
      ?? stringValue(input.agent_type)
      ?? stringValue(response.agentType)
      ?? stringValue(response.agent_type),
    result: completed
      ? stringifyResult(response.content) ?? stringifyResult(tool.rawOutput)
      : undefined,
    error: failed
      ? stringValue(claudeMeta.userFeedback) ?? stringifyResult(tool.rawOutput)
      : undefined,
    reason: nonExecutionKind,
    raw,
  }];
}

function openCodeFamilyLifecycle(
  provider: "opencode" | "kilo",
  tool: ToolState,
  raw: unknown,
): LifecycleUpdate[] {
  if (normalizeToolName(tool.toolName ?? tool.title) !== "task") return [];
  const input = recordValue(tool.rawInput);
  const output = recordValue(tool.rawOutput);
  const metadata = recordValue(output.metadata);
  const description = stringValue(input.description);
  const prompt = stringValue(input.prompt);
  const agentType = stringValue(input.subagent_type);
  if (!description || !prompt || !agentType) return [];
  if (input.background !== undefined && typeof input.background !== "boolean") return [];
  const parentSessionId = stringValue(metadata.parentSessionId);
  const structuredChildId = stringValue(metadata.sessionId);
  if ((!parentSessionId || !structuredChildId) && (parentSessionId || structuredChildId)) {
    return [];
  }
  if (!structuredChildId && input.background === true) return [];
  const childId = structuredChildId ?? `${provider}:${tool.toolCallId}`;
  const error = stringValue(output.error);
  const background = input.background === true || metadata.background === true;
  return [{
    childId,
    toolCallId: tool.toolCallId,
    status: tool.status === "failed" || error
      ? "failed"
      : tool.status === "pending" || tool.status === "in_progress" || background
        ? "running"
        : "completed",
    task: description,
    agentType,
    error,
    result: !background && tool.status === "completed" ? tool.rawOutput : undefined,
    raw,
  }];
}

function cursorExtensionLifecycle(
  inner: Record<string, unknown>,
  raw: unknown,
): LifecycleUpdate | null {
  if (inner.type !== "acp.extension_request" || inner.method !== "cursor/task") return null;
  const params = recordValue(inner.params);
  const toolCallId = stringValue(params.toolCallId);
  const childId = stringValue(params.agentId);
  if (!toolCallId || !childId) return null;
  const agentType = stringValue(params.subagentType)
    ?? stringValue(recordValue(params.subagentType).custom);
  return {
    childId,
    toolCallId,
    status: "running",
    task: stringValue(params.description),
    agentType,
    raw,
  };
}

function callbackCategory(method: string): string {
  if (method === "session/request_permission") return "permission";
  if (method.startsWith("fs/")) return "filesystem";
  if (method.startsWith("terminal/")) return "terminal";
  if (method.startsWith("elicitation/")) return "elicitation";
  if (method.startsWith("mcp/")) return "mcp";
  return "extension";
}

function normalizedUsage(value: unknown): Record<string, unknown> | null {
  const usage = recordValue(value);
  const input = numberValue(usage.inputTokens) ?? numberValue(usage.input_tokens);
  const output = numberValue(usage.outputTokens) ?? numberValue(usage.output_tokens);
  if (input === undefined || output === undefined) return null;
  const cacheRead = numberValue(usage.cachedReadTokens)
    ?? numberValue(usage.cache_read_input_tokens);
  const cacheWrite = numberValue(usage.cachedWriteTokens)
    ?? numberValue(usage.cache_creation_input_tokens);
  const total = numberValue(usage.totalTokens)
    ?? numberValue(usage.total_tokens)
    ?? input + output + (cacheRead ?? 0) + (cacheWrite ?? 0);
  return {
    input_tokens: input,
    output_tokens: output,
    ...(cacheRead !== undefined ? { cache_read_input_tokens: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cache_creation_input_tokens: cacheWrite } : {}),
    total_tokens: total,
  };
}

function unwrapEvent(value: unknown): Record<string, unknown> {
  const record = recordValue(value);
  const update = recordValue(record.update);
  if (Object.keys(update).length > 0) return update;
  const item = recordValue(record.item);
  return Object.keys(item).length > 0 ? item : record;
}

function mergeRecords(
  previous: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...(previous ?? {}), ...incoming };
  for (const key of ["codex", "claudeCode"]) {
    if (isRecord(previous?.[key]) || isRecord(incoming[key])) {
      merged[key] = {
        ...recordValue(previous?.[key]),
        ...recordValue(incoming[key]),
      };
    }
  }
  return merged;
}

function stableJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (!isRecord(candidate)) return candidate;
    return Object.fromEntries(
      Object.keys(candidate)
        .sort()
        .map((key) => [key, normalize(candidate[key])]),
    );
  };
  return JSON.stringify(normalize(value));
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEmptyRecord(value: unknown): boolean {
  return value === undefined || value === null || (isRecord(value) && Object.keys(value).length === 0);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function stringifyResult(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const text = value.map((part) => {
      const block = recordValue(part);
      return stringValue(block.text) ?? stringValue(block.content) ?? "";
    }).join("");
    return text || undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function normalizeToolName(value: unknown): string {
  const name = stringValue(value);
  return name?.trim().split(/[./:]/).pop()?.toLowerCase() ?? "";
}
