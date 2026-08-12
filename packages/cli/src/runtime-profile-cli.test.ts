import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("workspace scripts expose CLI profiles while the clash package owns the MCP entrypoint", async () => {
  const workspace = JSON.parse(
    await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as {
    scripts: Record<string, string>;
  };
  const mcp = JSON.parse(
    await readFile(
      new URL("../../../plugins/clash/.mcp.json", import.meta.url),
      "utf8",
    ),
  ) as { mcpServers?: { clash?: { command?: string; args?: string[] } } };
  assert.match(workspace.scripts["clash:dev"] ?? "", /--profile dev$/);
  assert.match(workspace.scripts["clash:prod"] ?? "", /--profile prod$/);
  assert.match(workspace.scripts["clash:dev"] ?? "", /src\/dispatcher\.ts/);
  assert.match(workspace.scripts["mcp:dev"] ?? "", /--profile dev mcp$/);
  assert.equal(workspace.scripts["mcp:prod"], undefined);
  assert.deepEqual(mcp.mcpServers?.clash, {
    command: "node",
    args: ["./runtime/dispatcher.js", "mcp"],
    cwd: ".",
    env: { CLASH_PROFILE: "prod" },
  });
});

test("global --profile selects development before host discovery", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/index.ts",
      "--profile",
      "dev",
      "host",
      "status",
      "--json",
    ],
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
      [
        "--import",
        "tsx",
        "src/index.ts",
        "--profile",
        "staging",
        "host",
        "status",
        "--json",
      ],
      { cwd: new URL("..", import.meta.url) },
    ),
    /CLASH_PROFILE must be dev or prod/,
  );
});
