import { Command } from "commander";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LoroSyncClient, type ResolvedTimelineDsl } from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { isJsonMode, printJson } from "../lib/output";
import { isDaemonRunning, sendCommand } from "../lib/daemon";
import { assertAgentHostWritePath } from "../lib/agent-host-write";
import { resolveCanvasActor, resolveCanvasPresenceOptions, resolveCanvasProjectId } from "./canvas";
import {
  assertTimelineCas,
  assertTimelineLockFilePath,
  assertTimelineNotMaterializedReferenced,
  createTimelineAppliedRevision,
  createTimelineCowNodeData,
  createTimelineLock,
  createTimelineSourceProvenance,
  normalizeTimelineDslForYaml,
  parseTimelineFileForApply,
  parseTimelineLock,
  readLoroRevisionMetadata,
  resolveTimelineFilePath,
  resolveTimelineLockPath,
  timelineHash,
  timelineReadToken,
  timelineYamlFromNode,
  type TimelineAppliedRevision,
  type TimelineLock,
  type TimelineNodeLike,
  type TimelineRevisionActor,
} from "../lib/timeline-projection";

export {
  assertTimelineCas,
  assertTimelineLockFilePath,
  assertTimelineNotMaterializedReferenced,
  createTimelineAppliedRevision,
  createTimelineLock,
  createTimelineSourceProvenance,
  parseTimelineFileForApply,
  parseTimelineLock,
  readLoroRevisionMetadata,
  resolveTimelineFilePath,
  resolveTimelineLockPath,
  timelineHash,
  timelineReadToken,
  timelineYamlFromNode,
};

type ApplyTimelineDslResult = {
  updated: true;
  nodeId: string;
  edgesAdded: number;
  timelineRevision?: TimelineAppliedRevision;
  readToken?: string;
  forced?: true;
};

type ReplaceTimelineDslResult = {
  replaced: true;
  copyOnWrite: true;
  sourceNodeId: string;
  newNodeId: string;
  edgesAdded: number;
  sourceTimelineHash?: string;
  timelineHash?: string;
  timelineRevision?: TimelineAppliedRevision;
  lineageEdge?: unknown;
  readToken?: string;
  forced?: true;
};

export const timelineCommand = new Command("timeline")
  .description(
    `Agent-editable timeline files.

Default file path:
  timelines/main.timeline.yaml

Workflow:
  clash timeline pull --project <id> --node <video-editor-node-id>
  # edit timelines/main.timeline.yaml with normal file tools
  clash timeline apply --project <id> --node <video-editor-node-id>

CAS:
  pull also writes timelines/main.timeline.lock.json. apply refuses to write
  if the canvas timeline changed after pull unless --force is passed.`,
  );

timelineCommand
  .command("pull")
  .description("Export a canvas video-editor node's timelineDsl to a YAML file")
  .requiredOption("--node <id>", "VideoEditorNode ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--timeline <name>", "Timeline name for the default timelines/<name>.timeline.yaml path", "main")
  .option("--file <path>", "Timeline YAML path (default: timelines/<name>.timeline.yaml)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    const filePath = resolveTimelineFilePath({
      cwd: process.cwd(),
      file: options.file,
      timeline: options.timeline,
    });
    const node = await readNode(projectId, options.node);
    if (!node) {
      console.error(`Node not found: ${options.node}`);
      process.exit(1);
    }
    if (node.type !== "video-editor") {
      process.stderr.write(
        `warning: node ${options.node} has type "${node.type}", expected "video-editor". Proceeding.\n`,
      );
    }

    const yaml = timelineYamlFromNode(node);
    const currentDsl = normalizeTimelineDslForYaml(node.data?.timelineDsl);
    const lockPath = resolveTimelineLockPath({
      cwd: process.cwd(),
      file: options.file,
      timeline: options.timeline,
    });
    const lock = createTimelineLock({
      projectId,
      nodeId: options.node,
      filePath,
      dsl: currentDsl,
      readToken: node.readToken,
    });
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, yaml, "utf8");
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");

    const payload = { pulled: true, projectId, nodeId: options.node, filePath, lockPath, timelineHash: lock.timelineHash, readToken: lock.readToken };
    if (isJsonMode(options)) printJson(payload);
    else process.stderr.write(`wrote ${filePath}\nwrote ${lockPath}\n`);
  });

timelineCommand
  .command("apply")
  .description("Validate a timeline YAML file and apply it back to the canvas node")
  .requiredOption("--node <id>", "VideoEditorNode ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--timeline <name>", "Timeline name for the default timelines/<name>.timeline.yaml path", "main")
  .option("--file <path>", "Timeline YAML path (default: timelines/<name>.timeline.yaml)")
  .option("--lock <path>", "CAS lock path (default: timeline YAML sidecar)")
  .option("--force", "Bypass CAS and intentionally overwrite the current canvas timeline")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    const filePath = resolveTimelineFilePath({
      cwd: process.cwd(),
      file: options.file,
      timeline: options.timeline,
    });
    const parsed = parseTimelineFileForApply(readFileSync(filePath, "utf8"));
    if (!parsed.ok) {
      console.error(`error: ${parsed.error}`);
      process.exit(1);
    }

    const lockPath = options.lock ?? resolveTimelineLockPath({
      cwd: process.cwd(),
      file: options.file,
      timeline: options.timeline,
    });
    let result: ApplyTimelineDslResult;
    let lock: TimelineLock | null = null;
    const actor = await resolveCanvasActor();
    try {
      lock = options.force ? null : readTimelineLockFile(lockPath);
      result = await applyTimelineDsl(projectId, options.node, parsed.dsl, parsed.sources, {
        force: options.force === true,
        lock,
        cwd: process.cwd(),
        filePath,
        actor,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    const timelineRevision = result.timelineRevision ?? createTimelineAppliedRevision({
      projectId,
      nodeId: options.node,
      cwd: process.cwd(),
      filePath,
      dsl: parsed.dsl,
      parentRevisionId: lock?.appliedRevision?.revisionId,
      actor,
    });
    const refreshedLock = createTimelineLock({
      projectId,
      nodeId: options.node,
      filePath,
      dsl: parsed.dsl,
      appliedRevision: timelineRevision,
      readToken: result.readToken,
    });
    writeFileSync(lockPath, JSON.stringify(refreshedLock, null, 2) + "\n", "utf8");

    const payload = { ...result, timelineRevision, projectId, filePath, lockPath, sources: parsed.sources, readToken: refreshedLock.readToken };
    if (isJsonMode(options)) printJson(payload);
    else {
      process.stderr.write(
        `applied ${filePath} to ${options.node} (${parsed.sources.length} source${parsed.sources.length === 1 ? "" : "s"}, +${result.edgesAdded} edge${result.edgesAdded === 1 ? "" : "s"})${result.forced ? " (forced)" : ""}\n`,
      );
    }
  });

timelineCommand
  .command("replace")
  .description("Create a copy-on-write replacement video-editor node from a timeline YAML file")
  .requiredOption("--node <id>", "Source VideoEditorNode ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--timeline <name>", "Timeline name for the default timelines/<name>.timeline.yaml path", "main")
  .option("--file <path>", "Timeline YAML path (default: timelines/<name>.timeline.yaml)")
  .option("--lock <path>", "CAS lock path (default: timeline YAML sidecar)")
  .option("--label <label>", "Label for the replacement timeline node")
  .option("--new-node <id>", "Replacement node ID (defaults to a generated id)")
  .option("--force", "Bypass CAS and intentionally fork from the current canvas timeline")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    const filePath = resolveTimelineFilePath({
      cwd: process.cwd(),
      file: options.file,
      timeline: options.timeline,
    });
    const parsed = parseTimelineFileForApply(readFileSync(filePath, "utf8"));
    if (!parsed.ok) {
      console.error(`error: ${parsed.error}`);
      process.exit(1);
    }

    const lockPath = options.lock ?? resolveTimelineLockPath({
      cwd: process.cwd(),
      file: options.file,
      timeline: options.timeline,
    });
    let result: ReplaceTimelineDslResult;
    let lock: TimelineLock | null = null;
    const actor = await resolveCanvasActor();
    try {
      lock = options.force ? null : readTimelineLockFile(lockPath);
      result = await replaceTimelineDsl(projectId, options.node, parsed.dsl, parsed.sources, {
        force: options.force === true,
        lock,
        cwd: process.cwd(),
        filePath,
        actor,
        label: options.label,
        newNodeId: options.newNode,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    const timelineRevision = result.timelineRevision ?? createTimelineAppliedRevision({
      projectId,
      nodeId: result.newNodeId,
      cwd: process.cwd(),
      filePath,
      dsl: parsed.dsl,
      parentRevisionId: lock?.appliedRevision?.revisionId,
      actor,
    });
    const refreshedLock = createTimelineLock({
      projectId,
      nodeId: result.newNodeId,
      filePath,
      dsl: parsed.dsl,
      appliedRevision: timelineRevision,
      readToken: result.readToken,
    });
    writeFileSync(lockPath, JSON.stringify(refreshedLock, null, 2) + "\n", "utf8");

    const payload = { ...result, timelineRevision, projectId, filePath, lockPath, sources: parsed.sources, readToken: refreshedLock.readToken };
    if (isJsonMode(options)) printJson(payload);
    else {
      process.stderr.write(
        `created copy-on-write timeline ${result.newNodeId} from ${options.node} (${parsed.sources.length} source${parsed.sources.length === 1 ? "" : "s"}, +${result.edgesAdded} edge${result.edgesAdded === 1 ? "" : "s"})${result.forced ? " (forced)" : ""}\n` +
        `wrote ${lockPath}\n`,
      );
    }
  });

function readTimelineLockFile(lockPath: string): TimelineLock {
  try {
    return parseTimelineLock(readFileSync(lockPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read timeline CAS lock at ${lockPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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

type TimelineNodeReadResult = TimelineNodeLike & {
  readToken?: string;
};

async function readNode(projectId: string, nodeId: string): Promise<TimelineNodeReadResult | null> {
  const daemonResult = await runCommand(projectId, {
    action: "get",
    projectId,
    nodeId,
    actorClientType: resolveCanvasPresenceOptions().clientType,
  });
  if (daemonResult) {
    if (daemonResult.error) return null;
    return daemonResult.node
      ? { ...daemonResult.node, readToken: daemonResult.timelineReadToken }
      : null;
  }
  const client = await connectToProject(projectId);
  try {
    const node = client.readNode(nodeId);
    return node ? { type: node.type, data: node.data as Record<string, unknown> } : null;
  } finally {
    await client.disconnect();
  }
}

async function applyTimelineDsl(
  projectId: string,
  nodeId: string,
  dsl: ResolvedTimelineDsl,
  sources: string[],
  cas: { lock: TimelineLock | null; force: boolean; cwd: string; filePath: string; actor?: TimelineRevisionActor },
): Promise<ApplyTimelineDslResult> {
  const filePathCas = assertTimelineLockFilePath({
    lock: cas.lock,
    filePath: cas.filePath,
    cwd: cas.cwd,
    force: cas.force,
  });
  if (!filePathCas.ok) throw new Error(filePathCas.error);

  const daemonResult = await runCommand(projectId, {
    action: "timeline_cas_update",
    projectId,
    nodeId,
    dsl,
    expectedTimelineHash: cas.lock?.timelineHash,
    expectedReadToken: cas.lock?.readToken,
    expectedTimelineFilePath: cas.lock?.filePath,
    parentRevisionId: cas.lock?.appliedRevision?.revisionId,
    cwd: cas.cwd,
    filePath: cas.filePath,
    actor: cas.actor,
    actorClientType: resolveCanvasPresenceOptions().clientType,
    force: cas.force,
  });
  if (daemonResult) {
    if (daemonResult.error) {
      throw new Error(daemonResult.error);
    }
    let edgesAdded = 0;
    for (const source of sources) {
      const edge = await runCommand(projectId, { action: "ensure_edge", source, target: nodeId });
      if (edge && !edge.error && edge.existed === false) edgesAdded++;
    }
    return {
      updated: true,
      nodeId,
      edgesAdded,
      timelineRevision: daemonResult.timelineRevision,
      readToken: daemonResult.readToken,
      ...(cas.force || daemonResult.forced === true ? { forced: true } : {}),
    };
  }
  const hostWrite = assertAgentHostWritePath({
    actorClientType: resolveCanvasPresenceOptions().clientType,
    force: cas.force,
    operation: "timeline apply",
    readCommand: "clash timeline pull --json",
  });
  if (!hostWrite.ok) throw new Error(hostWrite.error);

  const client = await connectToProject(projectId);
  try {
    const current = client.readNode(nodeId);
    if (!current) throw new Error(`Node not found: ${nodeId}`);
    const casResult = assertTimelineCas({
      projectId,
      nodeId,
      lock: cas.lock,
      currentDsl: normalizeTimelineDslForYaml(current.data?.timelineDsl),
      force: cas.force,
      filePath: cas.filePath,
      cwd: cas.cwd,
    });
    if (!casResult.ok) throw new Error(casResult.error);
    const referenceResult = assertTimelineNotMaterializedReferenced({
      nodeId,
      nodes: client.listNodes(),
      edges: client.canvas.listEdges(),
      force: cas.force,
    });
    if (!referenceResult.ok) throw new Error(referenceResult.error);
    const ok = client.updateNode(nodeId, { timelineDsl: dsl });
    if (!ok) throw new Error(`Node not found: ${nodeId}`);
    let edgesAdded = 0;
    const existing = client.canvas.listEdges();
    for (const source of sources) {
      if (existing.some((edge) => edge.source === source && edge.target === nodeId)) continue;
      client.canvas.insertEdge(`e-${source}-${nodeId}-${crypto.randomUUID().slice(0, 4)}`, source, nodeId, "default");
      edgesAdded++;
    }
    const revisionMetadata = readLoroRevisionMetadata(client.doc);
    const timelineRevision = createTimelineAppliedRevision({
      projectId,
      nodeId,
      cwd: cas.cwd,
      filePath: cas.filePath,
      dsl,
      parentRevisionId: cas.lock?.appliedRevision?.revisionId,
      actor: cas.actor,
      ...revisionMetadata,
    });
    return {
      updated: true,
      nodeId,
      edgesAdded,
      timelineRevision,
      readToken: timelineReadToken({ projectId, nodeId, dsl }),
      ...(cas.force ? { forced: true } : {}),
    };
  } finally {
    await client.disconnect();
  }
}

async function replaceTimelineDsl(
  projectId: string,
  nodeId: string,
  dsl: ResolvedTimelineDsl,
  sources: string[],
  cas: {
    lock: TimelineLock | null;
    force: boolean;
    cwd: string;
    filePath: string;
    actor?: TimelineRevisionActor;
    label?: string;
    newNodeId?: string;
  },
): Promise<ReplaceTimelineDslResult> {
  const filePathCas = assertTimelineLockFilePath({
    lock: cas.lock,
    filePath: cas.filePath,
    cwd: cas.cwd,
    force: cas.force,
  });
  if (!filePathCas.ok) throw new Error(filePathCas.error);

  const daemonResult = await runCommand(projectId, {
    action: "timeline_cow_replace",
    projectId,
    nodeId,
    dsl,
    expectedTimelineHash: cas.lock?.timelineHash,
    expectedReadToken: cas.lock?.readToken,
    expectedTimelineFilePath: cas.lock?.filePath,
    parentRevisionId: cas.lock?.appliedRevision?.revisionId,
    cwd: cas.cwd,
    filePath: cas.filePath,
    actor: cas.actor,
    label: cas.label,
    newNodeId: cas.newNodeId,
    actorClientType: resolveCanvasPresenceOptions().clientType,
    force: cas.force,
  });
  if (daemonResult) {
    if (daemonResult.error) throw new Error(daemonResult.error);
    const newNodeId = daemonResult.newNodeId ?? daemonResult.nodeId;
    let edgesAdded = 0;
    for (const source of sources) {
      const edge = await runCommand(projectId, { action: "ensure_edge", source, target: newNodeId });
      if (edge && !edge.error && edge.existed === false) edgesAdded++;
    }
    return {
      replaced: true,
      copyOnWrite: true,
      sourceNodeId: daemonResult.sourceNodeId ?? nodeId,
      newNodeId,
      edgesAdded,
      sourceTimelineHash: daemonResult.sourceTimelineHash,
      timelineHash: daemonResult.timelineHash,
      timelineRevision: daemonResult.timelineRevision,
      lineageEdge: daemonResult.lineageEdge,
      readToken: daemonResult.readToken,
      ...(cas.force || daemonResult.forced === true ? { forced: true } : {}),
    };
  }
  const hostWrite = assertAgentHostWritePath({
    actorClientType: resolveCanvasPresenceOptions().clientType,
    force: cas.force,
    operation: "timeline replace",
    readCommand: "clash timeline pull --json",
  });
  if (!hostWrite.ok) throw new Error(hostWrite.error);

  const client = await connectToProject(projectId);
  try {
    const current = client.readNode(nodeId);
    if (!current) throw new Error(`Node not found: ${nodeId}`);
    if (current.type !== "video-editor") throw new Error(`Node ${nodeId} has type "${current.type}", expected "video-editor"`);
    const currentDsl = normalizeTimelineDslForYaml(current.data?.timelineDsl);
    const casResult = assertTimelineCas({
      projectId,
      nodeId,
      lock: cas.lock,
      currentDsl,
      force: cas.force,
      filePath: cas.filePath,
      cwd: cas.cwd,
    });
    if (!casResult.ok) throw new Error(casResult.error);
    const newNodeId = cas.newNodeId?.trim() || randomUUID().slice(0, 8);
    const revisionMetadata = readLoroRevisionMetadata(client.doc);
    const timelineRevision = createTimelineAppliedRevision({
      projectId,
      nodeId: newNodeId,
      cwd: cas.cwd,
      filePath: cas.filePath,
      dsl,
      parentRevisionId: cas.lock?.appliedRevision?.revisionId,
      actor: cas.actor,
      ...revisionMetadata,
    });
    const data = createTimelineCowNodeData({
      sourceNodeId: nodeId,
      sourceLabel: typeof current.data?.label === "string" ? current.data.label : undefined,
      sourceDsl: currentDsl,
      dsl,
      label: cas.label,
      filePath: cas.filePath,
      timelineRevision,
    });
    client.canvas.createLinkedNode({
      nodeId: newNodeId,
      nodeType: "video-editor",
      data,
      parentId: current.parent_id ?? null,
      sourceNodeId: nodeId,
      edgeId: `${nodeId}-${newNodeId}`,
      edgeType: "copy-on-write",
    });
    let edgesAdded = 0;
    const existing = client.canvas.listEdges();
    for (const source of sources) {
      if (existing.some((edge) => edge.source === source && edge.target === newNodeId)) continue;
      client.canvas.insertEdge(`e-${source}-${newNodeId}-${randomUUID().slice(0, 4)}`, source, newNodeId, "default");
      edgesAdded++;
    }
    return {
      replaced: true,
      copyOnWrite: true,
      sourceNodeId: nodeId,
      newNodeId,
      edgesAdded,
      sourceTimelineHash: timelineHash(currentDsl),
      timelineHash: timelineHash(dsl),
      timelineRevision,
      lineageEdge: { source: nodeId, target: newNodeId, type: "copy-on-write" },
      readToken: timelineReadToken({ projectId, nodeId: newNodeId, dsl }),
      ...(cas.force ? { forced: true } : {}),
    };
  } finally {
    await client.disconnect();
  }
}
