import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);

test("the packaged Host declares media installers for ignore-scripts staging", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { dependencies?: Record<string, string> };

  assert.equal(packageJson.dependencies?.["@ffmpeg-installer/ffmpeg"], "1.1.0");
  assert.equal(
    packageJson.dependencies?.["@ffprobe-installer/ffprobe"],
    "2.1.2",
  );
});

test("the selected installers cover every Desktop release target", () => {
  const ffmpeg = require("@ffmpeg-installer/ffmpeg/package.json") as {
    optionalDependencies?: Record<string, string>;
  };
  const ffprobe = require("@ffprobe-installer/ffprobe/package.json") as {
    optionalDependencies?: Record<string, string>;
  };

  for (const target of ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"])
    assert.ok(
      ffmpeg.optionalDependencies?.[`@ffmpeg-installer/${target}`],
      `ffmpeg installer is missing ${target}`,
    );
  for (const target of ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"])
    assert.ok(
      ffprobe.optionalDependencies?.[`@ffprobe-installer/${target}`],
      `ffprobe installer is missing ${target}`,
    );
});
