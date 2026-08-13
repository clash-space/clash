import test from "node:test";
import assert from "node:assert/strict";

test("MCP exposes the Project Asset peer surface without public CAS inputs", async () => {
  const { ASSET_MCP_TOOL_NAMES } = await import("./asset-contract");
  const { registerClashAssetMcp } = await import("./server");
  const tools = new Map<
    string,
    { config: any; callback: (input: any) => Promise<any> }
  >();
  const server = {
    registerTool(
      name: string,
      config: any,
      callback: (input: any) => Promise<any>,
    ) {
      tools.set(name, { config, callback });
      return {};
    },
  };
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  registerClashAssetMcp(server as never, {
    async invoke(name, input) {
      calls.push({ name, input });
      return name === "clash_assets_list"
        ? []
        : { id: "asset:one", status: "ready" };
    },
  });

  assert.deepEqual([...tools.keys()], [...ASSET_MCP_TOOL_NAMES]);
  for (const { config } of tools.values()) {
    const schema = JSON.stringify(config.inputSchema);
    assert.doesNotMatch(schema, /readToken|receipt|ifMatch|if-match|force/i);
  }
  assert.equal(
    tools.get("clash_assets_trash")?.config.annotations.destructiveHint,
    true,
  );
  const listed = await tools
    .get("clash_assets_list")
    ?.callback({ projectId: "project-a" });
  assert.deepEqual(listed?.structuredContent, { items: [] });
  assert.deepEqual(calls, [
    {
      name: "clash_assets_list",
      input: { projectId: "project-a" },
    },
  ]);
});

test("MCP Asset failures preserve Host codes and give read recovery without exposing CAS", async () => {
  const { registerClashAssetMcp } = await import("./server");
  const tools = new Map<string, { callback: (input: any) => Promise<any> }>();
  registerClashAssetMcp(
    {
      registerTool(
        name: string,
        _config: unknown,
        callback: (input: any) => Promise<any>,
      ) {
        tools.set(name, { callback });
        return {};
      },
    } as never,
    {
      async invoke(_name, input) {
        if (input.assetId === "asset:stale") {
          throw {
            body: {
              code: "STALE_READ",
              error: "Project Asset changed after the last read",
              projectAssetId: "asset:stale",
            },
          };
        }
        throw new Error("READ_REQUIRED: Read the Project Asset first");
      },
    },
  );

  const failure = await tools.get("clash_assets_trash")?.callback({
    projectId: "project-a",
    assetId: "asset:one",
  });
  assert.equal(failure?.isError, true);
  assert.deepEqual(failure?.structuredContent, {
    error: {
      code: "READ_REQUIRED",
      message: "READ_REQUIRED: Read the Project Asset first",
      operation: "clash_assets_trash",
      retryTool: {
        name: "clash_assets_get",
        arguments: { projectId: "project-a", assetId: "asset:one" },
      },
    },
  });
  assert.doesNotMatch(
    JSON.stringify(failure),
    /readToken|receipt|ifMatch|if-match|force/i,
  );

  const stale = await tools.get("clash_assets_trash")?.callback({
    projectId: "project-a",
    assetId: "asset:stale",
  });
  assert.deepEqual(stale?.structuredContent, {
    error: {
      code: "STALE_READ",
      message: "Project Asset changed after the last read",
      operation: "clash_assets_trash",
      projectAssetId: "asset:stale",
      retryTool: {
        name: "clash_assets_get",
        arguments: { projectId: "project-a", assetId: "asset:stale" },
      },
    },
  });
});
