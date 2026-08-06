import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import {
  ensureAgentCwd,
  resolveAgentMcpServers,
  resolveBundledAgentsDir,
} from "./session-cwd";

async function expectDirectory(path: string): Promise<void> {
  expect((await stat(path)).isDirectory()).toBe(true);
}

it("prefers an explicit packaged agent bundle root", async () => {
  const bundleRoot = await mkdtemp(join(tmpdir(), "clash-packaged-agents-"));
  expect(resolveBundledAgentsDir({
    CLASH_AGENT_BUNDLE_ROOT: bundleRoot,
  })).toBe(bundleRoot);
});

it("ensureAgentCwd writes a v1 project marker for managed project cwd", async () => {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "clash-session-cwd-"));
  process.env.HOME = home;
  try {
    const cwd = await ensureAgentCwd("master-clash", "proj_managed");
    const marker = await readFile(join(cwd, ".clash", "project.toml"), "utf-8");

    expect(marker).toContain("schema_version = 1");
    expect(marker).toContain('project_id = "proj_managed"');
    expect(marker).toMatch(/workspace_id = "managed:[a-f0-9]{16}"/);
    expect(marker).not.toContain('workspace_id = "managed:proj_managed"');
    expect(marker).toContain('store = "managed"');
    expect(marker).not.toContain("[sync]");
    expect(marker).not.toContain("mode =");
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
    expect(marker).toMatch(/workspace_id = "managed:[a-f0-9]{16}"/);
    expect(marker).not.toContain("managed:project%2Fwith%20spaces");
    expect(marker).not.toContain('project_id = "project_with_spaces"');
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

it("ensureAgentCwd keeps the managed workspace id stable for the same project cwd", async () => {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "clash-session-cwd-"));
  process.env.HOME = home;
  try {
    const cwd = await ensureAgentCwd("master-clash", "proj_stable_workspace");
    const firstMarker = await readFile(join(cwd, ".clash", "project.toml"), "utf-8");
    await ensureAgentCwd("master-clash", "proj_stable_workspace");
    const secondMarker = await readFile(join(cwd, ".clash", "project.toml"), "utf-8");

    const firstWorkspaceId = /workspace_id = "(managed:[a-f0-9]{16})"/.exec(firstMarker)?.[1];
    const secondWorkspaceId = /workspace_id = "(managed:[a-f0-9]{16})"/.exec(secondMarker)?.[1];
    expect(firstWorkspaceId).toBeDefined();
    expect(secondWorkspaceId).toBe(firstWorkspaceId);
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

it("ensureAgentCwd links the canonical Clash skill into a declared native cwd path", async () => {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), "clash-session-cwd-"));
  process.env.HOME = home;
  try {
    const cwd = await ensureAgentCwd("master-clash", "proj_setup_guidance", {
      harnessId: "codex-acp",
    });
    const agents = await readFile(join(cwd, "AGENTS.md"), "utf-8");
    const bundledSkillDir = join(
      resolveBundledAgentsDir(),
      "master-clash",
      "plugins",
      "clash",
      "skills",
      "clash",
    );
    const clashSkill = await readFile(join(bundledSkillDir, "SKILL.md"), "utf-8");

    expect(agents).toMatch(/bundled Clash MCP/i);
    expect(agents).toMatch(/must use.*MCP/is);
    expect(agents).toContain(".clash/project.toml");
    expect(agents).toContain("project working tree");
    expect(agents).toContain("clash_canvas_list");
    expect(agents).toContain("clash_canvas_get");
    expect(agents).toContain("clash_canvas_add");
    expect(agents).toContain("clash_canvas_execute");
    expect(agents).not.toContain("clash canvas list --json");
    expect(agents).toMatch(/never.*shell.*Clash CLI/is);
    expect(agents).toContain("projections/text/");
    expect(agents).toContain("clash_cli_text");
    expect(agents).toContain("timelines/");
    expect(agents).toContain("projections/timelines/");
    expect(agents).toContain("clash_cli_timeline");
    expect(agents).toContain("CAS observation internally");
    expect(agents).toContain("projection lock/revision sidecars");
    expect(agents).toContain("stale");
    expect(agents).not.toContain("lock/read-proof sidecars");
    expect(agents).toContain("assets/links");
    expect(agents).toContain("clash_cli_assets");
    expect(agents).toMatch(/Canvas copy-on-write tools/);
    expect(agents).toContain("product-internal replicator");
    expect(agents).toMatch(/same local\s+replica/);
    expect(agents).toContain("never creates a second project workspace");
    expect(agents).toContain("Never search for or edit `snapshot.bin`");
    expect(agents).not.toContain("clash project status --json");
    expect(agents).not.toContain("editablePaths");
    expect(agents).not.toContain("currentWorkspace");
    expect(agents).toContain("Master Clash");
    expect(agents.toLowerCase()).not.toContain(`cr${"ew"}`);
    expect(clashSkill).toContain("Use the bundled `clash_*` tools");
    const codexSkill = join(cwd, ".agents", "skills", "clash");
    expect((await lstat(codexSkill)).isSymbolicLink()).toBe(true);
    expect(await readlink(codexSkill)).toBe(bundledSkillDir);
    expect(await readFile(join(codexSkill, "SKILL.md"), "utf8")).toContain("# Clash");

    const nativePaths = [
      ["claude-acp", ".claude/skills"],
      ["gemini", ".agents/skills"],
      ["qwen-code", ".qwen/skills"],
      ["cursor", ".agents/skills"],
      ["kilo", ".kilocode/skills"],
      ["goose", ".goose/skills"],
    ] as const;
    for (const [harnessId, projectSkillDirectory] of nativePaths) {
      const harnessCwd = await ensureAgentCwd(
        "master-clash",
        `proj_setup_guidance_${harnessId}`,
        { harnessId },
      );
      const skill = join(harnessCwd, projectSkillDirectory, "clash");
      expect((await lstat(skill)).isSymbolicLink()).toBe(true);
      expect(await readlink(skill)).toBe(bundledSkillDir);
    }

    await expect(stat(join(home, ".codex", "skills", "clash"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(join(home, ".claude", "skills", "clash"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});

it("ensureAgentCwd does not guess a Skill directory or overwrite a user's workspace entry", async () => {
  const originalClashHome = process.env.CLASH_HOME;
  const clashHome = await mkdtemp(join(tmpdir(), "clash-session-cwd-skill-conflict-"));
  process.env.CLASH_HOME = clashHome;
  try {
    const withoutSkill = await ensureAgentCwd("master-clash", "proj_without_native_skill");
    await expect(stat(join(withoutSkill, ".agents", "skills", "clash"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const projectId = "proj_existing_native_skill";
    const existingSkill = join(
      clashHome,
      "projects",
      projectId,
      ".agents",
      "skills",
      "clash",
    );
    await mkdir(existingSkill, { recursive: true });
    await writeFile(join(existingSkill, "SKILL.md"), "user-owned\n", "utf8");

    await expect(ensureAgentCwd("master-clash", projectId, {
      harnessId: "codex-acp",
    })).rejects.toThrow(/existing workspace entry/i);
    await expect(readFile(join(existingSkill, "SKILL.md"), "utf8")).resolves.toBe("user-owned\n");
  } finally {
    if (originalClashHome === undefined) {
      delete process.env.CLASH_HOME;
    } else {
      process.env.CLASH_HOME = originalClashHome;
    }
  }
});

it("resolves the packaged Clash plugin as an ACP stdio MCP descriptor", async () => {
  const electron = "/Applications/Clash.app/Contents/MacOS/Clash";
  const [server] = await resolveAgentMcpServers("master-clash", {
    CLASH_NODE_EXEC_PATH: electron,
    CLASH_PROJECT_ID: "project-mcp",
    CLASH_HOME: "/Users/me/.clash",
    CLASH_WORKSPACE_ROOT: "/Users/me/.clash/projects/project-mcp",
    PATH: "/usr/local/bin:/usr/bin:/bin",
  });

  expect(server).toMatchObject({
    name: "clash",
    command: electron,
    args: [expect.stringMatching(/agents\/master-clash\/plugins\/clash\/runtime\/index\.js$/)],
    _meta: {
      "io.modelcontextprotocol/ui": {
        host: "clash",
        mimeTypes: ["text/html;profile=mcp-app"],
      },
      "clash.plugin": "builtin",
      "clash.renderer": "product",
    },
  });
  if (!("env" in server)) throw new Error("expected stdio MCP descriptor");
  expect(server.env).toEqual(expect.arrayContaining([
    { name: "CLASH_PROJECT_ID", value: "project-mcp" },
    { name: "CLASH_HOME", value: "/Users/me/.clash" },
    { name: "CLASH_WORKSPACE_ROOT", value: "/Users/me/.clash/projects/project-mcp" },
    { name: "ELECTRON_RUN_AS_NODE", value: "1" },
  ]));
  const entry = "args" in server ? server.args[0] : undefined;
  expect(entry).toBeDefined();
  expect((await stat(entry!)).isFile()).toBe(true);
});
