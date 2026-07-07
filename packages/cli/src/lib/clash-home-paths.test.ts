import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { localActionsDir } from "../commands/actions";
import { assetCacheDir } from "../commands/canvas";
import { daemonSocketDir } from "./daemon";
import { getDefaultHostDiscoveryRunDir } from "./host-discovery";

test("CLASH_HOME scopes local action, cache, socket, and host discovery paths", () => {
  const originalClashHome = process.env.CLASH_HOME;
  const clashHome = "/tmp/clash-home-paths";
  process.env.CLASH_HOME = clashHome;
  try {
    assert.equal(localActionsDir(), join(clashHome, "actions"));
    assert.equal(assetCacheDir(), join(clashHome, "cache", "assets"));
    assert.equal(daemonSocketDir(), join(clashHome, "sockets"));
    assert.equal(getDefaultHostDiscoveryRunDir(), join(clashHome, "run"));
  } finally {
    if (originalClashHome === undefined) {
      delete process.env.CLASH_HOME;
    } else {
      process.env.CLASH_HOME = originalClashHome;
    }
  }
});
