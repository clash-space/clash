import type { ByoMessage } from "./acpEvents";

export type RuntimeSubagentStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export interface RuntimeSubagentWorkItem {
  id: string;
  title: string;
  status: RuntimeSubagentStatus;
  agentType?: string;
  detail?: string;
  turnId?: string;
  parentToolCallId?: string;
  transcript: ByoMessage[];
  sourceEventIds: string[];
}

type CanonicalEvent = {
  eventId?: string;
  type: string;
  workItemId: string;
  turnId?: string;
  parentId?: string;
  data: Record<string, unknown>;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function canonicalEvent(value: unknown): CanonicalEvent | null {
  const outer = recordValue(value);
  const event = recordValue(outer?.update) ?? outer;
  if (!event) return null;
  if (event.schema_version !== "oma.event.v1" && event.schema !== "oma.event.v1") return null;
  const type = stringValue(event.type);
  const workItemId = stringValue(event.work_item_id);
  if (!type || !workItemId) return null;
  return {
    eventId: stringValue(event.event_id),
    type,
    workItemId,
    turnId: stringValue(event.turn_id),
    parentId: stringValue(event.parent_id),
    data: recordValue(event.data) ?? {},
  };
}

function displayValue(value: unknown): string | undefined {
  if (typeof value === "string") return stringValue(value);
  if (value === undefined || value === null) return undefined;
  try {
    const text = JSON.stringify(value);
    return text.length > 240 ? `${text.slice(0, 240)}…` : text;
  } catch {
    return String(value);
  }
}

function fallbackTitle(id: string): string {
  return `Agent ${id.slice(-8)}`;
}

function emptyItem(event: CanonicalEvent): RuntimeSubagentWorkItem {
  return {
    id: event.workItemId,
    title: fallbackTitle(event.workItemId),
    status: "running",
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.parentId ? { parentToolCallId: event.parentId } : {}),
    transcript: [],
    sourceEventIds: [],
  };
}

function appendTextPart(
  item: RuntimeSubagentWorkItem,
  type: "text" | "thought",
  text: string,
): RuntimeSubagentWorkItem {
  const message = item.transcript[0] ?? {
    id: `subagent-${item.id}`,
    role: "assistant" as const,
    parts: [],
  };
  const parts = [...message.parts];
  const last = parts.at(-1);
  if (last?.type === type) {
    parts[parts.length - 1] = { ...last, text: `${last.text}${text}` };
  } else {
    parts.push({ type, text });
  }
  return {
    ...item,
    transcript: [{ ...message, parts }],
  };
}

function progressDetail(output: unknown): string | undefined {
  const record = recordValue(output);
  if (!record) return displayValue(output);
  return stringValue(record.detail)
    ?? stringValue(record.message)
    ?? stringValue(record.status)
    ?? stringValue(record.tool_name)
    ?? (typeof record.elapsed_time_seconds === "number"
      ? `${Math.max(0, Math.round(record.elapsed_time_seconds))}s`
      : undefined);
}

function appendChildTool(
  item: RuntimeSubagentWorkItem,
  output: Record<string, unknown>,
): RuntimeSubagentWorkItem {
  const toolCallId = stringValue(output.tool_call_id);
  if (!toolCallId) return item;
  const message = item.transcript[0] ?? {
    id: `subagent-${item.id}`,
    role: "assistant" as const,
    parts: [],
  };
  const parts = [...message.parts];
  const existing = parts.findIndex(
    (part) => part.type === "tool_call" && part.toolCallId === toolCallId,
  );
  const toolPart = {
    type: "tool_call" as const,
    toolCallId,
    title: stringValue(output.tool_name) ?? "Tool",
    status: stringValue(output.status) ?? "in_progress",
  };
  if (existing >= 0) parts[existing] = { ...parts[existing], ...toolPart };
  else parts.push(toolPart);
  return { ...item, transcript: [{ ...message, parts }] };
}

function mergeReidentified(
  items: readonly RuntimeSubagentWorkItem[],
  event: CanonicalEvent,
): RuntimeSubagentWorkItem[] {
  const previousId = stringValue(event.data.previous_work_item_id);
  if (!previousId || previousId === event.workItemId) return [...items];
  const previousIndex = items.findIndex((item) => item.id === previousId);
  const targetIndex = items.findIndex((item) => item.id === event.workItemId);
  const previous = previousIndex >= 0 ? items[previousIndex] : undefined;
  const target = targetIndex >= 0 ? items[targetIndex] : undefined;
  const base = previous ?? target ?? emptyItem(event);
  const next: RuntimeSubagentWorkItem = {
    ...base,
    ...target,
    id: event.workItemId,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.parentId ? { parentToolCallId: event.parentId } : {}),
    sourceEventIds: [...new Set([
      ...base.sourceEventIds,
      ...(target?.sourceEventIds ?? []),
      ...(event.eventId ? [event.eventId] : []),
    ])],
  };
  const filtered = items.filter(
    (item) => item.id !== previousId && item.id !== event.workItemId,
  );
  const insertAt = previousIndex >= 0
    ? previousIndex
    : targetIndex >= 0
      ? targetIndex
      : filtered.length;
  filtered.splice(Math.min(insertAt, filtered.length), 0, next);
  return filtered;
}

export function reduceRuntimeSubagentEvent(
  items: readonly RuntimeSubagentWorkItem[],
  value: unknown,
): RuntimeSubagentWorkItem[] {
  const event = canonicalEvent(value);
  if (!event) return [...items];
  if (event.type === "work_item.reidentified") {
    return mergeReidentified(items, event);
  }

  const index = items.findIndex((item) => item.id === event.workItemId);
  const current = index >= 0 ? items[index] : emptyItem(event);
  if (event.eventId && current.sourceEventIds.includes(event.eventId)) return [...items];

  let next: RuntimeSubagentWorkItem = {
    ...current,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.parentId ? { parentToolCallId: event.parentId } : {}),
    sourceEventIds: event.eventId
      ? [...current.sourceEventIds, event.eventId]
      : current.sourceEventIds,
  };

  if (event.type === "work_item.started") {
    next = {
      ...next,
      title: stringValue(event.data.title) ?? next.title,
      status: "running",
      ...(stringValue(event.data.agent_type)
        ? { agentType: stringValue(event.data.agent_type) }
        : {}),
    };
  } else if (event.type === "work_item.progress") {
    const output = event.data.output;
    const outputRecord = recordValue(output);
    const detail = progressDetail(output);
    next = {
      ...next,
      status: "running",
      ...(detail ? { detail } : {}),
    };
    if (outputRecord?.kind === "child_tool") next = appendChildTool(next, outputRecord);
  } else if (event.type === "agent.message_chunk") {
    const text = stringValue(event.data.text);
    if (text) next = appendTextPart(next, "text", text);
  } else if (event.type === "agent.thinking") {
    const text = stringValue(event.data.text);
    if (text) next = appendTextPart(next, "thought", text);
  } else if (event.type === "work_item.completed") {
    const detail = displayValue(event.data.result);
    next = { ...next, status: "completed", ...(detail ? { detail } : {}) };
  } else if (event.type === "work_item.failed") {
    const detail = displayValue(event.data.error);
    next = { ...next, status: "failed", ...(detail ? { detail } : {}) };
  } else if (event.type === "work_item.cancelled") {
    const detail = displayValue(event.data.reason);
    next = { ...next, status: "cancelled", ...(detail ? { detail } : {}) };
  } else if (event.type === "work_item.missing_terminal") {
    const detail = displayValue(event.data.reason);
    next = { ...next, status: "unknown", ...(detail ? { detail } : {}) };
  }

  const result = [...items];
  if (index >= 0) result[index] = next;
  else result.push(next);
  return result;
}

export function runtimeSubagentsFromEvents(
  events: Iterable<unknown>,
): RuntimeSubagentWorkItem[] {
  let items: RuntimeSubagentWorkItem[] = [];
  for (const event of events) items = reduceRuntimeSubagentEvent(items, event);
  return items;
}
