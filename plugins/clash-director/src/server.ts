import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  createDirectorAdapter,
  directorWorkspaceCwd,
  type DirectorAdapter,
} from "./adapter.js";
import {
  DIRECTOR_PLUGIN_TOOL_NAMES,
  type DirectorPluginToolName,
  type DirectorToolInput,
} from "./contract.js";
import {
  createDirectorAppHtml,
  DIRECTOR_APP_MIME_TYPE,
  DIRECTOR_APP_RESOURCE_URI,
} from "./app.js";

export { DIRECTOR_PLUGIN_TOOL_NAMES } from "./contract.js";

const scope = {
  cwd: z.string().min(1).optional().describe("Absolute workspace path containing .clash/project.toml"),
  projectId: z.string().min(1).optional().describe("Optional Project ID override"),
};
const stageScope = { ...scope, stageId: z.string().min(1) };
const record = z.record(z.string(), z.unknown());

const definitions: Record<DirectorPluginToolName, {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations?: Record<string, boolean>;
}> = {
  clash_director_open: {
    title: "Open Clash Director",
    description: "Open the interactive Director Stage GUI using the real project workspace.",
    inputSchema: { ...scope, stageId: z.string().min(1).optional() },
    annotations: { readOnlyHint: true },
  },
  clash_director_list: {
    title: "List Director Stages",
    description: "List Project Director Stage entities and ownership.",
    inputSchema: scope,
    annotations: { readOnlyHint: true },
  },
  clash_director_get: {
    title: "Read Director Stage",
    description: "Read a Stage revision, scene, objects, cameras, shots, and animation.",
    inputSchema: stageScope,
    annotations: { readOnlyHint: true },
  },
  clash_director_create: {
    title: "Create Director Stage",
    description: "Create a standalone Project Director Stage.",
    inputSchema: { ...stageScope, name: z.string().min(1) },
  },
  clash_director_save: {
    title: "Save Director Stage",
    description: "Read, write the canonical JSON projection, validate, and apply with read proof.",
    inputSchema: { ...stageScope, state: record },
  },
  clash_director_attach: {
    title: "Attach Director Stage",
    description: "Attach a standalone Stage to one Canvas Action.",
    inputSchema: { ...stageScope, canvasId: z.string().min(1), nodeId: z.string().min(1).optional() },
  },
  clash_director_detach: {
    title: "Detach Director Stage",
    description: "Move a Canvas-owned Stage back to the Project root.",
    inputSchema: stageScope,
  },
  clash_director_object_add: {
    title: "Add 3D object",
    description: "Add a mannequin, primitive, crowd, or uploaded model.",
    inputSchema: { ...stageScope, object: record },
  },
  clash_director_object_update: {
    title: "Update 3D object",
    description: "Update an object's name, visibility, color, or transform.",
    inputSchema: { ...stageScope, objectId: z.string().min(1), patch: record },
  },
  clash_director_object_remove: {
    title: "Remove 3D object",
    description: "Remove an object and clear dependent targets/tracks.",
    inputSchema: { ...stageScope, objectId: z.string().min(1) },
  },
  clash_director_object_group: {
    title: "Group 3D objects",
    description: "Assign multiple objects to a Stage group.",
    inputSchema: { ...stageScope, groupId: z.string().min(1), objectIds: z.array(z.string().min(1)).min(1) },
  },
  clash_director_object_ungroup: {
    title: "Ungroup 3D objects",
    description: "Remove a group assignment from its objects.",
    inputSchema: { ...stageScope, groupId: z.string().min(1) },
  },
  clash_director_camera_add: {
    title: "Add camera",
    description: "Add a persisted camera with pose, FOV, and optional target.",
    inputSchema: { ...stageScope, camera: record },
  },
  clash_director_camera_update: {
    title: "Update camera",
    description: "Update a camera name, FOV, or follow target.",
    inputSchema: { ...stageScope, cameraId: z.string().min(1), patch: record },
  },
  clash_director_camera_remove: {
    title: "Remove camera",
    description: "Remove a camera that has no captured shots.",
    inputSchema: { ...stageScope, cameraId: z.string().min(1) },
  },
  clash_director_scene_update: {
    title: "Update 3D scene",
    description: "Update background, panorama asset, grid visibility, snap, or scale.",
    inputSchema: { ...stageScope, scene: record },
  },
  clash_director_keyframe_upsert: {
    title: "Upsert keyframe",
    description: "Insert or replace an object/camera property keyframe.",
    inputSchema: { ...stageScope, keyframe: record },
  },
  clash_director_keyframe_remove: {
    title: "Remove keyframe",
    description: "Remove an object/camera property keyframe and prune an empty track.",
    inputSchema: { ...stageScope, keyframe: record },
  },
  clash_director_action_upsert: {
    title: "Upsert action clip",
    description: "Insert or replace a timed mannequin or rigged-model action clip.",
    inputSchema: { ...stageScope, action: record },
  },
  clash_director_action_remove: {
    title: "Remove action clip",
    description: "Remove a timed action clip from the Director Stage.",
    inputSchema: { ...stageScope, actionId: z.string().min(1) },
  },
};

function structured(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { items: value };
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return { value };
}

async function invoke(
  name: DirectorPluginToolName,
  input: DirectorToolInput,
  adapter: DirectorAdapter,
): Promise<unknown> {
  switch (name) {
    case "clash_director_open": {
      const stages = await adapter.list(input);
      const selected = input.stageId
        ? stages.find((stage) => stage.id === input.stageId)
        : stages[0];
      if (input.stageId && !selected) throw new Error(`Director Stage ${input.stageId} not found`);
      return { cwd: directorWorkspaceCwd(input), stages, selected };
    }
    case "clash_director_list": return adapter.list(input);
    case "clash_director_get": return { stage: await adapter.get(input) };
    case "clash_director_create": return adapter.create(input);
    case "clash_director_save": return adapter.save(input);
    case "clash_director_attach": return adapter.attach(input);
    case "clash_director_detach": return adapter.detach(input);
    default: return adapter.mutate(name, input);
  }
}

function summary(name: DirectorPluginToolName, value: unknown): string {
  if (name === "clash_director_open") {
    const count = Array.isArray((value as { stages?: unknown[] })?.stages)
      ? (value as { stages: unknown[] }).stages.length
      : 0;
    return `Opened Clash Director with ${count} Stage${count === 1 ? "" : "s"}.`;
  }
  if (name === "clash_director_save") return "Director Stage projection validated and applied.";
  return JSON.stringify(value);
}

export function registerDirectorPluginMcp(
  server: Pick<McpServer, "registerTool" | "registerResource">,
  adapter: DirectorAdapter,
  bundledAppJavascript: string,
  options: { appSurfaces?: boolean } = {},
): void {
  const appSurfaces = options.appSurfaces ?? false;
  for (const name of DIRECTOR_PLUGIN_TOOL_NAMES) {
    if (!appSurfaces && name === "clash_director_open") continue;
    const definition = definitions[name];
    registerAppTool(server, name, {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: definition.annotations,
      _meta: {
        ui: {
          ...(name === "clash_director_open"
            ? { resourceUri: DIRECTOR_APP_RESOURCE_URI }
            : {}),
          visibility: ["model", "app"],
        },
      },
    }, async (input) => {
      try {
        const value = await invoke(name, input as DirectorToolInput, adapter);
        return {
          content: [{ type: "text" as const, text: summary(name, value) }],
          structuredContent: structured(value),
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    });
  }

  if (appSurfaces) registerAppResource(server, "Clash Director", DIRECTOR_APP_RESOURCE_URI, {
    description: "Interactive Director Stage editor backed by Clash read-proof and projection apply behavior",
  }, async () => ({
    contents: [{
      uri: DIRECTOR_APP_RESOURCE_URI,
      mimeType: DIRECTOR_APP_MIME_TYPE,
      text: createDirectorAppHtml(bundledAppJavascript),
      _meta: { ui: { csp: {} } },
    }],
  }));
}

export function createDirectorPluginServer(options: {
  adapter?: DirectorAdapter;
  bundledAppJavascript?: string;
} = {}): McpServer {
  const server = new McpServer({ name: "clash-director", version: "0.1.0" });
  const javascript = options.bundledAppJavascript ?? readFileSync(new URL("./app-client.js", import.meta.url), "utf8");
  registerDirectorPluginMcp(server, options.adapter ?? createDirectorAdapter(), javascript);
  return server;
}

export async function serveDirectorPluginStdio(options: { adapter?: DirectorAdapter } = {}): Promise<void> {
  await createDirectorPluginServer(options).connect(new StdioServerTransport());
}
