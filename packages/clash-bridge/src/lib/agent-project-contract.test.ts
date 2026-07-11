import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

async function readAgentContract(relativePath: string): Promise<string> {
  return readFile(new URL(`../../assets/${relativePath}`, import.meta.url), "utf8");
}

it("teaches agents to use the project working tree without a status preflight", async () => {
  const contracts = await Promise.all([
    readAgentContract("shared-cwd/AGENTS-prelude.md"),
    readAgentContract("agents/master-clash/AGENTS.md"),
  ]);

  for (const contract of contracts) {
    expect(contract).toContain(".clash/project.toml");
    expect(contract).toMatch(/working tree/i);
    expect(contract).not.toContain("clash project status --json");
    expect(contract).not.toMatch(/status payload as (?:the|your) (?:local )?filesystem/i);
    expect(contract).not.toMatch(/pre-authenticated|CLASH_API_KEY|lock sidecar carries read proof/i);
  }
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
