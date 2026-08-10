import { Command } from "commander";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { directorStageJsonSchema, TIMELINE_DSL_DEFINITION } from "@clash/shared-types";

import { isJsonMode, printJson } from "../lib/output";
import { resolveCanvasActor, resolveCanvasProjectContext } from "./canvas";
import {
  applyTextContent,
  publicTextMutationResult,
  readNode,
  registerTextRevisionIndex,
} from "./text";
import {
  recordWorktreeObservation,
  requireWorktreeObservation,
} from "../lib/worktree-observations";
import {
  createTextAppliedRevision,
  textContentFromNode,
  textHash,
  textReadToken,
} from "../lib/text-projection";
import {
  getProjectionKind,
  listProjectionKinds,
  projectionFilePath,
  projectionKindsForMetadata,
  projectionObservationEntityKind,
} from "../lib/projection-kinds";
import { listDeclaredAssetMetadataKindNames } from "../lib/workspace-metadata-kinds";

/**
 * One surface for every agent-editable entity.
 *
 * An agent does three things with projected state: learn the DSL, pull the file,
 * apply it back. `--kind` is a parameter, so declaring a projectable entity adds
 * no command.
 */

export const projectionCommand = new Command("projection")
  .alias("projections")
  .description(
    `Agent-editable entity projections: learn the DSL, pull the file, apply it back.

Workflow:
  clash projection kinds --json
  clash projection schema --kind stage --json
  clash projection pull --kind component --id <node-id>
  # edit the file with normal file tools
  clash projection apply --kind component --id <node-id>

CAS is implicit: pull records what it read and apply refuses a stale write.
There is no token to carry and no force flag; re-pull, reconcile, apply again.`,
  );

projectionCommand
  .command("kinds")
  .description("List every projectable entity kind this build declares")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    // Declared metadata kinds are projectable too, so a kind a workspace or
    // plugin declares shows up here without a code change.
    const declared = projectionKindsForMetadata(
      await listDeclaredAssetMetadataKindNames(process.cwd()).catch(() => []),
    );
    const payload = [...listProjectionKinds(), ...declared].map((kind) => ({
      kind: kind.kind,
      description: kind.description,
      path: `${kind.directory.join("/")}/<id>${kind.suffix}`,
      idKind: kind.idKind,
      source: kind.source,
      ...(kind.nodeType ? { nodeType: kind.nodeType } : {}),
      dsl: kind.dsl,
    }));
    if (isJsonMode(options)) {
      printJson(payload as unknown as Record<string, unknown>);
      return;
    }
    for (const entry of payload) {
      console.log(`${entry.kind.padEnd(11)} ${entry.path.padEnd(42)} ${entry.description}`);
    }
  });

projectionCommand
  .command("schema")
  .description("Return the machine-readable contract for one projection kind")
  .requiredOption("--kind <kind>", "Declared projection kind")
  .option("--json", "Output as JSON")
  .action((options) => {
    try {
      const declared = getProjectionKind(options.kind);
      const contract = declared.kind === "stage"
        ? directorStageJsonSchema("state")
        : declared.kind === "timeline"
          ? (TIMELINE_DSL_DEFINITION as unknown as Record<string, unknown>)
          : undefined;
      const payload = {
        kind: declared.kind,
        path: `${declared.directory.join("/")}/<id>${declared.suffix}`,
        dsl: declared.dsl,
        ...(contract ? { contract } : {}),
      };
      if (isJsonMode(options)) {
        printJson(payload);
        return;
      }
      if (contract) {
        console.log(JSON.stringify(contract, null, 2));
      } else if (declared.dsl.source === "format") {
        console.log(
          `${declared.kind} is a plain ${declared.dsl.format} file at ${payload.path}; it has no separate schema.`,
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Observations are concurrency evidence, not permissions -- so they are recorded
 * and required for every client, not only agent-tagged ones. That is what lets
 * the projection loop close without exposing a read token.
 */
async function recordProjectionObservation(
  context: { workspaceRoot?: string; projectId: string },
  kind: string,
  entityId: string,
  revision: string,
): Promise<void> {
  if (!context.workspaceRoot) {
    throw new Error("Projection reads require a cwd linked through .clash/project.toml.");
  }
  await recordWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: projectionObservationEntityKind(kind),
    entityId,
    revision,
  });
}

async function requireProjectionObservation(
  context: { workspaceRoot?: string; projectId: string },
  kind: string,
  entityId: string,
): Promise<string> {
  if (!context.workspaceRoot) {
    throw new Error("READ_REQUIRED: Run this from a cwd linked through .clash/project.toml and pull first.");
  }
  const observation = await requireWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: projectionObservationEntityKind(kind),
    entityId,
  });
  if (!observation.ok) throw new Error(`${observation.code}: ${observation.error}`);
  return observation.revision;
}

function requireCanvasNodeKind(kind: string) {
  const declared = getProjectionKind(kind);
  if (declared.idKind !== "canvas-node") {
    throw new Error(
      `Kind ${kind} is a ${declared.idKind} entity; use \`clash ${declared.idKind === "timeline" ? "timeline" : "director"} pull/apply\` for its lifecycle-bearing commands.`,
    );
  }
  return declared;
}

projectionCommand
  .command("pull")
  .description("Write a projectable entity to an editable file and record the read")
  .requiredOption("--kind <kind>", "Declared projection kind")
  .requiredOption("--id <id>", "Entity id")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--file <path>", "Override the declared projection path")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const declared = requireCanvasNodeKind(options.kind);
      const context = await resolveCanvasProjectContext(options);
      const projectId = context.projectId;
      const filePath = options.file
        ?? projectionFilePath({ cwd: process.cwd(), kind: declared.kind, entityId: options.id });

      const node = await readNode(projectId, options.id);
      if (!node) throw new Error(`Node not found: ${options.id}`);
      if (declared.nodeType && node.type !== declared.nodeType) {
        throw new Error(
          `Node ${options.id} has type "${node.type}", but kind ${declared.kind} projects "${declared.nodeType}".`,
        );
      }

      const content = textContentFromNode(node);
      const version = node.readToken
        ?? textReadToken({ projectId, nodeId: options.id, content });
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, "utf8");
      await recordProjectionObservation(context, declared.kind, options.id, version);

      const payload = {
        pulled: true,
        kind: declared.kind,
        projectId,
        entityId: options.id,
        filePath,
        version,
        contentHash: textHash(content),
        immutable: node.immutable ?? false,
      };
      if (isJsonMode(options)) printJson(payload);
      else process.stderr.write(`wrote ${filePath}\n`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

projectionCommand
  .command("apply")
  .description("Apply an edited projection back to the entity under implicit CAS")
  .requiredOption("--kind <kind>", "Declared projection kind")
  .requiredOption("--id <id>", "Entity id")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--file <path>", "Override the declared projection path")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const declared = requireCanvasNodeKind(options.kind);
      const context = await resolveCanvasProjectContext(options);
      const projectId = context.projectId;
      const filePath = options.file
        ?? projectionFilePath({ cwd: process.cwd(), kind: declared.kind, entityId: options.id });
      const actor = await resolveCanvasActor();

      // Implicit CAS with no agent-visible token: the pull recorded what was
      // read, and this write must still match it.
      const expectedVersion = await requireProjectionObservation(context, declared.kind, options.id);
      const content = readFileSync(filePath, "utf8");
      const result = await applyTextContent(projectId, options.id, content, {
        observedVersion: expectedVersion,
        filePath,
        cwd: process.cwd(),
        actor,
      });

      const revision = result.textRevision ?? createTextAppliedRevision({
        projectId,
        nodeId: options.id,
        cwd: process.cwd(),
        filePath,
        content,
        actor,
      });
      await recordProjectionObservation(
        context,
        declared.kind,
        options.id,
        result.readToken ?? result.version
          ?? textReadToken({ projectId, nodeId: options.id, content }),
      );
      const revisionIndex = await registerTextRevisionIndex(revision, content);

      const payload = {
        ...publicTextMutationResult(result),
        kind: declared.kind,
        projectId,
        entityId: options.id,
        filePath,
        revision,
        revisionIndex,
        contentHash: textHash(content),
      };
      if (isJsonMode(options)) printJson(payload);
      else process.stderr.write(`applied ${filePath} to ${options.id}\n`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
