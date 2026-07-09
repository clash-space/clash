import { describe, expect, it } from "vitest";
import { buildProjectRecoveryPolicy, buildProjectStatus, projectWorkspaceId } from "./project-status";

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
    syncAdmission: {
      allowed: false,
      reason: "explicit-policy-required",
      requirements: ["user-opt-in-or-team-policy"],
      defaultAllowed: false,
    },
    retention: {
      default: "until-session-delete",
      scope: "per-session",
      api: "DELETE /api/v1/sessions",
      cliCommand: "clash sessions delete",
      clears: ["runtime_session", "chat_message"],
    },
  },
} as const;

function expectedProjectRoomPolicy(cloudSurface: "disabled" | "sequencer") {
  return {
    schemaVersion: 1,
    localSurface: "removed",
    localPersistence: false,
    localApiEndpoints: "404",
    cliCommand: "unregistered",
    cloudSurface,
    rawAgentTrace: false,
    agentDefaultChannels: ["sessions", "canvas", "actions"],
  } as const;
}

const expectedSyncMirrorPolicy = {
  canvas: {
    requirement: "canvas",
    source: "loro-canvas-replica",
    conflictPolicy: "loro-crdt",
  },
  assetMetadata: {
    requirement: "asset-metadata",
    source: "sqlite-asset-indexes",
    registries: ["assets", "asset_refs", "asset_node_refs"],
    mediaBlobsIncluded: false,
    conflictPolicy: "host-indexed-content-addressed-assets",
  },
  revisionContent: {
    requirement: "revision-content",
    source: "sqlite-index-and-content-addressed-revision-blobs",
    registries: ["text_revisions", "timeline_revisions"],
    contentKinds: ["text-revision-content", "timeline-revision-content"],
    mediaAsset: false,
    agentWritable: false,
    conflictPolicy: "same-revision-id-same-hash-idempotent-conflict-otherwise",
  },
} as const;

function expectedSyncPolicy(cloudAdmission: string) {
  return {
    schemaVersion: 1,
    cloudAdmission,
    mirror: expectedSyncMirrorPolicy,
    excluded: {
      rawAgentTraces: {
        syncDefault: "local-only",
        optInRequiredForSync: true,
      },
      localRuntimeSecrets: {
        syncDefault: "local-only",
        optInRequiredForSync: true,
      },
    },
  };
}

describe("project status path builder", () => {
  it("derives stable workspace ids without embedding project ids", () => {
    const first = projectWorkspaceId("managed", "project/with spaces", "/tmp/workspace");
    const second = projectWorkspaceId("managed", "project/with spaces", "/tmp/workspace");
    const differentWorkspace = projectWorkspaceId("managed", "project/with spaces", "/tmp/other-workspace");
    const external = projectWorkspaceId("external", "project/with spaces", "/tmp/workspace");

    expect(first).toMatch(/^managed:[a-f0-9]{16}$/);
    expect(first).toBe(second);
    expect(first).not.toContain("project");
    expect(first).not.toBe(differentWorkspace);
    expect(first).not.toBe(external);
    expect(external).toMatch(/^external:[a-f0-9]{16}$/);
  });

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
    expect(status.storage.canonicalReplica.metadata.localConfig).toEqual({
      role: "machine-local-config",
      table: "local_config",
      keys: ["local-sync-config", "local-audio-config", "local-harness-config"],
      syncDefault: "local-only",
      agentWritable: false,
      mutationSurface: "host-api-or-cli",
      jsonSidecars: "removed",
    });
    expect(status.storage.localSecrets.files.cliConfig.path).toBe("/tmp/clash-home/config.json");
    expect(status.storage.localSecrets.files.bridgeCredentials.path).toBe("/tmp/clash-home/credentials.json");
    expect(status.loro.snapshotPath).toBe("/tmp/clash-home/local-api/projects/project%2Fone/loro/snapshot.bin");
    expect(status.storage.canonicalReplica.mediaAssets.path).toBe("/tmp/clash-home/assets/blobs");
    expect(status.storage.canonicalReplica.contentBlobs.textRevisions.path).toBe("/tmp/clash-home/local-api/text-revision-blobs");
    expect(status.storage.canonicalReplica.contentBlobs.timelineRevisions.path).toBe("/tmp/clash-home/local-api/timeline-revision-blobs");
    expect(status.storage.contentModel.textNodes.revisionRegistry).toBe("text_revisions");
    expect(status.storage.contentModel.textNodes.revisionBlobPath).toBe(status.storage.canonicalReplica.contentBlobs.textRevisions.path);
    expect(status.storage.contentModel.textNodes.historyCommand).toBe("clash text history");
    expect(status.storage.contentModel.textNodes.contentCommand).toBe("clash text content");
    expect(status.storage.contentModel.textNodes.contentRegistry).toEqual({
      kind: "sqlite-non-media-revision-registry",
      table: "text_revisions",
      blobStore: "storage.canonicalReplica.contentBlobs.textRevisions",
      mediaAssetTable: false,
    });
    expect(status.storage.contentModel.textNodes.mediaAsset).toBe(false);
    expect(status.storage.contentModel.timelines.revisionRegistry).toBe("timeline_revisions");
    expect(status.storage.contentModel.timelines.revisionBlobPath).toBe(status.storage.canonicalReplica.contentBlobs.timelineRevisions.path);
    expect(status.storage.contentModel.timelines.historyCommand).toBe("clash timeline history");
    expect(status.storage.contentModel.timelines.contentCommand).toBe("clash timeline content");
    expect(status.storage.contentModel.timelines.contentRegistry).toEqual({
      kind: "sqlite-non-media-revision-registry",
      table: "timeline_revisions",
      blobStore: "storage.canonicalReplica.contentBlobs.timelineRevisions",
      mediaAssetTable: false,
    });
    expect(status.storage.contentModel.timelines.mediaAsset).toBe(false);
    expect(status.editablePaths).toContain(status.roots.drafts);
    expect(status.editablePaths).toContain(status.roots.timelines);
    expect(status.protectedPaths).toContain(status.loro.snapshotPath);
    expect(status.protectedPaths).toContain(status.storage.canonicalReplica.mediaAssets.path);
    expect(status.protectedPaths).toContain(status.storage.canonicalReplica.contentBlobs.textRevisions.path);
    expect(status.protectedPaths).toContain(status.storage.canonicalReplica.contentBlobs.timelineRevisions.path);
    expect(status.protectedPaths).toContain(status.storage.localSecrets.files.cliConfig.path);
    expect(status.protectedPaths).toContain(status.storage.localSecrets.files.bridgeCredentials.path);
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
        required: ["canvas", "asset-metadata", "revision-content"],
        missing: ["canvas", "asset-metadata", "revision-content"],
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
      syncPolicy: expectedSyncPolicy("unknown-until-sync-mode-known"),
      localAgentRuntime: {
        requiredForLocalActions: true,
        availability: "owner-machine-online",
      },
      projectRoom: expectedProjectRoomPolicy("disabled"),
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
          localConfig: {
            role: "machine-local-config",
            table: "local_config",
            keys: ["local-sync-config", "local-audio-config", "local-harness-config"],
            syncDefault: "local-only",
            agentWritable: false,
            mutationSurface: "host-api-or-cli",
            jsonSidecars: "removed",
          },
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
      localSecrets: {
        role: "machine-local-secret-files",
        syncDefault: "local-only",
        agentWritable: false,
        files: {
          cliConfig: {
            kind: "cli-api-key-config",
            path: "/tmp/clash-home/config.json",
            agentWritable: false,
          },
          bridgeCredentials: {
            kind: "local-runtime-credentials",
            path: "/tmp/clash-home/credentials.json",
            agentWritable: false,
          },
        },
      },
      contentModel: {
        role: "agent-projections-with-host-indexed-revision-content",
        textNodes: {
          liveState: "loro-canvas-text-node-data",
          editableProjection: "storage.workspace.viewFiles.texts",
          projectionPath: "/tmp/clash-home/projects/project%2Fone/projections/text",
          applyCommand: "clash text apply",
          replaceCommand: "clash text replace",
          restoreCommand: "clash text restore",
          historyCommand: "clash text history",
          contentCommand: "clash text content",
          casRequired: true,
          copyOnWriteWhenReferenced: true,
          revisionRegistry: "text_revisions",
          revisionBlobPath: "/tmp/clash-home/local-api/text-revision-blobs",
          contentRegistry: {
            kind: "sqlite-non-media-revision-registry",
            table: "text_revisions",
            blobStore: "storage.canonicalReplica.contentBlobs.textRevisions",
            mediaAssetTable: false,
          },
          mediaAsset: false,
          agentWritableCanonicalState: false,
        },
        timelines: {
          liveState: "loro-canvas-video-editor-node-data",
          editableProjection: "storage.workspace.viewFiles.timelines",
          projectionPath: "/tmp/clash-home/projects/project%2Fone/timelines",
          applyCommand: "clash timeline apply",
          replaceCommand: "clash timeline replace",
          restoreCommand: "clash timeline restore",
          historyCommand: "clash timeline history",
          contentCommand: "clash timeline content",
          casRequired: true,
          copyOnWriteWhenReferenced: true,
          revisionRegistry: "timeline_revisions",
          revisionBlobPath: "/tmp/clash-home/local-api/timeline-revision-blobs",
          contentRegistry: {
            kind: "sqlite-non-media-revision-registry",
            table: "timeline_revisions",
            blobStore: "storage.canonicalReplica.contentBlobs.timelineRevisions",
            mediaAssetTable: false,
          },
          mediaAsset: false,
          agentWritableCanonicalState: false,
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
      syncPolicy: {
        cloudAdmission: "disabled-until-enable-sync",
      },
      syncReadiness: {
        status: "disabled",
        ready: false,
        missing: ["canvas", "asset-metadata", "revision-content"],
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
      syncPolicy: {
        cloudAdmission: "blocked-until-requirements-ready",
      },
      syncReadiness: {
        status: "pending",
        ready: false,
        missing: ["canvas", "asset-metadata", "revision-content"],
      },
      actions: {
        openInWeb: {
          allowed: false,
          reason: "cloud-sync-not-ready",
          requirements: ["canvas", "asset-metadata", "revision-content"],
        },
        enableSync: {
          allowed: false,
          reason: "already-cloud-connected",
          requirements: [],
        },
        shareProject: {
          allowed: false,
          reason: "cloud-sync-not-ready",
          requirements: ["canvas", "asset-metadata", "revision-content"],
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
      projectRoom: expectedProjectRoomPolicy("sequencer"),
      syncPolicy: {
        cloudAdmission: "cloud-sequencer",
      },
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

  it("derives recovery policy from project collaboration status", () => {
    const local = buildProjectStatus(
      { projectId: "project-local", source: "explicit" },
      { clashRoot: "/tmp/clash-home", marker: { sync: { mode: "local" } } },
    );
    const cloudSync = buildProjectStatus(
      { projectId: "project-synced", source: "explicit" },
      {
        clashRoot: "/tmp/clash-home",
        marker: {
          sync: {
            mode: "cloud-sync",
            capabilities: {
              canvas: true,
              assetMetadata: true,
              revisionContent: true,
            },
          },
        },
      },
    );
    const shared = buildProjectStatus(
      { projectId: "project-shared", source: "explicit" },
      { clashRoot: "/tmp/clash-home", marker: { sync: { mode: "shared" } } },
    );
    const unknown = buildProjectStatus(
      { projectId: "project-unknown", source: "explicit" },
      { clashRoot: "/tmp/clash-home" },
    );

    expect(buildProjectRecoveryPolicy(local)).toMatchObject({
      scope: "local-canonical-replica",
      collaborationMode: "local-only",
      rawSyncMode: "local",
      localRestoreAllowed: true,
      cloudStateIncluded: false,
      cloudStateMutated: false,
      requiresCloudConflictReview: false,
      reason: "local-only-manual-review-required",
    });
    expect(buildProjectRecoveryPolicy(cloudSync)).toMatchObject({
      collaborationMode: "synced",
      rawSyncMode: "cloud-sync",
      roomAuthority: "local-with-cloud-mirror",
      syncReadinessStatus: "ready",
      localRestoreAllowed: true,
      cloudStateIncluded: false,
      cloudStateMutated: false,
      requiresCloudConflictReview: true,
      reason: "cloud-sync-local-replica-review-required",
    });
    expect(buildProjectRecoveryPolicy(shared)).toMatchObject({
      collaborationMode: "shared",
      rawSyncMode: "shared",
      roomAuthority: "cloud-sequencer",
      cloudProjectRoom: "sequencer",
      syncReadinessStatus: "ready",
      localRestoreAllowed: false,
      cloudStateIncluded: false,
      cloudStateMutated: false,
      requiresCloudConflictReview: true,
      reason: "shared-cloud-sequencer-restore-blocked",
    });
    expect(buildProjectRecoveryPolicy(unknown)).toMatchObject({
      collaborationMode: "unknown",
      localRestoreAllowed: false,
      requiresCloudConflictReview: true,
      reason: "sync-mode-unknown-local-replica-review-required",
    });
    expect(buildProjectRecoveryPolicy(cloudSync, { localRestoreAllowed: false })).toMatchObject({
      collaborationMode: "synced",
      localRestoreAllowed: false,
      reason: "cloud-sync-local-replica-review-required",
    });
  });

  it("keeps cloud-sync pending until canvas, asset metadata, and revision content sync are all ready", () => {
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
              assetMetadata: true,
              revisionContent: true,
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
        missing: ["canvas", "asset-metadata", "revision-content"],
      },
      actions: {
        openInWeb: {
          allowed: false,
          reason: "cloud-sync-not-ready",
          requirements: ["canvas", "asset-metadata", "revision-content"],
        },
        shareProject: {
          allowed: false,
          reason: "cloud-sync-not-ready",
          requirements: ["canvas", "asset-metadata", "revision-content"],
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

  it("keeps cloud-sync pending until revision content sync is ready", () => {
    const missingRevisionContent = buildProjectStatus(
      { projectId: "project-synced", source: "explicit" },
      {
        clashRoot: "/tmp/clash-home",
        marker: {
          sync: {
            mode: "cloud-sync",
            capabilities: {
              canvas: true,
              assetMetadata: true,
            },
          },
        },
      },
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
              assetMetadata: true,
              revisionContent: true,
            },
          },
        },
      },
    );

    expect(missingRevisionContent.collaboration).toMatchObject({
      mode: "synced",
      webOpenable: false,
      roomAuthority: "local",
      syncReadiness: {
        status: "pending",
        ready: false,
        missing: ["revision-content"],
      },
      actions: {
        openInWeb: {
          allowed: false,
          reason: "cloud-sync-not-ready",
          requirements: ["revision-content"],
        },
        shareProject: {
          allowed: false,
          reason: "cloud-sync-not-ready",
          requirements: ["revision-content"],
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
    });
  });

  it("publishes the cloud mirror policy for revision content separately from media assets", () => {
    const status = buildProjectStatus(
      { projectId: "project-synced", source: "explicit" },
      {
        clashRoot: "/tmp/clash-home",
        marker: {
          sync: {
            mode: "cloud-sync",
            capabilities: {
              canvas: true,
              assetMetadata: true,
              revisionContent: true,
            },
          },
        },
      },
    );

    expect(status.collaboration.syncPolicy).toMatchObject({
      schemaVersion: 1,
      cloudAdmission: "ready-local-with-cloud-mirror",
      mirror: {
        revisionContent: {
          requirement: "revision-content",
          source: "sqlite-index-and-content-addressed-revision-blobs",
          registries: ["text_revisions", "timeline_revisions"],
          contentKinds: ["text-revision-content", "timeline-revision-content"],
          mediaAsset: false,
          agentWritable: false,
          conflictPolicy: "same-revision-id-same-hash-idempotent-conflict-otherwise",
        },
      },
      excluded: {
        rawAgentTraces: {
          syncDefault: "local-only",
          optInRequiredForSync: true,
        },
        localRuntimeSecrets: {
          syncDefault: "local-only",
          optInRequiredForSync: true,
        },
      },
    });
  });

  it("publishes the room chat and raw agent trace sync boundary", () => {
    const status = buildProjectStatus(
      { projectId: "project-shared", source: "explicit" },
      { clashRoot: "/tmp/clash-home", marker: { sync: { mode: "shared" } } },
    );

    expect(status.collaboration.projectRoom).toEqual(expectedProjectRoomPolicy("sequencer"));
    expect(status.collaboration.tracePolicy).toEqual(expectedTracePolicy);
  });
});
