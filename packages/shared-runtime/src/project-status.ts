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

function normalizeCollaborationMode(raw: string): ProjectCollaborationMode {
  if (raw === "local" || raw === "local-only") return "local-only";
  if (raw === "synced" || raw === "cloud-sync") return "synced";
  if (raw === "shared") return "shared";
  return "unknown";
}
