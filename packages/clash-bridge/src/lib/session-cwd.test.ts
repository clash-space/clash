import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { ensureAgentCwd } from "./session-cwd";

it("ensureAgentCwd writes a v1 project marker for managed project cwd", async () => {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "clash-session-cwd-"));
  process.env.HOME = home;
  try {
    const cwd = await ensureAgentCwd("master-clash", "proj_managed");
    const marker = await readFile(join(cwd, ".clash", "project.toml"), "utf-8");

    expect(marker).toContain("schema_version = 1");
    expect(marker).toContain('project_id = "proj_managed"');
    expect(marker).toContain('store = "managed"');
    expect(marker).toContain("[sync]");
    expect(marker).toContain('mode = "local"');
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

it("ensureAgentCwd rejects unknown agent templates instead of starting bare", async () => {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "clash-session-cwd-"));
  process.env.HOME = home;
  try {
    await expect(ensureAgentCwd("missing-agent", "proj_missing")).rejects.toThrow(/unknown agent template/i);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

it("ensureAgentCwd installs standard Clash setup/init guidance", async () => {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "clash-session-cwd-"));
  process.env.HOME = home;
  try {
    const cwd = await ensureAgentCwd("master-clash", "proj_setup_guidance");
    const agents = await readFile(join(cwd, "AGENTS.md"), "utf-8");

    expect(agents).toContain("clash init");
    expect(agents).toContain("clash project status --json");
    expect(agents).toContain("clash canvas list --json");
    expect(agents).toContain("Do not add `--project`");
    expect(agents).toContain("Master Clash");
    expect(agents.toLowerCase()).not.toContain(`cr${"ew"}`);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});
