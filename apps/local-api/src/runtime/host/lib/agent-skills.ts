/**
 * Harness ids used by Clash do not always match the agent ids published by
 * the `skills` CLI. Keep this adapter separate from the ACP install registry:
 * ACP defines how an agent is launched, while `skills` defines where that
 * agent discovers project-scoped Skills.
 *
 * Source contract: skills@1.5.20 supported-agents project paths.
 * https://github.com/vercel-labs/skills#supported-agents
 */
const HARNESS_PROJECT_SKILL_DIRECTORIES = {
  "codex-acp": ".agents/skills",
  "claude-acp": ".claude/skills",
  gemini: ".agents/skills",
  opencode: ".agents/skills",
  cursor: ".agents/skills",
  "qwen-code": ".qwen/skills",
  "github-copilot-cli": ".agents/skills",
  kilo: ".kilocode/skills",
  "grok-build": ".grok/skills",
  "amp-acp": ".agents/skills",
  goose: ".goose/skills",
  cline: ".agents/skills",
  auggie: ".augment/skills",
} as const satisfies Readonly<Record<string, string>>;

export function resolveHarnessProjectSkillDirectory(
  harnessId: string,
): string | undefined {
  return HARNESS_PROJECT_SKILL_DIRECTORIES[
    harnessId as keyof typeof HARNESS_PROJECT_SKILL_DIRECTORIES
  ];
}
