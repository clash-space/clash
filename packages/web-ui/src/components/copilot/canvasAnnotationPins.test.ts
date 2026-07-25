import { describe, expect, it } from "vitest";

import { projectCanvasAnnotationPin } from "./canvasAnnotationPins";

describe("projectCanvasAnnotationPin", () => {
  it("projects a canvas node screen edge into the React Flow viewport coordinate space", () => {
    expect(
      projectCanvasAnnotationPin({
        targetRect: { left: 240, top: 180, right: 440, bottom: 260 },
        flowRect: { left: 40, top: 80, width: 900, height: 600 },
        viewport: { x: 120, y: 60, zoom: 2 },
      }),
    ).toMatchObject({
      x: 140,
      y: 20,
      screenX: 400,
      screenY: 100,
    });
  });
});
