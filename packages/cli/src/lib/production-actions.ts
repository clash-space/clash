import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import {
  applyAssetMetadataFill,
  parseAssetMetadataFillAction,
  parseDeclaredAssetMetadata,
} from "@clash/shared-types";
import {
  hashProjectionContent,
  resolveAgentFilePathInsideCwd,
  resolveProjectionFilePathInsideCwd,
} from "./projection-cas";
import { resolveProjectContext } from "./project-context";
import { loadWorkspaceMetadataKinds } from "./workspace-metadata-kinds";

type ProductionAssetManifestAsset = {
  id: string;
  type: string;
  path?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

type ProductionAssetManifest = {
  assets: ProductionAssetManifestAsset[];
  [key: string]: unknown;
};

export type ApplyProductionMetadataActionOptions = {
  cwd: string;
  assetsPath?: string;
} & (
  | { actionPath: string; action?: undefined }
  /**
   * An inline action never becomes a file. Provenance still holds, because the
   * ledger is keyed on `sourceActionHash`; only the path is absent.
   */
  | { actionPath?: undefined; action: Record<string, unknown> }
);

export type ApplyProductionMetadataActionResult = {
  applied: true;
  targetAssetId: string;
  metadataKind: string;
  assetsPath: string;
  metadataPath: string;
  metadataManifestPath: string;
  version: string;
  timelineProjectionPath?: string;
  transcriptCutPlanPath?: string;
  transcriptProjectionPath?: string;
  shotAnalysisProjectionPath?: string;
  blockedReason?: string;
  rightsLedgerPath?: string;
};

type AssetMetadataProjectionManifest = {
  schemaVersion: 2;
  kind: "clash.asset.metadata.manifest";
  target: {
    kind: "project-asset";
    projectId: string;
    assetId: string;
  };
  metadataKind: string;
  metadataPath: string;
  baseMetadataHash: string;
  /** Absent when the action was synthesized in process and never became a file. */
  sourceActionPath?: string;
  sourceActionHash: string;
};

export type ApplyProductionMetadataProjectionOptions = {
  cwd: string;
  filePath: string;
  assetsPath?: string;
  expectedVersion: string;
};

export type ApplyProductionMetadataProjectionResult = {
  applied: true;
  targetAssetId: string;
  metadataKind: string;
  assetsPath: string;
  metadataPath: string;
  metadataManifestPath: string;
  beforeMetadataHash: string;
  afterMetadataHash: string;
  version: string;
};

export async function applyProductionMetadataAction(
  options: ApplyProductionMetadataActionOptions,
): Promise<ApplyProductionMetadataActionResult> {
  const cwd = options.cwd;
  await loadWorkspaceMetadataKinds(cwd);
  const actionPath =
    options.actionPath === undefined
      ? undefined
      : resolveAgentFilePathInsideCwd({
          cwd,
          filePath: resolveLocalPath(cwd, options.actionPath, "action"),
        });
  const assetsPath = resolveLocalPath(
    cwd,
    options.assetsPath ?? join("assets", "manifest.json"),
    "asset manifest",
  );
  const rawAction =
    actionPath === undefined
      ? options.action
      : (JSON.parse(await readFile(actionPath, "utf8")) as unknown);
  const fill = parseAssetMetadataFillAction(rawAction);
  if (fill.target.kind !== "project-asset") {
    throw new Error(
      `Metadata target ${fill.target.kind} cannot be applied to an Asset manifest`,
    );
  }
  const targetAssetId = fill.target.assetId;
  const targetAssetFileStem = safeProjectionFileSegment(
    targetAssetId,
    "targetAssetId",
  );
  const metadataKindFileStem = safeProjectionFileSegment(
    fill.metadataKind,
    "metadataKind",
  );
  const metadataPath = resolveProjectionFilePathInsideCwd({
    cwd,
    filePath: join(
      cwd,
      "projections",
      "metadata",
      `${targetAssetFileStem}.${metadataKindFileStem}.json`,
    ),
  });
  const metadataManifestPath = assetMetadataManifestPath(cwd, metadataPath);
  const manifest = parseAssetManifest(
    await readFile(assetsPath, "utf8"),
    assetsPath,
  );
  const assetIndex = manifest.assets.findIndex(
    (asset) => asset.id === targetAssetId,
  );
  if (assetIndex < 0) {
    throw new Error(`Asset ${targetAssetId} not found in ${assetsPath}`);
  }

  // Declared kinds are identity-shaped by design, so the manifest carries the
  // identity itself; bodies live in the blob store or the CAS projection.
  const updatedAsset = applyAssetMetadataFill(
    manifest.assets[assetIndex],
    fill,
  );
  manifest.assets[assetIndex] = updatedAsset;
  await writeJson(assetsPath, manifest);

  await writeJson(metadataPath, fill.metadata);
  const metadataManifest: AssetMetadataProjectionManifest = {
    schemaVersion: 2,
    kind: "clash.asset.metadata.manifest",
    target: fill.target,
    metadataKind: fill.metadataKind,
    metadataPath: toProjectPath(cwd, metadataPath),
    baseMetadataHash: productionMetadataHash(fill.metadata),
    ...(actionPath === undefined
      ? {}
      : { sourceActionPath: toProjectPath(cwd, actionPath) }),
    sourceActionHash: productionMetadataHash(fill),
  };
  await writeJson(metadataManifestPath, metadataManifest);

  const result: ApplyProductionMetadataActionResult = {
    applied: true,
    targetAssetId,
    metadataKind: fill.metadataKind,
    assetsPath,
    metadataPath,
    metadataManifestPath,
    version: assetMetadataObservationVersion(
      metadataManifest,
      metadataManifest.baseMetadataHash,
      metadataManifest.sourceActionHash,
    ),
  };

  return result;
}

export async function applyProductionMetadataProjection(
  options: ApplyProductionMetadataProjectionOptions,
): Promise<ApplyProductionMetadataProjectionResult> {
  const cwd = options.cwd;
  await loadWorkspaceMetadataKinds(cwd);
  const metadataPath = resolveLocalPath(
    cwd,
    options.filePath,
    "metadata projection",
  );
  const metadataManifestPath = assetMetadataManifestPath(cwd, metadataPath);
  const assetsPath = resolveLocalPath(
    cwd,
    options.assetsPath ?? join("assets", "manifest.json"),
    "asset manifest",
  );
  const projectId = (await resolveProjectContext({ cwd })).projectId;
  const metadataManifest = await readAssetMetadataManifest(
    metadataManifestPath,
    projectId,
  );
  if (metadataManifest.metadataPath !== toProjectPath(cwd, metadataPath)) {
    throw new Error(
      "READ_REQUIRED: This metadata file was not projected from the current cwd path.",
    );
  }

  // Every declared kind is agent-editable through the same CAS loop: built-ins
  // validate against their union, registry kinds against their declared schema.
  const metadata = parseDeclaredAssetMetadata(
    metadataManifest.metadataKind,
    JSON.parse(await readFile(metadataPath, "utf8")),
  ) as { kind: string } & Record<string, unknown>;
  if (metadata.kind !== metadataManifest.metadataKind) {
    throw new Error(
      `metadata kind mismatch: ${metadata.kind} does not match manifest ${metadataManifest.metadataKind}`,
    );
  }
  const manifest = parseAssetManifest(
    await readFile(assetsPath, "utf8"),
    assetsPath,
  );
  const assetIndex = manifest.assets.findIndex(
    (asset) => asset.id === metadataManifest.target.assetId,
  );
  if (assetIndex < 0) {
    throw new Error(
      `Asset ${metadataManifest.target.assetId} not found in ${assetsPath}`,
    );
  }

  const currentMetadata = manifest.assets[assetIndex].metadata?.[
    metadataManifest.metadataKind
  ] as
    | ({ body?: unknown; bodyHash?: unknown } & Record<string, unknown>)
    | undefined;
  // Only an explicit stub pins the body by hash. Registry identities may carry
  // their own bodyHash (a blob address) with different semantics, and an inline
  // body from an older write still hashes to its recorded identity.
  const beforeMetadataHash =
    currentMetadata?.body === "cas-projection" &&
    typeof currentMetadata.bodyHash === "string"
      ? currentMetadata.bodyHash
      : productionMetadataHash(currentMetadata ?? null);
  // A synthesized action left no file to re-verify against, so the hash the
  // manifest already recorded is the identity CAS is keyed on.
  const currentSourceActionHash =
    metadataManifest.sourceActionPath === undefined
      ? metadataManifest.sourceActionHash
      : productionMetadataHash(
          parseAssetMetadataFillAction(
            JSON.parse(
              await readFile(
                resolveLocalPath(
                  cwd,
                  metadataManifest.sourceActionPath,
                  "source action",
                ),
                "utf8",
              ),
            ),
          ),
        );
  const currentVersion = assetMetadataObservationVersion(
    metadataManifest,
    beforeMetadataHash,
    currentSourceActionHash,
  );
  if (!options.expectedVersion) {
    throw new Error(
      "READ_REQUIRED: Attach or read this metadata before applying the edited projection.",
    );
  }
  if (options.expectedVersion !== currentVersion) {
    throw new Error(
      "STALE_READ: Asset metadata or its source action changed after it was read. " +
        "Read the current metadata again and reconcile before applying.",
    );
  }

  const afterMetadataHash = productionMetadataHash(metadata);
  manifest.assets[assetIndex] = applyAssetMetadataFill(
    manifest.assets[assetIndex],
    {
      actionId: `metadata-projection-apply:${afterMetadataHash}`,
      target: metadataManifest.target,
      metadataKind: metadataManifest.metadataKind,
      metadata,
      producer: "clash assets metadata apply",
      createdAt: new Date().toISOString(),
    },
  );
  await writeJson(assetsPath, manifest);
  const nextMetadataManifest: AssetMetadataProjectionManifest = {
    ...metadataManifest,
    baseMetadataHash: afterMetadataHash,
    sourceActionHash: currentSourceActionHash,
  };
  await writeJson(metadataManifestPath, nextMetadataManifest);

  return {
    applied: true,
    targetAssetId: metadataManifest.target.assetId,
    metadataKind: metadataManifest.metadataKind,
    assetsPath,
    metadataPath,
    metadataManifestPath,
    beforeMetadataHash,
    afterMetadataHash,
    version: assetMetadataObservationVersion(
      nextMetadataManifest,
      afterMetadataHash,
      currentSourceActionHash,
    ),
  };
}

function normalizeProjectRelativePath(path: string, label: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error(
      `${label} must be a local project-relative path, not a URL`,
    );
  }
  if (isAbsolute(path)) {
    throw new Error(`${label} must be project-relative, not absolute`);
  }
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.includes("..")) {
    throw new Error(`${label} must stay inside the project`);
  }
  return parts.join("/");
}

function safeProjectionFileSegment(value: string, label: string): string {
  const segment = value.trim();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(segment) ||
    segment === "." ||
    segment === ".."
  ) {
    throw new Error(`${label} must be safe for projection file names`);
  }
  return segment;
}

function assetMetadataManifestPath(cwd: string, metadataPath: string): string {
  const extension = extname(metadataPath);
  return resolveProjectionFilePathInsideCwd({
    cwd,
    filePath: join(
      dirname(metadataPath),
      `${basename(metadataPath, extension)}.manifest.json`,
    ),
  });
}

async function readAssetMetadataManifest(
  manifestPath: string,
  legacyProjectId: string,
): Promise<AssetMetadataProjectionManifest> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `READ_REQUIRED: Attach this metadata before writing. ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("READ_REQUIRED: Invalid asset metadata manifest");
  }
  const manifest = value as Partial<AssetMetadataProjectionManifest> & {
    targetAssetId?: unknown;
  };
  if (
    (manifest as { schemaVersion?: unknown }).schemaVersion === 1 &&
    manifest.kind === "clash.asset.metadata.manifest" &&
    typeof manifest.targetAssetId === "string" &&
    typeof manifest.metadataKind === "string" &&
    typeof manifest.metadataPath === "string" &&
    typeof manifest.baseMetadataHash === "string" &&
    (manifest.sourceActionPath === undefined ||
      typeof manifest.sourceActionPath === "string") &&
    typeof manifest.sourceActionHash === "string"
  ) {
    return {
      schemaVersion: 2,
      kind: manifest.kind,
      target: {
        kind: "project-asset",
        projectId: legacyProjectId,
        assetId: manifest.targetAssetId,
      },
      metadataKind: manifest.metadataKind,
      metadataPath: manifest.metadataPath,
      baseMetadataHash: manifest.baseMetadataHash,
      ...(manifest.sourceActionPath
        ? { sourceActionPath: manifest.sourceActionPath }
        : {}),
      sourceActionHash: manifest.sourceActionHash,
    };
  }
  if (
    manifest.schemaVersion !== 2 ||
    manifest.kind !== "clash.asset.metadata.manifest" ||
    !manifest.target ||
    manifest.target.kind !== "project-asset" ||
    typeof manifest.target.projectId !== "string" ||
    typeof manifest.target.assetId !== "string" ||
    typeof manifest.metadataKind !== "string" ||
    typeof manifest.metadataPath !== "string" ||
    typeof manifest.baseMetadataHash !== "string" ||
    (manifest.sourceActionPath !== undefined &&
      typeof manifest.sourceActionPath !== "string") ||
    typeof manifest.sourceActionHash !== "string"
  ) {
    throw new Error("READ_REQUIRED: Invalid asset metadata manifest");
  }
  return manifest as AssetMetadataProjectionManifest;
}

function assetMetadataObservationVersion(
  manifest: AssetMetadataProjectionManifest,
  baseMetadataHash: string,
  currentSourceActionHash: string,
): string {
  const hash = productionMetadataHash({
    target: manifest.target,
    metadataKind: manifest.metadataKind,
    metadataPath: manifest.metadataPath,
    baseMetadataHash,
    sourceActionPath: manifest.sourceActionPath,
    sourceActionHash: currentSourceActionHash,
  });
  return `asset-metadata-v1:${hash}`;
}

export function productionMetadataObservationId(options: {
  cwd: string;
  filePath: string;
}): string {
  const metadataPath = resolveLocalPath(
    options.cwd,
    options.filePath,
    "metadata projection",
  );
  return toProjectPath(options.cwd, metadataPath);
}

function productionMetadataHash(value: unknown): string {
  return hashProjectionContent(stableJson(value));
}

function parseAssetManifest(
  raw: string,
  path: string,
): ProductionAssetManifest {
  const parsed = JSON.parse(raw) as Partial<ProductionAssetManifest>;
  if (!Array.isArray(parsed.assets)) {
    throw new Error(`Invalid asset manifest at ${path}: expected assets array`);
  }
  return {
    ...parsed,
    assets: parsed.assets.map((asset) => ({
      ...asset,
      metadata:
        asset.metadata &&
        typeof asset.metadata === "object" &&
        !Array.isArray(asset.metadata)
          ? (asset.metadata as Record<string, unknown>)
          : {},
    })),
  } as ProductionAssetManifest;
}

function resolveLocalPath(cwd: string, path: string, label: string): string {
  if (!path || typeof path !== "string") {
    throw new Error(`${label} path is required`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error(`${label} path must be a local project path, not a URL`);
  }
  const root = resolve(cwd);
  const resolved = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const relativePath = relative(root, resolved);
  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  ) {
    return resolved;
  }
  throw new Error(`${label} path must stay inside the current project cwd`);
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return relative(resolve(cwd), absolutePath)
    .split(/[\\/]+/)
    .join("/");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : stableJson(item))).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}
