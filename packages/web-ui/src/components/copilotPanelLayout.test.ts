import { describe, expect, it } from "vitest";
import {
  clampCopilotPanelWidthForViewport,
  COPILOT_PANEL_MIN_WIDTH,
} from "./copilotPanelLayout";

describe("copilot panel resize bounds", () => {
  it("keeps the existing generic fractional maximum", () => {
    expect(
      clampCopilotPanelWidthForViewport(900, 1440),
    ).toBe(617);
    expect(
      clampCopilotPanelWidthForViewport(1000, 1988),
    ).toBe(852);
  });

  it("never makes the composer narrower than its existing minimum", () => {
    expect(
      clampCopilotPanelWidthForViewport(100, 1440),
    ).toBe(COPILOT_PANEL_MIN_WIDTH);
  });
});
