export type ProjectStatusSource = "explicit" | "marker" | "env";

export interface ProjectStatusContext {
  projectId: string;
  source: ProjectStatusSource;
  markerPath?: string;
}

export interface ProjectStatusMarker {
  store?: unknown;
  workspaceId?: unknown;
  sync?: Record<string, unknown>;
}

export type ProjectWorkspaceIdKind = "managed" | "external";

export interface ProjectStatusCurrentWorkspace {
  schemaVersion: 1;
  role: "project-reference-workspace";
  currentWorkingDirectory?: string;
  markerPath?: string;
  markerRoot?: string;
  markerStore: string;
  markerWorkspaceId?: string;
  projectWorkspaceRoot: string;
  locatedInProjectWorkspace: boolean | null;
  ownsCanonicalSnapshot: false;
  ownsCanonicalMetadata: false;
  deletionDeletesProjectState: false;
}

export interface ProjectStatusStorage {
  schemaVersion: 1;
  context: {
    role: "project-reference";
    projectId: string;
    source: ProjectStatusSource;
    markerPath?: string;
  };
  workspace: {
    role: "agent-draft-and-projection-workspace";
    root: string;
    ownsCanonicalSnapshot: false;
    ownsCanonicalMetadata: false;
    editablePaths: string[];
    protectedPaths: string[];
    viewFiles: {
      texts: {
        kind: "agent-editable-projection-files";
        path: string;
        defaultFilePattern: "<node-id>.md";
        applyCommand: "clash text apply";
        casRequired: true;
        ownsCanonicalState: false;
      };
      timelines: {
        kind: "agent-editable-view-files";
        path: string;
        defaultFile: "main.timeline.yaml";
        applyCommand: "clash timeline apply";
        casRequired: true;
        ownsCanonicalState: false;
      };
      timelineProjections: {
        kind: "agent-editable-projection-files";
        path: string;
        applyCommand: "clash timeline apply";
        casRequired: true;
        ownsCanonicalState: false;
      };
    };
  };
  canonicalReplica: {
    role: "single-machine-project-replica";
    scope: "machine";
    projectId: string;
    metadata: {
      kind: "sqlite";
      path: string;
      agentWritable: false;
    };
    canvas: {
      kind: "loro";
      replicaRoot: string;
      snapshotPath: string;
      updatesLogPath: string;
      agentWritable: false;
    };
    mediaAssets: {
      kind: "content-addressed-files";
      path: string;
      storageKeyPrefix: "local-blobs/";
      immutable: true;
      deduplicatedBy: "sha256";
      agentWritable: false;
      referencedBy: "sqlite-asset-rows-and-project-asset-links";
    };
    contentBlobs: {
      textRevisions: {
        kind: "content-addressed-files";
        path: string;
        mediaType: "text/markdown";
        immutable: true;
        agentWritable: false;
      };
      timelineRevisions: {
        kind: "content-addressed-files";
        path: string;
        mediaType: "application/yaml";
        immutable: true;
        agentWritable: false;
      };
    };
  };
  contentModel: {
    role: "agent-projections-with-host-indexed-revision-content";
    textNodes: {
      liveState: "loro-canvas-text-node-data";
      editableProjection: "storage.workspace.viewFiles.texts";
      projectionPath: string;
      applyCommand: "clash text apply";
      replaceCommand: "clash text replace";
      casRequired: true;
      copyOnWriteWhenReferenced: true;
      revisionRegistry: "text_revisions";
      revisionBlobPath: string;
      mediaAsset: false;
      agentWritableCanonicalState: false;
    };
    timelines: {
      liveState: "loro-canvas-video-editor-node-data";
      editableProjection: "storage.workspace.viewFiles.timelines";
      projectionPath: string;
      applyCommand: "clash timeline apply";
      replaceCommand: "clash timeline replace";
      casRequired: true;
      copyOnWriteWhenReferenced: true;
      revisionRegistry: "timeline_revisions";
      revisionBlobPath: string;
      mediaAsset: false;
      agentWritableCanonicalState: false;
    };
  };
  localSecrets: {
    role: "machine-local-secret-files";
    syncDefault: "local-only";
    agentWritable: false;
    files: {
      cliConfig: {
        kind: "cli-api-key-config";
        path: string;
        agentWritable: false;
      };
      bridgeCredentials: {
        kind: "local-runtime-credentials";
        path: string;
        agentWritable: false;
      };
    };
  };
}

export type ProjectCollaborationMode = "local-only" | "synced" | "shared" | "unknown";
export type ProjectRoomAuthority = "local" | "local-with-cloud-mirror" | "cloud-sequencer";
export type ProjectCloudRoomMode = "disabled" | "sequencer";
export type ProjectSyncReadinessStatus = "disabled" | "pending" | "ready";

export interface ProjectSyncReadiness {
  status: ProjectSyncReadinessStatus;
  ready: boolean;
  required: string[];
  missing: string[];
}

export type ProjectStatusActionGateReason =
  | "project-is-local-only"
  | "cloud-sync-not-ready"
  | "sync-mode-unknown"
  | "already-cloud-connected";

export interface ProjectStatusActionGate {
  allowed: boolean;
  reason: ProjectStatusActionGateReason | null;
  requirements: string[];
}

export interface ProjectStatusActionGates {
  openInWeb: ProjectStatusActionGate;
  enableSync: ProjectStatusActionGate;
  shareProject: ProjectStatusActionGate;
  runLocalAgent: ProjectStatusActionGate;
}

export interface ProjectStatusTracePolicy {
  schemaVersion: 1;
  roomMessages: {
    kind: "project-chat";
    syncDefault: "sync-when-project-sync-enabled";
    rawAgentTrace: false;
  };
  agentSessionMetadata: {
    kind: "public-session-metadata";
    syncDefault: "sync-when-project-sync-enabled";
    rawAgentTrace: false;
  };
  rawAgentTraces: {
    kind: "private-runtime-trace";
    syncDefault: "local-only";
    optInRequiredForSync: true;
    excludedFromRoom: true;
    sensitiveFields: string[];
  };
}

export type ProjectStatusSyncCloudAdmission =
  | "disabled-until-enable-sync"
  | "blocked-until-requirements-ready"
  | "ready-local-with-cloud-mirror"
  | "cloud-sequencer"
  | "unknown-until-sync-mode-known";

export interface ProjectStatusSyncPolicy {
  schemaVersion: 1;
  cloudAdmission: ProjectStatusSyncCloudAdmission;
  mirror: {
    canvas: {
      requirement: "canvas";
      source: "loro-canvas-replica";
      conflictPolicy: "loro-crdt";
    };
    room: {
      requirement: "room";
      source: "sqlite-room-messages";
      conflictPolicy: "same-message-id-same-normalized-content-idempotent-conflict-otherwise";
      rawAgentTrace: false;
    };
    assetMetadata: {
      requirement: "asset-metadata";
      source: "sqlite-asset-indexes";
      registries: ["assets", "asset_refs", "asset_node_refs"];
      mediaBlobsIncluded: false;
      conflictPolicy: "host-indexed-content-addressed-assets";
    };
    revisionContent: {
      requirement: "revision-content";
      source: "sqlite-index-and-content-addressed-revision-blobs";
      registries: ["text_revisions", "timeline_revisions"];
      contentKinds: ["text-revision-content", "timeline-revision-content"];
      mediaAsset: false;
      agentWritable: false;
      conflictPolicy: "same-revision-id-same-hash-idempotent-conflict-otherwise";
    };
  };
  excluded: {
    rawAgentTraces: {
      syncDefault: "local-only";
      optInRequiredForSync: true;
    };
    localRuntimeSecrets: {
      syncDefault: "local-only";
      optInRequiredForSync: true;
    };
  };
}

export interface ProjectStatusCollaboration {
  schemaVersion: 1;
  mode: ProjectCollaborationMode;
  rawMode: string;
  webOpenable: boolean;
  multiUser: boolean;
  roomAuthority: ProjectRoomAuthority;
  cloudProjectRoom: ProjectCloudRoomMode;
  syncReadiness: ProjectSyncReadiness;
  actions: ProjectStatusActionGates;
  syncPolicy: ProjectStatusSyncPolicy;
  localAgentRuntime: {
    requiredForLocalActions: true;
    availability: "owner-machine-online";
  };
  tracePolicy: ProjectStatusTracePolicy;
}

export type ProjectRecoveryPolicyReason =
  | "local-only-manual-review-required"
  | "cloud-sync-local-replica-review-required"
  | "shared-cloud-sequencer-restore-blocked"
  | "sync-mode-unknown-local-replica-review-required";

export interface ProjectRecoveryPolicy {
  scope: "local-canonical-replica";
  collaborationMode: ProjectCollaborationMode;
  rawSyncMode: string;
  roomAuthority: ProjectRoomAuthority;
  cloudProjectRoom: ProjectCloudRoomMode;
  syncReadinessStatus: ProjectSyncReadinessStatus;
  localRestoreAllowed: boolean;
  cloudStateIncluded: false;
  cloudStateMutated: false;
  requiresCloudConflictReview: boolean;
  reason: ProjectRecoveryPolicyReason;
}

export interface ProjectStatus {
  projectId: string;
  source: ProjectStatusSource;
  markerPath?: string;
  mode: string;
  syncMode: string;
  clashHome: string;
  projectStore: string;
  projectWorkspaceRoot: string;
  currentWorkspace: ProjectStatusCurrentWorkspace;
  localApiDataDir: string;
  localSqlitePath: string;
  legacyDbJsonPath: string;
  loro: {
    replicaRoot: string;
    snapshotPath: string;
    updatesLogPath: string;
  };
  roots: {
    drafts: string;
    projections: string;
    timelines: string;
    sessions: string;
    assetLinks: string;
    runtime: string;
  };
  draftsRoot: string;
  projectionsRoot: string;
  assetLinksRoot: string;
  runtimeRoot: string;
  editablePaths: string[];
  protectedPaths: string[];
  collaboration: ProjectStatusCollaboration;
  storage: ProjectStatusStorage;
}

export function buildProjectRecoveryPolicy(
  status: Pick<ProjectStatus, "collaboration">,
  options: { localRestoreAllowed?: boolean } = {},
): ProjectRecoveryPolicy {
  const collaboration = status.collaboration;
  const defaultLocalRestoreAllowed =
    collaboration.mode !== "shared" && collaboration.mode !== "unknown";
  const reason: ProjectRecoveryPolicyReason = collaboration.mode === "shared"
    ? "shared-cloud-sequencer-restore-blocked"
    : collaboration.mode === "synced"
      ? "cloud-sync-local-replica-review-required"
      : collaboration.mode === "unknown"
        ? "sync-mode-unknown-local-replica-review-required"
        : "local-only-manual-review-required";

  return {
    scope: "local-canonical-replica",
    collaborationMode: collaboration.mode,
    rawSyncMode: collaboration.rawMode,
    roomAuthority: collaboration.roomAuthority,
    cloudProjectRoom: collaboration.cloudProjectRoom,
    syncReadinessStatus: collaboration.syncReadiness.status,
    localRestoreAllowed: options.localRestoreAllowed ?? defaultLocalRestoreAllowed,
    cloudStateIncluded: false,
    cloudStateMutated: false,
    requiresCloudConflictReview: collaboration.mode !== "local-only",
    reason,
  };
}

export function buildProjectStatus(
  context: ProjectStatusContext,
  options: {
    marker?: ProjectStatusMarker | null;
    clashRoot: string;
    localApiDataDir?: string;
    currentWorkingDirectory?: string;
  },
): ProjectStatus {
  const clashRoot = options.clashRoot;
  const projectWorkspaceRoot = joinPath(
    clashRoot,
    "projects",
    projectIdPathSegment(context.projectId),
  );
  const localApiDataDir = options.localApiDataDir ?? joinPath(clashRoot, "local-api");
  const localApiProjectRoot = joinPath(
    localApiDataDir,
    "projects",
    encodeURIComponent(context.projectId),
  );
  const projections = joinPath(projectWorkspaceRoot, "projections");
  const timelines = joinPath(projectWorkspaceRoot, "timelines");
  const textProjections = joinPath(projections, "text");
  const timelineProjections = joinPath(projections, "timelines");
  const drafts = joinPath(projectWorkspaceRoot, "drafts");
  const sessions = joinPath(projectWorkspaceRoot, "sessions");
  const assetLinks = joinPath(projectWorkspaceRoot, "assets", "links");
  const runtimeRoot = joinPath(projectWorkspaceRoot, "runtime");
  const mode =
    typeof options.marker?.sync?.mode === "string"
      ? options.marker.sync.mode
      : "unknown";
  const collaboration = projectCollaborationStatus(mode, options.marker?.sync);
  const localSqlitePath = joinPath(localApiDataDir, "local.sqlite");
  const legacyDbJsonPath = joinPath(localApiDataDir, "db.json");
  const cliConfigPath = joinPath(clashRoot, "config.json");
  const bridgeCredentialsPath = joinPath(clashRoot, "credentials.json");
  const mediaAssetBlobRoot = joinPath(clashRoot, "assets", "blobs");
  const textRevisionBlobRoot = joinPath(localApiDataDir, "text-revision-blobs");
  const timelineRevisionBlobRoot = joinPath(localApiDataDir, "timeline-revision-blobs");
  const loroReplicaRoot = joinPath(localApiProjectRoot, "loro");
  const loroSnapshotPath = joinPath(loroReplicaRoot, "snapshot.bin");
  const loroUpdatesLogPath = joinPath(loroReplicaRoot, "updates.log");
  const editablePaths = [
    drafts,
    projections,
    timelines,
    sessions,
    assetLinks,
  ];
  const protectedPaths = [
    localApiDataDir,
    localSqlitePath,
    legacyDbJsonPath,
    cliConfigPath,
    bridgeCredentialsPath,
    loroReplicaRoot,
    loroSnapshotPath,
    loroUpdatesLogPath,
    mediaAssetBlobRoot,
    textRevisionBlobRoot,
    timelineRevisionBlobRoot,
    runtimeRoot,
  ];
  const markerRoot = context.markerPath ? projectMarkerRoot(context.markerPath) : undefined;
  const currentWorkspace: ProjectStatusCurrentWorkspace = {
    schemaVersion: 1,
    role: "project-reference-workspace",
    ...(options.currentWorkingDirectory
      ? { currentWorkingDirectory: normalizePath(options.currentWorkingDirectory) }
      : {}),
    ...(context.markerPath ? { markerPath: context.markerPath } : {}),
    ...(markerRoot ? { markerRoot } : {}),
    markerStore: markerString(options.marker?.store) ?? "unknown",
    ...(markerString(options.marker?.workspaceId)
      ? { markerWorkspaceId: markerString(options.marker?.workspaceId) }
      : {}),
    projectWorkspaceRoot,
    locatedInProjectWorkspace: options.currentWorkingDirectory
      ? isSameOrInsidePath(options.currentWorkingDirectory, projectWorkspaceRoot)
      : null,
    ownsCanonicalSnapshot: false,
    ownsCanonicalMetadata: false,
    deletionDeletesProjectState: false,
  };

  return {
    projectId: context.projectId,
    source: context.source,
    ...(context.markerPath ? { markerPath: context.markerPath } : {}),
    mode,
    syncMode: mode,
    clashHome: clashRoot,
    projectStore: projectWorkspaceRoot,
    projectWorkspaceRoot,
    currentWorkspace,
    localApiDataDir,
    localSqlitePath,
    legacyDbJsonPath,
    loro: {
      replicaRoot: loroReplicaRoot,
      snapshotPath: loroSnapshotPath,
      updatesLogPath: loroUpdatesLogPath,
    },
    roots: {
      drafts,
      projections,
      timelines,
      sessions,
      assetLinks,
      runtime: runtimeRoot,
    },
    draftsRoot: drafts,
    projectionsRoot: projections,
    assetLinksRoot: assetLinks,
    runtimeRoot,
    editablePaths,
    protectedPaths,
    collaboration,
    storage: {
      schemaVersion: 1,
      context: {
        role: "project-reference",
        projectId: context.projectId,
        source: context.source,
        ...(context.markerPath ? { markerPath: context.markerPath } : {}),
      },
      workspace: {
        role: "agent-draft-and-projection-workspace",
        root: projectWorkspaceRoot,
        ownsCanonicalSnapshot: false,
        ownsCanonicalMetadata: false,
        editablePaths,
        protectedPaths: [runtimeRoot],
        viewFiles: {
          texts: {
            kind: "agent-editable-projection-files",
            path: textProjections,
            defaultFilePattern: "<node-id>.md",
            applyCommand: "clash text apply",
            casRequired: true,
            ownsCanonicalState: false,
          },
          timelines: {
            kind: "agent-editable-view-files",
            path: timelines,
            defaultFile: "main.timeline.yaml",
            applyCommand: "clash timeline apply",
            casRequired: true,
            ownsCanonicalState: false,
          },
          timelineProjections: {
            kind: "agent-editable-projection-files",
            path: timelineProjections,
            applyCommand: "clash timeline apply",
            casRequired: true,
            ownsCanonicalState: false,
          },
        },
      },
      canonicalReplica: {
        role: "single-machine-project-replica",
        scope: "machine",
        projectId: context.projectId,
        metadata: {
          kind: "sqlite",
          path: localSqlitePath,
          agentWritable: false,
        },
        canvas: {
          kind: "loro",
          replicaRoot: loroReplicaRoot,
          snapshotPath: loroSnapshotPath,
          updatesLogPath: loroUpdatesLogPath,
          agentWritable: false,
        },
        mediaAssets: {
          kind: "content-addressed-files",
          path: mediaAssetBlobRoot,
          storageKeyPrefix: "local-blobs/",
          immutable: true,
          deduplicatedBy: "sha256",
          agentWritable: false,
          referencedBy: "sqlite-asset-rows-and-project-asset-links",
        },
        contentBlobs: {
          textRevisions: {
            kind: "content-addressed-files",
            path: textRevisionBlobRoot,
            mediaType: "text/markdown",
            immutable: true,
            agentWritable: false,
          },
          timelineRevisions: {
            kind: "content-addressed-files",
            path: timelineRevisionBlobRoot,
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
            path: cliConfigPath,
            agentWritable: false,
          },
          bridgeCredentials: {
            kind: "local-runtime-credentials",
            path: bridgeCredentialsPath,
            agentWritable: false,
          },
        },
      },
      contentModel: {
        role: "agent-projections-with-host-indexed-revision-content",
        textNodes: {
          liveState: "loro-canvas-text-node-data",
          editableProjection: "storage.workspace.viewFiles.texts",
          projectionPath: textProjections,
          applyCommand: "clash text apply",
          replaceCommand: "clash text replace",
          casRequired: true,
          copyOnWriteWhenReferenced: true,
          revisionRegistry: "text_revisions",
          revisionBlobPath: textRevisionBlobRoot,
          mediaAsset: false,
          agentWritableCanonicalState: false,
        },
        timelines: {
          liveState: "loro-canvas-video-editor-node-data",
          editableProjection: "storage.workspace.viewFiles.timelines",
          projectionPath: timelines,
          applyCommand: "clash timeline apply",
          replaceCommand: "clash timeline replace",
          casRequired: true,
          copyOnWriteWhenReferenced: true,
          revisionRegistry: "timeline_revisions",
          revisionBlobPath: timelineRevisionBlobRoot,
          mediaAsset: false,
          agentWritableCanonicalState: false,
        },
      },
    },
  };
}

export function projectIdPathSegment(id: string): string {
  const encoded = encodeURIComponent(id).replace(/\./g, "%2E");
  return encoded || "_default";
}

export function projectWorkspaceId(
  kind: ProjectWorkspaceIdKind,
  projectId: string,
  cwd: string,
): string {
  return `${kind}:${stableWorkspaceHash(`${kind}\0${projectId}\0${normalizePath(cwd)}`)}`;
}

export function projectCollaborationStatus(
  rawMode: unknown,
  sync: Record<string, unknown> | undefined = undefined,
): ProjectStatusCollaboration {
  const raw = typeof rawMode === "string" && rawMode.trim() ? rawMode.trim() : "unknown";
  const normalized = normalizeCollaborationMode(raw);
  const syncReadiness = projectSyncReadiness(normalized, sync);
  const webOpenable = normalized === "shared" || (normalized === "synced" && syncReadiness.ready);
  const actions = projectActionGates(normalized, syncReadiness, webOpenable);
  return {
    schemaVersion: 1,
    mode: normalized,
    rawMode: raw,
    webOpenable,
    multiUser: normalized === "shared",
    roomAuthority:
      normalized === "shared"
        ? "cloud-sequencer"
        : normalized === "synced" && syncReadiness.ready
          ? "local-with-cloud-mirror"
          : "local",
    cloudProjectRoom: normalized === "shared" ? "sequencer" : "disabled",
    syncReadiness,
    actions,
    syncPolicy: projectSyncPolicy(normalized, syncReadiness),
    localAgentRuntime: {
      requiredForLocalActions: true,
      availability: "owner-machine-online",
    },
    tracePolicy: projectTracePolicy(),
  };
}

function projectSyncPolicy(
  mode: ProjectCollaborationMode,
  syncReadiness: ProjectSyncReadiness,
): ProjectStatusSyncPolicy {
  return {
    schemaVersion: 1,
    cloudAdmission: projectSyncCloudAdmission(mode, syncReadiness),
    mirror: {
      canvas: {
        requirement: "canvas",
        source: "loro-canvas-replica",
        conflictPolicy: "loro-crdt",
      },
      room: {
        requirement: "room",
        source: "sqlite-room-messages",
        conflictPolicy: "same-message-id-same-normalized-content-idempotent-conflict-otherwise",
        rawAgentTrace: false,
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
  };
}

function projectSyncCloudAdmission(
  mode: ProjectCollaborationMode,
  syncReadiness: ProjectSyncReadiness,
): ProjectStatusSyncCloudAdmission {
  if (mode === "shared") return "cloud-sequencer";
  if (mode === "synced") {
    return syncReadiness.ready
      ? "ready-local-with-cloud-mirror"
      : "blocked-until-requirements-ready";
  }
  if (mode === "local-only") return "disabled-until-enable-sync";
  return "unknown-until-sync-mode-known";
}

const CLOUD_SYNC_REQUIREMENTS = ["canvas", "room", "asset-metadata", "revision-content"];

function projectSyncReadiness(
  mode: ProjectCollaborationMode,
  sync: Record<string, unknown> | undefined,
): ProjectSyncReadiness {
  if (mode === "shared") {
    return {
      status: "ready",
      ready: true,
      required: CLOUD_SYNC_REQUIREMENTS,
      missing: [],
    };
  }
  if (mode !== "synced") {
    return {
      status: "disabled",
      ready: false,
      required: CLOUD_SYNC_REQUIREMENTS,
      missing: CLOUD_SYNC_REQUIREMENTS,
    };
  }

  const capabilities = sync && typeof sync.capabilities === "object" && sync.capabilities !== null
    ? sync.capabilities as Record<string, unknown>
    : {};
  const missing = CLOUD_SYNC_REQUIREMENTS.filter((requirement) =>
    !syncCapabilityReady(capabilities, requirement)
  );
  return {
    status: missing.length === 0 ? "ready" : "pending",
    ready: missing.length === 0,
    required: CLOUD_SYNC_REQUIREMENTS,
    missing,
  };
}

function syncCapabilityReady(capabilities: Record<string, unknown>, requirement: string): boolean {
  if (capabilities[requirement] === true) return true;
  if (requirement === "asset-metadata") {
    return capabilities.assetMetadata === true || capabilities.asset_metadata === true;
  }
  if (requirement === "revision-content") {
    return capabilities.revisionContent === true || capabilities.revision_content === true;
  }
  return false;
}

function projectActionGates(
  mode: ProjectCollaborationMode,
  syncReadiness: ProjectSyncReadiness,
  webOpenable: boolean,
): ProjectStatusActionGates {
  const localAgent = allowedGate(["owner-machine-online"]);
  if (mode === "shared") {
    return {
      openInWeb: allowedGate(),
      enableSync: deniedGate("already-cloud-connected"),
      shareProject: allowedGate(),
      runLocalAgent: localAgent,
    };
  }
  if (mode === "synced") {
    const syncRequirements = syncReadiness.ready ? [] : syncReadiness.missing;
    const cloudReadyGate = webOpenable
      ? allowedGate()
      : deniedGate("cloud-sync-not-ready", syncRequirements);
    return {
      openInWeb: cloudReadyGate,
      enableSync: deniedGate("already-cloud-connected"),
      shareProject: syncReadiness.ready
        ? allowedGate()
        : deniedGate("cloud-sync-not-ready", syncRequirements),
      runLocalAgent: localAgent,
    };
  }
  if (mode === "local-only") {
    return {
      openInWeb: deniedGate("project-is-local-only", ["enable-sync"]),
      enableSync: allowedGate(),
      shareProject: deniedGate("project-is-local-only", ["enable-sync"]),
      runLocalAgent: localAgent,
    };
  }
  return {
    openInWeb: deniedGate("sync-mode-unknown", ["sync-mode"]),
    enableSync: allowedGate(),
    shareProject: deniedGate("sync-mode-unknown", ["sync-mode"]),
    runLocalAgent: localAgent,
  };
}

function allowedGate(requirements: string[] = []): ProjectStatusActionGate {
  return {
    allowed: true,
    reason: null,
    requirements,
  };
}

function deniedGate(
  reason: ProjectStatusActionGateReason,
  requirements: string[] = [],
): ProjectStatusActionGate {
  return {
    allowed: false,
    reason,
    requirements,
  };
}

function projectTracePolicy(): ProjectStatusTracePolicy {
  return {
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
  };
}

function joinPath(...segments: string[]): string {
  const [first = "", ...rest] = segments;
  const prefix = first.startsWith("/") ? "/" : "";
  const parts = [first, ...rest]
    .flatMap((segment) => segment.split("/"))
    .filter((segment) => segment.length > 0);
  return `${prefix}${parts.join("/")}`;
}

function projectMarkerRoot(markerPath: string): string | undefined {
  const projectDotDir = dirnamePath(markerPath);
  if (!projectDotDir) return undefined;
  return dirnamePath(projectDotDir);
}

function dirnamePath(path: string): string | undefined {
  const normalized = normalizePath(path);
  if (!normalized || normalized === "/") return normalized || undefined;
  const index = normalized.lastIndexOf("/");
  if (index < 0) return undefined;
  if (index === 0) return "/";
  return normalized.slice(0, index);
}

function normalizePath(path: string): string {
  const prefix = path.startsWith("/") ? "/" : "";
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0) {
        parts.pop();
        continue;
      }
      if (!prefix) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  return `${prefix}${parts.join("/")}` || ".";
}

function isSameOrInsidePath(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedRoot = normalizePath(root);
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot.replace(/\/+$/, "")}/`);
}

function markerString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stableWorkspaceHash(input: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    const codePoint = input.codePointAt(index) ?? 0;
    hash ^= BigInt(codePoint);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    if (codePoint > 0xffff) index += 1;
  }
  return hash.toString(16).padStart(16, "0");
}

function normalizeCollaborationMode(raw: string): ProjectCollaborationMode {
  if (raw === "local" || raw === "local-only") return "local-only";
  if (raw === "synced" || raw === "cloud-sync") return "synced";
  if (raw === "shared") return "shared";
  return "unknown";
}
