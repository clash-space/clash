// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createAgentUIStore, type AgentUIStore } from "@openma/common/agent-ui";
import {
  createOpenMAEvent,
  type OpenMAEvent,
} from "@openma/common/session-events/openma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./UserMessage", () => ({
  UserMessage: ({ content }: { content: string }) => (
    <div data-testid="clash-inline-prompt">{content}</div>
  ),
}));

import { RuntimeSessionTimeline } from "./RuntimeSessionTimeline";

function dispatch(
  store: AgentUIStore,
  eventId: string,
  type: string,
  data: unknown,
  turnId = "turn-1",
): void {
  store.dispatch(
    createOpenMAEvent({
      event_id: eventId,
      type,
      session_id: store.getState().sessionId,
      turn_id: turnId,
      source: { kind: "harness", harness: "codex-acp" },
      occurred_at: `2026-08-27T00:00:0${store.getState().seenEventIds[eventId] ? 2 : 1}.000Z`,
      data,
    }) as OpenMAEvent,
  );
}

function completedCodexTurn(): AgentUIStore {
  const store = createAgentUIStore("session-codex");
  dispatch(store, "user", "user.message", {
    message_id: "user-1",
    text: "hi",
  });
  dispatch(store, "running", "session.running", {});
  dispatch(store, "thought", "agent.thinking", {
    message_id: "thought-1",
    text: "Preparing simple hello response",
  });
  dispatch(store, "answer", "agent.message_chunk", {
    message_id: "answer-1",
    text: "Hi! What can I help you with?",
    phase: "final_answer",
  });
  dispatch(store, "complete", "turn.completed", {});
  return store;
}

describe("RuntimeSessionTimeline", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollTo = vi.fn();
  });

  it("keeps Codex thought state and reveals it through Backchat disclosures", () => {
    const store = completedCodexTurn();
    expect(store.getState().turns["turn-1"]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "thinking",
          text: "Preparing simple hello response",
        }),
      ]),
    );

    render(
      <RuntimeSessionTimeline
        store={store}
        agentId="codex-acp"
        mentionableNodes={[]}
        clashEntities={[]}
        slots={{
          beforeComposer: <div data-testid="before-composer" />,
          composer: <div data-testid="common-composer" />,
          afterComposer: <div data-testid="after-composer" />,
        }}
      />,
    );

    const surface = document.querySelector('[data-chat-surface="main"]');
    const composer = surface?.querySelector('[data-chat-column="composer"]');
    expect(surface).toBeTruthy();
    expect(surface?.querySelector('[data-chat-column="turns"]')).toBeTruthy();
    expect(composer).toBeTruthy();
    expect(composer?.children[0]).toHaveAttribute(
      "data-testid",
      "before-composer",
    );
    expect(composer?.children[1]).toHaveAttribute(
      "data-testid",
      "common-composer",
    );
    expect(composer?.children[2]).toHaveAttribute(
      "data-testid",
      "after-composer",
    );
    expect(screen.getByText("Hi! What can I help you with?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /已工作/ }));
    fireEvent.click(screen.getByRole("button", { name: /已思考 0 秒/ }));
    expect(screen.getByText("Preparing simple hello response")).toBeVisible();
    expect(document.querySelector('[data-thought-block="true"]')).toBeTruthy();
  });

  it("keeps Clash inline capabilities inside the avatar-free Backchat timeline", () => {
    const store = createAgentUIStore("session-clash");
    dispatch(store, "user", "user.message", {
      message_id: "user-1",
      text: "Inspect it",
    });
    dispatch(store, "running", "session.running", {});
    dispatch(store, "commentary", "agent.message_chunk", {
      message_id: "commentary-1",
      text: "I am checking the runtime.",
      phase: "commentary",
    });
    dispatch(store, "thought", "agent.thinking", {
      message_id: "thought-1",
      text: "Checking the runtime",
    });
    dispatch(store, "tool", "tool.started", {
      tool_call_id: "tool-clash",
      kind: "read",
      status: "in_progress",
      title: "Read runtime.ts",
    });
    dispatch(store, "answer", "agent.message_chunk", {
      message_id: "answer-1",
      text: "Done",
      phase: "final_answer",
    });
    dispatch(store, "complete", "turn.completed", {});

    render(
      <RuntimeSessionTimeline
        store={store}
        agentId="codex-acp"
        mentionableNodes={[]}
        clashEntities={[]}
      />,
    );

    expect(screen.getByTestId("runtime-session-timeline")).toHaveAttribute(
      "data-renderer",
      "backchat",
    );
    expect(
      document.querySelector('[data-backchat-session-timeline="true"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-slot="clash-agent-avatar"]'),
    ).toBeNull();
    expect(screen.getByTestId("clash-inline-prompt")).toHaveTextContent(
      "Inspect it",
    );
    fireEvent.click(screen.getByRole("button", { name: /已工作/ }));
    const activityGroup = document.querySelector(
      '[data-collapsible-event-count="2"]',
    );
    expect(activityGroup).toBeTruthy();
    fireEvent.click(activityGroup!.querySelector("button")!);
    expect(screen.getByTestId("acp-tool-row")).toHaveTextContent(
      "Read runtime.ts",
    );
    expect(
      document.querySelector('[data-assistant-section="process"]'),
    ).toHaveTextContent("I am checking the runtime.");
    expect(
      document.querySelector('[data-assistant-section="answer"]'),
    ).toHaveTextContent("Done");
    fireEvent.click(screen.getByRole("button", { name: /已思考 0 秒/ }));
    expect(screen.getByText("Checking the runtime")).toBeVisible();
    expect(
      document.querySelector('[data-testid="acp-message-list"]'),
    ).toBeNull();
  });

  it("folds consecutive completed tools into the Backchat activity sequence", () => {
    const store = createAgentUIStore("session-tools");
    dispatch(store, "user", "user.message", {
      message_id: "user-tools",
      text: "Inspect the canvas",
    });
    dispatch(store, "running", "session.running", {});
    for (const [index, title] of [
      "Read file",
      "Workspace Init",
      "Canvas",
      "Canvas 12 items",
    ].entries()) {
      const toolCallId = `tool-${index + 1}`;
      dispatch(store, `${toolCallId}:start`, "tool.started", {
        tool_call_id: toolCallId,
        kind: "read",
        status: "in_progress",
        title,
      });
      dispatch(store, `${toolCallId}:complete`, "tool.completed", {
        tool_call_id: toolCallId,
        kind: "read",
        status: "completed",
        title,
      });
    }
    dispatch(store, "answer", "agent.message_chunk", {
      message_id: "answer-tools",
      text: "Done",
      phase: "final_answer",
    });
    dispatch(store, "complete", "turn.completed", {});

    render(
      <RuntimeSessionTimeline
        store={store}
        agentId="codex-acp"
        mentionableNodes={[]}
        clashEntities={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /已工作/ }));
    const group = document.querySelector('[data-tool-group-size="4"]');
    expect(group).toBeTruthy();
    expect(screen.getAllByTestId("acp-tool-row")).toHaveLength(4);
    const groupBody = group?.querySelector<HTMLElement>(":scope > div");
    expect(groupBody).toHaveAttribute("hidden");
    expect(groupBody).toHaveAttribute("inert");

    const trigger = group?.querySelector("button");
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);
    expect(groupBody).not.toHaveAttribute("hidden");
    expect(groupBody).not.toHaveAttribute("inert");
    expect(screen.getAllByTestId("acp-tool-row")).toHaveLength(4);
  });

  it("keeps the completed tail tool visibly live until another event arrives", () => {
    const store = createAgentUIStore("session-live-tail-tool");
    dispatch(store, "user-live-tail", "user.message", {
      message_id: "user-live-tail",
      text: "Search the project",
    });
    dispatch(store, "running-live-tail", "session.running", {});
    for (const [index, title] of [
      "components",
      "renderer",
      "dialog",
    ].entries()) {
      const toolCallId = `search-${index + 1}`;
      dispatch(store, `${toolCallId}:start`, "tool.started", {
        tool_call_id: toolCallId,
        kind: "search",
        status: "in_progress",
        title,
      });
      dispatch(store, `${toolCallId}:complete`, "tool.completed", {
        tool_call_id: toolCallId,
        kind: "search",
        status: "completed",
        title,
      });
    }

    render(
      <RuntimeSessionTimeline
        store={store}
        agentId="codex-acp"
        mentionableNodes={[]}
        clashEntities={[]}
      />,
    );

    const group = document.querySelector('[data-tool-group-size="3"]');
    const trigger = group?.querySelector<HTMLElement>(":scope > button");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveTextContent("搜索中 dialog");
    expect(trigger?.querySelector(".animate-spin")).toBeTruthy();

    const rows = screen.getAllByTestId("acp-tool-row");
    expect(rows).toHaveLength(3);
    expect(rows.at(-1)).toHaveTextContent("已搜索");
    expect(rows.at(-1)).not.toHaveClass("animate-pulse");
  });
});
