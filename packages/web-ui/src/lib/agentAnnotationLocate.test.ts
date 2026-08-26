// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as annotationLocate from "./agentAnnotationLocate";

const {
  ANNOTATION_LOCATE_HIGHLIGHT_MS,
  annotationLocateSelector,
  flashAnnotationLocateHighlight,
} = annotationLocate;

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

describe("centerAndHighlightAnnotationTarget", () => {
  it("centers the target before highlighting it on the next frame", async () => {
    const centerAndHighlight = (
      annotationLocate as typeof annotationLocate & {
        centerAndHighlightAnnotationTarget?: (
          element: HTMLElement,
          center?: () => void | Promise<unknown>,
        ) => void;
      }
    ).centerAndHighlightAnnotationTarget;
    expect(centerAndHighlight).toBeTypeOf("function");
    if (!centerAndHighlight) return;

    vi.useFakeTimers();
    const marker = document.createElement("div");
    marker.dataset.browserAnnotationMarker = "annotation-browser-1";
    marker.scrollIntoView = vi.fn();
    const nextFrames: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        nextFrames.push(callback);
        return 1;
      });

    centerAndHighlight(marker);

    expect(marker.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
      inline: "center",
    });
    expect(marker.style.backgroundColor).toBe("");

    await Promise.resolve();
    expect(nextFrames).toHaveLength(1);
    nextFrames[0]?.(0);
    expect(marker.style.backgroundColor).toContain("rgba(215, 78, 58");

    requestAnimationFrame.mockRestore();
    vi.useRealTimers();
  });
});

describe("flashAnnotationLocateHighlight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses one outline for targets without an existing annotation frame", () => {
    const element = document.createElement("div");
    element.style.outline = "1px dotted blue";

    flashAnnotationLocateHighlight(element);
    expect(element.style.outline).toContain("2px solid");
    expect(element.style.boxShadow).toBe("");

    vi.advanceTimersByTime(ANNOTATION_LOCATE_HIGHLIGHT_MS - 1);
    expect(element.style.outline).toContain("2px solid");

    vi.advanceTimersByTime(1);
    expect(element.style.outline).toBe("1px dotted blue");
    expect(element.style.boxShadow).toBe("");
  });

  it("strengthens a browser annotation's existing frame without drawing another ring", () => {
    const marker = document.createElement("div");
    marker.dataset.browserAnnotationMarker = "annotation-browser-1";

    flashAnnotationLocateHighlight(marker);

    expect(marker.style.backgroundColor).toContain("rgba(215, 78, 58");
    expect(marker.style.outline).toBe("");
    expect(marker.style.boxShadow).toBe("");

    vi.advanceTimersByTime(ANNOTATION_LOCATE_HIGHLIGHT_MS);
    expect(marker.style.backgroundColor).toBe("");
  });
});
