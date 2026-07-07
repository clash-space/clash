import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

export function assetRoot(dataDir: string): string {
  return join(dataDir, "assets");
}

export function normalizeAssetStorageKey(storageKey: string): string {
  const raw = storageKey.trim();
  if (!raw || raw.includes("\0") || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) {
    throw new Error("Invalid asset storage key");
  }
  const slashKey = raw.replace(/\\/g, "/");
  const segments = slashKey.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid asset storage key");
  }
  return normalize(slashKey).replace(/\\/g, "/");
}

function inferClashRoot(dataDir: string, explicit?: string): string {
  if (explicit?.trim()) return resolve(explicit);
  const resolved = resolve(dataDir);
  return basename(resolved) === "local-api" ? dirname(resolved) : resolved;
}

export function localBlobAssetPath(clashRoot: string, storageKey: string): string {
  const root = join(clashRoot, "assets", "blobs");
  const blobKey = storageKey.slice("local-blobs/".length);
  const resolved = normalize(join(root, blobKey));
  const rel = relative(root, resolved);
  if (!blobKey || rel.startsWith("..") || rel === "..") {
    throw new Error("Invalid local blob path");
  }
  return resolved;
}

function assetPath(dataDir: string, storageKey: string, clashRoot?: string): string {
  const normalizedKey = normalizeAssetStorageKey(storageKey);
  if (normalizedKey.startsWith("local-blobs/")) {
    return localBlobAssetPath(inferClashRoot(dataDir, clashRoot), normalizedKey);
  }
  const root = assetRoot(dataDir);
  const resolved = normalize(join(root, normalizedKey));
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error("Invalid asset path");
  }
  return resolved;
}

type AssetPathCandidate = {
  ownerRoot: string;
  root: string;
  path: string;
};

function localAssetPathCandidate(dataDir: string, storageKey: string, clashRoot?: string): AssetPathCandidate {
  const normalizedKey = normalizeAssetStorageKey(storageKey);
  if (normalizedKey.startsWith("local-blobs/")) {
    const ownerRoot = inferClashRoot(dataDir, clashRoot);
    const root = join(ownerRoot, "assets", "blobs");
    return { ownerRoot, root, path: localBlobAssetPath(ownerRoot, normalizedKey) };
  }
  const ownerRoot = resolve(dataDir);
  return { ownerRoot, root: assetRoot(dataDir), path: assetPath(dataDir, normalizedKey, clashRoot) };
}

function assertRealAssetPathInsideRoot(rootRealPath: string, targetRealPath: string): void {
  const rel = relative(rootRealPath, targetRealPath);
  if (rel.startsWith("..") || rel === ".." || isAbsolute(rel)) {
    throw new Error("Asset path escapes local asset storage");
  }
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function assetPathForRead(dataDir: string, storageKey: string, clashRoot?: string): Promise<string> {
  const candidate = localAssetPathCandidate(dataDir, storageKey, clashRoot);
  const ownerRootRealPath = await realpath(candidate.ownerRoot);
  const rootRealPath = await realpath(candidate.root);
  assertRealAssetPathInsideRoot(ownerRootRealPath, rootRealPath);
  const targetRealPath = await realpath(candidate.path);
  assertRealAssetPathInsideRoot(rootRealPath, targetRealPath);
  return candidate.path;
}

export async function assetPathForWrite(dataDir: string, storageKey: string, clashRoot?: string): Promise<string> {
  const candidate = localAssetPathCandidate(dataDir, storageKey, clashRoot);
  await mkdir(candidate.ownerRoot, { recursive: true });
  await mkdir(candidate.root, { recursive: true });
  const ownerRootRealPath = await realpath(candidate.ownerRoot);
  const rootRealPath = await realpath(candidate.root);
  assertRealAssetPathInsideRoot(ownerRootRealPath, rootRealPath);
  await mkdir(dirname(candidate.path), { recursive: true });
  const parentRealPath = await realpath(dirname(candidate.path));
  assertRealAssetPathInsideRoot(rootRealPath, parentRealPath);
  const existingTargetRealPath = await realpathOrNull(candidate.path);
  if (existingTargetRealPath) {
    assertRealAssetPathInsideRoot(rootRealPath, existingTargetRealPath);
  }
  return candidate.path;
}

export async function assetPathForDelete(dataDir: string, storageKey: string, clashRoot?: string): Promise<string> {
  const candidate = localAssetPathCandidate(dataDir, storageKey, clashRoot);
  const ownerRootRealPath = await realpathOrNull(candidate.ownerRoot);
  const rootRealPath = await realpathOrNull(candidate.root);
  const parentRealPath = await realpathOrNull(dirname(candidate.path));
  if (ownerRootRealPath && rootRealPath) {
    assertRealAssetPathInsideRoot(ownerRootRealPath, rootRealPath);
  }
  if (rootRealPath && parentRealPath) {
    assertRealAssetPathInsideRoot(rootRealPath, parentRealPath);
  }
  return candidate.path;
}

export function normalizeLocalBlobStorageKey(localBlobKey: string): string {
  const normalized = localBlobKey.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith("blobs/")) {
    throw new Error("localBlobKey must start with blobs/");
  }
  const root = "blobs";
  const resolved = normalize(join(root, normalized.slice("blobs/".length)));
  const rel = relative(root, resolved);
  if (!rel || rel.startsWith("..") || rel === "..") {
    throw new Error("Invalid local blob path");
  }
  return `local-blobs/${rel.replace(/\\/g, "/")}`;
}

export function isLocalBlobStorageKey(storageKey: string): boolean {
  return storageKey.startsWith("local-blobs/");
}
