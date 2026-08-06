import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("built standalone runtime serves its schema without a global Clash CLI", async () => {
  const { CLASH_CLI_BIN: _ignoredCliOverride, ...isolatedEnv } = process.env;
  const client = new Client({ name: "clash-timeline-isolation-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["runtime/index.js"],
    cwd: new URL("..", import.meta.url).pathname,
    stderr: "pipe",
    env: {
      ...isolatedEnv,
      PATH: "",
    },
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    for (const tool of tools.tools) {
      const operationId = (tool._meta as any)?.["clash/timelineOperation"]?.id;
      assert.ok(operationId, `${tool.name} must publish shared operation metadata`);
      assert.equal(
        (tool.outputSchema as any)?.["x-clash-operation-id"],
        operationId,
        `${tool.name} must publish its registry-derived output schema`,
      );
      assert.ok((tool.outputSchema as any)?.properties?.error, tool.name);
    }
    const validateTool = tools.tools.find((tool) => tool.name === "clash_timeline_validate");
    const validateSchema = validateTool?.inputSchema as any;
    assert.ok(validateSchema?.properties?.document?.anyOf?.some(
      (variant: any) => variant.$ref === "#/definitions/TimelineDsl",
    ));
    assert.ok(validateSchema?.definitions?.TimelineDsl?.properties?.assetTranscripts);
    assert.ok(validateSchema?.definitions?.TimelineDsl?.properties?.mediaAssetRefs);
    const publicItemVariants = validateSchema?.definitions?.TimelineDsl
      ?.properties?.tracks?.items?.properties?.items?.items?.anyOf ?? [];
    assert.deepEqual(
      new Set(publicItemVariants.map((variant: any) => variant.properties.type.const)),
      new Set([
        "video", "audio", "image", "solid", "text", "sticker",
        "composition", "derived-overlay", "transition",
      ]),
    );
    assert.ok(publicItemVariants.find(
      (variant: any) => variant.properties.type.const === "transition",
    )?.properties?.fromItemId);
    assert.equal(
      (validateTool?._meta as any)?.["clash/timelineOperation"]?.id,
      "timeline.validate",
    );
    const saveTool = tools.tools.find((tool) => tool.name === "clash_timeline_save");
    assert.equal(
      (saveTool?._meta as any)?.["clash/timelineOperation"]?.id,
      "timeline.save",
    );
    assert.equal(
      (saveTool?.inputSchema as any)?.properties?.state?.$ref,
      "#/definitions/TimelineDsl",
    );
    const getTool = tools.tools.find((tool) => tool.name === "clash_timeline_get");
    assert.equal(
      (getTool?.outputSchema as any)?.properties?.timeline?.properties?.state?.$ref,
      "#/definitions/TimelineDsl",
    );
    const result = await client.callTool({
      name: "clash_timeline_schema",
      arguments: {},
    });
    const structured = result.structuredContent as any;

    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.equal(structured?.schemaVersion, 3);
    assert.equal(
      validateSchema?.["x-clash-contract-fingerprint"],
      structured?.contractFingerprint,
    );
    assert.equal(
      structured?.operationCatalog?.agent?.["timeline.save"]?.surfaceBindings?.[0],
      "mcp:clash_timeline_save",
    );
    assert.ok(structured?.fieldCatalog?.root?.fields?.assetTranscripts);
    assert.ok(structured?.fieldCatalog?.itemTypes?.transition?.fields?.fromItemId);
    assert.deepEqual(
      structured?.features?.clipMask?.animatedChannels,
      ["maskPosition", "maskSize", "maskRotation", "maskFeather"],
    );
    const validation = await client.callTool({
      name: "clash_timeline_validate",
      arguments: {
        document: {
          tracks: [{
            id: "visual",
            items: [{
              id: "masked-image",
              type: "image",
              from: 0,
              durationInFrames: 10,
              sourceNodeId: "asset-node",
              mask: {
                shape: "ellipse",
                position: [50, 50],
                size: [70, 70],
                rotation: 0,
                feather: 0,
                inverted: false,
              },
              keyframes: {
                maskFeather: [
                  { frame: 0, value: 0, interpolation: "linear" },
                  { frame: 9, value: 20, interpolation: "linear" },
                ],
              },
            }],
          }],
        },
      },
    });
    assert.notEqual(validation.isError, true, JSON.stringify(validation));
    assert.equal((validation.structuredContent as { ok?: unknown })?.ok, true);

    const invalidValidation = await client.callTool({
      name: "clash_timeline_validate",
      arguments: {
        document: {
          tracks: [{
            id: "visual",
            items: [{
              id: "orphan-mask-keyframe",
              type: "image",
              from: 0,
              durationInFrames: 10,
              sourceNodeId: "asset-node",
              keyframes: { maskPosition: [] },
            }],
          }],
        },
      },
    });
    assert.equal(invalidValidation.isError, true);
    const invalidError = (invalidValidation.structuredContent as {
      error?: {
        code?: unknown;
        retryTool?: unknown;
        issues?: Array<{ ruleId?: unknown }>;
      };
    })?.error;
    assert.equal(invalidError?.code, "TIMELINE_DSL_INVALID");
    assert.equal(invalidError?.retryTool, "clash_timeline_schema");
    assert.equal(
      invalidError?.issues?.[0]?.ruleId,
      "timeline.clip-mask.requires-mask",
    );

    const invalidStructuralValidation = await client.callTool({
      name: "clash_timeline_validate",
      arguments: {
        document: {
          tracks: [{
            id: "visual",
            items: [{
              id: "unknown-item",
              type: "mystery",
              from: 0,
              durationInFrames: 10,
            }],
          }],
        },
      },
    });
    assert.equal(invalidStructuralValidation.isError, true);
    assert.equal(
      (invalidStructuralValidation.structuredContent as {
        error?: { code?: unknown; retryTool?: unknown };
      })?.error?.code,
      "TIMELINE_DSL_INVALID",
    );
    assert.equal(
      (invalidStructuralValidation.structuredContent as {
        error?: { code?: unknown; retryTool?: unknown };
      })?.error?.retryTool,
      "clash_timeline_schema",
    );
  } finally {
    await client.close().catch(() => undefined);
  }
});
