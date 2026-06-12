// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionStartPicker } from "./SessionStartPicker";

describe("SessionStartPicker", () => {
  it("lets the user pick the local ACP agent without exposing crew roles", () => {
    const onStart = vi.fn();
    const props = {
      crew: [{ id: "director", label: "Director" }],
      sessions: [],
      agents: [
        { id: "claude-agent-acp", binary: "claude-agent-acp" },
        { id: "codex-cli", binary: "codex" },
      ],
      onStart,
    };

    render(<SessionStartPicker {...props} />);

    expect(screen.queryByText("Crew")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /codex-cli/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));

    expect(onStart).toHaveBeenCalledWith("director", undefined, "codex-cli");
  });
});
