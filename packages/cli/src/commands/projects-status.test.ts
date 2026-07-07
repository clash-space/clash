import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProjectStatus,
  initProject,
  resolveProjectStatus,
} from "./projects";
import type { ResolvedProjectContext } from "../lib/project-context";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "clash-project-status-"));
}

test("project status exposes agent-readable project roots and protected local files", () => {
  const homeDir = "/tmp/clash-home";
  const projectId = "project/with spaces";
  const context: ResolvedProjectContext = {
    projectId,
    source: "marker",
    markerPath: "/tmp/workspace/.clash/project.toml",
  };

  const status = buildProjectStatus(context, {
    homeDir,
    marker: {
      schemaVersion: 1,
      projectId,
      store: "managed",
      sync: { mode: "local" },
    },
  });

  const projectStore = join(homeDir, ".clash", "projects", "project%2Fwith%20spaces");
  const localApiDataDir = join(homeDir, ".clash", "local-api");
  const loroRoot = join(
    localApiDataDir,
    "projects",
    encodeURIComponent(projectId),
    "loro",
  );

  assert.equal(status.projectId, projectId);
  assert.equal(status.source, "marker");
  assert.equal(status.mode, "local");
  assert.equal(status.syncMode, "local");
  assert.deepEqual(status.collaboration, {
    schemaVersion: 1,
    mode: "local-only",
    rawMode: "local",
    webOpenable: false,
    multiUser: false,
    roomAuthority: "local",
    cloudProjectRoom: "disabled",
    syncReadiness: {
      status: "disabled",
      ready: false,
      required: ["canvas", "room", "asset-metadata"],
      missing: ["canvas", "room", "asset-metadata"],
    },
    localAgentRuntime: {
      requiredForLocalActions: true,
      availability: "owner-machine-online",
    },
  });
  assert.equal(status.clashHome, join(homeDir, ".clash"));
  assert.equal(status.projectStore, projectStore);
  assert.equal(status.projectWorkspaceRoot, projectStore);
  assert.equal(status.localApiDataDir, localApiDataDir);
  assert.equal(status.localSqlitePath, join(localApiDataDir, "local.sqlite"));
  assert.equal(status.legacyDbJsonPath, join(localApiDataDir, "db.json"));
  assert.equal(status.loro.replicaRoot, loroRoot);
  assert.equal(status.loro.snapshotPath, join(loroRoot, "snapshot.bin"));
  assert.equal(status.loro.updatesLogPath, join(loroRoot, "updates.log"));
  assert.equal(status.roots.drafts, join(projectStore, "drafts"));
  assert.equal(status.roots.projections, join(projectStore, "projections"));
  assert.equal(status.roots.sessions, join(projectStore, "sessions"));
  assert.equal(status.roots.assetLinks, join(projectStore, "assets", "links"));
  assert.equal(status.roots.runtime, join(projectStore, "runtime"));
  assert.equal(status.draftsRoot, status.roots.drafts);
  assert.equal(status.projectionsRoot, status.roots.projections);
  assert.equal(status.assetLinksRoot, status.roots.assetLinks);
  assert.equal(status.runtimeRoot, status.roots.runtime);

  assert.deepEqual(status.editablePaths, [
    join(projectStore, "drafts"),
    join(projectStore, "projections"),
    join(projectStore, "sessions"),
    join(projectStore, "assets", "links"),
  ]);
  assert.deepEqual(status.protectedPaths, [
    localApiDataDir,
    join(localApiDataDir, "local.sqlite"),
    join(localApiDataDir, "db.json"),
    loroRoot,
    join(loroRoot, "snapshot.bin"),
    join(loroRoot, "updates.log"),
    status.roots.runtime,
  ]);
  assert.deepEqual(status.storage, {
    schemaVersion: 1,
    context: {
      role: "project-reference",
      projectId,
      source: "marker",
      markerPath: "/tmp/workspace/.clash/project.toml",
    },
    workspace: {
      role: "agent-draft-and-projection-workspace",
      root: projectStore,
      ownsCanonicalSnapshot: false,
      ownsCanonicalMetadata: false,
      editablePaths: status.editablePaths,
      protectedPaths: [status.roots.runtime],
    },
    canonicalReplica: {
      role: "single-machine-project-replica",
      scope: "machine",
      projectId,
      metadata: {
        kind: "sqlite",
        path: join(localApiDataDir, "local.sqlite"),
        agentWritable: false,
      },
      canvas: {
        kind: "loro",
        replicaRoot: loroRoot,
        snapshotPath: join(loroRoot, "snapshot.bin"),
        updatesLogPath: join(loroRoot, "updates.log"),
        agentWritable: false,
      },
    },
  });
});

test("project status uses collision-resistant project workspace paths", () => {
  const first = buildProjectStatus({ projectId: "project/one", source: "explicit" }, { homeDir: "/tmp/clash-home" });
  const second = buildProjectStatus({ projectId: "project_one", source: "explicit" }, { homeDir: "/tmp/clash-home" });

  assert.notEqual(first.projectWorkspaceRoot, second.projectWorkspaceRoot);
  assert.match(first.projectWorkspaceRoot, /project%2Fone|project%252Fone/);
});

test("project status reads marker sync mode when marker selects the project", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();

  const initialized = await initProject({ cwd, projectId: "local_status_project" });
  const status = await resolveProjectStatus({ cwd, env: {}, homeDir });

  assert.equal(status.projectId, "local_status_project");
  assert.equal(status.source, "marker");
  assert.equal(status.markerPath, initialized.markerPath);
  assert.equal(status.mode, "local");
  assert.equal(status.collaboration.mode, "local-only");
  assert.equal(status.collaboration.webOpenable, false);
  assert.equal(
    status.projectStore,
    join(homeDir, ".clash", "projects", "local_status_project"),
  );
});

test("project status exposes explicit collaboration gates for synced and shared modes", () => {
  const synced = buildProjectStatus(
    { projectId: "synced_project", source: "marker" },
    {
      homeDir: "/tmp/clash-home",
      marker: {
        schemaVersion: 1,
        projectId: "synced_project",
        sync: { mode: "cloud-sync" },
      },
    },
  );
  const shared = buildProjectStatus(
    { projectId: "shared_project", source: "marker" },
    {
      homeDir: "/tmp/clash-home",
      marker: {
        schemaVersion: 1,
        projectId: "shared_project",
        sync: { mode: "shared" },
      },
    },
  );

  assert.deepEqual(synced.collaboration, {
    schemaVersion: 1,
    mode: "synced",
    rawMode: "cloud-sync",
    webOpenable: false,
    multiUser: false,
    roomAuthority: "local",
    cloudProjectRoom: "disabled",
    syncReadiness: {
      status: "pending",
      ready: false,
      required: ["canvas", "room", "asset-metadata"],
      missing: ["canvas", "room", "asset-metadata"],
    },
    localAgentRuntime: {
      requiredForLocalActions: true,
      availability: "owner-machine-online",
    },
  });
  assert.deepEqual(shared.collaboration, {
    schemaVersion: 1,
    mode: "shared",
    rawMode: "shared",
    webOpenable: true,
    multiUser: true,
    roomAuthority: "cloud-sequencer",
    cloudProjectRoom: "sequencer",
    syncReadiness: {
      status: "ready",
      ready: true,
      required: ["canvas", "room", "asset-metadata"],
      missing: [],
    },
    localAgentRuntime: {
      requiredForLocalActions: true,
      availability: "owner-machine-online",
    },
  });
});

test("explicit project status does not inherit an unrelated marker mode", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();
  const initialized = await initProject({ cwd, projectId: "marker_project" });

  const status = await resolveProjectStatus({
    cwd,
    project: "explicit_project",
    env: {},
    homeDir,
  });

  assert.equal(status.projectId, "explicit_project");
  assert.equal(status.source, "explicit");
  assert.equal(status.markerPath, initialized.markerPath);
  assert.equal(status.mode, "unknown");
  assert.equal(
    status.projectStore,
    join(homeDir, ".clash", "projects", "explicit_project"),
  );
});

test("environment project status has unknown mode without a marker", async () => {
  const homeDir = await tempDir();
  const cwd = await tempDir();

  const status = await resolveProjectStatus({
    cwd,
    env: { CLASH_PROJECT_ID: "env_project" },
    homeDir,
  });

  assert.equal(status.projectId, "env_project");
  assert.equal(status.source, "env");
  assert.equal(status.markerPath, undefined);
  assert.equal(status.mode, "unknown");
  assert.equal(
    status.projectStore,
    join(homeDir, ".clash", "projects", "env_project"),
  );
});

test("project status honors CLASH_HOME for managed roots", async () => {
  const clashRoot = await tempDir();
  const cwd = await tempDir();

  const status = await resolveProjectStatus({
    cwd,
    env: { CLASH_PROJECT_ID: "env_project", CLASH_HOME: clashRoot },
  });

  assert.equal(status.projectStore, join(clashRoot, "projects", "env_project"));
  assert.equal(status.clashHome, clashRoot);
  assert.equal(status.localApiDataDir, join(clashRoot, "local-api"));
  assert.equal(status.localSqlitePath, join(clashRoot, "local-api", "local.sqlite"));
});
