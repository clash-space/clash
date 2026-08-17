import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ProjectTimeline } from "@clash/shared-types";

function projectHostClient() {
  return {
    resolveContext: async ({
      projectId,
      cwd,
    }: { projectId?: string; cwd?: string } = {}) => ({
      projectId: projectId ?? "project-test",
      source: projectId ? "explicit" : "env",
      ...(cwd ? { workspaceRoot: cwd } : {}),
    }),
    async request({
      command,
      projectId,
    }: {
      command: { action: string };
      projectId?: string;
    }) {
      const value =
        command.action === "list"
          ? { nodes: [], versions: {} }
          : command.action === "edges"
            ? { edges: [], readToken: "edges-receipt" }
            : command.action === "list_timelines"
              ? { timelines: [], versions: {} }
              : command.action === "list_director_stages"
                ? { stages: [], versions: {} }
                : { status: "active" };
      return { projectId: projectId ?? "project-test", value };
    },
  };
}

function unsupportedTuplePaths(value: unknown, path = "$"): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      unsupportedTuplePaths(entry, `${path}[${index}]`),
    );
  }
  const record = value as Record<string, unknown>;
  return [
    ...(Array.isArray(record.items) ? [`${path}.items`] : []),
    ...(Array.isArray(record.prefixItems) ? [`${path}.prefixItems`] : []),
    ...Object.entries(record).flatMap(([key, child]) =>
      unsupportedTuplePaths(child, `${path}.${key}`),
    ),
  ];
}

test("one Clash plugin server quarantines every MCP App while keeping headless tools", async (t) => {
  let module: Record<string, unknown> = {};
  try {
    module = (await import("./server.js")) as Record<string, unknown>;
  } catch {
    // RED until the composed plugin server exists.
  }
  assert.equal(typeof module.createClashPluginServer, "function");

  const create = module.createClashPluginServer as (
    options: Record<string, unknown>,
  ) => {
    connect(transport: unknown): Promise<void>;
    close(): Promise<void>;
  };
  const server = create({
    client: projectHostClient(),
    appBundles: {
      canvas: "window.__CANVAS__ = true;",
      studio: "window.__STUDIO__ = true;",
      timeline: "window.__TIMELINE__ = true;",
      director: "window.__DIRECTOR__ = true;",
    },
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "clash-plugin-test", version: "1.0.0" });
  t.after(async () => {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const rootTools = (await client.listTools()).tools;
  const discoveryBytes = Buffer.byteLength(JSON.stringify(rootTools));
  assert.ok(
    discoveryBytes < 20_000,
    `MCP discovery must stay compact enough for natural tool selection; received ${discoveryBytes} bytes`,
  );
  const fixedToolNames = [
    "clash",
    "clash_assets",
    "clash_canvas",
    "clash_composition",
    "clash_plugin",
    "clash_workspace_init",
  ];
  assert.deepEqual(rootTools.map(({ name }) => name).sort(), fixedToolNames);
  assert.equal(rootTools.length, fixedToolNames.length);
  const operations: Array<any> = [];
  for (const command of ["plugin", "canvas", "timeline", "director"] as const) {
    const selected = await client.callTool({
      name: "clash",
      arguments: { command },
    });
    assert.notEqual(selected.isError, true, JSON.stringify(selected));
    assert.equal(
      (selected.structuredContent as { selectedDispatcher?: string })
        .selectedDispatcher,
      command === "plugin"
        ? "clash_plugin"
        : command === "canvas"
          ? "clash_canvas"
          : "clash_composition",
    );
    assert.equal(
      (selected.structuredContent as { operations?: unknown[] }).operations,
      undefined,
    );
    const menu = await client.callTool(
      command === "plugin"
        ? { name: "clash_plugin", arguments: {} }
        : command === "canvas"
          ? { name: "clash_canvas", arguments: {} }
          : {
              name: "clash_composition",
              arguments: {
                kind: command === "timeline" ? "timeline" : "director-stage",
              },
            },
    );
    assert.notEqual(menu.isError, true, JSON.stringify(menu));
    const selectedOperations = (
      menu.structuredContent as { operations: unknown[] }
    ).operations as Array<Record<string, unknown>>;
    assert.ok(
      selectedOperations.length > 0,
      `${command} must reveal live operations`,
    );
    assert.deepEqual(
      (await client.listTools()).tools.map(({ name }) => name).sort(),
      fixedToolNames,
    );
    if (command === "plugin") {
      operations.push(...selectedOperations);
      continue;
    }

    for (const operation of selectedOperations) {
      assert.deepEqual(
        Object.keys(operation).sort(),
        ["destructive", "name", "operation", "readOnly", "title"],
        `${command} bare dispatch must stay a lightweight operation index`,
      );
      assert.equal(typeof operation.name, "string");
      assert.equal(typeof operation.operation, "string");
      assert.equal(typeof operation.title, "string");
      assert.equal(typeof operation.readOnly, "boolean");
      assert.equal(typeof operation.destructive, "boolean");

      const disclosed = await client.callTool({
        name: command === "canvas" ? "clash_canvas" : "clash_composition",
        arguments: {
          ...(command === "timeline"
            ? { kind: "timeline" }
            : command === "director"
              ? { kind: "director-stage" }
              : {}),
          contract: operation.operation,
        },
      });
      assert.notEqual(disclosed.isError, true, JSON.stringify(disclosed));
      const contract = (disclosed.structuredContent as { contract?: unknown })
        .contract;
      assert.ok(contract, `${command}.${operation.operation} contract missing`);
      operations.push(contract);
    }
  }
  const tools = operations.map((operation) => operation.name);
  for (const name of [
    "clash_canvas_list",
    "clash_canvas_execute",
    "clash_plugin_create",
    "clash_plugin_activate",
    "clash_timeline_list",
    "clash_timeline_schema",
    "clash_director_list",
  ])
    assert.ok(tools.includes(name), `missing ${name}`);
  assert.equal(
    tools.some((name) => name.startsWith("clash_cli_")),
    false,
  );
  for (const name of [
    "clash_studio_open",
    "clash_canvas_open",
    "clash_canvas_snapshot",
    "clash_timeline_open",
    "clash_director_open",
  ])
    assert.equal(tools.includes(name), false, `${name} must stay quarantined`);
  assert.equal(
    tools.some((name) => name.startsWith("plugin_") && name.includes("skill")),
    false,
    "skills belong to each harness native cwd discovery path, not MCP",
  );

  for (const tool of [...rootTools, ...operations]) {
    assert.match(
      tool.description ?? "",
      /^Use when:/,
      `${tool.name} must explain selection intent`,
    );
    assert.match(
      tool.description ?? "",
      /\bEffect:/,
      `${tool.name} must explain its product effect`,
    );
    assert.match(
      tool.description ?? "",
      /\bReturns:/,
      `${tool.name} must explain its result`,
    );
    assert.match(
      tool.description ?? "",
      /\bNext:/,
      `${tool.name} must explain continuation or recovery`,
    );
  }
  assert.match(
    operations.find(({ name }) => name === "clash_canvas_execute")
      ?.description ?? "",
    /submission is not completion|submitted.*not.*completed/i,
  );
  for (const tool of operations) {
    for (const [direction, schema] of [
      ["input", tool.inputSchema],
      ["output", tool.outputSchema],
    ] as const) {
      if (!schema) continue;
      assert.deepEqual(
        unsupportedTuplePaths(schema),
        [],
        `${tool.name} ${direction} bypassed the shared MCP wire policy`,
      );
    }
  }
  const directorSave = operations.find(
    ({ name }) => name === "clash_director_save",
  );
  assert.match(
    (directorSave?.inputSchema as any)?.properties?.state?.description ?? "",
    /complete.*clash_director_schema/i,
  );

  for (const [command, dispatcher, kind] of [
    ["canvas", "clash_canvas", undefined],
    ["timeline", "clash_composition", "timeline"],
    ["director", "clash_composition", "director-stage"],
  ] as const) {
    const result = await client.callTool({
      name: dispatcher,
      arguments: {
        ...(kind ? { kind } : {}),
        operation: "list",
        arguments: { cwd: process.cwd() },
      },
    });
    assert.notEqual(
      result.isError,
      true,
      `${command}.list dispatch failed: ${JSON.stringify(result)}`,
    );
    assert.deepEqual(result.structuredContent, { items: [] });
    assert.deepEqual(
      (await client.listTools()).tools.map(({ name }) => name).sort(),
      fixedToolNames,
    );
  }

  await assert.rejects(
    client.listResources(),
    (error: unknown) => (error as { code?: number }).code === -32601,
    "quarantined plugin must not advertise MCP App resources",
  );
});

test("plugin runtime closes the host manager exactly once", async () => {
  const module = (await import("./server.js")) as Record<string, unknown>;
  assert.equal(typeof module.createClashPluginRuntime, "function");
  let closes = 0;
  const runtime = (
    module.createClashPluginRuntime as (options: Record<string, unknown>) => {
      server: { close(): Promise<void> };
      close(): Promise<void>;
    }
  )({
    client: projectHostClient(),
    hostManager: {
      ensureHost: async () => {
        throw new Error("runner is injected");
      },
      ownsHost: () => true,
      close: async () => {
        closes += 1;
      },
    },
    appBundles: {
      canvas: "window.__CANVAS__ = true;",
      studio: "window.__STUDIO__ = true;",
      timeline: "window.__TIMELINE__ = true;",
      director: "window.__DIRECTOR__ = true;",
    },
  });

  await runtime.close();
  await runtime.server.close();
  assert.equal(closes, 1);
});

test("Timeline entity mutations satisfy their output contracts through the shared dispatcher", async (t) => {
  const module = (await import("./server.js")) as Record<string, unknown>;
  const create = module.createClashPluginServer as (
    options: Record<string, unknown>,
  ) => { connect(transport: unknown): Promise<void>; close(): Promise<void> };
  let timeline: ProjectTimeline = {
    id: "signal-garden-timeline",
    name: "Signal Garden Cut",
    owner: { kind: "project" },
    revisionId: "revision-1",
    state: { tracks: [] },
  };
  const server = create({
    client: {
      resolveContext: async () => ({ projectId: "project-test", source: "explicit" }),
      async request({ command }: { command: { action: string } }) {
        switch (command.action) {
          case "create_timeline":
            return { projectId: "project-test", value: { timeline, readToken: "timeline-receipt-1" } };
          case "list_timelines":
            return {
              projectId: "project-test",
              value: { timelines: [timeline], versions: { [timeline.id]: "timeline-receipt-1" } },
            };
          case "attach_timeline":
            timeline = {
              ...timeline,
              owner: { kind: "canvas-action", canvasId: "main", actionNodeId: "timeline-action" },
              revisionId: "revision-2",
            };
            return { projectId: "project-test", value: { timeline, readToken: "timeline-receipt-2" } };
          case "detach_timeline":
            timeline = { ...timeline, owner: { kind: "project" }, revisionId: "revision-3" };
            return { projectId: "project-test", value: { timeline, readToken: "timeline-receipt-3" } };
          case "copy_timeline_action":
            return {
              projectId: "project-test",
              value: {
                timeline: {
                  ...timeline,
                  id: "signal-garden-copy",
                  owner: { kind: "canvas-action", canvasId: "review", actionNodeId: "copy-action" },
                  revisionId: "revision-4",
                },
                readToken: "timeline-receipt-4",
              },
            };
          default:
            return { projectId: "project-test", value: { nodes: [], versions: {} } };
        }
      },
    },
    appBundles: { canvas: "", studio: "", timeline: "", director: "" },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "timeline-entity-output-test", version: "1.0.0" });
  t.after(async () => {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const created = await client.callTool({
    name: "clash_composition",
    arguments: {
      kind: "timeline",
      operation: "create",
      arguments: { id: timeline.id, name: timeline.name },
    },
  });
  assert.notEqual(created.isError, true, JSON.stringify(created));
  assert.deepEqual(created.structuredContent, timeline);

  const attached = await client.callTool({
    name: "clash_composition",
    arguments: {
      kind: "timeline",
      operation: "attach",
      arguments: { timelineId: timeline.id, canvasId: "main" },
    },
  });
  assert.notEqual(attached.isError, true, JSON.stringify(attached));
  assert.deepEqual(attached.structuredContent, timeline);

  const detached = await client.callTool({
    name: "clash_composition",
    arguments: {
      kind: "timeline",
      operation: "detach",
      arguments: { timelineId: timeline.id },
    },
  });
  assert.notEqual(detached.isError, true, JSON.stringify(detached));
  assert.deepEqual(detached.structuredContent, timeline);

  const copied = await client.callTool({
    name: "clash_composition",
    arguments: {
      kind: "timeline",
      operation: "copy",
      arguments: { sourceTimelineId: timeline.id, targetCanvasId: "review", newTimelineId: "signal-garden-copy" },
    },
  });
  assert.notEqual(copied.isError, true, JSON.stringify(copied));
  assert.deepEqual(copied.structuredContent, {
    ...timeline,
    id: "signal-garden-copy",
    owner: { kind: "canvas-action", canvasId: "review", actionNodeId: "copy-action" },
    revisionId: "revision-4",
  });

  const readback = await client.callTool({
    name: "clash_composition",
    arguments: {
      kind: "timeline",
      operation: "get",
      arguments: { timelineId: timeline.id },
    },
  });
  assert.notEqual(readback.isError, true, JSON.stringify(readback));
  assert.deepEqual(
    (readback.structuredContent as { timeline?: unknown }).timeline,
    timeline,
  );
});
