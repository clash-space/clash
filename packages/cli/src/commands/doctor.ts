import { Command } from "commander";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { createRequire } from "node:module";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  buildProjectRecoveryPolicy,
  type ProjectRecoveryPolicy,
} from "@clash/shared-runtime";
import { timelineDslFromYaml, timelineDslHash } from "@clash/shared-types";
import { isJsonMode, printJson } from "../lib/output";
import {
  resolveProjectStatus,
  type ProjectStatus,
} from "./projects";
import {
  projectMarkerPath,
  writeProjectMarker,
  type ProjectMarker,
} from "../lib/project-context";

const require = createRequire(process.execPath);

type SqliteStatement = {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
};

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
};

export type StorageDoctorLevel = "ok" | "warning" | "error";

export interface StorageDoctorCheck {
  id: string;
  level: StorageDoctorLevel;
  message: string;
  path?: string;
}

export interface StorageDoctorReport {
  ok: boolean;
  projectId?: string;
  status?: ProjectStatus;
  checks: StorageDoctorCheck[];
  repaired?: boolean;
  repairs?: StorageDoctorRepair[];
}

export interface StorageDoctorRepair {
  id: string;
  message: string;
  path?: string;
  sourcePath?: string;
}

export interface FileCompareEvidence {
  path: string;
  exists: boolean;
  size?: number;
  sha256?: string;
}

export interface SecondaryCanvasRecoveryCompareFile {
  kind: "snapshot" | "updates-log";
  sourcePath: string;
  destinationPath: string;
  quarantined: FileCompareEvidence;
  canonical: FileCompareEvidence;
  sameBytes: boolean;
}

export type SecondaryCanvasRecoveryPolicy = ProjectRecoveryPolicy;

export interface SecondaryCanvasRecoveryCompareReport {
  schemaVersion: 1;
  status: "compared";
  projectId: string;
  manifestPath: string;
  canonicalReplica: SecondaryCanvasReplicaManifest["canonicalReplica"];
  safeToImportAutomatically: false;
  recoveryPolicy: SecondaryCanvasRecoveryPolicy;
  readToken: string;
  files: SecondaryCanvasRecoveryCompareFile[];
}

export interface SecondaryCanvasRecoveryRestoreFile {
  kind: "snapshot" | "updates-log";
  sourcePath: string;
  destinationPath: string;
  canonicalPath: string;
  quarantined: FileCompareEvidence;
  canonicalBefore: FileCompareEvidence;
  canonicalAfter: FileCompareEvidence;
  sameBytesBefore: boolean;
  restored: boolean;
  backupPath?: string;
}

export interface SecondaryCanvasRecoveryRestoreReport {
  schemaVersion: 1;
  status: "restored";
  projectId: string;
  manifestPath: string;
  canonicalReplica: SecondaryCanvasReplicaManifest["canonicalReplica"];
  safeToImportAutomatically: false;
  recoveryPolicy: SecondaryCanvasRecoveryPolicy;
  expectedReadToken: string;
  beforeReadToken: string;
  afterReadToken: string;
  backupsRoot: string;
  receiptPath: string;
  files: SecondaryCanvasRecoveryRestoreFile[];
}

export interface SecondaryCanvasRecoveryRestoreReceiptSummary {
  receiptPath: string;
  createdAt: string;
  status: "restored";
  projectId: string;
  manifestPath: string;
  expectedReadToken: string;
  beforeReadToken: string;
  afterReadToken: string;
  fileCount: number;
}

export interface SecondaryCanvasRecoveryInventorySet {
  manifestPath: string;
  createdAt: string;
  canonicalReplica: SecondaryCanvasReplicaManifest["canonicalReplica"];
  fileCount: number;
  files: SecondaryCanvasReplicaManifest["files"];
  restoreReceipts: SecondaryCanvasRecoveryRestoreReceiptSummary[];
}

export interface SecondaryCanvasRecoveryInvalidEntry {
  path: string;
  error: string;
}

export interface SecondaryCanvasRecoveryListReport {
  schemaVersion: 1;
  status: "listed";
  projectId: string;
  recoveryRoot: string;
  safeToImportAutomatically: false;
  recoveryPolicy: SecondaryCanvasRecoveryPolicy;
  sets: SecondaryCanvasRecoveryInventorySet[];
  invalidEntries: SecondaryCanvasRecoveryInvalidEntry[];
}

export async function runStorageDoctor(options: {
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  repair?: boolean;
} = {}): Promise<StorageDoctorReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const checks: StorageDoctorCheck[] = [];
  const repairs: StorageDoctorRepair[] = [];
  let status: ProjectStatus;

  try {
    status = await resolveProjectStatus(options);
    checks.push({
      id: "project-context",
      level: "ok",
      message: `Resolved project ${status.projectId} from ${status.source}.`,
    });
  } catch (error) {
    const legacyMarkerPath = await findLegacyProjectJsonMarker(cwd);
    if (options.repair === true && legacyMarkerPath) {
      try {
        const repair = await repairLegacyProjectMarker(legacyMarkerPath);
        repairs.push(repair);
        status = await resolveProjectStatus(options);
        checks.push({
          id: "project-context",
          level: "ok",
          message: `Resolved project ${status.projectId} from ${status.source}.`,
        });
      } catch (repairError) {
        checks.push({
          id: "project-context",
          level: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        checks.push(legacyProjectMarkerCheck(legacyMarkerPath));
        checks.push({
          id: "legacy-project-marker-repair",
          level: "error",
          message: repairError instanceof Error ? repairError.message : String(repairError),
          path: legacyMarkerPath,
        });
        return {
          ok: false,
          checks,
          repaired: repairs.length > 0,
          repairs,
        };
      }
    } else {
      checks.push({
        id: "project-context",
        level: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      if (legacyMarkerPath) {
        checks.push(legacyProjectMarkerCheck(legacyMarkerPath));
      }
      return { ok: false, checks };
    }
  }

  if (status.markerPath) {
    const markerExists = await pathExists(status.markerPath, "file");
    checks.push({
      id: "project-marker",
      level: markerExists ? "ok" : "error",
      message: markerExists
        ? "Project marker exists."
        : "Resolved project marker is missing.",
      path: status.markerPath,
    });
  } else {
    checks.push({
      id: "project-marker",
      level: "warning",
      message: "No project marker was used; project was selected explicitly or from CLASH_PROJECT_ID.",
    });
  }
  const legacyMarkerPath = await findLegacyProjectJsonMarker(cwd);
  if (legacyMarkerPath) {
    checks.push(legacyProjectMarkerCheck(legacyMarkerPath));
  }

  const overlap = firstEditableProtectedOverlap(status);
  checks.push(overlap
    ? {
        id: "editable-protected-separation",
        level: "error",
        message: `Editable path is inside a protected path: ${overlap.editable}`,
        path: overlap.protectedPath,
      }
    : {
        id: "editable-protected-separation",
        level: "ok",
        message: "Editable roots are separate from protected roots.",
      });

  const cwdProtected = status.protectedPaths.find((path) => isSameOrInside(cwd, path));
  checks.push(cwdProtected
    ? {
        id: "cwd-protected",
        level: "error",
        message: "Current working directory is inside a protected Clash storage path.",
        path: cwdProtected,
      }
    : {
        id: "cwd-protected",
        level: "ok",
        message: "Current working directory is not inside a protected Clash storage path.",
      });
  checks.push(...inspectStorageContract(status));

  if (options.repair === true) {
    repairs.push(...await repairProjectWorkspace(status));
    repairs.push(...await repairSecondaryCanvasReplicas(status, cwd));
    repairs.push(...await repairLocalSqliteSchema(status.localSqlitePath));
    repairs.push(...await repairRevisionBlobPermissions(status));
    checks.push({
      id: "storage-repair",
      level: "ok",
      message: repairs.length > 0
        ? `Applied ${repairs.length} storage repair action(s).`
        : "No repairable storage issues were found.",
    });
  }
  checks.push(await inspectTextRevisionBlobIntegrity(status));
  checks.push(await inspectTimelineRevisionBlobIntegrity(status));
  checks.push(await inspectSecondaryCanvasReplica(status, cwd));
  checks.push(await inspectSecondaryCanvasRecovery(status));

  await pushPathCheck(checks, {
    id: "project-workspace",
    path: status.projectWorkspaceRoot,
    kind: "directory",
    missingLevel: "warning",
    existsMessage: "Project workspace root exists.",
    missingMessage: "Project workspace root does not exist yet.",
  });

  await pushPathCheck(checks, {
    id: "editable-drafts-root",
    path: status.roots.drafts,
    kind: "directory",
    missingLevel: "warning",
    existsMessage: "Editable drafts root exists.",
    missingMessage: "Editable drafts root is missing; create or repair the project workspace before asking agents to write drafts.",
  });

  await pushPathCheck(checks, {
    id: "editable-projections-root",
    path: status.roots.projections,
    kind: "directory",
    missingLevel: "warning",
    existsMessage: "Editable projections root exists.",
    missingMessage: "Editable projections root is missing; text and timeline file projections are not ready for agent edits.",
  });

  await pushPathCheck(checks, {
    id: "editable-timelines-root",
    path: status.roots.timelines,
    kind: "directory",
    missingLevel: "warning",
    existsMessage: "Editable timeline view root exists.",
    missingMessage: "Editable timeline view root is missing; clash timeline pull defaults are not ready for agent edits.",
  });

  await pushPathCheck(checks, {
    id: "editable-sessions-root",
    path: status.roots.sessions,
    kind: "directory",
    missingLevel: "warning",
    existsMessage: "Editable sessions root exists.",
    missingMessage: "Editable sessions root is missing; agent-readable session artifacts are not ready.",
  });

  await pushPathCheck(checks, {
    id: "editable-asset-links-root",
    path: status.roots.assetLinks,
    kind: "directory",
    missingLevel: "warning",
    existsMessage: "Editable asset links root exists.",
    missingMessage: "Editable asset links root is missing; asset path projections are not ready.",
  });
  checks.push(await inspectAssetLinksRoot(status.roots.assetLinks));

  await pushPathCheck(checks, {
    id: "protected-runtime-root",
    path: join(status.projectWorkspaceRoot, "runtime"),
    kind: "directory",
    missingLevel: "warning",
    existsMessage: "Protected runtime root exists.",
    missingMessage: "Protected runtime root is missing; runtime state should be created by Clash, not by direct agent writes.",
  });

  await pushPathCheck(checks, {
    id: "loro-replica",
    path: status.loro.replicaRoot,
    kind: "directory",
    missingLevel: "warning",
    existsMessage: "Loro replica directory exists.",
    missingMessage: "Loro replica directory does not exist yet; it is created after canvas sync persists state.",
  });

  await pushPathCheck(checks, {
    id: "local-sqlite",
    path: status.localSqlitePath,
    kind: "file",
    missingLevel: "warning",
    existsMessage: "Local SQLite target exists.",
    missingMessage: "Local SQLite target does not exist yet; local metadata will be initialized on first write.",
  });
  checks.push(await inspectLocalSqliteSchema(status.localSqlitePath));

  const legacyDbExists = await pathExists(status.legacyDbJsonPath, "file");
  checks.push({
    id: "legacy-db-json",
    level: legacyDbExists ? "warning" : "ok",
    message: legacyDbExists
      ? "Legacy db.json exists but is ignored by local-api; remove it after checking it does not contain secrets you still need."
      : "Legacy db.json was not found.",
    path: status.legacyDbJsonPath,
  });

  return {
    ok: !checks.some((check) => check.level === "error"),
    projectId: status.projectId,
    status,
    checks,
    ...(options.repair === true
      ? {
          repaired: repairs.length > 0,
          repairs,
        }
      : {}),
  };
}

function legacyProjectMarkerCheck(markerPath: string): StorageDoctorCheck {
  return {
    id: "legacy-project-marker",
    level: "warning",
    message: "Legacy .clash/project.json marker exists but is ignored by v1 local tooling; write .clash/project.toml with `clash init` or `clash project link`.",
    path: markerPath,
  };
}

async function repairLegacyProjectMarker(markerPath: string): Promise<StorageDoctorRepair> {
  const workspaceRoot = dirname(dirname(markerPath));
  const targetPath = projectMarkerPath(workspaceRoot);
  if (await pathExists(targetPath, "file")) {
    throw new Error(`Refusing to overwrite existing v1 project marker at ${targetPath}`);
  }
  const marker = await readLegacyProjectJsonMarker(markerPath);
  await writeProjectMarker(workspaceRoot, marker);
  return {
    id: "legacy-project-marker-migration",
    message: "Migrated legacy .clash/project.json marker to v1 .clash/project.toml reference.",
    path: targetPath,
    sourcePath: markerPath,
  };
}

async function readLegacyProjectJsonMarker(markerPath: string): Promise<ProjectMarker> {
  const raw = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
  const projectId = typeof raw.projectId === "string" ? raw.projectId.trim() : "";
  if (!projectId) {
    throw new Error(`Legacy project marker at ${markerPath} is missing projectId`);
  }
  const workspaceId = typeof (raw.workspaceId ?? raw.workspace_id) === "string"
    ? String(raw.workspaceId ?? raw.workspace_id).trim()
    : "";
  const store = typeof raw.store === "string" ? raw.store.trim() : "";
  const sync = raw.sync && typeof raw.sync === "object" && !Array.isArray(raw.sync)
    ? raw.sync as Record<string, unknown>
    : undefined;
  return {
    schemaVersion: 1,
    projectId,
    ...(workspaceId ? { workspaceId } : {}),
    ...(store ? { store } : {}),
    ...(sync ? { sync } : {}),
  };
}

async function findLegacyProjectJsonMarker(startCwd: string): Promise<string | undefined> {
  let current = resolve(startCwd);
  while (true) {
    const candidate = join(current, ".clash", "project.json");
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function inspectStorageContract(status: ProjectStatus): StorageDoctorCheck[] {
  const storage = status.storage;
  const problems: string[] = [];

  if (!storage) {
    problems.push("missing status.storage contract");
  } else {
    if (storage.context.role !== "project-reference") {
      problems.push("context role is not project-reference");
    }
    if (storage.context.projectId !== status.projectId) {
      problems.push("context project id does not match status project id");
    }
    if (storage.workspace.role !== "agent-draft-and-projection-workspace") {
      problems.push("workspace role is not agent-draft-and-projection-workspace");
    }
    if (storage.workspace.root !== status.projectWorkspaceRoot) {
      problems.push("workspace root does not match projectWorkspaceRoot");
    }
    if (storage.workspace.ownsCanonicalSnapshot !== false) {
      problems.push("workspace owns canonical snapshot");
    }
    if (storage.workspace.ownsCanonicalMetadata !== false) {
      problems.push("workspace owns canonical metadata");
    }
    validateWorkspacePathDeclarations(problems, status, storage.workspace);
    validateViewFilesContract(problems, status, {
      label: "text view files",
      contract: storage.workspace.viewFiles?.texts,
      expectedKind: "agent-editable-projection-files",
      expectedPath: join(status.roots.projections, "text"),
      expectedPathDescription: "projections/text",
      defaultFilePattern: "<node-id>.md",
      applyCommand: "clash text apply",
    });
    validateViewFilesContract(problems, status, {
      label: "timeline view files",
      contract: storage.workspace.viewFiles?.timelines,
      expectedKind: "agent-editable-view-files",
      expectedPath: status.roots.timelines,
      expectedPathDescription: "timelines",
      defaultFile: "main.timeline.yaml",
      applyCommand: "clash timeline apply",
    });
    validateViewFilesContract(problems, status, {
      label: "timeline projection files",
      contract: storage.workspace.viewFiles?.timelineProjections,
      expectedKind: "agent-editable-projection-files",
      expectedPath: join(status.roots.projections, "timelines"),
      expectedPathDescription: "projections/timelines",
      applyCommand: "clash timeline apply",
    });
    if (storage.canonicalReplica.role !== "single-machine-project-replica") {
      problems.push("canonical replica role is not single-machine-project-replica");
    }
    if (storage.canonicalReplica.scope !== "machine") {
      problems.push("canonical replica scope is not machine");
    }
    if (storage.canonicalReplica.projectId !== status.projectId) {
      problems.push("canonical replica project id does not match status project id");
    }
    if (storage.canonicalReplica.metadata.agentWritable !== false) {
      problems.push("canonical metadata is agent-writable");
    }
    if (storage.canonicalReplica.metadata.path !== status.localSqlitePath) {
      problems.push("canonical metadata path does not match localSqlitePath");
    }
    if (storage.canonicalReplica.canvas.agentWritable !== false) {
      problems.push("canonical canvas replica is agent-writable");
    }
    if (storage.canonicalReplica.canvas.replicaRoot !== status.loro.replicaRoot) {
      problems.push("canonical canvas replica root does not match loro.replicaRoot");
    }
    if (storage.canonicalReplica.canvas.snapshotPath !== status.loro.snapshotPath) {
      problems.push("canonical canvas snapshot path does not match loro.snapshotPath");
    }
    if (storage.canonicalReplica.canvas.updatesLogPath !== status.loro.updatesLogPath) {
      problems.push("canonical canvas updates log path does not match loro.updatesLogPath");
    }
    const mediaAssets = storage.canonicalReplica.mediaAssets;
    if (!mediaAssets) {
      problems.push("missing canonical media asset blob root");
    } else {
      if (mediaAssets.kind !== "content-addressed-files") {
        problems.push("canonical media asset blob root is not content-addressed-files");
      }
      if (mediaAssets.path !== join(status.clashHome, "assets", "blobs")) {
        problems.push("canonical media asset blob path does not match Clash asset blob store");
      }
      if (mediaAssets.storageKeyPrefix !== "local-blobs/") {
        problems.push("canonical media asset blob storage key prefix is wrong");
      }
      if (mediaAssets.immutable !== true) {
        problems.push("canonical media asset blobs are not immutable");
      }
      if (mediaAssets.deduplicatedBy !== "sha256") {
        problems.push("canonical media asset blobs are not sha256-deduplicated");
      }
      if (mediaAssets.agentWritable !== false) {
        problems.push("canonical media asset blobs are agent-writable");
      }
      if (mediaAssets.referencedBy !== "sqlite-asset-rows-and-project-asset-links") {
        problems.push("canonical media asset reference model is wrong");
      }
    }
    const contentBlobs = storage.canonicalReplica.contentBlobs;
    const expectedContentBlobs = [
      {
        label: "text revision",
        store: contentBlobs?.textRevisions,
        path: join(status.localApiDataDir, "text-revision-blobs"),
        mediaType: "text/markdown",
      },
      {
        label: "timeline revision",
        store: contentBlobs?.timelineRevisions,
        path: join(status.localApiDataDir, "timeline-revision-blobs"),
        mediaType: "application/yaml",
      },
    ];
    const canonicalPaths = [
      { path: storage.canonicalReplica.metadata.path, role: "metadata" },
      { path: storage.canonicalReplica.canvas.replicaRoot, role: "canvas" },
      { path: storage.canonicalReplica.canvas.snapshotPath, role: "canvas" },
      { path: storage.canonicalReplica.canvas.updatesLogPath, role: "canvas" },
      ...(mediaAssets ? [{ path: mediaAssets.path, role: "media" }] : []),
    ];
    for (const expected of expectedContentBlobs) {
      if (!expected.store) {
        problems.push(`missing ${expected.label} content blob root`);
        continue;
      }
      if (expected.store.kind !== "content-addressed-files") {
        problems.push(`${expected.label} content blob root is not content-addressed-files`);
      }
      if (expected.store.path !== expected.path) {
        problems.push(`${expected.label} content blob path does not match local-api content store`);
      }
      if (expected.store.mediaType !== expected.mediaType) {
        problems.push(`${expected.label} content blob media type is wrong`);
      }
      if (expected.store.immutable !== true) {
        problems.push(`${expected.label} content blobs are not immutable`);
      }
      if (expected.store.agentWritable !== false) {
        problems.push(`${expected.label} content blobs are agent-writable`);
      }
      canonicalPaths.push({ path: expected.store.path, role: "content" });
    }
    for (const canonical of canonicalPaths) {
      const canonicalPath = canonical.path;
      if (!status.protectedPaths.some((protectedPath) => isSameOrInside(canonicalPath, protectedPath))) {
        problems.push(`canonical path is not protected: ${canonicalPath}`);
      }
      if (storage.workspace.editablePaths.some((editablePath) => isSameOrInside(canonicalPath, editablePath))) {
        problems.push(
          canonical.role === "content"
            ? `editable workspace includes canonical content path: ${canonicalPath}`
            : canonical.role === "media"
              ? `editable workspace includes canonical media asset path: ${canonicalPath}`
            : `editable workspace includes canonical canvas path: ${canonicalPath}`,
        );
      }
    }
    validateLocalSecretsContract(problems, status, storage.localSecrets as ProjectStatus["storage"]["localSecrets"] | undefined);
    validateContentModelContract(problems, status, storage);
  }

  return [
    problems.length > 0
      ? {
          id: "storage-role-contract",
          level: "error",
          message: `Project storage contract is unsafe: ${dedupe(problems).join("; ")}.`,
        }
      : {
          id: "storage-role-contract",
          level: "ok",
          message: "Project storage contract separates agent workspace from protected canonical replica and local secrets.",
        },
  ];
}

function validateLocalSecretsContract(
  problems: string[],
  status: ProjectStatus,
  localSecrets: ProjectStatus["storage"]["localSecrets"] | undefined,
): void {
  if (!localSecrets) {
    problems.push("missing local secret file contract");
    return;
  }
  if (localSecrets.role !== "machine-local-secret-files") {
    problems.push("local secrets role is not machine-local-secret-files");
  }
  if (localSecrets.syncDefault !== "local-only") {
    problems.push("local secrets are not local-only by default");
  }
  if (localSecrets.agentWritable !== false) {
    problems.push("local secrets are agent-writable");
  }

  const expectedFiles = [
    {
      label: "CLI config",
      file: localSecrets.files?.cliConfig,
      kind: "cli-api-key-config",
      path: join(status.clashHome, "config.json"),
    },
    {
      label: "bridge credentials",
      file: localSecrets.files?.bridgeCredentials,
      kind: "local-runtime-credentials",
      path: join(status.clashHome, "credentials.json"),
    },
  ];
  for (const expected of expectedFiles) {
    if (!expected.file) {
      problems.push(`missing ${expected.label} secret path`);
      continue;
    }
    if (expected.file.kind !== expected.kind) {
      problems.push(`${expected.label} secret kind is wrong`);
    }
    if (expected.file.path !== expected.path) {
      problems.push(`${expected.label} secret path is wrong`);
    }
    if (expected.file.agentWritable !== false) {
      problems.push(`${expected.label} secret is agent-writable`);
    }
    if (!status.protectedPaths.some((protectedPath) => isSameOrInside(expected.path, protectedPath))) {
      problems.push(`${expected.label} secret path is not protected: ${expected.path}`);
    }
    if (status.editablePaths.some((editablePath) => isSameOrInside(expected.path, editablePath))) {
      problems.push(`${expected.label} secret path is inside an agent-editable path: ${expected.path}`);
    }
  }
}

function validateContentModelContract(
  problems: string[],
  status: ProjectStatus,
  storage: ProjectStatus["storage"],
): void {
  const contentModel = storage.contentModel as ProjectStatus["storage"]["contentModel"] | undefined;
  if (!contentModel) {
    problems.push("missing content model contract");
    return;
  }
  if (contentModel.role !== "agent-projections-with-host-indexed-revision-content") {
    problems.push("content model role is not agent-projections-with-host-indexed-revision-content");
  }

  validateContentModelEntry(problems, status, {
    label: "text",
    entry: contentModel.textNodes,
    liveState: "loro-canvas-text-node-data",
    editableProjection: "storage.workspace.viewFiles.texts",
    projectionPath: storage.workspace.viewFiles?.texts?.path,
    applyCommand: "clash text apply",
    replaceCommand: "clash text replace",
    restoreCommand: "clash text restore",
    historyCommand: "clash text history",
    contentCommand: "clash text content",
    revisionRegistry: "text_revisions",
    revisionBlobPath: storage.canonicalReplica.contentBlobs?.textRevisions?.path,
    registryBlobStore: "storage.canonicalReplica.contentBlobs.textRevisions",
    mediaBlobPath: storage.canonicalReplica.mediaAssets?.path,
  });
  validateContentModelEntry(problems, status, {
    label: "timeline",
    entry: contentModel.timelines,
    liveState: "loro-canvas-video-editor-node-data",
    editableProjection: "storage.workspace.viewFiles.timelines",
    projectionPath: storage.workspace.viewFiles?.timelines?.path,
    applyCommand: "clash timeline apply",
    replaceCommand: "clash timeline replace",
    restoreCommand: "clash timeline restore",
    historyCommand: "clash timeline history",
    contentCommand: "clash timeline content",
    revisionRegistry: "timeline_revisions",
    revisionBlobPath: storage.canonicalReplica.contentBlobs?.timelineRevisions?.path,
    registryBlobStore: "storage.canonicalReplica.contentBlobs.timelineRevisions",
    mediaBlobPath: storage.canonicalReplica.mediaAssets?.path,
  });
}

function validateContentModelEntry(
  problems: string[],
  status: ProjectStatus,
  expected: {
    label: "text" | "timeline";
    entry: ProjectStatus["storage"]["contentModel"]["textNodes"] | ProjectStatus["storage"]["contentModel"]["timelines"] | undefined;
    liveState: string;
    editableProjection: string;
    projectionPath?: string;
    applyCommand: string;
    replaceCommand: string;
    restoreCommand: string;
    historyCommand: string;
    contentCommand: string;
    revisionRegistry: string;
    revisionBlobPath?: string;
    registryBlobStore: string;
    mediaBlobPath?: string;
  },
): void {
  if (!expected.entry) {
    problems.push(`missing ${expected.label} content model`);
    return;
  }
  if (expected.entry.liveState !== expected.liveState) {
    problems.push(`${expected.label} content model live state is wrong`);
  }
  if (expected.entry.editableProjection !== expected.editableProjection) {
    problems.push(`${expected.label} content model editable projection is wrong`);
  }
  if (!expected.projectionPath) {
    problems.push(`${expected.label} content model expected projection path is unavailable`);
  } else if (expected.entry.projectionPath !== expected.projectionPath) {
    problems.push(`${expected.label} content model projection path is wrong`);
  }
  if (expected.entry.applyCommand !== expected.applyCommand) {
    problems.push(`${expected.label} content model apply command is wrong`);
  }
  if (expected.entry.replaceCommand !== expected.replaceCommand) {
    problems.push(`${expected.label} content model replace command is wrong`);
  }
  if (expected.entry.restoreCommand !== expected.restoreCommand) {
    problems.push(`${expected.label} content model restore command is wrong`);
  }
  if (expected.entry.historyCommand !== expected.historyCommand) {
    problems.push(`${expected.label} content model history command is wrong`);
  }
  if (expected.entry.contentCommand !== expected.contentCommand) {
    problems.push(`${expected.label} content model content command is wrong`);
  }
  if (expected.entry.casRequired !== true) {
    problems.push(`${expected.label} content model does not require CAS`);
  }
  if (expected.entry.copyOnWriteWhenReferenced !== true) {
    problems.push(`${expected.label} content model does not require copy-on-write for references`);
  }
  if (expected.entry.revisionRegistry !== expected.revisionRegistry) {
    problems.push(`${expected.label} content model revision registry is wrong`);
  }
  const contentRegistry = expected.entry.contentRegistry;
  if (!contentRegistry) {
    problems.push(`${expected.label} content model registry is missing`);
  } else {
    if (contentRegistry.kind !== "sqlite-non-media-revision-registry") {
      problems.push(`${expected.label} content model registry kind is wrong`);
    }
    if (contentRegistry.table !== expected.revisionRegistry) {
      problems.push(`${expected.label} content model registry table is wrong`);
    }
    if (contentRegistry.blobStore !== expected.registryBlobStore) {
      problems.push(`${expected.label} content model registry blob store is wrong`);
    }
    if (contentRegistry.mediaAssetTable !== false) {
      problems.push(`${expected.label} content model incorrectly uses media asset table`);
    }
  }
  if (!expected.revisionBlobPath) {
    problems.push(`${expected.label} content model expected revision blob path is unavailable`);
  } else if (expected.entry.revisionBlobPath !== expected.revisionBlobPath) {
    problems.push(`${expected.label} content model revision blob path is wrong`);
  }
  if ((expected.mediaBlobPath && expected.entry.revisionBlobPath === expected.mediaBlobPath) || expected.entry.mediaAsset !== false) {
    problems.push(`${expected.label} content model incorrectly uses media assets`);
  }
  if (expected.entry.agentWritableCanonicalState !== false) {
    problems.push(`${expected.label} content model marks canonical state agent-writable`);
  }
  if (!status.editablePaths.some((editablePath) => isSameOrInside(expected.entry!.projectionPath, editablePath))) {
    problems.push(`${expected.label} content model projection path is not agent-editable: ${expected.entry.projectionPath}`);
  }
  if (!status.protectedPaths.some((protectedPath) => isSameOrInside(expected.entry!.revisionBlobPath, protectedPath))) {
    problems.push(`${expected.label} content model revision blob path is not protected: ${expected.entry.revisionBlobPath}`);
  }
  if (status.editablePaths.some((editablePath) => isSameOrInside(expected.entry!.revisionBlobPath, editablePath))) {
    problems.push(`${expected.label} content model revision blob path is inside an agent-editable path: ${expected.entry.revisionBlobPath}`);
  }
}

function validateWorkspacePathDeclarations(
  problems: string[],
  status: ProjectStatus,
  workspace: ProjectStatus["storage"]["workspace"],
): void {
  const workspaceEditablePaths = workspace.editablePaths;
  const expectedEditablePaths = status.editablePaths;
  const workspaceProtectedPaths = workspace.protectedPaths;
  const expectedWorkspaceProtectedPaths = status.protectedPaths.filter((path) =>
    isSameOrInside(path, status.projectWorkspaceRoot),
  );

  for (const expected of expectedEditablePaths) {
    if (!workspaceEditablePaths.includes(expected)) {
      problems.push(`workspace editable paths missing declared agent path: ${expected}`);
    }
  }
  for (const editable of workspaceEditablePaths) {
    if (!expectedEditablePaths.includes(editable)) {
      problems.push(`workspace editable paths include undeclared agent path: ${editable}`);
    }
    if (!isSameOrInside(editable, status.projectWorkspaceRoot)) {
      problems.push(`workspace editable path is outside project workspace: ${editable}`);
    }
  }

  for (const expected of expectedWorkspaceProtectedPaths) {
    if (!workspaceProtectedPaths.includes(expected)) {
      problems.push(`workspace protected paths missing declared workspace path: ${expected}`);
    }
  }
  for (const protectedPath of workspaceProtectedPaths) {
    if (!expectedWorkspaceProtectedPaths.includes(protectedPath)) {
      problems.push(`workspace protected paths include undeclared workspace path: ${protectedPath}`);
    }
    if (!isSameOrInside(protectedPath, status.projectWorkspaceRoot)) {
      problems.push(`workspace protected path is outside project workspace: ${protectedPath}`);
    }
  }
}

function validateViewFilesContract(
  problems: string[],
  status: ProjectStatus,
  options: {
    label: string;
    contract: {
      kind?: unknown;
      path?: unknown;
      defaultFile?: unknown;
      defaultFilePattern?: unknown;
      applyCommand?: unknown;
      casRequired?: unknown;
      ownsCanonicalState?: unknown;
    } | undefined;
    expectedKind: string;
    expectedPath: string;
    expectedPathDescription: string;
    defaultFile?: string;
    defaultFilePattern?: string;
    applyCommand: string;
  },
): void {
  const contract = options.contract;
  if (!contract) {
    problems.push(`missing ${options.label} contract`);
    return;
  }
  if (contract.kind !== options.expectedKind) {
    problems.push(`${options.label} are not ${options.expectedKind}`);
  }
  if (contract.path !== options.expectedPath) {
    problems.push(`${options.label} path does not match ${options.expectedPathDescription}`);
  }
  if (options.defaultFile !== undefined && contract.defaultFile !== options.defaultFile) {
    problems.push(`${options.label} default file is wrong`);
  }
  if (options.defaultFilePattern !== undefined && contract.defaultFilePattern !== options.defaultFilePattern) {
    problems.push(`${options.label} default pattern is wrong`);
  }
  if (contract.applyCommand !== options.applyCommand) {
    problems.push(`${options.label} apply command is wrong`);
  }
  if (contract.casRequired !== true) {
    problems.push(`${options.label} do not require CAS`);
  }
  if (contract.ownsCanonicalState !== false) {
    problems.push(`${options.label} claim to own canonical state`);
  }
  if (
    typeof contract.path === "string" &&
    status.protectedPaths.some((protectedPath) => isSameOrInside(contract.path as string, protectedPath))
  ) {
    problems.push(`${options.label} point at protected canonical state`);
  }
}

function firstEditableProtectedOverlap(status: ProjectStatus): {
  editable: string;
  protectedPath: string;
} | null {
  for (const editable of status.editablePaths) {
    for (const protectedPath of status.protectedPaths) {
      if (isSameOrInside(editable, protectedPath)) {
        return { editable, protectedPath };
      }
    }
  }
  return null;
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function inspectSecondaryCanvasReplica(
  status: ProjectStatus,
  cwd: string,
): Promise<StorageDoctorCheck> {
  const paths = await findSecondaryCanvasReplicaPaths(status, cwd);
  if (paths.length > 0) {
    const sample = paths.slice(0, 8).join(", ");
    const suffix = paths.length > 8 ? `, and ${paths.length - 8} more` : "";
    return {
      id: "secondary-canvas-replica",
      level: "error",
      message:
        `Found second canvas replica files outside the canonical Loro replica: ${sample}${suffix}. ` +
        "Do not treat cwd snapshots as project truth; recover through Clash host tools.",
      path: paths[0],
    };
  }

  return {
    id: "secondary-canvas-replica",
    level: "ok",
    message: "No secondary canvas replica files were found in the cwd or project workspace.",
  };
}

async function findSecondaryCanvasReplicaPaths(status: ProjectStatus, cwd: string): Promise<string[]> {
  const found = new Set<string>();
  const roots = dedupe([cwd, status.projectWorkspaceRoot]);
  const commonReplicaFiles = [
    join("loro", "snapshot.bin"),
    join("loro", "updates.log"),
    "snapshot.bin",
    "updates.log",
    join(".clash", "loro", "snapshot.bin"),
    join(".clash", "loro", "updates.log"),
  ];

  for (const root of roots) {
    for (const relativePath of commonReplicaFiles) {
      const candidate = join(root, relativePath);
      if (!isCanonicalCanvasPath(status, candidate) && await pathExists(candidate, "file")) {
        found.add(candidate);
      }
    }
  }

  await collectCanvasReplicaFiles(status.projectWorkspaceRoot, status, found, 4);
  return Array.from(found);
}

type RevisionBlobIntegrityOptions = {
  id: string;
  label: string;
  root: string;
  extension: string;
  expectedHashFromName(fileName: string): string | null;
  contentHash(content: string): Promise<string>;
};

function textRevisionBlobIntegrityOptions(status: ProjectStatus): RevisionBlobIntegrityOptions {
  return {
    id: "text-revision-blob-integrity",
    label: "Text revision content blobs",
    root: status.storage.canonicalReplica.contentBlobs.textRevisions.path,
    extension: ".md",
    expectedHashFromName(fileName) {
      const match = /^([a-f0-9]{16})\.md$/.exec(fileName);
      return match?.[1] ?? null;
    },
    async contentHash(content) {
      return createHash("sha256").update(content).digest("hex").slice(0, 16);
    },
  };
}

function timelineRevisionBlobIntegrityOptions(status: ProjectStatus): RevisionBlobIntegrityOptions {
  return {
    id: "timeline-revision-blob-integrity",
    label: "Timeline revision content blobs",
    root: status.storage.canonicalReplica.contentBlobs.timelineRevisions.path,
    extension: ".timeline.yaml",
    expectedHashFromName(fileName) {
      const match = /^([a-f0-9]{16})\.timeline\.yaml$/.exec(fileName);
      return match?.[1] ?? null;
    },
    async contentHash(content) {
      const parsed = timelineDslFromYaml(content);
      if (!parsed.ok) {
        throw new Error(`invalid timeline YAML: ${parsed.error}`);
      }
      return timelineDslHash(parsed.dsl);
    },
  };
}

async function inspectTextRevisionBlobIntegrity(status: ProjectStatus): Promise<StorageDoctorCheck> {
  return inspectRevisionBlobIntegrity(textRevisionBlobIntegrityOptions(status));
}

async function inspectTimelineRevisionBlobIntegrity(status: ProjectStatus): Promise<StorageDoctorCheck> {
  return inspectRevisionBlobIntegrity(timelineRevisionBlobIntegrityOptions(status));
}

async function repairRevisionBlobPermissions(status: ProjectStatus): Promise<StorageDoctorRepair[]> {
  const repairs: StorageDoctorRepair[] = [];
  for (const options of [
    textRevisionBlobIntegrityOptions(status),
    timelineRevisionBlobIntegrityOptions(status),
  ]) {
    repairs.push(...await repairRevisionBlobPermissionsFor(options));
  }
  return repairs;
}

async function repairRevisionBlobPermissionsFor(options: RevisionBlobIntegrityOptions): Promise<StorageDoctorRepair[]> {
  const entries = await collectRevisionBlobFiles(options.root, options.extension);
  if (entries === null) return [];

  const repairs: StorageDoctorRepair[] = [];
  for (const filePath of entries) {
    const fileName = basename(filePath);
    const expectedHash = options.expectedHashFromName(fileName);
    if (!expectedHash) continue;

    const info = await lstat(filePath);
    if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o222) === 0) continue;

    let actualHash: string;
    try {
      actualHash = await options.contentHash(await readFile(filePath, "utf8"));
    } catch {
      continue;
    }
    if (actualHash !== expectedHash) continue;

    const readOnlyMode = (info.mode & 0o777) & ~0o222;
    await chmod(filePath, readOnlyMode);
    repairs.push({
      id: "revision-blob-permissions",
      message: `Made ${options.label.toLowerCase()} file read-only after validating its content hash.`,
      path: filePath,
    });
  }
  return repairs;
}

async function inspectRevisionBlobIntegrity(options: RevisionBlobIntegrityOptions): Promise<StorageDoctorCheck> {
  const entries = await collectRevisionBlobFiles(options.root, options.extension);
  if (entries === null) {
    return {
      id: options.id,
      level: "ok",
      message: `${options.label} root does not exist yet.`,
      path: options.root,
    };
  }

  const problems: string[] = [];
  let firstProblemPath: string | undefined;
  for (const filePath of entries) {
    const fileName = basename(filePath);
    const expectedHash = options.expectedHashFromName(fileName);
    const fileProblems: string[] = [];
    const info = await lstat(filePath);
    if (info.isSymbolicLink()) {
      fileProblems.push("symlink is not allowed");
    } else if (!info.isFile()) {
      fileProblems.push("not a file");
    } else {
      if ((info.mode & 0o222) !== 0) {
        fileProblems.push(`writable mode ${(info.mode & 0o777).toString(8).padStart(3, "0")}`);
      }
      if (!expectedHash) {
        fileProblems.push("invalid content hash filename");
      } else {
        try {
          const actualHash = await options.contentHash(await readFile(filePath, "utf8"));
          if (actualHash !== expectedHash) {
            fileProblems.push(`hash mismatch expected ${expectedHash} actual ${actualHash}`);
          }
        } catch (error) {
          fileProblems.push(errorMessage(error));
        }
      }
    }
    if (fileProblems.length > 0) {
      firstProblemPath ??= filePath;
      problems.push(`${filePath} (${fileProblems.join("; ")})`);
    }
  }

  if (problems.length > 0) {
    const sample = problems.slice(0, 4).join(", ");
    const suffix = problems.length > 4 ? `, and ${problems.length - 4} more` : "";
    return {
      id: options.id,
      level: "error",
      message: `${options.label} failed immutable content checks: ${sample}${suffix}.`,
      path: firstProblemPath,
    };
  }

  return {
    id: options.id,
    level: "ok",
    message: entries.length === 0
      ? `${options.label} root is empty.`
      : `${options.label} are content-addressed and read-only.`,
    path: options.root,
  };
}

async function collectRevisionBlobFiles(
  root: string,
  extension: string,
): Promise<string[] | null> {
  const files: string[] = [];

  async function visit(directory: string, depth: number): Promise<void> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && depth === 0) return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < 2) await visit(entryPath, depth + 1);
        continue;
      }
      if (entry.name.endsWith(extension)) {
        files.push(entryPath);
      }
    }
  }

  if (!(await pathExists(root, "directory"))) return null;
  await visit(root, 0);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

async function collectCanvasReplicaFiles(
  root: string,
  status: ProjectStatus,
  found: Set<string>,
  maxDepth: number,
  depth = 0,
): Promise<void> {
  if (depth > maxDepth) return;
  if (isCanonicalCanvasPath(status, root)) return;
  if (isSameOrInside(root, status.roots.runtime)) return;

  let entries: Dirent<string>[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (isCanonicalCanvasPath(status, entryPath)) continue;
    if (entry.isDirectory()) {
      if ([".git", "node_modules", "dist", "build", ".next", ".tmp"].includes(entry.name)) continue;
      await collectCanvasReplicaFiles(entryPath, status, found, maxDepth, depth + 1);
      continue;
    }
    if (entry.isFile() && (entry.name === "snapshot.bin" || entry.name === "updates.log")) {
      found.add(entryPath);
    }
  }
}

function isCanonicalCanvasPath(status: ProjectStatus, targetPath: string): boolean {
  return isSameOrInside(targetPath, status.loro.replicaRoot);
}

interface SecondaryCanvasReplicaManifest {
  schemaVersion: 1;
  projectId: string;
  createdAt: string;
  canonicalReplica: {
    replicaRoot: string;
    snapshotPath: string;
    updatesLogPath: string;
  };
  files: Array<{
    kind: "snapshot" | "updates-log";
    sourcePath: string;
    destinationPath: string;
  }>;
}

export async function compareSecondaryCanvasRecovery(options: {
  manifestPath: string;
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
}): Promise<SecondaryCanvasRecoveryCompareReport> {
  const status = await resolveProjectStatus(options);
  const recoveryRoot = join(status.roots.runtime, "recovery", "secondary-canvas-replicas");
  const manifestPath = resolve(options.manifestPath);
  if (basename(manifestPath) !== "manifest.json" || !isSameOrInside(manifestPath, recoveryRoot)) {
    throw new Error(`Secondary canvas recovery manifest is outside current project recovery root: ${manifestPath}`);
  }
  await assertRegularFile(
    manifestPath,
    `Secondary canvas recovery manifest must be a regular file inside current project recovery root: ${manifestPath}`,
  );
  if (!(await realPathIsSameOrInside(manifestPath, recoveryRoot))) {
    throw new Error(`Secondary canvas recovery manifest is outside current project recovery root: ${manifestPath}`);
  }

  const manifest = parseSecondaryCanvasReplicaManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
    manifestPath,
  );
  if (manifest.projectId !== status.projectId) {
    throw new Error(
      `Secondary canvas recovery manifest project ${manifest.projectId} does not match current project ${status.projectId}`,
    );
  }

  const canonicalReplica = {
    replicaRoot: status.loro.replicaRoot,
    snapshotPath: status.loro.snapshotPath,
    updatesLogPath: status.loro.updatesLogPath,
  };
  if (
    resolve(manifest.canonicalReplica.replicaRoot) !== resolve(canonicalReplica.replicaRoot) ||
    resolve(manifest.canonicalReplica.snapshotPath) !== resolve(canonicalReplica.snapshotPath) ||
    resolve(manifest.canonicalReplica.updatesLogPath) !== resolve(canonicalReplica.updatesLogPath)
  ) {
    throw new Error(
      `Secondary canvas recovery manifest canonical replica does not match current project ${status.projectId}`,
    );
  }

  const recoverySetRoot = dirname(manifestPath);
  const files: SecondaryCanvasRecoveryCompareFile[] = [];
  for (const file of manifest.files) {
    const destinationPath = resolve(file.destinationPath);
    if (!isSameOrInside(destinationPath, recoverySetRoot)) {
      throw new Error(`Secondary canvas recovery file destination is outside recovery set root: ${destinationPath}`);
    }
    await assertRegularFileIfPresent(
      destinationPath,
      `Secondary canvas recovery file destination must be a regular file inside recovery set root: ${destinationPath}`,
    );
    if (!(await realPathIsSameOrInsideIfPresent(destinationPath, recoverySetRoot))) {
      throw new Error(`Secondary canvas recovery file destination is outside recovery set root: ${destinationPath}`);
    }
    const canonicalPath = file.kind === "snapshot" ? canonicalReplica.snapshotPath : canonicalReplica.updatesLogPath;
    const quarantined = await readFileCompareEvidence(destinationPath);
    const canonical = await readFileCompareEvidence(canonicalPath);
    files.push({
      kind: file.kind,
      sourcePath: file.sourcePath,
      destinationPath,
      quarantined,
      canonical,
      sameBytes: quarantined.exists && canonical.exists && quarantined.sha256 === canonical.sha256,
    });
  }

  const reportWithoutToken = {
    schemaVersion: 1,
    status: "compared",
    projectId: status.projectId,
    manifestPath,
    canonicalReplica,
    safeToImportAutomatically: false,
    recoveryPolicy: secondaryCanvasRecoveryPolicy(status),
    files,
  } satisfies Omit<SecondaryCanvasRecoveryCompareReport, "readToken">;

  return {
    ...reportWithoutToken,
    readToken: secondaryCanvasRecoveryReadToken(reportWithoutToken),
  };
}

export async function restoreSecondaryCanvasRecovery(options: {
  manifestPath: string;
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  expectedReadToken?: string;
  confirm?: boolean;
}): Promise<SecondaryCanvasRecoveryRestoreReport> {
  if (options.confirm !== true) {
    throw new Error("Secondary canvas recovery restore requires explicit --yes confirmation.");
  }
  if (!options.expectedReadToken) {
    throw new Error("Secondary canvas recovery restore requires --if-match with the readToken from compare.");
  }

  const before = await compareSecondaryCanvasRecovery(options);
  if (before.readToken !== options.expectedReadToken) {
    throw new Error("Secondary canvas recovery read token is stale or does not match current quarantine/canonical state.");
  }
  if (!before.recoveryPolicy.localRestoreAllowed) {
    throw new Error(
      "Secondary canvas recovery restore is disabled for shared projects with cloud sequencer authority. Use cloud/shared conflict recovery instead.",
    );
  }
  if (before.files.length === 0) {
    throw new Error(`Secondary canvas recovery manifest has no files to restore: ${before.manifestPath}`);
  }

  const recoverySetRoot = dirname(resolve(options.manifestPath));
  const backupsRoot = join(recoverySetRoot, "canonical-before-restore", new Date().toISOString().replace(/[:.]/g, "-"));
  const files: SecondaryCanvasRecoveryRestoreFile[] = [];
  for (const file of before.files) {
    if (!file.quarantined.exists) {
      throw new Error(`Secondary canvas recovery file is missing and cannot be restored: ${file.destinationPath}`);
    }
    const canonicalPath = file.kind === "snapshot"
      ? before.canonicalReplica.snapshotPath
      : before.canonicalReplica.updatesLogPath;
    const backupPath = file.canonical.exists
      ? join(backupsRoot, file.kind === "snapshot" ? "snapshot.bin" : "updates.log")
      : undefined;

    await mkdir(dirname(canonicalPath), { recursive: true });
    if (backupPath) {
      await mkdir(dirname(backupPath), { recursive: true });
      await copyFile(canonicalPath, backupPath);
    }
    await copyFile(file.destinationPath, canonicalPath);

    files.push({
      kind: file.kind,
      sourcePath: file.sourcePath,
      destinationPath: file.destinationPath,
      canonicalPath,
      quarantined: file.quarantined,
      canonicalBefore: file.canonical,
      canonicalAfter: await readFileCompareEvidence(canonicalPath),
      sameBytesBefore: file.sameBytes,
      restored: true,
      ...(backupPath ? { backupPath } : {}),
    });
  }

  const after = await compareSecondaryCanvasRecovery(options);
  const receiptPath = join(backupsRoot, "restore-receipt.json");
  const report = {
    schemaVersion: 1,
    status: "restored",
    projectId: before.projectId,
    manifestPath: before.manifestPath,
    canonicalReplica: before.canonicalReplica,
    safeToImportAutomatically: false,
    recoveryPolicy: before.recoveryPolicy,
    expectedReadToken: options.expectedReadToken,
    beforeReadToken: before.readToken,
    afterReadToken: after.readToken,
    backupsRoot,
    receiptPath,
    files,
  } satisfies SecondaryCanvasRecoveryRestoreReport;
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function listSecondaryCanvasRecoveries(options: {
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
} = {}): Promise<SecondaryCanvasRecoveryListReport> {
  const status = await resolveProjectStatus(options);
  const inventory = await collectSecondaryCanvasRecoveryInventory(status);

  return {
    schemaVersion: 1,
    status: "listed",
    projectId: status.projectId,
    recoveryRoot: inventory.recoveryRoot,
    safeToImportAutomatically: false,
    recoveryPolicy: secondaryCanvasRecoveryPolicy(status),
    sets: inventory.sets,
    invalidEntries: inventory.invalidEntries,
  };
}

function secondaryCanvasRecoveryPolicy(status: ProjectStatus): SecondaryCanvasRecoveryPolicy {
  return buildProjectRecoveryPolicy(status);
}

async function collectSecondaryCanvasRecoveryInventory(status: ProjectStatus): Promise<{
  recoveryRoot: string;
  sets: SecondaryCanvasRecoveryInventorySet[];
  invalidEntries: SecondaryCanvasRecoveryInvalidEntry[];
}> {
  const recoveryRoot = join(status.roots.runtime, "recovery", "secondary-canvas-replicas");
  const sets: SecondaryCanvasRecoveryInventorySet[] = [];
  const invalidEntries: SecondaryCanvasRecoveryInvalidEntry[] = [];

  let entries: Dirent<string>[];
  try {
    entries = await readdir(recoveryRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { recoveryRoot, sets, invalidEntries };
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(recoveryRoot, entry.name, "manifest.json");
    try {
      await assertRegularFile(
        manifestPath,
        `Secondary canvas recovery manifest must be a regular file inside current project recovery root: ${manifestPath}`,
      );
      if (!(await realPathIsSameOrInside(manifestPath, recoveryRoot))) {
        throw new Error(`Secondary canvas recovery manifest is outside current project recovery root: ${manifestPath}`);
      }
      const manifest = parseSecondaryCanvasReplicaManifest(
        JSON.parse(await readFile(manifestPath, "utf8")),
        manifestPath,
      );
      if (manifest.projectId !== status.projectId) {
        invalidEntries.push({
          path: manifestPath,
          error: `Manifest project ${manifest.projectId} does not match current project ${status.projectId}`,
        });
        continue;
      }
      const recoverySetRoot = dirname(manifestPath);
      for (const file of manifest.files) {
        const destinationPath = resolve(file.destinationPath);
        if (!isSameOrInside(destinationPath, recoverySetRoot)) {
          throw new Error(`Secondary canvas recovery file destination is outside recovery set root: ${destinationPath}`);
        }
        await assertRegularFileIfPresent(
          destinationPath,
          `Secondary canvas recovery file destination must be a regular file inside recovery set root: ${destinationPath}`,
        );
        if (!(await realPathIsSameOrInsideIfPresent(destinationPath, recoverySetRoot))) {
          throw new Error(`Secondary canvas recovery file destination is outside recovery set root: ${destinationPath}`);
        }
      }
      const receiptInventory = await collectSecondaryCanvasRecoveryRestoreReceipts({
        recoverySetRoot,
        manifestPath,
        projectId: status.projectId,
      });
      invalidEntries.push(...receiptInventory.invalidEntries);
      sets.push({
        manifestPath,
        createdAt: manifest.createdAt,
        canonicalReplica: manifest.canonicalReplica,
        fileCount: manifest.files.length,
        files: manifest.files,
        restoreReceipts: receiptInventory.restoreReceipts,
      });
    } catch (error) {
      invalidEntries.push({
        path: manifestPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  sets.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.manifestPath.localeCompare(b.manifestPath));
  invalidEntries.sort((a, b) => a.path.localeCompare(b.path));

  return {
    recoveryRoot,
    sets,
    invalidEntries,
  };
}

async function collectSecondaryCanvasRecoveryRestoreReceipts(options: {
  recoverySetRoot: string;
  manifestPath: string;
  projectId: string;
}): Promise<{
  restoreReceipts: SecondaryCanvasRecoveryRestoreReceiptSummary[];
  invalidEntries: SecondaryCanvasRecoveryInvalidEntry[];
}> {
  const receiptsRoot = join(options.recoverySetRoot, "canonical-before-restore");
  const restoreReceipts: SecondaryCanvasRecoveryRestoreReceiptSummary[] = [];
  const invalidEntries: SecondaryCanvasRecoveryInvalidEntry[] = [];

  try {
    const receiptsRootInfo = await lstat(receiptsRoot);
    if (receiptsRootInfo.isSymbolicLink() && !(await realPathIsSameOrInside(receiptsRoot, options.recoverySetRoot))) {
      invalidEntries.push({
        path: receiptsRoot,
        error: `Secondary canvas recovery restore receipt root is outside recovery set root: ${receiptsRoot}`,
      });
      return { restoreReceipts, invalidEntries };
    }
    if (!receiptsRootInfo.isDirectory()) {
      invalidEntries.push({
        path: receiptsRoot,
        error: `Secondary canvas recovery restore receipt root must be a directory inside recovery set root: ${receiptsRoot}`,
      });
      return { restoreReceipts, invalidEntries };
    }
    if (!(await realPathIsSameOrInside(receiptsRoot, options.recoverySetRoot))) {
      invalidEntries.push({
        path: receiptsRoot,
        error: `Secondary canvas recovery restore receipt root is outside recovery set root: ${receiptsRoot}`,
      });
      return { restoreReceipts, invalidEntries };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { restoreReceipts, invalidEntries };
    }
    throw error;
  }

  let entries: Dirent<string>[];
  try {
    entries = await readdir(receiptsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { restoreReceipts, invalidEntries };
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const receiptPath = join(receiptsRoot, entry.name, "restore-receipt.json");
    try {
      await assertRegularFile(
        receiptPath,
        `Secondary canvas recovery restore receipt must be a regular file inside recovery set root: ${receiptPath}`,
      );
      if (!(await realPathIsSameOrInside(receiptPath, options.recoverySetRoot))) {
        throw new Error(`Secondary canvas recovery restore receipt is outside recovery set root: ${receiptPath}`);
      }
      restoreReceipts.push(parseSecondaryCanvasRecoveryRestoreReceiptSummary({
        input: JSON.parse(await readFile(receiptPath, "utf8")),
        receiptPath,
        createdAt: entry.name,
        manifestPath: options.manifestPath,
        projectId: options.projectId,
      }));
    } catch (error) {
      invalidEntries.push({
        path: receiptPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  restoreReceipts.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.receiptPath.localeCompare(b.receiptPath));
  invalidEntries.sort((a, b) => a.path.localeCompare(b.path));
  return { restoreReceipts, invalidEntries };
}

function parseSecondaryCanvasRecoveryRestoreReceiptSummary(options: {
  input: unknown;
  receiptPath: string;
  createdAt: string;
  manifestPath: string;
  projectId: string;
}): SecondaryCanvasRecoveryRestoreReceiptSummary {
  const { input, receiptPath, createdAt, manifestPath, projectId } = options;
  if (!input || typeof input !== "object") {
    throw new Error(`Invalid secondary canvas recovery restore receipt at ${receiptPath}: expected object`);
  }
  const record = input as Record<string, unknown>;
  const files = Array.isArray(record.files) ? record.files : null;
  if (
    record.schemaVersion !== 1 ||
    record.status !== "restored" ||
    typeof record.projectId !== "string" ||
    typeof record.manifestPath !== "string" ||
    typeof record.expectedReadToken !== "string" ||
    typeof record.beforeReadToken !== "string" ||
    typeof record.afterReadToken !== "string" ||
    !files
  ) {
    throw new Error(`Invalid secondary canvas recovery restore receipt at ${receiptPath}`);
  }
  if (record.projectId !== projectId) {
    throw new Error(`Secondary canvas recovery restore receipt project ${record.projectId} does not match current project ${projectId}`);
  }
  if (resolve(record.manifestPath) !== resolve(manifestPath)) {
    throw new Error(`Secondary canvas recovery restore receipt manifest ${record.manifestPath} does not match recovery manifest ${manifestPath}`);
  }
  if (typeof record.receiptPath === "string" && resolve(record.receiptPath) !== resolve(receiptPath)) {
    throw new Error(`Secondary canvas recovery restore receipt path ${record.receiptPath} does not match inventory path ${receiptPath}`);
  }

  return {
    receiptPath,
    createdAt,
    status: "restored",
    projectId: record.projectId,
    manifestPath: record.manifestPath,
    expectedReadToken: record.expectedReadToken,
    beforeReadToken: record.beforeReadToken,
    afterReadToken: record.afterReadToken,
    fileCount: files.length,
  };
}

function parseSecondaryCanvasReplicaManifest(input: unknown, manifestPath: string): SecondaryCanvasReplicaManifest {
  if (!input || typeof input !== "object") {
    throw new Error(`Invalid secondary canvas recovery manifest at ${manifestPath}: expected object`);
  }
  const record = input as Record<string, unknown>;
  const canonicalReplica = record.canonicalReplica as Record<string, unknown> | undefined;
  const files = Array.isArray(record.files) ? record.files : null;
  if (
    record.schemaVersion !== 1 ||
    typeof record.projectId !== "string" ||
    typeof record.createdAt !== "string" ||
    !canonicalReplica ||
    typeof canonicalReplica.replicaRoot !== "string" ||
    typeof canonicalReplica.snapshotPath !== "string" ||
    typeof canonicalReplica.updatesLogPath !== "string" ||
    !files
  ) {
    throw new Error(`Invalid secondary canvas recovery manifest at ${manifestPath}`);
  }

  return {
    schemaVersion: 1,
    projectId: record.projectId,
    createdAt: record.createdAt,
    canonicalReplica: {
      replicaRoot: canonicalReplica.replicaRoot,
      snapshotPath: canonicalReplica.snapshotPath,
      updatesLogPath: canonicalReplica.updatesLogPath,
    },
    files: files.map((item, index) => {
      if (!item || typeof item !== "object") {
        throw new Error(`Invalid secondary canvas recovery manifest file at index ${index}`);
      }
      const file = item as Record<string, unknown>;
      if (
        (file.kind !== "snapshot" && file.kind !== "updates-log") ||
        typeof file.sourcePath !== "string" ||
        typeof file.destinationPath !== "string"
      ) {
        throw new Error(`Invalid secondary canvas recovery manifest file at index ${index}`);
      }
      return {
        kind: file.kind,
        sourcePath: file.sourcePath,
        destinationPath: file.destinationPath,
      };
    }),
  };
}

async function assertRegularFile(filePath: string, message: string): Promise<void> {
  const info = await lstat(filePath);
  if (!info.isFile()) {
    throw new Error(message);
  }
}

async function assertRegularFileIfPresent(filePath: string, message: string): Promise<void> {
  try {
    const info = await lstat(filePath);
    if (!info.isFile()) {
      throw new Error(message);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function realPathIsSameOrInside(childPath: string, parentPath: string): Promise<boolean> {
  const [childRealPath, parentRealPath] = await Promise.all([realpath(childPath), realpath(parentPath)]);
  return isSameOrInside(childRealPath, parentRealPath);
}

async function realPathIsSameOrInsideIfPresent(childPath: string, parentPath: string): Promise<boolean> {
  try {
    return await realPathIsSameOrInside(childPath, parentPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    const [childParentRealPath, parentRealPath] = await Promise.all([realpath(dirname(childPath)), realpath(parentPath)]);
    return isSameOrInside(childParentRealPath, parentRealPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

async function readFileCompareEvidence(filePath: string): Promise<FileCompareEvidence> {
  try {
    const [info, bytes] = await Promise.all([stat(filePath), readFile(filePath)]);
    if (!info.isFile()) {
      return { path: filePath, exists: false };
    }
    return {
      path: filePath,
      exists: true,
      size: info.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: filePath, exists: false };
    }
    throw error;
  }
}

function secondaryCanvasRecoveryReadToken(
  report: Omit<SecondaryCanvasRecoveryCompareReport, "readToken">,
): string {
  const payload = {
    schemaVersion: report.schemaVersion,
    projectId: report.projectId,
    manifestPath: resolve(report.manifestPath),
    canonicalReplica: {
      replicaRoot: resolve(report.canonicalReplica.replicaRoot),
      snapshotPath: resolve(report.canonicalReplica.snapshotPath),
      updatesLogPath: resolve(report.canonicalReplica.updatesLogPath),
    },
    recoveryPolicy: report.recoveryPolicy,
    files: [...report.files]
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.destinationPath.localeCompare(b.destinationPath))
      .map((file) => ({
        kind: file.kind,
        sourcePath: file.sourcePath,
        destinationPath: resolve(file.destinationPath),
        quarantined: {
          exists: file.quarantined.exists,
          size: file.quarantined.size ?? null,
          sha256: file.quarantined.sha256 ?? null,
        },
        canonical: {
          path: resolve(file.canonical.path),
          exists: file.canonical.exists,
          size: file.canonical.size ?? null,
          sha256: file.canonical.sha256 ?? null,
        },
      })),
  };
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `secondary-canvas-recovery:${hash}`;
}

async function repairSecondaryCanvasReplicas(
  status: ProjectStatus,
  cwd: string,
): Promise<StorageDoctorRepair[]> {
  const paths = await findSecondaryCanvasReplicaPaths(status, cwd);
  if (paths.length === 0) return [];

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const quarantineRoot = join(
    status.roots.runtime,
    "recovery",
    "secondary-canvas-replicas",
    runId,
  );
  const repairs: StorageDoctorRepair[] = [];
  const manifest: SecondaryCanvasReplicaManifest = {
    schemaVersion: 1,
    projectId: status.projectId,
    createdAt: new Date().toISOString(),
    canonicalReplica: {
      replicaRoot: status.loro.replicaRoot,
      snapshotPath: status.loro.snapshotPath,
      updatesLogPath: status.loro.updatesLogPath,
    },
    files: [],
  };

  for (const [index, sourcePath] of paths.entries()) {
    const kind = sourcePath.endsWith("updates.log") ? "updates-log" : "snapshot";
    const destination = join(
      quarantineRoot,
      String(index + 1).padStart(3, "0"),
      kind === "updates-log" ? "updates.log" : "snapshot.bin",
    );
    await mkdir(dirname(destination), { recursive: true });
    await rename(sourcePath, destination);
    manifest.files.push({
      kind,
      sourcePath,
      destinationPath: destination,
    });
    repairs.push({
      id: "secondary-canvas-replica-quarantine",
      message: "Moved secondary canvas replica file into host-owned recovery quarantine.",
      sourcePath,
      path: destination,
    });
  }
  await writeFile(join(quarantineRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return repairs;
}

async function inspectSecondaryCanvasRecovery(status: ProjectStatus): Promise<StorageDoctorCheck> {
  const inventory = await collectSecondaryCanvasRecoveryInventory(status);

  if (inventory.invalidEntries.length > 0) {
    return {
      id: "secondary-canvas-recovery",
      level: "warning",
      message: `Secondary canvas recovery contains invalid manifest entries: ${inventory.invalidEntries
        .slice(0, 4)
        .map((entry) => entry.path)
        .join(", ")}.`,
      path: inventory.invalidEntries[0].path,
    };
  }

  if (inventory.sets.length === 0) {
    return {
      id: "secondary-canvas-recovery",
      level: "ok",
      message: "No secondary canvas replica recovery sets were found.",
      path: inventory.recoveryRoot,
    };
  }

  return {
    id: "secondary-canvas-recovery",
    level: "warning",
    message: `Found ${inventory.sets.length} quarantined canvas replica recovery set(s). Review manifest before any explicit compare or restore action.`,
    path: inventory.sets[0].manifestPath,
  };
}

async function pushPathCheck(
  checks: StorageDoctorCheck[],
  options: {
    id: string;
    path: string;
    kind: "file" | "directory";
    missingLevel: StorageDoctorLevel;
    existsMessage: string;
    missingMessage: string;
  },
): Promise<void> {
  const exists = await pathExists(options.path, options.kind);
  checks.push({
    id: options.id,
    level: exists ? "ok" : options.missingLevel,
    message: exists ? options.existsMessage : options.missingMessage,
    path: options.path,
  });
}

async function pathExists(path: string, kind: "file" | "directory"): Promise<boolean> {
  try {
    const info = await stat(path);
    return kind === "file" ? info.isFile() : info.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function inspectAssetLinksRoot(assetLinksRoot: string): Promise<StorageDoctorCheck> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(assetLinksRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        id: "asset-link-integrity",
        level: "warning",
        message: "Asset links root is missing; link integrity was not checked.",
        path: assetLinksRoot,
      };
    }
    throw error;
  }

  const broken: string[] = [];
  const invalid: string[] = [];

  for (const entry of entries) {
    const entryPath = join(assetLinksRoot, entry.name);
    const info = await lstat(entryPath);
    if (info.isSymbolicLink()) {
      try {
        const target = await stat(entryPath);
        if (!target.isFile()) invalid.push(`${entry.name} (symlink target is not a file)`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          broken.push(`${entry.name} (broken symlink)`);
          continue;
        }
        throw error;
      }
      continue;
    }
    if (!info.isFile()) {
      invalid.push(`${entry.name} (not a file)`);
    }
  }

  if (broken.length > 0 || invalid.length > 0) {
    const problems = [...broken, ...invalid].slice(0, 8).join(", ");
    const suffix = broken.length + invalid.length > 8 ? `, and ${broken.length + invalid.length - 8} more` : "";
    return {
      id: "asset-link-integrity",
      level: "error",
      message: `Asset links contain invalid entries: ${problems}${suffix}. Re-run clash asset link to repair them.`,
      path: assetLinksRoot,
    };
  }

  return {
    id: "asset-link-integrity",
    level: "ok",
    message: entries.length === 0
      ? "Asset links root is empty."
      : "Asset links resolve to files.",
    path: assetLinksRoot,
  };
}

async function repairProjectWorkspace(status: ProjectStatus): Promise<StorageDoctorRepair[]> {
  const paths = [
    { id: "project-workspace", path: status.projectWorkspaceRoot, message: "Created project workspace root." },
    { id: "editable-drafts-root", path: status.roots.drafts, message: "Created editable drafts root." },
    { id: "editable-projections-root", path: status.roots.projections, message: "Created editable projections root." },
    { id: "editable-timelines-root", path: status.roots.timelines, message: "Created editable timeline view root." },
    { id: "editable-projections-text-root", path: join(status.roots.projections, "text"), message: "Created editable text projections root." },
    { id: "editable-projections-timelines-root", path: join(status.roots.projections, "timelines"), message: "Created editable timeline projections root." },
    { id: "editable-projections-storyboards-root", path: join(status.roots.projections, "storyboards"), message: "Created editable storyboard projections root." },
    { id: "editable-projections-prompts-root", path: join(status.roots.projections, "prompts"), message: "Created editable prompt projections root." },
    { id: "editable-projections-metadata-root", path: join(status.roots.projections, "metadata"), message: "Created editable metadata projections root." },
    { id: "editable-sessions-root", path: status.roots.sessions, message: "Created editable sessions root." },
    { id: "editable-asset-links-root", path: status.roots.assetLinks, message: "Created editable asset links root." },
    { id: "protected-runtime-root", path: status.roots.runtime, message: "Created protected runtime root." },
  ];
  const repairs: StorageDoctorRepair[] = [];
  for (const item of paths) {
    const existed = await pathExists(item.path, "directory");
    await mkdir(item.path, { recursive: true });
    if (!existed) {
      repairs.push({ id: item.id, message: item.message, path: item.path });
    }
  }
  return repairs;
}

async function repairLocalSqliteSchema(sqlitePath: string): Promise<StorageDoctorRepair[]> {
  await mkdir(dirname(sqlitePath), { recursive: true });
  let db: SqliteDatabase | undefined;
  try {
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => SqliteDatabase;
    };
    db = new DatabaseSync(sqlitePath);
    ensureLocalSqliteCoreMetadataSchema(db);
    ensureLocalSqliteProviderAuthSchema(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS asset_node_refs (
        asset_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        node_type TEXT NOT NULL,
        field_path TEXT NOT NULL,
        reference_role TEXT NOT NULL DEFAULT 'asset',
        observed_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, node_id, field_path, asset_id)
      );
      CREATE INDEX IF NOT EXISTS asset_node_refs_asset_idx ON asset_node_refs(asset_id, project_id);
      CREATE INDEX IF NOT EXISTS asset_node_refs_project_idx ON asset_node_refs(project_id, node_id);

      CREATE TABLE IF NOT EXISTS text_revisions (
        revision_id TEXT PRIMARY KEY NOT NULL,
        text_id TEXT NOT NULL,
        parent_revision_id TEXT,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        hash_algorithm TEXT NOT NULL,
        source_file_path TEXT NOT NULL,
        source_file_hash TEXT NOT NULL,
        actor_json TEXT
      );
      CREATE INDEX IF NOT EXISTS text_revisions_project_node_idx ON text_revisions(project_id, node_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS text_revisions_text_idx ON text_revisions(text_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS timeline_revisions (
        revision_id TEXT PRIMARY KEY NOT NULL,
        timeline_id TEXT NOT NULL,
        parent_revision_id TEXT,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        timeline_hash TEXT NOT NULL,
        hash_algorithm TEXT NOT NULL,
        source_file_path TEXT NOT NULL,
        source_file_hash TEXT NOT NULL,
        actor_json TEXT,
        loro_frontiers_json TEXT,
        loro_version_vector_json TEXT,
        dependencies_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS timeline_revisions_project_node_idx ON timeline_revisions(project_id, node_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS timeline_revisions_timeline_idx ON timeline_revisions(timeline_id, created_at DESC);
    `);
    try {
      db.exec("ALTER TABLE asset_node_refs ADD COLUMN reference_role TEXT NOT NULL DEFAULT 'asset'");
    } catch {
      // Column already exists, or the table was just created with the column.
    }
  } finally {
    db?.close();
  }
  return [{
    id: "local-sqlite-schema",
    message: "Ensured local SQLite core metadata, provider auth, asset reference, and revision index schema.",
    path: sqlitePath,
  }];
}

function ensureLocalSqliteCoreMetadataSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_migration (
      id TEXT PRIMARY KEY NOT NULL,
      completed_at INTEGER NOT NULL,
      source_path TEXT NOT NULL,
      source_sha256 TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_preview_asset (
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      created_at TEXT,
      position INTEGER NOT NULL,
      PRIMARY KEY (project_id, asset_id, position)
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      src_r2_key TEXT NOT NULL,
      cover_r2_key TEXT,
      metadata TEXT,
      source_model TEXT,
      source_prompt TEXT,
      source_task_id TEXT,
      sources TEXT,
      signed_url TEXT,
      signed_url_exp INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      project_id TEXT
    );

    CREATE TABLE IF NOT EXISTS asset_refs (
      asset_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      PRIMARY KEY (asset_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS runtime_session (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      runtime_id TEXT,
      agent_id TEXT,
      agent_template_id TEXT,
      permission_mode TEXT,
      acp_session_id TEXT,
      status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_member (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      agent_id TEXT,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_message (
      session_id TEXT NOT NULL,
      id TEXT NOT NULL,
      sender_kind TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      turn_id TEXT,
      events_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, id)
    );

    CREATE TABLE IF NOT EXISTS room_message (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      sender_kind TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_user_id TEXT NOT NULL,
      mentions_json TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_sync_conflict_resolution (
      project_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      strategy TEXT NOT NULL,
      local_content_hash TEXT NOT NULL,
      remote_content_hash TEXT NOT NULL,
      resolved_at INTEGER NOT NULL,
      mutation_id TEXT,
      PRIMARY KEY (project_id, message_id, local_content_hash, remote_content_hash)
    );

    CREATE TABLE IF NOT EXISTS mutation_audit (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      operation TEXT NOT NULL,
      entity_kind TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      actor_client_type TEXT,
      forced INTEGER NOT NULL,
      accepted INTEGER NOT NULL,
      reason TEXT,
      result_entity_id TEXT,
      error TEXT,
      mutation_json TEXT NOT NULL
    );
  `);
  for (const column of [
    "completed_at INTEGER NOT NULL DEFAULT 0",
    "source_path TEXT NOT NULL DEFAULT ''",
    "source_sha256 TEXT NOT NULL DEFAULT ''",
  ]) {
    ensureSqliteColumn(db, "local_migration", column);
  }
  for (const column of [
    "owner_id TEXT NOT NULL DEFAULT ''",
    "name TEXT NOT NULL DEFAULT ''",
    "description TEXT",
    "created_at TEXT NOT NULL DEFAULT ''",
    "updated_at TEXT NOT NULL DEFAULT ''",
    "deleted_at TEXT",
  ]) {
    ensureSqliteColumn(db, "project", column);
  }
  for (const column of [
    "asset_id TEXT NOT NULL DEFAULT ''",
    "url TEXT NOT NULL DEFAULT ''",
    "type TEXT NOT NULL DEFAULT 'image'",
    "storage_key TEXT NOT NULL DEFAULT ''",
    "created_at TEXT",
    "position INTEGER NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "project_preview_asset", column);
  }
  for (const column of [
    "user_id TEXT NOT NULL DEFAULT ''",
    "kind TEXT NOT NULL DEFAULT 'image'",
    "src_r2_key TEXT NOT NULL DEFAULT ''",
    "cover_r2_key TEXT",
    "metadata TEXT",
    "source_model TEXT",
    "source_prompt TEXT",
    "source_task_id TEXT",
    "sources TEXT",
    "signed_url TEXT",
    "signed_url_exp INTEGER",
    "created_at INTEGER NOT NULL DEFAULT 0",
    "updated_at INTEGER NOT NULL DEFAULT 0",
    "project_id TEXT",
  ]) {
    ensureSqliteColumn(db, "assets", column);
  }
  for (const column of [
    "imported_at INTEGER NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "asset_refs", column);
  }
  for (const column of [
    "project_id TEXT NOT NULL DEFAULT ''",
    "title TEXT NOT NULL DEFAULT ''",
    "type TEXT NOT NULL DEFAULT 'runtime'",
    "runtime_id TEXT",
    "agent_id TEXT",
    "agent_template_id TEXT",
    "permission_mode TEXT",
    "acp_session_id TEXT",
    "status TEXT",
    "created_at TEXT NOT NULL DEFAULT ''",
    "updated_at TEXT NOT NULL DEFAULT ''",
  ]) {
    ensureSqliteColumn(db, "runtime_session", column);
  }
  for (const column of [
    "user_id TEXT NOT NULL DEFAULT ''",
    "template_id TEXT NOT NULL DEFAULT ''",
    "runtime_id TEXT NOT NULL DEFAULT ''",
    "agent_id TEXT",
    "display_name TEXT NOT NULL DEFAULT ''",
    "created_at INTEGER NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "agent_member", column);
  }
  for (const column of [
    "sender_kind TEXT NOT NULL DEFAULT ''",
    "sender_id TEXT NOT NULL DEFAULT ''",
    "turn_id TEXT",
    "events_json TEXT NOT NULL DEFAULT '[]'",
    "created_at INTEGER NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "chat_message", column);
  }
  for (const column of [
    "project_id TEXT NOT NULL DEFAULT ''",
    "sender_kind TEXT NOT NULL DEFAULT ''",
    "sender_id TEXT NOT NULL DEFAULT ''",
    "sender_user_id TEXT NOT NULL DEFAULT ''",
    "mentions_json TEXT NOT NULL DEFAULT '[]'",
    "text TEXT NOT NULL DEFAULT ''",
    "created_at INTEGER NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "room_message", column);
  }
  for (const column of [
    "project_id TEXT NOT NULL DEFAULT ''",
    "message_id TEXT NOT NULL DEFAULT ''",
    "strategy TEXT NOT NULL DEFAULT 'accept-divergence'",
    "local_content_hash TEXT NOT NULL DEFAULT ''",
    "remote_content_hash TEXT NOT NULL DEFAULT ''",
    "resolved_at INTEGER NOT NULL DEFAULT 0",
    "mutation_id TEXT",
  ]) {
    ensureSqliteColumn(db, "room_sync_conflict_resolution", column);
  }
  for (const column of [
    "created_at INTEGER NOT NULL DEFAULT 0",
    "operation TEXT NOT NULL DEFAULT ''",
    "entity_kind TEXT NOT NULL DEFAULT ''",
    "entity_id TEXT NOT NULL DEFAULT ''",
    "actor_client_type TEXT",
    "forced INTEGER NOT NULL DEFAULT 0",
    "accepted INTEGER NOT NULL DEFAULT 0",
    "reason TEXT",
    "result_entity_id TEXT",
    "error TEXT",
    "mutation_json TEXT NOT NULL DEFAULT '{}'",
  ]) {
    ensureSqliteColumn(db, "mutation_audit", column);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS project_owner_idx ON project(owner_id, updated_at);
    CREATE INDEX IF NOT EXISTS assets_user_idx ON assets(user_id, created_at);
    CREATE INDEX IF NOT EXISTS assets_task_idx ON assets(source_task_id);
    CREATE INDEX IF NOT EXISTS assets_project_idx ON assets(project_id, created_at);
    CREATE INDEX IF NOT EXISTS asset_refs_project_idx ON asset_refs(project_id, imported_at);
    CREATE INDEX IF NOT EXISTS runtime_session_project_idx ON runtime_session(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS agent_member_user_idx ON agent_member(user_id, created_at);
    CREATE INDEX IF NOT EXISTS chat_message_session_idx ON chat_message(session_id, created_at);
    CREATE INDEX IF NOT EXISTS room_message_project_idx ON room_message(project_id, created_at);
    CREATE INDEX IF NOT EXISTS room_sync_conflict_resolution_project_idx
      ON room_sync_conflict_resolution(project_id, resolved_at DESC);
    CREATE INDEX IF NOT EXISTS mutation_audit_created_idx ON mutation_audit(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS mutation_audit_operation_idx ON mutation_audit(operation, created_at DESC);
    CREATE INDEX IF NOT EXISTS mutation_audit_entity_idx ON mutation_audit(entity_kind, entity_id, created_at DESC);
  `);
}

function ensureSqliteColumn(db: SqliteDatabase, table: string, columnDefinition: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`);
  } catch {
    // Column already exists, or the existing table is too incompatible for safe repair.
  }
}

function sqlitePrimaryKeyColumns(db: SqliteDatabase, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .map((row) => ({
      name: typeof row.name === "string" ? row.name : "",
      pk: typeof row.pk === "number" ? row.pk : 0,
    }))
    .filter((row) => row.name && row.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((row) => row.name);
}

function hasSqlitePrimaryKey(db: SqliteDatabase, table: string, expectedColumns: string[]): boolean {
  const actual = sqlitePrimaryKeyColumns(db, table);
  return actual.length === expectedColumns.length && actual.every((column, index) => column === expectedColumns[index]);
}

function rebuildSqliteTableIfPrimaryKeyDiffers(
  db: SqliteDatabase,
  table: string,
  expectedPrimaryKey: string[],
  columns: string[],
  createTableSql: (tableName: string) => string,
): void {
  if (hasSqlitePrimaryKey(db, table, expectedPrimaryKey)) return;
  const tempTable = `${table}__schema_upgrade`;
  const columnList = columns.join(", ");
  db.exec(`
    DROP TABLE IF EXISTS ${tempTable};
    ${createTableSql(tempTable)}
    INSERT OR IGNORE INTO ${tempTable} (${columnList})
      SELECT ${columnList} FROM ${table};
    DROP TABLE ${table};
    ALTER TABLE ${tempTable} RENAME TO ${table};
  `);
}

function providerAccountsTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      id TEXT,
      provider_id TEXT NOT NULL,
      upstream_id TEXT,
      region TEXT,
      label TEXT,
      enabled INTEGER NOT NULL,
      priority REAL,
      weight REAL,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, account_key)
    );
  `;
}

function providerAccountCredentialsTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      credential_key TEXT NOT NULL,
      credential_value TEXT NOT NULL,
      PRIMARY KEY (user_id, account_key, credential_key)
    );
  `;
}

function providerAccountSupportedModelsTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      model_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (user_id, account_key, model_id)
    );
  `;
}

function providerAccountModelPrioritiesTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      model_id TEXT NOT NULL,
      priority REAL NOT NULL,
      PRIMARY KEY (user_id, account_key, model_id)
    );
  `;
}

function providerOAuthTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_type TEXT,
      verification_uri TEXT,
      user_code TEXT,
      device_code TEXT,
      interval_seconds INTEGER,
      account_label TEXT,
      expires_at TEXT,
      error TEXT,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, provider_id, account_id)
    );
  `;
}

function repairProviderAuthPrimaryKeys(db: SqliteDatabase): void {
  rebuildSqliteTableIfPrimaryKeyDiffers(db, "provider_accounts", ["user_id", "account_key"], [
    "user_id",
    "account_key",
    "id",
    "provider_id",
    "upstream_id",
    "region",
    "label",
    "enabled",
    "priority",
    "weight",
    "created_at",
    "updated_at",
  ], providerAccountsTableSql);
  rebuildSqliteTableIfPrimaryKeyDiffers(
    db,
    "provider_account_credentials",
    ["user_id", "account_key", "credential_key"],
    ["user_id", "account_key", "credential_key", "credential_value"],
    providerAccountCredentialsTableSql,
  );
  rebuildSqliteTableIfPrimaryKeyDiffers(
    db,
    "provider_account_supported_models",
    ["user_id", "account_key", "model_id"],
    ["user_id", "account_key", "model_id", "position"],
    providerAccountSupportedModelsTableSql,
  );
  rebuildSqliteTableIfPrimaryKeyDiffers(
    db,
    "provider_account_model_priorities",
    ["user_id", "account_key", "model_id"],
    ["user_id", "account_key", "model_id", "priority"],
    providerAccountModelPrioritiesTableSql,
  );
  rebuildSqliteTableIfPrimaryKeyDiffers(db, "provider_oauth", ["user_id", "provider_id", "account_id"], [
    "user_id",
    "provider_id",
    "account_id",
    "status",
    "access_token",
    "refresh_token",
    "token_type",
    "verification_uri",
    "user_code",
    "device_code",
    "interval_seconds",
    "account_label",
    "expires_at",
    "error",
    "created_at",
    "updated_at",
  ], providerOAuthTableSql);
}

function ensureLocalSqliteProviderAuthSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_accounts (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      id TEXT,
      provider_id TEXT NOT NULL,
      upstream_id TEXT,
      region TEXT,
      label TEXT,
      enabled INTEGER NOT NULL,
      priority REAL,
      weight REAL,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, account_key)
    );

    CREATE TABLE IF NOT EXISTS provider_account_credentials (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      credential_key TEXT NOT NULL,
      credential_value TEXT NOT NULL,
      PRIMARY KEY (user_id, account_key, credential_key)
    );

    CREATE TABLE IF NOT EXISTS provider_account_supported_models (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      model_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (user_id, account_key, model_id)
    );

    CREATE TABLE IF NOT EXISTS provider_account_model_priorities (
      user_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      model_id TEXT NOT NULL,
      priority REAL NOT NULL,
      PRIMARY KEY (user_id, account_key, model_id)
    );

    CREATE TABLE IF NOT EXISTS provider_oauth (
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_type TEXT,
      verification_uri TEXT,
      user_code TEXT,
      device_code TEXT,
      interval_seconds INTEGER,
      account_label TEXT,
      expires_at TEXT,
      error TEXT,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, provider_id, account_id)
    );
  `);
  for (const column of [
    "account_key TEXT NOT NULL DEFAULT ''",
    "id TEXT",
    "provider_id TEXT NOT NULL DEFAULT ''",
    "upstream_id TEXT",
    "region TEXT",
    "label TEXT",
    "enabled INTEGER NOT NULL DEFAULT 1",
    "priority REAL",
    "weight REAL",
    "created_at TEXT",
    "updated_at TEXT",
  ]) {
    ensureSqliteColumn(db, "provider_accounts", column);
  }
  for (const column of [
    "account_key TEXT NOT NULL DEFAULT ''",
    "credential_key TEXT NOT NULL DEFAULT ''",
    "credential_value TEXT NOT NULL DEFAULT ''",
  ]) {
    ensureSqliteColumn(db, "provider_account_credentials", column);
  }
  for (const column of [
    "account_key TEXT NOT NULL DEFAULT ''",
    "model_id TEXT NOT NULL DEFAULT ''",
    "position INTEGER NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "provider_account_supported_models", column);
  }
  for (const column of [
    "account_key TEXT NOT NULL DEFAULT ''",
    "model_id TEXT NOT NULL DEFAULT ''",
    "priority REAL NOT NULL DEFAULT 0",
  ]) {
    ensureSqliteColumn(db, "provider_account_model_priorities", column);
  }
  for (const column of [
    "provider_id TEXT NOT NULL DEFAULT ''",
    "account_id TEXT NOT NULL DEFAULT ''",
    "status TEXT NOT NULL DEFAULT 'pending'",
    "access_token TEXT",
    "refresh_token TEXT",
    "token_type TEXT",
    "verification_uri TEXT",
    "user_code TEXT",
    "device_code TEXT",
    "interval_seconds INTEGER",
    "account_label TEXT",
    "expires_at TEXT",
    "error TEXT",
    "created_at TEXT",
    "updated_at TEXT",
  ]) {
    ensureSqliteColumn(db, "provider_oauth", column);
  }
  repairProviderAuthPrimaryKeys(db);
}

async function inspectLocalSqliteSchema(sqlitePath: string): Promise<StorageDoctorCheck> {
  if (!(await pathExists(sqlitePath, "file"))) {
    return {
      id: "local-sqlite-schema",
      level: "warning",
      message: "Local SQLite target is missing; schema was not checked.",
      path: sqlitePath,
    };
  }

  let db: SqliteDatabase | undefined;
  try {
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => SqliteDatabase;
    };
    db = new DatabaseSync(sqlitePath);
    const problems: string[] = [];
    inspectSqliteTableSchema(db, problems, {
      table: "local_migration",
      columns: ["id", "completed_at", "source_path", "source_sha256"],
      indexes: [],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "project",
      columns: ["id", "owner_id", "name", "description", "created_at", "updated_at", "deleted_at"],
      indexes: ["project_owner_idx"],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "project_preview_asset",
      columns: ["project_id", "asset_id", "url", "type", "storage_key", "created_at", "position"],
      indexes: [],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "assets",
      columns: [
        "id",
        "user_id",
        "kind",
        "src_r2_key",
        "cover_r2_key",
        "metadata",
        "source_model",
        "source_prompt",
        "source_task_id",
        "sources",
        "signed_url",
        "signed_url_exp",
        "created_at",
        "updated_at",
        "project_id",
      ],
      indexes: ["assets_user_idx", "assets_task_idx", "assets_project_idx"],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "asset_refs",
      columns: ["asset_id", "project_id", "imported_at"],
      indexes: ["asset_refs_project_idx"],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "asset_node_refs",
      columns: ["asset_id", "project_id", "node_id", "node_type", "field_path", "reference_role", "observed_at"],
      indexes: ["asset_node_refs_asset_idx", "asset_node_refs_project_idx"],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "text_revisions",
      columns: [
        "revision_id",
        "text_id",
        "parent_revision_id",
        "project_id",
        "node_id",
        "created_at",
        "content_hash",
        "hash_algorithm",
        "source_file_path",
        "source_file_hash",
        "actor_json",
      ],
      indexes: ["text_revisions_project_node_idx", "text_revisions_text_idx"],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "timeline_revisions",
      columns: [
        "revision_id",
        "timeline_id",
        "parent_revision_id",
        "project_id",
        "node_id",
        "created_at",
        "timeline_hash",
        "hash_algorithm",
        "source_file_path",
        "source_file_hash",
        "actor_json",
        "loro_frontiers_json",
        "loro_version_vector_json",
        "dependencies_json",
      ],
      indexes: ["timeline_revisions_project_node_idx", "timeline_revisions_timeline_idx"],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "runtime_session",
      columns: [
        "id",
        "project_id",
        "title",
        "type",
        "runtime_id",
        "agent_id",
        "agent_template_id",
        "permission_mode",
        "acp_session_id",
        "status",
        "created_at",
        "updated_at",
      ],
      indexes: ["runtime_session_project_idx"],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "agent_member",
      columns: ["id", "user_id", "template_id", "runtime_id", "agent_id", "display_name", "created_at"],
      indexes: ["agent_member_user_idx"],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "chat_message",
      columns: ["session_id", "id", "sender_kind", "sender_id", "turn_id", "events_json", "created_at"],
      indexes: ["chat_message_session_idx"],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "room_message",
      columns: [
        "id",
        "project_id",
        "sender_kind",
        "sender_id",
        "sender_user_id",
        "mentions_json",
        "text",
        "created_at",
      ],
      indexes: ["room_message_project_idx"],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "room_sync_conflict_resolution",
      columns: [
        "project_id",
        "message_id",
        "strategy",
        "local_content_hash",
        "remote_content_hash",
        "resolved_at",
        "mutation_id",
      ],
      indexes: ["room_sync_conflict_resolution_project_idx"],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "mutation_audit",
      columns: [
        "id",
        "created_at",
        "operation",
        "entity_kind",
        "entity_id",
        "actor_client_type",
        "forced",
        "accepted",
        "reason",
        "result_entity_id",
        "error",
        "mutation_json",
      ],
      indexes: ["mutation_audit_created_idx", "mutation_audit_operation_idx", "mutation_audit_entity_idx"],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "provider_accounts",
      primaryKey: ["user_id", "account_key"],
      columns: [
        "user_id",
        "account_key",
        "id",
        "provider_id",
        "upstream_id",
        "region",
        "label",
        "enabled",
        "priority",
        "weight",
        "created_at",
        "updated_at",
      ],
      indexes: [],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "provider_account_credentials",
      primaryKey: ["user_id", "account_key", "credential_key"],
      columns: ["user_id", "account_key", "credential_key", "credential_value"],
      indexes: [],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "provider_account_supported_models",
      primaryKey: ["user_id", "account_key", "model_id"],
      columns: ["user_id", "account_key", "model_id", "position"],
      indexes: [],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "provider_account_model_priorities",
      primaryKey: ["user_id", "account_key", "model_id"],
      columns: ["user_id", "account_key", "model_id", "priority"],
      indexes: [],
    });
    inspectSqliteTableSchema(db, problems, {
      table: "provider_oauth",
      primaryKey: ["user_id", "provider_id", "account_id"],
      columns: [
        "user_id",
        "provider_id",
        "account_id",
        "status",
        "access_token",
        "refresh_token",
        "token_type",
        "verification_uri",
        "user_code",
        "device_code",
        "interval_seconds",
        "account_label",
        "expires_at",
        "error",
        "created_at",
        "updated_at",
      ],
      indexes: [],
    });

    return problems.length > 0
      ? {
          id: "local-sqlite-schema",
          level: "warning",
          message: `Local SQLite schema is missing agent-first local metadata schema: ${problems.join("; ")}.`,
          path: sqlitePath,
        }
      : {
          id: "local-sqlite-schema",
          level: "ok",
          message: "Local SQLite schema supports core metadata, provider auth, asset reference indexing, and text/timeline revision indexing.",
          path: sqlitePath,
        };
  } catch (error) {
    return {
      id: "local-sqlite-schema",
      level: "warning",
      message: `Local SQLite schema could not be inspected: ${error instanceof Error ? error.message : String(error)}.`,
      path: sqlitePath,
    };
  } finally {
    db?.close();
  }
}

function inspectSqliteTableSchema(
  db: SqliteDatabase,
  problems: string[],
  options: {
    table: string;
    primaryKey?: string[];
    columns: string[];
    indexes: string[];
  },
): void {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(options.table);
  if (!table) {
    problems.push(`missing ${options.table} table`);
    return;
  }
  const columns = new Set(
    db.prepare(`PRAGMA table_info(${options.table})`).all()
      .map((row) => typeof row.name === "string" ? row.name : "")
      .filter(Boolean),
  );
  const indexNames = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?").all(options.table)
      .map((row) => typeof row.name === "string" ? row.name : "")
      .filter(Boolean),
  );
  for (const column of options.columns) {
    if (!columns.has(column)) problems.push(`missing ${options.table}.${column} column`);
  }
  if (options.primaryKey && !hasSqlitePrimaryKey(db, options.table, options.primaryKey)) {
    problems.push(`invalid ${options.table} primary key; expected (${options.primaryKey.join(", ")})`);
  }
  for (const index of options.indexes) {
    if (!indexNames.has(index)) problems.push(`missing ${index} index`);
  }
}

function isSameOrInside(childPath: string, parentPath: string): boolean {
  const child = resolve(childPath);
  const parent = resolve(parentPath);
  const relation = relative(parent, child);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

export const doctorCommand = new Command("doctor")
  .description("Inspect local Clash project health");

doctorCommand
  .command("storage")
  .description("Inspect local project storage roots and protected paths")
  .option("--project <id>", "Project ID")
  .option("--repair", "Create missing workspace roots and repair known local SQLite schema gaps")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const report = await runStorageDoctor({ project: options.project, repair: options.repair === true });
    if (isJsonMode(options)) {
      printJson(report);
    } else {
      console.log(`Storage doctor: ${report.ok ? "ok" : "failed"}`);
      if (report.projectId) console.log(`Project: ${report.projectId}`);
      for (const repair of report.repairs ?? []) {
        console.log(`REPAIR ${repair.id}: ${repair.message}`);
        if (repair.path) console.log(`  ${repair.path}`);
      }
      for (const check of report.checks) {
        const prefix =
          check.level === "ok" ? "OK" :
          check.level === "warning" ? "WARN" : "ERROR";
        console.log(`${prefix} ${check.id}: ${check.message}`);
        if (check.path) console.log(`  ${check.path}`);
      }
    }
    if (!report.ok) process.exitCode = 1;
  });

const storageRecoveryCommand = doctorCommand
  .command("storage-recovery")
  .description("Inspect quarantined local storage recovery artifacts");

storageRecoveryCommand
  .command("list")
  .description("List quarantined secondary canvas replica recovery manifests for review")
  .option("--project <id>", "Project ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const report = await listSecondaryCanvasRecoveries({ project: options.project });
    if (isJsonMode(options)) {
      printJson(report);
      return;
    }

    console.log(`Storage recovery inventory: ${report.projectId}`);
    console.log(`Recovery root: ${report.recoveryRoot}`);
    console.log("Automatic import: disabled");
    console.log(`Recovery policy: ${report.recoveryPolicy.reason}`);
    if (report.sets.length === 0) {
      console.log("No quarantined recovery sets found.");
    }
    for (const set of report.sets) {
      console.log(`${set.createdAt} ${set.fileCount} file(s)`);
      console.log(`  ${set.manifestPath}`);
    }
    for (const invalid of report.invalidEntries) {
      console.log(`INVALID ${invalid.path}: ${invalid.error}`);
    }
  });

storageRecoveryCommand
  .command("compare")
  .description("Compare a quarantined secondary canvas replica manifest against the canonical replica bytes")
  .requiredOption("--manifest <path>", "Path to a secondary canvas replica recovery manifest.json")
  .option("--project <id>", "Project ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const report = await compareSecondaryCanvasRecovery({ manifestPath: options.manifest, project: options.project });
    if (isJsonMode(options)) {
      printJson(report);
      return;
    }

    console.log(`Storage recovery compare: ${report.projectId}`);
    console.log(`Manifest: ${report.manifestPath}`);
    console.log("Automatic import: disabled");
    console.log(`Recovery policy: ${report.recoveryPolicy.reason}`);
    for (const file of report.files) {
      console.log(`${file.kind}: ${file.sameBytes ? "same" : "different"}`);
      console.log(`  quarantined: ${file.quarantined.path}`);
      console.log(`  canonical: ${file.canonical.path}`);
    }
  });

storageRecoveryCommand
  .command("restore")
  .description("Explicitly restore a quarantined secondary canvas replica after compare/read-token review")
  .requiredOption("--manifest <path>", "Path to a secondary canvas replica recovery manifest.json")
  .requiredOption("--if-match <readToken>", "Read token returned by doctor storage-recovery compare")
  .option("--project <id>", "Project ID")
  .option("--yes", "Confirm overwriting canonical canvas replica files after backup")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const report = await restoreSecondaryCanvasRecovery({
      manifestPath: options.manifest,
      project: options.project,
      expectedReadToken: options.ifMatch,
      confirm: options.yes === true,
    });
    if (isJsonMode(options)) {
      printJson(report);
      return;
    }

    console.log(`Storage recovery restore: ${report.projectId}`);
    console.log(`Manifest: ${report.manifestPath}`);
    console.log(`Recovery policy: ${report.recoveryPolicy.reason}`);
    console.log(`Backups: ${report.backupsRoot}`);
    console.log(`Before read token: ${report.beforeReadToken}`);
    console.log(`After read token: ${report.afterReadToken}`);
    for (const file of report.files) {
      console.log(`${file.kind}: restored`);
      console.log(`  quarantined: ${file.destinationPath}`);
      console.log(`  canonical: ${file.canonicalPath}`);
      if (file.backupPath) console.log(`  backup: ${file.backupPath}`);
    }
  });
