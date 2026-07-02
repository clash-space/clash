// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MentionAutocomplete } from "./MentionAutocomplete";
import type { AgentRow } from "./panel-types";

const agents: AgentRow[] = [
  {
    id: "agent-1",
    template_id: "template-1",
    runtime_id: "runtime-1",
    display_name: "Design Agent",
    runtime_label: "Local",
    runtime_status: "online",
  },
  {
    id: "agent-2",
    template_id: "template-2",
    runtime_id: "runtime-2",
    display_name: "Research Agent",
    runtime_label: "Local",
    runtime_status: "offline",
  },
];

describe("MentionAutocomplete", () => {
  it("renders selectable agent options and preserves pick-on-mousedown behavior", () => {
    const onHover = vi.fn();
    const onPick = vi.fn();

    render(
      <MentionAutocomplete
        open
        matches={agents}
        activeIndex={1}
        onHover={onHover}
        onPick={onPick}
        listboxId="mention-list"
        optionId={(idx) => `mention-option-${idx}`}
      />,
    );

    expect(screen.getByRole("listbox", { name: "Agent matches" }).id).toBe("mention-list");
    const designOption = screen.getByRole("option", { name: /Design Agent/ });
    const researchOption = screen.getByRole("option", { name: /Research Agent/ });

    expect(designOption.id).toBe("mention-option-0");
    expect(researchOption.id).toBe("mention-option-1");
    expect(researchOption.className).toContain("bg-warm-hover");

    fireEvent.mouseEnter(designOption);
    fireEvent.mouseDown(designOption);

    expect(onHover).toHaveBeenCalledWith(0);
    expect(onPick).toHaveBeenCalledWith(agents[0]);
  });
});
