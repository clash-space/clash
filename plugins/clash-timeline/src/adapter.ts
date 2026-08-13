import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  TIMELINE_DSL_DEFINITION,
  validateTimelineDsl,
} from "@clash/shared-types/timeline-contract";
import type { ProjectHostCommand } from "@clash/shared-types";
import { parse as parseYaml } from "yaml";
import {
  createProjectHostClient,
  type ProjectHostClient,
  type ProjectHostResponse,
} from "@clash/shared-runtime/project-host-client";
import type { TimelineEntity, TimelineToolInput } from "./contract.js";
import { assertTimelineState } from "./timeline-contract-adapter.js";

export type TimelineProjectionWriter = (path: string, content: string) => Promise<void>;

export type TimelineAdapter = {
  schema(input: TimelineToolInput): Promise<Record<string, unknown>>;
  validate(input: TimelineToolInput): Promise<Record<string, unknown>>;
  list(input: TimelineToolInput): Promise<TimelineEntity[]>;
  get(input: TimelineToolInput): Promise<TimelineEntity>;
  create(input: TimelineToolInput): Promise<unknown>;
  save(input: TimelineToolInput): Promise<Record<string, unknown>>;
  attach(input: TimelineToolInput): Promise<unknown>;
  detach(input: TimelineToolInput): Promise<unknown>;
  copy(input: TimelineToolInput): Promise<unknown>;
  render(input: TimelineToolInput): Promise<Record<string, unknown>>;
};

export function timelineWorkspaceCwd(input: TimelineToolInput): string {
  const candidate = input.cwd?.trim()
    || process.env.CLASH_WORKSPACE_ROOT
    || process.env.CODEX_WORKSPACE_ROOT
    || process.cwd();
  return isAbsolute(candidate) ? candidate : resolve(candidate);
}

function projectionSegment(timelineId: string): string {
  return timelineId.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "") || "timeline";
}

function required(input: TimelineToolInput, key: keyof TimelineToolInput): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${String(key)} is required`);
  return value.trim();
}

function hostValue(value: ProjectHostResponse): ProjectHostResponse {
  if (!value.error) return value;
  const code = typeof value.code === "string" ? `${value.code}: ` : "";
  throw new Error(`${code}${value.error}`);
}

async function writeTimelineProjection(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

/** Timeline MCP adapter backed directly by the neutral local-api client. */
export function createTimelineAdapter(options: {
  client?: ProjectHostClient;
  writeProjection?: TimelineProjectionWriter;
} = {}): TimelineAdapter {
  const client = options.client ?? createProjectHostClient();
  const writeProjection = options.writeProjection ?? writeTimelineProjection;
  const observations = new Map<string, { receipt: string; revisionId?: string }>();
  const context = (input: TimelineToolInput) => client.resolveContext({
    cwd: input.cwd,
    projectId: input.projectId,
  });
  const observationKey = (projectId: string, timelineId: string) => `${projectId}\0${timelineId}`;
  const request = async (input: TimelineToolInput, command: ProjectHostCommand) => {
    const result = await client.request({
      cwd: input.cwd,
      projectId: input.projectId,
      command,
    });
    return { projectId: result.projectId, value: hostValue(result.value) };
  };
  const requireObservation = async (input: TimelineToolInput, timelineId: string) => {
    const resolved = await context(input);
    const observation = observations.get(observationKey(resolved.projectId, timelineId));
    if (!observation) {
      throw new Error(
        `READ_REQUIRED: Read Timeline ${timelineId} with clash_timeline_get before mutating it.`,
      );
    }
    return observation;
  };

  const list = async (input: TimelineToolInput): Promise<TimelineEntity[]> => {
    const { projectId, value } = await request(input, { action: "list_timelines" });
    const timelines = Array.isArray(value.timelines)
      ? value.timelines.filter((entry): entry is TimelineEntity => Boolean(
          entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string",
        ))
      : [];
    const versions = value.versions && typeof value.versions === "object"
      ? value.versions as Record<string, unknown>
      : {};
    for (const timeline of timelines) {
      const receipt = versions[timeline.id];
      if (typeof receipt === "string") {
        observations.set(observationKey(projectId, timeline.id), {
          receipt,
          ...(timeline.revisionId ? { revisionId: timeline.revisionId } : {}),
        });
      }
    }
    return input.standalone
      ? timelines.filter((timeline) => timeline.owner?.kind === "project")
      : timelines;
  };

  const get = async (input: TimelineToolInput): Promise<TimelineEntity> => {
    const timelineId = required(input, "timelineId");
    const timeline = (await list(input)).find((candidate) => candidate.id === timelineId);
    if (!timeline) throw new Error(`Timeline ${timelineId} not found`);
    return timeline;
  };

  const mutation = async (
    input: TimelineToolInput,
    timelineId: string,
    command: Record<string, unknown> & { action: ProjectHostCommand["action"] },
  ) => {
    const observed = await requireObservation(input, timelineId);
    const result = await request(input, {
      ...command,
      actorClientType: "mcp",
      observedVersion: observed.receipt,
      ifMatch: observed.receipt,
    } as ProjectHostCommand);
    const receipt = typeof result.value.readToken === "string"
      ? result.value.readToken
      : typeof result.value.version === "string"
        ? result.value.version
        : undefined;
    const entity = (result.value.timeline && typeof result.value.timeline === "object")
      ? result.value.timeline as { revisionId?: unknown }
      : undefined;
    if (receipt) {
      observations.set(observationKey(result.projectId, timelineId), {
        receipt,
        ...(typeof entity?.revisionId === "string" ? { revisionId: entity.revisionId } : {}),
      });
    }
    return result.value;
  };

  return {
    schema: async () => structuredClone(TIMELINE_DSL_DEFINITION) as unknown as Record<string, unknown>,
    async validate(input) {
      const document = input.document ?? input.state;
      let state: unknown = document;
      if (typeof document === "string") {
        if (input.format === "json") state = JSON.parse(document);
        else {
          try {
            state = parseYaml(document);
          } catch (error) {
            throw new Error(
              `TIMELINE_DSL_INVALID: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      if (!state || typeof state !== "object" || Array.isArray(state)) {
        throw new Error("document must be Timeline YAML, JSON, or an object");
      }
      assertTimelineState(state);
      const validation = validateTimelineDsl(state);
      if (!validation.ok) {
        throw new Error(`TIMELINE_DSL_INVALID: ${validation.issues[0]?.message ?? "invalid Timeline"}`);
      }
      return (await request(input, { action: "validate_timeline", document: state })).value;
    },
    list,
    get,
    async create(input) {
      const result = await request(input, {
        action: "create_timeline",
        timelineId: required(input, "timelineId"),
        name: required(input, "name"),
      });
      return result.value;
    },
    async save(input) {
      const timelineId = required(input, "timelineId");
      const baseRevisionId = required(input, "baseRevisionId");
      if (!input.state || typeof input.state !== "object" || Array.isArray(input.state)) {
        throw new Error("state must be a Timeline object");
      }
      assertTimelineState(input.state);
      const observed = await requireObservation(input, timelineId);
      if (observed.revisionId && observed.revisionId !== baseRevisionId) {
        throw new Error(`STALE_READ: Timeline ${timelineId} was read at ${observed.revisionId}, not ${baseRevisionId}`);
      }
      const filePath = join(
        timelineWorkspaceCwd(input),
        "timelines",
        `${projectionSegment(timelineId)}.timeline.yaml`,
      );
      await writeProjection(filePath, `${JSON.stringify(input.state, null, 2)}\n`);
      return mutation(input, timelineId, {
        action: "update_timeline_state",
        timelineId,
        state: input.state,
      });
    },
    attach(input) {
      const timelineId = required(input, "timelineId");
      return mutation(input, timelineId, {
        action: "attach_timeline",
        timelineId,
        canvasId: required(input, "canvasId"),
        ...(input.nodeId?.trim() ? { actionNodeId: input.nodeId.trim() } : {}),
        ...(input.position ? { position: input.position } : {}),
      });
    },
    detach(input) {
      const timelineId = required(input, "timelineId");
      return mutation(input, timelineId, { action: "detach_timeline", timelineId });
    },
    copy(input) {
      const timelineId = required(input, "timelineId");
      return mutation(input, timelineId, {
        action: "copy_timeline_action",
        sourceTimelineId: timelineId,
        targetCanvasId: required(input, "canvasId"),
        ...(input.newTimelineId?.trim() ? { newTimelineId: input.newTimelineId.trim() } : {}),
        ...(input.newNodeId?.trim() ? { newActionNodeId: input.newNodeId.trim() } : {}),
        ...(input.position ? { position: input.position } : {}),
      });
    },
    async render(input) {
      const timelineId = required(input, "timelineId");
      const submitted = await mutation(input, timelineId, {
        action: "request_timeline_render",
        timelineId,
      });
      if (
        typeof submitted.renderNodeId !== "string"
        || typeof submitted.sourceTimelineRevisionId !== "string"
        || !submitted.target
      ) throw new Error("Timeline render request failed");
      const base = {
        submitted: true,
        timelineId,
        sourceTimelineRevisionId: submitted.sourceTimelineRevisionId,
        renderNodeId: submitted.renderNodeId,
        target: submitted.target,
      };
      if (input.wait === false) return { ...base, completed: false, status: "pending" };
      const deadline = Date.now() + (input.timeoutMs ?? 1_800_000);
      while (true) {
        const polled = await request(input, {
          action: "get",
          canvasId: "__project_assets__",
          nodeId: submitted.renderNodeId,
        });
        const data = polled.value.node && typeof polled.value.node === "object"
          ? (polled.value.node as { data?: Record<string, unknown> }).data ?? {}
          : {};
        if (data.status === "completed" && typeof data.assetId === "string") {
          return { ...base, completed: true, status: "completed", asset: { id: data.assetId } };
        }
        if (data.status === "failed") {
          return {
            ...base,
            completed: false,
            status: "failed",
            ...(typeof data.error === "string" ? { error: data.error } : {}),
          };
        }
        if (Date.now() >= deadline) return { ...base, completed: false, status: "pending" };
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 100));
      }
    },
  };
}
