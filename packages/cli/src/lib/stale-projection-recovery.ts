import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { resolveAgentFilePathInsideCwd } from "./projection-cas";
import { recordWorktreeObservation } from "./worktree-observations";

export type StaleProjectionEntityKind = "timeline" | "director-stage";

export type StaleProjectionRecovery = {
  schemaVersion: 1;
  code: "STALE_READ";
  entityKind: StaleProjectionEntityKind;
  entityId: string;
  currentRevisionId: string;
  editedProjectionPath: string;
  latestProjectionPath: string;
  recoveryReceiptPath: string;
  next: "Merge the edited projection into the latest projection, then retry the apply command.";
  resubmitted: false;
};

export class StaleProjectionRecoveryError extends Error {
  readonly code = "STALE_READ";

  constructor(
    label: string,
    readonly recovery: StaleProjectionRecovery,
  ) {
    super([
      `STALE_READ: ${label} ${recovery.entityId} changed; latest revision ${recovery.currentRevisionId}`,
      `was pulled to ${recovery.latestProjectionPath}.`,
      `Your edited projection remains at ${recovery.editedProjectionPath}.`,
      "Merge the edited projection into the latest projection, then retry; Clash did not apply or resubmit your edit.",
      `CLASH_RECOVERY=${JSON.stringify(recovery)}`,
    ].join(" "));
    this.name = "StaleProjectionRecoveryError";
  }
}

export async function recoverStaleProjection(options: {
  workspaceRoot: string;
  projectId: string;
  entityKind: StaleProjectionEntityKind;
  entityId: string;
  currentRevisionId: string;
  currentObservation: string;
  editedProjectionPath: string;
  latestContent: string;
}): Promise<StaleProjectionRecovery> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const entityId = normalize(options.entityId, "entity id");
  const segment = projectionSegment(entityId);
  const suffix = options.entityKind === "timeline"
    ? ".timeline.yaml"
    : ".director-stage.json";
  const recoveryDirectory = join(workspaceRoot, ".clash", "recovery", options.entityKind);
  const latestAbsolutePath = resolveAgentFilePathInsideCwd({
    cwd: workspaceRoot,
    filePath: join(recoveryDirectory, `${segment}.latest${suffix}`),
    writeVerb: "Stale projection recovery",
  });
  const receiptAbsolutePath = resolveAgentFilePathInsideCwd({
    cwd: workspaceRoot,
    filePath: join(recoveryDirectory, `${segment}.recovery.json`),
    writeVerb: "Stale projection recovery",
  });
  const editedAbsolutePath = resolveAgentFilePathInsideCwd({
    cwd: workspaceRoot,
    filePath: options.editedProjectionPath,
    writeVerb: "Edited projection",
  });
  const recovery: StaleProjectionRecovery = {
    schemaVersion: 1,
    code: "STALE_READ",
    entityKind: options.entityKind,
    entityId,
    currentRevisionId: normalize(options.currentRevisionId, "current revision id"),
    editedProjectionPath: relativePath(workspaceRoot, editedAbsolutePath),
    latestProjectionPath: relativePath(workspaceRoot, latestAbsolutePath),
    recoveryReceiptPath: relativePath(workspaceRoot, receiptAbsolutePath),
    next: "Merge the edited projection into the latest projection, then retry the apply command.",
    resubmitted: false,
  };

  await mkdir(dirname(latestAbsolutePath), { recursive: true });
  await writeFile(latestAbsolutePath, options.latestContent, { encoding: "utf8", mode: 0o600 });
  await writeFile(receiptAbsolutePath, `${JSON.stringify(recovery, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await recordWorktreeObservation({
    workspaceRoot,
    projectId: options.projectId,
    entityKind: options.entityKind,
    entityId,
    revision: options.currentObservation,
  });
  return recovery;
}

export function staleProjectionRecoveryError(
  label: string,
  recovery: StaleProjectionRecovery,
): StaleProjectionRecoveryError {
  return new StaleProjectionRecoveryError(label, recovery);
}

function projectionSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^\.+/, "") || "projection";
}

function relativePath(workspaceRoot: string, absolutePath: string): string {
  const value = relative(workspaceRoot, absolutePath);
  if (!value || value.startsWith("..")) {
    throw new Error("Stale projection recovery paths must stay inside the current project cwd.");
  }
  return value;
}

function normalize(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
