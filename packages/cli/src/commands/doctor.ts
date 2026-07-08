import { Command } from "commander";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { createRequire } from "node:module";
import { lstat, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { timelineDslFromYaml, timelineDslHash } from "@clash/shared-types";
import { isJsonMode, printJson } from "../lib/output";
import {
  resolveProjectStatus,
  type ProjectStatus,
} from "./projects";

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

export interface SecondaryCanvasRecoveryCompareReport {
  schemaVersion: 1;
  status: "compared";
  projectId: string;
  manifestPath: string;
  canonicalReplica: SecondaryCanvasReplicaManifest["canonicalReplica"];
  safeToImportAutomatically: false;
  files: SecondaryCanvasRecoveryCompareFile[];
}

export interface SecondaryCanvasRecoveryInventorySet {
  manifestPath: string;
  createdAt: string;
  canonicalReplica: SecondaryCanvasReplicaManifest["canonicalReplica"];
  fileCount: number;
  files: SecondaryCanvasReplicaManifest["files"];
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
    checks.push({
      id: "project-context",
      level: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, checks };
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
  checks.push(await inspectTextRevisionBlobIntegrity(status));
  checks.push(await inspectTimelineRevisionBlobIntegrity(status));

  if (options.repair === true) {
    repairs.push(...await repairProjectWorkspace(status));
    repairs.push(...await repairSecondaryCanvasReplicas(status, cwd));
    repairs.push(...await repairLocalSqliteAssetReferenceSchema(status.localSqlitePath));
    checks.push({
      id: "storage-repair",
      level: "ok",
      message: repairs.length > 0
        ? `Applied ${repairs.length} storage repair action(s).`
        : "No repairable storage issues were found.",
    });
  }
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
            : `editable workspace includes canonical canvas path: ${canonicalPath}`,
        );
      }
    }
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
          message: "Project storage contract separates agent workspace from protected canonical replica.",
        },
  ];
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

async function inspectTextRevisionBlobIntegrity(status: ProjectStatus): Promise<StorageDoctorCheck> {
  return inspectRevisionBlobIntegrity({
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
  });
}

async function inspectTimelineRevisionBlobIntegrity(status: ProjectStatus): Promise<StorageDoctorCheck> {
  return inspectRevisionBlobIntegrity({
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
  });
}

async function inspectRevisionBlobIntegrity(options: {
  id: string;
  label: string;
  root: string;
  extension: string;
  expectedHashFromName(fileName: string): string | null;
  contentHash(content: string): Promise<string>;
}): Promise<StorageDoctorCheck> {
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
}): Promise<SecondaryCanvasRecoveryCompareReport> {
  const manifestPath = resolve(options.manifestPath);
  const manifest = parseSecondaryCanvasReplicaManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
    manifestPath,
  );
  const files: SecondaryCanvasRecoveryCompareFile[] = [];
  for (const file of manifest.files) {
    const canonicalPath =
      file.kind === "snapshot"
        ? manifest.canonicalReplica.snapshotPath
        : manifest.canonicalReplica.updatesLogPath;
    const quarantined = await readFileCompareEvidence(file.destinationPath);
    const canonical = await readFileCompareEvidence(canonicalPath);
    files.push({
      kind: file.kind,
      sourcePath: file.sourcePath,
      destinationPath: file.destinationPath,
      quarantined,
      canonical,
      sameBytes: quarantined.exists && canonical.exists && quarantined.sha256 === canonical.sha256,
    });
  }

  return {
    schemaVersion: 1,
    status: "compared",
    projectId: manifest.projectId,
    manifestPath,
    canonicalReplica: manifest.canonicalReplica,
    safeToImportAutomatically: false,
    files,
  };
}

export async function listSecondaryCanvasRecoveries(options: {
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
} = {}): Promise<SecondaryCanvasRecoveryListReport> {
  const status = await resolveProjectStatus(options);
  const recoveryRoot = join(status.roots.runtime, "recovery", "secondary-canvas-replicas");
  const sets: SecondaryCanvasRecoveryInventorySet[] = [];
  const invalidEntries: SecondaryCanvasRecoveryInvalidEntry[] = [];

  let entries: Dirent<string>[];
  try {
    entries = await readdir(recoveryRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        schemaVersion: 1,
        status: "listed",
        projectId: status.projectId,
        recoveryRoot,
        safeToImportAutomatically: false,
        sets,
        invalidEntries,
      };
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(recoveryRoot, entry.name, "manifest.json");
    try {
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
      sets.push({
        manifestPath,
        createdAt: manifest.createdAt,
        canonicalReplica: manifest.canonicalReplica,
        fileCount: manifest.files.length,
        files: manifest.files,
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
    schemaVersion: 1,
    status: "listed",
    projectId: status.projectId,
    recoveryRoot,
    safeToImportAutomatically: false,
    sets,
    invalidEntries,
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
  const recoveryRoot = join(status.roots.runtime, "recovery", "secondary-canvas-replicas");
  let entries: Dirent<string>[];
  try {
    entries = await readdir(recoveryRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        id: "secondary-canvas-recovery",
        level: "ok",
        message: "No secondary canvas replica recovery sets were found.",
        path: recoveryRoot,
      };
    }
    throw error;
  }

  const manifests: string[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(recoveryRoot, entry.name, "manifest.json");
    if (!(await pathExists(manifestPath, "file"))) {
      invalid.push(join(recoveryRoot, entry.name));
      continue;
    }
    try {
      const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<SecondaryCanvasReplicaManifest>;
      if (parsed.schemaVersion !== 1 || parsed.projectId !== status.projectId || !Array.isArray(parsed.files)) {
        invalid.push(manifestPath);
        continue;
      }
      manifests.push(manifestPath);
    } catch {
      invalid.push(manifestPath);
    }
  }

  if (invalid.length > 0) {
    return {
      id: "secondary-canvas-recovery",
      level: "warning",
      message: `Secondary canvas recovery contains invalid manifest entries: ${invalid.slice(0, 4).join(", ")}.`,
      path: invalid[0],
    };
  }

  if (manifests.length === 0) {
    return {
      id: "secondary-canvas-recovery",
      level: "ok",
      message: "No secondary canvas replica recovery sets were found.",
      path: recoveryRoot,
    };
  }

  return {
    id: "secondary-canvas-recovery",
    level: "warning",
    message: `Found ${manifests.length} quarantined canvas replica recovery set(s). Review manifest before any explicit import or compare action.`,
    path: manifests[0],
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

async function repairLocalSqliteAssetReferenceSchema(sqlitePath: string): Promise<StorageDoctorRepair[]> {
  await mkdir(dirname(sqlitePath), { recursive: true });
  let db: SqliteDatabase | undefined;
  try {
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => SqliteDatabase;
    };
    db = new DatabaseSync(sqlitePath);
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
    message: "Ensured local SQLite asset reference index schema.",
    path: sqlitePath,
  }];
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
    const assetNodeRefs = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'asset_node_refs'").get();
    const columns = new Set(
      db.prepare("PRAGMA table_info(asset_node_refs)").all()
        .map((row) => typeof row.name === "string" ? row.name : "")
        .filter(Boolean),
    );
    const indexNames = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'asset_node_refs'").all()
        .map((row) => typeof row.name === "string" ? row.name : "")
        .filter(Boolean),
    );
    const problems: string[] = [];
    if (!assetNodeRefs) problems.push("missing asset_node_refs table");
    for (const column of ["asset_id", "project_id", "node_id", "node_type", "field_path", "reference_role", "observed_at"]) {
      if (!columns.has(column)) problems.push(`missing asset_node_refs.${column} column`);
    }
    for (const index of ["asset_node_refs_asset_idx", "asset_node_refs_project_idx"]) {
      if (!indexNames.has(index)) problems.push(`missing ${index} index`);
    }

    return problems.length > 0
      ? {
          id: "local-sqlite-schema",
          level: "warning",
          message: `Local SQLite schema is missing agent-first asset reference indexing: ${problems.join("; ")}.`,
          path: sqlitePath,
        }
      : {
          id: "local-sqlite-schema",
          level: "ok",
          message: "Local SQLite schema supports asset reference indexing.",
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
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const report = await compareSecondaryCanvasRecovery({ manifestPath: options.manifest });
    if (isJsonMode(options)) {
      printJson(report);
      return;
    }

    console.log(`Storage recovery compare: ${report.projectId}`);
    console.log(`Manifest: ${report.manifestPath}`);
    console.log("Automatic import: disabled");
    for (const file of report.files) {
      console.log(`${file.kind}: ${file.sameBytes ? "same" : "different"}`);
      console.log(`  quarantined: ${file.quarantined.path}`);
      console.log(`  canonical: ${file.canonical.path}`);
    }
  });
