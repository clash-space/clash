import { describe, expect, it } from "vitest";
import {
  averageRectCenters,
  collapseVelocityFromPointer,
  isExpandedMinimapSize,
  isImplicitCanvasRoot,
  resizeMinimapFromTopRight,
  shouldCollapseMinimap,
} from "./canvasViewport";

describe("canvas viewport primitives", () => {
  it("treats Main as the implicit root without hiding other canvas folders", () => {
    expect(isImplicitCanvasRoot("Main")).toBe(true);
    expect(isImplicitCanvasRoot(" main ")).toBe(true);
    expect(isImplicitCanvasRoot("Shots")).toBe(false);
  });

  it("centers on the average of every visible node center", () => {
    expect(
      averageRectCenters([
        { x: 0, y: 10, width: 100, height: 40 },
        { x: 300, y: 190, width: 200, height: 120 },
      ]),
    ).toEqual({ x: 225, y: 140 });
    expect(averageRectCenters([])).toBeNull();
  });

  it("stops resizing at the readable threshold before collapsing", () => {
    expect(
      resizeMinimapFromTopRight(
        { width: 160, height: 112 },
        { deltaX: 80, deltaY: -40 },
      ),
    ).toEqual({ width: 240, height: 152 });
    const minimum = resizeMinimapFromTopRight(
      { width: 160, height: 112 },
      { deltaX: -1_000, deltaY: 1_000 },
    );
    expect(minimum).toEqual({ width: 128, height: 88 });
    expect(shouldCollapseMinimap(minimum)).toBe(true);
    expect(shouldCollapseMinimap({ width: 160, height: 88 })).toBe(false);
    expect(isExpandedMinimapSize({ width: 128, height: 88 })).toBe(true);
    expect(isExpandedMinimapSize({ width: 127, height: 88 })).toBe(false);
  });

  it("carries diagonal shrink momentum into the collapse animation", () => {
    expect(
      collapseVelocityFromPointer(
        { x: 200, y: 100, time: 10 },
        { x: 180, y: 110, time: 30 },
      ),
    ).toBe(750);
    expect(
      collapseVelocityFromPointer(
        { x: 180, y: 110, time: 30 },
        { x: 190, y: 100, time: 50 },
      ),
    ).toBe(0);
  });
});
