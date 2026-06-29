// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionStartPicker } from "./SessionStartPicker";

describe("SessionStartPicker", () => {
  it("lets the user pick the local ACP agent without exposing role templates", () => {
    const onStart = vi.fn();
    const props = {
      agentTemplates: [{ id: "master-clash", label: "Master Clash" }],
      sessions: [],
      agents: [
        { id: "claude-acp", binary: "claude-agent-acp" },
        { id: "codex-acp", binary: "codex-acp" },
      ],
      onStart,
    };

    render(<SessionStartPicker {...props} />);

    expect(screen.queryByText("Master Clash")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /codex-acp/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));

    expect(onStart).toHaveBeenCalledWith(null, undefined, "codex-acp");
  });

  it("blocks auth-needed agents and offers a probe refresh action", () => {
    const onStart = vi.fn();
    const onRecheckAuth = vi.fn();

    render(
      <SessionStartPicker
        agentTemplates={[{ id: "master-clash", label: "Master Clash" }]}
        sessions={[]}
        agents={[{
          id: "devin",
          label: "Devin",
          binary: "clash-acp-devin",
          auth: {
            status: "needs-auth",
            message: "Devin is not signed in for ACP.",
            command: "clash-acp-devin auth login",
          },
        }]}
        onStart={onStart}
        onRecheckAuth={onRecheckAuth}
        startLabel="Start helper"
      />,
    );

    expect(screen.getByText("Sign in to Devin")).toBeTruthy();
    expect(screen.getByText("Devin is not signed in for ACP.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start helper" }).getAttribute("disabled")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(onRecheckAuth).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });
});
