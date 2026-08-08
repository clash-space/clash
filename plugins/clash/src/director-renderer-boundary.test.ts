import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the persistent daemon packages the real DirectorViewport browser renderer", async () => {
  const [entry, hostBuild] = await Promise.all([
    readFile(new URL("./local-api-entry.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-host-runtime.ts", import.meta.url), "utf8"),
  ]);
  assert.match(entry, /createHeadlessDirectorStageRenderer/);
  assert.match(entry, /new URL\("\.\/director-bundle"/);
  assert.match(entry, /directorStageRenderer,/);
  assert.match(hostBuild, /headless-entry\.tsx/);
  assert.match(hostBuild, /director-bundle/);
  assert.match(hostBuild, /packages[\s\S]*director-ui[\s\S]*assets/);
  const directorBlock = entry.slice(
    entry.indexOf("const directorStageRenderer"),
    entry.indexOf("const runDir"),
  );
  assert.doesNotMatch(directorBlock, /renderStill|renderMedia/);
});
