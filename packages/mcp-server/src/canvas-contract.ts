export const CANVAS_MCP_TOOL_NAMES = [
  "clash_canvas_open",
  "clash_canvas_snapshot",
  "clash_canvas_list",
  "clash_canvas_edges",
  "clash_canvas_get",
  "clash_canvas_search",
  "clash_canvas_add",
  "clash_canvas_execute",
  "clash_canvas_update",
  "clash_canvas_move",
  "clash_canvas_copy",
  "clash_canvas_replace_asset",
  "clash_canvas_delete_plan",
  "clash_canvas_delete_batch",
  "clash_canvas_delete",
] as const;

export type CanvasMcpToolName = (typeof CANVAS_MCP_TOOL_NAMES)[number];
export type CanvasToolVisibility = "model" | "app";

export type CanvasToolInput = {
  cwd?: string;
  projectId?: string;
  canvasId?: string;
  nodeId?: string;
  nodeIds?: string[];
  type?: string;
  types?: string[];
  label?: string;
  content?: string;
  contentFile?: string;
  prompt?: string;
  query?: string;
  parentId?: string;
  modelId?: string;
  actionId?: string;
  refs?: string[];
  params?: Record<string, string | number | boolean>;
  data?: Record<string, string | number | boolean>;
  assetId?: string;
  newNodeId?: string;
  x?: number;
  y?: number;
};

export function canvasToolVisibility(name: CanvasMcpToolName): CanvasToolVisibility[] {
  return name === "clash_canvas_snapshot" ? ["app"] : ["model", "app"];
}

function requireString(input: CanvasToolInput, key: keyof CanvasToolInput): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${String(key)} is required`);
  }
  return value.trim();
}

function appendRepeated(args: string[], flag: string, values: string[] | undefined): void {
  for (const value of values ?? []) args.push(flag, value);
}

function appendRecord(
  args: string[],
  flag: string,
  value: Record<string, string | number | boolean> | undefined,
): void {
  for (const [key, item] of Object.entries(value ?? {})) {
    args.push(flag, `${key}=${String(item)}`);
  }
}

function appendScope(args: string[], input: CanvasToolInput): void {
  if (input.projectId?.trim()) args.push("--project", input.projectId.trim());
  if (input.canvasId?.trim()) args.push("--canvas", input.canvasId.trim());
  args.push("--json");
}

export function buildCanvasCliArgs(
  name: Exclude<CanvasMcpToolName, "clash_canvas_open" | "clash_canvas_snapshot">,
  input: CanvasToolInput,
): string[] {
  const args: string[] = ["canvas"];

  switch (name) {
    case "clash_canvas_list":
      args.push("list");
      if (input.type?.trim()) args.push("--type", input.type.trim());
      break;
    case "clash_canvas_edges":
      args.push("edges");
      break;
    case "clash_canvas_get":
      args.push("get", "--node", requireString(input, "nodeId"));
      break;
    case "clash_canvas_search":
      args.push("search", "--query", requireString(input, "query"));
      if (input.types?.length) args.push("--type", input.types.join(","));
      break;
    case "clash_canvas_add":
      if (input.content !== undefined && input.contentFile !== undefined) {
        throw new Error("content and contentFile are mutually exclusive");
      }
      args.push(
        "add",
        "--type", requireString(input, "type"),
        "--label", requireString(input, "label"),
      );
      if (input.prompt !== undefined) args.push("--prompt", input.prompt);
      if (input.content !== undefined) args.push("--content", input.content);
      if (input.contentFile !== undefined) args.push("--content-file", input.contentFile);
      if (input.parentId?.trim()) args.push("--parent", input.parentId.trim());
      if (input.modelId?.trim()) args.push("--model", input.modelId.trim());
      if (input.actionId?.trim()) args.push("--action", input.actionId.trim());
      appendRepeated(args, "--ref", input.refs);
      appendRecord(args, "--param", input.params);
      break;
    case "clash_canvas_execute":
      args.push("execute", "--node", requireString(input, "nodeId"));
      break;
    case "clash_canvas_update":
      if (input.content !== undefined && input.contentFile !== undefined) {
        throw new Error("content and contentFile are mutually exclusive");
      }
      args.push("update", "--node", requireString(input, "nodeId"));
      if (input.label !== undefined) args.push("--label", input.label);
      if (input.content !== undefined) args.push("--content", input.content);
      if (input.contentFile !== undefined) args.push("--content-file", input.contentFile);
      if (input.assetId?.trim()) args.push("--asset-id", input.assetId.trim());
      appendRecord(args, "--data", input.data);
      break;
    case "clash_canvas_move":
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
        throw new Error("x and y must be finite numbers");
      }
      args.push(
        "move",
        "--node", requireString(input, "nodeId"),
        "--x", String(input.x),
        "--y", String(input.y),
      );
      break;
    case "clash_canvas_copy":
      args.push("copy", "--node", requireString(input, "nodeId"));
      if (input.newNodeId?.trim()) args.push("--new-node", input.newNodeId.trim());
      break;
    case "clash_canvas_replace_asset":
      args.push(
        "replace-asset",
        "--node", requireString(input, "nodeId"),
        "--asset", requireString(input, "assetId"),
      );
      if (input.newNodeId?.trim()) args.push("--new-node", input.newNodeId.trim());
      if (input.label !== undefined) args.push("--label", input.label);
      break;
    case "clash_canvas_delete_plan":
      args.push("delete-plan");
      appendRepeated(args, "--node", input.nodeIds);
      break;
    case "clash_canvas_delete_batch":
      args.push("delete-batch");
      appendRepeated(args, "--node", input.nodeIds);
      args.push("--yes");
      break;
    case "clash_canvas_delete":
      args.push("delete", "--node", requireString(input, "nodeId"), "--yes");
      break;
  }

  appendScope(args, input);
  return args;
}
