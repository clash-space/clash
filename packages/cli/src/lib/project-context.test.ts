import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { initProject, linkProject } from "../commands/projects";
import {
  readProjectMarker,
  resolveProjectContext,
  writeProjectMarker,
} from "./project-context";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "clash-project-context-"));
}

it("resolver finds the nearest marker from a child directory", async () => {
  const root = await tempDir();
  const projectRoot = join(root, "workspace");
  const child = join(projectRoot, "src", "nested");
  await mkdir(child, { recursive: true });
  await writeProjectMarker(projectRoot, { schemaVersion: 1, projectId: "proj_nearest" });

  const context = await resolveProjectContext({ cwd: child, env: {} });

  expect(context.projectId).toBe("proj_nearest");
  expect(context.source).toBe("marker");
  expect(context.markerPath).toBe(join(projectRoot, ".clash", "project.toml"));
});

it("explicit project overrides marker and environment", async () => {
  const root = await tempDir();
  await writeProjectMarker(root, { schemaVersion: 1, projectId: "proj_marker" });

  const context = await resolveProjectContext({
    cwd: root,
    env: { CLASH_PROJECT_ID: "proj_env" },
    project: "proj_explicit",
  });

  expect(context.projectId).toBe("proj_explicit");
  expect(context.source).toBe("explicit");
  expect(context.markerPath).toBe(join(root, ".clash", "project.toml"));
});

it("marker and environment conflict without explicit project", async () => {
  const root = await tempDir();
  await writeProjectMarker(root, { schemaVersion: 1, projectId: "proj_marker" });

  await expect(
    resolveProjectContext({ cwd: root, env: { CLASH_PROJECT_ID: "proj_env" } }),
  ).rejects.toThrow(/conflict/i);
});

it("resolver falls back to CLASH_PROJECT_ID when no marker exists", async () => {
  const root = await tempDir();

  const context = await resolveProjectContext({
    cwd: root,
    env: { CLASH_PROJECT_ID: "proj_env" },
  });

  expect(context).toEqual({
    projectId: "proj_env",
    source: "env",
  });
});

it("resolver gives guidance when no project context exists", async () => {
  const root = await tempDir();

  await expect(resolveProjectContext({ cwd: root, env: {} })).rejects.toThrow(
    /clash init|clash project link|--project|CLASH_PROJECT_ID/i,
  );
});

it("project link writes a v1 marker in the current directory", async () => {
  const root = await tempDir();

  const markerPath = await linkProject("proj_linked", { cwd: root });
  const marker = await readFile(markerPath, "utf-8");

  expect(markerPath).toBe(join(root, ".clash", "project.toml"));
  expect(marker).toContain("schema_version = 1");
  expect(marker).toContain('project_id = "proj_linked"');
  expect(marker).toMatch(/workspace_id = "external:[a-f0-9]{16}"/);
  expect(marker).toContain('store = "external"');
  expect(marker).toContain("[sync]");
  expect(marker).toContain('mode = "local"');
  const parsed = await readProjectMarker(markerPath);
  expect(parsed.workspaceId).toMatch(/^external:[a-f0-9]{16}$/);
});

it("init writes a local managed v1 marker without cloud dependency", async () => {
  const root = await tempDir();

  const result = await initProject({ cwd: root });
  const marker = await readFile(result.markerPath, "utf-8");

  expect(result.projectId).toMatch(/^local_/);
  expect(result.markerPath).toBe(join(root, ".clash", "project.toml"));
  expect(result.workspaceId).toMatch(/^managed:[a-f0-9]{16}$/);
  expect(marker).toContain("schema_version = 1");
  expect(marker).toContain(`project_id = "${result.projectId}"`);
  expect(marker).toContain(`workspace_id = "${result.workspaceId}"`);
  expect(marker).toContain('store = "managed"');
  expect(marker).toContain("[sync]");
  expect(marker).toContain('mode = "local"');
});

it("project marker writer preserves nested sync capabilities as TOML tables", async () => {
  const root = await tempDir();
  const markerPath = await writeProjectMarker(root, {
    schemaVersion: 1,
    projectId: "proj_cloud_ready",
    store: "managed",
      sync: {
        mode: "cloud-sync",
        capabilities: {
          canvas: true,
          asset_metadata: true,
        },
      },
  });

  const marker = await readFile(markerPath, "utf-8");
  const parsed = await readProjectMarker(markerPath);

  expect(marker).toContain("[sync]");
  expect(marker).toContain('mode = "cloud-sync"');
  expect(marker).toContain("[sync.capabilities]");
  expect(parsed.sync).toEqual({
    mode: "cloud-sync",
    capabilities: {
      canvas: true,
      asset_metadata: true,
    },
  });
});
