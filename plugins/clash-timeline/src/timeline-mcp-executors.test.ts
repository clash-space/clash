import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  TIMELINE_DSL_DEFINITION,
} from "@clash/shared-types/timeline-contract";

async function executorModule(): Promise<Record<string, any>> {
  return import("./timeline-mcp-executors.js").catch(() => ({}));
}

function sharedMcpOperationIds(): string[] {
  return Object.values(TIMELINE_DSL_DEFINITION.operationCatalog.agent)
    .filter((operation) => operation.surfaceBindings?.some(
      (binding) => binding.startsWith("mcp:"),
    ))
    .map((operation) => operation.id);
}

test("binds every and only shared MCP operation to one typed executor", async () => {
  const module = await executorModule();
  assert.equal(typeof module.assertTimelineMcpExecutorCoverage, "function");

  assert.deepEqual(
    Object.keys(module.TIMELINE_MCP_EXECUTORS ?? {}),
    sharedMcpOperationIds(),
  );
  module.assertTimelineMcpExecutorCoverage();

  for (const [operationId, executor] of Object.entries(
    module.TIMELINE_MCP_EXECUTORS as Record<string, any>,
  )) {
    assert.equal(typeof executor.execute, "function", operationId);
    assert.equal(typeof executor.summary, "function", operationId);
    assert.ok(executor.inputSchema, operationId);
    assert.ok(executor.outputSchema, operationId);
  }
});

test("projects every MCP input schema from the shared operation catalog plus transport scope", async () => {
  const module = await executorModule();
  const operationCatalog = TIMELINE_DSL_DEFINITION.operationCatalog.agent as Record<
    string,
    { inputJsonSchema: Record<string, any> }
  >;

  for (const [operationId, executor] of Object.entries(
    module.TIMELINE_MCP_EXECUTORS as Record<string, any>,
  )) {
    assert.ok(executor.inputSchema instanceof z.ZodType, operationId);
    const publicSchema = z.toJSONSchema(executor.inputSchema) as Record<string, any>;
    const sharedSchema = operationCatalog[operationId].inputJsonSchema;
    assert.deepEqual(
      Object.keys(publicSchema.properties ?? {}),
      [...Object.keys(sharedSchema.properties ?? {}), "cwd", "projectId"],
      operationId,
    );
    assert.deepEqual(publicSchema.required ?? [], sharedSchema.required ?? [], operationId);
    assert.equal(publicSchema.additionalProperties, false, operationId);
    assert.equal(publicSchema["x-clash-operation-id"], operationId, operationId);
  }

  const createSchema = z.toJSONSchema(
    module.TIMELINE_MCP_EXECUTORS["timeline.create"].inputSchema,
  ) as Record<string, any>;
  assert.ok(createSchema.properties.id);
  assert.equal(createSchema.properties.timelineId, undefined);

  const validateSchema = z.toJSONSchema(
    module.TIMELINE_MCP_EXECUTORS["timeline.validate"].inputSchema,
  ) as Record<string, any>;
  assert.ok(validateSchema.properties.document);
  assert.equal(validateSchema.properties.state, undefined);
});

function timelineStateSchemas(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(timelineStateSchemas);
  const record = value as Record<string, unknown>;
  const properties = record.properties && typeof record.properties === "object"
    && !Array.isArray(record.properties)
    ? record.properties as Record<string, unknown>
    : undefined;
  return [
    ...(properties?.state && properties.id && properties.name && properties.owner
      ? [properties.state as Record<string, unknown>]
      : []),
    ...Object.values(record).flatMap(timelineStateSchemas),
  ];
}

test("projects every MCP output from the shared catalog and expands every Timeline entity state", async () => {
  const module = await executorModule();
  const entityOperations = new Set([
    "timeline.open",
    "timeline.list",
    "timeline.get",
    "timeline.create",
    "timeline.attach",
    "timeline.detach",
    "timeline.copy",
  ]);

  for (const [operationId, executor] of Object.entries(
    module.TIMELINE_MCP_EXECUTORS as Record<string, any>,
  )) {
    const publicSchema = z.toJSONSchema(executor.outputSchema) as Record<string, any>;
    assert.equal(publicSchema["x-clash-operation-id"], operationId, operationId);
    if (!entityOperations.has(operationId)) continue;
    const states = timelineStateSchemas(publicSchema);
    assert.ok(states.length > 0, `${operationId} must expose Timeline entity state`);
    for (const state of states) {
      assert.equal(state.$ref, "#/definitions/TimelineDsl", operationId);
    }
    assert.ok(publicSchema.definitions?.TimelineDsl, operationId);
  }
});

function localJsonRefs(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(localJsonRefs);
  const record = value as Record<string, unknown>;
  return [
    ...(typeof record.$ref === "string" && record.$ref.startsWith("#/")
      ? [record.$ref]
      : []),
    ...Object.values(record).flatMap(localJsonRefs),
  ];
}

function resolveLocalJsonRef(schema: unknown, ref: string): unknown {
  return ref.slice(2).split("/").reduce<unknown>((value, encodedSegment) => {
    if (!value || typeof value !== "object") return undefined;
    const segment = encodedSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    return (value as Record<string, unknown>)[segment];
  }, schema);
}

test("keeps every registry-derived MCP schema local JSON reference resolvable", async () => {
  const module = await executorModule();
  for (const [operationId, executor] of Object.entries(
    module.TIMELINE_MCP_EXECUTORS as Record<string, any>,
  )) {
    for (const [direction, zodSchema] of [
      ["input", executor.inputSchema],
      ["output", executor.outputSchema],
    ] as const) {
      const schema = z.toJSONSchema(zodSchema);
      for (const ref of localJsonRefs(schema)) {
        assert.notEqual(
          resolveLocalJsonRef(schema, ref),
          undefined,
          `${operationId} ${direction} has an unresolved ${ref}`,
        );
      }
    }
  }
});

test("maps canonical registry inputs into the CLI transport adapter", async () => {
  const module = await executorModule();
  const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
  const adapter = Object.fromEntries([
    "schema", "validate", "list", "get", "create", "save", "attach", "detach", "copy",
  ].map((operation) => [operation, async (input: Record<string, unknown>) => {
    calls.push({ operation, input });
    if (operation === "list") return [];
    return { id: "result", name: "Result", revisionId: "revision-1", state: { tracks: [] } };
  }]));

  await module.TIMELINE_MCP_EXECUTORS["timeline.create"].execute(
    { cwd: "/workspace", id: "social-cut", name: "Social Cut" },
    adapter,
  );
  await module.TIMELINE_MCP_EXECUTORS["timeline.attach"].execute(
    {
      cwd: "/workspace",
      timelineId: "social-cut",
      canvasId: "main",
      actionNodeId: "timeline-action",
      position: { x: 12, y: 34 },
    },
    adapter,
  );
  await module.TIMELINE_MCP_EXECUTORS["timeline.copy"].execute(
    {
      cwd: "/workspace",
      sourceTimelineId: "social-cut",
      targetCanvasId: "review",
      newTimelineId: "review-cut",
      newActionNodeId: "review-action",
      position: { x: 56, y: 78 },
    },
    adapter,
  );
  await module.TIMELINE_MCP_EXECUTORS["timeline.validate"].execute(
    { cwd: "/workspace", document: { tracks: [] }, format: "object" },
    adapter,
  );

  assert.deepEqual(calls, [
    {
      operation: "create",
      input: { cwd: "/workspace", timelineId: "social-cut", name: "Social Cut" },
    },
    {
      operation: "attach",
      input: {
        cwd: "/workspace",
        timelineId: "social-cut",
        canvasId: "main",
        nodeId: "timeline-action",
        position: { x: 12, y: 34 },
      },
    },
    {
      operation: "copy",
      input: {
        cwd: "/workspace",
        timelineId: "social-cut",
        canvasId: "review",
        newTimelineId: "review-cut",
        newNodeId: "review-action",
        position: { x: 56, y: 78 },
      },
    },
    {
      operation: "validate",
      input: { cwd: "/workspace", state: { tracks: [] }, format: "object" },
    },
  ]);
});

test("coverage gate fails for a newly unhandled or stale MCP binding", async () => {
  const module = await executorModule();
  const executors = module.TIMELINE_MCP_EXECUTORS as Record<string, unknown>;
  const { ["timeline.save"]: _missing, ...withoutSave } = executors;

  assert.throws(
    () => module.assertTimelineMcpExecutorCoverage(withoutSave),
    /missing.*timeline\.save/i,
  );
  assert.throws(
    () => module.assertTimelineMcpExecutorCoverage({
      ...executors,
      "timeline.pull": executors["timeline.get"],
    }),
    /non-MCP.*timeline\.pull/i,
  );
});

test("server registration has no parallel definition table or name switch", () => {
  const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /const definitions\s*:/);
  assert.doesNotMatch(source, /switch\s*\(name\)/);
  assert.match(source, /timelineMcpExecutor/);
});
