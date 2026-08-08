import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { initializeClashWorkspace } from "./workspace-init";

describe("initializeClashWorkspace", () => {
  it("creates the canonical managed project marker used by CLI and MCP", async () => {
    const workspace = join(
      tmpdir(),
      `clash-shared-workspace-init-${process.pid}-${Date.now()}`,
    );
    await mkdir(workspace);

    const result = await initializeClashWorkspace({
      cwd: workspace,
      projectId: "native-stdio-project",
    });

    expect(result).toMatchObject({
      projectId: "native-stdio-project",
      markerPath: join(workspace, ".clash", "project.toml"),
      reused: false,
    });
    expect(result.workspaceId).toMatch(/^managed:[a-f0-9]{16}$/);
    expect(await readFile(result.markerPath, "utf8")).toBe([
      "schema_version = 1",
      'project_id = "native-stdio-project"',
      `workspace_id = ${JSON.stringify(result.workspaceId)}`,
      'store = "managed"',
      "",
    ].join("\n"));
  });

  it("reuses an existing compatible marker instead of rebinding the workspace", async () => {
    const workspace = join(
      tmpdir(),
      `clash-shared-workspace-reuse-${process.pid}-${Date.now()}`,
    );
    await mkdir(workspace);
    const created = await initializeClashWorkspace({ cwd: workspace, projectId: "stable-project" });
    const before = await readFile(created.markerPath, "utf8");

    const reused = await initializeClashWorkspace({ cwd: workspace, projectId: "stable-project" });

    expect(reused).toEqual({ ...created, reused: true });
    expect(await readFile(created.markerPath, "utf8")).toBe(before);
  });

  it("fails closed when initialization would rebind an existing workspace", async () => {
    const workspace = join(
      tmpdir(),
      `clash-shared-workspace-conflict-${process.pid}-${Date.now()}`,
    );
    await mkdir(workspace);
    const created = await initializeClashWorkspace({ cwd: workspace, projectId: "project-a" });
    const before = await readFile(created.markerPath, "utf8");

    await expect(initializeClashWorkspace({ cwd: workspace, projectId: "project-b" }))
      .rejects.toThrow(/already bound.*project-a.*project-b/i);
    expect(await readFile(created.markerPath, "utf8")).toBe(before);
  });
});
