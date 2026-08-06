import test from "node:test";
import assert from "node:assert/strict";

test("server keeps Studio and Canvas App surfaces quarantined", async () => {
  const { registerClashCanvasMcp } = await import("./server");
  const { CANVAS_MCP_TOOL_NAMES } = await import("./canvas-contract");
  const cliContract = await import("./cli-contract") as Record<string, unknown>;
  const tools = new Map<string, { config: any; callback: (input: any) => Promise<any> }>();
  const resources = new Map<string, { uri: string; callback: () => Promise<any> }>();
  const fakeServer = {
    registerTool(name: string, config: any, callback: (input: any) => Promise<any>) {
      tools.set(name, { config, callback });
      return {};
    },
    registerResource(name: string, uri: string, config: any, callback: () => Promise<any>) {
      resources.set(name, { uri, callback });
      return {};
    },
  };

  const register = registerClashCanvasMcp as unknown as (
    server: never,
    runner: (args: string[], cwd?: string) => Promise<unknown>,
    canvasJavascript: string,
    studioJavascript: string,
  ) => void;
  register(fakeServer as never, async (args) => {
    if (args[0] === "host") return { status: "active", endpoint: "http://127.0.0.1:49321" };
    if (args[0] === "projects") return [{ id: "project-1", name: "Studio Project" }];
    if (args[1] === "list") return [];
    if (args[1] === "edges") return [];
    return { ok: true };
  }, "window.__CLASH_CANVAS__ = true;", "window.__CLASH_STUDIO__ = true;");

  assert.equal(tools.has("clash_studio_open"), false);
  assert.equal(tools.has("clash_canvas_open"), false);
  assert.equal(tools.has("clash_canvas_snapshot"), false);
  for (const name of CANVAS_MCP_TOOL_NAMES.filter((name) => (
    name !== "clash_canvas_open" && name !== "clash_canvas_snapshot"
  ))) assert.ok(tools.has(name));
  for (const namespace of cliContract.CLASH_CLI_NAMESPACES as string[]) {
    assert.ok(tools.has(`clash_cli_${namespace}`));
  }
  assert.equal(resources.size, 0);
  for (const name of [
    "clash_canvas_list",
    "clash_canvas_move",
    "clash_cli_projects",
  ]) {
    assert.equal(
      tools.get(name)?.config._meta.ui.resourceUri,
      undefined,
      `${name} must stay headless instead of opening an MCP App`,
    );
    assert.equal(
      tools.get(name)?.config._meta["ui/resourceUri"],
      undefined,
      `${name} must not publish the legacy App resource key`,
    );
  }

});

test("HTTP server exposes stateful Streamable HTTP MCP and health endpoints", async (t) => {
  const serverModule = await import("./server") as Record<string, unknown>;
  assert.equal(typeof serverModule.startClashMcpHttpServer, "function");

  const start = serverModule.startClashMcpHttpServer as (options: Record<string, unknown>) => Promise<{
    url: string;
    close(): Promise<void>;
  }>;
  const http = await start({
    host: "127.0.0.1",
    port: 0,
    runner: async () => [],
    bundledAppJavascript: "window.__CLASH_APP__ = true;",
  });
  t.after(() => http.close());

  assert.match(http.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const health = await fetch(new URL("/health", http.url));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", transport: "streamable-http", endpoint: "/mcp" });

  const initialize = await fetch(http.url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "http-test", version: "1.0.0" },
      },
    }),
  });
  assert.equal(initialize.status, 200);
  assert.ok(initialize.headers.get("mcp-session-id"));
  assert.match(await initialize.text(), /"name":"clash"/);
});
