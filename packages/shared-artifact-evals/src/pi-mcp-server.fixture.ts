import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const toolNames = [
  "clash",
  "clash_canvas",
  "clash_composition",
  "clash_workspace_init",
];

const server = new Server(
  { name: "pi-extension-test", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolNames.map((name) => ({
    name,
    description: `Test ${name} dispatcher`,
    inputSchema: {
      type: "object" as const,
      properties: {
        operation: { type: "string" },
      },
      additionalProperties: true,
    },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify({
        tool: request.params.name,
        arguments: request.params.arguments ?? {},
      }),
    },
  ],
  structuredContent: {
    tool: request.params.name,
    arguments: request.params.arguments ?? {},
  },
}));

await server.connect(new StdioServerTransport());
