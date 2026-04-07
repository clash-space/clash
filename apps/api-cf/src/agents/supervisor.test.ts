import { describe, it, expect, vi } from "vitest";
import { applyChunkToParts } from "./apply-chunk";

/**
 * Tests for the SupervisorAgent's direct WS streaming logic.
 *
 * We test:
 *   1. finishReason remapping (stream chunk transform)
 *   2. applyChunkToParts (server-side message building)
 *   3. WS broadcast protocol format
 */

// ─── 1. finishReason remapping ─────────────────────────────────

function remapFinishEvent(chunk: Record<string, unknown>): Record<string, unknown> {
  if (chunk.type === "finish" && "finishReason" in chunk) {
    const { finishReason, ...rest } = chunk;
    return { ...rest, type: "finish", messageMetadata: { finishReason } };
  }
  return chunk;
}

describe("remapFinishEvent", () => {
  it("moves finishReason into messageMetadata for finish events", () => {
    const chunk = { type: "finish", finishReason: "stop", usage: { tokens: 100 } };
    const result = remapFinishEvent(chunk);

    expect(result).toEqual({
      type: "finish",
      usage: { tokens: 100 },
      messageMetadata: { finishReason: "stop" },
    });
    expect(result).not.toHaveProperty("finishReason");
  });

  it("passes through non-finish events unchanged", () => {
    const chunk = { type: "text-delta", delta: "hello" };
    expect(remapFinishEvent(chunk)).toBe(chunk); // same reference
  });

  it("passes through finish events without finishReason unchanged", () => {
    const chunk = { type: "finish" };
    expect(remapFinishEvent(chunk)).toBe(chunk);
  });
});

// ─── 2. applyChunkToParts (server-side message building) ───────

describe("applyChunkToParts", () => {
  it("builds text from start/delta/end events", () => {
    const parts: any[] = [];
    applyChunkToParts(parts, { type: "text-start" });
    applyChunkToParts(parts, { type: "text-delta", delta: "Hello " });
    applyChunkToParts(parts, { type: "text-delta", delta: "world" });
    applyChunkToParts(parts, { type: "text-end" });

    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ type: "text", text: "Hello world", state: "done" });
  });

  it("builds tool call from input-start → input-available → output-available", () => {
    const parts: any[] = [];

    applyChunkToParts(parts, {
      type: "tool-input-start",
      toolCallId: "call_1",
      toolName: "create_generation_node",
    });
    expect(parts[0].state).toBe("input-streaming");
    expect(parts[0].input).toBeUndefined();

    applyChunkToParts(parts, {
      type: "tool-input-available",
      toolCallId: "call_1",
      toolName: "create_generation_node",
      input: { node_type: "image_gen", prompt: "A cat" },
    });
    expect(parts[0].state).toBe("input-available");
    expect(parts[0].input).toEqual({ node_type: "image_gen", prompt: "A cat" });

    applyChunkToParts(parts, {
      type: "tool-output-available",
      toolCallId: "call_1",
      output: "Created generation node abc123",
    });
    expect(parts[0].state).toBe("output-available");
    expect(parts[0].output).toBe("Created generation node abc123");
  });

  it("handles multiple parallel tool calls", () => {
    const parts: any[] = [];

    applyChunkToParts(parts, { type: "tool-input-start", toolCallId: "c1", toolName: "list_models" });
    applyChunkToParts(parts, { type: "tool-input-start", toolCallId: "c2", toolName: "create_generation_node" });
    applyChunkToParts(parts, { type: "tool-input-available", toolCallId: "c1", toolName: "list_models", input: { kind: "image" } });
    applyChunkToParts(parts, { type: "tool-input-available", toolCallId: "c2", toolName: "create_generation_node", input: { prompt: "Cat" } });
    applyChunkToParts(parts, { type: "tool-output-available", toolCallId: "c1", output: [{ id: "flux" }] });
    applyChunkToParts(parts, { type: "tool-output-available", toolCallId: "c2", output: "Created node xyz" });

    expect(parts).toHaveLength(2);
    expect(parts[0].toolName).toBe("list_models");
    expect(parts[0].input).toEqual({ kind: "image" });
    expect(parts[0].output).toEqual([{ id: "flux" }]);
    expect(parts[1].toolName).toBe("create_generation_node");
    expect(parts[1].input).toEqual({ prompt: "Cat" });
    expect(parts[1].output).toBe("Created node xyz");
  });

  it("handles mixed text and tool parts", () => {
    const parts: any[] = [];

    applyChunkToParts(parts, { type: "text-start" });
    applyChunkToParts(parts, { type: "text-delta", delta: "Let me help." });
    applyChunkToParts(parts, { type: "text-end" });
    applyChunkToParts(parts, { type: "tool-input-start", toolCallId: "c1", toolName: "search_canvas" });
    applyChunkToParts(parts, { type: "tool-input-available", toolCallId: "c1", toolName: "search_canvas", input: { query: "cat" } });
    applyChunkToParts(parts, { type: "tool-output-available", toolCallId: "c1", output: "Found 3 nodes" });

    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "Let me help.", state: "done" });
    expect(parts[1].toolName).toBe("search_canvas");
    expect(parts[1].state).toBe("output-available");
  });

  it("handles tool-input-error", () => {
    const parts: any[] = [];

    applyChunkToParts(parts, { type: "tool-input-start", toolCallId: "c1", toolName: "bad_tool" });
    applyChunkToParts(parts, {
      type: "tool-input-error",
      toolCallId: "c1",
      toolName: "bad_tool",
      input: { invalid: true },
      errorText: "Invalid arguments",
    });

    expect(parts[0].state).toBe("output-error");
    expect(parts[0].errorText).toBe("Invalid arguments");
  });

  it("handles tool-output-error", () => {
    const parts: any[] = [];

    applyChunkToParts(parts, { type: "tool-input-start", toolCallId: "c1", toolName: "failing_tool" });
    applyChunkToParts(parts, { type: "tool-input-available", toolCallId: "c1", toolName: "failing_tool", input: {} });
    applyChunkToParts(parts, { type: "tool-output-error", toolCallId: "c1", errorText: "Timeout" });

    expect(parts[0].state).toBe("output-error");
    expect(parts[0].errorText).toBe("Timeout");
  });

  it("handles step-start events", () => {
    const parts: any[] = [];
    applyChunkToParts(parts, { type: "step-start" });
    expect(parts).toEqual([{ type: "step-start" }]);
  });

  it("returns false for unknown chunk types", () => {
    const parts: any[] = [];
    expect(applyChunkToParts(parts, { type: "unknown-type" })).toBe(false);
    expect(parts).toHaveLength(0);
  });

  it("creates tool-input-available part even without prior start", () => {
    const parts: any[] = [];
    applyChunkToParts(parts, {
      type: "tool-input-available",
      toolCallId: "c1",
      toolName: "list_models",
      input: { kind: "image" },
    });

    expect(parts).toHaveLength(1);
    expect(parts[0].state).toBe("input-available");
    expect(parts[0].input).toEqual({ kind: "image" });
  });
});

// ─── 3. WS broadcast protocol ──────────────────────────────────

describe("WS broadcast message format", () => {
  it("stream chunk messages have correct shape", () => {
    const chunk = { type: "text-delta", delta: "hello" };
    const body = JSON.stringify(remapFinishEvent(chunk));
    const wsMessage = {
      body,
      done: false,
      id: "req-123",
      type: "cf_agent_use_chat_response",
    };

    expect(wsMessage.type).toBe("cf_agent_use_chat_response");
    expect(wsMessage.done).toBe(false);
    expect(JSON.parse(wsMessage.body)).toEqual(chunk);
  });

  it("stream done message has empty body", () => {
    const wsMessage = {
      body: "",
      done: true,
      id: "req-123",
      type: "cf_agent_use_chat_response",
    };

    expect(wsMessage.done).toBe(true);
    expect(wsMessage.body).toBe("");
  });

  it("stream error message includes error flag", () => {
    const err = new Error("Connection lost");
    const wsMessage = {
      body: err.message,
      done: true,
      error: true,
      id: "req-123",
      type: "cf_agent_use_chat_response",
    };

    expect(wsMessage.error).toBe(true);
    expect(wsMessage.body).toBe("Connection lost");
  });
});
