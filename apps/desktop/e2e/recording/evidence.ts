import type { DemoEventJournal } from "../../src/demo-recording/events.js";
import {
  isClashDispatcherName,
  isSafeClashOperation,
  projectClashDispatcherCall,
} from "../../src/demo-recording/dispatcher-observation.js";

export interface RequiredOperation {
  name: string;
  minCalls: number;
}

export interface MinimumProductState {
  canvasNodes: number;
  timelines: number;
  directorStages: number;
}

export interface ProductOwnerRequirement {
  kind: "project" | "canvas-action";
  canvasId?: string;
  actionNodeId?: string;
}

export interface CanvasNodeRequirement {
  id?: string;
  type?: string;
  label?: string;
  content?: string;
  canvasId?: string;
}

export interface NamedOwnedEntityRequirement {
  id?: string;
  name?: string;
  owner?: ProductOwnerRequirement;
}

export interface RequiredProductState {
  canvasNodes?: CanvasNodeRequirement[];
  timelines?: NamedOwnedEntityRequirement[];
  directorStages?: NamedOwnedEntityRequirement[];
}

export interface AgentEvidenceRequirements {
  operations: RequiredOperation[];
  minimumProductState: MinimumProductState;
  requiredProductState?: RequiredProductState;
}

export interface ProductReadback {
  canvas: { nodes?: unknown[] };
  timelines: { timelines?: unknown[] };
  directorStages: { stages?: unknown[] };
}

export interface AgentEvidenceResult {
  status: "pass" | "fail";
  failures: string[];
  missingOperations: Array<{
    name: string;
    expected: number;
    observed: number;
  }>;
  missingProductState: Array<
    | { kind: "canvasNode"; expected: CanvasNodeRequirement }
    | { kind: "timeline"; expected: NamedOwnedEntityRequirement }
    | { kind: "directorStage"; expected: NamedOwnedEntityRequirement }
  >;
  metrics: {
    canvasNodes: number;
    timelines: number;
    directorStages: number;
    completedOperationCounts: Record<string, number>;
  };
}

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function fieldMatches(actual: unknown, expected: string | undefined): boolean {
  return expected === undefined || actual === expected;
}

function ownerMatches(value: unknown, expected: ProductOwnerRequirement | undefined): boolean {
  if (!expected) return true;
  const owner = recordValue(value);
  return owner?.kind === expected.kind &&
    fieldMatches(owner.canvasId, expected.canvasId) &&
    fieldMatches(owner.actionNodeId, expected.actionNodeId);
}

function canvasNodeMatches(value: unknown, expected: CanvasNodeRequirement): boolean {
  const node = recordValue(value);
  if (!node) return false;
  const data = recordValue(node.data);
  return fieldMatches(node.id, expected.id) &&
    fieldMatches(node.type, expected.type) &&
    fieldMatches(data?.label, expected.label) &&
    fieldMatches(data?.content, expected.content) &&
    fieldMatches(node.canvasId ?? node.canvas_id, expected.canvasId);
}

function artifactSafeCanvasRequirement(
  expected: CanvasNodeRequirement,
): CanvasNodeRequirement {
  return expected.content === undefined
    ? expected
    : { ...expected, content: "<exact>" };
}

function namedOwnedEntityMatches(
  value: unknown,
  expected: NamedOwnedEntityRequirement,
): boolean {
  const entity = recordValue(value);
  return Boolean(entity) &&
    fieldMatches(entity?.id, expected.id) &&
    fieldMatches(entity?.name, expected.name) &&
    ownerMatches(entity?.owner, expected.owner);
}

function describeExpectedEntity(
  expected: CanvasNodeRequirement | NamedOwnedEntityRequirement,
): string {
  const fields: string[] = [];
  if (expected.id !== undefined) fields.push(`id=${expected.id}`);
  if ("type" in expected && expected.type !== undefined) {
    fields.push(`type=${expected.type}`);
  }
  if ("label" in expected && expected.label !== undefined) {
    fields.push(`label=${expected.label}`);
  }
  if ("content" in expected && expected.content !== undefined) {
    fields.push("content=<exact>");
  }
  if ("canvasId" in expected && expected.canvasId !== undefined) {
    fields.push(`canvasId=${expected.canvasId}`);
  }
  if ("name" in expected && expected.name !== undefined) {
    fields.push(`name=${expected.name}`);
  }
  if ("owner" in expected && expected.owner) {
    fields.push(`owner.kind=${expected.owner.kind}`);
    if (expected.owner.canvasId !== undefined) {
      fields.push(`owner.canvasId=${expected.owner.canvasId}`);
    }
    if (expected.owner.actionNodeId !== undefined) {
      fields.push(`owner.actionNodeId=${expected.owner.actionNodeId}`);
    }
  }
  return fields.join(", ");
}

function toolUpdate(value: unknown): JsonRecord | undefined {
  const outer = recordValue(value);
  return recordValue(outer?.update) ?? outer;
}

function dispatcherOperation(toolName: string | undefined, rawInput: unknown): string | undefined {
  const dispatcherCall = projectClashDispatcherCall(toolName, rawInput);
  if (dispatcherCall) {
    return dispatcherCall.mode === "execute"
      ? dispatcherCall.canonicalOperation
      : undefined;
  }
  if (isClashDispatcherName(toolName)) return undefined;

  const input = recordValue(rawInput);
  const argumentsRecord = recordValue(input?.arguments) ?? input;
  const operation = textValue(argumentsRecord?.operation);
  if (operation !== undefined && !isSafeClashOperation(operation)) {
    return undefined;
  }
  if (operation?.startsWith("clash_")) return operation;
  if (!isSafeClashOperation(toolName)) return undefined;
  if (!operation && !["clash", "clash_canvas", "clash_composition", "clash_director", "clash_timeline"].includes(toolName)) {
    return toolName.startsWith("clash_") ? toolName : undefined;
  }
  if (!operation) return undefined;
  if (toolName === "clash_canvas") return `clash_canvas_${operation}`;
  if (toolName === "clash_director") return `clash_director_${operation}`;
  if (toolName === "clash_timeline") return `clash_timeline_${operation}`;
  if (toolName === "clash_composition") {
    const kind = textValue(argumentsRecord?.kind);
    if (kind === "director-stage") return `clash_director_${operation}`;
    if (kind === "timeline") return `clash_timeline_${operation}`;
  }
  return undefined;
}

export function extractCompletedProductOperations(
  value: unknown,
  targetTurnId: string,
): string[] {
  const body = recordValue(value);
  if (!Array.isArray(body?.messages)) return [];
  const calls = new Map<string, {
    descriptorBound: boolean;
    toolName?: string;
    rawInput?: unknown;
    status?: string;
  }>();
  const order: string[] = [];

  for (const rawMessage of body.messages) {
    const message = recordValue(rawMessage);
    if (
      message?.sender_kind !== "agent" ||
      message.turn_id !== targetTurnId ||
      !Array.isArray(message.events)
    ) {
      continue;
    }
    for (const rawEvent of message.events) {
      const update = toolUpdate(rawEvent);
      const updateKind = textValue(update?.sessionUpdate);
      if (updateKind !== "tool_call" && updateKind !== "tool_call_update") continue;
      const id =
        textValue(update?.toolCallId) ??
        textValue(update?.tool_call_id) ??
        textValue(update?.id);
      if (!id) continue;
      const previous = calls.get(id) ?? { descriptorBound: false };
      if (!calls.has(id)) order.push(id);
      const meta = recordValue(update?._meta);
      const rawInput = update?.rawInput ?? update?.raw_input ?? update?.input ?? update?.args;
      const bindsTrustedDescriptor =
        !previous.descriptorBound &&
        meta?.["clash.host_trusted_mcp"] === true &&
        meta?.["clash.renderer"] === "product";
      calls.set(id, {
        descriptorBound: previous.descriptorBound || bindsTrustedDescriptor,
        toolName: bindsTrustedDescriptor
          ? textValue(meta?.mcp_tool_name) ??
            textValue(meta?.mcpToolName) ??
            textValue(recordValue(rawInput)?.tool)
          : previous.toolName,
        rawInput: bindsTrustedDescriptor ? rawInput : previous.rawInput,
        status: textValue(update?.status) ?? previous.status,
      });
    }
  }

  return order.flatMap((id) => {
    const call = calls.get(id)!;
    if (
      !call.descriptorBound ||
      (call.status !== "completed" && call.status !== "succeeded")
    ) {
      return [];
    }
    const operation = dispatcherOperation(call.toolName, call.rawInput);
    return operation ? [operation] : [];
  });
}

export function observeCompletedProductOperations(
  value: unknown,
  targetTurnId: string,
  journal: DemoEventJournal,
): string[] {
  const operations = extractCompletedProductOperations(value, targetTurnId);
  for (const operation of operations) {
    journal.record({
      source: "product",
      type: "product.operation.completed",
      turnId: targetTurnId,
      label: operation,
      status: "completed",
    });
  }
  return operations;
}

export function evaluateAgentEvidence(input: {
  requirements: AgentEvidenceRequirements;
  completedOperations: string[];
  readback: ProductReadback;
}): AgentEvidenceResult {
  const completedOperationCounts: Record<string, number> = {};
  for (const operation of input.completedOperations) {
    completedOperationCounts[operation] = (completedOperationCounts[operation] ?? 0) + 1;
  }

  const missingOperations = input.requirements.operations.flatMap((requirement) => {
    const observed = completedOperationCounts[requirement.name] ?? 0;
    return observed < requirement.minCalls
      ? [{ name: requirement.name, expected: requirement.minCalls, observed }]
      : [];
  });
  const metrics = {
    canvasNodes: Array.isArray(input.readback.canvas.nodes)
      ? input.readback.canvas.nodes.length
      : 0,
    timelines: Array.isArray(input.readback.timelines.timelines)
      ? input.readback.timelines.timelines.length
      : 0,
    directorStages: Array.isArray(input.readback.directorStages.stages)
      ? input.readback.directorStages.stages.length
      : 0,
    completedOperationCounts,
  };
  const failures = missingOperations.map(
    ({ name, expected, observed }) =>
      `expected at least ${expected} completed ${name} call(s), observed ${observed}`,
  );

  const requiredState = input.requirements.requiredProductState;
  const canvasNodes = Array.isArray(input.readback.canvas.nodes)
    ? input.readback.canvas.nodes
    : [];
  const timelines = Array.isArray(input.readback.timelines.timelines)
    ? input.readback.timelines.timelines
    : [];
  const directorStages = Array.isArray(input.readback.directorStages.stages)
    ? input.readback.directorStages.stages
    : [];
  const missingProductState: AgentEvidenceResult["missingProductState"] = [
    ...(requiredState?.canvasNodes ?? []).flatMap((expected) =>
      canvasNodes.some((node) => canvasNodeMatches(node, expected))
        ? []
        : [{
            kind: "canvasNode" as const,
            expected: artifactSafeCanvasRequirement(expected),
          }]
    ),
    ...(requiredState?.timelines ?? []).flatMap((expected) =>
      timelines.some((timeline) => namedOwnedEntityMatches(timeline, expected))
        ? []
        : [{ kind: "timeline" as const, expected }]
    ),
    ...(requiredState?.directorStages ?? []).flatMap((expected) =>
      directorStages.some((stage) => namedOwnedEntityMatches(stage, expected))
        ? []
        : [{ kind: "directorStage" as const, expected }]
    ),
  ];

  const minimum = input.requirements.minimumProductState;
  if (metrics.canvasNodes < minimum.canvasNodes) {
    failures.push(
      `expected at least ${minimum.canvasNodes} Canvas node(s), observed ${metrics.canvasNodes}`,
    );
  }
  if (metrics.timelines < minimum.timelines) {
    failures.push(
      `expected at least ${minimum.timelines} Timeline, observed ${metrics.timelines}`,
    );
  }
  if (metrics.directorStages < minimum.directorStages) {
    failures.push(
      `expected at least ${minimum.directorStages} Director Stage, observed ${metrics.directorStages}`,
    );
  }
  for (const missing of missingProductState) {
    const entity = missing.kind === "canvasNode"
      ? "Canvas node"
      : missing.kind === "timeline"
        ? "Timeline"
        : "Director Stage";
    failures.push(
      `expected ${entity} matching ${describeExpectedEntity(missing.expected)}, observed none`,
    );
  }

  return {
    status: failures.length === 0 ? "pass" : "fail",
    failures,
    missingOperations,
    missingProductState,
    metrics,
  };
}
