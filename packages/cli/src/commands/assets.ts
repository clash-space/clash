import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, copyFileSync, readdirSync, statSync, createReadStream } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { Command } from "commander";
import { downloadAssetById, replaceCanvasAssetNode } from "./canvas";
import { apiFetch } from "../lib/api";
import { requireDestructiveConfirmation } from "../lib/destructive-guardrails";
import { isJsonMode, printJson } from "../lib/output";
import { resolveProjectStatus } from "./projects";

export type AssetLinkMethod = "symlink" | "copy";

export interface AssetLinkResult {
  projectId: string;
  assetId: string;
  sourcePath: string;
  linkPath: string;
  method: AssetLinkMethod;
}

export interface AssetImportResult {
  projectId: string;
  assetId: string;
  kind?: string;
  contentHash: string;
  sourcePath: string;
  blobPath: string;
  deduplicated: boolean;
  linkPath?: string;
  linkMethod?: AssetLinkMethod;
  registered?: boolean;
  registration?: ImportedAssetRegistrationResult;
}

export interface ImportedAssetRegistrationPayload {
  projectId: string;
  kind: "image" | "video" | "audio";
  assetId: string;
  contentHash: string;
  localBlobKey: string;
  bytes: number;
  contentType: string;
  originalName: string;
}

export interface ImportedAssetRegistrationResult {
  id: string;
  srcR2Key: string;
  signedUrl?: string;
  signedUrlExp?: number;
}

export interface AssetGarbageCollectionResult {
  dryRun: boolean;
  deletedAssets: Array<{ id: string; srcR2Key: string }>;
  protectedAssets?: string[];
  protectedProjectIds?: string[];
  deletedBlobKeys: string[];
  readToken?: string;
  mutation?: unknown;
}

export interface AssetFileReplaceResult {
  importedAssetId: string;
  replaced: true;
  replaceResult: Record<string, unknown>;
}

export interface AssetNodeReference {
  assetId: string;
  projectId: string;
  nodeId: string;
  nodeType: string;
  fieldPath: string;
  referenceRole: string;
}

export interface AssetReferencesResult {
  assetId: string;
  references: AssetNodeReference[];
}

export interface AssetRecordResult extends Record<string, unknown> {
  id: string;
  readToken?: string;
}

export interface AssetCoverUpdateResult {
  ok: boolean;
  readToken?: string;
  mutation?: unknown;
}

export interface AssetProjectRefResult {
  assetId: string;
  projectId: string;
  importedAt: number;
  readToken: string;
}

export interface AssetProjectRefDeleteResult {
  deleted: boolean;
  mutation?: unknown;
}

export function resolveAssetLinkName(assetId: string, sourcePath: string, requestedName?: string): string {
  const raw = requestedName?.trim() || basename(sourcePath) || assetId;
  if (!raw || raw === "." || raw === ".." || /[/\\]/.test(raw)) {
    throw new Error("asset link name must be a single file name");
  }
  return raw.replace(/:/g, "_");
}

export function assetIdForContentHash(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error(`invalid sha256 content hash: ${hash}`);
  }
  return `local:sha256:${hash}`;
}

function createAssetLink(options: {
  assetId: string;
  sourcePath: string;
  assetLinksRoot: string;
  name?: string;
  force?: boolean;
  createSymlink?: (target: string, path: string) => void;
}): { linkPath: string; method: AssetLinkMethod } {
  const linkName = resolveAssetLinkName(options.assetId, options.sourcePath, options.name);
  const linkPath = join(options.assetLinksRoot, linkName);

  mkdirSync(options.assetLinksRoot, { recursive: true });
  if (existsSync(linkPath)) {
    const existing = lstatSync(linkPath);
    if (existing.isDirectory() && !existing.isSymbolicLink()) {
      throw new Error(`asset link path is a directory: ${linkPath}`);
    }
    if (!options.force) {
      throw new Error(`asset link already exists: ${linkPath}. Pass --force to replace it.`);
    }
    rmSync(linkPath, { force: true });
  }

  let method: AssetLinkMethod = "symlink";
  try {
    (options.createSymlink ?? symlinkSync)(options.sourcePath, linkPath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (!["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP"].includes(code)) throw error;
    copyFileSync(options.sourcePath, linkPath);
    chmodSync(linkPath, 0o444);
    method = "copy";
  }

  return { linkPath, method };
}

export async function linkAssetIntoProject(options: {
  assetId: string;
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  name?: string;
  force?: boolean;
  download?: (assetId: string) => Promise<string | null>;
  createSymlink?: (target: string, path: string) => void;
}): Promise<AssetLinkResult> {
  const assetId = options.assetId.trim();
  if (!assetId) throw new Error("asset id is required");
  const sourcePath = await (options.download ?? downloadAssetById)(assetId);
  if (!sourcePath) throw new Error(`Unable to resolve asset ${assetId}`);

  const status = await resolveProjectStatus({
    project: options.project,
    cwd: options.cwd,
    env: options.env,
    homeDir: options.homeDir,
  });
  const { linkPath, method } = createAssetLink({
    assetId,
    sourcePath,
    assetLinksRoot: status.assetLinksRoot,
    name: options.name,
    force: options.force,
    createSymlink: options.createSymlink,
  });

  return {
    projectId: status.projectId,
    assetId,
    sourcePath,
    linkPath,
    method,
  };
}

export async function importAssetFile(options: {
  filePath: string;
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  kind?: string;
  name?: string;
  force?: boolean;
  link?: boolean;
  registerImportedAsset?: (payload: ImportedAssetRegistrationPayload) => Promise<ImportedAssetRegistrationResult>;
  createSymlink?: (target: string, path: string) => void;
}): Promise<AssetImportResult> {
  const sourcePath = resolve(options.filePath);
  const info = statSync(sourcePath);
  if (!info.isFile()) throw new Error(`asset import source is not a file: ${sourcePath}`);

  const status = await resolveProjectStatus({
    project: options.project,
    cwd: options.cwd,
    env: options.env,
    homeDir: options.homeDir,
  });
  const contentHash = await hashFileSha256(sourcePath);
  const assetId = assetIdForContentHash(contentHash);
  const blobDir = join(status.clashHome, "assets", "blobs", contentHash);
  const existingBlobPath = findExistingOriginalBlob(blobDir);
  let blobPath = existingBlobPath;
  let deduplicated = true;
  if (!blobPath) {
    const extension = safeExtension(sourcePath);
    blobPath = join(blobDir, `original${extension}`);
    mkdirSync(blobDir, { recursive: true });
    copyFileSync(sourcePath, blobPath);
    deduplicated = false;
  }
  chmodSync(blobPath, 0o444);

  const result: AssetImportResult = {
    projectId: status.projectId,
    assetId,
    ...(options.kind?.trim() ? { kind: options.kind.trim() } : {}),
    contentHash,
    sourcePath,
    blobPath,
    deduplicated,
  };

  if (options.registerImportedAsset) {
    const kind = normalizeAssetKind(options.kind ?? inferAssetKind(blobPath) ?? undefined);
    if (!kind) {
      throw new Error("asset kind must be image, video, or audio to register local metadata");
    }
    result.registration = await options.registerImportedAsset({
      projectId: status.projectId,
      kind,
      assetId,
      contentHash,
      localBlobKey: localBlobKeyForBlobPath(status.clashHome, blobPath),
      bytes: info.size,
      contentType: contentTypeForPath(blobPath),
      originalName: basename(sourcePath),
    });
    result.registered = true;
  }

  if (options.link !== false) {
    const extension = extname(blobPath);
    const defaultName = `${assetId}${extension}`;
    const link = createAssetLink({
      assetId,
      sourcePath: blobPath,
      assetLinksRoot: status.assetLinksRoot,
      name: options.name ?? defaultName,
      force: options.force,
      createSymlink: options.createSymlink,
    });
    result.linkPath = link.linkPath;
    result.linkMethod = link.method;
  }

  return result;
}

export async function registerImportedAssetWithLocalApi(
  payload: ImportedAssetRegistrationPayload,
): Promise<ImportedAssetRegistrationResult> {
  const response = await apiFetch("/api/v1/assets/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to register imported asset: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<ImportedAssetRegistrationResult>;
}

export async function runAssetGarbageCollection(options: {
  dryRun?: boolean;
  protectedAssetIds?: string[];
  projectIds?: string[];
  ifMatch?: string;
  force?: boolean;
  env?: Record<string, string | undefined>;
  request?: (path: string, init?: RequestInit) => Promise<Response>;
} = {}): Promise<AssetGarbageCollectionResult> {
  const response = await (options.request ?? apiFetch)("/api/v1/assets/gc", {
    method: "POST",
    headers: agentWriteHeaders({
      ifMatch: options.ifMatch,
      force: options.force,
      env: options.env,
    }),
    body: JSON.stringify({
      dryRun: options.dryRun !== false,
      ...(options.protectedAssetIds?.length ? { protectedAssetIds: options.protectedAssetIds } : {}),
      ...(options.projectIds?.length ? { projectIds: options.projectIds } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to run asset garbage collection: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<AssetGarbageCollectionResult>;
}

export async function fetchAssetReferences(options: {
  assetId: string;
  projectId?: string;
  refresh?: boolean;
  request?: (path: string, init?: RequestInit) => Promise<Response>;
}): Promise<AssetReferencesResult> {
  const assetId = options.assetId.trim();
  if (!assetId) throw new Error("asset id is required");
  if (options.refresh) {
    const response = await (options.request ?? apiFetch)(`/api/v1/assets/${encodeURIComponent(assetId)}/references/refresh`, {
      method: "POST",
      body: JSON.stringify({
        ...(options.projectId?.trim() ? { projectIds: [options.projectId.trim()] } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to refresh asset references: ${response.status} ${await response.text()}`);
    }
    return response.json() as Promise<AssetReferencesResult>;
  }
  const query = options.projectId?.trim() ? `?projectId=${encodeURIComponent(options.projectId.trim())}` : "";
  const response = await (options.request ?? apiFetch)(`/api/v1/assets/${encodeURIComponent(assetId)}/references${query}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset references: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<AssetReferencesResult>;
}

export async function fetchAssetRecord(options: {
  assetId: string;
  request?: (path: string, init?: RequestInit) => Promise<Response>;
}): Promise<AssetRecordResult> {
  const assetId = options.assetId.trim();
  if (!assetId) throw new Error("asset id is required");
  const response = await (options.request ?? apiFetch)(`/api/v1/assets/${encodeURIComponent(assetId)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<AssetRecordResult>;
}

export async function updateAssetCover(options: {
  assetId: string;
  coverR2Key: string;
  ifMatch?: string;
  force?: boolean;
  env?: Record<string, string | undefined>;
  request?: (path: string, init?: RequestInit) => Promise<Response>;
}): Promise<AssetCoverUpdateResult> {
  const assetId = options.assetId.trim();
  const coverR2Key = options.coverR2Key.trim();
  if (!assetId) throw new Error("asset id is required");
  if (!coverR2Key) throw new Error("cover key is required");
  const response = await (options.request ?? apiFetch)(
    `/api/v1/assets/${encodeURIComponent(assetId)}/cover`,
    {
      method: "PATCH",
      headers: agentWriteHeaders({
        ifMatch: options.ifMatch,
        force: options.force,
        env: options.env,
      }),
      body: JSON.stringify({ coverR2Key }),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to update asset cover: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<AssetCoverUpdateResult>;
}

export async function fetchAssetProjectRef(options: {
  assetId: string;
  projectId: string;
  request?: (path: string, init?: RequestInit) => Promise<Response>;
}): Promise<AssetProjectRefResult> {
  const assetId = options.assetId.trim();
  const projectId = options.projectId.trim();
  if (!assetId) throw new Error("asset id is required");
  if (!projectId) throw new Error("project id is required");
  const response = await (options.request ?? apiFetch)(
    `/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=${encodeURIComponent(projectId)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch asset project reference: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<AssetProjectRefResult>;
}

export async function deleteAssetProjectRef(options: {
  assetId: string;
  projectId: string;
  ifMatch?: string;
  force?: boolean;
  env?: Record<string, string | undefined>;
  request?: (path: string, init?: RequestInit) => Promise<Response>;
}): Promise<AssetProjectRefDeleteResult> {
  const assetId = options.assetId.trim();
  const projectId = options.projectId.trim();
  if (!assetId) throw new Error("asset id is required");
  if (!projectId) throw new Error("project id is required");
  const response = await (options.request ?? apiFetch)(
    `/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=${encodeURIComponent(projectId)}`,
    {
      method: "DELETE",
      headers: agentWriteHeaders({
        ifMatch: options.ifMatch,
        force: options.force,
        env: options.env,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to delete asset project reference: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<AssetProjectRefDeleteResult>;
}

export async function replaceAssetFile(options: {
  filePath: string;
  nodeId: string;
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  kind?: string;
  ifMatch?: string;
  newNode?: string;
  label?: string;
  force?: boolean;
  link?: boolean;
  importFile?: (options: {
    filePath: string;
    project?: string;
    cwd?: string;
    env?: Record<string, string | undefined>;
    homeDir?: string;
    kind?: string;
    link?: boolean;
    force?: boolean;
    registerImportedAsset?: (payload: ImportedAssetRegistrationPayload) => Promise<ImportedAssetRegistrationResult>;
  }) => Promise<AssetImportResult>;
  replaceAsset?: (options: {
    project?: string;
    nodeId: string;
    assetId: string;
    ifMatch?: string;
    newNode?: string;
    label?: string;
    force?: boolean;
  }) => Promise<Record<string, unknown>>;
}): Promise<AssetFileReplaceResult> {
  const imported = await (options.importFile ?? importAssetFile)({
    filePath: options.filePath,
    project: options.project,
    cwd: options.cwd,
    env: options.env,
    homeDir: options.homeDir,
    kind: options.kind,
    link: options.link ?? true,
    force: options.force,
    registerImportedAsset: options.importFile ? undefined : registerImportedAssetWithLocalApi,
  });
  const replaceResult = await (options.replaceAsset ?? replaceCanvasAssetNode)({
    project: options.project,
    nodeId: options.nodeId,
    assetId: imported.assetId,
    ifMatch: options.ifMatch,
    newNode: options.newNode,
    label: options.label,
    force: options.force,
  });
  return {
    importedAssetId: imported.assetId,
    replaced: true,
    replaceResult,
  };
}

function agentWriteHeaders(options: {
  ifMatch?: string;
  force?: boolean;
  env?: Record<string, string | undefined>;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  const env = options.env ?? process.env;
  if (env.CLASH_AGENT_MEMBER_ID?.trim()) {
    headers["x-clash-client-type"] = "agent";
  }
  if (options.ifMatch?.trim()) {
    headers["x-clash-if-match"] = options.ifMatch.trim();
  }
  if (options.force === true) {
    headers["x-clash-force"] = "true";
  }
  return headers;
}

async function hashFileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function findExistingOriginalBlob(blobDir: string): string | null {
  if (!existsSync(blobDir)) return null;
  const existing = readdirSync(blobDir)
    .filter((name) => name === "original" || name.startsWith("original."))
    .sort()[0];
  return existing ? join(blobDir, existing) : null;
}

function safeExtension(path: string): string {
  const extension = extname(path);
  return /^[.][A-Za-z0-9_-]+$/.test(extension) ? extension : "";
}

function localBlobKeyForBlobPath(clashHome: string, blobPath: string): string {
  const prefix = join(clashHome, "assets") + "/";
  const normalized = blobPath.replace(/\\/g, "/");
  const normalizedPrefix = prefix.replace(/\\/g, "/");
  if (!normalized.startsWith(normalizedPrefix)) {
    throw new Error(`asset blob path is outside Clash asset storage: ${blobPath}`);
  }
  return normalized.slice(normalizedPrefix.length);
}

function normalizeAssetKind(kind: string | undefined): ImportedAssetRegistrationPayload["kind"] | null {
  const normalized = kind?.trim().toLowerCase();
  return normalized === "image" || normalized === "video" || normalized === "audio" ? normalized : null;
}

function inferAssetKind(path: string): ImportedAssetRegistrationPayload["kind"] | null {
  const extension = extname(path).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension)) return "image";
  if ([".mp4", ".mov", ".webm", ".m4v"].includes(extension)) return "video";
  if ([".mp3", ".wav", ".m4a", ".aac", ".flac"].includes(extension)) return "audio";
  return null;
}

function contentTypeForPath(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".flac") return "audio/flac";
  return "application/octet-stream";
}

export const assetsCommand = new Command("assets")
  .alias("asset")
  .description("Inspect and link project assets");

assetsCommand
  .command("get")
  .description("Read an asset row and its read token")
  .requiredOption("--asset <id>", "Asset ID")
  .option("--json", "Output result as JSON")
  .action(async (options: { asset: string; json?: boolean }) => {
    try {
      const result = await fetchAssetRecord({ assetId: options.asset });
      if (isJsonMode(options)) {
        printJson(result);
      } else {
        console.log(`${result.id}`);
        if (typeof result.readToken === "string") {
          console.log(`Read token: ${result.readToken}`);
        }
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

assetsCommand
  .command("link")
  .description("Create an agent-readable project link for an immutable asset")
  .requiredOption("--asset <id>", "Asset ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--name <file>", "Link file name under assets/links")
  .option("--force", "Replace an existing asset link")
  .option("--json", "Output as JSON")
  .action(async (options: { asset: string; project?: string; name?: string; force?: boolean; json?: boolean }) => {
    try {
      const result = await linkAssetIntoProject({
        assetId: options.asset,
        project: options.project,
        name: options.name,
        force: options.force === true,
      });
      if (isJsonMode(options)) {
        printJson(result);
      } else {
        console.log(`linked ${result.assetId} -> ${result.linkPath} (${result.method})`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

assetsCommand
  .command("import")
  .description("Import a local file into the immutable content-addressed asset store")
  .requiredOption("--file <path>", "Local file to import")
  .option("--kind <kind>", "Asset kind, such as image, video, or audio")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--name <file>", "Link file name under assets/links")
  .option("--no-link", "Do not create a project assets/links entry")
  .option("--no-register", "Do not register the imported blob with local-api metadata")
  .option("--force", "Replace an existing project asset link")
  .option("--json", "Output result as JSON")
  .action(async (options: {
    file: string;
    kind?: string;
    project?: string;
    name?: string;
    link?: boolean;
    register?: boolean;
    force?: boolean;
    json?: boolean;
  }) => {
    try {
      const result = await importAssetFile({
        filePath: options.file,
        kind: options.kind,
        project: options.project,
        name: options.name,
        link: options.link,
        force: options.force === true,
        registerImportedAsset: options.register === false ? undefined : registerImportedAssetWithLocalApi,
      });
      if (isJsonMode(options)) {
        printJson(result);
      } else {
        const link = result.linkPath ? `, link ${result.linkPath}` : "";
        console.log(`imported ${result.assetId} -> ${result.blobPath}${link}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

assetsCommand
  .command("replace")
  .description("Import a local file and create a copy-on-write replacement media node")
  .requiredOption("--file <path>", "Local file to import as the replacement asset")
  .requiredOption("--node <id>", "Source image/video/audio node ID")
  .option("--kind <kind>", "Asset kind, such as image, video, or audio")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--if-match <readToken>", "Require the source node read token from `clash canvas get --json` before forking")
  .option("--new-node <id>", "Optional node ID for the copied media node")
  .option("--label <label>", "Optional label for the copied media node")
  .option("--no-link", "Do not create a project assets/links entry for the imported asset")
  .option("--force", "Bypass the agent read-token check and replace existing asset link")
  .option("--json", "Output result as JSON")
  .action(async (options: {
    file: string;
    node: string;
    kind?: string;
    project?: string;
    ifMatch?: string;
    newNode?: string;
    label?: string;
    link?: boolean;
    force?: boolean;
    json?: boolean;
  }) => {
    try {
      const result = await replaceAssetFile({
        filePath: options.file,
        nodeId: options.node,
        project: options.project,
        kind: options.kind,
        ifMatch: options.ifMatch,
        newNode: options.newNode,
        label: options.label,
        link: options.link,
        force: options.force === true,
      });
      if (isJsonMode(options)) {
        printJson(result);
      } else {
        const newNodeId = typeof result.replaceResult.newNodeId === "string" ? result.replaceResult.newNodeId : "(unknown)";
        console.log(`Imported ${result.importedAssetId} and created copy-on-write media node: ${newNodeId}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

const assetCoverCommand = assetsCommand
  .command("cover")
  .description("Read or update asset cover metadata");

assetCoverCommand
  .command("set")
  .description("Set an asset cover storage key")
  .requiredOption("--asset <id>", "Asset ID")
  .requiredOption("--cover-key <key>", "Cover asset storage key")
  .option("--if-match <readToken>", "Require the asset read token from `clash asset get --json`")
  .option("--force", "Bypass the agent read-token check")
  .option("--json", "Output result as JSON")
  .action(async (options: { asset: string; coverKey: string; ifMatch?: string; force?: boolean; json?: boolean }) => {
    try {
      const result = await updateAssetCover({
        assetId: options.asset,
        coverR2Key: options.coverKey,
        ifMatch: options.ifMatch,
        force: options.force === true,
      });
      if (isJsonMode(options)) {
        printJson(result);
      } else {
        console.log(`updated asset cover ${options.asset} -> ${options.coverKey}`);
        if (typeof result.readToken === "string") {
          console.log(`Read token: ${result.readToken}`);
        }
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

const assetRefCommand = assetsCommand
  .command("ref")
  .description("Read or delete a project asset membership reference");

assetRefCommand
  .command("get")
  .description("Read a project asset membership reference and its read token")
  .requiredOption("--asset <id>", "Asset ID")
  .requiredOption("--project <id>", "Project ID")
  .option("--json", "Output result as JSON")
  .action(async (options: { asset: string; project: string; json?: boolean }) => {
    try {
      const result = await fetchAssetProjectRef({
        assetId: options.asset,
        projectId: options.project,
      });
      if (isJsonMode(options)) {
        printJson(result);
      } else {
        console.log(`${result.projectId} ${result.assetId} importedAt=${result.importedAt}`);
        console.log(`Read token: ${result.readToken}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

assetRefCommand
  .command("delete")
  .description("Delete a project asset membership reference")
  .requiredOption("--asset <id>", "Asset ID")
  .requiredOption("--project <id>", "Project ID")
  .option("--if-match <readToken>", "Require the asset-ref read token from `clash asset ref get --json`")
  .option("--force", "Bypass the agent read-token check")
  .option("--yes", "Confirm deletion")
  .option("--json", "Output result as JSON")
  .action(async (options: { asset: string; project: string; ifMatch?: string; force?: boolean; yes?: boolean; json?: boolean }) => {
    try {
      const confirmation = requireDestructiveConfirmation(options, `${options.asset}:${options.project}`);
      if (!confirmation.ok) {
        throw new Error(confirmation.error);
      }
      const result = await deleteAssetProjectRef({
        assetId: options.asset,
        projectId: options.project,
        ifMatch: options.ifMatch,
        force: options.force === true,
      });
      if (isJsonMode(options)) {
        printJson(result);
      } else {
        console.log(`deleted project asset ref ${options.asset}:${options.project}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

assetsCommand
  .command("refs")
  .description("Show node and field references for an asset")
  .requiredOption("--asset <id>", "Asset ID")
  .option("--project <id>", "Only show references in one project")
  .option("--refresh", "Refresh indexed references from the local project replica before reading")
  .option("--json", "Output result as JSON")
  .action(async (options: { asset: string; project?: string; refresh?: boolean; json?: boolean }) => {
    try {
      const result = await fetchAssetReferences({
        assetId: options.asset,
        projectId: options.project,
        refresh: options.refresh === true,
      });
      if (isJsonMode(options)) {
        printJson(result);
      } else if (result.references.length === 0) {
        console.log(`No indexed references for ${result.assetId}`);
      } else {
        for (const ref of result.references) {
          console.log(`${ref.projectId} ${ref.nodeId} (${ref.nodeType}) ${ref.referenceRole} ${ref.fieldPath}`);
        }
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

assetsCommand
  .command("gc")
  .description("Garbage collect unreferenced local asset metadata and local blobs")
  .option("--dry-run", "Preview unreferenced assets without deleting blobs", true)
  .option("--delete", "Delete unreferenced local asset rows and local blobs")
  .option("--protect-asset <id...>", "Asset ids currently referenced by live canvas/project state")
  .option("--project <id...>", "Project ids whose canvas state should be scanned for asset references")
  .option("--if-match <readToken>", "Require the GC dry-run read token from `clash assets gc --dry-run --json` before deleting")
  .option("--force", "Bypass the agent read-token check")
  .option("--json", "Output result as JSON")
  .action(async (options: {
    dryRun?: boolean;
    delete?: boolean;
    protectAsset?: string[];
    project?: string[];
    ifMatch?: string;
    force?: boolean;
    json?: boolean;
  }) => {
    try {
      const result = await runAssetGarbageCollection({
        dryRun: options.delete === true ? false : options.dryRun !== false,
        protectedAssetIds: options.protectAsset,
        projectIds: options.project,
        ifMatch: options.ifMatch,
        force: options.force,
      });
      if (isJsonMode(options)) {
        printJson(result);
      } else {
        const mode = result.dryRun ? "would delete" : "deleted";
        console.log(`${mode} ${result.deletedAssets.length} assets and ${result.deletedBlobKeys.length} local blobs`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
