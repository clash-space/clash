import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { listDeclaredAssetMetadataKinds } from "@clash/shared-types";

import { attachAssetMetadata } from "../lib/attach-asset-metadata";
import { loadWorkspaceMetadataKinds } from "../lib/workspace-metadata-kinds";

let sequence = 0;

async function workspaceWithDeclaration(declaration: unknown) {
  const cwd = await mkdtemp(join(tmpdir(), "clash-custom-kind-"));
  const dataDir = await mkdtemp(join(tmpdir(), "clash-custom-kind-data-"));
  await mkdir(join(cwd, ".clash", "metadata-kinds"), { recursive: true });
  await writeFile(
    join(cwd, ".clash", "metadata-kinds", "declaration.json"),
    JSON.stringify(declaration, null, 2),
    "utf8",
  );
  const assetsPath = join(cwd, "assets", "manifest.json");
  await mkdir(join(cwd, "assets"), { recursive: true });
  await writeFile(
    assetsPath,
    JSON.stringify({ assets: [{ id: "asset-clip", type: "video", metadata: {} }] }),
    "utf8",
  );
  return { cwd, dataDir, assetsPath };
}

function shotNotesDeclaration(kind: string) {
  return {
    kind,
    schema: {
      type: "object",
      required: ["kind", "schemaVersion", "mood"],
      additionalProperties: false,
      properties: {
        kind: { const: kind },
        schemaVersion: { const: 1 },
        mood: { enum: ["calm", "tense", "playful"] },
        bodyHash: { type: "string" },
      },
    },
  };
}

test("a workspace declares a custom kind as data and attaches through the generic trunk", async () => {
  const kind = `team.shot-notes-${++sequence}`;
  const { cwd, dataDir, assetsPath } = await workspaceWithDeclaration(shotNotesDeclaration(kind));

  const loaded = await loadWorkspaceMetadataKinds(cwd);
  assert.deepEqual(loaded.map((entry) => entry.kind), [kind]);
  assert.ok(listDeclaredAssetMetadataKinds().includes(kind));

  const result = await attachAssetMetadata({
    cwd,
    dataDir,
    assetsPath,
    assetId: "asset-clip",
    metadataKind: kind,
    producer: "qa-fixture",
    metadata: { schemaVersion: 1, mood: "tense" },
    body: { notes: ["hold on the door", "cut on the slam"] },
  });
  assert.equal(result.attached, true);

  const manifest = JSON.parse(await readFile(assetsPath, "utf8"));
  const attached = manifest.assets[0].metadata[kind];
  assert.equal(attached.mood, "tense");
  assert.match(attached.bodyHash, /^sha256:/);
  assert.equal(attached.notes, undefined);
});

test("rejects a custom-kind payload its own schema refuses", async () => {
  const kind = `team.shot-notes-${++sequence}`;
  const { cwd, dataDir, assetsPath } = await workspaceWithDeclaration(shotNotesDeclaration(kind));

  await assert.rejects(
    attachAssetMetadata({
      cwd,
      dataDir,
      assetsPath,
      assetId: "asset-clip",
      metadataKind: kind,
      producer: "qa-fixture",
      metadata: { schemaVersion: 1, mood: "furious" },
    }),
    /mood/,
  );
});

test("refuses to redeclare a product-declared kind from a workspace", async () => {
  const { cwd } = await workspaceWithDeclaration({
    kind: "media.transcript",
    schema: {
      type: "object",
      required: ["kind", "schemaVersion"],
      properties: { kind: { const: "media.transcript" }, schemaVersion: { const: 1 } },
    },
  });

  await assert.rejects(loadWorkspaceMetadataKinds(cwd), /already declared/);
});

test("refuses a declaration whose schema does not pin kind and schemaVersion", async () => {
  const kind = `team.unpinned-${++sequence}`;
  const { cwd } = await workspaceWithDeclaration({
    kind,
    schema: { type: "object", properties: { anything: { type: "string" } } },
  });

  await assert.rejects(loadWorkspaceMetadataKinds(cwd), /must pin "kind"/);
});
