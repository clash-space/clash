import test from "node:test";
import assert from "node:assert/strict";

test("Clash MCP namespace tools expose every public product command except recursive MCP launch", async () => {
  const module = await import("./cli-contract") as Record<string, unknown>;
  assert.deepEqual(module.CLASH_CLI_NAMESPACES, [
    "init", "projects", "canvas", "canvases", "tasks", "action", "models",
    "host", "timeline", "director", "doctor", "text", "production", "assets",
    "audit", "effect", "auth",
  ]);
});

test("namespace tools pass argv without shell interpretation and block recursive MCP launch", async () => {
  const module = await import("./cli-contract") as Record<string, unknown>;
  assert.equal(typeof module.buildCliNamespaceArgs, "function");
  const build = module.buildCliNamespaceArgs as (name: string, input: { args?: string[] }) => string[];

  assert.deepEqual(build("clash_cli_timeline", { args: ["list", "--json"] }), ["timeline", "list", "--json"]);
  assert.deepEqual(build("clash_cli_effect", { args: ["list", "--json"] }), ["effect", "list", "--json"]);
  assert.deepEqual(build("clash_cli_director", { args: ["list", "--json"] }), ["director", "list", "--json"]);
  assert.throws(() => build("clash_cli_mcp", { args: ["serve"] }), /not exposed/i);
});
