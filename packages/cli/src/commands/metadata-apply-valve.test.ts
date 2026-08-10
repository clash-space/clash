import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  applyProductionMetadataAction,
  applyProductionMetadataProjection,
} from "../lib/production-actions";

/**
 * The generic CAS valve that survived the production-family removal: file
 * actions for declared kinds, path safety, and the projection edit loop.
 */

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "clash-apply-valve-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  await mkdir(join(cwd, "assets"), { recursive: true });
  await writeFile(
    assetsPath,
    JSON.stringify({ assets: [{ id: "asset-talk", type: "video", metadata: {} }] }),
    "utf8",
  );
  return { cwd, assetsPath };
}

function descriptionAction() {
  return {
    actionId: "action-describe",
    targetAssetId: "asset-talk",
    metadataKind: "media.description",
    producer: "clash.local.aigc",
    metadata: {
      schemaVersion: 1,
      kind: "media.description",
      text: "A host waves at the camera.",
      language: "en",
      sourceHash: `sha256:${"a".repeat(64)}`,
    },
  };
}

test("applies a declared kind from an action file through the generic valve", async () => {
  const { cwd, assetsPath } = await workspace();
  const actionPath = join(cwd, "actions", "describe.json");
  await mkdir(join(cwd, "actions"), { recursive: true });
  await writeFile(actionPath, JSON.stringify(descriptionAction()), "utf8");

  const result = await applyProductionMetadataAction({ cwd, actionPath, assetsPath });

  assert.equal(result.metadataKind, "media.description");
  const manifest = JSON.parse(await readFile(assetsPath, "utf8"));
  assert.equal(
    manifest.assets[0].metadata["media.description"].text,
    "A host waves at the camera.",
  );
});

test("refuses a retired workflow kind exactly like any undeclared kind", async () => {
  const { cwd, assetsPath } = await workspace();
  const actionPath = join(cwd, "actions", "beat.json");
  await mkdir(join(cwd, "actions"), { recursive: true });
  await writeFile(
    actionPath,
    JSON.stringify({
      actionId: "action-beat",
      targetAssetId: "asset-talk",
      metadataKind: "audio.beat-analysis",
      producer: "qa",
      metadata: { kind: "audio.beat-analysis", bpm: 120 },
    }),
    "utf8",
  );

  await assert.rejects(
    applyProductionMetadataAction({ cwd, actionPath, assetsPath }),
    /Undeclared asset metadata kind: audio\.beat-analysis/,
  );
});

test("rejects action files outside the project cwd", async () => {
  const { cwd, assetsPath } = await workspace();
  const outside = await mkdtemp(join(tmpdir(), "clash-apply-outside-"));
  const outsideAction = join(outside, "describe.json");
  await writeFile(outsideAction, JSON.stringify(descriptionAction()), "utf8");
  await mkdir(join(cwd, "actions"), { recursive: true });
  await symlink(outsideAction, join(cwd, "actions", "describe.json"));

  await assert.rejects(
    applyProductionMetadataAction({
      cwd,
      actionPath: join(cwd, "actions", "describe.json"),
      assetsPath,
    }),
    /symlink|outside/i,
  );
});

test("CAS-edits a declared kind's projection and refuses the stale second apply", async () => {
  const { cwd, assetsPath } = await workspace();
  const attached = await applyProductionMetadataAction({
    cwd,
    assetsPath,
    action: descriptionAction(),
  });

  const projected = JSON.parse(await readFile(attached.metadataPath, "utf8"));
  projected.text = "A host waves, then points at the chart.";
  await writeFile(attached.metadataPath, JSON.stringify(projected, null, 2), "utf8");

  const applied = await applyProductionMetadataProjection({
    cwd,
    filePath: attached.metadataPath,
    assetsPath,
    expectedVersion: attached.version,
  });
  const manifest = JSON.parse(await readFile(assetsPath, "utf8"));
  assert.equal(
    manifest.assets[0].metadata["media.description"].text,
    "A host waves, then points at the chart.",
  );

  await assert.rejects(
    applyProductionMetadataProjection({
      cwd,
      filePath: attached.metadataPath,
      assetsPath,
      expectedVersion: attached.version,
    }),
    /STALE_READ/,
  );
  assert.equal(typeof applied.version, "string");
});
