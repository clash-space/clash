import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { ensureAgentCwd } from "./session-cwd";

async function expectDirectory(path: string): Promise<void> {
  expect((await stat(path)).isDirectory()).toBe(true);
}

it("ensureAgentCwd writes a v1 project marker for managed project cwd", async () => {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "clash-session-cwd-"));
  process.env.HOME = home;
  try {
    const cwd = await ensureAgentCwd("master-clash", "proj_managed");
    const marker = await readFile(join(cwd, ".clash", "project.toml"), "utf-8");

    expect(marker).toContain("schema_version = 1");
    expect(marker).toContain('project_id = "proj_managed"');
    expect(marker).toContain('workspace_id = "managed:proj_managed"');
    expect(marker).toContain('store = "managed"');
    expect(marker).toContain("[sync]");
    expect(marker).toContain('mode = "local"');
    await expectDirectory(join(cwd, "drafts"));
    await expectDirectory(join(cwd, "projections", "text"));
    await expectDirectory(join(cwd, "projections", "timelines"));
    await expectDirectory(join(cwd, "timelines"));
    await expectDirectory(join(cwd, "assets", "links"));
    await expectDirectory(join(cwd, "sessions"));
    await expectDirectory(join(cwd, "runtime"));
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

it("ensureAgentCwd keeps the canonical project id in the marker when the cwd path is sanitized", async () => {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "clash-session-cwd-"));
  process.env.HOME = home;
  try {
    const projectId = "project/with spaces";
    const cwd = await ensureAgentCwd("master-clash", projectId);
    const marker = await readFile(join(cwd, ".clash", "project.toml"), "utf-8");

    expect(cwd).toBe(join(home, ".clash", "projects", "project%2Fwith%20spaces"));
    expect(marker).toContain(`project_id = ${JSON.stringify(projectId)}`);
    expect(marker).toContain('workspace_id = "managed:project%2Fwith%20spaces"');
    expect(marker).not.toContain('project_id = "project_with_spaces"');
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

it("ensureAgentCwd uses collision-resistant cwd paths for distinct project ids", async () => {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "clash-session-cwd-"));
  process.env.HOME = home;
  try {
    const slashCwd = await ensureAgentCwd("master-clash", "project/one");
    const underscoreCwd = await ensureAgentCwd("master-clash", "project_one");

    expect(slashCwd).not.toBe(underscoreCwd);
    expect(slashCwd).toContain("project%2Fone");
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

it("ensureAgentCwd honors CLASH_HOME for managed project cwd", async () => {
  const originalClashHome = process.env.CLASH_HOME;
  const clashHome = await mkdtemp(join(tmpdir(), "clash-session-cwd-home-"));
  process.env.CLASH_HOME = clashHome;
  try {
    const cwd = await ensureAgentCwd("master-clash", "proj_home_override");

    expect(cwd).toBe(join(clashHome, "projects", "proj_home_override"));
    await expectDirectory(join(cwd, "projections", "text"));
    await expectDirectory(join(cwd, ".clash"));
  } finally {
    if (originalClashHome === undefined) {
      delete process.env.CLASH_HOME;
    } else {
      process.env.CLASH_HOME = originalClashHome;
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
    expect(agents).toContain("editablePaths");
    expect(agents).toContain("viewFiles");
    expect(agents).toContain("projections/text/");
    expect(agents).toContain("clash text apply");
    expect(agents).toContain("timelines/");
    expect(agents).toContain("projections/timelines/");
    expect(agents).toContain("mediaAssets");
    expect(agents).toContain("assets/links");
    expect(agents).toContain("protectedPaths");
    expect(agents).toContain("currentWorkspace");
    expect(agents).toContain("deletionDeletesProjectState");
    expect(agents).toContain("runtimeRoot");
    expect(agents).toContain("Do not read or edit `snapshot.bin`");
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
