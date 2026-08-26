import { describe, expect, it } from "vitest";
import {
  clampCopilotPanelWidthForViewport,
  COPILOT_PANEL_MIN_WIDTH,
  expandCopilotPanelWidth,
} from "./copilotPanelLayout";

describe("copilot panel resize bounds", () => {
  it("keeps the existing generic fractional maximum", () => {
    expect(clampCopilotPanelWidthForViewport(900, 1440)).toBe(617);
    expect(clampCopilotPanelWidthForViewport(1000, 1988)).toBe(852);
  });

  it("never makes the composer narrower than its existing minimum", () => {
    expect(clampCopilotPanelWidthForViewport(100, 1440)).toBe(
      COPILOT_PANEL_MIN_WIDTH,
    );
  });

  it("adds a session rail when space allows and keeps the expanded panel inside the viewport", () => {
    expect(expandCopilotPanelWidth(500, 288, 1440)).toBe(788);
    expect(expandCopilotPanelWidth(600, 288, 800)).toBe(784);
  });
});
