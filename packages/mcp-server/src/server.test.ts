import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

test("server keeps Studio and Canvas App surfaces quarantined", async () => {
  const { registerClashCanvasMcp } = await import("./server");
  const { CANVAS_MCP_TOOL_NAMES } = await import("./canvas-contract");
  const tools = new Map<
    string,
    { config: any; callback: (input: any) => Promise<any> }
  >();
  const resources = new Map<
    string,
    { uri: string; callback: () => Promise<any> }
  >();
  const fakeServer = {
    registerTool(
      name: string,
      config: any,
      callback: (input: any) => Promise<any>,
    ) {
      tools.set(name, { config, callback });
      return {};
    },
    registerResource(
      name: string,
      uri: string,
      config: any,
      callback: () => Promise<any>,
    ) {
      resources.set(name, { uri, callback });
      return {};
    },
  };

  const register = registerClashCanvasMcp as unknown as (
    server: never,
    gateway: {
      invoke(name: string, input: Record<string, unknown>): Promise<unknown>;
    },
    canvasJavascript: string,
    studioJavascript: string,
  ) => void;
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  register(
    fakeServer as never,
    {
      async invoke(name, input) {
        calls.push({ name, input });
        return name.endsWith("list") || name.endsWith("edges")
          ? []
          : { ok: true };
      },
    },
    "window.__CLASH_CANVAS__ = true;",
    "window.__CLASH_STUDIO__ = true;",
  );

  assert.equal(tools.has("clash_studio_open"), false);
  assert.equal(tools.has("clash_canvas_open"), false);
  assert.equal(tools.has("clash_canvas_snapshot"), false);
  for (const name of CANVAS_MCP_TOOL_NAMES.filter(
    (name) => name !== "clash_canvas_open" && name !== "clash_canvas_snapshot",
  ))
    assert.ok(tools.has(name));
  assert.ok(tools.has("clash_workspace_init"));
  assert.deepEqual(
    [...tools.keys()].filter((name) => name.startsWith("clash_cli_")),
    [],
    "MCP and CLI are peer transports; MCP must not publish CLI namespace wrappers",
  );
  const workspace = await mkdtemp(join(tmpdir(), "clash-native-mcp-init-"));
  const initialized = await tools.get("clash_workspace_init")?.callback({
    cwd: workspace,
    projectId: "benchmark-project",
  });
  assert.deepEqual(
    calls,
    [],
    "native workspace init must not shell through the CLI runner",
  );
  assert.deepEqual(initialized?.structuredContent, {
    projectId: "benchmark-project",
    workspaceId: initialized?.structuredContent.workspaceId,
    markerPath: join(workspace, ".clash", "project.toml"),
    reused: false,
  });
  assert.deepEqual(initialized?.content, [
    {
      type: "text",
      text: "Created Clash workspace for project benchmark-project.",
    },
  ]);
  assert.match(
    initialized?.structuredContent.workspaceId,
    /^managed:[a-f0-9]{16}$/,
  );
  const markerPath = join(workspace, ".clash", "project.toml");
  const markerBeforeReuse = await readFile(markerPath, "utf8");
  assert.match(markerBeforeReuse, /project_id = "benchmark-project"/);

  const reused = await tools.get("clash_workspace_init")?.callback({
    cwd: workspace,
    projectId: "benchmark-project",
  });
  assert.deepEqual(reused?.structuredContent, {
    ...initialized?.structuredContent,
    reused: true,
  });
  assert.deepEqual(reused?.content, [
    {
      type: "text",
      text: "Reused Clash workspace for project benchmark-project.",
    },
  ]);
  assert.equal(await readFile(markerPath, "utf8"), markerBeforeReuse);

  const conflict = await tools.get("clash_workspace_init")?.callback({
    cwd: workspace,
    projectId: "different-project",
  });
  assert.equal(conflict?.isError, true);
  assert.match(
    conflict?.content[0]?.text,
    /already bound.*benchmark-project.*different-project/i,
  );
  assert.equal(conflict?.structuredContent, undefined);
  assert.equal(await readFile(markerPath, "utf8"), markerBeforeReuse);
  assert.equal(resources.size, 0);
  for (const name of ["clash_canvas_list", "clash_canvas_move"]) {
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

test("bundled MCP wires the Assets dispatcher to the direct Host peer gateway", async (t) => {
  const { createClashMcpServer } = await import("./server");
  const assetCalls: Array<{ name: string; input: Record<string, unknown> }> =
    [];
  const server = createClashMcpServer({
    bundledAppJavascript: "window.__CLASH_CANVAS__ = true;",
    bundledStudioAppJavascript: "window.__CLASH_STUDIO__ = true;",
    gateway: {
      async invoke(name) {
        return name.endsWith("list") || name.endsWith("edges")
          ? []
          : { ok: true };
      },
    },
    assetGateway: {
      async invoke(name, input) {
        assetCalls.push({ name, input });
        return name === "clash_assets_list"
          ? []
          : { id: "asset:one", status: "ready" };
      },
    },
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "asset-peer-test", version: "1.0.0" });
  t.after(async () => {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const names = (await client.listTools()).tools.map(({ name }) => name).sort();
  assert.deepEqual(names, [
    "clash",
    "clash_assets",
    "clash_canvas",
    "clash_composition",
    "clash_workspace_init",
  ]);
  const contracts = await client.callTool({
    name: "clash_assets",
    arguments: {},
  });
  assert.deepEqual(
    (
      contracts.structuredContent as {
        operations: Array<{ operation: string }>;
      }
    ).operations.map(({ operation }) => operation),
    ["get", "import_file", "list", "references", "restore", "trash"],
  );
  const listed = await client.callTool({
    name: "clash_assets",
    arguments: { operation: "list", arguments: { projectId: "project-a" } },
  });
  assert.deepEqual(listed.structuredContent, { items: [] });
  assert.deepEqual(assetCalls, [
    {
      name: "clash_assets_list",
      input: { projectId: "project-a" },
    },
  ]);
});
