import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { WorkspaceBundleFile } from "@clash/shared-types";

export type WorkspaceTreePackingErrorCode =
  | "INVALID_LIMIT"
  | "SOURCE_OUTPUT_OVERLAP"
  | "SECRET_FILE"
  | "UNSAFE_ENTRY"
  | "PATH_COLLISION"
  | "FILE_COUNT_LIMIT_EXCEEDED"
  | "FILE_BYTES_LIMIT_EXCEEDED"
  | "TOTAL_BYTES_LIMIT_EXCEEDED"
  | "SOURCE_CHANGED"
  | "TARGET_EXISTS";

export class WorkspaceTreePackingError extends Error {
  override name = "WorkspaceTreePackingError";

  constructor(
    readonly code: WorkspaceTreePackingErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface WorkspaceTreePackingLimits {
  maxFileCount: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_WORKSPACE_TREE_PACKING_LIMITS: Readonly<WorkspaceTreePackingLimits> =
  Object.freeze({
    maxFileCount: 100_000,
    maxFileBytes: 16 * 1024 * 1024 * 1024,
    maxTotalBytes: 1024 * 1024 * 1024 * 1024,
  });

export type WorkspaceTreeExcludedReason =
  "vcs-private" | "target-marker-regenerated" | "runtime-private" | "cache";

export interface WorkspaceTreeExcludedPath {
  path: string;
  reason: WorkspaceTreeExcludedReason;
}

export type WorkspaceTreePathPolicy =
  | { decision: "include" }
  | { decision: "exclude"; reason: WorkspaceTreeExcludedReason }
  | { decision: "reject"; reason: "secret-like" };

export interface WorkspaceTreePlannedFile {
  path: string;
  bytes: number;
  mode: "0644" | "0755";
}

export interface WorkspaceTreePlan {
  sourceRoot: string;
  bundleRoot: string;
  limits: WorkspaceTreePackingLimits;
  files: readonly WorkspaceTreePlannedFile[];
  excluded: readonly WorkspaceTreeExcludedPath[];
}

export interface PlanWorkspaceTreeInput {
  sourceRoot: string;
  bundleRoot: string;
  limits?: Partial<WorkspaceTreePackingLimits>;
}

export interface MaterializedWorkspaceTree {
  files: WorkspaceBundleFile[];
  excluded: WorkspaceTreeExcludedPath[];
  totalBytes: number;
}

interface FileFingerprint {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mode: bigint;
  nlink: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

interface PlannedEntry {
  actualSegments: string[];
  portableRelativePath: string;
  bundlePath: string;
  fingerprint: FileFingerprint;
  mode: "0644" | "0755";
}

interface InternalWorkspaceTreePlan {
  publicPlan: WorkspaceTreePlan;
  entries: PlannedEntry[];
  snapshot: string;
}

const internalPlans = new WeakMap<
  WorkspaceTreePlan,
  InternalWorkspaceTreePlan
>();

function packingError(
  code: WorkspaceTreePackingErrorCode,
  message: string,
  cause?: unknown,
): WorkspaceTreePackingError {
  return new WorkspaceTreePackingError(code, message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function resolveLimits(
  overrides: Partial<WorkspaceTreePackingLimits> | undefined,
): WorkspaceTreePackingLimits {
  const limits = {
    ...DEFAULT_WORKSPACE_TREE_PACKING_LIMITS,
    ...overrides,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw packingError(
        "INVALID_LIMIT",
        `${name} must be a non-negative safe integer.`,
      );
    }
  }
  return limits;
}

function fingerprint(info: Awaited<ReturnType<typeof lstat>>): FileFingerprint {
  const bigint = info as unknown as {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mode: bigint;
    nlink: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
  };
  return {
    dev: bigint.dev,
    ino: bigint.ino,
    size: bigint.size,
    mode: bigint.mode,
    nlink: bigint.nlink,
    mtimeNs: bigint.mtimeNs,
    ctimeNs: bigint.ctimeNs,
  };
}

function sameFingerprint(
  left: FileFingerprint,
  right: FileFingerprint,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function portableMode(mode: bigint): "0644" | "0755" {
  return (mode & 0o111n) === 0n ? "0644" : "0755";
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function insideOrEqual(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

async function requireRealDirectory(
  path: string,
  label: string,
): Promise<void> {
  const info = await lstat(path, { bigint: true }).catch((error: unknown) => {
    throw packingError(
      "UNSAFE_ENTRY",
      `${label} is unavailable: ${path}`,
      error,
    );
  });
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw packingError("UNSAFE_ENTRY", `${label} must be a real directory.`);
  }
}

function excludedPath(
  portableRelativePath: string,
): WorkspaceTreeExcludedReason | undefined {
  const path = portableRelativePath.toLocaleLowerCase("en-US");
  if (path === ".git" || path.startsWith(".git/")) return "vcs-private";
  if (path === ".clash/project.toml") return "target-marker-regenerated";
  if (path === ".clash/observed.json") return "runtime-private";
  if (
    path === ".clash/runtime" ||
    path.startsWith(".clash/runtime/") ||
    path === ".clash/run" ||
    path.startsWith(".clash/run/") ||
    path === ".clash/local-api" ||
    path.startsWith(".clash/local-api/")
  ) {
    return "runtime-private";
  }
  if (path === ".clash/cache" || path.startsWith(".clash/cache/")) {
    return "cache";
  }
  if (
    path === "assets/links" ||
    path.startsWith("assets/links/") ||
    path === ".clash/assets/links" ||
    path.startsWith(".clash/assets/links/") ||
    path === ".clash/asset-links" ||
    path.startsWith(".clash/asset-links/")
  ) {
    return "runtime-private";
  }
  return undefined;
}

function secretLikePath(portableRelativePath: string): boolean {
  const segments = portableRelativePath.toLocaleLowerCase("en-US").split("/");
  const basename = segments.at(-1)!;
  if (basename === ".env.example") return false;
  if (basename.startsWith(".env")) return true;
  if (basename === ".npmrc") return true;
  if (segments.some((segment) => segment === ".ssh" || segment === ".aws")) {
    return true;
  }
  if (
    /\.(?:key|pem|p12|pfx)$/u.test(basename) ||
    /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/u.test(basename)
  ) {
    return true;
  }
  return segments.some((segment) =>
    /(?:^|[._-])(?:credentials?|tokens?|secrets?|keys?|private[._-]?key|api[._-]?key)(?:[._-]|$)/u.test(
      segment,
    ),
  );
}

/** Pure product policy shared by export planning and untrusted bundle import. */
export function workspaceTreePathPolicy(
  portableRelativePath: string,
): WorkspaceTreePathPolicy {
  const exclusion = excludedPath(portableRelativePath);
  if (exclusion) return { decision: "exclude", reason: exclusion };
  if (secretLikePath(portableRelativePath)) {
    return { decision: "reject", reason: "secret-like" };
  }
  return { decision: "include" };
}

function snapshotOf(input: {
  root: FileFingerprint;
  entries: readonly PlannedEntry[];
  excluded: readonly WorkspaceTreeExcludedPath[];
}): string {
  const fingerprintText = (value: FileFingerprint) =>
    [
      value.dev,
      value.ino,
      value.size,
      value.mode,
      value.nlink,
      value.mtimeNs,
      value.ctimeNs,
    ].join(":");
  return [
    fingerprintText(input.root),
    ...input.entries.map(
      (entry) =>
        `${entry.actualSegments.join("/")}\0${entry.bundlePath}\0${fingerprintText(entry.fingerprint)}`,
    ),
    ...input.excluded.map(
      (entry) => `excluded\0${entry.path}\0${entry.reason}`,
    ),
  ].join("\n");
}

async function scanWorkspaceTree(input: {
  sourceRoot: string;
  bundleRoot: string;
  limits: WorkspaceTreePackingLimits;
}): Promise<InternalWorkspaceTreePlan> {
  await Promise.all([
    requireRealDirectory(input.sourceRoot, "Workspace source root"),
    requireRealDirectory(input.bundleRoot, "Workspace bundle root"),
  ]);
  const [sourceRoot, bundleRoot] = await Promise.all([
    realpath(input.sourceRoot),
    realpath(input.bundleRoot),
  ]);
  if (
    insideOrEqual(sourceRoot, bundleRoot) ||
    insideOrEqual(bundleRoot, sourceRoot)
  ) {
    throw packingError(
      "SOURCE_OUTPUT_OVERLAP",
      "Workspace source and staging bundle roots must not overlap.",
    );
  }
  const rootInfo = await lstat(sourceRoot, { bigint: true });
  const sourceRootFingerprint = fingerprint(rootInfo);
  const entries: PlannedEntry[] = [];
  const excluded: WorkspaceTreeExcludedPath[] = [];
  const collisionPaths = new Map<string, string>();
  let totalBytes = 0;

  function registerPortablePath(portableRelativePath: string): string {
    const bundlePath = `workspace/${portableRelativePath}`;
    const collisionKey = bundlePath.normalize("NFC").toLocaleLowerCase("en-US");
    const collision = collisionPaths.get(collisionKey);
    if (collision !== undefined) {
      throw packingError(
        "PATH_COLLISION",
        `Workspace path ${bundlePath} collides with ${collision}.`,
      );
    }
    collisionPaths.set(collisionKey, bundlePath);
    return bundlePath;
  }

  async function walk(
    directory: string,
    actualSegments: string[],
    portableSegments: string[],
  ): Promise<void> {
    const directoryInfoBefore = await lstat(directory, { bigint: true });
    if (
      !directoryInfoBefore.isDirectory() ||
      directoryInfoBefore.isSymbolicLink()
    ) {
      throw packingError(
        "UNSAFE_ENTRY",
        `Workspace directory changed into an unsafe entry: ${actualSegments.join("/") || "."}`,
      );
    }
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => lexicalCompare(left.name, right.name));
    for (const child of children) {
      if (
        !child.name ||
        child.name.includes("\0") ||
        child.name.includes("/") ||
        child.name.includes("\\")
      ) {
        throw packingError(
          "UNSAFE_ENTRY",
          `Workspace entry has a non-portable name: ${child.name}`,
        );
      }
      const childActualSegments = [...actualSegments, child.name];
      const childPortableSegments = [
        ...portableSegments,
        child.name.normalize("NFC"),
      ];
      const portableRelativePath = childPortableSegments.join("/");
      if (portableRelativePath.length > 4_086) {
        throw packingError(
          "UNSAFE_ENTRY",
          `Workspace path is too long to materialize: ${portableRelativePath}`,
        );
      }
      const policy = workspaceTreePathPolicy(portableRelativePath);
      if (policy.decision === "exclude") {
        excluded.push({ path: portableRelativePath, reason: policy.reason });
        continue;
      }
      if (policy.decision === "reject") {
        throw packingError(
          "SECRET_FILE",
          `Secret-like workspace path cannot be exported: ${portableRelativePath}`,
        );
      }

      const path = join(directory, child.name);
      const info = await lstat(path, { bigint: true }).catch(
        (error: unknown) => {
          throw packingError(
            "UNSAFE_ENTRY",
            `Workspace entry changed during planning: ${portableRelativePath}`,
            error,
          );
        },
      );
      if (info.isSymbolicLink()) {
        throw packingError(
          "UNSAFE_ENTRY",
          `Workspace symlinks are not exportable: ${portableRelativePath}`,
        );
      }
      if (info.isDirectory()) {
        registerPortablePath(portableRelativePath);
        await walk(path, childActualSegments, childPortableSegments);
        continue;
      }
      if (!info.isFile() || info.nlink !== 1n) {
        throw packingError(
          "UNSAFE_ENTRY",
          `Workspace payload must be a singly-linked regular file: ${portableRelativePath}`,
        );
      }
      const bundlePath = registerPortablePath(portableRelativePath);
      if (info.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw packingError(
          "FILE_BYTES_LIMIT_EXCEEDED",
          `Workspace file is too large to represent safely: ${portableRelativePath}`,
        );
      }
      const bytes = Number(info.size);
      if (bytes > input.limits.maxFileBytes) {
        throw packingError(
          "FILE_BYTES_LIMIT_EXCEEDED",
          `Workspace file exceeds the configured byte limit: ${portableRelativePath}`,
        );
      }
      if (entries.length >= input.limits.maxFileCount) {
        throw packingError(
          "FILE_COUNT_LIMIT_EXCEEDED",
          "Workspace tree exceeds the configured file-count limit.",
        );
      }
      if (bytes > input.limits.maxTotalBytes - totalBytes) {
        throw packingError(
          "TOTAL_BYTES_LIMIT_EXCEEDED",
          "Workspace tree exceeds the configured total-byte limit.",
        );
      }
      totalBytes += bytes;
      const entryFingerprint = fingerprint(info);
      entries.push({
        actualSegments: childActualSegments,
        portableRelativePath,
        bundlePath,
        fingerprint: entryFingerprint,
        mode: portableMode(entryFingerprint.mode),
      });
    }
    const directoryInfoAfter = await lstat(directory, { bigint: true });
    if (
      directoryInfoBefore.dev !== directoryInfoAfter.dev ||
      directoryInfoBefore.ino !== directoryInfoAfter.ino ||
      directoryInfoBefore.mtimeNs !== directoryInfoAfter.mtimeNs ||
      directoryInfoBefore.ctimeNs !== directoryInfoAfter.ctimeNs
    ) {
      throw packingError(
        "SOURCE_CHANGED",
        `Workspace directory changed during planning: ${actualSegments.join("/") || "."}`,
      );
    }
  }

  await walk(sourceRoot, [], []);
  entries.sort((left, right) =>
    lexicalCompare(left.bundlePath, right.bundlePath),
  );
  excluded.sort((left, right) => lexicalCompare(left.path, right.path));
  const publicPlan: WorkspaceTreePlan = Object.freeze({
    sourceRoot,
    bundleRoot,
    limits: Object.freeze({ ...input.limits }),
    files: Object.freeze(
      entries.map((entry) =>
        Object.freeze({
          path: entry.bundlePath,
          bytes: Number(entry.fingerprint.size),
          mode: entry.mode,
        }),
      ),
    ),
    excluded: Object.freeze(
      excluded.map((entry) => Object.freeze({ ...entry })),
    ),
  });
  const scanned: InternalWorkspaceTreePlan = {
    publicPlan,
    entries,
    snapshot: "",
  };
  scanned.snapshot = snapshotOf({
    root: sourceRootFingerprint,
    entries,
    excluded,
  });
  return scanned;
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      null,
    );
    if (bytesWritten === 0) {
      throw packingError(
        "SOURCE_CHANGED",
        "Workspace materialization made no write progress.",
      );
    }
    offset += bytesWritten;
  }
}

export async function planWorkspaceTree(
  input: PlanWorkspaceTreeInput,
): Promise<WorkspaceTreePlan> {
  const scanned = await scanWorkspaceTree({
    sourceRoot: resolve(input.sourceRoot),
    bundleRoot: resolve(input.bundleRoot),
    limits: resolveLimits(input.limits),
  });
  internalPlans.set(scanned.publicPlan, scanned);
  return scanned.publicPlan;
}

export async function materializeWorkspaceTree(
  plan: WorkspaceTreePlan,
): Promise<MaterializedWorkspaceTree> {
  const internal = internalPlans.get(plan);
  if (!internal || internal.publicPlan !== plan) {
    throw packingError(
      "SOURCE_CHANGED",
      "Workspace tree plan is not an active plan from this runtime.",
    );
  }
  const current = await scanWorkspaceTree({
    sourceRoot: plan.sourceRoot,
    bundleRoot: plan.bundleRoot,
    limits: plan.limits,
  });
  if (current.snapshot !== internal.snapshot) {
    throw packingError(
      "SOURCE_CHANGED",
      "Workspace tree changed after it was planned.",
    );
  }

  const targetWorkspace = join(plan.bundleRoot, "workspace");
  const target = await lstat(targetWorkspace).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (target !== undefined) {
    throw packingError(
      "TARGET_EXISTS",
      "Workspace bundle already contains a workspace payload root.",
    );
  }

  const temporaryWorkspace = join(
    plan.bundleRoot,
    `.workspace.${randomUUID()}.tmp`,
  );
  await mkdir(temporaryWorkspace, { mode: 0o700 });
  const files: WorkspaceBundleFile[] = [];
  let totalBytes = 0;
  try {
    for (const entry of internal.entries) {
      const sourcePath = join(plan.sourceRoot, ...entry.actualSegments);
      const destinationPath = join(
        temporaryWorkspace,
        ...entry.portableRelativePath.split("/"),
      );
      await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
      let sourceHandle: Awaited<ReturnType<typeof open>> | undefined;
      let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        sourceHandle = await open(
          sourcePath,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        ).catch((error: unknown) => {
          throw packingError(
            "SOURCE_CHANGED",
            `Workspace source changed before it could be opened: ${entry.bundlePath}`,
            error,
          );
        });
        const openedInfo = await sourceHandle.stat({ bigint: true });
        const openedFingerprint = fingerprint(
          openedInfo as unknown as Awaited<ReturnType<typeof lstat>>,
        );
        if (!openedInfo.isFile() || openedInfo.nlink !== 1n) {
          throw packingError(
            "UNSAFE_ENTRY",
            `Workspace source is no longer a singly-linked regular file: ${entry.bundlePath}`,
          );
        }
        if (!sameFingerprint(openedFingerprint, entry.fingerprint)) {
          throw packingError(
            "SOURCE_CHANGED",
            `Workspace source changed after planning: ${entry.bundlePath}`,
          );
        }
        destinationHandle = await open(
          destinationPath,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            constants.O_NOFOLLOW,
          0o600,
        );
        const digest = createHash("sha256");
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let bytes = 0;
        while (true) {
          const { bytesRead } = await sourceHandle.read(
            buffer,
            0,
            buffer.byteLength,
            null,
          );
          if (bytesRead === 0) break;
          if (
            bytesRead > plan.limits.maxFileBytes - bytes ||
            bytesRead > plan.limits.maxTotalBytes - totalBytes - bytes ||
            bytesRead > Number(entry.fingerprint.size) - bytes
          ) {
            throw packingError(
              "SOURCE_CHANGED",
              `Workspace source grew during materialization: ${entry.bundlePath}`,
            );
          }
          const chunk = buffer.subarray(0, bytesRead);
          digest.update(chunk);
          await writeAll(destinationHandle, chunk);
          bytes += bytesRead;
        }
        const finalInfo = await sourceHandle.stat({ bigint: true });
        const finalFingerprint = fingerprint(
          finalInfo as unknown as Awaited<ReturnType<typeof lstat>>,
        );
        if (
          bytes !== Number(entry.fingerprint.size) ||
          !sameFingerprint(openedFingerprint, finalFingerprint)
        ) {
          throw packingError(
            "SOURCE_CHANGED",
            `Workspace source changed while it was read: ${entry.bundlePath}`,
          );
        }
        await destinationHandle.sync();
        await destinationHandle.close();
        destinationHandle = undefined;
        await chmod(destinationPath, entry.mode === "0755" ? 0o755 : 0o644);
        files.push({
          path: entry.bundlePath,
          role: "workspace",
          bytes,
          sha256: digest.digest("hex"),
          mode: entry.mode,
        });
        totalBytes += bytes;
      } finally {
        await Promise.all([
          sourceHandle?.close().catch(() => undefined),
          destinationHandle?.close().catch(() => undefined),
        ]);
      }
    }

    const finalTree = await scanWorkspaceTree({
      sourceRoot: plan.sourceRoot,
      bundleRoot: plan.bundleRoot,
      limits: plan.limits,
    });
    if (finalTree.snapshot !== internal.snapshot) {
      throw packingError(
        "SOURCE_CHANGED",
        "Workspace tree changed while it was materialized.",
      );
    }
    await rename(temporaryWorkspace, targetWorkspace).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST" || error.code === "ENOTEMPTY") {
          throw packingError(
            "TARGET_EXISTS",
            "Workspace bundle already contains a workspace payload root.",
            error,
          );
        }
        throw error;
      },
    );
    return {
      files,
      excluded: plan.excluded.map((entry) => ({ ...entry })),
      totalBytes,
    };
  } catch (error) {
    await rm(temporaryWorkspace, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}
