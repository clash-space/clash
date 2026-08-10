import { Command } from "commander";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  TIMELINE_DSL_DEFINITION,
  TIMELINE_MASK_KEYFRAMES_DSL_EXAMPLE,
  TIMELINE_OPERATION_CATALOG,
  LoroSyncClient,
  readProjectTimeline,
  requestTimelineRender,
  projectTimelineReadToken,
  timelineDslToYaml,
  type TimelineAgentOperationId,
  type ProjectTimeline,
  type ResolvedTimelineDsl,
} from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { isJsonMode, printJson, printTable } from "../lib/output";
import { isDaemonRunning, sendCommand } from "../lib/daemon";
import { assertAgentHostWritePath } from "../lib/agent-host-write";
import { type ResolvedProjectContext } from "../lib/project-context";
import {
  recordWorktreeObservation,
  requireWorktreeObservation,
} from "../lib/worktree-observations";
import {
  resolveCanvasPresenceOptions,
  resolveCanvasActor,
  resolveCanvasProjectContext,
} from "./canvas";
import { fetchAssetRecord, type AssetRecordResult } from "./assets";
import {
  normalizeTimelineDslForYaml,
  parseTimelineFileForApply,
  resolveTimelineFilePath,
  timelineHash,
} from "../lib/timeline-projection";
import { writeTimelineTranscriptProjection } from "../lib/timeline-transcript-projection";
import {
  recoverStaleProjection,
  staleProjectionRecoveryError,
} from "../lib/stale-projection-recovery";

function isAgentTimelineClient(): boolean {
  return resolveCanvasPresenceOptions().clientType === "agent";
}

async function recordTimelineObservation(
  context: ResolvedProjectContext,
  nodeId: string,
  revision: string,
): Promise<void> {
  if (!isAgentTimelineClient()) return;
  if (!context.workspaceRoot) {
    throw new Error("Agent reads require a cwd linked through .clash/project.toml.");
  }
  await recordWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: "timeline",
    entityId: nodeId,
    revision,
  });
}

async function requireTimelineObservation(
  context: ResolvedProjectContext,
  nodeId: string,
): Promise<string | undefined> {
  if (!isAgentTimelineClient()) return undefined;
  if (!context.workspaceRoot) {
    throw new Error("READ_REQUIRED: Run the command from a cwd linked through .clash/project.toml and pull the timeline first.");
  }
  const observation = await requireWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: "timeline",
    entityId: nodeId,
  });
  if (!observation.ok) throw new Error(`${observation.code}: ${observation.error}`);
  return observation.revision;
}

export const timelineCommand = new Command("timeline")
  .description(
    `Manage Project Timeline entities through agent-editable YAML projections.

Workflow:
  clash timeline create --id episode-1 --name "Episode 1"
  clash timeline pull --timeline episode-1
  # edit timelines/episode-1.timeline.yaml with normal file tools
  clash timeline apply --timeline episode-1

CAS is implicit: reads record an opaque host observation in
.clash/observed.json; ownership changes and apply reject stale writes.`,
  );

type TimelineWorkspaceResult = {
  timelines?: ProjectTimeline[];
  timeline?: ProjectTimeline;
  versions?: Record<string, string>;
  version?: string;
  readToken?: string;
  sourceVersion?: string;
  error?: string;
  code?: string;
};

export type TimelineRenderReceipt = {
  submitted: true;
  completed: boolean;
  timelineId: string;
  sourceTimelineRevisionId: string;
  renderNodeId: string;
  target: { kind: "project-assets" } | {
    kind: "canvas";
    canvasId: string;
    actionNodeId: string;
  };
  status: "pending" | "completed" | "failed";
  asset?: AssetRecordResult;
  error?: string;
};

type TimelineRenderClient = Pick<LoroSyncClient, "doc" | "flush">;

function renderNodeReadback(
  client: TimelineRenderClient,
  renderNodeId: string,
): { status: TimelineRenderReceipt["status"]; assetId?: string; error?: string } {
  const raw = client.doc.getMap("nodes").get(renderNodeId) as Record<string, any> | undefined;
  const data = raw?.data && typeof raw.data === "object" ? raw.data : {};
  const status = data.status === "completed" || data.status === "failed"
    ? data.status
    : "pending";
  return {
    status,
    ...(typeof data.assetId === "string" && data.assetId.trim()
      ? { assetId: data.assetId.trim() }
      : {}),
    ...(typeof data.error === "string" && data.error.trim()
      ? { error: data.error.trim() }
      : {}),
  };
}

export async function requestTimelineRenderWithReadback(options: {
  client: TimelineRenderClient;
  timelineId: string;
  actor: { actorUserId: string; actorAgentId?: string };
  wait: boolean;
  timeoutMs: number;
  generateId?: () => string;
  loadAsset?: (assetId: string) => Promise<AssetRecordResult>;
  now?: () => number;
  delay?: () => Promise<void>;
}): Promise<TimelineRenderReceipt> {
  const current = readProjectTimeline(options.client.doc, options.timelineId);
  if (!current) throw new Error(`Timeline ${options.timelineId} not found`);
  const requested = requestTimelineRender(options.client.doc, {
    timelineId: options.timelineId,
    actorUserId: options.actor.actorUserId,
    ...(options.actor.actorAgentId ? { actorAgentId: options.actor.actorAgentId } : {}),
    generateId: options.generateId ?? (() => randomUUID().slice(0, 8)),
  });
  if (!requested.ok) throw new Error(requested.error);
  options.client.doc.commit({ origin: "agent:timeline-render" });
  await options.client.flush();

  const base = {
    submitted: true as const,
    timelineId: options.timelineId,
    sourceTimelineRevisionId: current.revisionId,
    renderNodeId: requested.renderNodeId,
    target: requested.target,
  };
  const loadAsset = options.loadAsset ?? ((assetId: string) => fetchAssetRecord({ assetId }));
  const now = options.now ?? Date.now;
  const delay = options.delay ?? (() => new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, 100);
  }));
  const deadline = now() + options.timeoutMs;

  while (true) {
    const node = renderNodeReadback(options.client, requested.renderNodeId);
    if (node.status === "completed") {
      if (!node.assetId) {
        return {
          ...base,
          completed: false,
          status: "failed",
          error: "Timeline render completed without an immutable Asset id",
        };
      }
      return {
        ...base,
        completed: true,
        status: "completed",
        asset: await loadAsset(node.assetId),
      };
    }
    if (node.status === "failed") {
      return {
        ...base,
        completed: false,
        status: "failed",
        ...(node.error ? { error: node.error } : {}),
      };
    }
    if (!options.wait || now() >= deadline) {
      return { ...base, completed: false, status: "pending" };
    }
    await delay();
  }
}

export type TimelineDaemonTransport = {
  isRunning(projectId: string): boolean;
  send(projectId: string, command: object): Promise<object>;
};

const defaultTimelineDaemonTransport: TimelineDaemonTransport = {
  isRunning: isDaemonRunning,
  send: sendCommand,
};

timelineCommand
  .command("schema")
  .description(TIMELINE_OPERATION_CATALOG.agent["timeline.schema"].description)
  .option("--json", "Output the schema contract as JSON")
  .action((options) => {
    const example = structuredClone(
      TIMELINE_MASK_KEYFRAMES_DSL_EXAMPLE,
    ) as unknown as ResolvedTimelineDsl;
    const payload = {
      ...TIMELINE_DSL_DEFINITION,
      examples: {
        ...TIMELINE_DSL_DEFINITION.examples,
        maskKeyframesYaml: timelineDslToYaml(example),
      },
    };
    if (isJsonMode(options)) printJson(payload);
    else console.log(JSON.stringify(payload, null, 2));
  });

timelineCommand
  .command("validate")
  .description(TIMELINE_OPERATION_CATALOG.agent["timeline.validate"].description)
  .requiredOption("--file <path>", "Timeline YAML or JSON projection to validate")
  .option("--json", "Output the validation result as JSON")
  .action((options) => {
    const filePath = String(options.file);
    const parsed = parseTimelineFileForApply(readFileSync(filePath, "utf8"));
    if (!parsed.ok) throw new Error(`TIMELINE_DSL_INVALID: ${parsed.error}`);
    const result = {
      ok: true,
      contractFingerprint: TIMELINE_DSL_DEFINITION.contractFingerprint,
      sources: parsed.sources,
    };
    if (isJsonMode(options)) printJson(result);
    else console.log(`Timeline DSL is valid (${result.contractFingerprint})`);
  });

function timelinePosition(value: unknown, option: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) throw new Error(`${option} must be a finite number`);
  return parsed;
}

/**
 * Applies an edited Timeline projection under an already-established observation.
 *
 * Extracted so the generic `projection apply` can write a Timeline the same way this command does.
 * The observation is passed in rather than recorded here: the CAS rule is the projection loop's,
 * identical for every kind, and duplicating it per entity is what produced two commands doing one
 * job.
 */
export async function applyTimelineProjection(options: {
  context: ResolvedProjectContext;
  timelineId: string;
  content: string;
  observedVersion: string;
  filePath: string;
}): Promise<{ version: string }> {
  const parsed = parseTimelineFileForApply(options.content);
  if (!parsed.ok) throw new Error(parsed.error);
  let result: TimelineWorkspaceResult;
  if (isDaemonRunning(options.context.projectId)) {
    result = await sendCommand(options.context.projectId, {
      action: "update_timeline_state",
      timelineId: options.timelineId,
      state: parsed.dsl,
      sourceNodeIds: parsed.sources,
      actorClientType: resolveCanvasPresenceOptions().clientType,
      observedVersion: options.observedVersion,
      ifMatch: options.observedVersion,
    }) as TimelineWorkspaceResult;
  } else {
    assertTimelineEntityHostWrite("Timeline apply");
    const client = await connectToProject(options.context.projectId);
    try {
      const updated = client.updateTimelineState(options.timelineId, parsed.dsl);
      result = updated.ok
        ? { timeline: updated.timeline, version: projectTimelineReadToken(updated.timeline) }
        : { error: updated.error };
    } finally {
      await client.disconnect();
    }
  }
  if (result.error) throw new Error(result.error);
  return { version: result.version ?? "" };
}

export async function listTimelineEntities(
  context: ResolvedProjectContext,
  transport: TimelineDaemonTransport = defaultTimelineDaemonTransport,
): Promise<{ timelines: ProjectTimeline[]; versions: Record<string, string> }> {
  if (transport.isRunning(context.projectId)) {
    const result = await transport.send(context.projectId, {
      action: "list_timelines",
    }) as TimelineWorkspaceResult;
    if (result.error) throw new Error(result.error);
    return { timelines: result.timelines ?? [], versions: result.versions ?? {} };
  }
  const client = await connectToProject(context.projectId);
  try {
    const timelines = client.listTimelines();
    return {
      timelines,
      versions: Object.fromEntries(
        timelines.map((timeline) => [timeline.id, projectTimelineReadToken(timeline)]),
      ),
    };
  } finally {
    await client.disconnect();
  }
}

export async function readTimelineEntityForProjection(
  context: ResolvedProjectContext,
  timelineId: string,
): Promise<ProjectTimeline> {
  const result = await listTimelineEntities(context);
  const timeline = result.timelines.find((candidate) => candidate.id === timelineId);
  if (!timeline) throw new Error(`Timeline ${timelineId} not found`);
  await recordTimelineObservation(
    context,
    timeline.id,
    result.versions[timeline.id] ?? projectTimelineReadToken(timeline),
  );
  return timeline;
}

/**
 * Publish a generated, schema-valid Timeline state through the authoritative
 * Project Timeline entity. The daemon path performs its own fresh list read
 * and sends the returned host receipt back as the mutation CAS proof, so a
 * one-shot production command cannot silently overwrite a concurrently edited
 * Timeline.
 */
export async function publishTimelineState(
  context: ResolvedProjectContext,
  timelineId: string,
  state: ResolvedTimelineDsl,
  transport: TimelineDaemonTransport = defaultTimelineDaemonTransport,
): Promise<ProjectTimeline> {
  const listed = await listTimelineEntities(context, transport);
  const current = listed.timelines.find((candidate) => candidate.id === timelineId);
  if (!current) throw new Error(`Timeline ${timelineId} not found`);
  const readProof = listed.versions[timelineId] ?? projectTimelineReadToken(current);
  await recordTimelineObservation(context, timelineId, readProof);

  let result: TimelineWorkspaceResult;
  if (transport.isRunning(context.projectId)) {
    result = await transport.send(context.projectId, {
      action: "update_timeline_state",
      timelineId,
      state,
      actorClientType: resolveCanvasPresenceOptions().clientType,
      ifMatch: readProof,
    }) as TimelineWorkspaceResult;
  } else {
    assertTimelineEntityHostWrite("Timeline production publish");
    const client = await connectToProject(context.projectId);
    try {
      const updated = client.updateTimelineState(timelineId, state);
      result = updated.ok
        ? { timeline: updated.timeline, version: projectTimelineReadToken(updated.timeline) }
        : { error: updated.error };
    } finally {
      await client.disconnect();
    }
  }
  if (result.error || !result.timeline) {
    throw new Error(result.error ?? "Timeline production publish failed");
  }
  await recordTimelineObservation(
    context,
    timelineId,
    result.readToken ?? result.version ?? projectTimelineReadToken(result.timeline),
  );
  return result.timeline;
}

async function recordTimelineVersions(
  context: ResolvedProjectContext,
  versions: Record<string, string>,
): Promise<void> {
  for (const [timelineId, revision] of Object.entries(versions)) {
    await recordTimelineObservation(context, timelineId, revision);
  }
}

async function recoverStaleTimelineApply(options: {
  context: ResolvedProjectContext;
  timelineId: string;
  editedProjectionPath: string;
  transport?: TimelineDaemonTransport;
}): Promise<never> {
  const listed = await listTimelineEntities(
    options.context,
    options.transport ?? defaultTimelineDaemonTransport,
  );
  const latest = listed.timelines.find((candidate) => candidate.id === options.timelineId);
  if (!latest) throw new Error(`Timeline ${options.timelineId} not found after the stale write was rejected`);
  const currentObservation = listed.versions[latest.id] ?? projectTimelineReadToken(latest);
  const recovery = await recoverStaleProjection({
    workspaceRoot: options.context.workspaceRoot ?? process.cwd(),
    projectId: options.context.projectId,
    entityKind: "timeline",
    entityId: latest.id,
    currentRevisionId: latest.revisionId,
    currentObservation,
    editedProjectionPath: options.editedProjectionPath,
    latestContent: timelineDslToYaml(normalizeTimelineDslForYaml(latest.state)),
  });
  throw staleProjectionRecoveryError("Timeline", recovery);
}

export async function prepareTimelineApplyObservation(options: {
  context: ResolvedProjectContext;
  timelineId: string;
  editedProjectionPath: string;
  baseRevisionId?: string;
  transport?: TimelineDaemonTransport;
}): Promise<string | undefined> {
  const baseRevisionId = options.baseRevisionId?.trim() ?? "";
  if (!baseRevisionId) {
    return requireTimelineObservation(options.context, options.timelineId);
  }
  const transport = options.transport ?? defaultTimelineDaemonTransport;
  const listed = await listTimelineEntities(options.context, transport);
  const latest = listed.timelines.find((candidate) => candidate.id === options.timelineId);
  if (!latest) throw new Error(`Timeline ${options.timelineId} not found`);
  if (latest.revisionId !== baseRevisionId) {
    await recoverStaleTimelineApply({
      context: options.context,
      timelineId: options.timelineId,
      editedProjectionPath: options.editedProjectionPath,
      transport,
    });
  }
  const observedVersion = listed.versions[latest.id] ?? projectTimelineReadToken(latest);
  await recordTimelineObservation(options.context, latest.id, observedVersion);
  return observedVersion;
}

function assertTimelineEntityHostWrite(operation: string): void {
  const hostWrite = assertAgentHostWritePath({
    actorClientType: resolveCanvasPresenceOptions().clientType,
    operation,
    readCommand: "clash timeline list --json",
  });
  if (!hostWrite.ok) throw new Error(hostWrite.error);
}

timelineCommand
  .command("list")
  .description(TIMELINE_OPERATION_CATALOG.agent["timeline.list"].description)
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--standalone", "Show only standalone Project Timelines")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const result = await listTimelineEntities(context);
    await recordTimelineVersions(context, result.versions);
    const timelines = options.standalone
      ? result.timelines.filter((timeline) => timeline.owner.kind === "project")
      : result.timelines;
    if (isJsonMode(options)) {
      printJson(timelines);
      return;
    }
    printTable(timelines.map((timeline) => ({
      id: timeline.id,
      name: timeline.name,
      owner: timeline.owner.kind === "project"
        ? "Project"
        : `Canvas ${timeline.owner.canvasId}`,
      node: timeline.owner.kind === "canvas-action" ? timeline.owner.actionNodeId : "",
    })), [
      { key: "id", label: "Timeline", width: 24 },
      { key: "name", label: "Name", width: 28 },
      { key: "owner", label: "Owner", width: 24 },
      { key: "node", label: "Action Node", width: 24 },
    ]);
  });

timelineCommand
  .command("create")
  .description(TIMELINE_OPERATION_CATALOG.agent["timeline.create"].description)
  .requiredOption("--id <id>", "Project-scoped Timeline ID")
  .requiredOption("--name <name>", "Timeline name")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    let result: TimelineWorkspaceResult;
    if (isDaemonRunning(context.projectId)) {
      result = await sendCommand(context.projectId, {
        action: "create_timeline",
        timelineId: options.id,
        name: options.name,
        state: { tracks: [] },
      }) as TimelineWorkspaceResult;
    } else {
      const client = await connectToProject(context.projectId);
      try {
        const created = client.createTimeline({
          id: options.id,
          name: options.name,
          state: { tracks: [] },
        });
        result = created.ok
          ? { timeline: created.timeline, version: projectTimelineReadToken(created.timeline) }
          : { error: created.error };
      } finally {
        await client.disconnect();
      }
    }
    if (result.error || !result.timeline) throw new Error(result.error ?? "Timeline create failed");
    await recordTimelineObservation(
      context,
      result.timeline.id,
      result.readToken ?? result.version ?? projectTimelineReadToken(result.timeline),
    );
    if (isJsonMode(options)) printJson(result.timeline);
    else console.log(`Created Timeline: ${result.timeline.id}`);
  });

timelineCommand
  .command("attach")
  .description(TIMELINE_OPERATION_CATALOG.agent["timeline.attach"].description)
  .requiredOption("--timeline <id>", "Standalone Timeline ID")
  .requiredOption("--canvas <id>", "Owning Canvas ID")
  .option("--node <id>", "Timeline Action node ID (defaults to a generated ID)")
  .option("--x <number>", "Canvas X position", "0")
  .option("--y <number>", "Canvas Y position", "0")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const timelineId = String(options.timeline);
    const observedVersion = await requireTimelineObservation(context, timelineId);
    const actionNodeId = options.node?.trim() || randomUUID().slice(0, 8);
    let result: TimelineWorkspaceResult;
    if (isDaemonRunning(context.projectId)) {
      result = await sendCommand(context.projectId, {
        action: "attach_timeline",
        timelineId,
        canvasId: options.canvas,
        actionNodeId,
        position: {
          x: timelinePosition(options.x, "--x"),
          y: timelinePosition(options.y, "--y"),
        },
        actorClientType: resolveCanvasPresenceOptions().clientType,
        observedVersion,
        ifMatch: observedVersion,
      }) as TimelineWorkspaceResult;
    } else {
      assertTimelineEntityHostWrite("Timeline attach");
      const client = await connectToProject(context.projectId);
      try {
        const attached = client.attachTimeline({
          timelineId,
          canvasId: options.canvas,
          actionNodeId,
          position: {
            x: timelinePosition(options.x, "--x"),
            y: timelinePosition(options.y, "--y"),
          },
        });
        result = attached.ok
          ? { timeline: attached.timeline, version: projectTimelineReadToken(attached.timeline) }
          : { error: attached.error };
      } finally {
        await client.disconnect();
      }
    }
    if (result.error || !result.timeline) throw new Error(result.error ?? "Timeline attach failed");
    await recordTimelineObservation(
      context,
      timelineId,
      result.readToken ?? result.version ?? projectTimelineReadToken(result.timeline),
    );
    if (isJsonMode(options)) printJson(result.timeline);
    else console.log(`Attached Timeline ${timelineId} to Canvas ${options.canvas} as ${actionNodeId}`);
  });

timelineCommand
  .command("detach")
  .description(TIMELINE_OPERATION_CATALOG.agent["timeline.detach"].description)
  .requiredOption("--timeline <id>", "Canvas-owned Timeline ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const timelineId = String(options.timeline);
    const observedVersion = await requireTimelineObservation(context, timelineId);
    let result: TimelineWorkspaceResult;
    if (isDaemonRunning(context.projectId)) {
      result = await sendCommand(context.projectId, {
        action: "detach_timeline",
        timelineId,
        actorClientType: resolveCanvasPresenceOptions().clientType,
        observedVersion,
        ifMatch: observedVersion,
      }) as TimelineWorkspaceResult;
    } else {
      assertTimelineEntityHostWrite("Timeline detach");
      const client = await connectToProject(context.projectId);
      try {
        const detached = client.detachTimeline(timelineId);
        result = detached.ok
          ? { timeline: detached.timeline, version: projectTimelineReadToken(detached.timeline) }
          : { error: detached.error };
      } finally {
        await client.disconnect();
      }
    }
    if (result.error || !result.timeline) throw new Error(result.error ?? "Timeline detach failed");
    await recordTimelineObservation(
      context,
      timelineId,
      result.readToken ?? result.version ?? projectTimelineReadToken(result.timeline),
    );
    if (isJsonMode(options)) printJson(result.timeline);
    else console.log(`Detached Timeline: ${timelineId}`);
  });

timelineCommand
  .command("copy")
  .description(TIMELINE_OPERATION_CATALOG.agent["timeline.copy"].description)
  .requiredOption("--timeline <id>", "Source Timeline ID")
  .requiredOption("--canvas <id>", "Target Canvas ID")
  .option("--new-timeline <id>", "New Timeline ID (defaults to a generated ID)")
  .option("--new-node <id>", "New Timeline Action node ID (defaults to a generated ID)")
  .option("--x <number>", "Target Canvas X position", "0")
  .option("--y <number>", "Target Canvas Y position", "0")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const timelineId = String(options.timeline);
    const observedVersion = await requireTimelineObservation(context, timelineId);
    const newTimelineId = options.newTimeline?.trim() || randomUUID().slice(0, 8);
    const newActionNodeId = options.newNode?.trim() || randomUUID().slice(0, 8);
    let result: TimelineWorkspaceResult;
    if (isDaemonRunning(context.projectId)) {
      result = await sendCommand(context.projectId, {
        action: "copy_timeline_action",
        sourceTimelineId: timelineId,
        targetCanvasId: options.canvas,
        newTimelineId,
        newActionNodeId,
        position: {
          x: timelinePosition(options.x, "--x"),
          y: timelinePosition(options.y, "--y"),
        },
        actorClientType: resolveCanvasPresenceOptions().clientType,
        observedVersion,
        ifMatch: observedVersion,
      }) as TimelineWorkspaceResult;
    } else {
      assertTimelineEntityHostWrite("Timeline Action copy");
      const client = await connectToProject(context.projectId);
      try {
        const copied = client.copyTimelineAction({
          sourceTimelineId: timelineId,
          targetCanvasId: options.canvas,
          newTimelineId,
          newActionNodeId,
          position: {
            x: timelinePosition(options.x, "--x"),
            y: timelinePosition(options.y, "--y"),
          },
        });
        result = copied.ok
          ? {
              timeline: copied.timeline,
              version: projectTimelineReadToken(copied.timeline),
            }
          : { error: copied.error };
      } finally {
        await client.disconnect();
      }
    }
    if (result.error || !result.timeline) throw new Error(result.error ?? "Timeline copy failed");
    await recordTimelineObservation(
      context,
      newTimelineId,
      result.readToken ?? result.version ?? projectTimelineReadToken(result.timeline),
    );
    if (isJsonMode(options)) printJson(result.timeline);
    else console.log(`Copied Timeline ${timelineId} to ${newTimelineId} on Canvas ${options.canvas}`);
  });

timelineCommand
  .command("render")
  .description(TIMELINE_OPERATION_CATALOG.agent["timeline.render"].description)
  .requiredOption("--timeline <id>", "Timeline ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--no-wait", "Return the durable render-node receipt without waiting for completion")
  .option("--timeout-ms <milliseconds>", "Maximum completion wait in milliseconds", "600000")
  .option("--json", "Output the render receipt as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const timelineId = String(options.timeline);
    const timeoutMs = Number(options.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 900_000) {
      throw new Error("--timeout-ms must be an integer between 1000 and 900000");
    }
    const [actor, client] = await Promise.all([
      resolveCanvasActor(),
      connectToProject(context.projectId),
    ]);
    try {
      const receipt = await requestTimelineRenderWithReadback({
        client,
        timelineId,
        actor: {
          actorUserId: actor.actorUserId,
          ...(actor.actorAgentId ? { actorAgentId: actor.actorAgentId } : {}),
        },
        wait: options.wait !== false,
        timeoutMs,
      });
      await recordTimelineObservation(
        context,
        timelineId,
        receipt.sourceTimelineRevisionId,
      );
      if (isJsonMode(options)) printJson(receipt);
      else console.log(
        receipt.completed
          ? `Rendered Timeline ${timelineId}: ${receipt.asset?.id ?? receipt.renderNodeId}`
          : `Timeline render ${receipt.renderNodeId}: ${receipt.status}`,
      );
    } finally {
      await client.disconnect();
    }
  });

timelineCommand
  .command("pull")
  .description(TIMELINE_OPERATION_CATALOG.agent["timeline.pull"].description)
  .requiredOption("--timeline <id>", "Timeline ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--file <path>", "Timeline YAML path (default: timelines/<timeline-id>.timeline.yaml)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const filePath = resolveTimelineFilePath({
      cwd: process.cwd(),
      file: options.file,
      timeline: options.timeline,
    });
    const listed = await listTimelineEntities(context);
    const timeline = listed.timelines.find((candidate) => candidate.id === options.timeline);
    if (!timeline) throw new Error(`Timeline ${options.timeline} not found`);
    const currentDsl = normalizeTimelineDslForYaml(timeline.state);
    const yaml = timelineDslToYaml(currentDsl);
    const version = listed.versions[timeline.id] ?? projectTimelineReadToken(timeline);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, yaml, "utf8");
    const transcriptProjection = await writeTimelineTranscriptProjection({
      cwd: process.cwd(),
      timelineFilePath: filePath,
      timelineId: timeline.id,
      timelineRevision: timeline.revisionId,
      state: timeline.state,
    });
    await recordTimelineObservation(context, timeline.id, version);

    const payload = {
      pulled: true,
      projectId: context.projectId,
      timelineId: timeline.id,
      revisionId: timeline.revisionId,
      owner: timeline.owner,
      filePath,
      timelineHash: timelineHash(currentDsl),
      ...(transcriptProjection ? {
        transcriptFilePath: transcriptProjection.filePath,
        transcriptWordCount: transcriptProjection.wordCount,
        transcriptSourceCount: transcriptProjection.sourceCount,
      } : {}),
    };
    if (isJsonMode(options)) printJson(payload);
    else {
      process.stderr.write(`wrote ${filePath}\n`);
      if (transcriptProjection) {
        process.stderr.write(`wrote ${transcriptProjection.filePath}\n`);
      }
    }
  });

timelineCommand
  .command("apply")
  .description(TIMELINE_OPERATION_CATALOG.agent["timeline.apply"].description)
  .requiredOption("--timeline <id>", "Timeline ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--file <path>", "Timeline YAML path (default: timelines/<timeline-id>.timeline.yaml)")
  .option("--base-revision <revision>", "Revision the edited projection was based on")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const filePath = resolveTimelineFilePath({
      cwd: process.cwd(),
      file: options.file,
      timeline: options.timeline,
    });
    const content = readFileSync(filePath, "utf8");
    const parsed = parseTimelineFileForApply(content);
    if (!parsed.ok) {
      console.error(`error: ${parsed.error}`);
      process.exit(1);
    }

    const timelineId = String(options.timeline);
    const baseRevisionId = typeof options.baseRevision === "string"
      ? options.baseRevision.trim()
      : "";
    const observedVersion = await prepareTimelineApplyObservation({
      context,
      timelineId,
      editedProjectionPath: filePath,
      ...(baseRevisionId ? { baseRevisionId } : {}),
    });
    let result: TimelineWorkspaceResult;
    if (isDaemonRunning(context.projectId)) {
      result = await sendCommand(context.projectId, {
        action: "update_timeline_state",
        timelineId,
        state: parsed.dsl,
        sourceNodeIds: parsed.sources,
        actorClientType: resolveCanvasPresenceOptions().clientType,
        observedVersion,
        ifMatch: observedVersion,
      }) as TimelineWorkspaceResult;
    } else {
      assertTimelineEntityHostWrite("Timeline apply");
      const client = await connectToProject(context.projectId);
      try {
        const updated = client.updateTimelineState(timelineId, parsed.dsl);
        result = updated.ok
          ? { timeline: updated.timeline, version: projectTimelineReadToken(updated.timeline) }
          : { error: updated.error };
      } finally {
        await client.disconnect();
      }
    }
    if (result.error || !result.timeline) {
      if (result.code === "STALE_READ") {
        await recoverStaleTimelineApply({
          context,
          timelineId,
          editedProjectionPath: filePath,
        });
      }
      throw new Error(result.error ?? "Timeline apply failed");
    }
    await recordTimelineObservation(
      context,
      timelineId,
      result.readToken ?? result.version ?? projectTimelineReadToken(result.timeline),
    );

    const payload = {
      applied: true,
      projectId: context.projectId,
      timelineId,
      revisionId: result.timeline.revisionId,
      owner: result.timeline.owner,
      filePath,
      sources: parsed.sources,
      timelineHash: timelineHash(normalizeTimelineDslForYaml(parsed.dsl)),
    };
    if (isJsonMode(options)) printJson(payload);
    else process.stderr.write(`applied ${filePath} to Timeline ${timelineId}\n`);
  });

type TimelineCliOperationExecutor = Readonly<{
  binding: `cli:timeline ${string}`;
  command: Command;
}>;

function registeredTimelineCommand(commandName: string): Command {
  const command = timelineCommand.commands.find(
    (candidate) => candidate.name() === commandName,
  );
  if (!command) {
    throw new Error(`Timeline CLI executor is not registered: ${commandName}`);
  }
  return command;
}

/**
 * Transport adapter from the canonical Timeline operation id to the concrete
 * Commander command which owns its action handler.
 *
 * Keep this literal explicit: the contract test compares its keys and bindings
 * against every `cli:timeline` binding in TIMELINE_OPERATION_REGISTRY, so a new
 * public CLI annotation cannot silently ship without a real executor.
 */
export const TIMELINE_CLI_OPERATION_EXECUTORS = Object.freeze({
  "timeline.schema": {
    binding: "cli:timeline schema",
    command: registeredTimelineCommand("schema"),
  },
  "timeline.validate": {
    binding: "cli:timeline validate",
    command: registeredTimelineCommand("validate"),
  },
  "timeline.list": {
    binding: "cli:timeline list",
    command: registeredTimelineCommand("list"),
  },
  "timeline.create": {
    binding: "cli:timeline create",
    command: registeredTimelineCommand("create"),
  },
  "timeline.attach": {
    binding: "cli:timeline attach",
    command: registeredTimelineCommand("attach"),
  },
  "timeline.detach": {
    binding: "cli:timeline detach",
    command: registeredTimelineCommand("detach"),
  },
  "timeline.copy": {
    binding: "cli:timeline copy",
    command: registeredTimelineCommand("copy"),
  },
  "timeline.render": {
    binding: "cli:timeline render",
    command: registeredTimelineCommand("render"),
  },
  "timeline.pull": {
    binding: "cli:timeline pull",
    command: registeredTimelineCommand("pull"),
  },
  "timeline.apply": {
    binding: "cli:timeline apply",
    command: registeredTimelineCommand("apply"),
  },
} satisfies Partial<Record<TimelineAgentOperationId, TimelineCliOperationExecutor>>);

async function connectToProject(projectId: string): Promise<LoroSyncClient> {
  const apiKey = requireApiKey();
  const serverUrl = getServerUrl();
  const wsUrl = serverUrl.replace(/^http/, "ws");
  const client = new LoroSyncClient({
    serverUrl: wsUrl,
    projectId,
    token: apiKey,
    ...resolveCanvasPresenceOptions(),
    WebSocket: WebSocket as any,
  });
  await client.connect();
  return client;
}

async function runCommand(projectId: string, cmd: object): Promise<any> {
  if (!isDaemonRunning(projectId)) return null;
  return sendCommand(projectId, cmd);
}
