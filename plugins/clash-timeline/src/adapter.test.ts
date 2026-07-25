import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

async function adapterModule(): Promise<Record<string, any>> {
  return import("./adapter.js").catch(() => ({}));
}

test("lists and reads Timeline entities through an injected host adapter", async () => {
  const module = await adapterModule();
  assert.equal(typeof module.createTimelineAdapter, "function");
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const adapter = module.createTimelineAdapter({
    run: async (args: string[], cwd: string) => {
      calls.push({ args, cwd });
      return [{ id: "rough-cut", name: "Rough Cut", owner: { kind: "project" }, state: { tracks: [] } }];
    },
  });

  const timeline = await adapter.get({ cwd: "/workspace", timelineId: "rough-cut" });
  assert.equal(timeline.name, "Rough Cut");
  assert.deepEqual(calls, [{ args: ["timeline", "list", "--json"], cwd: "/workspace" }]);
});

test("saves through read proof, a project projection, and Timeline apply", async () => {
  const module = await adapterModule();
  assert.equal(typeof module.createTimelineAdapter, "function");
  const events: Array<Record<string, unknown>> = [];
  const adapter = module.createTimelineAdapter({
    run: async (args: string[], cwd: string) => {
      events.push({ kind: "run", args, cwd });
      if (args[1] === "list") {
        return [{ id: "rough-cut", name: "Rough Cut", owner: { kind: "project" }, state: { tracks: [] } }];
      }
      return { applied: true, timelineId: "rough-cut", revisionId: "revision-2" };
    },
    writeProjection: async (path: string, content: string) => {
      events.push({ kind: "write", path, content: JSON.parse(content) });
    },
  });

  const state = {
    fps: 30,
    durationInFrames: 90,
    tracks: [{ id: "video", category: "video-image", items: [] }],
  };
  const result = await adapter.save({ cwd: "/workspace", timelineId: "rough-cut", state });

  assert.equal(result.revisionId, "revision-2");
  assert.deepEqual(events, [
    { kind: "run", args: ["timeline", "list", "--json"], cwd: "/workspace" },
    {
      kind: "write",
      path: join("/workspace", "timelines", "rough-cut.timeline.yaml"),
      content: state,
    },
    {
      kind: "run",
      args: [
        "timeline", "apply", "--timeline", "rough-cut", "--file",
        join("/workspace", "timelines", "rough-cut.timeline.yaml"), "--json",
      ],
      cwd: "/workspace",
    },
  ]);
});

test("does not write when the Timeline has not been read or does not exist", async () => {
  const module = await adapterModule();
  assert.equal(typeof module.createTimelineAdapter, "function");
  let writes = 0;
  const adapter = module.createTimelineAdapter({
    run: async () => [],
    writeProjection: async () => { writes += 1; },
  });

  await assert.rejects(
    adapter.save({ cwd: "/workspace", timelineId: "missing", state: { tracks: [] } }),
    /not found/i,
  );
  assert.equal(writes, 0);
});
