import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

function projectHostClient() {
  return {
    resolveContext: async ({ projectId, cwd }: { projectId?: string; cwd?: string } = {}) => ({
      projectId: projectId ?? "project-test",
      source: projectId ? "explicit" : "env",
      ...(cwd ? { workspaceRoot: cwd } : {}),
    }),
    async request({ command, projectId }: { command: { action: string }; projectId?: string }) {
      const value = command.action === "list"
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
    return value.flatMap((entry, index) => unsupportedTuplePaths(entry, `${path}[${index}]`));
  }
  const record = value as Record<string, unknown>;
  return [
    ...(Array.isArray(record.items) ? [`${path}.items`] : []),
    ...(Array.isArray(record.prefixItems) ? [`${path}.prefixItems`] : []),
    ...Object.entries(record).flatMap(([key, child]) => (
      unsupportedTuplePaths(child, `${path}.${key}`)
    )),
  ];
}

test("one Clash plugin server quarantines every MCP App while keeping headless tools", async (t) => {
  let module: Record<string, unknown> = {};
  try {
    module = await import("./server.js") as Record<string, unknown>;
  } catch {
    // RED until the composed plugin server exists.
  }
  assert.equal(typeof module.createClashPluginServer, "function");

  const create = module.createClashPluginServer as (options: Record<string, unknown>) => {
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
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
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
    "clash_canvas",
    "clash_composition",
    "clash_workspace_init",
  ];
  assert.deepEqual(rootTools.map(({ name }) => name).sort(), fixedToolNames);
  assert.equal(rootTools.length, 4);
  const operations: Array<any> = [];
  for (const command of ["canvas", "timeline", "director"] as const) {
    const selected = await client.callTool({ name: "clash", arguments: { command } });
    assert.notEqual(selected.isError, true, JSON.stringify(selected));
    assert.equal(
      (selected.structuredContent as { selectedDispatcher?: string }).selectedDispatcher,
      command === "canvas" ? "clash_canvas" : "clash_composition",
    );
    assert.equal(
      (selected.structuredContent as { operations?: unknown[] }).operations,
      undefined,
    );
    const menu = await client.callTool(command === "canvas"
      ? { name: "clash_canvas", arguments: {} }
      : {
          name: "clash_composition",
          arguments: { kind: command === "timeline" ? "timeline" : "director-stage" },
        });
    assert.notEqual(menu.isError, true, JSON.stringify(menu));
    const selectedOperations = (menu.structuredContent as { operations: unknown[] }).operations;
    assert.ok(selectedOperations.length > 0, `${command} must reveal live operations`);
    assert.deepEqual(
      (await client.listTools()).tools.map(({ name }) => name).sort(),
      fixedToolNames,
    );
    operations.push(...selectedOperations);
  }
  const tools = operations.map((operation) => operation.name);
  for (const name of [
    "clash_canvas_list",
    "clash_canvas_execute",
    "clash_timeline_list",
    "clash_timeline_schema",
    "clash_director_list",
  ]) assert.ok(tools.includes(name), `missing ${name}`);
  assert.equal(tools.some((name) => name.startsWith("clash_cli_")), false);
  for (const name of [
    "clash_studio_open",
    "clash_canvas_open",
    "clash_canvas_snapshot",
    "clash_timeline_open",
    "clash_director_open",
  ]) assert.equal(tools.includes(name), false, `${name} must stay quarantined`);
  assert.equal(
    tools.some((name) => name.startsWith("plugin_") && name.includes("skill")),
    false,
    "skills belong to each harness native cwd discovery path, not MCP",
  );

  for (const tool of [...rootTools, ...operations]) {
    assert.match(tool.description ?? "", /^Use when:/, `${tool.name} must explain selection intent`);
    assert.match(tool.description ?? "", /\bEffect:/, `${tool.name} must explain its product effect`);
    assert.match(tool.description ?? "", /\bReturns:/, `${tool.name} must explain its result`);
    assert.match(tool.description ?? "", /\bNext:/, `${tool.name} must explain continuation or recovery`);
  }
  assert.match(
    operations.find(({ name }) => name === "clash_canvas_execute")?.description ?? "",
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
  const directorSave = operations.find(({ name }) => name === "clash_director_save");
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
    assert.notEqual(result.isError, true, `${command}.list dispatch failed: ${JSON.stringify(result)}`);
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
  const module = await import("./server.js") as Record<string, unknown>;
  assert.equal(typeof module.createClashPluginRuntime, "function");
  let closes = 0;
  const runtime = (module.createClashPluginRuntime as (options: Record<string, unknown>) => {
    server: { close(): Promise<void> };
    close(): Promise<void>;
  })({
    client: projectHostClient(),
    hostManager: {
      ensureHost: async () => { throw new Error("runner is injected"); },
      ownsHost: () => true,
      close: async () => { closes += 1; },
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
