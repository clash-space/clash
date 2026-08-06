import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("workspace scripts expose symmetric dev and production CLI and MCP entrypoints", async () => {
  const workspace = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.match(workspace.scripts["clash:dev"] ?? "", /--profile dev$/);
  assert.match(workspace.scripts["clash:prod"] ?? "", /--profile prod$/);
  assert.match(workspace.scripts["mcp:dev"] ?? "", /--profile dev mcp serve --stdio$/);
  assert.match(workspace.scripts["mcp:prod"] ?? "", /--profile prod mcp serve --stdio$/);
});

test("global --profile selects development before host discovery", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "src/index.ts", "--profile", "dev", "host", "status", "--json"],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        CLASH_PROFILE: "prod",
      },
    },
  );

  const output = JSON.parse(stdout) as { profile?: string };
  assert.equal(output.profile, "dev");
});

test("global --profile rejects unknown channels", async () => {
  await assert.rejects(
    execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/index.ts", "--profile", "staging", "host", "status", "--json"],
      { cwd: new URL("..", import.meta.url) },
    ),
    /CLASH_PROFILE must be dev or prod/,
  );
});
