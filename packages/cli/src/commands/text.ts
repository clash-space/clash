import { Command } from "commander";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LoroSyncClient } from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { isJsonMode, printJson } from "../lib/output";
import { isDaemonRunning, sendCommand } from "../lib/daemon";
import { assertAgentHostWritePath } from "../lib/agent-host-write";
import { resolveCanvasPresenceOptions, resolveCanvasProjectId } from "./canvas";
import {
  assertTextCas,
  assertTextLockFilePath,
  assertTextNotReferenced,
  createTextCowNodeData,
  createTextLock,
  parseTextLock,
  resolveTextFilePath,
  resolveTextLockPath,
  textHash,
  textReadToken,
  textContentFromNode,
  type TextLock,
  type TextNodeLike,
} from "../lib/text-projection";

export {
  assertTextCas,
  assertTextLockFilePath,
  assertTextNotReferenced,
  createTextLock,
  parseTextLock,
  resolveTextFilePath,
  resolveTextLockPath,
  textReadToken,
  textContentFromNode,
};

export const textCommand = new Command("text")
  .description(
    `Agent-editable text node files.

Default file path:
  projections/text/<node-id>.md

Workflow:
  clash text pull --project <id> --node <text-node-id>
  # edit projections/text/<node-id>.md with normal file tools
  clash text apply --project <id> --node <text-node-id>

CAS:
  pull also writes projections/text/<node-id>.lock.json. apply refuses to write
  if the canvas text changed after pull unless --force is passed.`,
  );

textCommand
  .command("pull")
  .description("Export a canvas text node's content to a Markdown file")
  .requiredOption("--node <id>", "Text node ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--file <path>", "Markdown path (default: texts/<node-id>.md)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    const filePath = resolveTextFilePath({
      cwd: process.cwd(),
      file: options.file,
      nodeId: options.node,
    });
    const lockPath = resolveTextLockPath({
      cwd: process.cwd(),
      file: options.file,
      nodeId: options.node,
    });
    const node = await readNode(projectId, options.node);
    if (!node) {
      console.error(`Node not found: ${options.node}`);
      process.exit(1);
    }
    if (node.type !== "text") {
      process.stderr.write(
        `warning: node ${options.node} has type "${node.type}", expected "text". Proceeding.\n`,
      );
    }

    const content = textContentFromNode(node);
    const lock = createTextLock({
      projectId,
      nodeId: options.node,
      filePath,
      content,
      readToken: node.readToken,
    });
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");

    const payload = {
      pulled: true,
      projectId,
      nodeId: options.node,
      filePath,
      lockPath,
      contentHash: lock.contentHash,
      readToken: lock.readToken,
    };
    if (isJsonMode(options)) printJson(payload);
    else process.stderr.write(`wrote ${filePath}\nwrote ${lockPath}\n`);
  });

textCommand
  .command("apply")
  .description("Apply a Markdown file back to the canvas text node")
  .requiredOption("--node <id>", "Text node ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--file <path>", "Markdown path (default: texts/<node-id>.md)")
  .option("--lock <path>", "CAS lock path (default: Markdown sidecar)")
  .option("--force", "Bypass CAS and intentionally overwrite the current canvas text")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    const filePath = resolveTextFilePath({
      cwd: process.cwd(),
      file: options.file,
      nodeId: options.node,
    });
    const lockPath = resolveTextLockPath({
      cwd: process.cwd(),
      file: options.file,
      lock: options.lock,
      nodeId: options.node,
    });
    let result: ApplyTextContentResult;
    let content = "";
    try {
      content = readFileSync(filePath, "utf8");
      const lock = options.force ? null : readTextLockFile(lockPath);
      result = await applyTextContent(projectId, options.node, content, {
        force: options.force === true,
        lock,
        filePath,
        cwd: process.cwd(),
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    const refreshedLock = createTextLock({
      projectId,
      nodeId: options.node,
      filePath,
      content,
      readToken: result.readToken,
    });
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify(refreshedLock, null, 2) + "\n", "utf8");
    const payload = {
      ...result,
      projectId,
      filePath,
      lockPath,
      contentHash: refreshedLock.contentHash,
      readToken: refreshedLock.readToken,
    };
    if (isJsonMode(options)) printJson(payload);
    else process.stderr.write(`applied ${filePath} to ${options.node}${result.forced ? " (forced)" : ""}\n`);
  });

textCommand
  .command("replace")
  .description("Create a copy-on-write replacement text node from a Markdown file")
  .requiredOption("--node <id>", "Source text node ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--file <path>", "Markdown path (default: texts/<node-id>.md)")
  .option("--lock <path>", "CAS lock path (default: Markdown sidecar)")
  .option("--label <label>", "Label for the replacement text node")
  .option("--new-node <id>", "Replacement node ID (defaults to a generated id)")
  .option("--force", "Bypass CAS and intentionally fork from the current canvas text")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    const filePath = resolveTextFilePath({
      cwd: process.cwd(),
      file: options.file,
      nodeId: options.node,
    });
    const lockPath = resolveTextLockPath({
      cwd: process.cwd(),
      file: options.file,
      lock: options.lock,
      nodeId: options.node,
    });
    let result: ReplaceTextContentResult;
    let content = "";
    try {
      content = readFileSync(filePath, "utf8");
      const lock = options.force ? null : readTextLockFile(lockPath);
      result = await replaceTextContent(projectId, options.node, content, {
        force: options.force === true,
        lock,
        filePath,
        cwd: process.cwd(),
        label: options.label,
        newNodeId: options.newNode,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    const refreshedLock = createTextLock({
      projectId,
      nodeId: result.newNodeId,
      filePath,
      content,
      readToken: result.readToken,
    });
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify(refreshedLock, null, 2) + "\n", "utf8");
    const payload = {
      ...result,
      projectId,
      filePath,
      lockPath,
      contentHash: refreshedLock.contentHash,
      readToken: refreshedLock.readToken,
    };
    if (isJsonMode(options)) printJson(payload);
    else {
      process.stderr.write(
        `created copy-on-write text ${result.newNodeId} from ${options.node}\n` +
        `wrote ${lockPath}\n`,
      );
    }
  });

function readTextLockFile(lockPath: string): TextLock {
  try {
    return parseTextLock(readFileSync(lockPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read text CAS lock at ${lockPath}: ${error instanceof Error ? error.message : String(error)}`);
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

type TextNodeReadResult = TextNodeLike & {
  readToken?: string;
};

async function readNode(projectId: string, nodeId: string): Promise<TextNodeReadResult | null> {
  const daemonResult = await runCommand(projectId, {
    action: "get",
    projectId,
    nodeId,
    actorClientType: resolveCanvasPresenceOptions().clientType,
  });
  if (daemonResult) {
    if (daemonResult.error) return null;
    return daemonResult.node
      ? { ...daemonResult.node, readToken: daemonResult.textReadToken }
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

async function applyTextContent(
  projectId: string,
  nodeId: string,
  content: string,
  cas: { lock: TextLock | null; force: boolean; filePath: string; cwd: string },
): Promise<ApplyTextContentResult> {
  const filePathCas = assertTextLockFilePath({
    lock: cas.lock,
    filePath: cas.filePath,
    cwd: cas.cwd,
    force: cas.force,
  });
  if (!filePathCas.ok) throw new Error(filePathCas.error);

  const daemonResult = await runCommand(projectId, {
    action: "text_cas_update",
    projectId,
    nodeId,
    content,
    expectedContentHash: cas.lock?.contentHash,
    expectedReadToken: cas.lock?.readToken,
    expectedTextFilePath: cas.lock?.filePath,
    filePath: cas.filePath,
    cwd: cas.cwd,
    actorClientType: resolveCanvasPresenceOptions().clientType,
    force: cas.force,
  });
  if (daemonResult) {
    if (daemonResult.error) throw new Error(daemonResult.error);
    return {
      updated: true,
      nodeId,
      readToken: daemonResult.readToken,
      ...(cas.force || daemonResult.forced === true ? { forced: true } : {}),
    };
  }
  const hostWrite = assertAgentHostWritePath({
    actorClientType: resolveCanvasPresenceOptions().clientType,
    force: cas.force,
    operation: "text apply",
    readCommand: "clash text pull --json",
  });
  if (!hostWrite.ok) throw new Error(hostWrite.error);

  const client = await connectToProject(projectId);
  try {
    const current = client.readNode(nodeId);
    if (!current) throw new Error(`Node not found: ${nodeId}`);
    const casResult = assertTextCas({
      projectId,
      nodeId,
      lock: cas.lock,
      currentContent: textContentFromNode({
        type: current.type,
        data: current.data as Record<string, unknown>,
      }),
      force: cas.force,
      filePath: cas.filePath,
      cwd: cas.cwd,
    });
    if (!casResult.ok) throw new Error(casResult.error);
    const referenceResult = assertTextNotReferenced({
      nodeId,
      nodes: client.listNodes(),
      edges: client.canvas.listEdges(),
      force: cas.force,
    });
    if (!referenceResult.ok) throw new Error(referenceResult.error);
    const ok = client.updateNode(nodeId, { content });
    if (!ok) throw new Error(`Node not found: ${nodeId}`);
    return {
      updated: true,
      nodeId,
      readToken: textReadToken({ projectId, nodeId, content }),
      ...(cas.force ? { forced: true } : {}),
    };
  } finally {
    await client.disconnect();
  }
}
type ApplyTextContentResult = {
  updated: true;
  nodeId: string;
  readToken?: string;
  forced?: true;
};

async function replaceTextContent(
  projectId: string,
  nodeId: string,
  content: string,
  cas: {
    lock: TextLock | null;
    force: boolean;
    filePath: string;
    cwd: string;
    label?: string;
    newNodeId?: string;
  },
): Promise<ReplaceTextContentResult> {
  const filePathCas = assertTextLockFilePath({
    lock: cas.lock,
    filePath: cas.filePath,
    cwd: cas.cwd,
    force: cas.force,
  });
  if (!filePathCas.ok) throw new Error(filePathCas.error);

  const daemonResult = await runCommand(projectId, {
    action: "text_cow_replace",
    projectId,
    nodeId,
    content,
    expectedContentHash: cas.lock?.contentHash,
    expectedReadToken: cas.lock?.readToken,
    expectedTextFilePath: cas.lock?.filePath,
    filePath: cas.filePath,
    cwd: cas.cwd,
    label: cas.label,
    newNodeId: cas.newNodeId,
    actorClientType: resolveCanvasPresenceOptions().clientType,
    force: cas.force,
  });
  if (daemonResult) {
    if (daemonResult.error) throw new Error(daemonResult.error);
    return {
      replaced: true,
      copyOnWrite: true,
      sourceNodeId: daemonResult.sourceNodeId ?? nodeId,
      newNodeId: daemonResult.newNodeId ?? daemonResult.nodeId,
      sourceContentHash: daemonResult.sourceContentHash,
      contentHash: daemonResult.contentHash,
      lineageEdge: daemonResult.lineageEdge,
      readToken: daemonResult.readToken,
      ...(cas.force || daemonResult.forced === true ? { forced: true } : {}),
    };
  }
  const hostWrite = assertAgentHostWritePath({
    actorClientType: resolveCanvasPresenceOptions().clientType,
    force: cas.force,
    operation: "text replace",
    readCommand: "clash text pull --json",
  });
  if (!hostWrite.ok) throw new Error(hostWrite.error);

  const client = await connectToProject(projectId);
  try {
    const current = client.readNode(nodeId);
    if (!current) throw new Error(`Node not found: ${nodeId}`);
    if (current.type !== "text") throw new Error(`Node ${nodeId} has type "${current.type}", expected "text"`);
    const currentContent = textContentFromNode({
      type: current.type,
      data: current.data as Record<string, unknown>,
    });
    const casResult = assertTextCas({
      projectId,
      nodeId,
      lock: cas.lock,
      currentContent,
      force: cas.force,
      filePath: cas.filePath,
      cwd: cas.cwd,
    });
    if (!casResult.ok) throw new Error(casResult.error);
    const newNodeId = cas.newNodeId?.trim() || randomUUID().slice(0, 8);
    const data = createTextCowNodeData({
      sourceNodeId: nodeId,
      sourceLabel: typeof current.data?.label === "string" ? current.data.label : undefined,
      sourceContent: currentContent,
      content,
      label: cas.label,
      filePath: cas.filePath,
    });
    client.canvas.createLinkedNode({
      nodeId: newNodeId,
      nodeType: "text",
      data,
      parentId: current.parent_id ?? null,
      sourceNodeId: nodeId,
      edgeId: `${nodeId}-${newNodeId}`,
      edgeType: "copy-on-write",
    });
    return {
      replaced: true,
      copyOnWrite: true,
      sourceNodeId: nodeId,
      newNodeId,
      sourceContentHash: textHash(currentContent),
      contentHash: textHash(content),
      lineageEdge: { source: nodeId, target: newNodeId, type: "copy-on-write" },
      readToken: textReadToken({ projectId, nodeId: newNodeId, content }),
      ...(cas.force ? { forced: true } : {}),
    };
  } finally {
    await client.disconnect();
  }
}

type ReplaceTextContentResult = {
  replaced: true;
  copyOnWrite: true;
  sourceNodeId: string;
  newNodeId: string;
  sourceContentHash?: string;
  contentHash?: string;
  lineageEdge?: unknown;
  readToken?: string;
  forced?: true;
};
