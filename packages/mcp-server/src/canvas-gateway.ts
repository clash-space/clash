import type { ProjectHostCommand } from "@clash/shared-types";
import { resolveWorkspaceTextInput } from "@clash/shared-runtime";
import {
  createProjectHostClient,
  publicProjectHostValue,
  type ProjectHostClient,
  type ProjectHostResponse,
} from "@clash/shared-runtime/project-host-client";
import type {
  CanvasMcpToolName,
  CanvasToolInput,
} from "./canvas-contract";

export type CanvasProjectHostGateway = {
  invoke(name: CanvasMcpToolName, input: CanvasToolInput): Promise<unknown>;
};

function requiredString(input: CanvasToolInput, key: keyof CanvasToolInput): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${String(key)} is required`);
  return value.trim();
}

function nodeIds(input: CanvasToolInput): string[] {
  const values = [...new Set((input.nodeIds ?? []).map((value) => value.trim()).filter(Boolean))]
    .sort();
  if (values.length === 0) throw new Error("nodeIds is required");
  return values;
}

function hostValue(value: ProjectHostResponse): ProjectHostResponse {
  if (!value.error) return value;
  const code = typeof value.code === "string" ? `${value.code}: ` : "";
  throw new Error(`${code}${value.error}`);
}

function readToken(value: ProjectHostResponse): string | undefined {
  return typeof value.readToken === "string"
    ? value.readToken
    : typeof value.version === "string"
      ? value.version
      : undefined;
}

async function resolvedContent(
  input: CanvasToolInput,
  workspaceRoot: string | undefined,
): Promise<string | undefined> {
  if (input.contentFile === undefined) return input.content;
  if (!workspaceRoot) {
    throw new Error("contentFile requires a cwd linked to a Clash workspace");
  }
  return resolveWorkspaceTextInput({
    workspaceRoot,
    inline: input.content,
    filePath: input.contentFile,
  });
}

/** Direct Canvas transport with MCP-session read receipts and no CLI process. */
export function createCanvasProjectHostGateway(
  client: ProjectHostClient = createProjectHostClient(),
): CanvasProjectHostGateway {
  const observations = new Map<string, string>();
  const scope = async (input: CanvasToolInput) => {
    const context = await client.resolveContext({ cwd: input.cwd, projectId: input.projectId });
    return {
      projectId: context.projectId,
      workspaceRoot: context.workspaceRoot,
      canvasId: input.canvasId?.trim() || "main",
      key: `${context.projectId}\0${input.canvasId?.trim() || "main"}`,
    };
  };
  const request = async (input: CanvasToolInput, command: ProjectHostCommand) => {
    const result = await client.request({
      cwd: input.cwd,
      projectId: input.projectId,
      command,
    });
    return hostValue(result.value);
  };
  const requireNodeReceipt = async (input: CanvasToolInput, id: string) => {
    const resolved = await scope(input);
    const receipt = observations.get(`${resolved.key}\0node\0${id}`);
    if (!receipt) {
      throw new Error(
        `READ_REQUIRED: Read Canvas node ${id} with clash_canvas_get or clash_canvas_list before mutating it.`,
      );
    }
    return receipt;
  };

  return {
    async invoke(name, input) {
      const resolved = await scope(input);
      const canvasId = resolved.canvasId;
      if (name === "clash_canvas_open" || name === "clash_canvas_snapshot") {
        const listed = await request(input, { action: "list", canvasId });
        const edges = await request(input, { action: "edges", canvasId });
        const versions = listed.versions && typeof listed.versions === "object"
          ? listed.versions as Record<string, unknown>
          : {};
        for (const [id, receipt] of Object.entries(versions)) {
          if (typeof receipt === "string") observations.set(`${resolved.key}\0node\0${id}`, receipt);
        }
        return {
          projectId: resolved.projectId,
          canvasId,
          nodes: Array.isArray(listed.nodes) ? listed.nodes : [],
          edges: Array.isArray(edges.edges) ? edges.edges : [],
        };
      }

      switch (name) {
        case "clash_canvas_list": {
          const value = await request(input, {
            action: "list",
            canvasId,
            ...(input.type?.trim() ? { type: input.type.trim() } : {}),
          });
          const versions = value.versions && typeof value.versions === "object"
            ? value.versions as Record<string, unknown>
            : {};
          for (const [id, receipt] of Object.entries(versions)) {
            if (typeof receipt === "string") observations.set(`${resolved.key}\0node\0${id}`, receipt);
          }
          return Array.isArray(value.nodes) ? value.nodes : [];
        }
        case "clash_canvas_edges": {
          const value = await request(input, { action: "edges", canvasId });
          return Array.isArray(value.edges) ? value.edges : [];
        }
        case "clash_canvas_get": {
          const nodeId = requiredString(input, "nodeId");
          const value = await request(input, { action: "get", canvasId, nodeId });
          const receipt = readToken(value);
          if (!receipt) throw new Error("Host read did not return a Canvas node receipt");
          observations.set(`${resolved.key}\0node\0${nodeId}`, receipt);
          return value.node && typeof value.node === "object"
            ? { ...value.node as Record<string, unknown>, immutable: value.immutable === true }
            : publicProjectHostValue(value);
        }
        case "clash_canvas_search": {
          const value = await request(input, {
            action: "search",
            canvasId,
            query: requiredString(input, "query"),
            ...(input.types ? { types: input.types } : {}),
          });
          return Array.isArray(value.nodes) ? value.nodes : [];
        }
        case "clash_canvas_add": {
          const content = await resolvedContent(input, resolved.workspaceRoot);
          const value = await request(input, {
            action: "add",
            canvasId,
            type: requiredString(input, "type") as "text",
            label: requiredString(input, "label"),
            ...(content !== undefined ? { content } : {}),
            ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
            ...(input.parentId?.trim() ? { parentId: input.parentId.trim() } : {}),
            ...(input.modelId?.trim() ? { modelId: input.modelId.trim() } : {}),
            ...(input.actionId?.trim() ? { actionId: input.actionId.trim() } : {}),
            ...(input.assetId?.trim() ? { assetId: input.assetId.trim() } : {}),
            ...(input.refs ? { refs: input.refs } : {}),
            ...(input.params ? { params: input.params } : {}),
            actorClientType: "mcp",
          });
          const resultId =
            typeof value.nodeId === "string" ? value.nodeId : undefined;
          const nextReceipt = readToken(value);
          if (resultId && nextReceipt) {
            observations.set(`${resolved.key}\0node\0${resultId}`, nextReceipt);
          }
          return publicProjectHostValue(value);
        }
        case "clash_canvas_execute": {
          const nodeId = requiredString(input, "nodeId");
          const receipt = await requireNodeReceipt(input, nodeId);
          const value = await request(input, {
            action: "execute",
            canvasId,
            nodeId,
            actorClientType: "mcp",
            observedVersion: receipt,
            ifMatch: receipt,
          } as ProjectHostCommand);
          const nextReceipt = readToken(value);
          if (nextReceipt) {
            observations.set(`${resolved.key}\0node\0${nodeId}`, nextReceipt);
          }
          return publicProjectHostValue(value);
        }
        case "clash_canvas_update": {
          const nodeId = requiredString(input, "nodeId");
          const receipt = await requireNodeReceipt(input, nodeId);
          const content = await resolvedContent(input, resolved.workspaceRoot);
          if (input.viewState !== undefined && input.viewStateFile !== undefined) {
            throw new Error("viewState and viewStateFile are mutually exclusive");
          }
          let viewState = input.viewState;
          if (input.viewStateFile !== undefined) {
            if (!resolved.workspaceRoot) {
              throw new Error("viewStateFile requires a cwd linked to a Clash workspace");
            }
            const encoded = await resolveWorkspaceTextInput({
              workspaceRoot: resolved.workspaceRoot,
              filePath: input.viewStateFile,
            });
            try {
              viewState = JSON.parse(encoded ?? "");
            } catch (error) {
              throw new Error(`Invalid View state JSON: ${(error as Error).message}`);
            }
          }
          const data = {
            ...(input.data ?? {}),
            ...(input.assetId?.trim() ? { assetId: input.assetId.trim() } : {}),
            ...(viewState === undefined ? {} : { state: viewState }),
          };
          const value = await request(input, {
            action: "update",
            canvasId,
            nodeId,
            ...(input.label !== undefined ? { label: input.label } : {}),
            ...(content !== undefined ? { content } : {}),
            ...(Object.keys(data).length ? { data } : {}),
            actorClientType: "mcp",
            observedVersion: receipt,
            ifMatch: receipt,
          });
          const nextReceipt = readToken(value);
          if (nextReceipt) observations.set(`${resolved.key}\0node\0${nodeId}`, nextReceipt);
          return publicProjectHostValue(value);
        }
        case "clash_canvas_move": {
          const nodeId = requiredString(input, "nodeId");
          if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
            throw new Error("x and y must be finite numbers");
          }
          const receipt = await requireNodeReceipt(input, nodeId);
          const value = await request(input, {
            action: "move",
            canvasId,
            nodeId,
            position: { x: input.x!, y: input.y! },
            actorClientType: "mcp",
            observedVersion: receipt,
            ifMatch: receipt,
          });
          const nextReceipt = readToken(value);
          if (nextReceipt) observations.set(`${resolved.key}\0node\0${nodeId}`, nextReceipt);
          return publicProjectHostValue(value);
        }
        case "clash_canvas_copy": {
          const nodeId = requiredString(input, "nodeId");
          const receipt = await requireNodeReceipt(input, nodeId);
          const value = await request(input, {
            action: "copy_node",
            canvasId,
            nodeId,
            ...(input.newNodeId?.trim() ? { newNodeId: input.newNodeId.trim() } : {}),
            actorClientType: "mcp",
            observedVersion: receipt,
            ifMatch: receipt,
          });
          const resultId = typeof value.newNodeId === "string" ? value.newNodeId : undefined;
          const nextReceipt = readToken(value);
          if (resultId && nextReceipt) observations.set(`${resolved.key}\0node\0${resultId}`, nextReceipt);
          return publicProjectHostValue(value);
        }
        case "clash_canvas_replace_asset": {
          const nodeId = requiredString(input, "nodeId");
          const receipt = await requireNodeReceipt(input, nodeId);
          const value = await request(input, {
            action: "asset_cow_replace",
            canvasId,
            nodeId,
            assetId: requiredString(input, "assetId"),
            ...(input.newNodeId?.trim() ? { newNodeId: input.newNodeId.trim() } : {}),
            ...(input.label !== undefined ? { label: input.label } : {}),
            actorClientType: "mcp",
            observedVersion: receipt,
            ifMatch: receipt,
          });
          const resultId = typeof value.newNodeId === "string" ? value.newNodeId : undefined;
          const nextReceipt = readToken(value);
          if (resultId && nextReceipt) observations.set(`${resolved.key}\0node\0${resultId}`, nextReceipt);
          return publicProjectHostValue(value);
        }
        case "clash_canvas_delete_plan": {
          const ids = nodeIds(input);
          const value = await request(input, { action: "batch_delete_plan", canvasId, nodeIds: ids });
          const receipt = readToken(value);
          if (!receipt) throw new Error("Host delete plan did not return a receipt");
          observations.set(`${resolved.key}\0batch\0${ids.join(",")}`, receipt);
          return publicProjectHostValue(value);
        }
        case "clash_canvas_delete_batch": {
          const ids = nodeIds(input);
          const receipt = observations.get(`${resolved.key}\0batch\0${ids.join(",")}`);
          if (!receipt) {
            throw new Error("READ_REQUIRED: Run clash_canvas_delete_plan for this exact node batch first.");
          }
          const value = await request(input, {
            action: "delete_batch",
            canvasId,
            nodeIds: ids,
            actorClientType: "mcp",
            observedVersion: receipt,
            ifMatch: receipt,
          });
          for (const id of ids) {
            observations.delete(`${resolved.key}\0node\0${id}`);
          }
          observations.delete(`${resolved.key}\0batch\0${ids.join(",")}`);
          return publicProjectHostValue(value);
        }
        case "clash_canvas_delete": {
          const nodeId = requiredString(input, "nodeId");
          const receipt = await requireNodeReceipt(input, nodeId);
          const value = await request(input, {
            action: "delete",
            canvasId,
            nodeId,
            actorClientType: "mcp",
            observedVersion: receipt,
            ifMatch: receipt,
          });
          observations.delete(`${resolved.key}\0node\0${nodeId}`);
          return publicProjectHostValue(value);
        }
      }
    },
  };
}
