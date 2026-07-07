import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  AssetMetadataFillActionSchema,
  StoryboardPromptPackSchema,
  buildStoryboardPromptPackFromMetadata,
  type StoryboardPromptPack,
} from "@clash/shared-types";
import {
  assertProjectionLockFilePath,
  createProjectionLock,
  hashProjectionContent,
  parseProjectionLock,
  type ProjectionLockEntity,
  resolveProjectionLockPathInsideCwd,
  resolveProjectionLockSidecarPathInsideCwd,
} from "./projection-cas";

export type StoryboardPromptPackLock = {
  schemaVersion: 1;
  kind: "clash.storyboard.prompt-pack.lock";
  projectionKind: "storyboard-prompt-pack";
  entity: ProjectionLockEntity;
  storyboardAssetId: string;
  filePath: string;
  contentHash: string;
  promptPackHash: string;
  hashAlgorithm: "sha256-64";
  pulledAt: string;
  sourceActionPath: string;
  sourceActionHash: string;
};

export type ProjectStoryboardPromptPackOptions = {
  cwd: string;
  actionPath: string;
  outPath?: string;
  stylePrompt?: string;
  negativePrompt?: string;
  modelHint?: string;
};

export type ProjectStoryboardPromptPackResult = {
  projected: true;
  storyboardAssetId: string;
  promptPackPath: string;
  lockPath: string;
  manifestPath: string;
  prompts: number;
};

export type ApplyStoryboardPromptPackOptions = {
  cwd: string;
  filePath: string;
  lockPath?: string;
  force?: boolean;
};

export type ApplyStoryboardPromptPackResult = {
  applied: true;
  storyboardAssetId: string;
  projectionPath: string;
  prompts: number;
};

export type ReplaceStoryboardPromptPackOptions = {
  cwd: string;
  filePath: string;
  lockPath?: string;
  force?: boolean;
};

export type ReplaceStoryboardPromptPackResult = {
  replaced: true;
  copyOnWrite: true;
  storyboardAssetId: string;
  projectionPath: string;
  sourcePromptPackHash?: string;
  promptPackHash: string;
  prompts: number;
};

export async function projectStoryboardPromptPack(
  options: ProjectStoryboardPromptPackOptions,
): Promise<ProjectStoryboardPromptPackResult> {
  const cwd = resolve(options.cwd);
  const actionPath = resolveProjectPath(cwd, options.actionPath, "action");
  const action = AssetMetadataFillActionSchema.parse(JSON.parse(await readFile(actionPath, "utf8")));
  if (action.metadata.kind !== "image.storyboard-consistency") {
    throw new Error(`Expected image.storyboard-consistency action, got ${action.metadata.kind}`);
  }
  if (action.metadata.panels.length === 0) {
    throw new Error("Storyboard prompt-pack projection requires at least one panel");
  }

  const promptPackPath = resolveProjectPath(
    cwd,
    options.outPath ?? join("plans", `${safeSlug(action.targetAssetId)}.prompt-pack.json`),
    "prompt pack",
  );
  const lockPath = resolvePromptPackLockPath(cwd, promptPackPath);
  const projectionPath = managedPromptPackProjectionPath(cwd, action.targetAssetId);
  const promptPack = await readManagedPromptPack(projectionPath) ?? buildStoryboardPromptPackFromMetadata(
    action.targetAssetId,
    action.metadata,
    {
      stylePrompt: options.stylePrompt,
      negativePrompt: options.negativePrompt,
      modelHint: options.modelHint,
    },
  );
  const lock = createPromptPackLock({
    storyboardAssetId: action.targetAssetId,
    filePath: toProjectPath(cwd, promptPackPath),
    promptPack,
    sourceActionPath: toProjectPath(cwd, actionPath),
    sourceActionHash: sourceActionHash(action),
  });
  const manifestPath = join(
    cwd,
    "projections",
    "storyboards",
    `${safeSlug(action.targetAssetId)}.prompt-pack-manifest.json`,
  );

  await writeJson(promptPackPath, promptPack);
  await writeJson(lockPath, lock);
  await writeJson(manifestPath, {
    schemaVersion: 1,
    kind: "clash.storyboard.prompt-pack.manifest",
    storyboardAssetId: action.targetAssetId,
    sourceActionPath: toProjectPath(cwd, actionPath),
    promptPackPath: toProjectPath(cwd, promptPackPath),
    lockPath: toProjectPath(cwd, lockPath),
    prompts: promptPack.prompts.length,
    casApply: casApplyDescriptor(cwd, promptPackPath, lockPath),
  });

  return {
    projected: true,
    storyboardAssetId: action.targetAssetId,
    promptPackPath,
    lockPath,
    manifestPath,
    prompts: promptPack.prompts.length,
  };
}

export async function applyStoryboardPromptPack(
  options: ApplyStoryboardPromptPackOptions,
): Promise<ApplyStoryboardPromptPackResult> {
  const cwd = resolve(options.cwd);
  const promptPackPath = resolveProjectPath(cwd, options.filePath, "prompt pack");
  const promptPack = StoryboardPromptPackSchema.parse(JSON.parse(await readFile(promptPackPath, "utf8")));
  const lockPath = options.lockPath
    ? resolveProjectionLockSidecarPathInsideCwd({ lockPath: options.lockPath, cwd })
    : resolvePromptPackLockPath(cwd, promptPackPath);
  const lock = options.force ? null : parsePromptPackLock(await readLockFile(lockPath));
  if (!options.force) {
    if (!lock) {
      throw new Error("Missing storyboard prompt-pack CAS lock. Run `clash production project-storyboard-prompt-pack` first, or pass --force.");
    }
    if (lock.storyboardAssetId !== promptPack.storyboardAssetId) {
      throw new Error(
        `Storyboard prompt-pack lock belongs to ${lock.storyboardAssetId}, not ${promptPack.storyboardAssetId}.`,
      );
    }
    const pathGuard = assertProjectionLockFilePath({
      label: "storyboard prompt-pack",
      lockFilePath: lock.filePath,
      filePath: toProjectComparablePath(cwd, promptPackPath),
      cwd,
      readCommand: "clash production project-storyboard-prompt-pack",
      writeVerb: "Apply",
    });
    if (!pathGuard.ok) throw new Error(pathGuard.error);
    await assertPromptPackSourceCas(cwd, lock, "apply");
  }

  const projectionPath = managedPromptPackProjectionPath(cwd, promptPack.storyboardAssetId);
  const currentPromptPack = await readManagedPromptPack(projectionPath);
  if (!options.force && currentPromptPack && lock) {
    const currentHash = promptPackHash(currentPromptPack);
    if (currentHash !== lock.promptPackHash) {
      throw new Error(
        `Stale storyboard prompt-pack apply rejected. Managed prompt-pack hash is ${currentHash}, ` +
        `but lock was pulled from ${lock.promptPackHash}. ` +
        "Run `clash production project-storyboard-prompt-pack` again and merge, or pass --force.",
      );
    }
  }

  await writeJson(projectionPath, {
    schemaVersion: 1,
    kind: "clash.storyboard.prompt-pack.projection",
    storyboardAssetId: promptPack.storyboardAssetId,
    sourceActionPath: lock?.sourceActionPath,
    promptPack,
    promptPackHash: promptPackHash(promptPack),
    appliedAt: new Date().toISOString(),
    casApply: casApplyDescriptor(cwd, promptPackPath, lockPath),
  });

  return {
    applied: true,
    storyboardAssetId: promptPack.storyboardAssetId,
    projectionPath,
    prompts: promptPack.prompts.length,
  };
}

export async function replaceStoryboardPromptPack(
  options: ReplaceStoryboardPromptPackOptions,
): Promise<ReplaceStoryboardPromptPackResult> {
  const cwd = resolve(options.cwd);
  const promptPackPath = resolveProjectPath(cwd, options.filePath, "prompt pack");
  const promptPack = StoryboardPromptPackSchema.parse(JSON.parse(await readFile(promptPackPath, "utf8")));
  const lockPath = options.lockPath
    ? resolveProjectionLockSidecarPathInsideCwd({ lockPath: options.lockPath, cwd })
    : resolvePromptPackLockPath(cwd, promptPackPath);
  const lock = options.force ? null : parsePromptPackLock(await readLockFile(lockPath));
  if (!options.force) {
    if (!lock) {
      throw new Error("Missing storyboard prompt-pack CAS lock. Run `clash production project-storyboard-prompt-pack` first, or pass --force.");
    }
    if (lock.storyboardAssetId !== promptPack.storyboardAssetId) {
      throw new Error(
        `Storyboard prompt-pack lock belongs to ${lock.storyboardAssetId}, not ${promptPack.storyboardAssetId}.`,
      );
    }
    const pathGuard = assertProjectionLockFilePath({
      label: "storyboard prompt-pack",
      lockFilePath: lock.filePath,
      filePath: toProjectComparablePath(cwd, promptPackPath),
      cwd,
      readCommand: "clash production project-storyboard-prompt-pack",
      writeVerb: "Replace",
    });
    if (!pathGuard.ok) throw new Error(pathGuard.error);
    await assertPromptPackSourceCas(cwd, lock, "replace");
  }

  const managedProjectionPath = managedPromptPackProjectionPath(cwd, promptPack.storyboardAssetId);
  const currentPromptPack = await readManagedPromptPack(managedProjectionPath);
  if (!options.force && currentPromptPack && lock) {
    const currentHash = promptPackHash(currentPromptPack);
    if (currentHash !== lock.promptPackHash) {
      throw new Error(
        `Stale storyboard prompt-pack replace rejected. Managed prompt-pack hash is ${currentHash}, ` +
        `but lock was pulled from ${lock.promptPackHash}. ` +
        "Run `clash production project-storyboard-prompt-pack` again and merge, or pass --force.",
      );
    }
  }

  const replacementHash = promptPackHash(promptPack);
  const sourcePromptPackHash = currentPromptPack ? promptPackHash(currentPromptPack) : lock?.promptPackHash;
  const projectionPath = cowPromptPackProjectionPath(cwd, promptPack.storyboardAssetId, replacementHash);
  await writeJson(projectionPath, {
    schemaVersion: 1,
    kind: "clash.storyboard.prompt-pack.replacement",
    storyboardAssetId: promptPack.storyboardAssetId,
    sourceActionPath: lock?.sourceActionPath,
    copyOnWrite: true,
    copyOnWriteKind: "storyboard-prompt-pack-replacement",
    sourceProjectionPath: toProjectPath(cwd, managedProjectionPath),
    sourcePromptPackHash,
    promptPack,
    promptPackHash: replacementHash,
    replacedAt: new Date().toISOString(),
    casApply: {
      ...casApplyDescriptor(cwd, promptPackPath, lockPath),
      mutation: "copy-on-write-replacement",
      applyCommand: "clash production replace-storyboard-prompt-pack",
    },
  });

  return {
    replaced: true,
    copyOnWrite: true,
    storyboardAssetId: promptPack.storyboardAssetId,
    projectionPath,
    sourcePromptPackHash,
    promptPackHash: replacementHash,
    prompts: promptPack.prompts.length,
  };
}

function createPromptPackLock(options: {
  storyboardAssetId: string;
  filePath: string;
  promptPack: StoryboardPromptPack;
  sourceActionPath: string;
  sourceActionHash: string;
}): StoryboardPromptPackLock {
  const packHash = promptPackHash(options.promptPack);
  return createProjectionLock({
    kind: "clash.storyboard.prompt-pack.lock",
    projectionKind: "storyboard-prompt-pack",
    entity: { kind: "storyboard-asset", id: options.storyboardAssetId },
    filePath: options.filePath,
    contentHash: packHash,
    extra: {
      storyboardAssetId: options.storyboardAssetId,
      promptPackHash: packHash,
      sourceActionPath: options.sourceActionPath,
      sourceActionHash: options.sourceActionHash,
    },
  }) as StoryboardPromptPackLock;
}

function parsePromptPackLock(raw: string): StoryboardPromptPackLock {
  const value = JSON.parse(raw) as Partial<StoryboardPromptPackLock>;
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "clash.storyboard.prompt-pack.lock" ||
    typeof value.storyboardAssetId !== "string" ||
    typeof value.filePath !== "string" ||
    typeof value.promptPackHash !== "string" ||
    value.hashAlgorithm !== "sha256-64" ||
    typeof value.pulledAt !== "string" ||
    typeof value.sourceActionPath !== "string" ||
    typeof value.sourceActionHash !== "string"
  ) {
    throw new Error("Invalid storyboard prompt-pack lock file");
  }
  const normalized = {
    ...value,
    projectionKind: value.projectionKind ?? "storyboard-prompt-pack",
    entity: value.entity ?? { kind: "storyboard-asset", id: value.storyboardAssetId },
    contentHash: value.contentHash ?? value.promptPackHash,
  } as StoryboardPromptPackLock;
  try {
    parseProjectionLock(normalized, {
      kind: "clash.storyboard.prompt-pack.lock",
      projectionKind: "storyboard-prompt-pack",
      entityKind: "storyboard-asset",
      entityId: value.storyboardAssetId,
    });
  } catch {
    throw new Error("Invalid storyboard prompt-pack lock file");
  }
  if (normalized.contentHash !== normalized.promptPackHash) {
    throw new Error("Invalid storyboard prompt-pack lock file");
  }
  return normalized;
}

function promptPackHash(promptPack: StoryboardPromptPack): string {
  return hashProjectionContent(stableJson(promptPack));
}

function sourceActionHash(action: unknown): string {
  return hashProjectionContent(stableJson(action));
}

async function assertPromptPackSourceCas(
  cwd: string,
  lock: StoryboardPromptPackLock,
  verb: "apply" | "replace",
): Promise<void> {
  const sourceActionPath = resolveProjectPath(cwd, lock.sourceActionPath, "source action");
  const sourceAction = AssetMetadataFillActionSchema.parse(JSON.parse(await readFile(sourceActionPath, "utf8")));
  const currentHash = sourceActionHash(sourceAction);
  if (currentHash === lock.sourceActionHash) return;
  throw new Error(
    `Stale storyboard prompt-pack source action rejected. Source action hash is ${currentHash}, ` +
    `but lock was pulled from ${lock.sourceActionHash}. ` +
    `Run \`clash production project-storyboard-prompt-pack\` again and merge, or pass --force to intentionally ${verb}.`,
  );
}

async function readManagedPromptPack(projectionPath: string): Promise<StoryboardPromptPack | null> {
  if (!existsSync(projectionPath)) return null;
  const projection = JSON.parse(await readFile(projectionPath, "utf8")) as { promptPack?: unknown };
  return projection.promptPack ? StoryboardPromptPackSchema.parse(projection.promptPack) : null;
}

async function readLockFile(lockPath: string): Promise<string> {
  try {
    return await readFile(lockPath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read storyboard prompt-pack CAS lock at ${lockPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function managedPromptPackProjectionPath(cwd: string, storyboardAssetId: string): string {
  return join(cwd, "projections", "storyboards", `${safeSlug(storyboardAssetId)}.prompt-pack.json`);
}

function cowPromptPackProjectionPath(cwd: string, storyboardAssetId: string, promptPackHash: string): string {
  return join(cwd, "projections", "storyboards", `${safeSlug(storyboardAssetId)}.prompt-pack.${promptPackHash}.cow.json`);
}

function resolvePromptPackLockPath(cwd: string, promptPackPath: string): string {
  return resolveProjectionLockPathInsideCwd({ filePath: promptPackPath, cwd });
}

function casApplyDescriptor(cwd: string, promptPackPath: string, lockPath: string) {
  return {
    target: "storyboard-prompt-pack",
    mutation: "managed-projection",
    applyCommand: "clash production apply-storyboard-prompt-pack",
    filePath: toProjectPath(cwd, promptPackPath),
    lockPath: toProjectPath(cwd, lockPath),
    lockRequired: true,
  };
}

function resolveProjectPath(cwd: string, rawPath: string, label: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error(`${label} path is required`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) {
    throw new Error(`${label} path must be a local project path, not a URL`);
  }
  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
  if (!isInsideOrEqual(cwd, resolved)) {
    throw new Error(`${label} path must stay inside the current project cwd`);
  }
  return resolved;
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join("/");
}

function toProjectComparablePath(cwd: string, path: string): string {
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  return toProjectPath(cwd, absolutePath);
}

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "storyboard";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
