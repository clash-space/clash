import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { assetCacheDir } from "../commands/canvas";
import { getDefaultHostDiscoveryRunDir } from "./host-discovery";
import { resolveClashRoot } from "./clash-home";

test("CLASH_PROFILE=dev selects the isolated development home", () => {
  assert.equal(
    resolveClashRoot({ CLASH_PROFILE: "dev" }),
    join(homedir(), ".clash", "profiles", "dev"),
  );
});

test("CLASH_HOME scopes client cache and host discovery paths", () => {
  const originalClashHome = process.env.CLASH_HOME;
  const clashHome = "/tmp/clash-home-paths";
  process.env.CLASH_HOME = clashHome;
  try {
    assert.equal(assetCacheDir(), join(clashHome, "cache", "assets"));
    assert.equal(getDefaultHostDiscoveryRunDir(), join(clashHome, "run"));
  } finally {
    if (originalClashHome === undefined) {
      delete process.env.CLASH_HOME;
    } else {
      process.env.CLASH_HOME = originalClashHome;
    }
  }
});
