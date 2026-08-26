export const COPILOT_PANEL_MIN_WIDTH = 420;
export const COPILOT_PANEL_MAX_WIDTH_FRACTION = 3 / 7;

export function clampCopilotPanelWidthForViewport(
  width: number,
  viewportWidth: number,
): number {
  const fractionalMaximum = Math.max(
    COPILOT_PANEL_MIN_WIDTH,
    Math.round(viewportWidth * COPILOT_PANEL_MAX_WIDTH_FRACTION),
  );
  return Math.max(COPILOT_PANEL_MIN_WIDTH, Math.min(fractionalMaximum, width));
}

export function expandCopilotPanelWidth(
  baseWidth: number,
  railWidth: number,
  viewportWidth: number,
): number {
  return Math.min(baseWidth + railWidth, Math.max(0, viewportWidth - 16));
}
