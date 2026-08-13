import { Command } from "commander";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import {
  listDeclaredAssetMetadataKinds,
  parseDeclaredAssetMetadata,
} from "@clash/shared-types";

import { isJsonMode, printJson } from "../lib/output";
import {
  attachAssetMetadata,
  readAssetMetadataBody,
} from "../lib/attach-asset-metadata";
import { applyProductionMetadataProjection } from "../lib/production-actions";
import { loadWorkspaceMetadataKinds } from "../lib/workspace-metadata-kinds";
import { publicAgentCommandResult } from "../lib/agent-worktree-observation";
import { resolveProjectContext } from "../lib/project-context";
import {
  recordWorktreeObservation,
  requireWorktreeObservation,
} from "../lib/worktree-observations";

/**
 * One generic verb set over every declared metadata kind. `--kind` is a
 * parameter, never a command name, so declaring a new kind adds no CLI surface.
 */
/**
 * Reads one asset's metadata body as editable text, and the identity a write back is checked
 * against.
 *
 * Extracted so `projection pull` reaches metadata the same way `metadata get --body` does. Metadata
 * is projectable because it is authored: a description is written, and a transcript the host
 * produced is still corrected by hand. What is not projectable is the media itself -- bytes are not
 * text, and the CAS owns them.
 */
export async function readAssetMetadataProjection(options: {
  cwd: string;
  assetId: string;
  metadataKind: string;
  assetsPath?: string;
}): Promise<{ content: string; revision: string }> {
  const { manifest } = await readAssetManifest(options.cwd, options.assetsPath);
  const asset = manifest.assets?.find(
    (candidate) => candidate.id === options.assetId,
  );
  if (!asset) throw new Error(`Asset ${options.assetId} not found`);
  const attached = asset.metadata?.[options.metadataKind];
  if (!attached)
    throw new Error(
      `Asset ${options.assetId} has no ${options.metadataKind} metadata`,
    );
  const bodyHash = (attached as { bodyHash?: unknown }).bodyHash;
  if (typeof bodyHash !== "string") {
    throw new Error(
      `${options.metadataKind} on ${options.assetId} has no stored body`,
    );
  }
  const body = await readAssetMetadataBody({ contentHash: bodyHash });
  return { content: `${JSON.stringify(body, null, 2)}\n`, revision: bodyHash };
}

export const assetMetadataCommand = new Command("metadata").description(
  "Read and attach declared metadata on an asset",
);

async function readJsonArgument(value: string): Promise<unknown> {
  const contents =
    value === "-" ? readFileSync(0, "utf8") : await readFile(value, "utf8");
  return JSON.parse(contents) as unknown;
}

async function readAssetManifest(cwd: string, assetsPath?: string) {
  const path = assetsPath ?? join(cwd, "assets", "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as {
    assets?: Array<{ id: string; metadata?: Record<string, unknown> }>;
  };
  return { path, manifest };
}

async function recordAssetMetadataObservation(options: {
  cwd: string;
  entityId: string;
  revision: string;
}): Promise<void> {
  const context = await resolveProjectContext({ cwd: options.cwd });
  if (!context.workspaceRoot) {
    throw new Error(
      "Asset metadata reads require a cwd linked through .clash/project.toml.",
    );
  }
  await recordWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: "asset-metadata",
    entityId: options.entityId,
    revision: options.revision,
  });
}

async function requireAssetMetadataObservation(options: {
  cwd: string;
  entityId: string;
}): Promise<string> {
  let context: Awaited<ReturnType<typeof resolveProjectContext>>;
  try {
    context = await resolveProjectContext({ cwd: options.cwd });
  } catch (error) {
    throw new Error(
      `READ_REQUIRED: Link this cwd through .clash/project.toml and read the metadata before applying. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!context.workspaceRoot) {
    throw new Error(
      "READ_REQUIRED: Link this cwd through .clash/project.toml and read the metadata before applying.",
    );
  }
  const observation = await requireWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: "asset-metadata",
    entityId: options.entityId,
  });
  if (!observation.ok) {
    throw new Error(`${observation.code}: ${observation.error}`);
  }
  return observation.revision;
}

assetMetadataCommand
  .command("kinds")
  .description("List every metadata kind this build declares")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    await loadWorkspaceMetadataKinds(process.cwd());
    const kinds = listDeclaredAssetMetadataKinds();
    if (isJsonMode(options)) {
      printJson(kinds);
      return;
    }
    for (const kind of kinds) console.log(kind);
  });

assetMetadataCommand
  .command("list")
  .description("List the metadata attached to one asset")
  .requiredOption("--asset <id>", "Asset id")
  .option("--assets <path>", "Asset manifest path")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const { manifest } = await readAssetManifest(
        process.cwd(),
        options.assets,
      );
      const asset = manifest.assets?.find(
        (candidate) => candidate.id === options.asset,
      );
      if (!asset) throw new Error(`Asset ${options.asset} not found`);
      const attached: Array<Record<string, unknown>> = Object.entries(
        asset.metadata ?? {},
      )
        .filter(
          ([key, value]) =>
            key !== "metadataFills" &&
            value &&
            typeof value === "object" &&
            !Array.isArray(value),
        )
        .map(([kind, value]) => ({
          ...(value as Record<string, unknown>),
          kind,
        }));
      if (isJsonMode(options)) {
        printJson(attached);
        return;
      }
      for (const entry of attached) {
        console.log(
          `${entry.kind}${entry.bodyHash ? `  body ${String(entry.bodyHash).slice(0, 19)}…` : ""}`,
        );
      }
      if (attached.length === 0) console.log("No metadata attached.");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

assetMetadataCommand
  .command("get")
  .description("Read one attached metadata kind, or its stored body")
  .requiredOption("--asset <id>", "Asset id")
  .requiredOption("--kind <kind>", "Declared metadata kind")
  .option("--body", "Print the stored body instead of the attached identity")
  .option("--assets <path>", "Asset manifest path")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const { manifest } = await readAssetManifest(
        process.cwd(),
        options.assets,
      );
      const asset = manifest.assets?.find(
        (candidate) => candidate.id === options.asset,
      );
      if (!asset) throw new Error(`Asset ${options.asset} not found`);
      const attached = asset.metadata?.[options.kind];
      if (!attached)
        throw new Error(
          `Asset ${options.asset} has no ${options.kind} metadata`,
        );
      if (!options.body) {
        printJson(attached);
        return;
      }
      const bodyHash = (attached as { bodyHash?: unknown }).bodyHash;
      if (typeof bodyHash !== "string") {
        throw new Error(
          `${options.kind} on ${options.asset} has no stored body`,
        );
      }
      printJson(await readAssetMetadataBody({ contentHash: bodyHash }));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

assetMetadataCommand
  .command("set")
  .description(
    "Attach declared metadata to an asset, storing any body out of line",
  )
  .requiredOption("--asset <id>", "Asset id")
  .requiredOption("--kind <kind>", "Declared metadata kind")
  .requiredOption("--metadata <path>", "Metadata JSON path, or - for stdin")
  .option("--body <path>", "Body JSON path stored as an immutable blob")
  .option("--producer <id>", "Who produced this metadata", "clash.cli")
  .option("--assets <path>", "Asset manifest path")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const metadata = await readJsonArgument(options.metadata);
      if (
        !metadata ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
      ) {
        throw new Error("metadata must be a JSON object");
      }
      const body =
        options.body === undefined
          ? undefined
          : await readJsonArgument(options.body);
      const result = await attachAssetMetadata({
        cwd: process.cwd(),
        assetId: options.asset,
        metadataKind: options.kind,
        metadata: metadata as Record<string, unknown>,
        producer: options.producer,
        ...(body === undefined ? {} : { body }),
        ...(options.assets ? { assetsPath: options.assets } : {}),
      });
      // Attaching is itself a read of the projection it just wrote. Without
      // this the first apply of that projection fails READ_REQUIRED and the
      // edit loop cannot be closed from the CLI at all.
      await recordAssetMetadataObservation({
        entityId: relative(process.cwd(), result.metadataPath)
          .split(sep)
          .join("/"),
        revision: result.version,
        cwd: process.cwd(),
      }).catch(() => undefined);
      if (isJsonMode(options)) {
        printJson(publicAgentCommandResult(result));
        return;
      }
      console.log(`attached ${result.metadataKind} to ${result.assetId}`);
      if (result.body) {
        console.log(
          `body: ${result.body.contentHash} (${result.body.bytes} bytes${result.body.deduplicated ? ", deduplicated" : ""})`,
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

assetMetadataCommand
  .command("apply")
  .description(
    "Apply an edited metadata projection under the linked worktree's implicit CAS observation; re-read after READ_REQUIRED or STALE_READ",
  )
  .requiredOption(
    "--file <path>",
    "Edited metadata projection JSON under projections/metadata/",
  )
  .option("--assets <path>", "Asset manifest path")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const cwd = process.cwd();
      const entityId = relative(cwd, resolve(cwd, options.file))
        .split(sep)
        .join("/");
      const observed = await requireAssetMetadataObservation({
        cwd,
        entityId,
      });
      const result = await applyProductionMetadataProjection({
        cwd,
        filePath: options.file,
        ...(options.assets ? { assetsPath: options.assets } : {}),
        expectedVersion: observed,
      });
      await recordAssetMetadataObservation({
        entityId,
        revision: result.version,
        cwd,
      }).catch(() => undefined);
      if (isJsonMode(options)) {
        printJson(publicAgentCommandResult(result));
        return;
      }
      console.log(`applied ${result.metadataKind} to ${result.targetAssetId}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

assetMetadataCommand
  .command("validate")
  .description(
    "Check a metadata document against its declared schema without writing",
  )
  .requiredOption("--kind <kind>", "Declared metadata kind")
  .requiredOption("--metadata <path>", "Metadata JSON path, or - for stdin")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      await loadWorkspaceMetadataKinds(process.cwd());
      parseDeclaredAssetMetadata(
        options.kind,
        await readJsonArgument(options.metadata),
      );
      if (isJsonMode(options)) {
        printJson({ valid: true, kind: options.kind });
        return;
      }
      console.log(`${options.kind}: valid`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
