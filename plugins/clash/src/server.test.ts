import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

test("one Clash plugin server composes the full tool surface and four focused Apps", async (t) => {
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
    runner: async (args: string[]) => args[0] === "projects" ? [] : { status: "active" },
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

  const listedTools = (await client.listTools()).tools;
  const tools = listedTools.map((tool) => tool.name);
  for (const name of [
    "clash_studio_open",
    "clash_canvas_open",
    "clash_timeline_open",
    "clash_director_open",
    "clash_cli_assets",
    "clash_cli_effect",
  ]) assert.ok(tools.includes(name), `missing ${name}`);
  assert.equal(
    tools.some((name) => name.startsWith("plugin_") && name.includes("skill")),
    false,
    "skills belong to each harness native cwd discovery path, not MCP",
  );

  const appToolUris = new Map(listedTools.map((tool) => [
    tool.name,
    (tool._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri
      ?? tool._meta?.["ui/resourceUri"],
  ]));
  assert.deepEqual(
    Object.fromEntries([...appToolUris].filter(([, resourceUri]) => resourceUri !== undefined)),
    {
      clash_studio_open: "ui://clash/studio",
      clash_canvas_open: "ui://clash/canvas",
      clash_timeline_open: "ui://clash/timeline",
      clash_director_open: "ui://clash/director",
    },
  );

  const resources = (await client.listResources()).resources.map((resource) => resource.uri).sort();
  assert.deepEqual(resources, [
    "ui://clash/canvas",
    "ui://clash/director",
    "ui://clash/studio",
    "ui://clash/timeline",
  ]);
});

test("plugin runtime closes the host manager exactly once", async () => {
  const module = await import("./server.js") as Record<string, unknown>;
  assert.equal(typeof module.createClashPluginRuntime, "function");
  let closes = 0;
  const runtime = (module.createClashPluginRuntime as (options: Record<string, unknown>) => {
    server: { close(): Promise<void> };
    close(): Promise<void>;
  })({
    runner: async (args: string[]) => args[0] === "projects" ? [] : { status: "active" },
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
