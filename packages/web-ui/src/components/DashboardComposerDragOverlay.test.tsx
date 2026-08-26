// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardComposerDragOverlay } from "./DashboardComposerDragOverlay";

describe("DashboardComposerDragOverlay", () => {
  afterEach(cleanup);

  it("shows a compact Project reference ghost instead of cloning the card", () => {
    render(
      <DashboardComposerDragOverlay
        data={{
          type: "dashboard-project-reference",
          reference: { id: "project-a", name: "Project A" },
        }}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Dragging Project A to composer" }),
    ).toHaveTextContent("Project A");
  });

  it("shows a compact Skill reference ghost", () => {
    render(
      <DashboardComposerDragOverlay
        data={{
          type: "dashboard-skill-reference",
          reference: { id: "skill-a", name: "sd25-pe" },
          requestAdd: vi.fn(),
        }}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Dragging sd25-pe to composer" }),
    ).toHaveTextContent("sd25-pe");
  });

  it("renders nothing for unrelated drags", () => {
    const { container } = render(
      <DashboardComposerDragOverlay data={{ type: "timeline-item" }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
