import { Command } from "commander";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  LoroSyncClient,
  projectTimelineReadToken,
  timelineDslToYaml,
  type ProjectTimeline,
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
  resolveCanvasProjectContext,
} from "./canvas";
import {
  normalizeTimelineDslForYaml,
  parseTimelineFileForApply,
  resolveTimelineFilePath,
  timelineHash,
} from "../lib/timeline-projection";
import { writeTimelineTranscriptProjection } from "../lib/timeline-transcript-projection";

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

function timelinePosition(value: unknown, option: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) throw new Error(`${option} must be a finite number`);
  return parsed;
}

async function listTimelineEntities(
  context: ResolvedProjectContext,
): Promise<{ timelines: ProjectTimeline[]; versions: Record<string, string> }> {
  if (isDaemonRunning(context.projectId)) {
    const result = await sendCommand(context.projectId, {
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

async function recordTimelineVersions(
  context: ResolvedProjectContext,
  versions: Record<string, string>,
): Promise<void> {
  for (const [timelineId, revision] of Object.entries(versions)) {
    await recordTimelineObservation(context, timelineId, revision);
  }
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
  .description("List Project Timelines and their current owners")
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
  .description("Create a standalone Project Timeline")
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
  .description("Move a standalone Timeline into one Canvas as a Timeline Action")
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
  .description("Move a Canvas-owned Timeline back to the Project root")
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
  .description("Copy a Canvas-owned Timeline Action into another Canvas")
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
  .command("pull")
  .description("Export a Project Timeline's current revision to a YAML file")
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
    const transcriptProjection = writeTimelineTranscriptProjection({
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
  .description("Validate a timeline YAML file and advance the Project Timeline revision")
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
    const content = readFileSync(filePath, "utf8");
    const parsed = parseTimelineFileForApply(content);
    if (!parsed.ok) {
      console.error(`error: ${parsed.error}`);
      process.exit(1);
    }

    const timelineId = String(options.timeline);
    const observedVersion = await requireTimelineObservation(context, timelineId);
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
    if (result.error || !result.timeline) throw new Error(result.error ?? "Timeline apply failed");
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
