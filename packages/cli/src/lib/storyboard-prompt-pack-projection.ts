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
  hashProjectionContent,
  resolveAgentFilePathInsideCwd,
} from "./projection-cas";

type StoryboardPromptPackManifest = {
  schemaVersion: 1;
  kind: "clash.storyboard.prompt-pack.manifest";
  storyboardAssetId: string;
  promptPackPath: string;
  basePromptPackHash: string;
  sourceActionPath: string;
  sourceActionHash: string;
  prompts: number;
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
  manifestPath: string;
  prompts: number;
  version: string;
};

export type ApplyStoryboardPromptPackOptions = {
  cwd: string;
  filePath: string;
  expectedVersion: string;
};

export type ApplyStoryboardPromptPackResult = {
  applied: true;
  storyboardAssetId: string;
  projectionPath: string;
  manifestPath: string;
  prompts: number;
  version: string;
};

export type ReplaceStoryboardPromptPackOptions = {
  cwd: string;
  filePath: string;
  expectedVersion: string;
};

export type ReplaceStoryboardPromptPackResult = {
  replaced: true;
  copyOnWrite: true;
  storyboardAssetId: string;
  projectionPath: string;
  referencePolicy: StoryboardPromptPackReferencePolicy;
  sourcePromptPackHash?: string;
  promptPackHash: string;
  prompts: number;
  version: string;
};

export type StoryboardPromptPackReferencePolicy = {
  target: "storyboard-prompt-pack";
  automaticRewire: false;
  existingReferencesPreserved: true;
  managedProjectionPath: string;
  replacementProjectionPath: string;
  rewireRequiredForDownstream: true;
  rewireCommand: "clash production apply-storyboard-prompt-pack";
  rewireArgs: string[];
};

export async function projectStoryboardPromptPack(
  options: ProjectStoryboardPromptPackOptions,
): Promise<ProjectStoryboardPromptPackResult> {
  const cwd = resolve(options.cwd);
  const actionPath = resolveGuardedProjectPath(cwd, options.actionPath, "Storyboard source action");
  const action = AssetMetadataFillActionSchema.parse(JSON.parse(await readFile(actionPath, "utf8")));
  if (action.metadata.kind !== "image.storyboard-consistency") {
    throw new Error(`Expected image.storyboard-consistency action, got ${action.metadata.kind}`);
  }
  if (action.metadata.panels.length === 0) {
    throw new Error("Storyboard prompt-pack projection requires at least one panel");
  }

  const promptPackPath = resolveGuardedProjectPath(
    cwd,
    options.outPath ?? join("plans", `${safeSlug(action.targetAssetId)}.prompt-pack.json`),
    "Storyboard prompt pack",
  );
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
  const manifestPath = promptPackManifestPath(cwd, action.targetAssetId);
  const manifest: StoryboardPromptPackManifest = {
    schemaVersion: 1,
    kind: "clash.storyboard.prompt-pack.manifest",
    storyboardAssetId: action.targetAssetId,
    promptPackPath: toProjectPath(cwd, promptPackPath),
    basePromptPackHash: promptPackHash(promptPack),
    sourceActionPath: toProjectPath(cwd, actionPath),
    sourceActionHash: sourceActionHash(action),
    prompts: promptPack.prompts.length,
  };

  await writeJson(promptPackPath, promptPack);
  await writeJson(manifestPath, manifest);

  return {
    projected: true,
    storyboardAssetId: action.targetAssetId,
    promptPackPath,
    manifestPath,
    prompts: promptPack.prompts.length,
    version: promptPackObservationVersion(manifest, manifest.basePromptPackHash, manifest.sourceActionHash),
  };
}

export async function applyStoryboardPromptPack(
  options: ApplyStoryboardPromptPackOptions,
): Promise<ApplyStoryboardPromptPackResult> {
  const cwd = resolve(options.cwd);
  const promptPackPath = resolveGuardedProjectPath(cwd, options.filePath, "Storyboard prompt pack");
  const promptPack = StoryboardPromptPackSchema.parse(JSON.parse(await readFile(promptPackPath, "utf8")));
  const manifestPath = promptPackManifestPath(cwd, promptPack.storyboardAssetId);
  const manifest = await readPromptPackManifest(manifestPath);
  assertPromptPackManifestIdentity(cwd, manifest, promptPack, promptPackPath);
  const projectionPath = managedPromptPackProjectionPath(cwd, promptPack.storyboardAssetId);
  const current = await currentPromptPackObservation(cwd, manifest, projectionPath);
  assertPromptPackExpectedVersion(options.expectedVersion, current.version, "apply");

  const nextPromptPackHash = promptPackHash(promptPack);
  await writeJson(projectionPath, {
    schemaVersion: 1,
    kind: "clash.storyboard.prompt-pack.projection",
    storyboardAssetId: promptPack.storyboardAssetId,
    sourceActionPath: manifest.sourceActionPath,
    promptPack,
    promptPackHash: nextPromptPackHash,
    appliedAt: new Date().toISOString(),
  });
  const nextManifest: StoryboardPromptPackManifest = {
    ...manifest,
    basePromptPackHash: nextPromptPackHash,
    sourceActionHash: current.sourceActionHash,
    prompts: promptPack.prompts.length,
  };
  await writeJson(manifestPath, nextManifest);

  return {
    applied: true,
    storyboardAssetId: promptPack.storyboardAssetId,
    projectionPath,
    manifestPath,
    prompts: promptPack.prompts.length,
    version: promptPackObservationVersion(nextManifest, nextPromptPackHash, current.sourceActionHash),
  };
}

export async function replaceStoryboardPromptPack(
  options: ReplaceStoryboardPromptPackOptions,
): Promise<ReplaceStoryboardPromptPackResult> {
  const cwd = resolve(options.cwd);
  const promptPackPath = resolveGuardedProjectPath(cwd, options.filePath, "Storyboard prompt pack");
  const promptPack = StoryboardPromptPackSchema.parse(JSON.parse(await readFile(promptPackPath, "utf8")));
  const manifestPath = promptPackManifestPath(cwd, promptPack.storyboardAssetId);
  const manifest = await readPromptPackManifest(manifestPath);
  assertPromptPackManifestIdentity(cwd, manifest, promptPack, promptPackPath);
  const managedProjectionPath = managedPromptPackProjectionPath(cwd, promptPack.storyboardAssetId);
  const currentPromptPack = await readManagedPromptPack(managedProjectionPath);
  const current = await currentPromptPackObservation(cwd, manifest, managedProjectionPath);
  assertPromptPackExpectedVersion(options.expectedVersion, current.version, "replace");

  const replacementHash = promptPackHash(promptPack);
  const sourcePromptPackHash = currentPromptPack ? promptPackHash(currentPromptPack) : manifest.basePromptPackHash;
  const projectionPath = cowPromptPackProjectionPath(cwd, promptPack.storyboardAssetId, replacementHash);
  const referencePolicy = promptPackReferencePolicy({
    managedProjectionPath: toProjectPath(cwd, managedProjectionPath),
    replacementProjectionPath: toProjectPath(cwd, projectionPath),
    promptPackPath: toProjectPath(cwd, promptPackPath),
  });
  await writeJson(projectionPath, {
    schemaVersion: 1,
    kind: "clash.storyboard.prompt-pack.replacement",
    storyboardAssetId: promptPack.storyboardAssetId,
    sourceActionPath: manifest.sourceActionPath,
    copyOnWrite: true,
    copyOnWriteKind: "storyboard-prompt-pack-replacement",
    sourceProjectionPath: referencePolicy.managedProjectionPath,
    sourcePromptPackHash,
    promptPack,
    promptPackHash: replacementHash,
    referencePolicy,
    replacedAt: new Date().toISOString(),
  });

  return {
    replaced: true,
    copyOnWrite: true,
    storyboardAssetId: promptPack.storyboardAssetId,
    projectionPath,
    referencePolicy,
    sourcePromptPackHash,
    promptPackHash: replacementHash,
    prompts: promptPack.prompts.length,
    version: current.version,
  };
}

function promptPackReferencePolicy(options: {
  managedProjectionPath: string;
  replacementProjectionPath: string;
  promptPackPath: string;
}): StoryboardPromptPackReferencePolicy {
  return {
    target: "storyboard-prompt-pack",
    automaticRewire: false,
    existingReferencesPreserved: true,
    managedProjectionPath: options.managedProjectionPath,
    replacementProjectionPath: options.replacementProjectionPath,
    rewireRequiredForDownstream: true,
    rewireCommand: "clash production apply-storyboard-prompt-pack",
    rewireArgs: ["--file", options.promptPackPath],
  };
}

function promptPackHash(promptPack: StoryboardPromptPack): string {
  return hashProjectionContent(stableJson(promptPack));
}

function sourceActionHash(action: unknown): string {
  return hashProjectionContent(stableJson(action));
}

function parsePromptPackManifest(value: unknown): StoryboardPromptPackManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid storyboard prompt-pack manifest");
  }
  const manifest = value as Partial<StoryboardPromptPackManifest>;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "clash.storyboard.prompt-pack.manifest" ||
    typeof manifest.storyboardAssetId !== "string" ||
    typeof manifest.promptPackPath !== "string" ||
    typeof manifest.basePromptPackHash !== "string" ||
    typeof manifest.sourceActionPath !== "string" ||
    typeof manifest.sourceActionHash !== "string" ||
    typeof manifest.prompts !== "number"
  ) {
    throw new Error("Invalid storyboard prompt-pack manifest");
  }
  return manifest as StoryboardPromptPackManifest;
}

async function readPromptPackManifest(manifestPath: string): Promise<StoryboardPromptPackManifest> {
  try {
    return parsePromptPackManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  } catch (error) {
    throw new Error(
      `READ_REQUIRED: Run \`clash production project-storyboard-prompt-pack\` before writing. ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertPromptPackManifestIdentity(
  cwd: string,
  manifest: StoryboardPromptPackManifest,
  promptPack: StoryboardPromptPack,
  promptPackPath: string,
): void {
  if (manifest.storyboardAssetId !== promptPack.storyboardAssetId) {
    throw new Error(
      `Storyboard prompt-pack manifest belongs to ${manifest.storyboardAssetId}, not ${promptPack.storyboardAssetId}.`,
    );
  }
  if (manifest.promptPackPath !== toProjectComparablePath(cwd, promptPackPath)) {
    throw new Error("READ_REQUIRED: This prompt-pack file was not projected from the current cwd path.");
  }
}

async function currentPromptPackObservation(
  cwd: string,
  manifest: StoryboardPromptPackManifest,
  managedProjectionPath: string,
): Promise<{ version: string; sourceActionHash: string }> {
  const sourceActionPath = resolveGuardedProjectPath(cwd, manifest.sourceActionPath, "Storyboard source action");
  const sourceAction = AssetMetadataFillActionSchema.parse(JSON.parse(await readFile(sourceActionPath, "utf8")));
  const currentSourceActionHash = sourceActionHash(sourceAction);
  const currentPromptPack = await readManagedPromptPack(managedProjectionPath);
  const currentPromptPackHash = currentPromptPack
    ? promptPackHash(currentPromptPack)
    : manifest.basePromptPackHash;
  return {
    version: promptPackObservationVersion(manifest, currentPromptPackHash, currentSourceActionHash),
    sourceActionHash: currentSourceActionHash,
  };
}

function assertPromptPackExpectedVersion(
  expectedVersion: string,
  currentVersion: string,
  verb: "apply" | "replace",
): void {
  if (!expectedVersion) {
    throw new Error(`READ_REQUIRED: Project the storyboard prompt pack before ${verb}.`);
  }
  if (expectedVersion !== currentVersion) {
    throw new Error(
      `STALE_READ: The storyboard prompt pack or source action changed after it was read. ` +
      `Project it again and reconcile before ${verb}.`,
    );
  }
}

function promptPackObservationVersion(
  manifest: StoryboardPromptPackManifest,
  basePromptPackHash: string,
  currentSourceActionHash: string,
): string {
  const hash = hashProjectionContent(stableJson({
    storyboardAssetId: manifest.storyboardAssetId,
    promptPackPath: manifest.promptPackPath,
    basePromptPackHash,
    sourceActionPath: manifest.sourceActionPath,
    sourceActionHash: currentSourceActionHash,
  }));
  return `storyboard-prompt-pack-v1:${hash}`;
}

async function readManagedPromptPack(projectionPath: string): Promise<StoryboardPromptPack | null> {
  if (!existsSync(projectionPath)) return null;
  const projection = JSON.parse(await readFile(projectionPath, "utf8")) as { promptPack?: unknown };
  return projection.promptPack ? StoryboardPromptPackSchema.parse(projection.promptPack) : null;
}

function managedPromptPackProjectionPath(cwd: string, storyboardAssetId: string): string {
  return resolveAgentFilePathInsideCwd({
    cwd,
    filePath: join(cwd, "projections", "storyboards", `${safeSlug(storyboardAssetId)}.prompt-pack.json`),
    writeVerb: "Storyboard managed prompt pack",
  });
}

function cowPromptPackProjectionPath(cwd: string, storyboardAssetId: string, promptPackHash: string): string {
  return resolveAgentFilePathInsideCwd({
    cwd,
    filePath: join(cwd, "projections", "storyboards", `${safeSlug(storyboardAssetId)}.prompt-pack.${promptPackHash}.cow.json`),
    writeVerb: "Storyboard replacement prompt pack",
  });
}

function promptPackManifestPath(cwd: string, storyboardAssetId: string): string {
  return resolveAgentFilePathInsideCwd({
    cwd,
    filePath: join(cwd, "projections", "storyboards", `${safeSlug(storyboardAssetId)}.prompt-pack-manifest.json`),
    writeVerb: "Storyboard prompt-pack manifest",
  });
}

export function storyboardPromptPackObservationId(options: { cwd: string; filePath: string }): string {
  const cwd = resolve(options.cwd);
  const promptPackPath = resolveGuardedProjectPath(cwd, options.filePath, "Storyboard prompt pack");
  return toProjectPath(cwd, promptPackPath);
}

function resolveGuardedProjectPath(cwd: string, rawPath: string, label: string): string {
  return resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(cwd, rawPath, label),
    writeVerb: label,
  });
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
