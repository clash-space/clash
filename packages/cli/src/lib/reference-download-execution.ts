import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  AssetMetadataFillActionSchema,
  ReferenceDownloadMetadataSchema,
  applyAssetMetadataFill,
  type AssetMetadataFillAction,
  type ReferenceDownloadMetadata,
} from "@clash/shared-types";
import type { ReferenceDownloadPlan } from "./reference-download-plan";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type ExecuteReferenceDownloadOptions = {
  cwd: string;
  planPath: string;
  assetsPath?: string;
  outPath?: string;
  runnerPath?: string;
};

export type ReferenceDownloadReceipt = {
  schemaVersion: 1;
  kind: "clash.reference.download-receipt";
  targetAssetId: string;
  sourceUrl: string;
  planPath: string;
  tool: "yt-dlp";
  outputDir: string;
  downloadedFiles: ReferenceDownloadMetadata["downloadedFiles"];
  rawReferenceQuarantine: true;
  finalExportAllowed: boolean;
  sourceLedger: ReferenceDownloadMetadata["sourceLedger"];
  assetId: string;
  assetPath: string;
  metadataKind: "reference.download";
  decisionLog: string[];
  executedAt: string;
};

export type ExecuteReferenceDownloadResult = {
  executed: true;
  targetAssetId: string;
  receiptPath: string;
  assetsPath: string;
  downloadedFiles: string[];
};

type AssetManifest = {
  assets: ManifestAsset[];
};

type ManifestAsset = Record<string, unknown> & {
  id: string;
  type: string;
  path?: unknown;
  metadata?: Record<string, unknown>;
};

export async function executeReferenceDownload(
  options: ExecuteReferenceDownloadOptions,
): Promise<ExecuteReferenceDownloadResult> {
  const cwd = resolve(options.cwd);
  const planPath = resolveProjectPath(cwd, options.planPath, "reference download plan");
  const assetsPath = resolveProjectPath(cwd, options.assetsPath ?? "assets/manifest.json", "assets manifest");
  const plan = parsePlan(JSON.parse(await readFile(planPath, "utf8")));
  if (plan.status !== "planned" || plan.downloadAllowed !== true) {
    const reason = plan.blockedReasons.length > 0 ? plan.blockedReasons.join("; ") : "download is not allowed";
    throw new Error(`reference download plan is blocked: ${reason}`);
  }
  if (plan.rawReferenceQuarantine !== true) {
    throw new Error("reference download execution requires rawReferenceQuarantine=true");
  }
  if (plan.finalExportAllowed && (!plan.sourceLedger.redistributionAllowed || !plan.sourceLedger.derivativeAllowed)) {
    throw new Error("reference final export requires derivative and redistribution rights");
  }
  const outputDir = resolveProjectPath(cwd, plan.outputDir, "reference output directory");
  await mkdir(outputDir, { recursive: true });
  const before = new Set(await collectFiles(outputDir));
  await runDownloadCommand(cwd, plan.downloadCommand, options.runnerPath);
  const after = await collectFiles(outputDir);
  const downloadedFiles = after
    .filter((file) => !before.has(file))
    .filter((file) => !isSidecarFile(file))
    .map((absolutePath) => ({
      path: toProjectPath(cwd, absolutePath),
      mediaType: inferMediaType(absolutePath),
    }));
  if (downloadedFiles.length === 0) {
    throw new Error(`reference download produced no media files under ${plan.outputDir}`);
  }
  const downloadedFilesWithSize = await Promise.all(downloadedFiles.map(async (file) => ({
    ...file,
    sizeBytes: (await stat(resolveProjectPath(cwd, file.path, "downloaded reference file"))).size,
  })));
  const decisionLog = [
    "executed controlled reference download from approved plan",
    "registered raw reference asset in quarantine",
  ];
  const metadata = ReferenceDownloadMetadataSchema.parse({
    kind: "reference.download",
    sourceUrl: plan.sourceUrl,
    tool: plan.tool,
    outputDir: plan.outputDir,
    downloadedFiles: downloadedFilesWithSize,
    rawReferenceQuarantine: true,
    finalExportAllowed: plan.finalExportAllowed,
    sourceLedger: plan.sourceLedger,
    decisionLog,
  });
  const action: AssetMetadataFillAction = AssetMetadataFillActionSchema.parse({
    actionId: `reference-download-${safeSlug(plan.targetAssetId)}`,
    targetAssetId: plan.targetAssetId,
    metadataKind: "reference.download",
    producer: "clash-production-execute-reference-download",
    createdAt: new Date().toISOString(),
    metadata,
  });
  const manifest = await readAssetManifest(assetsPath);
  const existingIndex = manifest.assets.findIndex((asset) => asset.id === plan.targetAssetId);
  const baseAsset = existingIndex >= 0
    ? manifest.assets[existingIndex]
    : { id: plan.targetAssetId, type: "reference", path: metadata.downloadedFiles[0].path, metadata: {} };
  const updatedAsset = {
    ...applyAssetMetadataFill(baseAsset, action),
    type: baseAsset.type || "reference",
    path: typeof baseAsset.path === "string" && baseAsset.path ? baseAsset.path : metadata.downloadedFiles[0].path,
  };
  if (existingIndex >= 0) manifest.assets[existingIndex] = updatedAsset;
  else manifest.assets.push(updatedAsset);
  await writeJson(assetsPath, manifest);
  const receipt: ReferenceDownloadReceipt = {
    schemaVersion: 1,
    kind: "clash.reference.download-receipt",
    targetAssetId: plan.targetAssetId,
    sourceUrl: plan.sourceUrl,
    planPath: toProjectPath(cwd, planPath),
    tool: plan.tool,
    outputDir: plan.outputDir,
    downloadedFiles: metadata.downloadedFiles,
    rawReferenceQuarantine: true,
    finalExportAllowed: plan.finalExportAllowed,
    sourceLedger: metadata.sourceLedger,
    assetId: plan.targetAssetId,
    assetPath: metadata.downloadedFiles[0].path,
    metadataKind: "reference.download",
    decisionLog,
    executedAt: new Date().toISOString(),
  };
  const receiptPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("references", "downloads", `${safeSlug(plan.targetAssetId)}.download-receipt.json`),
      "reference download receipt",
    ),
    writeVerb: "Reference download receipt",
  });
  await writeJson(receiptPath, receipt);
  return {
    executed: true,
    targetAssetId: plan.targetAssetId,
    receiptPath,
    assetsPath,
    downloadedFiles: metadata.downloadedFiles.map((file) => file.path),
  };
}

function parsePlan(input: unknown): ReferenceDownloadPlan {
  if (!input || typeof input !== "object") throw new Error("reference download plan must be an object");
  const record = input as Record<string, unknown>;
  if (record.kind !== "clash.reference.download-plan") throw new Error("reference download plan kind is invalid");
  if (record.tool !== "yt-dlp") throw new Error("reference download plan must use yt-dlp");
  if (!Array.isArray(record.downloadCommand) || record.downloadCommand.length === 0) {
    throw new Error("reference download plan must include downloadCommand");
  }
  const downloadCommand = record.downloadCommand.map((item) => requireString(item, "downloadCommand item"));
  validateDownloadCommand(downloadCommand);
  if (record.rawReferenceQuarantine !== true) {
    throw new Error("reference download plan must keep rawReferenceQuarantine=true");
  }
  const sourceLedger = record.sourceLedger as Record<string, unknown> | undefined;
  if (!sourceLedger || typeof sourceLedger !== "object") throw new Error("reference download plan must include sourceLedger");
  return {
    schemaVersion: 1,
    kind: "clash.reference.download-plan",
    targetAssetId: requireString(record.targetAssetId, "targetAssetId"),
    sourceUrl: requireString(record.sourceUrl, "sourceUrl"),
    status: record.status === "planned" ? "planned" : "blocked",
    downloadAllowed: record.downloadAllowed === true,
    blockedReasons: Array.isArray(record.blockedReasons) ? record.blockedReasons.filter((item): item is string => typeof item === "string") : [],
    tool: "yt-dlp",
    outputDir: requireString(record.outputDir, "outputDir"),
    rawReferenceQuarantine: true,
    finalExportAllowed: record.finalExportAllowed === true,
    requiresUserExecution: true,
    downloadCommand,
    sourceLedger: {
      sourceUrl: requireString(sourceLedger.sourceUrl, "sourceLedger.sourceUrl"),
      license: requireString(sourceLedger.license, "sourceLedger.license"),
      attribution: requireString(sourceLedger.attribution, "sourceLedger.attribution"),
      allowedUses: Array.isArray(sourceLedger.allowedUses)
        ? sourceLedger.allowedUses.map((item) => requireString(item, "sourceLedger.allowedUses item"))
        : ["analysis-only"],
      redistributionAllowed: sourceLedger.redistributionAllowed === true,
      derivativeAllowed: sourceLedger.derivativeAllowed === true,
    },
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
  };
}

async function runDownloadCommand(cwd: string, command: string[], runnerPath?: string): Promise<void> {
  const executable = runnerPath ? resolveRunnerPath(cwd, runnerPath) : command[0];
  const args = command.slice(1);
  const { code, stderr } = await spawnCollect(executable, args, cwd);
  if (code !== 0) {
    throw new Error(`reference download command failed with exit code ${code}: ${stderr.trim()}`);
  }
}

function validateDownloadCommand(command: string[]): void {
  if (command[0] !== "yt-dlp") {
    throw new Error("reference download command must start with yt-dlp");
  }
  const disallowedArgs = new Set([
    "--exec",
    "--exec-before-download",
    "--external-downloader",
    "--external-downloader-args",
    "--postprocessor-args",
    "--use-postprocessor",
  ]);
  for (const arg of command.slice(1)) {
    const optionName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (disallowedArgs.has(optionName)) {
      throw new Error(`disallowed yt-dlp argument in reference download plan: ${optionName}`);
    }
  }
}

function spawnCollect(command: string, args: string[], cwd: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stderr }));
  });
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) return collectFiles(absolutePath);
    if (entry.isFile()) return [absolutePath];
    return [];
  }));
  return files.flat().sort();
}

function isSidecarFile(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === ".json" || extension === ".part" || extension === ".ytdl";
}

function inferMediaType(path: string): "video" | "audio" | "image" | "metadata" | "unknown" {
  const extension = extname(path).toLowerCase();
  if ([".mp4", ".mov", ".webm", ".mkv"].includes(extension)) return "video";
  if ([".wav", ".mp3", ".m4a", ".aac", ".flac"].includes(extension)) return "audio";
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return "image";
  if (extension === ".json") return "metadata";
  return "unknown";
}

async function readAssetManifest(path: string): Promise<AssetManifest> {
  try {
    const input = JSON.parse(await readFile(path, "utf8")) as { assets?: unknown };
    return {
      assets: Array.isArray(input.assets)
        ? input.assets
          .filter((asset: unknown): asset is Record<string, unknown> => Boolean(asset) && typeof asset === "object")
          .filter((asset: Record<string, unknown>) => typeof asset.id === "string" && asset.id.trim().length > 0)
          .map((asset: Record<string, unknown>) => ({
            ...asset,
            id: asset.id as string,
            type: typeof asset.type === "string" && asset.type ? asset.type : "reference",
            metadata: asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
              ? asset.metadata as Record<string, unknown>
              : {},
          }))
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { assets: [] };
    throw error;
  }
}

function resolveProjectPath(cwd: string, rawPath: string, label: string): string {
  if (!rawPath || typeof rawPath !== "string") throw new Error(`${label} path is required`);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) throw new Error(`${label} path must be local`);
  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
  if (!isInsideOrEqual(cwd, resolved)) throw new Error(`${label} path must stay inside the current project cwd`);
  return resolved;
}

function resolveRunnerPath(cwd: string, rawPath: string): string {
  if (!rawPath.trim()) throw new Error("runner path is required");
  if (!rawPath.includes("/") && !rawPath.includes("\\")) return rawPath;
  return isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join("/");
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value.trim();
}

function safeSlug(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "reference";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
