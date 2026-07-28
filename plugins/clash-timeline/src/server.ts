import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  createTimelineAdapter,
  timelineWorkspaceCwd,
  type TimelineAdapter,
} from "./adapter.js";
import {
  TIMELINE_PLUGIN_TOOL_NAMES,
  type TimelinePluginToolName,
  type TimelineToolInput,
} from "./contract.js";
import {
  createTimelineAppHtml,
  TIMELINE_APP_MIME_TYPE,
  TIMELINE_APP_RESOURCE_URI,
} from "./app.js";

const scope = {
  cwd: z.string().min(1).optional().describe("Absolute project workspace path containing .clash/project.toml"),
  projectId: z.string().min(1).optional().describe("Project ID override; normally resolved from the workspace marker"),
};

const definitions: Record<TimelinePluginToolName, {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations?: Record<string, boolean>;
}> = {
  clash_timeline_open: {
    title: "Open Clash Timeline",
    description: "Open the interactive Timeline GUI. Pass the current task workspace cwd so the plugin resolves the real project.",
    inputSchema: { ...scope, timelineId: z.string().min(1).optional() },
    annotations: { readOnlyHint: true },
  },
  clash_timeline_list: {
    title: "List timelines",
    description: "List Project Timeline entities and their Project or Canvas ownership.",
    inputSchema: scope,
    annotations: { readOnlyHint: true },
  },
  clash_timeline_get: {
    title: "Read timeline",
    description: "Read one Timeline entity, its revision, ownership, tracks, and items.",
    inputSchema: { ...scope, timelineId: z.string().min(1) },
    annotations: { readOnlyHint: true },
  },
  clash_timeline_create: {
    title: "Create timeline",
    description: "Create a standalone Project Timeline through the Clash CLI contract.",
    inputSchema: {
      ...scope,
      timelineId: z.string().min(1),
      name: z.string().min(1),
    },
  },
  clash_timeline_save: {
    title: "Save timeline",
    description: "Read the current Timeline, write its YAML projection, validate it, and apply it with read-proof semantics.",
    inputSchema: {
      ...scope,
      timelineId: z.string().min(1),
      state: z.record(z.string(), z.unknown()),
    },
  },
  clash_timeline_attach: {
    title: "Attach timeline to Canvas",
    description: "Move a standalone Timeline into a Canvas as a Timeline Action.",
    inputSchema: {
      ...scope,
      timelineId: z.string().min(1),
      canvasId: z.string().min(1),
      nodeId: z.string().min(1).optional(),
    },
  },
  clash_timeline_detach: {
    title: "Detach timeline",
    description: "Move a Canvas-owned Timeline back to the Project root.",
    inputSchema: { ...scope, timelineId: z.string().min(1) },
  },
  clash_timeline_copy: {
    title: "Copy timeline",
    description: "Copy a Canvas-owned Timeline Action into another Canvas.",
    inputSchema: {
      ...scope,
      timelineId: z.string().min(1),
      canvasId: z.string().min(1),
      newTimelineId: z.string().min(1).optional(),
      newNodeId: z.string().min(1).optional(),
    },
  },
};

function structured(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { items: value };
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return { value };
}

function summary(name: TimelinePluginToolName, value: unknown): string {
  if (name === "clash_timeline_open") {
    const count = Array.isArray((value as { timelines?: unknown[] })?.timelines)
      ? (value as { timelines: unknown[] }).timelines.length
      : 0;
    return `Opened Clash Timeline with ${count} timeline${count === 1 ? "" : "s"}.`;
  }
  if (name === "clash_timeline_save") return "Timeline projection validated and applied.";
  return JSON.stringify(value);
}

async function invoke(
  name: TimelinePluginToolName,
  input: TimelineToolInput,
  adapter: TimelineAdapter,
): Promise<unknown> {
  switch (name) {
    case "clash_timeline_open": {
      const timelines = await adapter.list(input);
      const selected = input.timelineId
        ? timelines.find((timeline) => timeline.id === input.timelineId)
        : timelines[0];
      if (input.timelineId && !selected) {
        throw new Error(`Timeline ${input.timelineId} not found`);
      }
      return { cwd: timelineWorkspaceCwd(input), timelines, selected };
    }
    case "clash_timeline_list":
      return adapter.list(input);
    case "clash_timeline_get":
      return { timeline: await adapter.get(input) };
    case "clash_timeline_create":
      return adapter.create(input);
    case "clash_timeline_save":
      return adapter.save(input);
    case "clash_timeline_attach":
      return adapter.attach(input);
    case "clash_timeline_detach":
      return adapter.detach(input);
    case "clash_timeline_copy":
      return adapter.copy(input);
  }
}

export function registerTimelinePluginMcp(
  server: Pick<McpServer, "registerTool" | "registerResource">,
  adapter: TimelineAdapter,
  bundledAppJavascript: string,
): void {
  for (const name of TIMELINE_PLUGIN_TOOL_NAMES) {
    const definition = definitions[name];
    registerAppTool(server, name, {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: definition.annotations,
      _meta: {
        ui: {
          ...(name === "clash_timeline_open"
            ? { resourceUri: TIMELINE_APP_RESOURCE_URI }
            : {}),
          visibility: ["model", "app"],
        },
      },
    }, async (input) => {
      try {
        const value = await invoke(name, input as TimelineToolInput, adapter);
        return {
          content: [{ type: "text" as const, text: summary(name, value) }],
          structuredContent: structured(value),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }
    });
  }

  registerAppResource(server, "Clash Timeline", TIMELINE_APP_RESOURCE_URI, {
    description: "Interactive Timeline editor backed by Clash read-proof and apply behavior",
  }, async () => ({
    contents: [{
      uri: TIMELINE_APP_RESOURCE_URI,
      mimeType: TIMELINE_APP_MIME_TYPE,
      text: createTimelineAppHtml(bundledAppJavascript),
      _meta: { ui: { csp: {} } },
    }],
  }));
}

export function createTimelinePluginServer(options: {
  adapter?: TimelineAdapter;
  bundledAppJavascript?: string;
} = {}): McpServer {
  const server = new McpServer({ name: "clash-timeline", version: "0.1.0" });
  const bundledAppJavascript = options.bundledAppJavascript ?? readFileSync(
    new URL("./app-client.js", import.meta.url),
    "utf8",
  );
  registerTimelinePluginMcp(
    server,
    options.adapter ?? createTimelineAdapter(),
    bundledAppJavascript,
  );
  return server;
}

export async function serveTimelinePluginStdio(options: {
  adapter?: TimelineAdapter;
} = {}): Promise<void> {
  const server = createTimelinePluginServer(options);
  await server.connect(new StdioServerTransport());
}
