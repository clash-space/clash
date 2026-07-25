// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANNOTATION_LOCATE_HIGHLIGHT_MS,
  annotationLocateSelector,
  flashAnnotationLocateHighlight,
} from "./agentAnnotationLocate";

describe("annotationLocateSelector", () => {
  it("targets React Flow nodes and edges for canvas annotations", () => {
    expect(
      annotationLocateSelector({
        surface: "canvas",
        objectId: "node-1",
        objectType: "canvas-image",
      }),
    ).toBe('.react-flow__node[data-id="node-1"]');
    expect(
      annotationLocateSelector({
        surface: "canvas",
        objectId: "edge-1",
        objectType: "canvas-edge",
      }),
    ).toBe('.react-flow__edge[data-id="edge-1"]');
  });

  it("targets annotate-tagged elements on timeline and director surfaces", () => {
    expect(
      annotationLocateSelector({
        surface: "timeline",
        objectId: "track-sfx",
        objectType: "timeline-track",
      }),
    ).toBe('[data-agent-annotation-object-id="track-sfx"]');
    expect(
      annotationLocateSelector({
        surface: "director-stage",
        objectId: "key-light",
        objectType: "light",
      }),
    ).toBe('[data-agent-annotation-object-id="key-light"]');
  });
});

describe("flashAnnotationLocateHighlight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies a highlight ring and restores prior inline styles after 3s", () => {
    const element = document.createElement("div");
    element.style.outline = "1px dotted blue";

    flashAnnotationLocateHighlight(element);
    expect(element.style.outline).toContain("2px solid");
    expect(element.style.boxShadow).toContain("rgba(215, 78, 58");

    vi.advanceTimersByTime(ANNOTATION_LOCATE_HIGHLIGHT_MS - 1);
    expect(element.style.outline).toContain("2px solid");

    vi.advanceTimersByTime(1);
    expect(element.style.outline).toBe("1px dotted blue");
    expect(element.style.boxShadow).toBe("");
  });
});
