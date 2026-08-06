import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
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

test("validates a complete Timeline state without reading or mutating an entity", async () => {
  const module = await adapterModule();
  const events: Array<Record<string, unknown>> = [];
  let validationPath = "";
  const adapter = module.createTimelineAdapter({
    run: async (args: string[], cwd: string) => {
      events.push({ kind: "run", args, cwd });
      return { ok: true, contractFingerprint: "fnv1a32:test" };
    },
    writeProjection: async (path: string, content: string) => {
      validationPath = path;
      events.push({ kind: "write", path, content: JSON.parse(content) });
    },
  });
  const state = { tracks: [{ id: "visual", items: [] }] };

  const result = await adapter.validate({ cwd: "/workspace", state });

  assert.equal(result.ok, true);
  assert.deepEqual(events[0], {
    kind: "write",
    path: validationPath,
    content: state,
  });
  assert.deepEqual(events[1], {
    kind: "run",
    args: ["timeline", "validate", "--file", validationPath, "--json"],
    cwd: "/workspace",
  });
  await assert.rejects(access(validationPath));
});

test("rejects invalid Timeline state locally with shared rule ids before invoking the CLI", async () => {
  const module = await adapterModule();
  let runs = 0;
  let writes = 0;
  const adapter = module.createTimelineAdapter({
    run: async () => {
      runs += 1;
      return { ok: true };
    },
    writeProjection: async () => {
      writes += 1;
    },
  });

  await assert.rejects(
    adapter.validate({
      cwd: "/workspace",
      state: {
        tracks: [{
          id: "visual",
          items: [{
            id: "missing-source",
            type: "video",
            from: 0,
            durationInFrames: 10,
          }],
        }],
      },
    }),
    (error: any) => error?.code === "TIMELINE_DSL_INVALID"
      && error?.issues?.some((issue: any) => issue.ruleId === "timeline.item.source-required"),
  );
  assert.equal(runs, 0);
  assert.equal(writes, 0);
});

test("saves through read proof, a project projection, and Timeline apply", async () => {
  const module = await adapterModule();
  assert.equal(typeof module.createTimelineAdapter, "function");
  const events: Array<Record<string, unknown>> = [];
  const adapter = module.createTimelineAdapter({
    run: async (args: string[], cwd: string) => {
      events.push({ kind: "run", args, cwd });
      if (args[1] === "list") {
        return [{ id: "rough-cut", name: "Rough Cut", revisionId: "revision-1", owner: { kind: "project" }, state: { tracks: [] } }];
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
    tracks: [{ id: "video", category: "visual", items: [] }],
  };
  const result = await adapter.save({
    cwd: "/workspace",
    timelineId: "rough-cut",
    baseRevisionId: "revision-1",
    state,
  });

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

test("rejects a stale full-state save before writing the projection", async () => {
  const module = await adapterModule();
  let writes = 0;
  const calls: string[][] = [];
  const adapter = module.createTimelineAdapter({
    run: async (args: string[]) => {
      calls.push(args);
      return [{
        id: "rough-cut",
        name: "Rough Cut",
        revisionId: "revision-2",
        owner: { kind: "project" },
        state: { tracks: [] },
      }];
    },
    writeProjection: async () => { writes += 1; },
  });

  await assert.rejects(
    adapter.save({
      cwd: "/workspace",
      timelineId: "rough-cut",
      baseRevisionId: "revision-1",
      state: { tracks: [] },
    }),
    /STALE_TIMELINE.*revision-1.*revision-2/i,
  );
  assert.equal(writes, 0);
  assert.deepEqual(calls, [["timeline", "list", "--json"]]);
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

test("defaults to the Clash ACP workspace instead of the MCP process cwd", async () => {
  const module = await adapterModule();
  const previous = process.env.CLASH_WORKSPACE_ROOT;
  process.env.CLASH_WORKSPACE_ROOT = "/workspace/from-acp-session";
  const calls: Array<{ args: string[]; cwd: string }> = [];
  try {
    const adapter = module.createTimelineAdapter({
      run: async (args: string[], cwd: string) => {
        calls.push({ args, cwd });
        return [];
      },
    });
    await adapter.list({});
    assert.equal(calls[0]?.cwd, "/workspace/from-acp-session");
  } finally {
    if (previous === undefined) delete process.env.CLASH_WORKSPACE_ROOT;
    else process.env.CLASH_WORKSPACE_ROOT = previous;
  }
});
