export const TIMELINE_PLUGIN_TOOL_NAMES = [
  "clash_timeline_open",
  "clash_timeline_list",
  "clash_timeline_get",
  "clash_timeline_create",
  "clash_timeline_save",
  "clash_timeline_attach",
  "clash_timeline_detach",
  "clash_timeline_copy",
] as const;

export type TimelinePluginToolName = (typeof TIMELINE_PLUGIN_TOOL_NAMES)[number];

export type TimelineEntity = {
  id: string;
  name: string;
  revisionId?: string;
  owner?: {
    kind?: string;
    canvasId?: string;
    actionNodeId?: string;
  };
  state: unknown;
};

export type TimelineToolInput = {
  cwd?: string;
  projectId?: string;
  timelineId?: string;
  name?: string;
  canvasId?: string;
  nodeId?: string;
  newTimelineId?: string;
  newNodeId?: string;
  state?: Record<string, unknown>;
};

function required(input: TimelineToolInput, key: keyof TimelineToolInput): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${String(key)} is required`);
  }
  return value.trim();
}

function appendProject(args: string[], input: TimelineToolInput): void {
  if (input.projectId?.trim()) args.push("--project", input.projectId.trim());
  args.push("--json");
}

export function buildTimelineCliArgs(
  name: string,
  input: TimelineToolInput,
): string[] {
  const args = ["timeline"];
  switch (name) {
    case "clash_timeline_list":
      args.push("list");
      break;
    case "clash_timeline_create":
      args.push(
        "create",
        "--id",
        required(input, "timelineId"),
        "--name",
        required(input, "name"),
      );
      break;
    case "clash_timeline_attach":
      args.push(
        "attach",
        "--timeline",
        required(input, "timelineId"),
        "--canvas",
        required(input, "canvasId"),
      );
      if (input.nodeId?.trim()) args.push("--node", input.nodeId.trim());
      break;
    case "clash_timeline_detach":
      args.push("detach", "--timeline", required(input, "timelineId"));
      break;
    case "clash_timeline_copy":
      args.push(
        "copy",
        "--timeline",
        required(input, "timelineId"),
        "--canvas",
        required(input, "canvasId"),
      );
      if (input.newTimelineId?.trim()) {
        args.push("--new-timeline", input.newTimelineId.trim());
      }
      if (input.newNodeId?.trim()) args.push("--new-node", input.newNodeId.trim());
      break;
    default:
      throw new Error(`Timeline operation ${name} is not exposed`);
  }
  appendProject(args, input);
  return args;
}
