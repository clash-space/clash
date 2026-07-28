import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

async function readAgentContract(relativePath: string): Promise<string> {
  return readFile(new URL(`../../assets/${relativePath}`, import.meta.url), "utf8");
}

it("keeps the working-tree contract in one startup source and the role overlay concise", async () => {
  const [contract, role] = await Promise.all([
    readAgentContract("shared-cwd/AGENTS-prelude.md"),
    readAgentContract("agents/master-clash/AGENTS.md"),
  ]);

  expect(contract).toContain(".clash/project.toml");
  expect(contract).toMatch(/working tree/i);
  expect(contract).not.toContain("clash project status --json");
  expect(contract).not.toMatch(/status payload as (?:the|your) (?:local )?filesystem/i);
  expect(contract).not.toMatch(/pre-authenticated|CLASH_API_KEY|lock sidecar carries read proof/i);

  expect(role).toContain("Master Clash");
  expect(role).toMatch(/skill.*MCP/is);
  expect(role).toMatch(/must use.*MCP/is);
  expect(role).toMatch(/never.*shell.*Clash CLI/is);
  expect(role).toMatch(/native Skill discovery path/i);
  expect(role).not.toMatch(/plugin_(?:search|read)_skills?/i);
  expect(role).not.toContain(".clash/project.toml");
  expect(role).not.toContain("clash canvas list --json");
});

it("pins the local-first project invariants for repository coding agents", async () => {
  const repositoryContract = await readFile(
    new URL("../../../../AGENTS.md", import.meta.url),
    "utf8",
  );

  expect(repositoryContract).toMatch(/project\.toml.*project reference/is);
  expect(repositoryContract).toMatch(/agent.*owns.*working tree/is);
  expect(repositoryContract).toMatch(/same local replica/is);
  expect(repositoryContract).toMatch(/cloud.*replicator/is);
  expect(repositoryContract).toMatch(/apply.*CAS.*copy-on-write/is);
  expect(repositoryContract).toMatch(/status.*diagnostic/is);
  expect(repositoryContract).toMatch(/force.*not.*privilege/is);
  expect(repositoryContract).not.toMatch(/force\s*\/\s*admin|force-admin/is);
});
