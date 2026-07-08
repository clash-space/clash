export type ProjectStatusSource = "explicit" | "marker" | "env";

export interface ProjectStatusContext {
  projectId: string;
  source: ProjectStatusSource;
  markerPath?: string;
}

export interface ProjectStatusMarker {
  sync?: Record<string, unknown>;
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
  localAgentRuntime: {
    requiredForLocalActions: true;
    availability: "owner-machine-online";
  };
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

export function buildProjectStatus(
  context: ProjectStatusContext,
  options: {
    marker?: ProjectStatusMarker | null;
    clashRoot: string;
    localApiDataDir?: string;
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
  const textRevisionBlobRoot = joinPath(localApiDataDir, "text-revision-blobs");
  const timelineRevisionBlobRoot = joinPath(localApiDataDir, "timeline-revision-blobs");
  const loroReplicaRoot = joinPath(localApiProjectRoot, "loro");
  const loroSnapshotPath = joinPath(loroReplicaRoot, "snapshot.bin");
  const loroUpdatesLogPath = joinPath(loroReplicaRoot, "updates.log");
  const editablePaths = [
    drafts,
    projections,
    sessions,
    assetLinks,
  ];
  const protectedPaths = [
    localApiDataDir,
    localSqlitePath,
    legacyDbJsonPath,
    loroReplicaRoot,
    loroSnapshotPath,
    loroUpdatesLogPath,
    textRevisionBlobRoot,
    timelineRevisionBlobRoot,
    runtimeRoot,
  ];

  return {
    projectId: context.projectId,
    source: context.source,
    ...(context.markerPath ? { markerPath: context.markerPath } : {}),
    mode,
    syncMode: mode,
    clashHome: clashRoot,
    projectStore: projectWorkspaceRoot,
    projectWorkspaceRoot,
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
    },
  };
}

export function projectIdPathSegment(id: string): string {
  const encoded = encodeURIComponent(id).replace(/\./g, "%2E");
  return encoded || "_default";
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
    localAgentRuntime: {
      requiredForLocalActions: true,
      availability: "owner-machine-online",
    },
  };
}

const CLOUD_SYNC_REQUIREMENTS = ["canvas", "room", "asset-metadata"];

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

function joinPath(...segments: string[]): string {
  const [first = "", ...rest] = segments;
  const prefix = first.startsWith("/") ? "/" : "";
  const parts = [first, ...rest]
    .flatMap((segment) => segment.split("/"))
    .filter((segment) => segment.length > 0);
  return `${prefix}${parts.join("/")}`;
}

function normalizeCollaborationMode(raw: string): ProjectCollaborationMode {
  if (raw === "local" || raw === "local-only") return "local-only";
  if (raw === "synced" || raw === "cloud-sync") return "synced";
  if (raw === "shared") return "shared";
  return "unknown";
}
