import { publicProjectHostValue } from "@clash/shared-runtime/project-host-client";

import { resolveProjectContext } from "./project-context";
import {
  forgetWorktreeObservation,
  recordWorktreeObservation,
  requireWorktreeObservation,
} from "./worktree-observations";

type AgentObservationOptions = {
  entityKind: string;
  entityId: string;
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
};

type AgentObservationWriteOptions = AgentObservationOptions & {
  revision: unknown;
};

export function isAgentInvocation(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.CLASH_AGENT_MEMBER_ID?.trim());
}

export function publicAgentCommandResult<T extends Record<string, unknown>>(
  result: T,
): Record<string, unknown> {
  return publicProjectHostValue(result) as Record<string, unknown>;
}

export async function recordAgentObservation(
  options: AgentObservationWriteOptions,
): Promise<void> {
  const env = options.env ?? process.env;
  if (!isAgentInvocation(env)) return;
  const context = await resolveProjectContext({
    project: options.project,
    cwd: options.cwd,
    env,
  });
  if (typeof options.revision !== "string" || !options.revision.trim()) {
    throw new Error("Host read did not return an entity version.");
  }
  const revision = options.revision.trim();
  if (!context.workspaceRoot) {
    throw new Error(
      "Agent reads require a cwd linked through .clash/project.toml.",
    );
  }
  await recordWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: options.entityKind,
    entityId: options.entityId,
    revision,
  });
}

export async function requireAgentObservation(
  options: AgentObservationOptions,
): Promise<string | undefined> {
  const env = options.env ?? process.env;
  if (!isAgentInvocation(env)) return undefined;
  const context = await resolveProjectContext({
    project: options.project,
    cwd: options.cwd,
    env,
  });
  if (!context.workspaceRoot) {
    throw new Error(
      "READ_REQUIRED: Run the command from a cwd linked through .clash/project.toml and read the target first.",
    );
  }
  const observation = await requireWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: options.entityKind,
    entityId: options.entityId,
  });
  if (!observation.ok)
    throw new Error(`${observation.code}: ${observation.error}`);
  return observation.revision;
}

export async function forgetAgentObservation(
  options: AgentObservationOptions,
): Promise<void> {
  const env = options.env ?? process.env;
  if (!isAgentInvocation(env)) return;
  const context = await resolveProjectContext({
    project: options.project,
    cwd: options.cwd,
    env,
  });
  if (!context.workspaceRoot) return;
  await forgetWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: options.entityKind,
    entityId: options.entityId,
  });
}
