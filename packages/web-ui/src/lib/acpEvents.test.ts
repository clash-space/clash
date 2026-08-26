import { describe, expect, it } from "vitest";
import {
  appendAcpEvent,
  commandActionFromAvailableCommand,
  goalStateFromAcpEvent,
  mergeSessionInfoMetadata,
  sessionInfoStateFromAcpEvent,
  usageStateFromAcpEvent,
  type ByoMessage,
} from "./acpEvents";

describe("commandActionFromAvailableCommand", () => {
  it("reads an advertised config action without coupling it to an agent id", () => {
    expect(commandActionFromAvailableCommand({
      name: "plan",
      description: "Turn plan mode on.",
      _meta: {
        commandAction: {
          kind: "setConfigOption",
          configId: "collaboration_mode",
          value: "plan",
          resetValue: "default",
          presentation: "state",
        },
      },
    })).toEqual({
      kind: "setConfigOption",
      configId: "collaboration_mode",
      value: "plan",
      resetValue: "default",
      presentation: "state",
    });
  });

  it("keeps prompt-backed and unknown command actions on the generic prompt path", () => {
    expect(commandActionFromAvailableCommand({
      name: "goal",
      _meta: {
        commandAction: {
          kind: "prefixPrompt",
          presentation: "state",
        },
      },
    })).toEqual({
      kind: "prefixPrompt",
      presentation: "state",
    });
    expect(commandActionFromAvailableCommand({
      name: "future",
      _meta: {
        commandAction: {
          kind: "openPortal",
          portal: "future",
        },
      },
    })).toBeNull();
  });
});

describe("goalStateFromAcpEvent", () => {
  it("extracts the Codex goal snapshot from ACP session info updates", () => {
    expect(goalStateFromAcpEvent({
      sessionId: "acp-session",
      update: {
        sessionUpdate: "session_info_update",
        _meta: {
          codex: {
            goal: {
              objective: "Ship the Plan and Goal composer UX",
              status: "blocked",
              tokenBudget: 48_000,
              timeUsedSeconds: 361,
              createdAt: 1_785_201_976,
              controlMethod: "_codex/session/goal_control",
            },
          },
        },
      },
    })).toEqual({
      objective: "Ship the Plan and Goal composer UX",
      status: "blocked",
      tokenBudget: 48_000,
      timeUsedSeconds: 361,
      createdAt: 1_785_201_976,
      controlMethod: "_codex/session/goal_control",
    });
  });

  it("distinguishes an explicit goal clear from unrelated session info", () => {
    expect(goalStateFromAcpEvent({
      sessionUpdate: "session_info_update",
      _meta: { codex: { goal: null } },
    })).toBeNull();
    expect(goalStateFromAcpEvent({
      sessionUpdate: "session_info_update",
      title: "A generated title",
    })).toBeUndefined();
    expect(goalStateFromAcpEvent({
      sessionUpdate: "usage_update",
      _meta: { codex: { goal: null } },
    })).toBeUndefined();
  });

  it("keeps ACP session metadata generic while Goal remains a namespaced adapter", () => {
    expect(sessionInfoStateFromAcpEvent({
      sessionUpdate: "session_info_update",
      title: "Claude supplied title",
      updatedAt: "2026-07-28T02:00:00.000Z",
      _meta: {
        claude: {
          branch: "feature/session-state",
        },
      },
    })).toEqual({
      title: "Claude supplied title",
      updatedAt: "2026-07-28T02:00:00.000Z",
      metadata: {
        claude: {
          branch: "feature/session-state",
        },
      },
    });
    expect(goalStateFromAcpEvent({
      sessionUpdate: "session_info_update",
      _meta: { claude: { branch: "feature/session-state" } },
    })).toBeUndefined();
  });

  it("deep-merges partial namespaced metadata without dropping an active feature", () => {
    expect(mergeSessionInfoMetadata({
      codex: {
        goal: {
          objective: "Keep Goal alive",
          status: "active",
        },
      },
    }, {
      codex: {
        threadStatus: { type: "idle" },
      },
      cursor: {
        planId: "plan-1",
      },
    })).toEqual({
      codex: {
        goal: {
          objective: "Keep Goal alive",
          status: "active",
        },
        threadStatus: { type: "idle" },
      },
      cursor: {
        planId: "plan-1",
      },
    });
  });
});

describe("usageStateFromAcpEvent", () => {
  it("normalizes standard ACP usage without adding transcript content", () => {
    expect(usageStateFromAcpEvent({
      sessionId: "claude-session",
      update: {
        sessionUpdate: "usage_update",
        used: 12_500,
        size: 200_000,
        cost: { amount: 0.42, currency: "USD" },
        _meta: { "_claude/origin": "first_party" },
      },
    })).toEqual({
      used: 12_500,
      size: 200_000,
      cost: { amount: 0.42, currency: "USD" },
      metadata: { "_claude/origin": "first_party" },
    });
  });
});

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

  it("deep-merges namespaced tool metadata across partial ACP updates", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-tool-meta", undefined, {
      sessionUpdate: "tool_call",
      toolCallId: "tool-meta-1",
      title: "Edit",
      status: "in_progress",
      _meta: {
        claudeCode: {
          toolName: "Edit",
          parentToolUseId: "parent-1",
          subagent: true,
        },
      },
    });
    appendAcpEvent(messages, "turn-tool-meta", 0, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-meta-1",
      status: "failed",
      _meta: {
        claudeCode: {
          nonExecutionKind: "user-rejected",
          userFeedback: "Use a different file.",
        },
      },
    });

    expect(messages[0]?.parts[0]).toMatchObject({
      type: "tool_call",
      toolCallId: "tool-meta-1",
      toolName: "Edit",
      meta: {
        claudeCode: {
          toolName: "Edit",
          parentToolUseId: "parent-1",
          subagent: true,
          nonExecutionKind: "user-rejected",
          userFeedback: "Use a different file.",
        },
      },
    });
  });

  it("preserves ACP MCP identity for Clash-specific rendering", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-clash-mcp", undefined, {
      sessionUpdate: "tool_call",
      toolCallId: "mcp-call-1",
      title: "mcp.clash.clash_canvas_open",
      kind: "execute",
      status: "in_progress",
      rawInput: {
        server: "clash",
        tool: "clash_canvas_open",
        arguments: { cwd: "/Users/me/.clash/projects/demo" },
      },
      _meta: {
        is_mcp_tool_call: true,
        "clash.host_trusted_mcp": true,
        "clash.renderer": "product",
      },
    });

    expect(messages[0]?.parts).toEqual([
      expect.objectContaining({
        type: "tool_call",
        toolCallId: "mcp-call-1",
        mcp: {
          serverName: "clash",
          toolName: "clash_canvas_open",
          renderer: "product",
        },
        meta: {
          is_mcp_tool_call: true,
          "clash.host_trusted_mcp": true,
          "clash.renderer": "product",
        },
      }),
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

  it("preserves Codex commentary and final-answer phases as separate timeline parts", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-codex-phase", undefined, {
      sessionUpdate: "agent_message_chunk",
      messageId: "commentary-1",
      _meta: { codex: { phase: "commentary" } },
      content: { type: "text", text: "Checking " },
    });
    appendAcpEvent(messages, "turn-codex-phase", 0, {
      sessionUpdate: "agent_message_chunk",
      messageId: "commentary-1",
      _meta: { codex: { phase: "commentary" } },
      content: { type: "text", text: "the files." },
    });
    appendAcpEvent(messages, "turn-codex-phase", 0, {
      sessionUpdate: "agent_message_chunk",
      messageId: "final-1",
      _meta: { codex: { phase: "final_answer" } },
      content: { type: "text", text: "Done." },
    });

    expect(messages[0]?.parts).toEqual([
      {
        type: "text",
        text: "Checking the files.",
        messageId: "commentary-1",
        phase: "commentary",
      },
      {
        type: "text",
        text: "Done.",
        messageId: "final-1",
        phase: "final_answer",
      },
    ]);
  });

  it("keeps distinct ACP text message ids in separate timeline parts", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-message-ids", undefined, {
      sessionUpdate: "agent_message_chunk",
      messageId: "message-1",
      content: { type: "text", text: "First message." },
    });
    appendAcpEvent(messages, "turn-message-ids", 0, {
      sessionUpdate: "agent_message_chunk",
      messageId: "message-2",
      content: { type: "text", text: "Second message." },
    });

    expect(messages[0]?.parts).toEqual([
      {
        type: "text",
        text: "First message.",
        messageId: "message-1",
      },
      {
        type: "text",
        text: "Second message.",
        messageId: "message-2",
      },
    ]);
  });

  it("preserves repeated single-character ACP delta chunks", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-repeated-delta", undefined, {
      sessionUpdate: "agent_message_chunk",
      messageId: "message-1",
      content: { type: "text", text: "/project-423" },
    });
    appendAcpEvent(messages, "turn-repeated-delta", 0, {
      sessionUpdate: "agent_message_chunk",
      messageId: "message-1",
      content: { type: "text", text: "3" },
    });

    expect(messages[0]?.parts).toEqual([
      {
        type: "text",
        text: "/project-4233",
        messageId: "message-1",
      },
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

  it("keeps standalone Codex skill-budget diagnostics out of the message stream", () => {
    const messages: ByoMessage[] = [];

    const result = appendAcpEvent(messages, "turn-skill-budget", undefined, {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "Warning: Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill.",
      },
    });

    expect(result.idx).toBe(-1);
    expect(messages).toEqual([]);
  });

  it("keeps a current Codex skill warning out of same-chunk assistant prose", () => {
    const messages: ByoMessage[] = [];
    const warning =
      "Warning: Skill descriptions were shortened to fit the skills context budget. " +
      "Codex can still see every skill, but some descriptions are shorter. " +
      "Disable unused skills or plugins to leave more room for the rest.";

    appendAcpEvent(messages, "turn-current-skill-budget", undefined, {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: `${warning}\n\n那就先喝两口水。`,
      },
    });

    expect(messages).toEqual([{
      id: "asst-turn-current-skill-budget",
      role: "assistant",
      parts: [{ type: "text", text: "那就先喝两口水。" }],
    }]);
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

  it("keeps broker permission requests out of transcript activity", () => {
    const messages: ByoMessage[] = [];

    const result = appendAcpEvent(messages, "turn-permission", undefined, {
      type: "requestPermission",
      params: {
        id: "perm-1",
        title: "Run shell command",
        options: [{ optionId: "allow", kind: "allow_once" }],
      },
    });

    expect(result.idx).toBe(-1);
    expect(messages).toEqual([]);
  });

  it("surfaces prompt errors instead of spinning forever", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-error", undefined, {
      type: "promptError",
      error: "agent crashed",
    });

    expect(messages[0]?.parts).toEqual([{
      type: "event_note",
      title: "agent crashed",
      tone: "error",
    }]);
  });

  it("extracts the actionable message from noisy JSON prompt errors", () => {
    const messages: ByoMessage[] = [];

    appendAcpEvent(messages, "turn-model-error", undefined, {
      type: "promptError",
      error: [
        "Warning: Model metadata for gpt-5.6-sol not found. Defaulting to fallback metadata; this can degrade performance and cause issues.",
        JSON.stringify({
          type: "error",
          status: 400,
          error: {
            type: "invalid_request_error",
            message: "The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
          },
        }),
      ].join("\n"),
    });

    expect(messages[0]?.parts).toEqual([{
      type: "event_note",
      title: "Codex update required",
      detail: "The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
      tone: "error",
    }]);
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

  it("keeps permission toolCall payloads out of transcript activity", () => {
    const messages: ByoMessage[] = [];

    const result = appendAcpEvent(messages, "turn-permission-tool", undefined, {
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

    expect(result.idx).toBe(-1);
    expect(messages).toEqual([]);
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
        parts: [{ type: "text", text: "Hello", messageId: "msg-1" }],
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
