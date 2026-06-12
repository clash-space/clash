import { describe, expect, it } from "vitest";
import { appendAcpEvent, type ByoMessage } from "./acpEvents";

describe("appendAcpEvent", () => {
  it("renders simplified local runtime text events", () => {
    const messages: ByoMessage[] = [];

    const result = appendAcpEvent(messages, "turn-local", undefined, {
      type: "text",
      text: "Mock ACP reply: hello local runtime",
    });

    expect(result.idx).toBe(0);
    expect(messages).toEqual([
      {
        id: "asst-turn-local",
        role: "assistant",
        parts: [{ type: "text", text: "Mock ACP reply: hello local runtime" }],
      },
    ]);
  });

  it("coalesces same-turn events when React has not cached the assistant index yet", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-batched", undefined, {
      type: "text",
      text: "first",
    });
    appendAcpEvent(messages, "turn-batched", undefined, {
      type: "clash.canvas.patch",
      operations: [],
    });

    expect(messages).toEqual([
      {
        id: "asst-turn-batched",
        role: "assistant",
        parts: [
          { type: "text", text: "first" },
          { type: "raw_event", event: { type: "clash.canvas.patch", operations: [] } },
        ],
      },
    ]);
  });

  it("recovers when the cached assistant message index is stale", () => {
    const messages: ByoMessage[] = [];

    const result = appendAcpEvent(messages, "turn-1", 2, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Recovered output" },
    });

    expect(result.idx).toBe(0);
    expect(messages).toEqual([
      {
        id: "asst-turn-1",
        role: "assistant",
        parts: [{ type: "text", text: "Recovered output" }],
      },
    ]);
  });
});
