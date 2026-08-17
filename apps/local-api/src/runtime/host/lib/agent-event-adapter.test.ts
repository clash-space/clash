import { describe, expect, it } from "vitest";
import { AgentEventAdapter } from "./agent-event-adapter.js";

describe("AgentEventAdapter", () => {
  it("normalizes Codex collaboration lifecycle from structured ACP evidence", () => {
    const adapter = new AgentEventAdapter({
      sessionId: "session-codex",
      harnessId: "codex-acp",
      now: () => "2026-08-16T00:00:00.000Z",
    });

    const started = adapter.ingest("turn-1", {
      sessionUpdate: "tool_call",
      toolCallId: "tool-spawn",
      title: "spawnAgent",
      status: "in_progress",
      rawInput: {
        message: "Audit the runtime",
        agent_type: "reviewer",
        fork_context: true,
      },
      _meta: {
        codex: {
          collaboration: {
            tool: "spawnAgent",
            receiverThreadIds: ["child-codex-1"],
          },
        },
      },
    });
    const completed = adapter.ingest("turn-1", {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-wait",
      title: "wait",
      status: "completed",
      rawInput: {
        receiverThreadIds: ["child-codex-1"],
        agentsStates: {
          "child-codex-1": {
            status: "completed",
            message: "Runtime audit complete",
          },
        },
      },
      _meta: {
        codex: {
          collaboration: {
            tool: "wait",
            receiverThreadIds: ["child-codex-1"],
          },
        },
      },
    });

    expect(started).toEqual([
      expect.objectContaining({
        schema_version: "oma.event.v1",
        type: "work_item.started",
        session_id: "session-codex",
        turn_id: "turn-1",
        work_item_id: "child-codex-1",
        source: { kind: "harness", harness: "codex-acp", adapter: "codex" },
        data: expect.objectContaining({
          kind: "agent",
          title: "Audit the runtime",
          agent_type: "reviewer",
          fork_context: true,
          tool_call_id: "tool-spawn",
        }),
      }),
    ]);
    expect(completed).toEqual([
      expect.objectContaining({
        type: "work_item.completed",
        work_item_id: "child-codex-1",
        data: expect.objectContaining({ result: "Runtime audit complete" }),
      }),
    ]);
  });

  it("keeps Claude native Agent transcript and usage attached to its structured child id", () => {
    const adapter = new AgentEventAdapter({
      sessionId: "session-claude",
      harnessId: "claude-acp",
      now: () => "2026-08-16T00:00:00.000Z",
    });

    const lifecycle = adapter.ingest("turn-claude", {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-agent",
      title: "Agent",
      status: "completed",
      rawInput: {
        description: "Inspect persistence",
        subagent_type: "Explore",
      },
      _meta: {
        claudeCode: {
          toolName: "Agent",
          toolResponse: {
            agentId: "child-claude-1",
            status: "async_launched",
            isAsync: true,
          },
        },
      },
    });
    const transcript = adapter.ingest("turn-claude", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "I found the persistence boundary." },
      _meta: {
        claudeCode: { parentToolUseId: "tool-agent" },
      },
    });
    const usage = adapter.ingest("turn-claude", {
      sessionUpdate: "usage_update",
      usage: { input_tokens: 10, output_tokens: 4 },
      _meta: {
        claudeCode: { parentToolUseId: "tool-agent" },
      },
    });

    expect(lifecycle[0]).toMatchObject({
      type: "work_item.started",
      work_item_id: "child-claude-1",
      data: { kind: "agent", title: "Inspect persistence", agent_type: "Explore" },
    });
    expect(transcript).toEqual([
      expect.objectContaining({
        type: "agent.message_chunk",
        work_item_id: "child-claude-1",
        parent_id: "tool-agent",
        data: expect.objectContaining({ text: "I found the persistence boundary." }),
      }),
    ]);
    expect(usage).toEqual([
      expect.objectContaining({
        type: "usage.updated",
        work_item_id: "child-claude-1",
        data: expect.objectContaining({
          input_tokens: 10,
          output_tokens: 4,
          total_tokens: 14,
        }),
      }),
    ]);
  });

  it("recognizes OpenCode family Task only with its complete structured contract", () => {
    const adapter = new AgentEventAdapter({
      sessionId: "session-opencode",
      harnessId: "opencode",
      now: () => "2026-08-16T00:00:00.000Z",
    });

    expect(adapter.ingest("turn-open", {
      sessionUpdate: "tool_call_update",
      toolCallId: "ordinary-task-name",
      title: "Task",
      status: "completed",
      rawInput: { description: "missing prompt and subagent type" },
      rawOutput: "agent_id: invented-from-text",
    })).toEqual([]);

    expect(adapter.ingest("turn-open", {
      sessionUpdate: "tool_call_update",
      toolCallId: "native-task",
      title: "Task",
      status: "completed",
      rawInput: {
        description: "Inspect routes",
        prompt: "Read the route tree",
        subagent_type: "explore",
        background: true,
      },
      rawOutput: {
        metadata: {
          parentSessionId: "session-opencode",
          sessionId: "child-opencode-1",
          background: true,
        },
      },
    })).toEqual([
      expect.objectContaining({
        type: "work_item.started",
        work_item_id: "child-opencode-1",
        data: expect.objectContaining({
          kind: "agent",
          title: "Inspect routes",
          agent_type: "explore",
        }),
      }),
    ]);
  });

  it("reidentifies an OpenCode foreground Task when its structured child session arrives", () => {
    const adapter = new AgentEventAdapter({
      sessionId: "session-opencode-reidentify",
      harnessId: "opencode",
      now: () => "2026-08-16T00:00:00.000Z",
    });
    const input = {
      description: "Inspect routes",
      prompt: "Read the route tree",
      subagent_type: "explore",
    };

    const started = adapter.ingest("turn-open", {
      sessionUpdate: "tool_call",
      toolCallId: "native-task",
      title: "Task",
      status: "in_progress",
      rawInput: input,
    });
    const completed = adapter.ingest("turn-open", {
      sessionUpdate: "tool_call_update",
      toolCallId: "native-task",
      title: "Task",
      status: "completed",
      rawInput: {},
      rawOutput: {
        metadata: {
          parentSessionId: "session-opencode-reidentify",
          sessionId: "child-opencode-final",
        },
        result: "done",
      },
    });

    expect(started).toEqual([
      expect.objectContaining({
        type: "work_item.started",
        work_item_id: "opencode:native-task",
      }),
    ]);
    expect(completed.map((event) => event.type)).toEqual([
      "work_item.reidentified",
      "work_item.completed",
    ]);
    expect(completed.at(-1)).toMatchObject({
      work_item_id: "child-opencode-final",
      parent_id: "native-task",
    });
  });

  it("does not infer a Kimi native agent from an ordinary Agent tool name", () => {
    const adapter = new AgentEventAdapter({
      sessionId: "session-kimi",
      harnessId: "kimi-code",
      now: () => "2026-08-16T00:00:00.000Z",
    });
    expect(adapter.ingest("turn-kimi", {
      sessionUpdate: "tool_call_update",
      toolCallId: "kimi-agent-tool",
      title: "Agent",
      status: "completed",
      rawInput: { agent_id: "reviewer", prompt: "Review it" },
      rawOutput: "done",
    })).toEqual([]);
  });

  it("normalizes callback request, response, failure, and notification lifecycle", () => {
    const adapter = new AgentEventAdapter({
      sessionId: "session-callback",
      harnessId: "codex-acp",
      now: () => "2026-08-16T00:00:00.000Z",
    });
    expect(adapter.ingest("turn-callback", {
      type: "acp.client_request",
      requestId: "client-request-1",
      method: "terminal/create",
      params: { command: "pwd" },
    })[0]).toMatchObject({
      type: "callback.requested",
      data: {
        callback_id: "client-request-1",
        category: "terminal",
        method: "terminal/create",
        params: { command: "pwd" },
      },
    });
    expect(adapter.ingest("turn-callback", {
      type: "acp.client_response",
      requestId: "client-request-1",
      method: "terminal/create",
      result: { terminalId: "terminal-1" },
    })[0]).toMatchObject({
      type: "callback.completed",
      data: expect.objectContaining({ callback_id: "client-request-1" }),
    });
    expect(adapter.ingest("turn-callback", {
      type: "acp.client_error",
      requestId: "client-request-2",
      method: "fs/read_text_file",
      error: { message: "denied" },
    })[0]).toMatchObject({
      type: "callback.failed",
      data: expect.objectContaining({ category: "filesystem" }),
    });
    expect(adapter.ingest("turn-callback", {
      type: "acp.client_notification",
      method: "mcp/message",
      params: { method: "notifications/initialized" },
    })[0]).toMatchObject({
      type: "callback.notification",
      data: expect.objectContaining({ category: "mcp" }),
    });
  });

  it("gives repeated identical callback facts distinct ordered identities", () => {
    const adapter = new AgentEventAdapter({
      sessionId: "session-repeated-callback",
      harnessId: "codex-acp",
      now: () => "2026-08-16T00:00:00.000Z",
    });
    const callback = {
      type: "acp.client_notification",
      method: "mcp/message",
      params: { method: "notifications/progress", progress: 1 },
    };

    const first = adapter.ingest("turn-callback", callback)[0];
    const second = adapter.ingest("turn-callback", callback)[0];

    expect([first?.seq, second?.seq]).toEqual([1, 2]);
    expect(first?.event_id).not.toBe(second?.event_id);
  });

  it("marks an unbookended native child as missing-terminal when the parent turn ends", () => {
    const adapter = new AgentEventAdapter({
      sessionId: "session-missing-terminal",
      harnessId: "codex-acp",
      now: () => "2026-08-16T00:00:00.000Z",
    });
    adapter.ingest("turn-parent", {
      type: "collab_tool_call",
      tool: "spawn_agent",
      receiver_thread_ids: ["child-still-running"],
      prompt: "Keep monitoring",
    });

    expect(adapter.finishTurn("turn-parent", "end_turn")).toEqual([
      expect.objectContaining({
        type: "work_item.missing_terminal",
        work_item_id: "child-still-running",
        data: { reason: "parent_turn_ended_without_child_terminal" },
      }),
    ]);
  });
});
