import { execFile } from "node:child_process";
import { promisify } from "node:util";

interface NpxSkillsInstall {
  kind: "npx-skills";
  source: string;
  skill: string;
  scope: "global";
}

export interface NpxSkillsMarketplaceItem extends Record<string, unknown> {
  id: string;
  name: string;
  type: "skill";
  source: "provider-official";
  install: NpxSkillsInstall;
}

interface InstalledNpxSkill {
  name?: unknown;
  path?: unknown;
  scope?: unknown;
  source?: unknown;
  sourceUrl?: unknown;
}

type CommandRunner = (
  executable: string,
  args: string[],
) => Promise<{ stdout: string }>;

const execFileAsync = promisify(execFile);

async function defaultCommandRunner(
  executable: string,
  args: string[],
): Promise<{ stdout: string }> {
  const result = await execFileAsync(executable, args, {
    encoding: "utf8",
    timeout: 30 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: result.stdout };
}

function asLazyMarketplaceSkill(value: unknown): NpxSkillsMarketplaceItem | null {
  if (!value || typeof value !== "object") return null;
  const skill = value as Record<string, unknown>;
  const install = skill.install;
  if (!install || typeof install !== "object") return null;
  const descriptor = install as Record<string, unknown>;
  if (
    typeof skill.id !== "string" ||
    typeof skill.name !== "string" ||
    skill.source !== "provider-official" ||
    descriptor.kind !== "npx-skills" ||
    typeof descriptor.source !== "string" ||
    !descriptor.source.startsWith("https://") ||
    typeof descriptor.skill !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(descriptor.skill) ||
    descriptor.scope !== "global"
  ) {
    return null;
  }
  return {
    ...skill,
    id: skill.id,
    name: skill.name,
    type: "skill",
    source: "provider-official",
    install: {
      kind: "npx-skills",
      source: descriptor.source,
      skill: descriptor.skill,
      scope: "global",
    },
  };
}

function parseInstalledSkills(stdout: string): InstalledNpxSkill[] {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("npx skills list returned a non-array JSON payload.");
  }
  return parsed.filter(
    (entry): entry is InstalledNpxSkill => !!entry && typeof entry === "object",
  );
}

export function createNpxSkillsMarketplace({
  registry,
  run = defaultCommandRunner,
}: {
  registry: { skills?: unknown };
  run?: CommandRunner;
}) {
  const rawSkills = Array.isArray(registry.skills) ? registry.skills : [];
  const skills = rawSkills
    .map(asLazyMarketplaceSkill)
    .filter((skill): skill is NpxSkillsMarketplaceItem => skill !== null);
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";

  function requireSkill(id: string): NpxSkillsMarketplaceItem {
    const skill = byId.get(id);
    if (!skill) throw new Error(`Unknown marketplace skill: ${id}`);
    return skill;
  }

  return {
    skills,
    async listInstalled(): Promise<Array<Record<string, unknown>>> {
      const { stdout } = await run(executable, [
        "--yes",
        "skills@latest",
        "list",
        "--global",
        "--json",
      ]);
      const installedByName = new Map(
        parseInstalledSkills(stdout)
          .filter((entry) => typeof entry.name === "string")
          .map((entry) => [entry.name as string, entry]),
      );
      return skills.flatMap((skill) => {
        const installed = installedByName.get(skill.install.skill);
        if (!installed) return [];
        return [{
          skillId: skill.id,
          name: skill.name,
          description: skill.description ?? null,
          version: skill.sourceVersion ?? null,
          path: typeof installed.path === "string" ? installed.path : null,
          scope: "global",
          source: typeof installed.source === "string" ? installed.source : null,
          sourceUrl: typeof installed.sourceUrl === "string" ? installed.sourceUrl : skill.install.source,
        }];
      });
    },
    async install(id: string): Promise<Record<string, unknown>> {
      const skill = requireSkill(id);
      await run(executable, [
        "--yes",
        "skills@latest",
        "add",
        skill.install.source,
        "--skill",
        skill.install.skill,
        "--global",
        "--yes",
      ]);
      return {
        skillId: skill.id,
        name: skill.name,
        installed: true,
        scope: "global",
      };
    },
    async uninstall(id: string): Promise<void> {
      const skill = requireSkill(id);
      await run(executable, [
        "--yes",
        "skills@latest",
        "remove",
        skill.install.skill,
        "--global",
        "--yes",
      ]);
    },
  };
}
