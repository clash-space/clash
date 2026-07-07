import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProjectionLockFilePath,
  hashProjectionContent,
  resolveProjectionLockPath,
} from "./projection-cas";

test("projection CAS helper hashes content and resolves default lock sidecars", () => {
  assert.match(hashProjectionContent("first draft"), /^[a-f0-9]{16}$/);
  assert.equal(hashProjectionContent("first draft"), hashProjectionContent("first draft"));
  assert.notEqual(hashProjectionContent("first draft"), hashProjectionContent("second draft"));
  assert.equal(
    resolveProjectionLockPath("/tmp/project/projections/text/script.md"),
    "/tmp/project/projections/text/script.lock.json",
  );
  assert.equal(
    resolveProjectionLockPath("/tmp/project/timelines/main.timeline.yaml"),
    "/tmp/project/timelines/main.timeline.lock.json",
  );
});

test("projection CAS helper enforces lock file path binding", () => {
  assert.deepEqual(
    assertProjectionLockFilePath({
      label: "text",
      lockFilePath: "projections/text/script.md",
      filePath: "/tmp/project/projections/text/script.md",
      cwd: "/tmp/project",
      readCommand: "clash text pull",
      writeVerb: "Apply",
    }),
    { ok: true },
  );

  const result = assertProjectionLockFilePath({
    label: "timeline",
    lockFilePath: "/tmp/project/timelines/main.timeline.yaml",
    filePath: "/tmp/project/timelines/other.timeline.yaml",
    cwd: "/tmp/project",
    readCommand: "clash timeline pull",
    writeVerb: "Apply",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Projection file path does not match timeline CAS lock/);
    assert.match(result.error, /Apply file is/);
    assert.match(result.error, /clash timeline pull/);
  }

  assert.deepEqual(
    assertProjectionLockFilePath({
      label: "timeline",
      lockFilePath: "/tmp/project/timelines/main.timeline.yaml",
      filePath: "/tmp/project/timelines/other.timeline.yaml",
      cwd: "/tmp/project",
      readCommand: "clash timeline pull",
      writeVerb: "Apply",
      force: true,
    }),
    { ok: true },
  );
});
