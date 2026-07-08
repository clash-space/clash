import { describe, expect, it } from "vitest";
import { buildProjectStatus } from "./project-status";

const expectedTracePolicy = {
  schemaVersion: 1,
  roomMessages: {
    kind: "project-chat",
    syncDefault: "sync-when-project-sync-enabled",
    rawAgentTrace: false,
  },
  agentSessionMetadata: {
    kind: "public-session-metadata",
    syncDefault: "sync-when-project-sync-enabled",
    rawAgentTrace: false,
  },
  rawAgentTraces: {
    kind: "private-runtime-trace",
    syncDefault: "local-only",
    optInRequiredForSync: true,
    excludedFromRoom: true,
    sensitiveFields: ["tool-logs", "local-file-paths", "scratch-context"],
  },
} as const;

describe("project status path builder", () => {
  it("builds agent-editable roots and protected local store paths", () => {
    const status = buildProjectStatus(
      { projectId: "project/one", source: "explicit" },
      { clashRoot: "/tmp/clash-home", localApiDataDir: "/tmp/clash-home/local-api" },
    );

    expect(status.projectWorkspaceRoot).toBe("/tmp/clash-home/projects/project%2Fone");
    expect(status.currentWorkspace).toEqual({
      schemaVersion: 1,
      role: "project-reference-workspace",
      projectWorkspaceRoot: status.projectWorkspaceRoot,
      locatedInProjectWorkspace: null,
      markerStore: "unknown",
      ownsCanonicalSnapshot: false,
      ownsCanonicalMetadata: false,
      deletionDeletesProjectState: false,
    });
    expect(status.roots.projections).toBe("/tmp/clash-home/projects/project%2Fone/projections");
    expect(status.roots.timelines).toBe("/tmp/clash-home/projects/project%2Fone/timelines");
    expect(status.roots.assetLinks).toBe("/tmp/clash-home/projects/project%2Fone/assets/links");
    expect(status.roots.runtime).toBe("/tmp/clash-home/projects/project%2Fone/runtime");
    expect(status.runtimeRoot).toBe(status.roots.runtime);
    expect(status.localSqlitePath).toBe("/tmp/clash-home/local-api/local.sqlite");
    expect(status.loro.snapshotPath).toBe("/tmp/clash-home/local-api/projects/project%2Fone/loro/snapshot.bin");
    expect(status.storage.canonicalReplica.mediaAssets.path).toBe("/tmp/clash-home/assets/blobs");
    expect(status.storage.canonicalReplica.contentBlobs.textRevisions.path).toBe("/tmp/clash-home/local-api/text-revision-blobs");
    expect(status.storage.canonicalReplica.contentBlobs.timelineRevisions.path).toBe("/tmp/clash-home/local-api/timeline-revision-blobs");
    expect(status.editablePaths).toContain(status.roots.drafts);
    expect(status.editablePaths).toContain(status.roots.timelines);
    expect(status.protectedPaths).toContain(status.loro.snapshotPath);
    expect(status.protectedPaths).toContain(status.storage.canonicalReplica.mediaAssets.path);
    expect(status.protectedPaths).toContain(status.storage.canonicalReplica.contentBlobs.textRevisions.path);
    expect(status.protectedPaths).toContain(status.storage.canonicalReplica.contentBlobs.timelineRevisions.path);
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
      actions: {
        openInWeb: {
          allowed: false,
          reason: "sync-mode-unknown",
          requirements: ["sync-mode"],
        },
        enableSync: {
          allowed: true,
          reason: null,
          requirements: [],
        },
        shareProject: {
          allowed: false,
          reason: "sync-mode-unknown",
          requirements: ["sync-mode"],
        },
        runLocalAgent: {
          allowed: true,
          reason: null,
          requirements: ["owner-machine-online"],
        },
      },
      localAgentRuntime: {
        requiredForLocalActions: true,
        availability: "owner-machine-online",
      },
      tracePolicy: expectedTracePolicy,
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
        viewFiles: {
          texts: {
            kind: "agent-editable-projection-files",
            path: "/tmp/clash-home/projects/project%2Fone/projections/text",
            defaultFilePattern: "<node-id>.md",
            applyCommand: "clash text apply",
            casRequired: true,
            ownsCanonicalState: false,
          },
          timelines: {
            kind: "agent-editable-view-files",
            path: "/tmp/clash-home/projects/project%2Fone/timelines",
            defaultFile: "main.timeline.yaml",
            applyCommand: "clash timeline apply",
            casRequired: true,
            ownsCanonicalState: false,
          },
          timelineProjections: {
            kind: "agent-editable-projection-files",
            path: "/tmp/clash-home/projects/project%2Fone/projections/timelines",
            applyCommand: "clash timeline apply",
            casRequired: true,
            ownsCanonicalState: false,
          },
        },
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
        mediaAssets: {
          kind: "content-addressed-files",
          path: "/tmp/clash-home/assets/blobs",
          storageKeyPrefix: "local-blobs/",
          immutable: true,
          deduplicatedBy: "sha256",
          agentWritable: false,
          referencedBy: "sqlite-asset-rows-and-project-asset-links",
        },
        contentBlobs: {
          textRevisions: {
            kind: "content-addressed-files",
            path: "/tmp/clash-home/local-api/text-revision-blobs",
            mediaType: "text/markdown",
            immutable: true,
            agentWritable: false,
          },
          timelineRevisions: {
            kind: "content-addressed-files",
            path: "/tmp/clash-home/local-api/timeline-revision-blobs",
            mediaType: "application/yaml",
            immutable: true,
            agentWritable: false,
          },
        },
      },
    });
    expect(status.storage.workspace.viewFiles).toEqual({
      texts: {
        kind: "agent-editable-projection-files",
        path: "/tmp/clash-home/projects/project%2Fone/projections/text",
        defaultFilePattern: "<node-id>.md",
        applyCommand: "clash text apply",
        casRequired: true,
        ownsCanonicalState: false,
      },
      timelines: {
        kind: "agent-editable-view-files",
        path: status.roots.timelines,
        defaultFile: "main.timeline.yaml",
        applyCommand: "clash timeline apply",
        casRequired: true,
        ownsCanonicalState: false,
      },
      timelineProjections: {
        kind: "agent-editable-projection-files",
        path: "/tmp/clash-home/projects/project%2Fone/projections/timelines",
        applyCommand: "clash timeline apply",
        casRequired: true,
        ownsCanonicalState: false,
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

  it("describes marker workspaces separately from canonical project roots", () => {
    const status = buildProjectStatus(
      {
        projectId: "project-one",
        source: "marker",
        markerPath: "/tmp/clash-vault/.clash/project.toml",
      },
      {
        clashRoot: "/tmp/clash-home",
        currentWorkingDirectory: "/tmp/clash-vault/drafts/scene-1",
        marker: {
          store: "managed",
          workspaceId: "workspace-1",
          sync: { mode: "local" },
        },
      },
    );

    expect(status.currentWorkspace).toEqual({
      schemaVersion: 1,
      role: "project-reference-workspace",
      currentWorkingDirectory: "/tmp/clash-vault/drafts/scene-1",
      markerPath: "/tmp/clash-vault/.clash/project.toml",
      markerRoot: "/tmp/clash-vault",
      markerStore: "managed",
      markerWorkspaceId: "workspace-1",
      projectWorkspaceRoot: "/tmp/clash-home/projects/project-one",
      locatedInProjectWorkspace: false,
      ownsCanonicalSnapshot: false,
      ownsCanonicalMetadata: false,
      deletionDeletesProjectState: false,
    });
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
      actions: {
        openInWeb: {
          allowed: false,
          reason: "project-is-local-only",
          requirements: ["enable-sync"],
        },
        enableSync: {
          allowed: true,
          reason: null,
          requirements: [],
        },
        shareProject: {
          allowed: false,
          reason: "project-is-local-only",
          requirements: ["enable-sync"],
        },
        runLocalAgent: {
          allowed: true,
          reason: null,
          requirements: ["owner-machine-online"],
        },
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
      actions: {
        openInWeb: {
          allowed: false,
          reason: "cloud-sync-not-ready",
          requirements: ["canvas", "room", "asset-metadata"],
        },
        enableSync: {
          allowed: false,
          reason: "already-cloud-connected",
          requirements: [],
        },
        shareProject: {
          allowed: false,
          reason: "cloud-sync-not-ready",
          requirements: ["canvas", "room", "asset-metadata"],
        },
        runLocalAgent: {
          allowed: true,
          reason: null,
          requirements: ["owner-machine-online"],
        },
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
      actions: {
        openInWeb: {
          allowed: true,
          reason: null,
          requirements: [],
        },
        enableSync: {
          allowed: false,
          reason: "already-cloud-connected",
          requirements: [],
        },
        shareProject: {
          allowed: true,
          reason: null,
          requirements: [],
        },
        runLocalAgent: {
          allowed: true,
          reason: null,
          requirements: ["owner-machine-online"],
        },
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
      actions: {
        openInWeb: {
          allowed: false,
          reason: "cloud-sync-not-ready",
          requirements: ["canvas", "room", "asset-metadata"],
        },
        shareProject: {
          allowed: false,
          reason: "cloud-sync-not-ready",
          requirements: ["canvas", "room", "asset-metadata"],
        },
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
      actions: {
        openInWeb: {
          allowed: true,
          reason: null,
          requirements: [],
        },
        shareProject: {
          allowed: true,
          reason: null,
          requirements: [],
        },
      },
    });
  });

  it("publishes the room chat and raw agent trace sync boundary", () => {
    const status = buildProjectStatus(
      { projectId: "project-shared", source: "explicit" },
      { clashRoot: "/tmp/clash-home", marker: { sync: { mode: "shared" } } },
    );

    expect(status.collaboration.tracePolicy).toEqual(expectedTracePolicy);
  });
});
