import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import piClashExtension, {
  type PiExtensionApi,
  type PiExtensionToolDefinition,
  projectStructuredContentForPi,
} from "./pi-clash-extension";

describe("Pi Clash extension", () => {
  it("projects verbose Clash contracts to the model-relevant schema", () => {
    expect(
      projectStructuredContentForPi({
        schemaVersion: 5,
        format: "clash.timeline.yaml",
        fieldCatalog: { root: { fields: { fps: { required: true } } } },
        operationCatalog: { redundantRuntimeMetadata: "x".repeat(10_000) },
        jsonSchema: { type: "object", required: ["tracks"] },
        features: { remotion: true },
      }),
    ).toEqual({
      schemaVersion: 5,
      format: "clash.timeline.yaml",
      fieldCatalog: { root: { fields: { fps: { required: true } } } },
      jsonSchema: { type: "object", required: ["tracks"] },
      features: { remotion: true },
    });
  });

  it("projects singular and batched dispatcher contracts through the same compact operation shape", () => {
    const verboseContract = {
      name: "clash_timeline_create",
      operation: "create",
      title: "Create Timeline",
      description: "Create a persisted Timeline.",
      readOnly: false,
      destructive: false,
      inputSchema: {
        type: "object",
        properties: { timelineId: { type: "string" } },
        required: ["timelineId"],
      },
      outputSchema: { redundantOutputMetadata: "x".repeat(10_000) },
      recovery: { guidance: "Read the created Timeline." },
      metadata: { redundantRuntimeMetadata: "x".repeat(10_000) },
    };
    const projectedContract = {
      name: "clash_timeline_create",
      operation: "create",
      title: "Create Timeline",
      description: "Create a persisted Timeline.",
      readOnly: false,
      destructive: false,
      inputSchema: verboseContract.inputSchema,
      recovery: { guidance: "Read the created Timeline." },
    };

    expect(
      projectStructuredContentForPi({
        schemaVersion: 1,
        selectedCommand: "timeline",
        contract: verboseContract,
      }),
    ).toEqual({
      schemaVersion: 1,
      selectedCommand: "timeline",
      contract: projectedContract,
    });
    expect(
      projectStructuredContentForPi({
        schemaVersion: 1,
        selectedCommand: "timeline",
        contracts: [verboseContract],
      }),
    ).toEqual({
      schemaVersion: 1,
      selectedCommand: "timeline",
      contracts: [projectedContract],
    });
  });

  it("projects a matching dispatcher operation index through the compact operation shape", () => {
    const index = {
      schemaVersion: 1,
      selectedCommand: "canvas",
      commands: [{ id: "canvas", title: "Canvas" }],
      operations: [
        {
          name: "clash_canvas_get",
          operation: "get",
          title: "Read Canvas node",
          description: "Read one Canvas node.",
          readOnly: true,
          destructive: false,
          inputSchema: { type: "object", required: ["nodeId"] },
          outputSchema: { redundantOutputMetadata: "x".repeat(10_000) },
          metadata: { redundantRuntimeMetadata: "x".repeat(10_000) },
        },
      ],
    };

    expect(projectStructuredContentForPi(index)).toEqual({
      schemaVersion: 1,
      selectedCommand: "canvas",
      commands: index.commands,
      operations: [
        {
          name: "clash_canvas_get",
          operation: "get",
          title: "Read Canvas node",
          description: "Read one Canvas node.",
          readOnly: true,
          destructive: false,
          inputSchema: { type: "object", required: ["nodeId"] },
        },
      ],
    });
  });

  it("keeps business and cross-family operation arrays intact", () => {
    const businessResult = {
      operations: [{ id: "render-output-1", status: "ready" }],
      timeline: { id: "timeline-product-readback" },
    };
    const crossFamilyIndex = {
      schemaVersion: 1,
      selectedCommand: "canvas",
      operations: [
        {
          name: "clash_assets_get",
          operation: "get",
          title: "Read Asset",
          readOnly: true,
          destructive: false,
        },
      ],
      canvas: { id: "canvas-product-readback" },
    };

    expect(projectStructuredContentForPi(businessResult)).toEqual(
      businessResult,
    );
    expect(projectStructuredContentForPi(crossFamilyIndex)).toEqual(
      crossFamilyIndex,
    );
  });

  it("keeps a Timeline get leaf result with its business contract intact", () => {
    const timelineGetResult = {
      timeline: {
        id: "timeline-product-readback",
        name: "Product readback",
        state: { fps: 24, tracks: [] },
      },
      contract: {
        schemaVersion: 1,
        contractFingerprint: "timeline-contract-v1",
      },
      validation: { ok: true, issues: [] },
    };

    expect(projectStructuredContentForPi(timelineGetResult)).toEqual(
      timelineGetResult,
    );
  });

  it("keeps malformed contract disclosure-shaped fields in a leaf result intact", () => {
    const leafResult = {
      selectedCommand: "timeline",
      contract: { schemaVersion: 1, contractFingerprint: "business-value" },
      contracts: [{ id: "render-output-1" }],
      timeline: { id: "timeline-product-readback" },
    };

    expect(projectStructuredContentForPi(leafResult)).toEqual(leafResult);
  });

  it("keeps a contract whose Clash family does not match the selected dispatcher", () => {
    const leafResult = {
      schemaVersion: 1,
      selectedCommand: "timeline",
      contract: {
        name: "clash_assets_receipt",
        operation: "save",
        inputSchema: { type: "object" },
      },
      timeline: { id: "timeline-product-readback" },
    };

    expect(projectStructuredContentForPi(leafResult)).toEqual(leafResult);
  });

  it("registers live Clash MCP tools and executes them over stdio", async () => {
    const sourceRoot = dirname(fileURLToPath(import.meta.url));
    const previousRuntime = process.env.CLASH_PI_MCP_RUNTIME_PATH;
    const previousPluginRoot = process.env.CLASH_PI_MCP_PLUGIN_ROOT;
    process.env.CLASH_PI_MCP_RUNTIME_PATH = join(
      sourceRoot,
      "pi-mcp-server.fixture.ts",
    );
    process.env.CLASH_PI_MCP_PLUGIN_ROOT = dirname(sourceRoot);

    const tools = new Map<string, PiExtensionToolDefinition>();
    let shutdown: (() => Promise<void> | void) | undefined;
    const pi: PiExtensionApi = {
      registerTool(tool) {
        tools.set(tool.name, tool);
      },
      on(event, handler) {
        if (event === "session_shutdown") shutdown = handler;
      },
    };

    try {
      await piClashExtension(pi);
      expect([...tools.keys()]).toEqual([
        "clash",
        "clash_canvas",
        "clash_composition",
        "clash_workspace_init",
      ]);

      const result = await tools
        .get("clash_composition")!
        .execute(
          "pi-tool-call",
          { operation: "clash_timeline_create" },
          undefined,
        );
      expect(result.content).toEqual([
        {
          type: "text",
          text: JSON.stringify({
            tool: "clash_composition",
            arguments: { operation: "clash_timeline_create" },
          }),
        },
        {
          type: "text",
          text: `Structured result:\n${JSON.stringify({
            tool: "clash_composition",
            arguments: { operation: "clash_timeline_create" },
          })}`,
        },
      ]);
      expect(result.details).toMatchObject({
        structuredContent: {
          tool: "clash_composition",
          arguments: { operation: "clash_timeline_create" },
        },
      });
    } finally {
      await shutdown?.();
      if (previousRuntime === undefined) {
        delete process.env.CLASH_PI_MCP_RUNTIME_PATH;
      } else {
        process.env.CLASH_PI_MCP_RUNTIME_PATH = previousRuntime;
      }
      if (previousPluginRoot === undefined) {
        delete process.env.CLASH_PI_MCP_PLUGIN_ROOT;
      } else {
        process.env.CLASH_PI_MCP_PLUGIN_ROOT = previousPluginRoot;
      }
    }
  });
});
