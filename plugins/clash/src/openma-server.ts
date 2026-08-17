import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface OpenMaNativeTools {
  searchSkills(input: { query: string; limit: number }): Promise<unknown>;
  readSkill(input: { skill: string }): Promise<unknown>;
  readPluginFile(input: { plugin: string; path: string }): Promise<unknown>;
  browserTabs(input: {
    action: "list" | "new" | "select" | "close";
    url?: string;
    tab_id?: string;
    index?: number;
  }): Promise<unknown>;
  browserNavigate(input: { url: string }): Promise<unknown>;
  browserScreenshot(input: { full_page: boolean }): Promise<{
    media_type: "image/png";
    data: string;
    tab_id: string;
    url: string;
  }>;
  browserClick(input: { selector: string }): Promise<unknown>;
  browserType(input: {
    selector: string;
    text: string;
    submit: boolean;
  }): Promise<unknown>;
  browserGetText(input: { selector?: string; max_chars: number }): Promise<string>;
  browserEval(input: { expression: string }): Promise<unknown>;
  browserClose(): Promise<unknown>;
  listSessions(input: { query?: string; limit?: number }): Promise<unknown>;
  readSession(input: {
    session_id: string;
    after_seq?: number;
    max_chars?: number;
    include_activity?: boolean;
  }): Promise<unknown>;
}

export interface OpenMaMcpServerOptions {
  taskId: string;
  tools: OpenMaNativeTools;
}

function textResult(value: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    }],
  };
}

export function createOpenMaMcpServer(options: OpenMaMcpServerOptions): McpServer {
  const { taskId, tools } = options;
  const server = new McpServer({ name: "openma-native-tools", version: "1.0.0" });

  server.registerTool("plugin_search_skills", {
    title: "Search installed plugin skills",
    description:
      "Search Codex-compatible plugin workflows before starting work that may match an installed skill. Read a matching skill before following it.",
    inputSchema: {
      query: z.string().default(""),
      limit: z.number().int().positive().max(50).optional().default(20),
    },
    annotations: { readOnlyHint: true },
  }, async (input) => textResult(await tools.searchSkills(input)));

  server.registerTool("plugin_read_skill", {
    title: "Read an installed plugin skill",
    description:
      "Read the complete SKILL.md instructions for a matching Codex-compatible plugin skill.",
    inputSchema: { skill: z.string() },
    annotations: { readOnlyHint: true },
  }, async (input) => textResult(await tools.readSkill(input)));

  server.registerTool("plugin_read_file", {
    title: "Read a plugin skill file",
    description:
      "Read a relative reference, script, template, or asset text file from an installed plugin after its SKILL.md asks for it.",
    inputSchema: {
      plugin: z.string(),
      path: z.string(),
    },
    annotations: { readOnlyHint: true },
  }, async (input) => textResult(await tools.readPluginFile(input)));

  server.registerTool("browser_tabs", {
    title: "Browser tabs",
    description: "List, open, select, or close tabs in this task's browser.",
    inputSchema: {
      action: z.enum(["list", "new", "select", "close"]),
      url: z.string().optional(),
      tab_id: z.string().optional(),
      index: z.number().int().nonnegative().optional(),
    },
  }, async (input) => textResult(await tools.browserTabs(input)));

  server.registerTool("browser_navigate", {
    title: "Navigate browser",
    description: "Navigate the active tab in this task's browser.",
    inputSchema: { url: z.string() },
  }, async (input) => textResult(await tools.browserNavigate(input)));

  server.registerTool("browser_screenshot", {
    title: "Screenshot browser",
    description: "Capture the active browser tab as PNG.",
    inputSchema: { full_page: z.boolean().optional().default(false) },
    annotations: { readOnlyHint: true },
  }, async (input) => {
    const result = await tools.browserScreenshot(input);
    return {
      content: [
        { type: "image" as const, mimeType: result.media_type, data: result.data },
        {
          type: "text" as const,
          text: JSON.stringify({ tab_id: result.tab_id, url: result.url }),
        },
      ],
    };
  });

  server.registerTool("browser_click", {
    title: "Click browser element",
    description: "Click a CSS selector, text= label, or :has-text() match in the active tab.",
    inputSchema: { selector: z.string() },
  }, async (input) => textResult(await tools.browserClick(input)));

  server.registerTool("browser_type", {
    title: "Type in browser",
    description: "Type into an editable element in the active browser tab.",
    inputSchema: {
      selector: z.string(),
      text: z.string(),
      submit: z.boolean().optional().default(false),
    },
  }, async (input) => textResult(await tools.browserType(input)));

  server.registerTool("browser_get_text", {
    title: "Read browser text",
    description: "Read visible text from the active browser tab or a matching element.",
    inputSchema: {
      selector: z.string().optional(),
      max_chars: z.number().int().positive().max(100_000).optional().default(30_000),
    },
    annotations: { readOnlyHint: true },
  }, async (input) => ({
    content: [{ type: "text" as const, text: await tools.browserGetText(input) }],
  }));

  server.registerTool("browser_eval", {
    title: "Evaluate browser JavaScript",
    description: "Evaluate JavaScript in the active browser tab and return its result.",
    inputSchema: { expression: z.string() },
  }, async (input) => textResult(await tools.browserEval(input)));

  server.registerTool("browser_close", {
    title: "Close browser tab",
    description: "Close the active tab in this task's browser.",
    inputSchema: {},
  }, async () => textResult(await tools.browserClose()));

  server.registerTool("openma_sessions_list", {
    title: "List OpenMA sessions",
    description: "List other local sessions that can be referenced from the current task.",
    inputSchema: {
      query: z.string().trim().min(1).optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    annotations: { readOnlyHint: true },
  }, async (input) => textResult(await tools.listSessions(input)));

  server.registerTool("openma_sessions_read", {
    title: "Read an OpenMA session",
    description: "Read the user and assistant conversation from another local session by its stable session ID.",
    inputSchema: {
      session_id: z.string().min(1),
      after_seq: z.number().int().nonnegative().optional(),
      max_chars: z.number().int().positive().max(100_000).optional(),
      include_activity: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true },
  }, async (input) => {
    if (input.session_id === taskId) {
      throw new Error("Use the current conversation context instead of reading the current session");
    }
    return textResult(await tools.readSession(input));
  });

  return server;
}
