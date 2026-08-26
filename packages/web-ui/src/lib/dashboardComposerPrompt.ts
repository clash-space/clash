export interface DashboardSkillPromptReference {
  id: string;
  name: string;
}

export function buildDashboardComposerPrompt(
  input: string,
  skills: readonly DashboardSkillPromptReference[],
): string {
  const prompt = input.trim();
  const seen = new Set<string>();
  const invocations = skills.flatMap((skill) => {
    if (seen.has(skill.id)) return [];
    seen.add(skill.id);
    return [`$${skill.name}`];
  });

  return invocations.length > 0
    ? `${invocations.join(" ")}\n\n${prompt}`
    : prompt;
}
