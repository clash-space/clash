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

  it("parses bare tool_call events from local runtime streams", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-tool", undefined, {
      type: "tool_call",
      toolCallId: "tool-1",
      title: "Read",
      rawInput: { path: "notes.md" },
      status: "pending",
    });

    expect(messages).toEqual([
      {
        id: "asst-turn-tool",
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            toolCallId: "tool-1",
            title: "Read",
            rawInput: { path: "notes.md" },
            status: "pending",
          },
        ],
      },
    ]);
  });

  it("parses snake_case tool call aliases from ACP implementations", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-alias", undefined, {
      type: "tool_call_update",
      tool_call_id: "tool-2",
      tool_name: "Bash",
      raw_input: { command: "ls" },
      raw_output: "ok",
      status: "completed",
    });

    expect(messages[0]?.parts).toEqual([
      {
        type: "tool_call",
        toolCallId: "tool-2",
        title: "Bash",
        toolName: "Bash",
        rawInput: { command: "ls" },
        rawOutput: "ok",
        status: "completed",
      },
    ]);
  });

  it("parses bare ACP message and thought update types", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-chunks", undefined, {
      type: "agent_thought_chunk",
      text: "Inspecting canvas",
    });
    appendAcpEvent(messages, "turn-chunks", 0, {
      type: "agent_message_chunk",
      content: "Done",
    });

    expect(messages[0]?.parts).toEqual([
      { type: "thought", text: "Inspecting canvas" },
      { type: "text", text: "Done" },
    ]);
  });

  it("keeps Gemini ACP thought chunks separate from assistant message chunks", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-gemini", undefined, {
      sessionId: "gemini-session",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Considering the exact response." },
      },
    });
    appendAcpEvent(messages, "turn-gemini", 0, {
      sessionId: "gemini-session",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "PONG" },
      },
    });

    expect(messages[0]?.parts).toEqual([
      { type: "thought", text: "Considering the exact response." },
      { type: "text", text: "PONG" },
    ]);
  });

  it("drops Codex transport diagnostics instead of rendering them as assistant prose", () => {
    const messages: ByoMessage[] = [];

    const result = appendAcpEvent(messages, "turn-transport", undefined, {
      type: "agent_message_chunk",
      content: "Falling back from WebSockets to HTTPS transport. request timed out",
    });

    expect(result.idx).toBe(-1);
    expect(messages).toEqual([]);
  });

  it("parses snake_case available command updates from ACP implementations", () => {
    const messages: ByoMessage[] = [];

    const result = appendAcpEvent(messages, "turn-commands", undefined, {
      sessionUpdate: "available_commands_update",
      available_commands: [
        { name: "review", description: "Review the current cut" },
        { name: "render", input: { hint: "scene id" } },
      ],
    });

    expect(result.idx).toBe(-1);
    expect(result.commands).toEqual([
      { name: "review", description: "Review the current cut" },
      { name: "render", input: { hint: "scene id" } },
    ]);
    expect(messages).toEqual([]);
  });

  it("surfaces permission requests as pending tool calls", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-permission", undefined, {
      type: "requestPermission",
      params: {
        id: "perm-1",
        title: "Run shell command",
        options: [{ optionId: "allow", kind: "allow_once" }],
      },
    });

    expect(messages[0]?.parts).toEqual([
      {
        type: "tool_call",
        toolCallId: "permission-perm-1",
        title: "Run shell command",
        kind: "permission",
        status: "pending",
        rawInput: {
          id: "perm-1",
          title: "Run shell command",
          options: [{ optionId: "allow", kind: "allow_once" }],
        },
      },
    ]);
  });

  it("surfaces prompt errors instead of spinning forever", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-error", undefined, {
      type: "promptError",
      error: "agent crashed",
    });

    expect(messages[0]?.parts).toEqual([{ type: "text", text: "agent crashed" }]);
  });

  it("parses ACP 0.25 plan update and removal events into visible parts", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-plan", undefined, {
      sessionUpdate: "plan_update",
      plan: {
        content: {
          type: "plan",
          entries: [
            { content: "Inspect canvas nodes", status: "completed", priority: "high" },
            { content: "Summarize nodes", status: "in_progress", priority: "medium" },
          ],
        },
      },
    });
    appendAcpEvent(messages, "turn-plan", 0, {
      sessionUpdate: "plan_removed",
      id: "plan-1",
    });

    expect(messages[0]?.parts).toEqual([
      {
        type: "plan",
        entries: [
          { content: "Inspect canvas nodes", status: "completed", priority: "high" },
          { content: "Summarize nodes", status: "in_progress", priority: "medium" },
        ],
      },
      {
        type: "event_note",
        title: "Plan removed",
        detail: "plan-1",
        tone: "neutral",
      },
    ]);
  });

  it("uses the ACP permission toolCall payload when present", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-permission-tool", undefined, {
      type: "requestPermission",
      params: {
        sessionId: "s1",
        toolCall: {
          toolCallId: "tc-list",
          title: "List canvas nodes",
          kind: "list",
          rawInput: { query: "canvas.nodes" },
        },
        options: [{ optionId: "allow", kind: "allow_once" }],
      },
    });

    expect(messages[0]?.parts).toEqual([
      {
        type: "tool_call",
        toolCallId: "permission-tc-list",
        title: "List canvas nodes",
        kind: "list",
        status: "pending",
        rawInput: { query: "canvas.nodes" },
      },
    ]);
  });

  it("renders OpenMA live message chunks and canonical messages without duplicate text", () => {
    const messages: ByoMessage[] = [];

    expect(appendAcpEvent(messages, "turn-openma", undefined, {
      type: "agent.message_stream_start",
      message_id: "msg-1",
    }).idx).toBe(-1);
    appendAcpEvent(messages, "turn-openma", undefined, {
      type: "agent.message_chunk",
      message_id: "msg-1",
      delta: "Hel",
    });
    appendAcpEvent(messages, "turn-openma", 0, {
      type: "agent.message_chunk",
      message_id: "msg-1",
      delta: "lo",
    });
    appendAcpEvent(messages, "turn-openma", 0, {
      type: "agent.message_stream_end",
      message_id: "msg-1",
      status: "completed",
    });
    appendAcpEvent(messages, "turn-openma", 0, {
      type: "agent.message",
      message_id: "msg-1",
      content: [{ type: "text", text: "Hello" }],
    });

    expect(messages).toEqual([
      {
        id: "asst-turn-openma",
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
      },
    ]);
  });

  it("renders OpenMA thinking and tool use/result events through the existing message shape", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-openma-tool", undefined, {
      type: "agent.thinking",
      thinking_id: "think-1",
      text: "Checking project files",
    });
    appendAcpEvent(messages, "turn-openma-tool", 0, {
      type: "agent.tool_use",
      id: "tool-1",
      name: "pwd",
      input: { cmd: "pwd" },
    });
    appendAcpEvent(messages, "turn-openma-tool", 0, {
      type: "agent.tool_result",
      tool_use_id: "tool-1",
      content: "/tmp/project\n",
    });

    expect(messages[0]?.parts).toEqual([
      { type: "thought", text: "Checking project files" },
      {
        type: "tool_call",
        toolCallId: "tool-1",
        title: "pwd",
        toolName: "pwd",
        rawInput: { cmd: "pwd" },
        rawOutput: "/tmp/project\n",
        status: "completed",
      },
    ]);
  });

  it("keeps OpenMA status and warning events out of assistant prose", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-openma-status", undefined, { type: "session.status_running" });
    appendAcpEvent(messages, "turn-openma-status", undefined, {
      type: "session.warning",
      source: "codex",
      message: "request timed out",
    });
    appendAcpEvent(messages, "turn-openma-status", undefined, { type: "session.status_idle" });

    expect(messages).toEqual([]);
  });
});
