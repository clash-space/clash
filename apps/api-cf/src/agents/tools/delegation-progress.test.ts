import { describe, it, expect } from "vitest";
import type { SubAgentToolCall } from "./delegation";

/**
 * Tests for SubAgentToolCall accumulation logic used in the delegation tool's
 * generator. We extract the accumulation algorithm and test it in isolation
 * since the actual generator requires a live LLM stream.
 */

// ─── Accumulation logic (mirrors delegation.ts generator loop) ───

interface ToolCallEvent {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface ToolResultEvent {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
}

type StreamEvent = ToolCallEvent | ToolResultEvent | { type: "text-delta"; text: string };

function simulateAccumulation(events: StreamEvent[]) {
  const accumulated: SubAgentToolCall[] = [];
  const yields: { toolCalls: SubAgentToolCall[] }[] = [];
  let stepCount = 0;

  for (const part of events) {
    if (part.type === "tool-call") {
      accumulated.push({
        id: part.toolCallId,
        toolName: part.toolName,
        args: part.args,
        status: "calling",
      });
      yields.push({
        toolCalls: accumulated.map(t => ({ ...t })),
      });
      stepCount++;
    } else if (part.type === "tool-result") {
      const tc = accumulated.find(t => t.id === part.toolCallId);
      if (tc) {
        const output = part.output;
        tc.output = typeof output === "string"
          ? output.slice(0, 300)
          : JSON.stringify(output).slice(0, 300);
        tc.status = "completed";
      }
      yields.push({
        toolCalls: accumulated.map(t => ({ ...t })),
      });
    }
  }

  return { accumulated, yields };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("SubAgentToolCall accumulation", () => {
  it("accumulates a single tool call → result cycle", () => {
    const { accumulated, yields } = simulateAccumulation([
      { type: "tool-call", toolCallId: "c1", toolName: "list_canvas_nodes", args: {} },
      { type: "tool-result", toolCallId: "c1", toolName: "list_canvas_nodes", output: "3 nodes found" },
    ]);

    expect(accumulated).toHaveLength(1);
    expect(accumulated[0]).toEqual({
      id: "c1",
      toolName: "list_canvas_nodes",
      args: {},
      output: "3 nodes found",
      status: "completed",
    });

    // First yield: tool call started
    expect(yields[0].toolCalls).toHaveLength(1);
    expect(yields[0].toolCalls[0].status).toBe("calling");
    expect(yields[0].toolCalls[0].toolName).toBe("list_canvas_nodes");

    // Second yield: tool result
    expect(yields[1].toolCalls).toHaveLength(1);
    expect(yields[1].toolCalls[0].status).toBe("completed");
    expect(yields[1].toolCalls[0].output).toBe("3 nodes found");
  });

  it("accumulates multiple sequential tool calls (history preserved)", () => {
    const { yields } = simulateAccumulation([
      { type: "tool-call", toolCallId: "c1", toolName: "list_canvas_nodes", args: {} },
      { type: "tool-result", toolCallId: "c1", toolName: "list_canvas_nodes", output: "ok" },
      { type: "tool-call", toolCallId: "c2", toolName: "create_canvas_node", args: { type: "text" } },
      { type: "tool-result", toolCallId: "c2", toolName: "create_canvas_node", output: "created node123" },
      { type: "tool-call", toolCallId: "c3", toolName: "read_canvas_node", args: { id: "node123" } },
      { type: "tool-result", toolCallId: "c3", toolName: "read_canvas_node", output: "content..." },
    ]);

    // After 3rd tool call started, all 3 should be present
    const thirdCallYield = yields[4]; // 5th yield (0-indexed)
    expect(thirdCallYield.toolCalls).toHaveLength(3);
    expect(thirdCallYield.toolCalls[0].status).toBe("completed");
    expect(thirdCallYield.toolCalls[1].status).toBe("completed");
    expect(thirdCallYield.toolCalls[2].status).toBe("calling");

    // Final yield has all 3 completed
    const lastYield = yields[yields.length - 1];
    expect(lastYield.toolCalls).toHaveLength(3);
    expect(lastYield.toolCalls.every(tc => tc.status === "completed")).toBe(true);
  });

  it("each yield is a snapshot (not a reference to the same array)", () => {
    const { yields } = simulateAccumulation([
      { type: "tool-call", toolCallId: "c1", toolName: "list_canvas_nodes", args: {} },
      { type: "tool-call", toolCallId: "c2", toolName: "create_canvas_node", args: { type: "text" } },
    ]);

    // First yield should only have 1 tool call
    expect(yields[0].toolCalls).toHaveLength(1);
    // Second yield should have 2
    expect(yields[1].toolCalls).toHaveLength(2);
    // They should be independent arrays
    expect(yields[0].toolCalls).not.toBe(yields[1].toolCalls);
  });

  it("preserves tool call args", () => {
    const { yields } = simulateAccumulation([
      { type: "tool-call", toolCallId: "c1", toolName: "create_canvas_node", args: { type: "text", label: "Scene 1", parent_id: "group-123" } },
    ]);

    expect(yields[0].toolCalls[0].args).toEqual({
      type: "text",
      label: "Scene 1",
      parent_id: "group-123",
    });
  });

  it("truncates long outputs to 300 chars", () => {
    const longOutput = "a".repeat(500);
    const { accumulated } = simulateAccumulation([
      { type: "tool-call", toolCallId: "c1", toolName: "read_canvas_node", args: { id: "n1" } },
      { type: "tool-result", toolCallId: "c1", toolName: "read_canvas_node", output: longOutput },
    ]);

    expect(accumulated[0].output!.length).toBe(300);
  });

  it("handles object outputs (JSON stringified and truncated)", () => {
    const objectOutput = { nodes: Array.from({ length: 50 }, (_, i) => ({ id: `node-${i}`, type: "text" })) };
    const { accumulated } = simulateAccumulation([
      { type: "tool-call", toolCallId: "c1", toolName: "list_canvas_nodes", args: {} },
      { type: "tool-result", toolCallId: "c1", toolName: "list_canvas_nodes", output: objectOutput },
    ]);

    expect(accumulated[0].output).toBeDefined();
    expect(accumulated[0].output!.length).toBeLessThanOrEqual(300);
    // Should be valid JSON prefix
    expect(accumulated[0].output!.startsWith("{")).toBe(true);
  });

  it("ignores text-delta events (no tool calls created)", () => {
    const { accumulated, yields } = simulateAccumulation([
      { type: "text-delta", text: "Hello" },
      { type: "text-delta", text: " world" },
    ]);

    expect(accumulated).toHaveLength(0);
    expect(yields).toHaveLength(0);
  });

  it("matches tool-result to correct tool-call by toolCallId", () => {
    const { accumulated } = simulateAccumulation([
      { type: "tool-call", toolCallId: "c1", toolName: "list_canvas_nodes", args: {} },
      { type: "tool-call", toolCallId: "c2", toolName: "create_canvas_node", args: { type: "text" } },
      // Results come back in reverse order
      { type: "tool-result", toolCallId: "c2", toolName: "create_canvas_node", output: "created" },
      { type: "tool-result", toolCallId: "c1", toolName: "list_canvas_nodes", output: "listed" },
    ]);

    expect(accumulated[0].toolName).toBe("list_canvas_nodes");
    expect(accumulated[0].output).toBe("listed");
    expect(accumulated[0].status).toBe("completed");

    expect(accumulated[1].toolName).toBe("create_canvas_node");
    expect(accumulated[1].output).toBe("created");
    expect(accumulated[1].status).toBe("completed");
  });
});
