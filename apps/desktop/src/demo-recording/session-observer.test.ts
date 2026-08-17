import { describe, expect, it, vi } from "vitest";
import { DemoEventJournal, type DemoEvent } from "./events.js";
import {
  SessionEventProjector,
  persistedTurnIsReady,
  waitForPersistedTurn,
} from "./session-observer.js";

describe("demo session event observer", () => {
  it("ignores cached terminal frames until the requested turn is armed", () => {
    const events: Array<{ type: string; turnId?: string }> = [];
    const projector = new SessionEventProjector(
      new DemoEventJournal({ onRecord: (event) => events.push(event) }),
    );

    expect(
      projector.consume({
        type: "session.error",
        session_id: "session-1",
        turn_id: "old-turn",
        message: "old failure",
      }),
    ).toEqual({ kind: "ignored" });

    projector.arm("turn-2");
    expect(
      projector.consume({
        type: "session.complete",
        session_id: "session-1",
        turn_id: "old-turn",
      }),
    ).toEqual({ kind: "ignored" });
    expect(
      projector.consume({
        type: "session.complete",
        session_id: "session-1",
        turn_id: "turn-2",
      }),
    ).toEqual({ kind: "completed", turnId: "turn-2" });

    expect(events.map((event) => event.type)).toEqual([
      "agent.turn.started",
      "agent.turn.completed",
    ]);
  });

  it("merges tool lifecycle frames by toolCallId without retaining raw input or output", () => {
    const events: DemoEvent[] = [];
    const projector = new SessionEventProjector(
      new DemoEventJournal({ onRecord: (event) => events.push(event) }),
    );
    projector.arm("turn-1");

    projector.consume({
      type: "session.event",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "runtime-call-abc",
        title: "Fallback title",
        status: "in_progress",
        rawInput: { apiKey: "secret", cwd: "/Users/me/project" },
        _meta: {
          mcp_tool_name: "clash_canvas_list",
          "clash.host_trusted_mcp": true,
          "clash.renderer": "product",
        },
      },
    });
    projector.consume({
      type: "session.event",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "runtime-call-abc",
        status: "completed",
        rawOutput: { path: "/Users/me/project/result.json" },
      },
    });

    expect(events).toEqual([
      expect.objectContaining({ type: "agent.turn.started", turnId: "turn-1" }),
      expect.objectContaining({
        type: "agent.tool.started",
        toolCallId: "tool-1",
        label: "Canvas · list",
      }),
      expect.objectContaining({
        type: "agent.tool.completed",
        toolCallId: "tool-1",
        label: "Canvas · list",
      }),
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /secret|Users|rawInput|rawOutput|runtime-call-abc|Fallback title/u,
    );
  });

  it("classifies trusted dispatcher failures without retaining arguments or error text", () => {
    const events: DemoEvent[] = [];
    const projector = new SessionEventProjector(
      new DemoEventJournal({ onRecord: (event) => events.push(event) }),
    );
    projector.arm("turn-1");

    projector.consume({
      type: "session.event",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "runtime-composition-call",
        status: "in_progress",
        rawInput: {
          kind: "timeline",
          operation: "create",
          arguments: { name: "fixture-argument-secret" },
        },
        _meta: {
          mcp_tool_name: "clash_composition",
          "clash.host_trusted_mcp": true,
          "clash.renderer": "product",
        },
      },
    });
    projector.consume({
      type: "session.event",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "runtime-composition-call",
        status: "failed",
        content: [{
          type: "content",
          content: {
            type: "text",
            text: "Invalid arguments for Clash operation: fixture-error-secret",
          },
        }],
        rawOutput: { privateBody: "fixture-output-secret" },
      },
    });

    expect(events).toEqual([
      expect.objectContaining({ type: "agent.turn.started" }),
      expect.objectContaining({
        type: "agent.tool.started",
        label: "Timeline · create",
        dispatcherMode: "execute",
        requestedOperation: "create",
      }),
      expect.objectContaining({
        type: "agent.tool.failed",
        label: "Timeline · create",
        dispatcherMode: "execute",
        requestedOperation: "create",
        errorKind: "invalid_arguments",
      }),
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /fixture-(?:argument|error|output)-secret|rawInput|rawOutput/u,
    );
  });

  it("projects generic MCP wrapper dispatcher calls with the same safe identity as Pi-direct calls", () => {
    const events: DemoEvent[] = [];
    const projector = new SessionEventProjector(
      new DemoEventJournal({ onRecord: (event) => events.push(event) }),
    );
    projector.arm("turn-1");

    projector.consume({
      type: "session.event",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-runtime-tool-call-secret",
        status: "in_progress",
        rawInput: {
          server: "clash",
          tool: "clash_composition",
          arguments: {
            kind: "timeline",
            operation: "create",
            arguments: { prompt: "fixture-private-prompt" },
          },
        },
        _meta: {
          mcp_tool_name: "clash_composition",
          "clash.host_trusted_mcp": true,
          "clash.renderer": "product",
        },
      },
    });
    projector.consume({
      type: "session.event",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call_update",
        toolCallId: "fixture-runtime-tool-call-secret",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "private result" } }],
      },
    });

    expect(events.slice(1)).toEqual([
      expect.objectContaining({
        type: "agent.tool.started",
        label: "Timeline · create",
        dispatcherMode: "execute",
        requestedOperation: "create",
      }),
      expect.objectContaining({
        type: "agent.tool.completed",
        label: "Timeline · create",
        dispatcherMode: "execute",
        requestedOperation: "create",
      }),
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /fixture-(?:runtime-tool-call|private-prompt)|private result|rawInput|arguments|content/u,
    );
  });

  it("flags an untrusted shell tool without retaining its command or arguments", () => {
    const events: DemoEvent[] = [];
    const projector = new SessionEventProjector(
      new DemoEventJournal({ onRecord: (event) => events.push(event) }),
    );
    projector.arm("turn-1");

    const result = projector.consume({
      type: "session.event",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "runtime-shell-call",
        title: "Ran cat /Users/me/project/.clash/project.toml",
        status: "in_progress",
        rawInput: { command: "cat /Users/me/project/.clash/project.toml" },
        _meta: { toolName: "bash" },
      },
    });

    expect(result).toEqual({
      kind: "untrusted-tool",
      turnId: "turn-1",
      toolKind: "shell",
    });
    expect(events).toEqual([
      expect.objectContaining({ type: "agent.turn.started" }),
      expect.objectContaining({
        type: "agent.tool.started",
        label: "Agent tool",
      }),
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /cat|Users|project\.toml|runtime-shell-call|rawInput/u,
    );
  });

  it("waits for the target turn to reach durable transcript storage", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [
              {
                sender_kind: "agent",
                turn_id: "turn-1",
                events: [
                  {
                    sessionUpdate: "agent_message_chunk",
                    content: { type: "text", text: "done" },
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const result = await waitForPersistedTurn({
      apiBaseUrl: "http://127.0.0.1:49153",
      sessionId: "session-1",
      turnId: "turn-1",
      fetchFn,
      pollIntervalMs: 0,
      stabilityMs: 0,
      timeoutMs: 1_000,
    });

    expect(result.messages).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("supports a case-specific durable completion predicate", async () => {
    const response = (text: string) =>
      new Response(
        JSON.stringify({
          messages: [
            {
              sender_kind: "agent",
              turn_id: "turn-1",
              events: [{ type: "text", text }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("still working"))
      .mockResolvedValueOnce(response("DEMO_READY"));

    await waitForPersistedTurn({
      apiBaseUrl: "http://127.0.0.1:49153",
      sessionId: "session-1",
      turnId: "turn-1",
      fetchFn,
      pollIntervalMs: 0,
      stabilityMs: 0,
      timeoutMs: 1_000,
      readyWhen: (body) => JSON.stringify(body).includes("DEMO_READY"),
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("times out when the durable transcript request never settles", async () => {
    const neverFetch = async (): Promise<Response> =>
      await new Promise<Response>(() => {});
    const guardedWait = Promise.race([
      waitForPersistedTurn({
        apiBaseUrl: "http://127.0.0.1:49153",
        sessionId: "session-1",
        turnId: "turn-1",
        fetchFn: neverFetch as typeof fetch,
        pollIntervalMs: 0,
        stabilityMs: 0,
        timeoutMs: 10,
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("test watchdog fired")), 250);
      }),
    ]);

    await expect(guardedWait).rejects.toThrow(/timed out waiting/iu);
  });

  it("recognizes a terminal tool update or answer as a durable-read candidate", () => {
    expect(
      persistedTurnIsReady(
        {
          messages: [
            {
              sender_kind: "agent",
              turn_id: "turn-1",
              events: [{ sessionUpdate: "tool_call", toolCallId: "tool-1" }],
            },
          ],
        },
        "turn-1",
      ),
    ).toBe(false);
    expect(
      persistedTurnIsReady(
        {
          messages: [
            {
              sender_kind: "agent",
              turn_id: "turn-1",
              events: [
                {
                  sessionUpdate: "tool_call_update",
                  toolCallId: "tool-1",
                  status: "completed",
                },
              ],
            },
          ],
        },
        "turn-1",
      ),
    ).toBe(true);
  });

});
