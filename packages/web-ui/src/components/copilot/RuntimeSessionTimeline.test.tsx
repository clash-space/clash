// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import {
  initialSessionTranscript,
  reduceSessionTranscript,
} from "@openma/common/session";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@radix-ui/react-collapsible", () => ({
  Root: ({
    children,
    open: _open,
    onOpenChange: _onOpenChange,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => <div {...props}>{children}</div>,
  Trigger: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Content: ({
    children,
    forceMount: _forceMount,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { forceMount?: boolean }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock("./UserMessage", () => ({
  UserMessage: ({ content }: { content: string }) => (
    <div data-testid="clash-inline-prompt">{content}</div>
  ),
}));

import { RuntimeSessionTimeline } from "./RuntimeSessionTimeline";

describe("RuntimeSessionTimeline", () => {
  afterEach(() => cleanup());

  it("is only a Clash-avatar adapter around the canonical Backchat timeline", () => {
    let transcript = initialSessionTranscript("session-clash");
    transcript = reduceSessionTranscript(transcript, {
      type: "turn.register",
      turnId: "turn-clash",
      promptText: "Inspect it",
    });
    transcript = reduceSessionTranscript(transcript, {
      type: "turn.event",
      turnId: "turn-clash",
      event: {
        sessionUpdate: "agent_message_chunk",
        _meta: { codex: { phase: "commentary" } },
        content: { type: "text", text: "I am checking the runtime." },
      },
    });
    transcript = reduceSessionTranscript(transcript, {
      type: "turn.event",
      turnId: "turn-clash",
      event: {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought-clash",
        content: { type: "text", text: "Checking the runtime" },
      },
    });
    transcript = reduceSessionTranscript(transcript, {
      type: "turn.event",
      turnId: "turn-clash",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-clash",
        kind: "read",
        status: "in_progress",
        title: "Read runtime.ts",
      },
    });
    transcript = reduceSessionTranscript(transcript, {
      type: "turn.event",
      turnId: "turn-clash",
      event: {
        sessionUpdate: "agent_message_chunk",
        _meta: { codex: { phase: "final_answer" } },
        content: { type: "text", text: "Done" },
      },
    });

    render(
      <RuntimeSessionTimeline
        transcript={transcript}
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
    ).toBeTruthy();
    expect(screen.getByTestId("clash-inline-prompt")).toHaveTextContent(
      "Inspect it",
    );
    expect(screen.getByTestId("acp-tool-row")).toHaveTextContent(
      "Read runtime.ts",
    );
    expect(
      document.querySelector('[data-assistant-section="process"]'),
    ).toHaveTextContent("I am checking the runtime.");
    expect(
      document.querySelector('[data-assistant-section="answer"]'),
    ).toHaveTextContent("Done");
    expect(screen.getAllByText("Checking the runtime").length).toBeGreaterThan(
      0,
    );
    expect(
      document.querySelector('[data-testid="acp-message-list"]'),
    ).toBeNull();
  });
});
