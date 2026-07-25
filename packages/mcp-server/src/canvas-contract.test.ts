import test from "node:test";
import assert from "node:assert/strict";

test("MCP canvas tools cover the agent-facing Canvas CLI surface", async () => {
  const { CANVAS_MCP_TOOL_NAMES } = await import("./canvas-contract");

  assert.deepEqual(CANVAS_MCP_TOOL_NAMES, [
    "clash_canvas_open",
    "clash_canvas_snapshot",
    "clash_canvas_list",
    "clash_canvas_edges",
    "clash_canvas_get",
    "clash_canvas_search",
    "clash_canvas_add",
    "clash_canvas_execute",
    "clash_canvas_update",
    "clash_canvas_move",
    "clash_canvas_copy",
    "clash_canvas_replace_asset",
    "clash_canvas_delete_plan",
    "clash_canvas_delete_batch",
    "clash_canvas_delete",
  ]);
});

test("MCP move delegates to the matching JSON CLI command", async () => {
  const { buildCanvasCliArgs } = await import("./canvas-contract");

  assert.deepEqual(buildCanvasCliArgs("clash_canvas_move", {
    projectId: "project-1",
    canvasId: "shots",
    nodeId: "note-1",
    x: 420,
    y: 180,
  }), [
    "canvas", "move",
    "--node", "note-1",
    "--x", "420",
    "--y", "180",
    "--project", "project-1",
    "--canvas", "shots",
    "--json",
  ]);
});

test("MCP destructive operations preserve CLI confirmation and graph planning", async () => {
  const { buildCanvasCliArgs } = await import("./canvas-contract");

  assert.deepEqual(buildCanvasCliArgs("clash_canvas_delete_plan", {
    nodeIds: ["note-1", "image-1"],
  }), [
    "canvas", "delete-plan",
    "--node", "note-1",
    "--node", "image-1",
    "--json",
  ]);
  assert.deepEqual(buildCanvasCliArgs("clash_canvas_delete_batch", {
    nodeIds: ["note-1", "image-1"],
  }), [
    "canvas", "delete-batch",
    "--node", "note-1",
    "--node", "image-1",
    "--yes",
    "--json",
  ]);
});

test("snapshot remains app-only while semantic tools remain model-visible", async () => {
  const { canvasToolVisibility } = await import("./canvas-contract");

  assert.deepEqual(canvasToolVisibility("clash_canvas_snapshot"), ["app"]);
  assert.deepEqual(canvasToolVisibility("clash_canvas_move"), ["model", "app"]);
  assert.deepEqual(canvasToolVisibility("clash_canvas_open"), ["model", "app"]);
});
