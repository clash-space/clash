import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readAssetMetadataBody } from "../lib/attach-asset-metadata";
import { applyProductionMetadataProjection } from "../lib/production-actions";
import { attachTranscript } from "../lib/attach-transcript";

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "clash-attach-metadata-"));
  const dataDir = await mkdtemp(join(tmpdir(), "clash-attach-data-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  await mkdir(join(cwd, "assets"), { recursive: true });
  await writeFile(
    assetsPath,
    JSON.stringify({ assets: [{ id: "asset-talk", type: "video", metadata: {} }] }, null, 2),
    "utf8",
  );
  return { cwd, dataDir, assetsPath };
}

function transcriptBody(wordCount: number, overrides: Record<string, unknown> = {}) {
  const words = Array.from({ length: wordCount }, (_, index) => ({
    id: `w${index}`,
    text: `word${index}`,
    startMs: index * 400,
    endMs: index * 400 + 300,
  }));
  return {
    schemaVersion: 1,
    kind: "clash.asr.timed-transcript",
    timebase: "milliseconds",
    alignment: "word",
    text: words.map((word) => word.text).join(" "),
    backendId: "mlx-whisper",
    modelId: "mlx-community/whisper-small-mlx",
    language: "zh",
    durationMs: wordCount * 400,
    words,
    segments: [],
    ...overrides,
  };
}

const sourceHash = `sha256:${"a".repeat(64)}`;

test("attaches transcript identity to an asset while the body goes to the blob store", async () => {
  const { cwd, dataDir, assetsPath } = await workspace();
  const body = transcriptBody(2_000);

  const result = await attachTranscript({
    cwd,
    dataDir,
    assetsPath,
    assetId: "asset-talk",
    transcript: body,
    sourceHash,
  });

  assert.match(result.body?.contentHash ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.ok((result.body?.bytes ?? 0) > 100_000, "the body really is large");
  assert.equal(result.summary.wordCount, 2_000);

  const manifest = JSON.parse(await readFile(assetsPath, "utf8"));
  const attached = manifest.assets[0].metadata["media.transcript"];
  // Grid identity and blob address are different facts and must stay separate.
  assert.equal(attached.contentHash, result.contentHash);
  assert.equal(attached.bodyHash, result.body?.contentHash);
  assert.notEqual(attached.contentHash, attached.bodyHash);
  assert.equal(attached.words, undefined);
  assert.equal(attached.transcript, undefined);
  assert.ok(
    JSON.stringify(manifest).length < 2_000,
    `manifest stayed small, got ${JSON.stringify(manifest).length} bytes`,
  );
  assert.equal(attached.backendId, "mlx-whisper");
  assert.equal(attached.modelId, "mlx-community/whisper-small-mlx");

  assert.deepEqual(
    await readAssetMetadataBody({ dataDir, contentHash: result.body!.contentHash }),
    JSON.parse(JSON.stringify(body)),
  );
});

test("keeps one grid identity when the same words are restated differently", async () => {
  const { cwd, dataDir, assetsPath } = await workspace();

  const first = await attachTranscript({
    cwd,
    dataDir,
    assetsPath,
    assetId: "asset-talk",
    transcript: transcriptBody(20),
    sourceHash,
  });
  const reflowed = await attachTranscript({
    cwd,
    dataDir,
    assetsPath,
    assetId: "asset-talk",
    transcript: transcriptBody(20, {
      text: "COMPLETELY DIFFERENT RESTATEMENT",
      segments: [
        { id: "s1", text: "chunk", startMs: 0, endMs: 300, wordIds: ["w0"] },
      ],
    }),
    sourceHash,
  });

  // Downstream wordIds still align, so the grid identity must not move...
  assert.equal(reflowed.contentHash, first.contentHash);
  // ...but it is a different document, so the blob address must.
  assert.notEqual(reflowed.body?.contentHash, first.body?.contentHash);
});

test("never writes an action file the agent would have to shepherd", async () => {
  const { cwd, dataDir, assetsPath } = await workspace();

  await attachTranscript({
    cwd,
    dataDir,
    assetsPath,
    assetId: "asset-talk",
    transcript: transcriptBody(10),
    sourceHash,
  });

  const entries = await readdir(cwd);
  assert.equal(entries.includes("actions"), false, "no actions/ directory was created");

  // Provenance survives anyway: the ledger records the synthesized action.
  const manifest = JSON.parse(await readFile(assetsPath, "utf8"));
  const [fill] = manifest.assets[0].metadata.metadataFills;
  assert.match(fill.actionId, /^attach-/);
  assert.equal(fill.producer, "clash.local.asr");
  assert.equal(fill.metadataKind, "media.transcript");
});

test("deduplicates an identical body instead of storing it twice", async () => {
  const { cwd, dataDir, assetsPath } = await workspace();
  const attach = () =>
    attachTranscript({
      cwd,
      dataDir,
      assetsPath,
      assetId: "asset-talk",
      transcript: transcriptBody(10),
      sourceHash,
    });

  const first = await attach();
  const second = await attach();

  assert.equal(second.body?.contentHash, first.body?.contentHash);
  assert.equal(first.body?.deduplicated, false);
  assert.equal(second.body?.deduplicated, true);
});

test("refuses a transcript whose words carry no usable timing", async () => {
  const { cwd, dataDir, assetsPath } = await workspace();

  await assert.rejects(
    attachTranscript({
      cwd,
      dataDir,
      assetsPath,
      assetId: "asset-talk",
      transcript: transcriptBody(2, { words: [{ id: "w0", text: "hi" }] }),
      sourceHash,
    }),
  );
});

test("lets an agent CAS-edit a registry kind's projection like any other metadata", async () => {
  const { cwd, dataDir, assetsPath } = await workspace();
  const attached = await attachTranscript({
    cwd,
    dataDir,
    assetsPath,
    assetId: "asset-talk",
    transcript: transcriptBody(10),
    sourceHash,
  });

  // Agent edits the projected identity file, then applies it back with CAS.
  const projectionPath = join(cwd, "projections", "metadata", "asset-talk.media.transcript.json");
  const projected = JSON.parse(await readFile(projectionPath, "utf8"));
  projected.language = "en";
  await writeFile(projectionPath, JSON.stringify(projected, null, 2), "utf8");

  const applied = await applyProductionMetadataProjection({
    cwd,
    filePath: projectionPath,
    assetsPath,
    expectedVersion: attached.version,
  });
  assert.equal(applied.metadataKind, "media.transcript");

  const manifest = JSON.parse(await readFile(assetsPath, "utf8"));
  const attachedIdentity = manifest.assets[0].metadata["media.transcript"];
  // A registry identity is attached as itself: the edit landed, and its own
  // bodyHash keeps blob-address semantics rather than becoming a CAS stub.
  assert.equal(attachedIdentity.language, "en");
  assert.equal(attachedIdentity.body, undefined);

  // A second apply against the stale version is refused.
  await assert.rejects(
    applyProductionMetadataProjection({
      cwd,
      filePath: projectionPath,
      assetsPath,
      expectedVersion: attached.version,
    }),
    /STALE_READ/,
  );
});
