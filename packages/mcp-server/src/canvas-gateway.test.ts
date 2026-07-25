import test from "node:test";
import assert from "node:assert/strict";

test("open composes the CLI node and edge reads into one App snapshot", async () => {
  const { invokeCanvasTool } = await import("./canvas-gateway");
  const calls: string[][] = [];
  const runner = async (args: string[]) => {
    calls.push(args);
    return args[1] === "list"
      ? [{ id: "note-1", type: "text", position: { x: 20, y: 40 }, data: { label: "Beat" } }]
      : [{ id: "note-action", source: "note-1", target: "action-1", type: "default" }];
  };

  const result = await invokeCanvasTool("clash_canvas_open", {
    projectId: "project-1",
    canvasId: "main",
  }, runner);

  assert.deepEqual(calls, [
    ["canvas", "list", "--project", "project-1", "--canvas", "main", "--json"],
    ["canvas", "edges", "--project", "project-1", "--canvas", "main", "--json"],
  ]);
  assert.deepEqual(result, {
    projectId: "project-1",
    canvasId: "main",
    nodes: [{ id: "note-1", type: "text", position: { x: 20, y: 40 }, data: { label: "Beat" } }],
    edges: [{ id: "note-action", source: "note-1", target: "action-1", type: "default" }],
  });
});

test("semantic MCP tools execute their matching CLI invocation", async () => {
  const { invokeCanvasTool } = await import("./canvas-gateway");
  const runner = async (args: string[]) => ({ args, moved: true });

  assert.deepEqual(await invokeCanvasTool("clash_canvas_move", {
    nodeId: "note-1",
    x: 90,
    y: 140,
  }, runner), {
    args: ["canvas", "move", "--node", "note-1", "--x", "90", "--y", "140", "--json"],
    moved: true,
  });
});

test("CLI runner returns structured JSON without leaking protocol output", async () => {
  const { createClashCliRunner } = await import("./canvas-gateway");
  const runner = createClashCliRunner({
    command: process.execPath,
    argsPrefix: ["-e", "console.log(JSON.stringify({args: process.argv.slice(2)}))", "clash"],
  });

  assert.deepEqual(await runner(["canvas", "list", "--json"]), {
    args: ["canvas", "list", "--json"],
  });
});
