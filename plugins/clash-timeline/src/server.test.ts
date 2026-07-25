import test from "node:test";
import assert from "node:assert/strict";

async function serverModule(): Promise<Record<string, any>> {
  return import("./server.js").catch(() => ({}));
}

test("registers only Timeline tools plus the Timeline GUI resource", async () => {
  const module = await serverModule();
  assert.equal(typeof module.registerTimelinePluginMcp, "function");
  const tools = new Map<string, { config: any; callback: (input: any) => Promise<any> }>();
  const resources = new Map<string, { uri: string; callback: () => Promise<any> }>();
  const fakeServer = {
    registerTool(name: string, config: any, callback: (input: any) => Promise<any>) {
      tools.set(name, { config, callback });
      return {};
    },
    registerResource(name: string, uri: string, _config: any, callback: () => Promise<any>) {
      resources.set(name, { uri, callback });
      return {};
    },
  };
  const timelines = [{ id: "rough-cut", name: "Rough Cut", state: { tracks: [] } }];
  const adapter = {
    list: async () => timelines,
    get: async () => timelines[0],
    create: async () => timelines[0],
    save: async () => ({ applied: true, revisionId: "revision-2" }),
    attach: async () => timelines[0],
    detach: async () => timelines[0],
    copy: async () => timelines[0],
  };

  module.registerTimelinePluginMcp(fakeServer, adapter, "window.__TIMELINE_APP__ = true;");

  assert.deepEqual([...tools.keys()], [
    "clash_timeline_open",
    "clash_timeline_list",
    "clash_timeline_get",
    "clash_timeline_create",
    "clash_timeline_save",
    "clash_timeline_attach",
    "clash_timeline_detach",
    "clash_timeline_copy",
  ]);
  assert.equal(resources.get("Clash Timeline")?.uri, "ui://clash/timeline");
  assert.deepEqual(tools.get("clash_timeline_list")?.config.annotations, { readOnlyHint: true });
  assert.equal(tools.has("clash_canvas_open"), false);
  assert.equal(
    tools.get("clash_timeline_open")?.config._meta.ui.resourceUri,
    "ui://clash/timeline",
  );
  for (const name of [
    "clash_timeline_list",
    "clash_timeline_get",
    "clash_timeline_save",
    "clash_timeline_attach",
  ]) {
    assert.equal(
      tools.get(name)?.config._meta.ui.resourceUri,
      undefined,
      `${name} must not instantiate the Timeline App`,
    );
    assert.equal(tools.get(name)?.config._meta["ui/resourceUri"], undefined);
  }

  const opened = await tools.get("clash_timeline_open")!.callback({
    cwd: "/workspace",
    timelineId: "rough-cut",
  });
  assert.equal(opened.structuredContent.selected.id, "rough-cut");
  assert.equal(opened.structuredContent.cwd, "/workspace");

  const resource = await resources.get("Clash Timeline")!.callback();
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(resource.contents[0].text, /window\.__TIMELINE_APP__ = true/);
});
