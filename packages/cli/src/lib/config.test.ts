import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configFilePath,
  loadConfig,
  saveConfig,
} from "./config";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "clash-cli-config-"));
}

test("config path honors CLASH_HOME", () => {
  assert.equal(
    configFilePath({ CLASH_HOME: "/tmp/clash-home" }),
    "/tmp/clash-home/config.json",
  );
});

test("saved CLI config uses owner-only permissions", async () => {
  const originalClashHome = process.env.CLASH_HOME;
  const clashHome = await tempDir();
  process.env.CLASH_HOME = clashHome;
  try {
    saveConfig({ apiKey: "clsh_test", serverUrl: "http://localhost:8788" });

    assert.deepEqual(loadConfig(), {
      apiKey: "clsh_test",
      serverUrl: "http://localhost:8788",
    });
    const info = await stat(configFilePath());
    assert.equal(info.mode & 0o777, 0o600);
  } finally {
    if (originalClashHome === undefined) {
      delete process.env.CLASH_HOME;
    } else {
      process.env.CLASH_HOME = originalClashHome;
    }
  }
});
