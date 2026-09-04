// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentAnnotationDomPinLayer } from "./AnnotationDomPinLayer";

afterEach(() => {
  cleanup();
  document
    .querySelectorAll("[data-agent-annotation-object-id]")
    .forEach((node) => node.remove());
  vi.restoreAllMocks();
});

describe("AgentAnnotationDomPinLayer", () => {
  it("routes DOM surface pins to the source-anchored annotation editor", () => {
    const target = document.createElement("div");
    target.dataset.agentAnnotationObjectId = "clip-1";
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 120,
      top: 80,
      right: 320,
      bottom: 140,
      width: 200,
      height: 60,
      x: 120,
      y: 80,
      toJSON: () => ({}),
    });
    document.body.append(target);
    let nextFrame: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      nextFrame = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const onSelect = vi.fn();

    const { container } = render(
      <AgentAnnotationDomPinLayer
        annotations={[
          {
            id: "annotation-1",
            kind: "agent-annotation",
            note: "Move this earlier.",
            target: {
              projectId: "project-1",
              surface: "timeline",
              surfaceId: "timeline-1",
              surfaceLabel: "Timeline",
              objectId: "clip-1",
              objectType: "timeline-clip",
              objectLabel: "Opening clip",
              objectPath: "timelines/timeline-1/tracks/video/items/clip-1",
              capabilities: ["read", "modify"],
            },
          },
        ]}
        surface="timeline"
        surfaceId="timeline-1"
        activeId={null}
        onSelect={onSelect}
        onRemove={vi.fn()}
      />,
    );
    const layer = container.querySelector(
      "[data-agent-annotation-dom-pin-layer]",
    );
    expect(layer).toBeTruthy();
    vi.spyOn(layer as HTMLElement, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    act(() => {
      nextFrame?.(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Annotation 1" }));

    expect(onSelect).toHaveBeenCalledWith("annotation-1");
  });
});
