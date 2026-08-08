import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

for (const entry of ["index.ts", "plugin.ts"] as const) {
  test(`the ${entry} Clash CLI entry emits native lifecycle evidence without a wrapper`, async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-cli-trace-"));
    const tracePath = join(root, "nested", "cli-events.jsonl");
    try {
      const require = createRequire(import.meta.url);
      const child = spawnSync(process.execPath, [
        "--import",
        require.resolve("tsx"),
        new URL(`../${entry}`, import.meta.url).pathname,
        "--version",
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          CLASH_CLI_TRACE_PATH: tracePath,
        },
      });
      assert.equal(child.status, 0, child.stderr);
      const events = (await readFile(tracePath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(events.map((event) => event.type), [
        "clash.cli.started",
        "clash.cli.completed",
      ]);
      assert.deepEqual(events[0].argv, ["--version"]);
      assert.equal(events[1].exitCode, 0);
      assert.equal(events[1].pid, events[0].pid);
      assert.equal(typeof events[1].durationMs, "number");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
