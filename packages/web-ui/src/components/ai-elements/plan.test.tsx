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

    fireEvent.click(screen.getByRole("button", { name: "Show plan" }));

    expect(screen.getByRole("button", { name: "Hide plan" })).toBeTruthy();
    expect(screen.getByText("Capture b-roll")).toBeTruthy();
  });
});
