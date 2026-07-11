import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertProjectionFilePathInsideCwd,
  hashProjectionContent,
} from "./projection-cas";

test("projection CAS has no legacy lock-sidecar API", () => {
  const source = readFileSync(new URL("./projection-cas.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /ProjectionLock|createProjectionLock|parseProjectionLock|resolveProjectionLock|assertProjectionLock/);
});

test("projection CAS helper hashes content", () => {
  assert.match(hashProjectionContent("first draft"), /^[a-f0-9]{16}$/);
  assert.equal(hashProjectionContent("first draft"), hashProjectionContent("first draft"));
  assert.notEqual(hashProjectionContent("first draft"), hashProjectionContent("second draft"));
});

test("projection CAS helper keeps projection files inside the current project cwd", () => {
  const outside = assertProjectionFilePathInsideCwd({
    filePath: "/tmp/other-project/projections/text/script.md",
    cwd: "/tmp/project",
    writeVerb: "Apply",
  });

  assert.equal(outside.ok, false);
  if (!outside.ok) {
    assert.match(outside.error, /Projection file path must stay inside the current project cwd/);
  }

  const traversal = assertProjectionFilePathInsideCwd({
    filePath: "../other-project/timelines/main.timeline.yaml",
    cwd: "/tmp/project",
    writeVerb: "Apply",
  });

  assert.equal(traversal.ok, false);
  if (!traversal.ok) {
    assert.match(traversal.error, /Projection file path must stay inside the current project cwd/);
  }

  const outsideWithoutLock = assertProjectionFilePathInsideCwd({
    filePath: "/tmp/other-project/timelines/main.timeline.yaml",
    cwd: "/tmp/project",
    writeVerb: "Apply",
  });

  assert.equal(outsideWithoutLock.ok, false);
  if (!outsideWithoutLock.ok) {
    assert.match(outsideWithoutLock.error, /Projection file path must stay inside the current project cwd/);
    assert.doesNotMatch(outsideWithoutLock.error, /--force/);
  }
});

test("projection CAS helper rejects symlinked projection parents that resolve outside cwd", () => {
  const root = mkdtempSync(join(tmpdir(), "clash-projection-cas-"));
  const cwd = join(root, "project");
  const outside = join(root, "outside");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(cwd, "projections"), "dir");

  const filePath = join(cwd, "projections", "text", "script.md");
  const result = assertProjectionFilePathInsideCwd({
    filePath,
    cwd,
    writeVerb: "Apply",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Projection file path must not traverse a symlink outside the current project cwd/);
  }
});
