import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("InteractiveCanvas minimap contract", () => {
  it("replaces floating zoom buttons with a real canvas minimap", () => {
    const source = readFileSync(
      new URL("./InteractiveCanvas.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('aria-label="Canvas minimap"');
    expect(source).toContain("calculateMinimapViewport");
    expect(source).toContain("shouldShowCanvasMinimap(zoom) && (");
    expect(source).not.toContain('className="zoom-controls"');
    expect(source).not.toContain("handleZoomIn");
    expect(source).not.toContain("handleZoomOut");
  });
});
