import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TIMELINE_DSL_DEFINITION } from "@clash/shared-types/timeline-contract";

test("built standalone runtime serves its schema without a global Clash CLI", async () => {
  const { CLASH_CLI_BIN: _ignoredCliOverride, ...isolatedEnv } = process.env;
  const client = new Client({
    name: "clash-timeline-isolation-test",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["runtime/index.js"],
    cwd: new URL("..", import.meta.url).pathname,
    stderr: "pipe",
    env: {
      ...isolatedEnv,
      // Schema/validation are local operations. Pin an explicit inert endpoint
      // so this packaging test cannot discover or bootstrap a user's daemon.
      CLASH_API_URL: "http://127.0.0.1:9",
      PATH: "",
    },
  });

  try {
    await client.connect(transport);
    const rootTools = await client.listTools();
    assert.deepEqual(
      rootTools.tools.map((tool) => tool.name),
      [
        "clash",
        "clash_plugin",
        "clash_assets",
        "clash_canvas",
        "clash_composition",
      ],
    );
    const menu = await client.callTool({
      name: "clash",
      arguments: { command: "timeline" },
    });
    assert.notEqual(menu.isError, true, JSON.stringify(menu));
    assert.equal(
      (menu.structuredContent as { selectedCommand?: unknown })
        ?.selectedCommand,
      "timeline",
    );
    assert.equal(
      (menu.structuredContent as { selectedDispatcher?: unknown })
        ?.selectedDispatcher,
      "clash_composition",
    );
    const disclosure = await client.callTool({
      name: "clash_composition",
      arguments: { kind: "timeline" },
    });
    assert.notEqual(disclosure.isError, true, JSON.stringify(disclosure));
    const timelineTools =
      (
        disclosure.structuredContent as {
          operations?: Array<{
            name: string;
            inputSchema?: Record<string, unknown>;
            outputSchema?: Record<string, unknown>;
            metadata?: Record<string, unknown>;
          }>;
        }
      ).operations ?? [];
    assert.equal(timelineTools.length, 10);
    for (const tool of timelineTools) {
      const operationId = (tool.metadata as any)?.["clash/timelineOperation"]
        ?.id;
      assert.ok(
        operationId,
        `${tool.name} must publish shared operation metadata`,
      );
      assert.equal(
        (tool.outputSchema as any)?.["x-clash-operation-id"],
        operationId,
        `${tool.name} must publish its registry-derived output schema`,
      );
      assert.ok((tool.outputSchema as any)?.properties?.error, tool.name);
    }
    const validateTool = timelineTools.find(
      (tool) => tool.name === "clash_timeline_validate",
    );
    const validateSchema = validateTool?.inputSchema as any;
    assert.ok(
      validateSchema?.properties?.document?.anyOf?.some(
        (variant: any) =>
          variant.type === "object" &&
          variant["x-clash-schema-tool"] === "clash_timeline_schema",
      ),
    );
    assert.equal(validateSchema?.definitions, undefined);
    assert.equal(
      (validateTool?.metadata as any)?.["clash/timelineOperation"]?.id,
      "timeline.validate",
    );
    const saveTool = timelineTools.find(
      (tool) => tool.name === "clash_timeline_save",
    );
    assert.equal(
      (saveTool?.metadata as any)?.["clash/timelineOperation"]?.id,
      "timeline.save",
    );
    assert.equal(
      (saveTool?.inputSchema as any)?.properties?.state?.[
        "x-clash-contract-ref"
      ],
      "TimelineDsl",
    );
    const getTool = timelineTools.find(
      (tool) => tool.name === "clash_timeline_get",
    );
    assert.equal(
      (getTool?.outputSchema as any)?.properties?.timeline?.properties?.state?.[
        "x-clash-contract-ref"
      ],
      "TimelineDsl",
    );
    const callTimeline = (
      operation: string,
      operationArguments: Record<string, unknown> = {},
    ) =>
      client.callTool({
        name: "clash_composition",
        arguments: {
          kind: "timeline",
          operation,
          arguments: operationArguments,
        },
      });
    const result = await callTimeline("schema");
    const structured = result.structuredContent as any;

    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.equal(
      structured?.schemaVersion,
      TIMELINE_DSL_DEFINITION.schemaVersion,
    );
    assert.equal(
      validateSchema?.["x-clash-contract-fingerprint"],
      structured?.contractFingerprint,
    );
    assert.equal(structured?.view, "authoring");
    assert.equal(structured?.operationCatalog, undefined);
    assert.equal(structured?.jsonSchema, undefined);
    assert.equal(structured?.fields?.root?.assetTranscripts, undefined);
    assert.ok(structured?.fields?.itemTypes?.transition?.fromItemId);
    assert.equal(
      structured?.references?.assetId?.target,
      "project-asset",
    );
    assert.equal(
      structured?.references?.sourceNodeId?.target,
      "canvas-node",
    );
    assert.equal(
      structured?.examples?.basic?.state?.tracks?.[1]?.items?.[1]
        ?.sourceNodeId,
      "canvas-component-node-id",
    );

    const fullResult = await callTimeline("schema", { view: "full" });
    const full = fullResult.structuredContent as any;
    assert.notEqual(fullResult.isError, true, JSON.stringify(fullResult));
    assert.equal(
      full?.operationCatalog?.agent?.["timeline.save"]
        ?.surfaceBindings?.[0],
      "mcp:clash_timeline_save",
    );
    assert.ok(full?.fieldCatalog?.root?.fields?.assetTranscripts);
    assert.ok(
      full?.fieldCatalog?.itemTypes?.transition?.fields?.fromItemId,
    );
    assert.ok(
      full?.jsonSchema?.definitions?.TimelineDsl?.properties
        ?.assetTranscripts,
    );
    assert.equal(
      full?.jsonSchema?.definitions?.TimelineDsl?.properties
        ?.mediaAssetRefs,
      undefined,
    );
    assert.deepEqual(
      full?.jsonSchema?.["x-clash-semantic-rules"]?.rules?.find(
        (rule: { id?: unknown }) => rule.id === "timeline.asset.retired-field",
      ),
      {
        id: "timeline.asset.retired-field",
        kind: "forbidden-paths",
        paths: ["mediaAssetRefs", "tracks[].items[].backingAssetId"],
      },
    );
    const authoritativeItemVariants =
      full?.jsonSchema?.definitions?.TimelineDsl?.properties?.tracks
        ?.items?.properties?.items?.items?.anyOf ?? [];
    assert.deepEqual(
      new Set(
        authoritativeItemVariants.map(
          (variant: any) => variant.properties.type.const,
        ),
      ),
      new Set([
        "video",
        "audio",
        "image",
        "solid",
        "text",
        "sticker",
        "composition",
        "derived-overlay",
        "transition",
      ]),
    );
    assert.deepEqual(full?.features?.clipMask?.animatedChannels, [
      "maskPosition",
      "maskSize",
      "maskRotation",
      "maskFeather",
    ]);
    const invalidValidation = await callTimeline("validate", {
      document: {
        tracks: [
          {
            id: "visual",
            items: [
              {
                id: "orphan-mask-keyframe",
                type: "image",
                from: 0,
                durationInFrames: 10,
                sourceNodeId: "asset-node",
                keyframes: { maskPosition: [] },
              },
            ],
          },
        ],
      },
    });
    assert.equal(invalidValidation.isError, true);
    const invalidError = (
      invalidValidation.structuredContent as {
        error?: {
          code?: unknown;
          retryTool?: unknown;
          issues?: Array<{ ruleId?: unknown }>;
        };
      }
    )?.error;
    assert.equal(invalidError?.code, "TIMELINE_DSL_INVALID");
    assert.equal(invalidError?.retryTool, "clash_timeline_schema");
    assert.equal(
      invalidError?.issues?.[0]?.ruleId,
      "timeline.clip-mask.requires-mask",
    );

    for (const document of [
      {
        mediaAssetRefs: [{ assetId: "asset-video" }],
        tracks: [],
      },
      {
        tracks: [
          {
            id: "visual",
            items: [
              {
                id: "retired-backing-asset",
                type: "image",
                from: 0,
                durationInFrames: 10,
                assetId: "asset-image",
                backingAssetId: "storage-row",
              },
            ],
          },
        ],
      },
    ]) {
      const retiredValidation = await callTimeline("validate", { document });
      assert.equal(retiredValidation.isError, true);
      assert.equal(
        (
          retiredValidation.structuredContent as {
            error?: { issues?: Array<{ ruleId?: unknown }> };
          }
        )?.error?.issues?.[0]?.ruleId,
        "timeline.asset.retired-field",
      );
    }

    const invalidStructuralValidation = await callTimeline("validate", {
      document: {
        tracks: [
          {
            id: "visual",
            items: [
              {
                id: "unknown-item",
                type: "mystery",
                from: 0,
                durationInFrames: 10,
              },
            ],
          },
        ],
      },
    });
    assert.equal(invalidStructuralValidation.isError, true);
    assert.equal(
      (
        invalidStructuralValidation.structuredContent as {
          error?: { code?: unknown; retryTool?: unknown };
        }
      )?.error?.code,
      "TIMELINE_DSL_INVALID",
    );
    assert.equal(
      (
        invalidStructuralValidation.structuredContent as {
          error?: { code?: unknown; retryTool?: unknown };
        }
      )?.error?.retryTool,
      "clash_timeline_schema",
    );
  } finally {
    await client.close().catch(() => undefined);
  }
});
