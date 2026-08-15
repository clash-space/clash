import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import {
  WORKSPACE_BUNDLE_MANIFEST_PATH,
  WorkspaceBundleFileSchema,
  WorkspaceBundleManifestSchema,
  type WorkspaceBundleFile,
  type WorkspaceBundleManifest,
} from "@clash/shared-types";
import { workspaceTreePathPolicy } from "./workspace-tree.js";

const ZERO_SHA256 = "0".repeat(64);
export const WORKSPACE_BUNDLE_MANIFEST_FILE = WORKSPACE_BUNDLE_MANIFEST_PATH;

export type WorkspaceBundleIntegrityErrorCode =
  | "INVALID_MANIFEST"
  | "MANIFEST_BYTES_LIMIT_EXCEEDED"
  | "FILE_COUNT_LIMIT_EXCEEDED"
  | "DECLARED_BYTES_LIMIT_EXCEEDED"
  | "ACTUAL_BYTES_LIMIT_EXCEEDED"
  | "BUNDLE_DIGEST_MISMATCH"
  | "MISSING_FILE"
  | "UNDECLARED_FILE"
  | "UNSAFE_FILE"
  | "FILE_SIZE_MISMATCH"
  | "FILE_DIGEST_MISMATCH"
  | "FILE_MODE_MISMATCH"
  | "FORBIDDEN_WORKSPACE_PATH"
  | "EXCLUDED_PATH_INCLUDED"
  | "TARGET_EXISTS";

export class WorkspaceBundleIntegrityError extends Error {
  override name = "WorkspaceBundleIntegrityError";

  constructor(
    readonly code: WorkspaceBundleIntegrityErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type UnsignedWorkspaceBundleManifest = Omit<
  WorkspaceBundleManifest,
  "integrity"
>;

export interface WorkspaceBundleVerificationLimits {
  maxManifestBytes: number;
  maxFileCount: number;
  maxDeclaredTotalBytes: number;
  maxActualTotalBytes: number;
}

export interface WorkspaceBundleVerificationOptions {
  limits?: Partial<WorkspaceBundleVerificationLimits>;
}

export interface MaterializeVerifiedWorkspaceBundleFileInput {
  bundleRoot: string;
  destinationRoot: string;
  file: WorkspaceBundleFile;
}

export interface MaterializedWorkspaceBundleFile {
  path: string;
  bytes: number;
  sha256: string;
  mode: "0644" | "0755";
}

export const DEFAULT_WORKSPACE_BUNDLE_VERIFICATION_LIMITS: Readonly<WorkspaceBundleVerificationLimits> =
  Object.freeze({
    maxManifestBytes: 64 * 1024 * 1024,
    maxFileCount: 100_000,
    maxDeclaredTotalBytes: 1024 * 1024 * 1024 * 1024,
    maxActualTotalBytes: 1024 * 1024 * 1024 * 1024,
  });

function resolveVerificationLimits(
  options: WorkspaceBundleVerificationOptions,
): WorkspaceBundleVerificationLimits {
  const limits = {
    ...DEFAULT_WORKSPACE_BUNDLE_VERIFICATION_LIMITS,
    ...options.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative safe integer`);
    }
  }
  return limits;
}

function verifyManifestLimits(
  manifest: WorkspaceBundleManifest,
  limits: WorkspaceBundleVerificationLimits,
): void {
  if (manifest.files.length > limits.maxFileCount) {
    throw new WorkspaceBundleIntegrityError(
      "FILE_COUNT_LIMIT_EXCEEDED",
      "Workspace bundle declares more payload files than the configured limit",
    );
  }
  let declaredBytes = 0;
  for (const file of manifest.files) {
    if (file.bytes > limits.maxDeclaredTotalBytes - declaredBytes) {
      throw new WorkspaceBundleIntegrityError(
        "DECLARED_BYTES_LIMIT_EXCEEDED",
        "Workspace bundle declares more payload bytes than the configured limit",
      );
    }
    declaredBytes += file.bytes;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestCanonicalManifest(manifest: WorkspaceBundleManifest): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        ...manifest,
        integrity: {
          ...manifest.integrity,
          bundleDigest: ZERO_SHA256,
        },
      }),
      "utf8",
    )
    .digest("hex");
}

function workspaceSourcePath(
  file: Pick<WorkspaceBundleFile, "path" | "role">,
): string | undefined {
  if (file.role !== "workspace") return undefined;
  const prefix = "workspace/";
  return file.path.startsWith(prefix)
    ? file.path.slice(prefix.length)
    : undefined;
}

function pathsOverlap(left: string, right: string): boolean {
  const normalizedLeft = left.toLocaleLowerCase("en-US");
  const normalizedRight = right.toLocaleLowerCase("en-US");
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`)
  );
}

function assertWorkspaceContentPolicy(manifest: WorkspaceBundleManifest): void {
  for (const file of manifest.files) {
    const sourcePath = workspaceSourcePath(file);
    if (sourcePath === undefined) continue;
    const policy = workspaceTreePathPolicy(sourcePath);
    if (policy.decision !== "include") {
      throw new WorkspaceBundleIntegrityError(
        "FORBIDDEN_WORKSPACE_PATH",
        `Workspace bundle cannot include protected or secret-like worktree path: ${sourcePath}`,
      );
    }
    const excluded = manifest.excluded.find((entry) =>
      pathsOverlap(sourcePath, entry.path),
    );
    if (excluded) {
      throw new WorkspaceBundleIntegrityError(
        "EXCLUDED_PATH_INCLUDED",
        `Workspace bundle path ${sourcePath} overlaps excluded path ${excluded.path}`,
      );
    }
  }
}

export function createWorkspaceBundleManifest(
  input: UnsignedWorkspaceBundleManifest,
): WorkspaceBundleManifest {
  const unsigned = WorkspaceBundleManifestSchema.parse({
    ...input,
    integrity: {
      algorithm: "sha256",
      canonicalization: "clash.workspace-manifest-json.v1",
      bundleDigest: ZERO_SHA256,
    },
  });
  const manifest = WorkspaceBundleManifestSchema.parse({
    ...unsigned,
    integrity: {
      ...unsigned.integrity,
      bundleDigest: digestCanonicalManifest(unsigned),
    },
  });
  assertWorkspaceContentPolicy(manifest);
  return manifest;
}

export function workspaceBundleDigest(
  manifestInput: WorkspaceBundleManifest,
): string {
  return digestCanonicalManifest(
    WorkspaceBundleManifestSchema.parse(manifestInput),
  );
}

function portablePath(root: string, path: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...path.split("/"));
  const inside = relative(resolvedRoot, target);
  if (!inside || inside.startsWith(`..${sep}`) || inside === "..") {
    throw new WorkspaceBundleIntegrityError(
      "UNSAFE_FILE",
      `Workspace bundle path escapes its root: ${path}`,
    );
  }
  return target;
}

async function requireRealDirectory(
  path: string,
  label: string,
): Promise<void> {
  const info = await lstat(path).catch((error: unknown) => {
    throw new WorkspaceBundleIntegrityError(
      "MISSING_FILE",
      `${label} is missing: ${path}`,
      { cause: error },
    );
  });
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new WorkspaceBundleIntegrityError(
      "UNSAFE_FILE",
      `${label} must be a real directory`,
    );
  }
}

async function assertRealDirectoryChain(
  root: string,
  relativeDirectory: string,
): Promise<void> {
  await requireRealDirectory(root, "Workspace bundle root");
  if (relativeDirectory === ".") {
    return;
  }
  let current = resolve(root);
  for (const segment of relativeDirectory.split("/")) {
    current = join(current, segment);
    const info = await lstat(current).catch((error: unknown) => {
      throw new WorkspaceBundleIntegrityError(
        "MISSING_FILE",
        `Workspace bundle directory is missing: ${relativeDirectory}`,
        { cause: error },
      );
    });
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new WorkspaceBundleIntegrityError(
        "UNSAFE_FILE",
        `Workspace bundle path traverses a non-directory: ${relativeDirectory}`,
      );
    }
  }
}

async function ensureRealDirectoryChain(
  root: string,
  relativeDirectory: string,
): Promise<void> {
  await requireRealDirectory(root, "Workspace bundle destination root");
  if (relativeDirectory === ".") {
    return;
  }
  let current = resolve(root);
  for (const segment of relativeDirectory.split("/")) {
    current = join(current, segment);
    await mkdir(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") {
        throw error;
      }
    });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new WorkspaceBundleIntegrityError(
        "UNSAFE_FILE",
        `Workspace bundle destination traverses a non-directory: ${relativeDirectory}`,
      );
    }
  }
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
      throw new Error(
        "Workspace bundle materialization made no write progress",
      );
    }
    offset += bytesWritten;
  }
}

/**
 * Copies one declared payload into an existing, caller-owned staging root.
 * The destination becomes visible only after the bytes read from the opened
 * source handle match the declaration.
 */
export async function materializeVerifiedWorkspaceBundleFile(
  input: MaterializeVerifiedWorkspaceBundleFileInput,
): Promise<MaterializedWorkspaceBundleFile> {
  const parsed = WorkspaceBundleFileSchema.safeParse(input.file);
  if (!parsed.success) {
    throw new WorkspaceBundleIntegrityError(
      "INVALID_MANIFEST",
      `Workspace bundle file descriptor is invalid: ${parsed.error.issues[0]?.message ?? "invalid descriptor"}`,
    );
  }
  const file = parsed.data;
  const workspacePath = workspaceSourcePath(file);
  if (
    file.role === "workspace" &&
    (workspacePath === undefined ||
      workspaceTreePathPolicy(workspacePath).decision !== "include")
  ) {
    throw new WorkspaceBundleIntegrityError(
      "FORBIDDEN_WORKSPACE_PATH",
      `Workspace bundle cannot materialize protected or secret-like worktree path: ${workspacePath ?? file.path}`,
    );
  }
  await assertRealDirectoryChain(input.bundleRoot, dirname(file.path));
  await ensureRealDirectoryChain(input.destinationRoot, dirname(file.path));

  const sourcePath = portablePath(input.bundleRoot, file.path);
  const destinationPath = portablePath(input.destinationRoot, file.path);
  const temporaryPath = join(
    dirname(destinationPath),
    `.${basename(destinationPath)}.${randomUUID()}.tmp`,
  );
  let sourceHandle: Awaited<ReturnType<typeof open>> | undefined;
  let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
  let published = false;
  try {
    sourceHandle = await open(
      sourcePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const initialInfo = await sourceHandle.stat();
    if (!initialInfo.isFile() || initialInfo.nlink !== 1) {
      throw new WorkspaceBundleIntegrityError(
        "UNSAFE_FILE",
        `Workspace bundle payload must be a singly-linked regular file: ${file.path}`,
      );
    }
    destinationHandle = await open(
      temporaryPath,
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
      if (bytesRead === 0) {
        break;
      }
      if (bytesRead > file.bytes - bytes) {
        throw new WorkspaceBundleIntegrityError(
          "FILE_SIZE_MISMATCH",
          `Workspace bundle payload size changed: ${file.path}`,
        );
      }
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      await writeAll(destinationHandle, chunk);
      bytes += bytesRead;
    }

    const finalInfo = await sourceHandle.stat();
    if (
      !finalInfo.isFile() ||
      finalInfo.nlink !== 1 ||
      finalInfo.size !== bytes ||
      bytes !== file.bytes
    ) {
      throw new WorkspaceBundleIntegrityError(
        "FILE_SIZE_MISMATCH",
        `Workspace bundle payload size changed: ${file.path}`,
      );
    }
    const sha256 = digest.digest("hex");
    if (sha256 !== file.sha256) {
      throw new WorkspaceBundleIntegrityError(
        "FILE_DIGEST_MISMATCH",
        `Workspace bundle payload digest changed: ${file.path}`,
      );
    }
    const executable = (finalInfo.mode & 0o111) !== 0;
    if (executable !== (file.mode === "0755")) {
      throw new WorkspaceBundleIntegrityError(
        "FILE_MODE_MISMATCH",
        `Workspace bundle payload executable mode changed: ${file.path}`,
      );
    }
    await destinationHandle.chmod(file.mode === "0755" ? 0o755 : 0o644);
    await destinationHandle.sync();
    await destinationHandle.close();
    destinationHandle = undefined;
    try {
      await link(temporaryPath, destinationPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new WorkspaceBundleIntegrityError(
          "TARGET_EXISTS",
          `Workspace bundle destination already exists: ${file.path}`,
          { cause: error },
        );
      }
      throw error;
    }
    published = true;
    await unlink(temporaryPath).catch(() => undefined);
    return { path: file.path, bytes, sha256, mode: file.mode };
  } catch (error) {
    if (error instanceof WorkspaceBundleIntegrityError) {
      throw error;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") {
      throw new WorkspaceBundleIntegrityError(
        "UNSAFE_FILE",
        `Workspace bundle payload must not be a symlink: ${file.path}`,
        { cause: error },
      );
    }
    if (code === "ENOENT") {
      throw new WorkspaceBundleIntegrityError(
        "MISSING_FILE",
        `Workspace bundle payload is missing: ${file.path}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    await sourceHandle?.close().catch(() => undefined);
    await destinationHandle?.close().catch(() => undefined);
    if (!published) {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

interface OpenedPayloadFacts {
  bytes: number;
  sha256: string;
  executable: boolean;
}

async function digestOpenedPayloadFile(
  path: string,
  displayPath: string,
  maxBytes: number,
): Promise<OpenedPayloadFacts> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const initialInfo = await handle.stat();
    if (!initialInfo.isFile() || initialInfo.nlink !== 1) {
      throw new WorkspaceBundleIntegrityError(
        "UNSAFE_FILE",
        `Workspace bundle payload must be a singly-linked regular file: ${displayPath}`,
      );
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.byteLength,
        null,
      );
      if (bytesRead === 0) {
        break;
      }
      if (bytesRead > maxBytes - bytes) {
        throw new WorkspaceBundleIntegrityError(
          "ACTUAL_BYTES_LIMIT_EXCEEDED",
          "Workspace bundle contains more payload bytes than the configured limit",
        );
      }
      digest.update(buffer.subarray(0, bytesRead));
      bytes += bytesRead;
    }
    const finalInfo = await handle.stat();
    if (!finalInfo.isFile() || finalInfo.nlink !== 1) {
      throw new WorkspaceBundleIntegrityError(
        "UNSAFE_FILE",
        `Workspace bundle payload must be a singly-linked regular file: ${displayPath}`,
      );
    }
    if (finalInfo.size !== bytes) {
      throw new WorkspaceBundleIntegrityError(
        "FILE_SIZE_MISMATCH",
        `Workspace bundle payload size changed while reading: ${displayPath}`,
      );
    }
    return {
      bytes,
      sha256: digest.digest("hex"),
      executable: (finalInfo.mode & 0o111) !== 0,
    };
  } catch (error) {
    if (error instanceof WorkspaceBundleIntegrityError) {
      throw error;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP") {
      throw new WorkspaceBundleIntegrityError(
        "UNSAFE_FILE",
        `Workspace bundle payload must not be a symlink: ${displayPath}`,
        { cause: error },
      );
    }
    if (code === "ENOENT") {
      throw new WorkspaceBundleIntegrityError(
        "MISSING_FILE",
        `Workspace bundle payload is missing: ${displayPath}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readManifestWithinLimit(
  path: string,
  maxBytes: number,
): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const initialInfo = await handle.stat();
    if (!initialInfo.isFile() || initialInfo.nlink !== 1) {
      throw new Error("manifest is not a regular file");
    }
    if (initialInfo.size > maxBytes) {
      throw new WorkspaceBundleIntegrityError(
        "MANIFEST_BYTES_LIMIT_EXCEEDED",
        "Workspace bundle manifest exceeds the configured byte limit",
      );
    }
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.byteLength,
        null,
      );
      if (bytesRead === 0) {
        break;
      }
      if (bytesRead > maxBytes - bytes) {
        throw new WorkspaceBundleIntegrityError(
          "MANIFEST_BYTES_LIMIT_EXCEEDED",
          "Workspace bundle manifest exceeds the configured byte limit",
        );
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      bytes += bytesRead;
    }
    const finalInfo = await handle.stat();
    if (
      !finalInfo.isFile() ||
      finalInfo.nlink !== 1 ||
      finalInfo.size !== bytes
    ) {
      throw new Error("manifest changed while it was being read");
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}

interface WorkspaceBundlePayloadListing {
  paths: string[];
  payloadFiles: number;
  payloadBytes: number;
}

async function walkPayloadFiles(
  root: string,
  limits: WorkspaceBundleVerificationLimits,
  listing: WorkspaceBundlePayloadListing,
  current = "",
): Promise<void> {
  const directory = current ? portablePath(root, current) : resolve(root);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = current ? `${current}/${entry.name}` : entry.name;
    if (path !== path.normalize("NFC")) {
      throw new WorkspaceBundleIntegrityError(
        "UNSAFE_FILE",
        `Workspace bundle entry is not NFC-normalized: ${path}`,
      );
    }
    const info = await lstat(portablePath(root, path));
    if (info.isSymbolicLink()) {
      throw new WorkspaceBundleIntegrityError(
        "UNSAFE_FILE",
        `Workspace bundle contains a symlink: ${path}`,
      );
    }
    if (info.isDirectory()) {
      await walkPayloadFiles(root, limits, listing, path);
      continue;
    }
    if (!info.isFile() || info.nlink !== 1) {
      throw new WorkspaceBundleIntegrityError(
        "UNSAFE_FILE",
        `Workspace bundle contains a non-singly-linked entry: ${path}`,
      );
    }
    listing.paths.push(path);
    if (path !== WORKSPACE_BUNDLE_MANIFEST_FILE) {
      listing.payloadFiles += 1;
      if (listing.payloadFiles > limits.maxFileCount) {
        throw new WorkspaceBundleIntegrityError(
          "FILE_COUNT_LIMIT_EXCEEDED",
          "Workspace bundle contains more payload files than the configured limit",
        );
      }
      if (info.size > limits.maxActualTotalBytes - listing.payloadBytes) {
        throw new WorkspaceBundleIntegrityError(
          "ACTUAL_BYTES_LIMIT_EXCEEDED",
          "Workspace bundle contains more payload bytes than the configured limit",
        );
      }
      listing.payloadBytes += info.size;
    }
  }
}

async function listPayloadFiles(
  root: string,
  limits: WorkspaceBundleVerificationLimits,
): Promise<WorkspaceBundlePayloadListing> {
  const listing: WorkspaceBundlePayloadListing = {
    paths: [],
    payloadFiles: 0,
    payloadBytes: 0,
  };
  await walkPayloadFiles(root, limits, listing);
  listing.paths.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return listing;
}

async function verifyPayloadFiles(
  bundleRoot: string,
  manifest: WorkspaceBundleManifest,
  limits: WorkspaceBundleVerificationLimits,
): Promise<void> {
  const rootInfo = await lstat(bundleRoot).catch((error: unknown) => {
    throw new WorkspaceBundleIntegrityError(
      "MISSING_FILE",
      `Workspace bundle root is missing: ${bundleRoot}`,
      { cause: error },
    );
  });
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new WorkspaceBundleIntegrityError(
      "UNSAFE_FILE",
      "Workspace bundle root must be a real directory",
    );
  }

  const expected = new Set(manifest.files.map((file) => file.path));
  const actual = await listPayloadFiles(bundleRoot, limits);
  for (const path of actual.paths) {
    if (path === WORKSPACE_BUNDLE_MANIFEST_FILE) {
      continue;
    }
    if (!expected.has(path)) {
      throw new WorkspaceBundleIntegrityError(
        "UNDECLARED_FILE",
        `Workspace bundle contains undeclared file: ${path}`,
      );
    }
  }

  let verifiedBytes = 0;
  for (const file of manifest.files) {
    const path = portablePath(bundleRoot, file.path);
    let pathInfo;
    try {
      pathInfo = await lstat(path);
    } catch (error) {
      throw new WorkspaceBundleIntegrityError(
        "MISSING_FILE",
        `Workspace bundle payload is missing: ${file.path}`,
        { cause: error },
      );
    }
    if (
      !pathInfo.isFile() ||
      pathInfo.isSymbolicLink() ||
      pathInfo.nlink !== 1
    ) {
      throw new WorkspaceBundleIntegrityError(
        "UNSAFE_FILE",
        `Workspace bundle payload must be a singly-linked regular file: ${file.path}`,
      );
    }
    const facts = await digestOpenedPayloadFile(
      path,
      file.path,
      limits.maxActualTotalBytes - verifiedBytes,
    );
    if (facts.bytes !== file.bytes) {
      throw new WorkspaceBundleIntegrityError(
        "FILE_SIZE_MISMATCH",
        `Workspace bundle payload size changed: ${file.path}`,
      );
    }
    if (facts.sha256 !== file.sha256) {
      throw new WorkspaceBundleIntegrityError(
        "FILE_DIGEST_MISMATCH",
        `Workspace bundle payload digest changed: ${file.path}`,
      );
    }
    if (facts.executable !== (file.mode === "0755")) {
      throw new WorkspaceBundleIntegrityError(
        "FILE_MODE_MISMATCH",
        `Workspace bundle payload executable mode changed: ${file.path}`,
      );
    }
    verifiedBytes += facts.bytes;
  }
}

export async function writeWorkspaceBundleManifest(
  bundleRoot: string,
  input: UnsignedWorkspaceBundleManifest,
  options: WorkspaceBundleVerificationOptions = {},
): Promise<WorkspaceBundleManifest> {
  const manifest = createWorkspaceBundleManifest(input);
  const limits = resolveVerificationLimits(options);
  verifyManifestLimits(manifest, limits);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > limits.maxManifestBytes) {
    throw new WorkspaceBundleIntegrityError(
      "MANIFEST_BYTES_LIMIT_EXCEEDED",
      "Workspace bundle manifest exceeds the configured byte limit",
    );
  }
  await verifyPayloadFiles(bundleRoot, manifest, limits);
  const path = join(bundleRoot, WORKSPACE_BUNDLE_MANIFEST_FILE);
  await mkdir(bundleRoot, { recursive: true });
  await writeFile(path, serialized, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o644,
  });
  await chmod(path, 0o644).catch(() => undefined);
  return manifest;
}

export async function verifyWorkspaceBundleDirectory(
  bundleRoot: string,
  options: WorkspaceBundleVerificationOptions = {},
): Promise<{
  manifest: WorkspaceBundleManifest;
  filesVerified: number;
}> {
  const limits = resolveVerificationLimits(options);
  const manifestPath = portablePath(bundleRoot, WORKSPACE_BUNDLE_MANIFEST_FILE);
  let raw: unknown;
  try {
    raw = await readManifestWithinLimit(manifestPath, limits.maxManifestBytes);
  } catch (error) {
    if (error instanceof WorkspaceBundleIntegrityError) {
      throw error;
    }
    throw new WorkspaceBundleIntegrityError(
      "INVALID_MANIFEST",
      "Workspace bundle manifest is missing or invalid",
      { cause: error },
    );
  }
  const parsed = WorkspaceBundleManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkspaceBundleIntegrityError(
      "INVALID_MANIFEST",
      `Workspace bundle manifest violates the v1 contract: ${parsed.error.issues[0]?.message ?? "invalid manifest"}`,
    );
  }
  const manifest = parsed.data;
  assertWorkspaceContentPolicy(manifest);
  verifyManifestLimits(manifest, limits);
  if (workspaceBundleDigest(manifest) !== manifest.integrity.bundleDigest) {
    throw new WorkspaceBundleIntegrityError(
      "BUNDLE_DIGEST_MISMATCH",
      "Workspace bundle manifest digest does not match its canonical content",
    );
  }
  await verifyPayloadFiles(bundleRoot, manifest, limits);
  return { manifest, filesVerified: manifest.files.length };
}
