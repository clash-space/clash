import test from "node:test";
import assert from "node:assert/strict";

async function contract(): Promise<Record<string, any>> {
  return import("./contract.js").catch(() => ({}));
}

test("exposes one cohesive Timeline plugin tool contract", async () => {
  const module = await contract();
  assert.deepEqual(module.TIMELINE_PLUGIN_TOOL_NAMES, [
    "clash_timeline_open",
    "clash_timeline_schema",
    "clash_timeline_validate",
    "clash_timeline_list",
    "clash_timeline_get",
    "clash_timeline_create",
    "clash_timeline_save",
    "clash_timeline_attach",
    "clash_timeline_detach",
    "clash_timeline_copy",
  ]);
});

test("maps typed Timeline operations to exact shell-free Clash CLI argv", async () => {
  const module = await contract();
  assert.equal(typeof module.buildTimelineCliArgs, "function");
  const build = module.buildTimelineCliArgs as (name: string, input: Record<string, unknown>) => string[];

  assert.deepEqual(build("clash_timeline_list", { projectId: "project-1" }), [
    "timeline", "list", "--project", "project-1", "--json",
  ]);
  assert.deepEqual(build("clash_timeline_list", { standalone: true }), [
    "timeline", "list", "--standalone", "--json",
  ]);
  assert.deepEqual(build("clash_timeline_schema", {}), [
    "timeline", "schema", "--json",
  ]);
  assert.deepEqual(build("clash_timeline_create", {
    timelineId: "social-cut",
    name: "Social Cut",
    projectId: "project-1",
  }), [
    "timeline", "create", "--id", "social-cut", "--name", "Social Cut",
    "--project", "project-1", "--json",
  ]);
  assert.deepEqual(build("clash_timeline_attach", {
    timelineId: "social-cut",
    canvasId: "main",
    nodeId: "social-cut-action",
    position: { x: 12, y: 34 },
  }), [
    "timeline", "attach", "--timeline", "social-cut", "--canvas", "main",
    "--node", "social-cut-action", "--x", "12", "--y", "34", "--json",
  ]);
  assert.deepEqual(build("clash_timeline_detach", { timelineId: "social-cut" }), [
    "timeline", "detach", "--timeline", "social-cut", "--json",
  ]);
  assert.deepEqual(build("clash_timeline_copy", {
    timelineId: "social-cut",
    canvasId: "review",
    newTimelineId: "review-cut",
    newNodeId: "review-action",
    position: { x: 56, y: 78 },
  }), [
    "timeline", "copy", "--timeline", "social-cut", "--canvas", "review",
    "--new-timeline", "review-cut", "--new-node", "review-action",
    "--x", "56", "--y", "78", "--json",
  ]);
});

test("rejects unsupported and incomplete Timeline operations", async () => {
  const module = await contract();
  assert.equal(typeof module.buildTimelineCliArgs, "function");
  const build = module.buildTimelineCliArgs as (name: string, input: Record<string, unknown>) => string[];

  assert.throws(() => build("clash_timeline_delete", {}), /not exposed/i);
  assert.throws(() => build("clash_timeline_create", { name: "Missing ID" }), /timelineId is required/i);
});
