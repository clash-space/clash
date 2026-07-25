import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

test("recognizes both relative and absolute executable entry paths", async () => {
  const module = await import("./index.js") as Record<string, any>;
  assert.equal(typeof module.isDirectExecution, "function");
  const cwd = "/workspace";
  const absolute = join(cwd, "runtime", "index.js");
  const moduleUrl = pathToFileURL(absolute).href;

  assert.equal(module.isDirectExecution(moduleUrl, "runtime/index.js", cwd), true);
  assert.equal(module.isDirectExecution(moduleUrl, absolute, cwd), true);
  assert.equal(module.isDirectExecution(moduleUrl, "runtime/other.js", cwd), false);
});
