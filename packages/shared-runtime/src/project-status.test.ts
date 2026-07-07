import { describe, expect, it } from "vitest";
import { buildProjectStatus } from "./project-status";

describe("project status path builder", () => {
  it("builds agent-editable roots and protected local store paths", () => {
    const status = buildProjectStatus(
      { projectId: "project/one", source: "explicit" },
      { clashRoot: "/tmp/clash-home", localApiDataDir: "/tmp/clash-home/local-api" },
    );

    expect(status.projectWorkspaceRoot).toBe("/tmp/clash-home/projects/project%2Fone");
    expect(status.roots.projections).toBe("/tmp/clash-home/projects/project%2Fone/projections");
    expect(status.roots.assetLinks).toBe("/tmp/clash-home/projects/project%2Fone/assets/links");
    expect(status.roots.runtime).toBe("/tmp/clash-home/projects/project%2Fone/runtime");
    expect(status.runtimeRoot).toBe(status.roots.runtime);
    expect(status.localSqlitePath).toBe("/tmp/clash-home/local-api/local.sqlite");
    expect(status.loro.snapshotPath).toBe("/tmp/clash-home/local-api/projects/project%2Fone/loro/snapshot.bin");
    expect(status.editablePaths).toContain(status.roots.drafts);
    expect(status.protectedPaths).toContain(status.loro.snapshotPath);
    expect(status.protectedPaths).toContain(status.roots.runtime);
    expect(status.collaboration).toEqual({
      schemaVersion: 1,
      mode: "unknown",
      rawMode: "unknown",
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
    expect(status.storage).toEqual({
      schemaVersion: 1,
      context: {
        role: "project-reference",
        projectId: "project/one",
        source: "explicit",
      },
      workspace: {
        role: "agent-draft-and-projection-workspace",
        root: status.projectWorkspaceRoot,
        ownsCanonicalSnapshot: false,
        ownsCanonicalMetadata: false,
        editablePaths: status.editablePaths,
        protectedPaths: [status.roots.runtime],
      },
      canonicalReplica: {
        role: "single-machine-project-replica",
        scope: "machine",
        projectId: "project/one",
        metadata: {
          kind: "sqlite",
          path: status.localSqlitePath,
          agentWritable: false,
        },
        canvas: {
          kind: "loro",
          replicaRoot: status.loro.replicaRoot,
          snapshotPath: status.loro.snapshotPath,
          updatesLogPath: status.loro.updatesLogPath,
          agentWritable: false,
        },
      },
    });
  });

  it("uses collision-resistant workspace path segments", () => {
    const first = buildProjectStatus(
      { projectId: "project/one", source: "explicit" },
      { clashRoot: "/tmp/clash-home" },
    );
    const second = buildProjectStatus(
      { projectId: "project_one", source: "explicit" },
      { clashRoot: "/tmp/clash-home" },
    );

    expect(first.projectWorkspaceRoot).not.toBe(second.projectWorkspaceRoot);
  });

  it("normalizes project collaboration modes into explicit local/cloud gates", () => {
    const local = buildProjectStatus(
      { projectId: "project-local", source: "explicit" },
      { clashRoot: "/tmp/clash-home", marker: { sync: { mode: "local" } } },
    );
    const cloudSync = buildProjectStatus(
      { projectId: "project-synced", source: "explicit" },
      { clashRoot: "/tmp/clash-home", marker: { sync: { mode: "cloud-sync" } } },
    );
    const shared = buildProjectStatus(
      { projectId: "project-shared", source: "explicit" },
      { clashRoot: "/tmp/clash-home", marker: { sync: { mode: "shared" } } },
    );

    expect(local.collaboration).toMatchObject({
      mode: "local-only",
      rawMode: "local",
      webOpenable: false,
      multiUser: false,
      roomAuthority: "local",
      cloudProjectRoom: "disabled",
      syncReadiness: {
        status: "disabled",
        ready: false,
        missing: ["canvas", "room", "asset-metadata"],
      },
    });
    expect(cloudSync.collaboration).toMatchObject({
      mode: "synced",
      rawMode: "cloud-sync",
      webOpenable: false,
      multiUser: false,
      roomAuthority: "local",
      cloudProjectRoom: "disabled",
      syncReadiness: {
        status: "pending",
        ready: false,
        missing: ["canvas", "room", "asset-metadata"],
      },
    });
    expect(shared.collaboration).toMatchObject({
      mode: "shared",
      rawMode: "shared",
      webOpenable: true,
      multiUser: true,
      roomAuthority: "cloud-sequencer",
      cloudProjectRoom: "sequencer",
      syncReadiness: {
        status: "ready",
        ready: true,
        missing: [],
      },
    });
  });

  it("keeps cloud-sync pending until canvas, room, and asset metadata sync are all ready", () => {
    const pending = buildProjectStatus(
      { projectId: "project-synced", source: "explicit" },
      { clashRoot: "/tmp/clash-home", marker: { sync: { mode: "cloud-sync" } } },
    );
    const ready = buildProjectStatus(
      { projectId: "project-synced", source: "explicit" },
      {
        clashRoot: "/tmp/clash-home",
        marker: {
          sync: {
            mode: "cloud-sync",
            capabilities: {
              canvas: true,
              room: true,
              assetMetadata: true,
            },
          },
        },
      },
    );

    expect(pending.collaboration).toMatchObject({
      mode: "synced",
      webOpenable: false,
      roomAuthority: "local",
      syncReadiness: {
        status: "pending",
        ready: false,
        missing: ["canvas", "room", "asset-metadata"],
      },
    });
    expect(ready.collaboration).toMatchObject({
      mode: "synced",
      webOpenable: true,
      roomAuthority: "local-with-cloud-mirror",
      syncReadiness: {
        status: "ready",
        ready: true,
        missing: [],
      },
    });
  });
});
