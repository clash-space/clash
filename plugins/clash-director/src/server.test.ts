import test from "node:test";
import assert from "node:assert/strict";

test("registers Director headless tools while the GUI is quarantined", async () => {
  const module = await import("./server.js").catch(() => ({} as Record<string, any>));
  assert.equal(typeof module.registerDirectorPluginMcp, "function");
  const tools = new Map<string, any>();
  const resources = new Map<string, any>();
  const fakeServer = {
    registerTool(name: string, config: any, callback: (input: any) => Promise<any>) {
      tools.set(name, { config, callback }); return {};
    },
    registerResource(name: string, uri: string, _config: any, callback: () => Promise<any>) {
      resources.set(name, { uri, callback }); return {};
    },
  };
  const stages = [{ id: "stage-1", name: "Blocking", state: { objects: [], cameras: [] } }];
  const adapter = {
    list: async () => stages,
    get: async () => stages[0],
    create: async () => stages[0],
    save: async () => ({ applied: true }),
    attach: async () => stages[0],
    detach: async () => stages[0],
    mutate: async () => stages[0],
  };
  module.registerDirectorPluginMcp(fakeServer, adapter, "window.__DIRECTOR_APP__ = true;");
  assert.deepEqual(
    [...tools.keys()],
    module.DIRECTOR_PLUGIN_TOOL_NAMES.filter((name: string) => name !== "clash_director_open"),
  );
  assert.equal(resources.size, 0);
  assert.deepEqual(tools.get("clash_director_list")?.config.annotations, { readOnlyHint: true });
  for (const name of [
    "clash_director_list",
    "clash_director_get",
    "clash_director_save",
    "clash_director_scene_update",
  ]) {
    assert.equal(
      tools.get(name)?.config._meta.ui.resourceUri,
      undefined,
      `${name} must not instantiate the Director App`,
    );
    assert.equal(tools.get(name)?.config._meta["ui/resourceUri"], undefined);
  }
});
