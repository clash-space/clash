import { Command } from "commander";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  LoroSyncClient,
  TextRevisionHistoryEntrySchema,
  type TextRevisionHistoryEntry,
} from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { apiFetch } from "../lib/api";
import { isJsonMode, printJson, printTable } from "../lib/output";
import { isDaemonRunning, sendCommand } from "../lib/daemon";
import { assertAgentHostWritePath } from "../lib/agent-host-write";
import { publicAgentCommandResult } from "../lib/agent-worktree-observation";
import { isCanvasNodeImmutable } from "../lib/canvas-update-guardrails";
import { resolveAgentFilePathInsideCwd } from "../lib/projection-cas";
import { type ResolvedProjectContext } from "../lib/project-context";
import {
  recordWorktreeObservation,
  requireWorktreeObservation,
} from "../lib/worktree-observations";
import {
  resolveCanvasActor,
  resolveCanvasPresenceOptions,
  resolveCanvasProjectContext,
  resolveCanvasProjectId,
} from "./canvas";
import {
  assertTextNotReferenced,
  createTextAppliedRevision,
  createTextCowNodeData,
  resolveTextFilePath,
  textHash,
  textReadToken,
  textContentFromNode,
  type TextAppliedRevision,
  type TextNodeLike,
  type TextRevisionActor,
} from "../lib/text-projection";

export {
  assertTextNotReferenced,
  createTextAppliedRevision,
  resolveTextFilePath,
  textHash,
  textReadToken,
  textContentFromNode,
};

function isAgentTextClient(): boolean {
  return resolveCanvasPresenceOptions().clientType === "agent";
}

async function recordTextObservation(
  context: ResolvedProjectContext,
  nodeId: string,
  revision: string,
): Promise<void> {
  if (!isAgentTextClient()) return;
  if (!context.workspaceRoot) {
    throw new Error("Agent reads require a cwd linked through .clash/project.toml.");
  }
  await recordWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: "text",
    entityId: nodeId,
    revision,
  });
}

async function requireTextObservation(
  context: ResolvedProjectContext,
  nodeId: string,
): Promise<string | undefined> {
  if (!isAgentTextClient()) return undefined;
  if (!context.workspaceRoot) {
    throw new Error("READ_REQUIRED: Run the command from a cwd linked through .clash/project.toml and pull the text first.");
  }
  const observation = await requireWorktreeObservation({
    workspaceRoot: context.workspaceRoot,
    projectId: context.projectId,
    entityKind: "text",
    entityId: nodeId,
  });
  if (!observation.ok) throw new Error(`${observation.code}: ${observation.error}`);
  return observation.revision;
}

function publicTextMutationResult<T extends Record<string, unknown>>(result: T): Omit<T, "readToken" | "version"> {
  return publicAgentCommandResult(result) as Omit<T, "readToken" | "version">;
}

export const textCommand = new Command("text")
  .description(
    `Agent-editable text node files.

Default file path:
  projections/text/<node-id>.md

Workflow:
  clash text pull --project <id> --node <text-node-id>
  # edit projections/text/<node-id>.md with normal file tools
  clash text apply --project <id> --node <text-node-id>

CAS is implicit: pull records the canvas version in .clash/observed.json, and
apply/replace refuse stale writes.`,
  );

textCommand
  .command("pull")
  .description("Export a canvas text node's content to a Markdown file")
  .requiredOption("--node <id>", "Text node ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--file <path>", "Markdown path (default: texts/<node-id>.md)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const projectId = context.projectId;
    const filePath = resolveTextFilePath({
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
    const version = node.readToken ?? textReadToken({ projectId, nodeId: options.node, content });
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
    await recordTextObservation(context, options.node, version);

    const payload = {
      pulled: true,
      projectId,
      nodeId: options.node,
      filePath,
      contentHash: textHash(content),
      immutable: node.immutable ?? false,
    };
    if (isJsonMode(options)) printJson(payload);
    else process.stderr.write(`wrote ${filePath}\n`);
  });

textCommand
  .command("apply")
  .description("Apply a Markdown file back to the canvas text node")
  .requiredOption("--node <id>", "Text node ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--file <path>", "Markdown path (default: texts/<node-id>.md)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const projectId = context.projectId;
    const filePath = resolveTextFilePath({
      cwd: process.cwd(),
      file: options.file,
      nodeId: options.node,
    });
    let result: ApplyTextContentResult;
    let content = "";
    const actor = await resolveCanvasActor();
    try {
      const observedVersion = await requireTextObservation(context, options.node);
      content = readFileSync(filePath, "utf8");
      result = await applyTextContent(projectId, options.node, content, {
        observedVersion,
        filePath,
        cwd: process.cwd(),
        actor,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    const textRevision = result.textRevision ?? createTextAppliedRevision({
      projectId,
      nodeId: options.node,
      cwd: process.cwd(),
      filePath,
      content,
      actor,
    });
    await recordTextObservation(
      context,
      options.node,
      result.readToken ?? result.version ?? textReadToken({ projectId, nodeId: options.node, content }),
    );
    const textRevisionIndex = await registerTextRevisionIndex(textRevision, content);
    const payload = {
      ...publicTextMutationResult(result),
      projectId,
      filePath,
      textRevision,
      textRevisionIndex,
      contentHash: textHash(content),
    };
    if (isJsonMode(options)) printJson(payload);
    else {
      if (!textRevisionIndex.indexed) {
        process.stderr.write(`warning: ${textRevisionIndex.error}\n`);
      }
      process.stderr.write(`applied ${filePath} to ${options.node}\n`);
    }
  });

textCommand
  .command("replace")
  .description("Create a copy-on-write replacement text node from a Markdown file")
  .requiredOption("--node <id>", "Source text node ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--file <path>", "Markdown path (default: texts/<node-id>.md)")
  .option("--label <label>", "Label for the replacement text node")
  .option("--new-node <id>", "Replacement node ID (defaults to a generated id)")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const projectId = context.projectId;
    const filePath = resolveTextFilePath({
      cwd: process.cwd(),
      file: options.file,
      nodeId: options.node,
    });
    let result: ReplaceTextContentResult;
    let content = "";
    const actor = await resolveCanvasActor();
    try {
      const observedVersion = await requireTextObservation(context, options.node);
      content = readFileSync(filePath, "utf8");
      result = await replaceTextContent(projectId, options.node, content, {
        observedVersion,
        filePath,
        cwd: process.cwd(),
        actor,
        label: options.label,
        newNodeId: options.newNode,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    const textRevision = result.textRevision ?? createTextAppliedRevision({
      projectId,
      nodeId: result.newNodeId,
      cwd: process.cwd(),
      filePath,
      content,
      actor,
    });
    await recordTextObservation(
      context,
      result.newNodeId,
      result.readToken ?? result.version ?? textReadToken({ projectId, nodeId: result.newNodeId, content }),
    );
    const textRevisionIndex = await registerTextRevisionIndex(textRevision, content);
    const payload = {
      ...publicTextMutationResult(result),
      projectId,
      filePath,
      textRevision,
      textRevisionIndex,
      contentHash: textHash(content),
    };
    if (isJsonMode(options)) printJson(payload);
    else {
      if (!textRevisionIndex.indexed) {
        process.stderr.write(`warning: ${textRevisionIndex.error}\n`);
      }
      process.stderr.write(`created copy-on-write text ${result.newNodeId} from ${options.node}\n`);
    }
  });

textCommand
  .command("history")
  .description("List applied text revisions indexed by the host")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--node <id>", "Filter by text node ID")
  .option("--limit <n>", "Maximum revisions to return")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    let limit: number | undefined;
    try {
      limit = parseTextRevisionLimit(options.limit);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    try {
      const result = await fetchTextRevisionHistory(projectId, { nodeId: options.node, limit });
      const payload = { projectId, nodeId: options.node, ...result };
      if (isJsonMode(options)) {
        printJson(payload);
      } else {
        printTable(result.revisions.map((revision) => ({
          revisionId: revision.revisionId,
          nodeId: revision.nodeId,
          parent: revision.parentRevisionId ?? "",
          hash: revision.contentHash,
          createdAt: revision.createdAt,
          source: revision.sourceFilePath,
        })), [
          { key: "revisionId", label: "Revision", width: 32 },
          { key: "nodeId", label: "Node", width: 20 },
          { key: "hash", label: "Hash", width: 16 },
          { key: "createdAt", label: "Created", width: 24 },
          { key: "source", label: "Source", width: 36 },
        ]);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

textCommand
  .command("content")
  .description("Fetch an applied text revision's Markdown content from the host")
  .requiredOption("--revision <id>", "Text revision ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--out <path>", "Write content to a cwd-contained Markdown file instead of stdout")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    try {
      const content = await fetchTextRevisionContent(projectId, options.revision);
      if (options.out) {
        const filePath = resolveAgentFilePathInsideCwd({
          cwd: process.cwd(),
          filePath: options.out,
          writeVerb: "Text revision content output",
        });
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, "utf8");
        const payload = {
          projectId,
          revisionId: options.revision,
          filePath,
          bytes: Buffer.byteLength(content, "utf8"),
        };
        if (isJsonMode(options)) printJson(payload);
        else process.stderr.write(`wrote ${filePath}\n`);
        return;
      }
      if (isJsonMode(options)) {
        printJson({ projectId, revisionId: options.revision, content });
      } else {
        process.stdout.write(content);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

textCommand
  .command("restore")
  .description("Restore an applied text revision through an explicit CAS/COW canvas action")
  .requiredOption("--node <id>", "Target text node ID")
  .requiredOption("--revision <id>", "Text revision ID to restore")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--mode <mode>", "Restore mode: replace or apply (default: replace)", "replace")
  .option("--file <path>", "Where to materialize the revision Markdown (default: revisions/<revision>.md)")
  .option("--label <label>", "Label for the replacement text node in replace mode")
  .option("--new-node <id>", "Replacement node ID in replace mode")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const projectId = context.projectId;
    const actor = await resolveCanvasActor();
    try {
      const currentNode = await readNode(projectId, options.node);
      if (!currentNode) throw new Error(`Node not found: ${options.node}`);
      const currentContent = textContentFromNode(currentNode);
      await recordTextObservation(
        context,
        options.node,
        currentNode.readToken ?? textReadToken({ projectId, nodeId: options.node, content: currentContent }),
      );
      const result = await restoreTextRevisionContent({
        projectId,
        nodeId: options.node,
        revisionId: options.revision,
        cwd: process.cwd(),
        file: options.file,
        mode: parseTextRevisionRestoreMode(options.mode),
        actor,
        label: options.label,
        newNodeId: options.newNode,
      });
      const targetNodeId = result.mode === "replace" ? result.newNodeId : result.nodeId;
      if (result.readToken ?? result.version) {
        await recordTextObservation(context, targetNodeId, result.readToken ?? result.version!);
      }
      if (isJsonMode(options)) {
        printJson(publicTextMutationResult(result));
      } else {
        if (!result.textRevisionIndex.indexed) {
          process.stderr.write(`warning: ${result.textRevisionIndex.error}\n`);
        }
        const action = result.mode === "replace"
          ? `created copy-on-write text ${result.newNodeId} from ${options.node}`
          : `restored ${options.revision} to ${options.node}`;
        process.stderr.write(`${action}\nwrote ${result.filePath}\n`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
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

export type TextRevisionIndexResult =
  | { indexed: true }
  | { indexed: false; status?: number; error: string };

export async function registerTextRevisionIndex(
  revision: TextAppliedRevision,
  contentOrRequest?: string | ((path: string, init?: RequestInit) => Promise<Response>),
  requestOverride?: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<TextRevisionIndexResult> {
  const content = typeof contentOrRequest === "string" ? contentOrRequest : undefined;
  const request = typeof contentOrRequest === "function"
    ? contentOrRequest
    : requestOverride ?? apiFetch;
  try {
    const response = await request("/api/v1/text-revisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        revision,
        ...(content !== undefined ? { content } : {}),
      }),
    });
    if (response.ok) return { indexed: true };
    if (response.status === 404) {
      return { indexed: false, status: 404, error: "text revision index API unavailable" };
    }
    const body = await response.text().catch(() => "");
    return {
      indexed: false,
      status: response.status,
      error: body ? `text revision index rejected: ${body}` : `text revision index rejected with HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      indexed: false,
      error: `text revision index unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export type TextRevisionHistoryResult = {
  revisions: TextRevisionHistoryEntry[];
};

export async function fetchTextRevisionHistory(
  projectId: string,
  options: { nodeId?: string; limit?: number } = {},
  request: (path: string, init?: RequestInit) => Promise<Response> = apiFetch,
): Promise<TextRevisionHistoryResult> {
  const params = new URLSearchParams();
  if (options.nodeId) params.set("nodeId", options.nodeId);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const query = params.toString();
  const response = await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/text-revisions${query ? `?${query}` : ""}`,
    { method: "GET" },
  );
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("text revision history API unavailable");
    }
    const body = await response.text().catch(() => "");
    throw new Error(body ? `text revision history rejected: ${body}` : `text revision history rejected with HTTP ${response.status}`);
  }
  const body = await response.json().catch(() => null) as { revisions?: unknown[] } | null;
  if (!body || !Array.isArray(body.revisions)) {
    throw new Error("Invalid text revision history response");
  }
  return {
    revisions: body.revisions.map((revision) => {
      const parsed = TextRevisionHistoryEntrySchema.safeParse(revision);
      if (!parsed.success) {
        throw new Error("Invalid text revision history response");
      }
      return parsed.data;
    }),
  };
}

export async function fetchTextRevisionContent(
  projectId: string,
  revisionId: string,
  request: (path: string, init?: RequestInit) => Promise<Response> = apiFetch,
): Promise<string> {
  const response = await request(
    `/api/v1/projects/${encodeURIComponent(projectId)}/text-revisions/${encodeURIComponent(revisionId)}/content`,
    { method: "GET" },
  );
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("text revision content unavailable");
    }
    const body = await response.text().catch(() => "");
    throw new Error(body ? `text revision content rejected: ${body}` : `text revision content rejected with HTTP ${response.status}`);
  }
  return response.text();
}

export type TextRevisionRestoreMode = "apply" | "replace";

export type TextRevisionRestoreOptions = {
  projectId: string;
  nodeId: string;
  revisionId: string;
  cwd: string;
  file?: string;
  mode?: TextRevisionRestoreMode;
  actor?: TextRevisionActor;
  label?: string;
  newNodeId?: string;
};

export type TextRevisionRestoreDeps = {
  fetchContent?: typeof fetchTextRevisionContent;
  readNode?: typeof readNode;
  apply?: typeof applyTextContent;
  replace?: typeof replaceTextContent;
  register?: typeof registerTextRevisionIndex;
  mkdir?: typeof mkdirSync;
  writeFile?: typeof writeFileSync;
};

export type TextRevisionRestoreResult = (
  | (ApplyTextContentResult & { mode: "apply" })
  | (ReplaceTextContentResult & { mode: "replace" })
) & {
  revisionId: string;
  filePath: string;
  textRevision: TextAppliedRevision;
  textRevisionIndex: TextRevisionIndexResult;
  contentHash: string;
};

export async function restoreTextRevisionContent(
  options: TextRevisionRestoreOptions,
  deps: TextRevisionRestoreDeps = {},
): Promise<TextRevisionRestoreResult> {
  const mode = parseTextRevisionRestoreMode(options.mode);
  const fetchContent = deps.fetchContent ?? fetchTextRevisionContent;
  const readCurrentNode = deps.readNode ?? readNode;
  const apply = deps.apply ?? applyTextContent;
  const replace = deps.replace ?? replaceTextContent;
  const register = deps.register ?? registerTextRevisionIndex;
  const mkdir = deps.mkdir ?? mkdirSync;
  const writeFile = deps.writeFile ?? writeFileSync;
  const filePath = resolveTextFilePath({
    cwd: options.cwd,
    nodeId: options.nodeId,
    file: options.file ?? join(options.cwd, "revisions", `${revisionFileStem(options.revisionId)}.md`),
  });
  const content = await fetchContent(options.projectId, options.revisionId);
  const currentNode = await readCurrentNode(options.projectId, options.nodeId);
  if (!currentNode) throw new Error(`Node not found: ${options.nodeId}`);
  if (currentNode.type !== "text") {
    throw new Error(`Node ${options.nodeId} has type "${currentNode.type}", expected "text"`);
  }
  const observedVersion = currentNode.readToken ?? textReadToken({
    projectId: options.projectId,
    nodeId: options.nodeId,
    content: textContentFromNode(currentNode),
  });
  mkdir(dirname(filePath), { recursive: true });
  writeFile(filePath, content, "utf8");

  const sharedCas = {
    observedVersion,
    filePath,
    cwd: options.cwd,
    actor: options.actor,
    parentRevisionId: options.revisionId,
  };
  let result: ApplyTextContentResult | ReplaceTextContentResult;
  let targetNodeId: string;
  if (mode === "apply") {
    result = await apply(options.projectId, options.nodeId, content, sharedCas);
    targetNodeId = result.nodeId;
  } else {
    result = await replace(options.projectId, options.nodeId, content, {
      ...sharedCas,
      label: options.label,
      newNodeId: options.newNodeId,
    });
    targetNodeId = result.newNodeId;
  }
  const textRevision = result.textRevision ?? createTextAppliedRevision({
    projectId: options.projectId,
    nodeId: targetNodeId,
    cwd: options.cwd,
    filePath,
    content,
    parentRevisionId: options.revisionId,
    actor: options.actor,
  });
  const textRevisionIndex = await register(textRevision, content);
  const publicResult = publicAgentCommandResult(result);
  return {
    ...publicResult,
    mode,
    revisionId: options.revisionId,
    filePath,
    textRevision,
    textRevisionIndex,
    contentHash: textHash(content),
  } as TextRevisionRestoreResult;
}

export function parseTextRevisionRestoreMode(value: unknown): TextRevisionRestoreMode {
  if (value === undefined || value === null || value === "" || value === "replace") return "replace";
  if (value === "apply") return "apply";
  throw new Error("Text revision restore mode must be either apply or replace");
}

function revisionFileStem(revisionId: string): string {
  return revisionId.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "revision";
}

function parseTextRevisionLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Text revision history limit must be a positive integer");
  }
  return limit;
}

export type TextNodeReadResult = TextNodeLike & {
  immutable?: boolean;
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
      ? {
          ...daemonResult.node,
          immutable: daemonResult.immutable === true,
          readToken: daemonResult.textReadToken,
        }
      : null;
  }
  const client = await connectToProject(projectId);
  try {
    const node = client.readNode(nodeId);
    return node ? {
      type: node.type,
      data: node.data as Record<string, unknown>,
      immutable: isCanvasNodeImmutable({ nodeId, edges: client.canvas.listEdges() }),
    } : null;
  } finally {
    await client.disconnect();
  }
}

async function applyTextContent(
  projectId: string,
  nodeId: string,
  content: string,
  cas: {
    observedVersion?: string;
    filePath: string;
    cwd: string;
    actor?: TextRevisionActor;
    parentRevisionId?: string | null;
  },
): Promise<ApplyTextContentResult> {
  resolveAgentFilePathInsideCwd({ filePath: cas.filePath, cwd: cas.cwd, writeVerb: "Text apply" });

  const daemonResult = await runCommand(projectId, {
    action: "text_cas_update",
    projectId,
    nodeId,
    content,
    observedVersion: cas.observedVersion,
    ifMatch: cas.observedVersion,
    parentRevisionId: cas.parentRevisionId,
    filePath: cas.filePath,
    cwd: cas.cwd,
    actor: cas.actor,
    actorClientType: resolveCanvasPresenceOptions().clientType,
  });
  if (daemonResult) {
    if (daemonResult.error) throw new Error(daemonResult.error);
    return {
      updated: true,
      nodeId,
      textRevision: daemonResult.textRevision,
      version: daemonResult.version,
      readToken: daemonResult.readToken,
    };
  }
  const hostWrite = assertAgentHostWritePath({
    actorClientType: resolveCanvasPresenceOptions().clientType,
    operation: "text apply",
    readCommand: "clash text pull --json",
  });
  if (!hostWrite.ok) throw new Error(hostWrite.error);

  const client = await connectToProject(projectId);
  try {
    const current = client.readNode(nodeId);
    if (!current) throw new Error(`Node not found: ${nodeId}`);
    if (isCanvasNodeImmutable({ nodeId, edges: client.canvas.listEdges() })) {
      throw new Error("IMMUTABLE_NODE");
    }
    const ok = client.updateNode(nodeId, { content });
    if (!ok) throw new Error(`Node not found: ${nodeId}`);
    const textRevision = createTextAppliedRevision({
      projectId,
      nodeId,
      cwd: cas.cwd,
      filePath: cas.filePath,
      content,
      parentRevisionId: cas.parentRevisionId,
      actor: cas.actor,
    });
    const version = textReadToken({ projectId, nodeId, content });
    return {
      updated: true,
      nodeId,
      textRevision,
      version,
      readToken: version,
    };
  } finally {
    await client.disconnect();
  }
}
export type ApplyTextContentResult = {
  updated: true;
  nodeId: string;
  textRevision?: TextAppliedRevision;
  version?: string;
  readToken?: string;
};

async function replaceTextContent(
  projectId: string,
  nodeId: string,
  content: string,
  cas: {
    observedVersion?: string;
    filePath: string;
    cwd: string;
    actor?: TextRevisionActor;
    parentRevisionId?: string | null;
    label?: string;
    newNodeId?: string;
  },
): Promise<ReplaceTextContentResult> {
  resolveAgentFilePathInsideCwd({ filePath: cas.filePath, cwd: cas.cwd, writeVerb: "Text replace" });

  const daemonResult = await runCommand(projectId, {
    action: "text_cow_replace",
    projectId,
    nodeId,
    content,
    observedVersion: cas.observedVersion,
    ifMatch: cas.observedVersion,
    parentRevisionId: cas.parentRevisionId,
    filePath: cas.filePath,
    cwd: cas.cwd,
    actor: cas.actor,
    label: cas.label,
    newNodeId: cas.newNodeId,
    actorClientType: resolveCanvasPresenceOptions().clientType,
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
      textRevision: daemonResult.textRevision,
      lineageEdge: daemonResult.lineageEdge,
      version: daemonResult.version,
      readToken: daemonResult.readToken,
    };
  }
  const hostWrite = assertAgentHostWritePath({
    actorClientType: resolveCanvasPresenceOptions().clientType,
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
    const newNodeId = cas.newNodeId?.trim() || randomUUID().slice(0, 8);
    const textRevision = createTextAppliedRevision({
      projectId,
      nodeId: newNodeId,
      cwd: cas.cwd,
      filePath: cas.filePath,
      content,
      parentRevisionId: cas.parentRevisionId,
      actor: cas.actor,
    });
    const data = createTextCowNodeData({
      sourceNodeId: nodeId,
      sourceLabel: typeof current.data?.label === "string" ? current.data.label : undefined,
      sourceContent: currentContent,
      content,
      label: cas.label,
      filePath: cas.filePath,
      textRevision,
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
    const version = textReadToken({ projectId, nodeId: newNodeId, content });
    return {
      replaced: true,
      copyOnWrite: true,
      sourceNodeId: nodeId,
      newNodeId,
      sourceContentHash: textHash(currentContent),
      contentHash: textHash(content),
      textRevision,
      lineageEdge: { source: nodeId, target: newNodeId, type: "copy-on-write" },
      version,
      readToken: version,
    };
  } finally {
    await client.disconnect();
  }
}

export type ReplaceTextContentResult = {
  replaced: true;
  copyOnWrite: true;
  sourceNodeId: string;
  newNodeId: string;
  sourceContentHash?: string;
  contentHash?: string;
  textRevision?: TextAppliedRevision;
  lineageEdge?: unknown;
  version?: string;
  readToken?: string;
};
