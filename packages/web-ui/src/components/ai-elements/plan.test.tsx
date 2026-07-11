// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanBar } from "./plan";
import type { PlanEntry } from "../../lib/acpEvents";

const entries: PlanEntry[] = [
  { content: "Write script", status: "in_progress" },
  { content: "Capture b-roll", status: "pending" },
];

describe("PlanBar", () => {
  it("expands the current plan checklist from the footer trigger", () => {
    render(<PlanBar entries={entries} />);

    expect(screen.queryByText("Capture b-roll")).toBeNull();

    const trigger = screen.getByRole("button", { name: "Toggle plan" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Capture b-roll")).toBeTruthy();
  });
});
