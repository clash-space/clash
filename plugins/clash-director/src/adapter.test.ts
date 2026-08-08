import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

test("adapter applies a deterministic Director projection through one base-pinned CLI path", async () => {
  const module = await import("./adapter.js").catch(() => ({} as Record<string, any>));
  assert.equal(typeof module.createDirectorAdapter, "function");
  const calls: string[][] = [];
  const writes: Array<{ path: string; content: string }> = [];
  const state = {
    schemaVersion: 1,
    scene: { backgroundColor: "#171816", grid: { visible: true, snap: false, size: 1 } },
    objects: [],
    cameras: [],
    shots: [],
  };
  const adapter = module.createDirectorAdapter({
    run: async (args: string[]) => {
      calls.push(args);
      if (args.includes("list")) return [{ id: "stage-1", name: "Blocking", revisionId: "revision-1", state }];
      return { applied: true };
    },
    writeProjection: async (path: string, content: string) => writes.push({ path, content }),
  });
  const cwd = "/workspace";
  await adapter.save({ cwd, stageId: "stage-1", baseRevisionId: "revision-1", state });

  assert.equal(writes[0]?.path, join(cwd, "director-stages", "stage-1.director-stage.json"));
  assert.match(writes[0]?.content ?? "", /"schemaVersion": 1/);
  assert.equal(calls.some((args) => args.includes("list")), false);
  assert.deepEqual(calls.at(-1), [
    "director", "apply", "--stage", "stage-1", "--file",
    join(cwd, "director-stages", "stage-1.director-stage.json"),
    "--base-revision", "revision-1", "--json",
  ]);
});

test("defaults to the Clash ACP workspace instead of the MCP process cwd", async () => {
  const module = await import("./adapter.js").catch(() => ({} as Record<string, any>));
  const previous = process.env.CLASH_WORKSPACE_ROOT;
  process.env.CLASH_WORKSPACE_ROOT = "/workspace/from-acp-session";
  const calls: Array<{ args: string[]; cwd: string }> = [];
  try {
    const adapter = module.createDirectorAdapter({
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

test("typed object mutation applies the authoritative full object without argv field loss", async () => {
  const module = await import("./adapter.js").catch(() => ({} as Record<string, any>));
  const writes: Array<{ path: string; content: string }> = [];
  const stage = {
    id: "stage-1",
    name: "Blocking",
    revisionId: "revision-1",
    state: {
      schemaVersion: 1,
      scene: { backgroundColor: "#111111", grid: { visible: true, snap: false, size: 1 } },
      objects: [],
      cameras: [],
      shots: [],
    },
  };
  const calls: string[][] = [];
  const adapter = module.createDirectorAdapter({
    run: async (args: string[]) => {
      calls.push(args);
      if (args.includes("list")) return [stage];
      return { applied: true, revisionId: "revision-2" };
    },
    writeProjection: async (path: string, content: string) => writes.push({ path, content }),
  });
  const object = {
    id: "key-light",
    name: "Key Light",
    kind: "light",
    visible: false,
    groupId: "lighting",
    transform: { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [2, 2, 2] },
    light: { type: "spot", intensity: 7, range: 30, angle: 0.8 },
  };

  await adapter.mutate("clash_director_object_add", {
    cwd: "/workspace",
    stageId: "stage-1",
    object,
  });

  assert.equal(calls.some((args) => args.includes("object")), false);
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0]!.content).objects, [object]);
  assert.deepEqual(calls.at(-1)?.slice(-3), ["--base-revision", stage.revisionId, "--json"]);
});

test("save rejects a non-authoritative projection before writing or applying it", async () => {
  const module = await import("./adapter.js").catch(() => ({} as Record<string, any>));
  const calls: string[][] = [];
  const writes: Array<{ path: string; content: string }> = [];
  const adapter = module.createDirectorAdapter({
    run: async (args: string[]) => {
      calls.push(args);
      return args.includes("list")
        ? [{ id: "stage-1", name: "Blocking", state: {} }]
        : { applied: true };
    },
    writeProjection: async (path: string, content: string) => writes.push({ path, content }),
  });

  await assert.rejects(
    adapter.save({ cwd: "/workspace", stageId: "stage-1", state: { schemaVersion: 1 } }),
  );
  assert.equal(writes.length, 0);
  assert.equal(calls.some((args) => args.includes("apply")), false);
});
