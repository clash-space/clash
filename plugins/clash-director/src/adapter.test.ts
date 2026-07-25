import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

test("adapter reads before save and applies a deterministic Director projection", async () => {
  const module = await import("./adapter.js").catch(() => ({} as Record<string, any>));
  assert.equal(typeof module.createDirectorAdapter, "function");
  const calls: string[][] = [];
  const writes: Array<{ path: string; content: string }> = [];
  const adapter = module.createDirectorAdapter({
    run: async (args: string[]) => {
      calls.push(args);
      if (args.includes("list")) return [{ id: "stage-1", name: "Blocking", state: { schemaVersion: 1, objects: [], cameras: [], shots: [] } }];
      return { applied: true };
    },
    writeProjection: async (path: string, content: string) => writes.push({ path, content }),
  });
  const cwd = "/workspace";
  await adapter.save({ cwd, stageId: "stage-1", state: { schemaVersion: 1, objects: [], cameras: [], shots: [] } });

  assert.equal(writes[0]?.path, join(cwd, "director-stages", "stage-1.director-stage.json"));
  assert.match(writes[0]?.content ?? "", /"schemaVersion": 1/);
  assert.deepEqual(calls.at(-1), [
    "director", "apply", "--stage", "stage-1", "--file",
    join(cwd, "director-stages", "stage-1.director-stage.json"), "--json",
  ]);
});
