import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

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
    "clash_canvas_list",
    "clash_canvas_execute",
    "clash_timeline_list",
    "clash_timeline_schema",
    "clash_director_list",
    "clash_cli_assets",
    "clash_cli_effect",
  ]) assert.ok(tools.includes(name), `missing ${name}`);
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

  const appToolUris = listedTools.flatMap((tool) => {
    const resourceUri = (tool._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri
      ?? tool._meta?.["ui/resourceUri"];
    return resourceUri === undefined ? [] : [[tool.name, resourceUri]];
  });
  assert.deepEqual(appToolUris, []);

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
