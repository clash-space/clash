// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentAnnotationDraft } from "@clash/shared-types";

import { AgentAnnotationInspector } from "./AgentAnnotationBlock";

const annotation: AgentAnnotationDraft = {
  id: "annotation-1",
  kind: "agent-annotation",
  note: "Make this promise more concrete.",
  target: {
    projectId: "project-1",
    surface: "canvas",
    surfaceId: "main",
    surfaceLabel: "Main",
    objectId: "text-1",
    objectType: "canvas-text",
    objectLabel: "Launch script",
    objectPath: "canvases/main/nodes/text-1",
    capabilities: ["read", "modify"],
    selection: {
      kind: "text-quote",
      exact: "Ship the first cut tomorrow.",
    },
  },
};

describe("AgentAnnotationInspector", () => {
  afterEach(cleanup);

  it("exposes the active annotation actions from the target summary context menu", () => {
    const onLocate = vi.fn();
    const onRemove = vi.fn();

    render(
      <AgentAnnotationInspector
        annotations={[annotation]}
        activeId={annotation.id}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        onLocate={onLocate}
        onRemove={onRemove}
      />,
    );

    fireEvent.contextMenu(
      screen.getByTestId("agent-annotation-target-summary"),
    );

    expect(
      screen.getByRole("menuitem", { name: "Locate in workspace" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Remove annotation" }),
    ).toBeTruthy();
  });
});
