import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canvasCommand } from "./canvas";
import { timelineCommand } from "./timeline";

test("removes legacy first-party MG production commands in favor of the Remotion Canvas and Timeline route", () => {
  const legacyCommands = new Set([
    "render-mg",
    "verify-mg-preview",
    "export-mg-snapshots",
    "export-mg-video",
    "project-composition-timeline",
  ]);

  // The whole production command family is retired with the workflow kinds.
  assert.equal(
    existsSync(new URL("./production.ts", import.meta.url)),
    false,
    "commands/production.ts must stay deleted",
  );
  void legacyCommands;

  const canvasAdd = canvasCommand.commands.find((command) => command.name() === "add");
  assert.ok(canvasAdd, "canvas add must remain the Remotion authoring route");
  assert.match(
    canvasAdd.options.find((option) => option.long === "--type")?.description ?? "",
    /remotion/i,
  );

  const timelineRender = timelineCommand.commands.find((command) => command.name() === "render");
  assert.ok(timelineRender, "timeline render must remain the Remotion rendering route");
  assert.match(timelineRender.description(), /remotion|render/i);

  for (const legacyLibrary of [
    "mg-production.ts",
    "mg-preview-verification.ts",
    "mg-snapshot-export.ts",
    "mg-video-export.ts",
    "composition-timeline-projection.ts",
  ]) {
    assert.equal(
      existsSync(new URL(`../lib/${legacyLibrary}`, import.meta.url)),
      false,
      `${legacyLibrary} must be deleted instead of left as an unregistered implementation`,
    );
  }

  const thisTest = fileURLToPath(import.meta.url);
  const sourceRoot = dirname(dirname(thisTest));
  const legacyToken = /(?:\bmg\b|renderMgProductionProjection|verifyMgPreview|exportMgSnapshotAsset|exportMgVideoAsset|mg-render|mg\.snapshot-export|mg\.video-export|clash\.mg\.|projections\/mg|\.mg\.timeline|__CLASH_MG__|clash-mg-frame)/i;
  const offenders = listTypeScriptFiles(sourceRoot)
    .filter((filePath) => filePath !== thisTest)
    .filter((filePath) => legacyToken.test(readFileSync(filePath, "utf8")));
  assert.deepEqual(offenders, [], "legacy first-party MG tokens must not remain in CLI source");
});

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}
