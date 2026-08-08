import test from "node:test";
import assert from "node:assert/strict";

test("stdio MCP exposes Director capture as a peer of the native CLI command", async () => {
  const contract = await import("./contract.js").catch(() => ({} as Record<string, any>));
  assert.equal(contract.DIRECTOR_PLUGIN_TOOL_NAMES?.includes("clash_director_capture"), true);
  assert.deepEqual(contract.buildDirectorCliArgs("clash_director_capture", {
    cwd: "/workspace",
    stageId: "stage-a",
    times: [0, 1.25, 2.5],
    labels: ["frame-opening", "frame-action", "frame-closing"],
    outputDir: "evidence/director",
    longEdge: 1280,
  }), [
    "director", "capture", "--stage", "stage-a",
    "--time", "0", "--time", "1.25", "--time", "2.5",
    "--label", "frame-opening", "--label", "frame-action", "--label", "frame-closing",
    "--output-dir", "evidence/director", "--long-edge", "1280", "--json",
  ]);
});
