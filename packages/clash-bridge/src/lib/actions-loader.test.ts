import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ActionsHost } from "./actions-loader";

it("ActionsHost scans actions under CLASH_HOME", async () => {
  const originalClashHome = process.env.CLASH_HOME;
  const clashHome = await mkdtemp(join(tmpdir(), "clash-actions-home-"));
  process.env.CLASH_HOME = clashHome;
  const host = new ActionsHost({
    serverUrl: "http://127.0.0.1:49321",
    apiKey: "clsh_test",
    runtimeId: "runtime-test",
  });

  try {
    const result = await host.start();

    expect(result.spawned).toEqual([]);
    expect((await stat(join(clashHome, "actions"))).isDirectory()).toBe(true);
  } finally {
    await host.stopAll();
    if (originalClashHome === undefined) {
      delete process.env.CLASH_HOME;
    } else {
      process.env.CLASH_HOME = originalClashHome;
    }
  }
});
