export type ClashToolGuidance = {
  useWhen: string;
  effect: string;
  returns: string;
  next: string;
};

function sentence(label: keyof ClashToolGuidance, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Clash tool guidance ${label} must not be empty`);
  return `${trimmed.replace(/[.!?]+$/u, "")}.`;
}

/**
 * Render the model-facing operational contract shared by every Clash MCP tool.
 * Creative judgment belongs in Skills; this text only explains selection,
 * product effect, returned state, and the next safe action.
 */
export function describeClashTool(guidance: ClashToolGuidance): string {
  return [
    `Use when: ${sentence("useWhen", guidance.useWhen)}`,
    `Effect: ${sentence("effect", guidance.effect)}`,
    `Returns: ${sentence("returns", guidance.returns)}`,
    `Next: ${sentence("next", guidance.next)}`,
  ].join(" ");
}
