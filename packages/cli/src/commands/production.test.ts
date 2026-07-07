import test from "node:test";
import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { cp } from "node:fs/promises";
import { createRequire } from "node:module";
import { timelineDslFromYaml, timelineDslHash } from "@clash/shared-types";
import { productionCommand } from "./production";
import { assertTimelineCas, createTimelineAppliedRevision, createTimelineLock, parseTimelineFileForApply } from "./timeline";
import { applyProductionMetadataAction, applyProductionMetadataProjection } from "../lib/production-actions";
import { renderMgProductionProjection } from "../lib/mg-production";
import { exportMgSnapshotAsset } from "../lib/mg-snapshot-export";
import { planTalkingHeadTextCutAction } from "../lib/talking-head-plan";
import { analyzeWavBeatAction } from "../lib/audio-beat-analysis";
import { planReferenceReviewAction } from "../lib/reference-review-plan";
import { planStoryboardConsistencyAction } from "../lib/storyboard-plan";

function expectedTimelineCasApply(filePath: string) {
  return {
    target: "timeline",
    mutation: "projection-only",
    applyCommand: "clash timeline apply",
    filePath,
    lockPath: "timelines/main.timeline.lock.json",
    lockRequired: true,
    lockSource: "fresh-canvas-pull",
    nodeIdPlaceholder: "<video-editor-node-id>",
    requiredRuntimeArgs: ["--node <video-editor-node-id>"],
    pullCommand: "clash timeline pull",
    pullArgs: ["--node", "<video-editor-node-id>", "--file", "timelines/main.timeline.yaml"],
    applyArgs: ["--node", "<video-editor-node-id>", "--file", filePath, "--lock", "timelines/main.timeline.lock.json"],
  };
}

test("registers a top-level production command for action-driven media workflows", () => {
  const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

  assert.match(indexSource, /import \{ productionCommand \} from "\.\/commands\/production"/);
  assert.match(indexSource, /program\.addCommand\(productionCommand\)/);
  assert.equal(productionCommand.name(), "production");
  assert.deepEqual(productionCommand.commands.map((command) => command.name()), [
    "apply-metadata",
    "apply-metadata-projection",
    "validate-pipeline-manifest",
    "render-mg",
    "verify-mg-preview",
    "plan-composition-route",
    "project-composition-timeline",
    "plan-review-gate",
    "approve-review-gate",
    "plan-dry-run-cost-gate",
    "plan-reference-roles",
    "plan-product-logo-qa",
    "plan-analysis-benchmark",
    "plan-image-embedding-store",
    "plan-audio-stem-separation",
    "plan-comfyui-workflow",
    "plan-content-credentials",
    "export-mg-snapshots",
    "export-mg-video",
    "project-derived-overlay",
    "plan-text-cut",
    "export-text-cut-media",
    "verify-caption-lineage",
    "export-captions",
    "project-caption-overlay",
    "export-caption-burn",
    "export-timeline-handoff",
    "analyze-audio-beats",
    "plan-lyrics-alignment",
    "plan-visual-moments",
    "project-mv-beat-cuts",
    "verify-mv-beat-sync",
    "plan-ad-delivery-spec",
    "extract-ad-visual-frames",
    "analyze-ad-visual-pixels",
    "plan-ad-visual-qa",
    "validate-ad-delivery-export",
    "plan-reference-review",
    "plan-reference-download",
    "execute-reference-download",
    "plan-reference-noncopying-qa",
    "verify-reference-isolation",
    "plan-storyboard-consistency-qa",
    "plan-storyboard-review",
    "project-storyboard-prompt-pack",
    "apply-storyboard-prompt-pack",
    "replace-storyboard-prompt-pack",
    "project-storyboard-timeline",
    "verify-storyboard-timeline",
  ]);
});

test("marketplace production actions point at registered CLI commands and contract tests", async () => {
  const registry = JSON.parse(
    await readFile(new URL("../../../../skills/registry.json", import.meta.url), "utf8"),
  );
  const registeredCommands = new Set(productionCommand.commands.map((command) => command.name()));

  for (const action of registry.actions) {
    const command = String(action.trigger?.command ?? "");
    const match = command.match(/^clash production ([A-Za-z0-9._-]+)$/);
    assert.ok(match, `${action.id} trigger command must be a direct clash production subcommand`);
    assert.ok(registeredCommands.has(match[1]), `${action.id} references unregistered production command ${match[1]}`);
    assert.ok(Array.isArray(action.contractTests), `${action.id} must declare contract tests`);
    assert.ok(
      action.contractTests.some((testCase: any) => testCase.path === "packages/cli/src/commands/production.test.ts"),
      `${action.id} must be covered by the production CLI contract test suite`,
    );
  }
});

test("runs production validate-pipeline-manifest over action metadata asset projection review export artifacts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-pipeline-"));
  await writeJson(join(cwd, "pipeline.manifest.json"), {
    schemaVersion: 1,
    projectKind: "short-drama",
    stages: ["brief", "analysis", "generate", "assemble", "review", "export"],
    editableFiles: ["brief/episode.md", "storyboards/episode-001.json"],
    protectedFiles: ["snapshot.bin", "local.sqlite"],
    requiredSystemCapabilities: ["timeline.cas-projection", "review.stage-gates"],
    artifacts: [
      { kind: "action", stage: "analysis", path: "actions/storyboard-review.json" },
      { kind: "metadata", stage: "analysis", path: "projections/metadata/asset-storyboard.image.storyboard-consistency.json" },
      { kind: "asset", stage: "generate", path: "assets/manifest.json" },
      { kind: "projection", stage: "assemble", path: "projections/timelines/asset-storyboard.storyboard.timeline.yaml", casRequired: true },
      { kind: "review-gate", stage: "review", path: "reviews/gates/export.review-gate.json" },
      { kind: "export", stage: "export", path: "exports/episode-001.mp4" },
    ],
  });
  await writeJson(join(cwd, "actions", "storyboard-review.json"), { actionId: "action-storyboard-review" });
  await writeJson(join(cwd, "projections", "metadata", "asset-storyboard.image.storyboard-consistency.json"), {
    kind: "image.storyboard-consistency",
  });
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-storyboard", type: "storyboard", metadata: {} }],
  });
  await writeJson(join(cwd, "projections", "timelines", "asset-storyboard.storyboard.timeline.yaml"), {
    tracks: [],
  });
  await writeJson(join(cwd, "reviews", "gates", "export.review-gate.json"), {
    kind: "clash.review.stage-gate",
    status: "approved",
  });

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = () => spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "validate-pipeline-manifest",
      "--pipeline",
      "pipeline.manifest.json",
      "--out",
      "qa/pipeline/episode-001.pipeline-validation.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  const blocked = runCli();
  assert.equal(blocked.status, 0, blocked.stderr);
  const blockedPayload = JSON.parse(blocked.stdout);
  assert.equal(blockedPayload.status, "blocked");
  assert.deepEqual(blockedPayload.missingArtifacts, ["exports/episode-001.mp4"]);
  assert.deepEqual(blockedPayload.coverage, {
    action: true,
    metadata: true,
    asset: true,
    projection: true,
    reviewGate: true,
    export: false,
  });

  await mkdir(join(cwd, "exports"), { recursive: true });
  await writeFile(join(cwd, "exports", "episode-001.mp4"), "placeholder video");
  const passed = runCli();
  assert.equal(passed.status, 0, passed.stderr);
  const payload = JSON.parse(passed.stdout);
  assert.equal(payload.status, "pass");
  assert.deepEqual(payload.missingArtifacts, []);
  assert.match(payload.reportPath, /qa\/pipeline\/episode-001\.pipeline-validation\.json$/);
  const report = JSON.parse(await readFile(payload.reportPath, "utf8"));
  assert.equal(report.kind, "clash.production.pipeline-validation");
  assert.equal(report.pipelinePath, "pipeline.manifest.json");
  assert.equal(report.artifacts.total, 6);
  assert.deepEqual(report.coverage, {
    action: true,
    metadata: true,
    asset: true,
    projection: true,
    reviewGate: true,
    export: true,
  });
  assert.deepEqual(report.casRequiredProjectionPaths, [
    "projections/timelines/asset-storyboard.storyboard.timeline.yaml",
  ]);
});

test("pipeline validation rejects symlinked report paths that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-pipeline-report-path-"));
  await writeJson(join(cwd, "pipeline.manifest.json"), {
    schemaVersion: 1,
    projectKind: "short-drama",
    stages: ["analysis"],
    artifacts: [
      { kind: "action", stage: "analysis", path: "actions/storyboard-review.json" },
      { kind: "metadata", stage: "analysis", path: "projections/metadata/storyboard.json" },
      { kind: "asset", stage: "analysis", path: "assets/manifest.json" },
      { kind: "projection", stage: "analysis", path: "projections/timelines/storyboard.yaml", casRequired: true },
    ],
  });
  const outside = join(cwd, "..", "outside-pipeline-report-path");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "qa", "pipeline"), { recursive: true });
  const outsideReportPath = join(outside, "pipeline-validation.json");
  await writeFile(outsideReportPath, "outside\n", "utf8");
  await symlink(outsideReportPath, join(cwd, "qa", "pipeline", "pipeline-validation.json"));

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const validated = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "validate-pipeline-manifest",
      "--pipeline",
      "pipeline.manifest.json",
      "--out",
      "qa/pipeline/pipeline-validation.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(validated.status, 1);
  assert.match(validated.stderr, /Agent file path must not traverse a symlink outside the current project cwd/);
  assert.equal(await readFile(outsideReportPath, "utf8"), "outside\n");
});

test("applies MV beat metadata to an audio asset and writes timeline edit hints", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-mv-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  const actionPath = join(cwd, "actions", "beat-fill.json");
  await writeJson(assetsPath, {
    assets: [{ id: "asset-song", type: "audio", metadata: {} }],
  });
  await writeJson(actionPath, {
    actionId: "action-beat-fill",
    targetAssetId: "asset-song",
    metadataKind: "audio.beat-analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.beat-analysis",
      bpm: 128,
      fps: 30,
      beats: [
        { frame: 0, timeSeconds: 0, confidence: 0.99, downbeat: true },
        { frame: 14, timeSeconds: 0.466, confidence: 0.94 },
      ],
      sections: [{ id: "intro", startFrame: 0, endFrame: 120, label: "intro" }],
    },
  });

  const result = await applyProductionMetadataAction({ cwd, actionPath, assetsPath });

  assert.equal(result.targetAssetId, "asset-song");
  assert.equal(result.metadataPath, join(cwd, "projections", "metadata", "asset-song.audio.beat-analysis.json"));
  assert.equal(result.metadataLockPath, join(cwd, "projections", "metadata", "asset-song.audio.beat-analysis.lock.json"));
  assert.equal(result.timelineProjectionPath, join(cwd, "projections", "timeline-hints", "asset-song.beat-hints.json"));
  assert.deepEqual(result.projectionLockPaths, [
    join(cwd, "projections", "metadata", "asset-song.audio.beat-analysis.lock.json"),
    join(cwd, "projections", "timeline-hints", "asset-song.beat-hints.lock.json"),
  ]);
  const metadataLock = JSON.parse(
    await readFile(result.metadataLockPath, "utf8"),
  );
  assert.equal(metadataLock.kind, "clash.asset.metadata.lock");
  assert.equal(metadataLock.projectionKind, "asset-metadata");
  assert.deepEqual(metadataLock.entity, { kind: "asset", id: "asset-song" });
  assert.equal(metadataLock.metadataKind, "audio.beat-analysis");
  assert.equal(metadataLock.filePath, "projections/metadata/asset-song.audio.beat-analysis.json");
  assert.equal(metadataLock.contentHash.length, 16);
  assert.equal(metadataLock.contentHash, metadataLock.metadataHash);
  assert.equal(metadataLock.sourceActionPath, "actions/beat-fill.json");
  assert.match(metadataLock.sourceActionHash, /^[a-f0-9]{16}$/);
  const hintsLock = JSON.parse(
    await readFile(join(cwd, "projections", "timeline-hints", "asset-song.beat-hints.lock.json"), "utf8"),
  );
  assert.equal(hintsLock.kind, "clash.asset.metadata.projection.lock");
  assert.equal(hintsLock.projectionKind, "audio-beat-hints");
  assert.deepEqual(hintsLock.entity, { kind: "asset", id: "asset-song" });
  assert.equal(hintsLock.metadataKind, "audio.beat-analysis");
  assert.equal(hintsLock.filePath, "projections/timeline-hints/asset-song.beat-hints.json");
  assert.equal(hintsLock.sourceMetadataPath, "projections/metadata/asset-song.audio.beat-analysis.json");
  assert.match(hintsLock.sourceMetadataHash, /^[a-f0-9]{16}$/);
  assert.match(hintsLock.sourceActionHash, /^[a-f0-9]{16}$/);
  const assets = JSON.parse(await readFile(assetsPath, "utf8"));
  assert.equal(assets.assets[0].metadata["audio.beat-analysis"].bpm, 128);
  const hints = JSON.parse(await readFile(result.timelineProjectionPath!, "utf8"));
  assert.deepEqual(hints.hints, [
    { frame: 0, reason: "downbeat", strength: 0.99 },
    { frame: 14, reason: "beat", strength: 0.94 },
  ]);
  assert.deepEqual(hints.cuts, [
    {
      id: "section-intro",
      sectionId: "intro",
      label: "intro",
      sourceStartFrame: 0,
      sourceEndFrame: 120,
      outputStartFrame: 0,
      outputEndFrame: 120,
      anchorFrames: [0],
    },
  ]);
});

test("rejects symlinked asset metadata lock sidecars that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-metadata-lock-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  const actionPath = join(cwd, "actions", "beat-fill.json");
  await writeJson(assetsPath, {
    assets: [{ id: "asset-song", type: "audio", metadata: {} }],
  });
  await writeJson(actionPath, {
    actionId: "action-beat-fill",
    targetAssetId: "asset-song",
    metadataKind: "audio.beat-analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.beat-analysis",
      bpm: 128,
      fps: 30,
      beats: [{ frame: 0, timeSeconds: 0, confidence: 0.99, downbeat: true }],
      sections: [{ id: "intro", startFrame: 0, endFrame: 30, label: "intro" }],
    },
  });
  const outside = join(cwd, "..", "outside-metadata-lock");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "projections", "metadata"), { recursive: true });
  await writeFile(join(outside, "asset-song.audio.beat-analysis.lock.json"), "{}\n", "utf8");
  await symlink(
    join(outside, "asset-song.audio.beat-analysis.lock.json"),
    join(cwd, "projections", "metadata", "asset-song.audio.beat-analysis.lock.json"),
  );

  await assert.rejects(
    () => applyProductionMetadataAction({ cwd, actionPath, assetsPath }),
    /Projection lock sidecar path must not traverse a symlink outside the current project cwd/,
  );
  const assets = JSON.parse(await readFile(assetsPath, "utf8"));
  assert.deepEqual(assets.assets[0].metadata, {});
});

test("applies edited asset metadata projection through CAS and refreshes the lock", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-metadata-apply-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  const actionPath = join(cwd, "actions", "beat-fill.json");
  await writeJson(assetsPath, {
    assets: [{ id: "asset-song", type: "audio", metadata: {} }],
  });
  await writeJson(actionPath, {
    actionId: "action-beat-fill",
    targetAssetId: "asset-song",
    metadataKind: "audio.beat-analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.beat-analysis",
      bpm: 128,
      fps: 30,
      beats: [{ frame: 0, timeSeconds: 0, confidence: 0.99, downbeat: true }],
      sections: [{ id: "intro", startFrame: 0, endFrame: 30, label: "intro" }],
    },
  });
  const initial = await applyProductionMetadataAction({ cwd, actionPath, assetsPath });
  const beforeLock = JSON.parse(await readFile(initial.metadataLockPath, "utf8"));
  await writeJson(initial.metadataPath, {
    kind: "audio.beat-analysis",
    bpm: 132,
    fps: 30,
    beats: [{ frame: 0, timeSeconds: 0, confidence: 0.99, downbeat: true }],
    sections: [{ id: "intro", startFrame: 0, endFrame: 30, label: "intro" }],
  });

  const applied = await applyProductionMetadataProjection({
    cwd,
    filePath: initial.metadataPath,
    assetsPath,
  });

  assert.equal(applied.targetAssetId, "asset-song");
  assert.equal(applied.metadataKind, "audio.beat-analysis");
  assert.equal(applied.beforeMetadataHash, beforeLock.contentHash);
  assert.notEqual(applied.afterMetadataHash, applied.beforeMetadataHash);
  assert.equal(applied.lockPath, initial.metadataLockPath);
  const assets = JSON.parse(await readFile(assetsPath, "utf8"));
  assert.equal(assets.assets[0].metadata["audio.beat-analysis"].bpm, 132);
  const afterLock = JSON.parse(await readFile(initial.metadataLockPath, "utf8"));
  assert.equal(afterLock.contentHash, applied.afterMetadataHash);
  assert.equal(afterLock.metadataHash, applied.afterMetadataHash);
});

test("rejects edited asset metadata projection when the manifest changed after pull", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-metadata-stale-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  const actionPath = join(cwd, "actions", "beat-fill.json");
  await writeJson(assetsPath, {
    assets: [{ id: "asset-song", type: "audio", metadata: {} }],
  });
  await writeJson(actionPath, {
    actionId: "action-beat-fill",
    targetAssetId: "asset-song",
    metadataKind: "audio.beat-analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.beat-analysis",
      bpm: 128,
      fps: 30,
      beats: [{ frame: 0, timeSeconds: 0, confidence: 0.99, downbeat: true }],
      sections: [{ id: "intro", startFrame: 0, endFrame: 30, label: "intro" }],
    },
  });
  const initial = await applyProductionMetadataAction({ cwd, actionPath, assetsPath });
  await writeJson(initial.metadataPath, {
    kind: "audio.beat-analysis",
    bpm: 132,
    fps: 30,
    beats: [{ frame: 0, timeSeconds: 0, confidence: 0.99, downbeat: true }],
    sections: [{ id: "intro", startFrame: 0, endFrame: 30, label: "intro" }],
  });
  const manifest = JSON.parse(await readFile(assetsPath, "utf8"));
  manifest.assets[0].metadata["audio.beat-analysis"].bpm = 140;
  await writeJson(assetsPath, manifest);

  await assert.rejects(
    () => applyProductionMetadataProjection({ cwd, filePath: initial.metadataPath, assetsPath }),
    /stale asset metadata apply rejected/i,
  );
  const assets = JSON.parse(await readFile(assetsPath, "utf8"));
  assert.equal(assets.assets[0].metadata["audio.beat-analysis"].bpm, 140);
});

test("rejects production metadata action files outside the project cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-metadata-cwd-"));
  const outside = await mkdtemp(join(tmpdir(), "clash-production-metadata-outside-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  const actionPath = join(outside, "beat-fill.json");
  await writeJson(assetsPath, {
    assets: [{ id: "asset-song", type: "audio", metadata: {} }],
  });
  await writeJson(actionPath, {
    actionId: "action-beat-fill",
    targetAssetId: "asset-song",
    metadataKind: "audio.beat-analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.beat-analysis",
      bpm: 128,
      fps: 30,
      beats: [{ frame: 0, timeSeconds: 0, confidence: 0.99, downbeat: true }],
      sections: [{ id: "intro", startFrame: 0, endFrame: 30, label: "intro" }],
    },
  });

  await assert.rejects(
    () => applyProductionMetadataAction({ cwd, actionPath, assetsPath }),
    /action path must stay inside the current project cwd/i,
  );

  const assets = JSON.parse(await readFile(assetsPath, "utf8"));
  assert.deepEqual(assets.assets[0].metadata, {});
});

test("rejects production metadata output paths derived from unsafe asset ids", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-metadata-path-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  const actionPath = join(cwd, "actions", "unsafe-fill.json");
  const unsafeAssetId = `../../../escaped-asset-${basename(cwd)}`;
  await writeJson(assetsPath, {
    assets: [{ id: unsafeAssetId, type: "audio", metadata: {} }],
  });
  await writeJson(actionPath, {
    actionId: "action-unsafe-fill",
    targetAssetId: unsafeAssetId,
    metadataKind: "audio.beat-analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.beat-analysis",
      bpm: 128,
      fps: 30,
      beats: [{ frame: 0, timeSeconds: 0, confidence: 0.99, downbeat: true }],
      sections: [{ id: "intro", startFrame: 0, endFrame: 30, label: "intro" }],
    },
  });

  await assert.rejects(
    () => applyProductionMetadataAction({ cwd, actionPath, assetsPath }),
    /targetAssetId must be safe for projection file names/i,
  );
  const assets = JSON.parse(await readFile(assetsPath, "utf8"));
  assert.deepEqual(assets.assets[0].metadata, {});
});

test("rejects production metadata projection paths derived from unsafe branch ids", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-metadata-branch-path-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  const actionPath = join(cwd, "actions", "unsafe-stem-fill.json");
  await writeJson(assetsPath, {
    assets: [{ id: "asset-song", type: "audio", metadata: {} }],
  });
  await writeJson(actionPath, {
    actionId: "action-unsafe-stem-fill",
    targetAssetId: "asset-song",
    metadataKind: "audio.stem-separation",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.stem-separation",
      separationId: `../../../escaped-separation-${basename(cwd)}`,
      sourceAssetId: "asset-song",
      stems: [
        {
          stemAssetId: "asset-song-vocal",
          stemType: "vocal",
          filePath: "assets/audio/song-vocal.wav",
          fileHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
    },
  });

  await assert.rejects(
    () => applyProductionMetadataAction({ cwd, actionPath, assetsPath }),
    /separationId must be safe for projection file names/i,
  );
  const assets = JSON.parse(await readFile(assetsPath, "utf8"));
  assert.deepEqual(assets.assets, [{ id: "asset-song", type: "audio", metadata: {} }]);
  assert.equal(existsSync(join(cwd, "projections", "metadata", "asset-song.audio.stem-separation.json")), false);
});

test("rejects production metadata generated asset paths before any manifest write", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-metadata-generated-path-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  const actionPath = join(cwd, "actions", "unsafe-stem-path-fill.json");
  await writeJson(assetsPath, {
    assets: [{ id: "asset-song", type: "audio", metadata: {} }],
  });
  await writeJson(actionPath, {
    actionId: "action-unsafe-stem-path-fill",
    targetAssetId: "asset-song",
    metadataKind: "audio.stem-separation",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.stem-separation",
      separationId: "separation-1",
      sourceAssetId: "asset-song",
      stems: [
        {
          stemAssetId: "asset-song-vocal",
          stemType: "vocal",
          filePath: join(tmpdir(), "outside-song-vocal.wav"),
          fileHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
    },
  });

  await assert.rejects(
    () => applyProductionMetadataAction({ cwd, actionPath, assetsPath }),
    /audio stem asset-song-vocal filePath must be project-relative, not absolute/i,
  );
  const assets = JSON.parse(await readFile(assetsPath, "utf8"));
  assert.deepEqual(assets.assets, [{ id: "asset-song", type: "audio", metadata: {} }]);
  assert.equal(existsSync(join(cwd, "projections", "metadata", "asset-song.audio.stem-separation.json")), false);
});

test("projects talking-head metadata into a caption timeline YAML view", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-talk-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  const actionPath = join(cwd, "actions", "talking-head-fill.json");
  await writeJson(assetsPath, {
    assets: [{ id: "asset-talk", type: "video", metadata: {} }],
  });
  await writeJson(actionPath, {
    actionId: "action-talk-fill",
    targetAssetId: "asset-talk",
    metadataKind: "talking-head.analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "talking-head.analysis",
      fps: 30,
      words: [
        { id: "w1", text: "大家", startFrame: 0, endFrame: 12 },
        { id: "w2", text: "好", startFrame: 12, endFrame: 18 },
      ],
      cuts: [
        { id: "keep-1", sourceStartFrame: 0, sourceEndFrame: 60, outputStartFrame: 0, outputEndFrame: 60, action: "keep" },
      ],
      captionCues: [
        { id: "cue-1", startFrame: 0, durationInFrames: 45, text: "大家好", wordIds: ["w1", "w2"] },
      ],
    },
  });

  const result = await applyProductionMetadataAction({ cwd, actionPath, assetsPath });

  assert.equal(result.timelineProjectionPath, join(cwd, "projections", "timelines", "asset-talk.caption.timeline.yaml"));
  const parsed = timelineDslFromYaml(await readFile(result.timelineProjectionPath!, "utf8"));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const timeline = parsed.dsl;
  const captionItem = timeline.tracks[0].items[0] as any;
  assert.equal(timeline.tracks[0].role, "subtitle");
  assert.equal(captionItem.type, "caption");
  assert.equal(captionItem.cues[0].text, "大家好");
  assert.deepEqual(captionItem.cues[0].wordIds, ["w1", "w2"]);
  assert.deepEqual([captionItem.cues[0].sourceStartFrame, captionItem.cues[0].sourceEndFrame], [0, 18]);
  assert.deepEqual(captionItem.wordRefs, [
    { id: "w1", text: "大家", sourceStartFrame: 0, sourceEndFrame: 12 },
    { id: "w2", text: "好", sourceStartFrame: 12, sourceEndFrame: 18 },
  ]);
  assert.deepEqual(captionItem.sourceToOutputMap, [
    { sourceStartFrame: 0, sourceEndFrame: 60, outputStartFrame: 0, outputEndFrame: 60 },
  ]);
});

test("keeps TVC/reference ingest as metadata-only when rights block derivatives", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-ref-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  const actionPath = join(cwd, "actions", "reference-fill.json");
  await writeJson(assetsPath, {
    assets: [{ id: "asset-reference", type: "reference", metadata: {} }],
  });
  await writeJson(actionPath, {
    actionId: "action-reference-fill",
    targetAssetId: "asset-reference",
    metadataKind: "reference-video.analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "reference-video.analysis",
      sourceUrl: "https://example.invalid/watch/1",
      rights: {
        license: "unknown",
        attribution: "unknown",
        redistributionAllowed: false,
        derivativeAllowed: false,
      },
      shots: [{ id: "shot-1", startFrame: 0, endFrame: 60, description: "fast push-in" }],
      nonCopyingQa: { status: "requires-review", similarityScore: 0.71 },
    },
  });

  const result = await applyProductionMetadataAction({ cwd, actionPath, assetsPath });

  assert.equal(result.timelineProjectionPath, undefined);
  assert.equal(result.blockedReason, "reference https://example.invalid/watch/1 derivative use is not allowed");
  assert.equal(result.metadataPath, join(cwd, "projections", "metadata", "asset-reference.reference-video.analysis.json"));
  assert.equal(result.rightsLedgerPath, join(cwd, "projections", "rights", "asset-reference.rights-ledger.json"));
  assert.ok(existsSync(join(cwd, "projections", "references", "asset-reference.reference-review.json")));
  const ledger = JSON.parse(await readFile(result.rightsLedgerPath!, "utf8"));
  assert.equal(ledger.sourceUrl, "https://example.invalid/watch/1");
  assert.equal(ledger.remixAllowed, false);
  assert.deepEqual(ledger.blockedReasons, [
    "derivative use is not allowed",
    "redistribution is not allowed",
  ]);
  assert.deepEqual(ledger.prohibitedUses, ["download-source", "copy-frames", "export-derivative"]);
});

test("writes short-drama/image storyboard metadata as an agent-readable projection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-storyboard-"));
  const assetsPath = join(cwd, "assets", "manifest.json");
  const actionPath = join(cwd, "actions", "storyboard-fill.json");
  await writeJson(assetsPath, {
    assets: [{ id: "asset-storyboard", type: "image", metadata: {} }],
  });
  await writeJson(actionPath, {
    actionId: "action-storyboard-fill",
    targetAssetId: "asset-storyboard",
    metadataKind: "image.storyboard-consistency",
    producer: "qa-fixture",
    metadata: {
      kind: "image.storyboard-consistency",
      characters: [
        {
          id: "hero",
          name: "便利店店员",
          referenceAssetIds: ["asset-hero-front", "asset-hero-side", "asset-hero-back"],
          requiredViews: ["front", "side", "back"],
        },
      ],
      scenes: [
        { id: "store-night", referenceAssetIds: ["asset-store"], prompt: "night convenience store aisle" },
      ],
      panels: [
        {
          id: "panel-1",
          sceneId: "store-night",
          characterIds: ["hero"],
          assetId: "asset-panel-1",
          path: "assets/storyboards/panel-1.png",
          consistencyScore: 0.86,
        },
      ],
    },
  });

  const result = await applyProductionMetadataAction({ cwd, actionPath, assetsPath });

  assert.equal(result.timelineProjectionPath, undefined);
  assert.ok(result.projectionLockPaths.includes(
    join(cwd, "projections", "storyboards", "asset-storyboard.storyboard.lock.json"),
  ));
  const storyboard = JSON.parse(
    await readFile(join(cwd, "projections", "storyboards", "asset-storyboard.storyboard.json"), "utf8"),
  );
  const storyboardLock = JSON.parse(
    await readFile(join(cwd, "projections", "storyboards", "asset-storyboard.storyboard.lock.json"), "utf8"),
  );
  assert.equal(storyboardLock.kind, "clash.asset.metadata.projection.lock");
  assert.equal(storyboardLock.projectionKind, "image-storyboard");
  assert.deepEqual(storyboardLock.entity, { kind: "asset", id: "asset-storyboard" });
  assert.equal(storyboardLock.filePath, "projections/storyboards/asset-storyboard.storyboard.json");
  assert.equal(storyboardLock.metadataKind, "image.storyboard-consistency");
  assert.deepEqual(storyboard.characters[0].requiredViews, ["front", "side", "back"]);
  assert.equal(storyboard.panels[0].assetId, "asset-panel-1");
  assert.equal(storyboard.panels[0].path, "assets/storyboards/panel-1.png");
  const assets = JSON.parse(await readFile(assetsPath, "utf8"));
  const panelAsset = assets.assets.find((asset: any) => asset.id === "asset-panel-1");
  assert.equal(panelAsset.type, "storyboard-panel");
  assert.equal(panelAsset.path, "assets/storyboards/panel-1.png");
  assert.deepEqual(panelAsset.metadata["image.storyboard-panel"], {
    storyboardAssetId: "asset-storyboard",
    panelId: "panel-1",
    sceneId: "store-night",
    characterIds: ["hero"],
    consistencyScore: 0.86,
  });
});

test("runs production apply-metadata as a black-box CLI command over fixtures", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-cli-"));
  const fixtureRoot = new URL("../../../../examples/production-actions/", import.meta.url);
  await cp(fixtureRoot, cwd, { recursive: true });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "apply-metadata",
      "--action",
      "actions/talking-head-fill.json",
      "--assets",
      "assets/manifest.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.metadataKind, "talking-head.analysis");
  assert.match(payload.timelineProjectionPath, /projections\/timelines\/asset-talk\.caption\.timeline\.yaml$/);
  assert.deepEqual(
    payload.projectionLockPaths.map((path: string) => path.slice(path.indexOf("projections/"))),
    [
      "projections/metadata/asset-talk.talking-head.analysis.lock.json",
      "projections/media-cuts/asset-talk.transcript-cut-plan.lock.json",
    ],
  );
  assert.ok(existsSync(payload.timelineProjectionPath));
  for (const lockPath of payload.projectionLockPaths) {
    assert.ok(existsSync(lockPath), `expected projection lock to exist: ${lockPath}`);
  }

  const metadata = JSON.parse(await readFile(payload.metadataPath, "utf8"));
  metadata.words.push({ id: "w3", text: "again", startFrame: 28, endFrame: 40 });
  await writeJson(payload.metadataPath, metadata);
  const applyEdited = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "apply-metadata-projection",
      "--file",
      "projections/metadata/asset-talk.talking-head.analysis.json",
      "--assets",
      "assets/manifest.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(applyEdited.status, 0, applyEdited.stderr);
  const appliedPayload = JSON.parse(applyEdited.stdout);
  assert.equal(appliedPayload.applied, true);
  assert.equal(appliedPayload.targetAssetId, "asset-talk");
  assert.notEqual(appliedPayload.afterMetadataHash, appliedPayload.beforeMetadataHash);
  const editedAssets = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const editedTalkAsset = editedAssets.assets.find((asset: any) => asset.id === "asset-talk");
  assert.equal(editedTalkAsset.metadata["talking-head.analysis"].words.at(-1).text, "again");
});

test("renders an MG spec into self-contained HTML, manifest, and timeline YAML projection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-mg-"));
  const specPath = join(cwd, "compositions", "lower-third", "spec.json");
  await writeJson(specPath, {
    id: "agent-cwd-lower-third",
    name: "Agent CWD Lower Third",
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 90,
    background: "transparent",
    layers: [
      {
        id: "bar",
        type: "shape",
        shape: "rounded-rect",
        from: 0,
        durationInFrames: 75,
        x: 72,
        y: 1350,
        width: 640,
        height: 132,
        fill: "#101820",
        opacity: 0,
        animations: [
          { property: "x", from: -760, to: 72, startFrame: 0, durationInFrames: 18, easing: "easeOutCubic" },
          { property: "opacity", from: 0, to: 0.92, startFrame: 0, durationInFrames: 12, easing: "linear" },
        ],
      },
      {
        id: "title",
        type: "text",
        from: 6,
        durationInFrames: 60,
        x: 116,
        y: 1386,
        text: "Agent owns cwd",
        fontSize: 56,
        color: "#F8FAFC",
        opacity: 0,
        animations: [
          { property: "opacity", from: 0, to: 1, startFrame: 6, durationInFrames: 8, easing: "linear" },
        ],
      },
    ],
  });

  const result = await renderMgProductionProjection({
    cwd,
    specPath,
    outDir: "projections/mg/agent-cwd-lower-third",
    renderedAssetPath: "assets/overlays/agent-cwd-lower-third.webm",
    timelineFromFrame: 120,
  });

  assert.equal(result.compositionId, "agent-cwd-lower-third");
  assert.equal(result.htmlPath, join(cwd, "projections", "mg", "agent-cwd-lower-third", "index.html"));
  assert.equal(result.manifestPath, join(cwd, "projections", "mg", "agent-cwd-lower-third", "timeline-manifest.json"));
  assert.equal(result.timelineProjectionPath, join(cwd, "projections", "timelines", "agent-cwd-lower-third.mg.timeline.yaml"));
  assert.equal(result.timelineLockPath, join(cwd, "timelines", "main.timeline.lock.json"));
  const html = await readFile(result.htmlPath, "utf8");
  assert.match(html, /window\.__CLASH_MG__/);
  assert.match(html, /id="frame-scrubber"/);
  assert.match(html, /data-current-frame="0"/);
  assert.match(html, /clash-mg-frame/);
  assert.doesNotMatch(html, /https?:\/\//);
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  assert.deepEqual(
    manifest.casApply,
    expectedTimelineCasApply("projections/timelines/agent-cwd-lower-third.mg.timeline.yaml"),
  );
  assert.equal(manifest.timelineItems[0].type, "composition");
  assert.equal(manifest.timelineItems[0].from, 120);
  assert.equal(manifest.validation.seekablePreview, true);
  assert.equal(manifest.validation.currentFrameState, "data-current-frame");
  assert.equal(manifest.validation.frameEvent, "clash-mg-frame");
  assert.equal(manifest.validation.externalRuntime, false);
  assert.deepEqual(manifest.validation.implementation, {
    renderer: "clash-first-party-mg-composition",
    source: "first-party",
    license: "MIT",
    thirdPartyCodeCopied: false,
    externalRuntime: false,
    researchReferences: ["HyperFrames"],
  });
  const parsedTimeline = timelineDslFromYaml(await readFile(result.timelineProjectionPath, "utf8"));
  assert.equal(parsedTimeline.ok, true);
  if (!parsedTimeline.ok) return;
  assert.equal(parsedTimeline.dsl.tracks[0].role, "overlay");
  assert.equal(parsedTimeline.dsl.tracks[0].items[0].type, "composition");
  assert.equal(existsSync(result.timelineLockPath), false, "render-mg must not mint a fake CAS lock");
  const parsedForApply = parseTimelineFileForApply(await readFile(result.timelineProjectionPath, "utf8"));
  assert.equal(parsedForApply.ok, true);
  if (!parsedForApply.ok) return;
  const cas = assertTimelineCas({
    projectId: "project-1",
    nodeId: "editor-1",
    lock: null,
    currentDsl: parsedForApply.dsl,
    force: false,
  });
  assert.equal(cas.ok, false);
  if (cas.ok) return;
  assert.match(cas.error, /Missing timeline CAS lock/);
});

test("runs production render-mg as a black-box CLI command over the MG fixture", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-mg-cli-"));
  const fixtureRoot = new URL("../../../../examples/mg/lower-third/", import.meta.url);
  await cp(fixtureRoot, join(cwd, "mg"), { recursive: true });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "render-mg",
      "--spec",
      "mg/spec.json",
      "--out",
      "projections/mg/lower-third",
      "--rendered-asset",
      "assets/overlays/lower-third.webm",
      "--from",
      "42",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.match(payload.htmlPath, /projections\/mg\/lower-third\/index\.html$/);
  assert.match(payload.timelineProjectionPath, /projections\/timelines\/cwd-principle-lower-third\.mg\.timeline\.yaml$/);
  assert.match(payload.timelineLockPath, /timelines\/main\.timeline\.lock\.json$/);
  assert.ok(existsSync(payload.htmlPath));
  assert.ok(existsSync(payload.timelineProjectionPath));
  assert.equal(existsSync(payload.timelineLockPath), false, "render-mg reports the required lock but does not create one");
  const manifest = JSON.parse(await readFile(payload.manifestPath, "utf8"));
  assert.equal(manifest.casApply.lockRequired, true);
  assert.deepEqual(
    manifest.casApply,
    expectedTimelineCasApply("projections/timelines/cwd-principle-lower-third.mg.timeline.yaml"),
  );
  assert.equal(manifest.validation.implementation.thirdPartyCodeCopied, false);
  assert.equal(manifest.validation.implementation.renderer, "clash-first-party-mg-composition");
});

test("runs production verify-mg-preview over rendered HTML and writes deterministic frame QA", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-mg-preview-"));
  const fixtureRoot = new URL("../../../../examples/mg/lower-third/", import.meta.url);
  await cp(fixtureRoot, join(cwd, "mg"), { recursive: true });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const render = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "render-mg",
      "--spec",
      "mg/spec.json",
      "--out",
      "projections/mg/lower-third",
      "--rendered-asset",
      "assets/overlays/lower-third.webm",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(render.status, 0, render.stderr);

  const verify = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "verify-mg-preview",
      "--html",
      "projections/mg/lower-third/index.html",
      "--manifest",
      "projections/mg/lower-third/timeline-manifest.json",
      "--frames",
      "0,12,42",
      "--out",
      "qa/mg/lower-third.preview-verification.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(verify.status, 0, verify.stderr);
  const payload = JSON.parse(verify.stdout);
  assert.equal(payload.status, "pass");
  assert.equal(payload.overlayId, "cwd-principle-lower-third");
  assert.deepEqual(payload.framesChecked, [0, 12, 42]);
  assert.match(payload.reportPath, /qa\/mg\/lower-third\.preview-verification\.json$/);
  const report = JSON.parse(await readFile(payload.reportPath, "utf8"));
  assert.equal(report.kind, "clash.mg.preview-verification");
  assert.equal(report.status, "pass");
  assert.deepEqual(report.blockedReasons, []);
  assert.deepEqual(
    report.checks.map((check: any) => [check.id, check.status]),
    [
      ["html.self-contained", "pass"],
      ["html.seek-api", "pass"],
      ["manifest.cas-fresh-pull", "pass"],
      ["implementation.first-party-license-safe", "pass"],
      ["frames.deterministic-evaluation", "pass"],
    ],
  );
  assert.deepEqual(report.frameEvaluations.map((entry: any) => entry.frame), [0, 12, 42]);
  assert.ok(
    report.frameEvaluations[1].layers.some((layer: any) => layer.id === "title" && layer.style.opacity > 0),
    "frame 12 should evaluate visible title animation state",
  );
});

test("runs production plan-composition-route without silent runtime fallback", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-composition-route-cli-"));
  await writeJson(join(cwd, "plans", "html-mg-route.json"), {
    compositionId: "lower-third",
    compositionKind: "motion-graphics",
    requirements: ["agent-readable", "interactive-preview", "transparent-overlay"],
    availableRuntimes: ["html", "ffmpeg"],
    inputPath: "projections/mg/lower-third/spec.json",
    outputPath: "projections/mg/lower-third/index.html",
  });
  await writeJson(join(cwd, "plans", "react-route.json"), {
    compositionId: "react-chart",
    compositionKind: "custom",
    requirements: ["react-components", "timeline-editor-integration"],
    availableRuntimes: ["html", "ffmpeg"],
    inputPath: "components/ReactChart.tsx",
    outputPath: "projections/remotion/react-chart",
  });
  await writeJson(join(cwd, "plans", "react-remotion-route.json"), {
    compositionId: "react-chart",
    compositionKind: "custom",
    requirements: ["react-components", "timeline-editor-integration"],
    availableRuntimes: ["remotion", "html"],
    inputPath: "components/ReactChart.tsx",
    outputPath: "assets/renders/react-chart.webm",
  });

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runRoute = (requestPath: string, outPath: string) => spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-composition-route",
      "--request",
      requestPath,
      "--out",
      outPath,
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  const html = runRoute("plans/html-mg-route.json", "plans/routes/lower-third.route.json");
  assert.equal(html.status, 0, html.stderr);
  const htmlPayload = JSON.parse(html.stdout);
  assert.equal(htmlPayload.status, "planned");
  assert.equal(htmlPayload.selectedRuntime, "html");
  const htmlPlan = JSON.parse(await readFile(join(cwd, "plans", "routes", "lower-third.route.json"), "utf8"));
  assert.equal(htmlPlan.kind, "clash.render.composition-route");
  assert.equal(htmlPlan.status, "planned");
  assert.equal(htmlPlan.selectedRuntime, "html");
  assert.equal(htmlPlan.fallbackUsed, false);
  assert.equal(htmlPlan.routeCommand, "clash production render-mg");
  assert.deepEqual(htmlPlan.validationPlan, ["duration", "dimensions", "fps", "nonblank-frames", "alpha"]);
  assert.match(htmlPlan.decisionLog.join("\n"), /selected html for agent-readable motion-graphics preview/);

  const react = runRoute("plans/react-route.json", "plans/routes/react-chart.route.json");
  assert.equal(react.status, 0, react.stderr);
  const reactPayload = JSON.parse(react.stdout);
  assert.equal(reactPayload.status, "blocked");
  assert.equal(reactPayload.selectedRuntime, null);
  const reactPlan = JSON.parse(await readFile(join(cwd, "plans", "routes", "react-chart.route.json"), "utf8"));
  assert.equal(reactPlan.status, "blocked");
  assert.equal(reactPlan.selectedRuntime, null);
  assert.equal(reactPlan.fallbackUsed, false);
  assert.deepEqual(reactPlan.blockedReasons, ["required runtime remotion unavailable"]);
  assert.deepEqual(reactPlan.rejectedFallbacks, [
    { runtime: "html", reason: "react component route cannot silently fallback to html" },
    { runtime: "ffmpeg", reason: "react component route cannot silently fallback to ffmpeg" },
  ]);

  const remotion = runRoute("plans/react-remotion-route.json", "plans/routes/react-chart-remotion.route.json");
  assert.equal(remotion.status, 0, remotion.stderr);
  const remotionPayload = JSON.parse(remotion.stdout);
  assert.equal(remotionPayload.status, "planned");
  assert.equal(remotionPayload.selectedRuntime, "remotion");
  const remotionPlan = JSON.parse(await readFile(join(cwd, "plans", "routes", "react-chart-remotion.route.json"), "utf8"));
  assert.equal(remotionPlan.status, "planned");
  assert.equal(remotionPlan.selectedRuntime, "remotion");
  assert.equal(remotionPlan.fallbackUsed, false);
  assert.equal(remotionPlan.routeCommand, "clash render remotion");
  assert.deepEqual(remotionPlan.validationPlan, ["duration", "dimensions", "fps", "nonblank-frames"]);
});

test("projects an already rendered Remotion composition into a CAS-required timeline view", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-composition-timeline-cli-"));
  await writeJson(join(cwd, "plans", "routes", "react-chart.route.json"), {
    schemaVersion: 1,
    kind: "clash.render.composition-route",
    compositionId: "react-chart",
    compositionKind: "custom",
    status: "planned",
    selectedRuntime: "remotion",
    fallbackUsed: false,
    routeCommand: "clash render remotion",
    requirements: ["react-components", "timeline-editor-integration"],
    availableRuntimes: ["remotion", "html"],
    inputPath: "components/ReactChart.tsx",
    outputPath: "assets/renders/react-chart.webm",
    validationPlan: ["duration", "dimensions", "fps", "nonblank-frames"],
    decisionLog: ["selected remotion for react component timeline integration"],
    blockedReasons: [],
    rejectedFallbacks: [],
    createdAt: "2026-07-06T00:00:00.000Z",
  });
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      {
        id: "asset-react-chart-render",
        type: "video",
        path: "assets/renders/react-chart.webm",
        metadata: {
          "render.composition": {
            compositionId: "react-chart",
            runtime: "remotion",
          },
        },
      },
    ],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-composition-timeline",
      "--route",
      "plans/routes/react-chart.route.json",
      "--rendered-asset",
      "asset-react-chart-render",
      "--from",
      "30",
      "--duration",
      "120",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.projected, true);
  assert.equal(payload.compositionId, "react-chart");
  assert.equal(payload.runtime, "remotion");
  assert.match(payload.timelineProjectionPath, /projections\/timelines\/react-chart\.composition\.timeline\.yaml$/);
  assert.match(payload.manifestPath, /projections\/timelines\/react-chart\.composition\.timeline-manifest\.json$/);
  assert.match(payload.timelineLockPath, /timelines\/main\.timeline\.lock\.json$/);
  assert.equal(existsSync(payload.timelineLockPath), false, "composition projection command must not mint a fake CAS lock");

  const parsedTimeline = timelineDslFromYaml(await readFile(payload.timelineProjectionPath, "utf8"));
  assert.equal(parsedTimeline.ok, true);
  if (!parsedTimeline.ok) return;
  const item = parsedTimeline.dsl.tracks[0].items[0] as any;
  assert.deepEqual([
    item.id,
    item.type,
    item.runtime,
    item.compositionId,
    item.sourcePath,
    item.renderedAssetPath,
    item.assetId,
    item.from,
    item.durationInFrames,
  ], [
    "composition-react-chart",
    "composition",
    "remotion",
    "react-chart",
    "components/ReactChart.tsx",
    "assets/renders/react-chart.webm",
    "asset-react-chart-render",
    30,
    120,
  ]);

  const manifest = JSON.parse(await readFile(payload.manifestPath, "utf8"));
  assert.equal(manifest.kind, "clash.composition.timeline-projection");
  assert.deepEqual(
    manifest.casApply,
    expectedTimelineCasApply("projections/timelines/react-chart.composition.timeline.yaml"),
  );
  assert.equal(manifest.validation.fallbackUsed, false);
  assert.equal(manifest.validation.renderedAssetRegistered, true);
  assert.equal(manifest.timelineItems[0].runtime, "remotion");
});

test("runs production review gates with explicit approval and stale-write protection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-review-gate-"));
  await writeJson(join(cwd, "pipeline.manifest.json"), {
    schemaVersion: 1,
    projectKind: "tvc",
    stages: ["brief", "analysis", "plan", "generate", "assemble", "review", "export"],
    editableFiles: ["brief/tvc.md", "plans/export.json"],
    protectedFiles: ["snapshot.bin", "local.sqlite"],
    requiredSystemCapabilities: ["review.stage-gates", "render.export-validation"],
  });
  await writeJson(join(cwd, "projections", "timelines", "main.timeline.yaml"), {
    placeholder: "timeline projection exists",
  });

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = (args: string[]) => spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry.pathname, "production", ...args],
    { cwd, encoding: "utf8" },
  );

  const blocked = runCli([
    "plan-review-gate",
    "--pipeline",
    "pipeline.manifest.json",
    "--stage",
    "export",
    "--artifact",
    "projections/timelines/main.timeline.yaml",
    "--artifact",
    "qa/delivery/tiktok-15s.validation.json",
    "--out",
    "reviews/gates/export.review-gate.json",
    "--json",
  ]);
  assert.equal(blocked.status, 0, blocked.stderr);
  const blockedPayload = JSON.parse(blocked.stdout);
  assert.equal(blockedPayload.status, "blocked");
  const blockedGate = JSON.parse(await readFile(join(cwd, "reviews", "gates", "export.review-gate.json"), "utf8"));
  assert.equal(blockedGate.kind, "clash.review.stage-gate");
  assert.equal(blockedGate.stage, "export");
  assert.equal(blockedGate.gatePolicy.requiresExplicitApproval, true);
  assert.equal(blockedGate.gatePolicy.applyBlockedUntilApproved, true);
  assert.deepEqual(blockedGate.blockedReasons, [
    "required artifact missing: qa/delivery/tiktok-15s.validation.json",
  ]);

  await writeJson(join(cwd, "qa", "delivery", "tiktok-15s.validation.json"), {
    verdict: "pass",
  });
  const pending = runCli([
    "plan-review-gate",
    "--pipeline",
    "pipeline.manifest.json",
    "--stage",
    "export",
    "--artifact",
    "projections/timelines/main.timeline.yaml",
    "--artifact",
    "qa/delivery/tiktok-15s.validation.json",
    "--out",
    "reviews/gates/export.review-gate.json",
    "--json",
  ]);
  assert.equal(pending.status, 0, pending.stderr);
  const pendingPayload = JSON.parse(pending.stdout);
  assert.equal(pendingPayload.status, "pending-review");
  assert.ok(existsSync(join(cwd, "reviews", "gates", "export.review-gate.lock.json")));

  const staleGate = JSON.parse(await readFile(join(cwd, "reviews", "gates", "export.review-gate.json"), "utf8"));
  staleGate.decisionLog.push("external edit before approval");
  await writeJson(join(cwd, "reviews", "gates", "export.review-gate.json"), staleGate);
  const stale = runCli([
    "approve-review-gate",
    "--gate",
    "reviews/gates/export.review-gate.json",
    "--reviewer",
    "qa-agent",
    "--decision",
    "approve",
    "--note",
    "ready",
    "--json",
  ]);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /stale review gate/i);

  const repaired = runCli([
    "plan-review-gate",
    "--pipeline",
    "pipeline.manifest.json",
    "--stage",
    "export",
    "--artifact",
    "projections/timelines/main.timeline.yaml",
    "--artifact",
    "qa/delivery/tiktok-15s.validation.json",
    "--out",
    "reviews/gates/export.review-gate.json",
    "--json",
  ]);
  assert.equal(repaired.status, 0, repaired.stderr);

  await copyFile(
    join(cwd, "reviews", "gates", "export.review-gate.json"),
    join(cwd, "reviews", "gates", "copied-export.review-gate.json"),
  );
  const mismatchedLock = runCli([
    "approve-review-gate",
    "--gate",
    "reviews/gates/copied-export.review-gate.json",
    "--lock",
    "reviews/gates/export.review-gate.lock.json",
    "--reviewer",
    "qa-agent",
    "--decision",
    "approve",
    "--json",
  ]);
  assert.equal(mismatchedLock.status, 1);
  assert.match(mismatchedLock.stderr, /Review gate path does not match CAS lock/);

  const approved = runCli([
    "approve-review-gate",
    "--gate",
    "reviews/gates/export.review-gate.json",
    "--reviewer",
    "qa-agent",
    "--decision",
    "approve",
    "--note",
    "ready",
    "--json",
  ]);
  assert.equal(approved.status, 0, approved.stderr);
  const approvedPayload = JSON.parse(approved.stdout);
  assert.equal(approvedPayload.status, "approved");
  const approvedGate = JSON.parse(await readFile(join(cwd, "reviews", "gates", "export.review-gate.json"), "utf8"));
  assert.equal(approvedGate.status, "approved");
  assert.equal(approvedGate.approvals[0].reviewer, "qa-agent");
  assert.equal(approvedGate.approvals[0].decision, "approve");
  assert.equal(approvedGate.gatePolicy.finalExportBlockedUntilApproved, true);
});

test("review gate planning rejects symlinked gate paths that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-review-gate-path-"));
  await writeJson(join(cwd, "pipeline.manifest.json"), {
    schemaVersion: 1,
    projectKind: "tvc",
    stages: ["export"],
  });
  const outside = join(cwd, "..", "outside-review-gate-path");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "reviews", "gates"), { recursive: true });
  const outsideGatePath = join(outside, "export.review-gate.json");
  await writeFile(outsideGatePath, "outside\n", "utf8");
  await symlink(outsideGatePath, join(cwd, "reviews", "gates", "export.review-gate.json"));

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const planned = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-review-gate",
      "--pipeline",
      "pipeline.manifest.json",
      "--stage",
      "export",
      "--out",
      "reviews/gates/export.review-gate.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /Agent file path must not traverse a symlink outside the current project cwd/);
  assert.equal(await readFile(outsideGatePath, "utf8"), "outside\n");
});

test("review gate planning rejects symlinked lock sidecars that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-review-gate-lock-"));
  await writeJson(join(cwd, "pipeline.manifest.json"), {
    schemaVersion: 1,
    projectKind: "tvc",
    stages: ["export"],
  });
  const outside = join(cwd, "..", "outside-review-gate-lock");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "reviews", "gates"), { recursive: true });
  await writeFile(join(outside, "export.review-gate.lock.json"), "{}\n", "utf8");
  await symlink(
    join(outside, "export.review-gate.lock.json"),
    join(cwd, "reviews", "gates", "export.review-gate.lock.json"),
  );

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const planned = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-review-gate",
      "--pipeline",
      "pipeline.manifest.json",
      "--stage",
      "export",
      "--out",
      "reviews/gates/export.review-gate.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /Agent file lock sidecar path must not traverse a symlink outside the current project cwd/);
  assert.equal(existsSync(join(cwd, "reviews", "gates", "export.review-gate.json")), false);
});

test("review gate approval rejects explicit symlinked lock sidecars that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-review-gate-approve-lock-"));
  await writeJson(join(cwd, "pipeline.manifest.json"), {
    schemaVersion: 1,
    projectKind: "tvc",
    stages: ["export"],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = (args: string[]) => spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry.pathname, "production", ...args],
    { cwd, encoding: "utf8" },
  );
  const planned = runCli([
    "plan-review-gate",
    "--pipeline",
    "pipeline.manifest.json",
    "--stage",
    "export",
    "--out",
    "reviews/gates/export.review-gate.json",
    "--json",
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  const outside = join(cwd, "..", "outside-review-gate-approve-lock");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "reviews", "gates"), { recursive: true });
  const outsideLockPath = join(outside, "approve.review-gate.lock.json");
  await writeFile(
    outsideLockPath,
    await readFile(join(cwd, "reviews", "gates", "export.review-gate.lock.json"), "utf8"),
    "utf8",
  );
  await symlink(outsideLockPath, join(cwd, "reviews", "gates", "approve.review-gate.lock.json"));

  const approved = runCli([
    "approve-review-gate",
    "--gate",
    "reviews/gates/export.review-gate.json",
    "--lock",
    "reviews/gates/approve.review-gate.lock.json",
    "--reviewer",
    "qa-agent",
    "--decision",
    "approve",
    "--json",
  ]);

  assert.equal(approved.status, 1);
  assert.match(approved.stderr, /Agent file lock sidecar path must not traverse a symlink outside the current project cwd/);
  const gate = JSON.parse(await readFile(join(cwd, "reviews", "gates", "export.review-gate.json"), "utf8"));
  assert.equal(gate.status, "pending-review");
});

test("runs production dry-run cost gates without executing generation or silent provider fallback", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-dry-run-gate-"));
  await writeJson(join(cwd, "plans", "free-local.json"), {
    workflowId: "short-drama-episode-001",
    stage: "generate",
    maxCostUsd: 0,
    operations: [
      {
        id: "storyboard-panel-001",
        capability: "image.generation",
        provider: "local-comfyui",
        runtime: "comfyui",
        mode: "local",
        availability: "available",
        estimatedCostUsd: 0,
        estimatedSeconds: 45,
        requiresByoKey: false,
      },
    ],
  });
  await writeJson(join(cwd, "plans", "blocked-cloud-fallback.json"), {
    workflowId: "mv-hook-001",
    stage: "generate",
    maxCostUsd: 0,
    operations: [
      {
        id: "hero-video-shot",
        capability: "video.generation",
        provider: "local-wan",
        runtime: "wan-local",
        mode: "local",
        availability: "unavailable",
        estimatedCostUsd: 0,
        estimatedSeconds: 180,
        requiresByoKey: false,
      },
      {
        id: "cloud-backup-shot",
        capability: "video.generation",
        provider: "cloud-video",
        runtime: "remote-video-api",
        mode: "remote",
        availability: "available",
        estimatedCostUsd: 1.25,
        estimatedSeconds: 90,
        requiresByoKey: true,
      },
    ],
    fallbackOptions: [
      {
        fromOperationId: "hero-video-shot",
        toOperationId: "cloud-backup-shot",
        reason: "local runtime unavailable",
      },
    ],
  });

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runGate = (requestPath: string, outPath: string) => spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-dry-run-cost-gate",
      "--request",
      requestPath,
      "--out",
      outPath,
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  const free = runGate("plans/free-local.json", "reviews/gates/free-local.dry-run-cost-gate.json");
  assert.equal(free.status, 0, free.stderr);
  const freePayload = JSON.parse(free.stdout);
  assert.equal(freePayload.status, "planned");
  const freeGate = JSON.parse(await readFile(join(cwd, "reviews", "gates", "free-local.dry-run-cost-gate.json"), "utf8"));
  assert.equal(freeGate.kind, "clash.workflow.dry-run-cost-gate");
  assert.equal(freeGate.status, "planned");
  assert.equal(freeGate.maxCostUsd, 0);
  assert.equal(freeGate.totalEstimatedCostUsd, 0);
  assert.equal(freeGate.executionAllowed, true);
  assert.equal(freeGate.fallbackUsed, false);
  assert.deepEqual(freeGate.blockedReasons, []);

  const blocked = runGate("plans/blocked-cloud-fallback.json", "reviews/gates/blocked-cloud.dry-run-cost-gate.json");
  assert.equal(blocked.status, 0, blocked.stderr);
  const blockedPayload = JSON.parse(blocked.stdout);
  assert.equal(blockedPayload.status, "blocked");
  const blockedGate = JSON.parse(await readFile(join(cwd, "reviews", "gates", "blocked-cloud.dry-run-cost-gate.json"), "utf8"));
  assert.equal(blockedGate.status, "blocked");
  assert.equal(blockedGate.executionAllowed, false);
  assert.equal(blockedGate.fallbackUsed, false);
  assert.equal(blockedGate.totalEstimatedCostUsd, 1.25);
  assert.deepEqual(blockedGate.blockedReasons, [
    "runtime wan-local unavailable for operation hero-video-shot",
    "estimated cost 1.25 exceeds max cost 0",
  ]);
  assert.deepEqual(blockedGate.rejectedFallbacks, [
    {
      fromOperationId: "hero-video-shot",
      toOperationId: "cloud-backup-shot",
      reason: "fallback local-wan/wan-local -> cloud-video/remote-video-api requires explicit approval",
    },
  ]);
  assert.match(blockedGate.decisionLog.join("\n"), /did not execute generation/);
  assert.equal(existsSync(join(cwd, "assets", "video", "cloud-backup-shot.mp4")), false);
});

test("dry-run cost gate rejects symlinked output paths that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-dry-run-gate-path-"));
  await writeJson(join(cwd, "plans", "dry-run.json"), {
    workflowId: "mv-launch",
    stage: "generate",
    maxCostUsd: 1,
    operations: [
      {
        id: "local-audio",
        capability: "audio.beat-analysis",
        provider: "local",
        runtime: "ffmpeg",
        mode: "local",
        availability: "available",
        estimatedCostUsd: 0,
        requiresByoKey: false,
      },
    ],
    fallbackOptions: [],
  });
  const outside = join(cwd, "..", "outside-dry-run-gate-path");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "reviews", "gates"), { recursive: true });
  const outsideGatePath = join(outside, "dry-run-cost-gate.json");
  await writeFile(outsideGatePath, "outside\n", "utf8");
  await symlink(outsideGatePath, join(cwd, "reviews", "gates", "dry-run-cost-gate.json"));

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const planned = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-dry-run-cost-gate",
      "--request",
      "plans/dry-run.json",
      "--out",
      "reviews/gates/dry-run-cost-gate.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /Agent file path must not traverse a symlink outside the current project cwd/);
  assert.equal(await readFile(outsideGatePath, "utf8"), "outside\n");
});

test("reference roles planning rejects symlinked action paths that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-reference-roles-path-"));
  await writeJson(join(cwd, "references", "roles.json"), [
    {
      roleId: "hero-front",
      assetId: "asset-hero-front",
      role: "identity-front",
      path: "assets/reference-sheets/hero-front.png",
    },
  ]);
  const outside = join(cwd, "..", "outside-reference-roles-action-path");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "actions"), { recursive: true });
  const outsideActionPath = join(outside, "reference-roles.json");
  await writeFile(outsideActionPath, "outside\n", "utf8");
  await symlink(outsideActionPath, join(cwd, "actions", "reference-roles.json"));

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const planned = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-reference-roles",
      "--target-asset",
      "asset-reference-pack",
      "--roles",
      "references/roles.json",
      "--out",
      "actions/reference-roles.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /Agent file path must not traverse a symlink outside the current project cwd/);
  assert.equal(await readFile(outsideActionPath, "utf8"), "outside\n");
});

test("runs production semantic reference roles and applies them to individual asset metadata", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-reference-roles-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      { id: "asset-reference-pack", type: "reference-pack", metadata: {} },
      { id: "asset-hero-front", type: "image", path: "assets/reference-sheets/hero-front.png", metadata: {} },
      { id: "asset-logo-lock", type: "image", path: "assets/brand/logo.png", metadata: {} },
      { id: "asset-packshot", type: "image", path: "assets/products/packshot.png", metadata: {} },
    ],
  });
  await writeJson(join(cwd, "references", "roles.json"), [
    {
      roleId: "hero-front",
      assetId: "asset-hero-front",
      role: "identity-front",
      subjectId: "hero",
      path: "assets/reference-sheets/hero-front.png",
      locked: true,
    },
    {
      roleId: "brand-logo",
      assetId: "asset-logo-lock",
      role: "logo-lock",
      subjectId: "brand-main",
      path: "assets/brand/logo.png",
      locked: true,
      constraints: ["preserve exact glyphs", "no recolor"],
    },
    {
      roleId: "product-packshot",
      assetId: "asset-packshot",
      role: "product-packshot",
      subjectId: "sku-001",
      path: "assets/products/packshot.png",
      locked: true,
      constraints: ["preserve packaging", "preserve claims text"],
    },
  ]);

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = (args: string[]) => spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry.pathname, "production", ...args],
    { cwd, encoding: "utf8" },
  );

  const planned = runCli([
    "plan-reference-roles",
    "--target-asset",
    "asset-reference-pack",
    "--roles",
    "references/roles.json",
    "--out",
    "actions/reference-roles.json",
    "--json",
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  const plannedPayload = JSON.parse(planned.stdout);
  assert.equal(plannedPayload.roles, 3);
  assert.match(plannedPayload.actionPath, /actions\/reference-roles\.json$/);
  const action = JSON.parse(await readFile(join(cwd, "actions", "reference-roles.json"), "utf8"));
  assert.equal(action.metadataKind, "image.semantic-reference-roles");
  assert.equal(action.metadata.roles[1].role, "logo-lock");
  assert.equal(action.metadata.roles[1].copyOnWriteRequired, true);

  const applied = runCli([
    "apply-metadata",
    "--action",
    "actions/reference-roles.json",
    "--assets",
    "assets/manifest.json",
    "--json",
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const appliedPayload = JSON.parse(applied.stdout);
  assert.match(
    appliedPayload.metadataPath,
    /projections\/metadata\/asset-reference-pack\.image\.semantic-reference-roles\.json$/,
  );
  const projection = JSON.parse(
    await readFile(join(cwd, "projections", "references", "asset-reference-pack.semantic-reference-roles.json"), "utf8"),
  );
  assert.equal(projection.kind, "clash.image.semantic-reference-roles.projection");
  assert.equal(projection.roles.length, 3);
  assert.equal(projection.roles[0].downstreamUsage, "identity-reference");
  assert.equal(projection.roles[1].downstreamUsage, "brand-lock");
  assert.equal(projection.roles[2].downstreamUsage, "product-reference");

  const manifest = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const logo = manifest.assets.find((asset: any) => asset.id === "asset-logo-lock");
  assert.deepEqual(logo.metadata["image.semantic-reference-role"], {
    rolePackAssetId: "asset-reference-pack",
    roleId: "brand-logo",
    role: "logo-lock",
    subjectId: "brand-main",
    path: "assets/brand/logo.png",
    locked: true,
    copyOnWriteRequired: true,
    downstreamUsage: "brand-lock",
    constraints: ["preserve exact glyphs", "no recolor"],
  });
});

test("runs production product/logo QA from semantic references and evidence", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-product-logo-qa-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      { id: "asset-ad-frame", type: "image", path: "assets/ads/end-card.png", metadata: {} },
      { id: "asset-reference-pack", type: "reference-pack", metadata: {} },
      { id: "asset-logo-lock", type: "image", path: "assets/brand/logo.png", metadata: {} },
      { id: "asset-packshot", type: "image", path: "assets/products/packshot.png", metadata: {} },
    ],
  });
  await writeJson(join(cwd, "projections", "references", "asset-reference-pack.semantic-reference-roles.json"), {
    schemaVersion: 1,
    kind: "clash.image.semantic-reference-roles.projection",
    targetAssetId: "asset-reference-pack",
    copyOnWriteRequired: true,
    roles: [
      {
        roleId: "brand-logo",
        assetId: "asset-logo-lock",
        role: "logo-lock",
        subjectId: "brand-main",
        path: "assets/brand/logo.png",
        locked: true,
        copyOnWriteRequired: true,
        downstreamUsage: "brand-lock",
        constraints: ["preserve exact glyphs", "brand color #0057B8"],
      },
      {
        roleId: "product-packshot",
        assetId: "asset-packshot",
        role: "product-packshot",
        subjectId: "sku-001",
        path: "assets/products/packshot.png",
        locked: true,
        copyOnWriteRequired: true,
        downstreamUsage: "product-reference",
        constraints: ["front packaging visible", "claim text SPF50+"],
      },
    ],
  });
  await writeJson(join(cwd, "qa", "visual", "product-logo-evidence.json"), {
    schemaVersion: 1,
    targetAssetId: "asset-ad-frame",
    observations: [
      {
        id: "logo-visible",
        roleId: "brand-logo",
        check: "logo-presence",
        status: "pass",
        confidence: 0.96,
        expected: "locked logo is visible",
        actual: "logo appears on the end card",
      },
      {
        id: "brand-color",
        roleId: "brand-logo",
        check: "brand-color",
        status: "pass",
        confidence: 0.91,
        expected: "#0057B8",
        actual: "#0057B8",
        deltaE: 1.2,
      },
      {
        id: "packshot-visible",
        roleId: "product-packshot",
        check: "packshot-presence",
        status: "pass",
        confidence: 0.93,
        expected: "front packaging visible",
        actual: "front packaging is visible",
      },
      {
        id: "claim-text",
        roleId: "product-packshot",
        check: "claim-text",
        status: "fail",
        confidence: 0.88,
        expected: "SPF50+",
        actual: "SPFSO+",
      },
    ],
  });

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = (args: string[]) => spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry.pathname, "production", ...args],
    { cwd, encoding: "utf8" },
  );

  const planned = runCli([
    "plan-product-logo-qa",
    "--target-asset",
    "asset-ad-frame",
    "--reference-roles",
    "projections/references/asset-reference-pack.semantic-reference-roles.json",
    "--evidence",
    "qa/visual/product-logo-evidence.json",
    "--out",
    "actions/product-logo-qa.json",
    "--report",
    "qa/image/asset-ad-frame.product-logo-qa.json",
    "--json",
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  const plannedPayload = JSON.parse(planned.stdout);
  assert.equal(plannedPayload.verdict, "fail");
  assert.equal(plannedPayload.checks, 4);
  assert.deepEqual(plannedPayload.blockedReasons, ["claim-text failed for role product-packshot"]);

  const action = JSON.parse(await readFile(join(cwd, "actions", "product-logo-qa.json"), "utf8"));
  assert.equal(action.metadataKind, "image.product-logo-qa");
  assert.equal(action.metadata.kind, "image.product-logo-qa");
  assert.equal(action.metadata.verdict, "fail");
  assert.deepEqual(action.metadata.requiredReferenceAssetIds, ["asset-logo-lock", "asset-packshot"]);
  assert.equal(action.metadata.checks.find((check: any) => check.id === "claim-text").status, "fail");

  const report = JSON.parse(await readFile(join(cwd, "qa", "image", "asset-ad-frame.product-logo-qa.json"), "utf8"));
  assert.equal(report.kind, "clash.image.product-logo-qa");
  assert.equal(report.verdict, "fail");
  assert.equal(report.copyOnWriteRequired, true);
  assert.equal(report.references[0].role, "logo-lock");

  const applied = runCli([
    "apply-metadata",
    "--action",
    "actions/product-logo-qa.json",
    "--assets",
    "assets/manifest.json",
    "--json",
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const projection = JSON.parse(
    await readFile(join(cwd, "projections", "qa", "asset-ad-frame.product-logo-qa.json"), "utf8"),
  );
  assert.equal(projection.kind, "clash.image.product-logo-qa.projection");
  assert.equal(projection.verdict, "fail");
  assert.equal(projection.references[1].role, "product-packshot");
  assert.equal(projection.checks.find((check: any) => check.id === "claim-text").actual, "SPFSO+");

  const manifest = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const target = manifest.assets.find((asset: any) => asset.id === "asset-ad-frame");
  assert.equal(target.metadata["image.product-logo-qa"].verdict, "fail");
  assert.deepEqual(target.metadata["image.product-logo-qa"].blockedReasons, [
    "claim-text failed for role product-packshot",
  ]);
});

test("runs production analysis backend benchmark without executing analyzers", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-analysis-benchmark-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-song", type: "audio", path: "assets/audio/song.wav", metadata: {} }],
  });
  await writeJson(join(cwd, "analysis", "audio", "local-wav.beat-grid.json"), {
    kind: "fixture.beat-grid-result",
    backendId: "local-wav",
    bpm: 128,
  });
  await writeJson(join(cwd, "analysis", "audio", "vlm-audio.beat-grid.json"), {
    kind: "fixture.beat-grid-result",
    backendId: "vlm-audio",
    bpm: 122,
  });
  await writeJson(join(cwd, "benchmarks", "beat-backends.json"), {
    benchmarkId: "mv-beat-grid-v1",
    targetCapability: "audio.beat-grid",
    fixtureSetPath: "benchmarks/fixtures/click-track.json",
    candidates: [
      {
        backendId: "local-wav",
        capability: "audio.beat-grid",
        resultPath: "analysis/audio/local-wav.beat-grid.json",
        metrics: [
          { id: "bpm-accuracy", score: 0.99, threshold: 0.95, weight: 2 },
          { id: "downbeat-f1", score: 0.94, threshold: 0.9 },
        ],
      },
      {
        backendId: "vlm-audio",
        capability: "audio.beat-grid",
        resultPath: "analysis/audio/vlm-audio.beat-grid.json",
        metrics: [
          { id: "bpm-accuracy", score: 0.82, threshold: 0.95, weight: 2 },
          { id: "downbeat-f1", score: 0.61, threshold: 0.9 },
        ],
      },
    ],
  });

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = (args: string[]) => spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry.pathname, "production", ...args],
    { cwd, encoding: "utf8" },
  );

  const planned = runCli([
    "plan-analysis-benchmark",
    "--target-asset",
    "asset-song",
    "--request",
    "benchmarks/beat-backends.json",
    "--out",
    "actions/beat-backend-benchmark.json",
    "--report",
    "qa/analysis/beat-backend-benchmark.json",
    "--json",
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  const plannedPayload = JSON.parse(planned.stdout);
  assert.equal(plannedPayload.verdict, "pass");
  assert.equal(plannedPayload.selectedBackendId, "local-wav");
  assert.equal(plannedPayload.candidates, 2);

  const action = JSON.parse(await readFile(join(cwd, "actions", "beat-backend-benchmark.json"), "utf8"));
  assert.equal(action.metadataKind, "analysis.backend-benchmark");
  assert.equal(action.metadata.kind, "analysis.backend-benchmark");
  assert.equal(action.metadata.selectedBackendId, "local-wav");
  assert.equal(action.metadata.candidates[0].weightedScore, 0.973);
  assert.equal(action.metadata.candidates[1].status, "fail");
  assert.deepEqual(action.metadata.decisionLog, [
    "loaded 2 candidate backend results for audio.beat-grid",
    "selected local-wav with weighted score 0.973",
    "did not execute analysis backends",
  ]);

  const report = JSON.parse(await readFile(join(cwd, "qa", "analysis", "beat-backend-benchmark.json"), "utf8"));
  assert.equal(report.kind, "clash.analysis.backend-benchmark");
  assert.equal(report.selectedBackendId, "local-wav");
  assert.equal(report.candidates[1].metrics[0].status, "fail");

  const applied = runCli([
    "apply-metadata",
    "--action",
    "actions/beat-backend-benchmark.json",
    "--assets",
    "assets/manifest.json",
    "--json",
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const projection = JSON.parse(
    await readFile(join(cwd, "projections", "analysis", "asset-song.mv-beat-grid-v1.backend-benchmark.json"), "utf8"),
  );
  assert.equal(projection.kind, "clash.analysis.backend-benchmark.projection");
  assert.equal(projection.selectedBackendId, "local-wav");
  assert.equal(projection.candidates.length, 2);

  const manifest = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const target = manifest.assets.find((asset: any) => asset.id === "asset-song");
  assert.equal(target.metadata["analysis.backend-benchmark"].selectedBackendId, "local-wav");
});

test("runs production image embedding store from existing vector files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-image-embedding-store-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      { id: "asset-reference-pack", type: "reference-pack", metadata: {} },
      { id: "asset-hero-front", type: "image", path: "assets/reference-sheets/hero-front.png", metadata: {} },
      { id: "asset-packshot", type: "image", path: "assets/products/packshot.png", metadata: {} },
    ],
  });
  await writeJson(join(cwd, "embeddings", "vectors", "hero-front.json"), [0.1, 0.2, 0.3, 0.4]);
  await writeJson(join(cwd, "embeddings", "vectors", "packshot.json"), [0.5, 0.4, 0.3, 0.2]);
  await writeJson(join(cwd, "embeddings", "image-baselines.json"), {
    embeddingSetId: "reference-baselines-v1",
    modelId: "local-clip-vit-b32",
    dimension: 4,
    distanceMetric: "cosine",
    items: [
      {
        assetId: "asset-hero-front",
        roleId: "hero-front",
        subjectId: "hero",
        path: "assets/reference-sheets/hero-front.png",
        vectorPath: "embeddings/vectors/hero-front.json",
        baselineFor: ["identity"],
        locked: true,
        copyOnWriteRequired: true,
        tags: ["front", "character"],
      },
      {
        assetId: "asset-packshot",
        roleId: "product-packshot",
        subjectId: "sku-001",
        path: "assets/products/packshot.png",
        vectorPath: "embeddings/vectors/packshot.json",
        baselineFor: ["product"],
        locked: true,
        copyOnWriteRequired: true,
        tags: ["packshot"],
      },
    ],
  });

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = (args: string[]) => spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry.pathname, "production", ...args],
    { cwd, encoding: "utf8" },
  );

  const planned = runCli([
    "plan-image-embedding-store",
    "--target-asset",
    "asset-reference-pack",
    "--embeddings",
    "embeddings/image-baselines.json",
    "--out",
    "actions/image-embedding-store.json",
    "--report",
    "qa/image/reference-baselines.embedding-store.json",
    "--json",
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  const plannedPayload = JSON.parse(planned.stdout);
  assert.equal(plannedPayload.embeddingSetId, "reference-baselines-v1");
  assert.equal(plannedPayload.items, 2);
  assert.equal(plannedPayload.dimension, 4);

  const action = JSON.parse(await readFile(join(cwd, "actions", "image-embedding-store.json"), "utf8"));
  assert.equal(action.metadataKind, "image.embedding-store");
  assert.equal(action.metadata.kind, "image.embedding-store");
  assert.equal(action.metadata.modelId, "local-clip-vit-b32");
  assert.equal(action.metadata.items[0].assetId, "asset-hero-front");
  assert.equal(action.metadata.items[0].vectorPath, "embeddings/vectors/hero-front.json");
  assert.match(action.metadata.items[0].vectorHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(action.metadata.items[1].baselineFor[0], "product");

  const report = JSON.parse(await readFile(join(cwd, "qa", "image", "reference-baselines.embedding-store.json"), "utf8"));
  assert.equal(report.kind, "clash.image.embedding-store");
  assert.equal(report.copyOnWriteRequired, true);
  assert.equal(report.items[0].dimension, 4);

  const applied = runCli([
    "apply-metadata",
    "--action",
    "actions/image-embedding-store.json",
    "--assets",
    "assets/manifest.json",
    "--json",
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const projection = JSON.parse(
    await readFile(join(cwd, "projections", "embeddings", "asset-reference-pack.reference-baselines-v1.embedding-store.json"), "utf8"),
  );
  assert.equal(projection.kind, "clash.image.embedding-store.projection");
  assert.equal(projection.items.length, 2);
  assert.equal(projection.items[0].baselineFor[0], "identity");

  const manifest = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const hero = manifest.assets.find((asset: any) => asset.id === "asset-hero-front");
  assert.equal(hero.metadata["image.embedding"].embeddingSetId, "reference-baselines-v1");
  assert.equal(hero.metadata["image.embedding"].copyOnWriteRequired, true);
  assert.equal(hero.metadata["image.embedding"].vectorPath, "embeddings/vectors/hero-front.json");
});

test("runs production audio stem separation from existing local stem files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-audio-stems-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-song", type: "audio", path: "assets/audio/song.wav", metadata: {} }],
  });
  await writeBinary(join(cwd, "assets", "audio", "stems", "vocals.wav"), Buffer.from("vocal-stem-fixture"));
  await writeBinary(join(cwd, "assets", "audio", "stems", "instrumental.wav"), Buffer.from("instrumental-stem-fixture"));
  await writeJson(join(cwd, "stems", "song-stems.json"), {
    separationId: "mv-song-stems-v1",
    sourceAssetId: "asset-song",
    sourcePath: "assets/audio/song.wav",
    backendId: "local-demucs-precomputed",
    modelId: "htdemucs-fixture",
    stems: [
      {
        stemAssetId: "asset-song-vocals",
        stemType: "vocal",
        path: "assets/audio/stems/vocals.wav",
        codec: "pcm_s16le",
        durationSeconds: 15,
        sampleRate: 44100,
        channels: 2,
      },
      {
        stemAssetId: "asset-song-instrumental",
        stemType: "instrumental",
        path: "assets/audio/stems/instrumental.wav",
        codec: "pcm_s16le",
        durationSeconds: 15,
        sampleRate: 44100,
        channels: 2,
      },
    ],
  });

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = (args: string[]) => spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry.pathname, "production", ...args],
    { cwd, encoding: "utf8" },
  );

  const planned = runCli([
    "plan-audio-stem-separation",
    "--target-asset",
    "asset-song",
    "--stems",
    "stems/song-stems.json",
    "--out",
    "actions/audio-stems.json",
    "--report",
    "qa/audio/mv-song-stems-v1.stem-separation.json",
    "--json",
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  const plannedPayload = JSON.parse(planned.stdout);
  assert.equal(plannedPayload.separationId, "mv-song-stems-v1");
  assert.equal(plannedPayload.stems, 2);
  assert.equal(plannedPayload.vocalStemAssetId, "asset-song-vocals");

  const action = JSON.parse(await readFile(join(cwd, "actions", "audio-stems.json"), "utf8"));
  assert.equal(action.metadataKind, "audio.stem-separation");
  assert.equal(action.metadata.kind, "audio.stem-separation");
  assert.equal(action.metadata.sourceAssetId, "asset-song");
  assert.equal(action.metadata.vocalStemAssetId, "asset-song-vocals");
  assert.match(action.metadata.stems[0].fileHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(action.metadata.decisionLog, [
    "registered 2 audio stem files for mv-song-stems-v1",
    "did not execute stem separation backends",
  ]);

  const report = JSON.parse(await readFile(join(cwd, "qa", "audio", "mv-song-stems-v1.stem-separation.json"), "utf8"));
  assert.equal(report.kind, "clash.audio.stem-separation");
  assert.equal(report.stems[0].stemType, "vocal");

  const applied = runCli([
    "apply-metadata",
    "--action",
    "actions/audio-stems.json",
    "--assets",
    "assets/manifest.json",
    "--json",
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const projection = JSON.parse(
    await readFile(join(cwd, "projections", "audio", "asset-song.mv-song-stems-v1.stem-separation.json"), "utf8"),
  );
  assert.equal(projection.kind, "clash.audio.stem-separation.projection");
  assert.equal(projection.vocalStemAssetId, "asset-song-vocals");
  assert.equal(projection.stems.length, 2);

  const manifest = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const vocal = manifest.assets.find((asset: any) => asset.id === "asset-song-vocals");
  assert.equal(vocal.type, "audio-stem");
  assert.equal(vocal.metadata["audio.stem"].stemType, "vocal");
  assert.equal(vocal.metadata["audio.stem"].sourceAssetId, "asset-song");
  assert.equal(vocal.metadata["audio.stem"].filePath, "assets/audio/stems/vocals.wav");
});

test("runs production ComfyUI workflow contract from local workflow and output files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-comfyui-workflow-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-image-job", type: "image-generation-job", metadata: {} }],
  });
  await writeJson(join(cwd, "workflows", "hero-reference.api.json"), {
    "6": { class_type: "CLIPTextEncode", inputs: { text: "front view hero reference" } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0] } },
  });
  await writeBinary(join(cwd, "assets", "generated", "hero-front.png"), Buffer.from("fake-png-output"));
  await writeJson(join(cwd, "plans", "comfyui-hero-reference.json"), {
    workflowId: "hero-reference-gen-v1",
    workflowPath: "workflows/hero-reference.api.json",
    apiFormat: "comfyui-api-json",
    backendId: "local-comfyui",
    models: [
      {
        name: "sdxl-base",
        type: "checkpoint",
        path: "models/checkpoints/sdxl-base.safetensors",
        hash: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        license: "user-provided",
      },
    ],
    customNodes: [
      {
        name: "ComfyUI-Impact-Pack",
        source: "https://github.com/ltdrdata/ComfyUI-Impact-Pack",
        commit: "fixture-commit",
      },
    ],
    inputs: [
      {
        id: "positive-prompt",
        nodeId: "6",
        inputName: "text",
        kind: "text",
        value: "front view hero reference",
      },
    ],
    outputs: [
      {
        outputAssetId: "asset-hero-front",
        nodeId: "9",
        outputName: "IMAGE",
        mediaType: "image",
        path: "assets/generated/hero-front.png",
      },
    ],
    execution: {
      mode: "completed",
      runnerId: "local-comfyui",
      promptId: "prompt-fixture",
    },
  });

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = (args: string[]) => spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry.pathname, "production", ...args],
    { cwd, encoding: "utf8" },
  );

  const planned = runCli([
    "plan-comfyui-workflow",
    "--target-asset",
    "asset-image-job",
    "--request",
    "plans/comfyui-hero-reference.json",
    "--out",
    "actions/comfyui-workflow.json",
    "--report",
    "qa/image/hero-reference.comfyui-workflow.json",
    "--json",
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  const plannedPayload = JSON.parse(planned.stdout);
  assert.equal(plannedPayload.workflowId, "hero-reference-gen-v1");
  assert.equal(plannedPayload.outputs, 1);
  assert.equal(plannedPayload.materializedOutputs, 1);

  const action = JSON.parse(await readFile(join(cwd, "actions", "comfyui-workflow.json"), "utf8"));
  assert.equal(action.metadataKind, "image.comfyui-runner");
  assert.equal(action.metadata.kind, "image.comfyui-runner");
  assert.match(action.metadata.workflowHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(action.metadata.outputs[0].fileHash.length, 71);
  assert.deepEqual(action.metadata.decisionLog, [
    "registered ComfyUI workflow hero-reference-gen-v1",
    "did not execute ComfyUI backend",
  ]);

  const report = JSON.parse(await readFile(join(cwd, "qa", "image", "hero-reference.comfyui-workflow.json"), "utf8"));
  assert.equal(report.kind, "clash.image.comfyui-runner");
  assert.equal(report.models[0].license, "user-provided");
  assert.equal(report.outputs[0].status, "materialized");

  const applied = runCli([
    "apply-metadata",
    "--action",
    "actions/comfyui-workflow.json",
    "--assets",
    "assets/manifest.json",
    "--json",
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const projection = JSON.parse(
    await readFile(join(cwd, "projections", "image", "asset-image-job.hero-reference-gen-v1.comfyui-runner.json"), "utf8"),
  );
  assert.equal(projection.kind, "clash.image.comfyui-runner.projection");
  assert.equal(projection.outputs[0].outputAssetId, "asset-hero-front");

  const manifest = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const outputAsset = manifest.assets.find((asset: any) => asset.id === "asset-hero-front");
  assert.equal(outputAsset.type, "image");
  assert.equal(outputAsset.path, "assets/generated/hero-front.png");
  assert.equal(outputAsset.metadata["image.comfyui-output"].workflowId, "hero-reference-gen-v1");
  assert.equal(outputAsset.metadata["image.comfyui-output"].status, "materialized");
});

test("runs production content credentials plan without signing C2PA", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-content-credentials-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      { id: "asset-export", type: "video", path: "exports/episode-001.mp4", metadata: {} },
      { id: "asset-panel-1", type: "image", path: "assets/storyboards/panel-1.png", metadata: {} },
    ],
  });
  await writeBinary(join(cwd, "exports", "episode-001.mp4"), Buffer.from("fake-video-export"));
  await writeBinary(join(cwd, "assets", "storyboards", "panel-1.png"), Buffer.from("fake-panel"));
  await writeJson(join(cwd, "plans", "content-credentials.json"), {
    credentialId: "episode-001-export-provenance",
    targetAssetId: "asset-export",
    targetPath: "exports/episode-001.mp4",
    mode: "unsigned-manifest",
    signatureStatus: "unsigned",
    ingredients: [
      {
        assetId: "asset-panel-1",
        path: "assets/storyboards/panel-1.png",
        relationship: "generated-input",
      },
    ],
    actions: [
      {
        actionId: "storyboard-review",
        action: "metadata-fill",
        softwareAgent: "clash-production",
      },
    ],
    assertions: [
      {
        label: "ai.generated",
        value: "Generated with local image backend; unsigned local manifest only.",
      },
    ],
  });

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = (args: string[]) => spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry.pathname, "production", ...args],
    { cwd, encoding: "utf8" },
  );

  const planned = runCli([
    "plan-content-credentials",
    "--target-asset",
    "asset-export",
    "--request",
    "plans/content-credentials.json",
    "--out",
    "actions/content-credentials.json",
    "--report",
    "qa/provenance/episode-001.content-credentials.json",
    "--json",
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  const plannedPayload = JSON.parse(planned.stdout);
  assert.equal(plannedPayload.credentialId, "episode-001-export-provenance");
  assert.equal(plannedPayload.signatureStatus, "unsigned");
  assert.equal(plannedPayload.ingredients, 1);

  const action = JSON.parse(await readFile(join(cwd, "actions", "content-credentials.json"), "utf8"));
  assert.equal(action.metadataKind, "provenance.content-credentials");
  assert.equal(action.metadata.kind, "provenance.content-credentials");
  assert.match(action.metadata.targetHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(action.metadata.ingredients[0].hash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(action.metadata.decisionLog, [
    "registered unsigned content credentials manifest episode-001-export-provenance",
    "did not sign C2PA manifest",
  ]);

  const report = JSON.parse(await readFile(join(cwd, "qa", "provenance", "episode-001.content-credentials.json"), "utf8"));
  assert.equal(report.kind, "clash.provenance.content-credentials");
  assert.equal(report.signatureStatus, "unsigned");
  assert.equal(report.ingredients[0].relationship, "generated-input");

  const applied = runCli([
    "apply-metadata",
    "--action",
    "actions/content-credentials.json",
    "--assets",
    "assets/manifest.json",
    "--json",
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const projection = JSON.parse(
    await readFile(join(cwd, "projections", "provenance", "asset-export.episode-001-export-provenance.content-credentials.json"), "utf8"),
  );
  assert.equal(projection.kind, "clash.provenance.content-credentials.projection");
  assert.equal(projection.signatureStatus, "unsigned");

  const manifest = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const exportAsset = manifest.assets.find((asset: any) => asset.id === "asset-export");
  assert.equal(exportAsset.metadata["provenance.content-credentials"].credentialId, "episode-001-export-provenance");
  assert.equal(exportAsset.metadata["provenance.content-credentials"].signatureStatus, "unsigned");
});

test("exports MG frame snapshots as a real local asset manifest entry", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-mg-asset-"));
  const specPath = join(cwd, "compositions", "lower-third", "spec.json");
  const assetsPath = join(cwd, "assets", "manifest.json");
  await writeJson(assetsPath, { assets: [] });
  await writeJson(specPath, {
    id: "agent-cwd-lower-third",
    name: "Agent CWD Lower Third",
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 90,
    background: "transparent",
    layers: [
      {
        id: "bar",
        type: "shape",
        shape: "rounded-rect",
        from: 0,
        durationInFrames: 75,
        x: 72,
        y: 1350,
        width: 640,
        height: 132,
        fill: "#101820",
        opacity: 0,
        animations: [
          { property: "x", from: -760, to: 72, startFrame: 0, durationInFrames: 18, easing: "easeOutCubic" },
          { property: "opacity", from: 0, to: 0.92, startFrame: 0, durationInFrames: 12, easing: "linear" },
        ],
      },
      {
        id: "title",
        type: "text",
        from: 6,
        durationInFrames: 60,
        x: 116,
        y: 1386,
        text: "Agent owns cwd",
        fontSize: 56,
        color: "#F8FAFC",
        opacity: 0,
        animations: [
          { property: "opacity", from: 0, to: 1, startFrame: 6, durationInFrames: 8, easing: "linear" },
        ],
      },
    ],
  });

  const result = await exportMgSnapshotAsset({
    cwd,
    specPath,
    assetId: "asset-mg-lower-third",
    outDir: "assets/overlays/lower-third",
    frames: [0, 18, 42],
    assetsPath,
  });

  assert.equal(result.assetId, "asset-mg-lower-third");
  assert.equal(result.framePaths.length, 3);
  assert.equal(result.assetManifestPath, assetsPath);
  assert.match(result.exportManifestPath, /assets\/overlays\/lower-third\/manifest\.json$/);
  const frameSvg = await readFile(result.framePaths[1], "utf8");
  assert.match(frameSvg, /<svg/);
  assert.match(frameSvg, /data-frame="18"/);
  assert.match(frameSvg, /Agent owns cwd/);
  assert.doesNotMatch(frameSvg, /<script/i);
  assert.doesNotMatch(frameSvg, /\b(?:href|src)=["']https?:\/\//i);
  const assets = JSON.parse(await readFile(assetsPath, "utf8"));
  assert.equal(assets.assets[0].id, "asset-mg-lower-third");
  assert.equal(assets.assets[0].type, "overlay-snapshot-sequence");
  assert.equal(assets.assets[0].metadata["mg.snapshot-export"].frameCount, 3);
  assert.deepEqual(assets.assets[0].metadata["mg.snapshot-export"].frames.map((frame: any) => frame.frame), [0, 18, 42]);
});

test("runs production export-mg-snapshots as a black-box CLI command over the MG fixture", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-mg-asset-cli-"));
  const fixtureRoot = new URL("../../../../examples/mg/lower-third/", import.meta.url);
  await cp(fixtureRoot, join(cwd, "mg"), { recursive: true });
  await writeJson(join(cwd, "assets", "manifest.json"), { assets: [] });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-mg-snapshots",
      "--spec",
      "mg/spec.json",
      "--asset-id",
      "asset-mg-lower-third",
      "--out",
      "assets/overlays/lower-third",
      "--assets",
      "assets/manifest.json",
      "--frames",
      "0,18,42",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.assetId, "asset-mg-lower-third");
  assert.equal(payload.frames, 3);
  assert.match(payload.exportManifestPath, /assets\/overlays\/lower-third\/manifest\.json$/);
  assert.ok(existsSync(join(cwd, "assets", "overlays", "lower-third", "frame-0018.svg")));
  const assets = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  assert.equal(assets.assets[0].metadata["mg.snapshot-export"].compositionId, "cwd-principle-lower-third");
});

test("projects a derived overlay asset into a CAS-required timeline view", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-derived-overlay-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      {
        id: "asset-logo-original",
        type: "image",
        path: "assets/source/logo.png",
        metadata: {},
      },
      {
        id: "asset-logo-callout",
        type: "overlay-snapshot-sequence",
        path: "assets/derived/logo-callout/manifest.json",
        metadata: {
          "mg.snapshot-export": {
            kind: "clash.mg.snapshot-export",
            compositionId: "logo-callout",
            frameCount: 3,
          },
        },
      },
    ],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-derived-overlay",
      "--source-asset",
      "asset-logo-original",
      "--derived-asset",
      "asset-logo-callout",
      "--media-type",
      "image",
      "--from",
      "24",
      "--duration",
      "60",
      "--derivation-kind",
      "crop",
      "--description",
      "copy-on-write logo callout cropped from approved source",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.projected, true);
  assert.equal(payload.sourceAssetId, "asset-logo-original");
  assert.equal(payload.derivedAssetId, "asset-logo-callout");
  assert.match(payload.timelineProjectionPath, /projections\/timelines\/asset-logo-callout\.derived-overlay\.timeline\.yaml$/);
  assert.match(payload.manifestPath, /projections\/timelines\/asset-logo-callout\.derived-overlay\.timeline-manifest\.json$/);
  assert.match(payload.timelineLockPath, /timelines\/main\.timeline\.lock\.json$/);
  assert.ok(existsSync(payload.timelineProjectionPath));
  assert.ok(existsSync(payload.manifestPath));
  assert.equal(existsSync(payload.timelineLockPath), false, "projection command must not mint a fake CAS lock");

  const parsedTimeline = timelineDslFromYaml(await readFile(payload.timelineProjectionPath, "utf8"));
  assert.equal(parsedTimeline.ok, true);
  if (!parsedTimeline.ok) return;
  const item = parsedTimeline.dsl.tracks[0].items[0] as any;
  assert.deepEqual(parsedTimeline.dsl.tracks[0].role, "overlay");
  assert.deepEqual(item, {
    id: "asset-logo-callout-overlay",
    type: "derived-overlay",
    from: 24,
    durationInFrames: 60,
    mediaType: "image",
    src: "assets/derived/logo-callout/manifest.json",
    sourceAssetId: "asset-logo-original",
    derivedAssetId: "asset-logo-callout",
    derivation: {
      kind: "crop",
      description: "copy-on-write logo callout cropped from approved source",
    },
  });

  const manifest = JSON.parse(await readFile(payload.manifestPath, "utf8"));
  assert.deepEqual(
    manifest.casApply,
    expectedTimelineCasApply("projections/timelines/asset-logo-callout.derived-overlay.timeline.yaml"),
  );
  assert.equal(manifest.timelineItems[0].type, "derived-overlay");

  const parsedForApply = parseTimelineFileForApply(await readFile(payload.timelineProjectionPath, "utf8"));
  assert.equal(parsedForApply.ok, true);
  if (!parsedForApply.ok) return;
  const cas = assertTimelineCas({
    projectId: "project-1",
    nodeId: "editor-1",
    lock: null,
    currentDsl: parsedForApply.dsl,
    force: false,
  });
  assert.equal(cas.ok, false);
  if (cas.ok) return;
  assert.match(cas.error, /Missing timeline CAS lock/);
});

test("runs production export-mg-video as a black-box CLI command and registers a playable overlay asset", async () => {
  const ffmpeg = resolveExecutable("ffmpeg");
  const ffprobe = resolveExecutable("ffprobe");
  assert.ok(ffmpeg, "ffmpeg is required for MG video export test");
  assert.ok(ffprobe, "ffprobe is required for MG video export test");

  const cwd = await mkdtemp(join(tmpdir(), "clash-production-mg-video-cli-"));
  await writeJson(join(cwd, "compositions", "badge", "spec.json"), {
    id: "agent-badge",
    name: "Agent Badge",
    width: 160,
    height: 90,
    fps: 12,
    durationInFrames: 12,
    background: "transparent",
    layers: [
      {
        id: "panel",
        type: "shape",
        shape: "rounded-rect",
        from: 0,
        durationInFrames: 12,
        x: 12,
        y: 20,
        width: 112,
        height: 34,
        radius: 6,
        fill: "#101820",
        opacity: 0.9,
      },
      {
        id: "label",
        type: "text",
        from: 0,
        durationInFrames: 12,
        x: 22,
        y: 28,
        text: "AGENT",
        fontSize: 16,
        color: "#F8FAFC",
        opacity: 1,
      },
    ],
  });
  await writeJson(join(cwd, "assets", "manifest.json"), { assets: [] });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-mg-video",
      "--spec",
      "compositions/badge/spec.json",
      "--asset-id",
      "asset-agent-badge-video",
      "--out",
      "assets/overlays/agent-badge.webm",
      "--assets",
      "assets/manifest.json",
      "--ffmpeg",
      ffmpeg,
      "--ffprobe",
      ffprobe,
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.assetId, "asset-agent-badge-video");
  assert.equal(payload.format, "webm");
  assert.match(payload.outputPath, /assets\/overlays\/agent-badge\.webm$/);
  assert.match(payload.exportManifestPath, /assets\/overlays\/agent-badge\.webm\.manifest\.json$/);
  assert.ok(existsSync(payload.outputPath));
  assert.ok(existsSync(payload.exportManifestPath));
  const exportManifest = JSON.parse(await readFile(payload.exportManifestPath, "utf8"));
  assert.equal(exportManifest.kind, "clash.mg.video-export");
  assert.equal(exportManifest.probe.width, 160);
  assert.equal(exportManifest.probe.height, 90);
  assert.equal(exportManifest.probe.codecName, "vp9");
  assert.equal(exportManifest.probe.alphaMode, "1");
  assert.equal(exportManifest.alpha.requested, true);
  assert.equal(exportManifest.alpha.verified, true);
  assert.equal(exportManifest.alpha.mode, "vp9-alpha-mode");
  assert.equal(exportManifest.alpha.pixelSampleVerified, true);
  assert.equal(exportManifest.alpha.reason, "ffprobe reported VP9 alpha_mode=1 and decoded alpha-plane samples contain transparent and visible pixels");
  assert.equal(exportManifest.alpha.sample.frame, 0);
  assert.equal(exportManifest.alpha.sample.width, 160);
  assert.equal(exportManifest.alpha.sample.height, 90);
  assert.ok(exportManifest.alpha.sample.transparentPixels > 0);
  assert.ok(exportManifest.alpha.sample.visiblePixels > 0);
  assert.equal(exportManifest.alpha.sample.minAlpha, 0);
  assert.ok(exportManifest.alpha.sample.maxAlpha > 0);
  assert.equal(exportManifest.durationInFrames, 12);
  const assets = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  assert.equal(assets.assets[0].id, "asset-agent-badge-video");
  assert.equal(assets.assets[0].type, "overlay-video");
  assert.equal(assets.assets[0].path, "assets/overlays/agent-badge.webm");
  assert.equal(assets.assets[0].metadata["mg.video-export"].compositionId, "agent-badge");
});

test("plans talking-head filler, tone-particle, and silence cuts from ASR words", () => {
  const action = planTalkingHeadTextCutAction({
    targetAssetId: "asset-talk",
    fps: 30,
    minSilenceFrames: 10,
    words: [
      { id: "w1", text: "大家", startFrame: 0, endFrame: 12 },
      { id: "w2", text: "嗯", startFrame: 12, endFrame: 18 },
      { id: "w3", text: "今天", startFrame: 30, endFrame: 42 },
      { id: "w4", text: "啊", startFrame: 42, endFrame: 48 },
      { id: "w5", text: "我们", startFrame: 48, endFrame: 60 },
      { id: "w6", text: "开始", startFrame: 60, endFrame: 72 },
    ],
  });

  assert.equal(action.metadataKind, "talking-head.analysis");
  assert.equal(action.metadata.kind, "talking-head.analysis");
  assert.deepEqual(action.metadata.disfluencies.map((item) => item.type), ["filler", "silence", "tone-particle"]);
  assert.deepEqual(action.metadata.disfluencies.map((item) => [item.type, item.startFrame, item.endFrame]), [
    ["filler", 12, 18],
    ["silence", 18, 30],
    ["tone-particle", 42, 48],
  ]);
  assert.deepEqual(action.metadata.disfluencies.map((item) => [
    item.type,
    item.requiresReview,
    item.confidence,
    item.detectionSource,
  ]), [
    ["filler", false, 0.92, "configured-token"],
    ["silence", false, 0.98, "word-gap"],
    ["tone-particle", true, 0.72, "configured-token"],
  ]);
  assert.deepEqual(
    action.metadata.cuts.map((cut) => [
      cut.action,
      cut.sourceStartFrame,
      cut.sourceEndFrame,
      cut.outputStartFrame,
      cut.outputEndFrame,
      cut.reason,
      cut.requiresReview,
      cut.confidence,
    ]),
    [
      ["keep", 0, 12, 0, 12, undefined, undefined, undefined],
      ["delete", 12, 18, 12, 12, "filler", false, 0.92],
      ["delete", 18, 30, 12, 12, "silence", false, 0.98],
      ["keep", 30, 42, 12, 24, undefined, undefined, undefined],
      ["review", 42, 48, 24, 24, "tone-particle", true, 0.72],
      ["keep", 48, 72, 24, 48, undefined, undefined, undefined],
    ],
  );
  assert.deepEqual(action.metadata.captionCues.map((cue) => [cue.text, cue.startFrame, cue.durationInFrames]), [
    ["大家", 0, 12],
    ["今天", 12, 12],
    ["我们开始", 24, 24],
  ]);
  assert.deepEqual(action.metadata.captionCues.map((cue) => [
    cue.text,
    cue.wordIds,
    cue.sourceStartFrame,
    cue.sourceEndFrame,
  ]), [
    ["大家", ["w1"], 0, 12],
    ["今天", ["w3"], 30, 42],
    ["我们开始", ["w5", "w6"], 48, 72],
  ]);
});

test("plans adjacent repeated words as text-based cuts while preserving the later word", () => {
  const action = planTalkingHeadTextCutAction({
    targetAssetId: "asset-talk",
    fps: 30,
    minSilenceFrames: 10,
    words: [
      { id: "w1", text: "我们", startFrame: 0, endFrame: 12 },
      { id: "w2", text: "我们", startFrame: 12, endFrame: 24 },
      { id: "w3", text: "今天", startFrame: 24, endFrame: 36 },
      { id: "w4", text: "开始", startFrame: 36, endFrame: 48 },
    ],
  });

  assert.equal(action.metadata.kind, "talking-head.analysis");
  if (action.metadata.kind !== "talking-head.analysis") return;
  assert.deepEqual(action.metadata.disfluencies.map((item) => [item.type, item.wordId, item.startFrame, item.endFrame]), [
    ["repeat", "w1", 0, 12],
  ]);
  assert.deepEqual(action.metadata.disfluencies.map((item) => [
    item.type,
    item.requiresReview,
    item.confidence,
    item.detectionSource,
  ]), [
    ["repeat", true, 0.68, "adjacent-token-repeat"],
  ]);
  assert.deepEqual(
    action.metadata.cuts.map((cut) => [
      cut.action,
      cut.sourceStartFrame,
      cut.sourceEndFrame,
      cut.outputStartFrame,
      cut.outputEndFrame,
      cut.reason,
      cut.requiresReview,
      cut.confidence,
    ]),
    [
      ["review", 0, 12, 0, 0, "repeat", true, 0.68],
      ["keep", 12, 48, 0, 36, undefined, undefined, undefined],
    ],
  );
  assert.deepEqual(action.metadata.captionCues.map((cue) => [cue.text, cue.wordIds]), [
    ["我们今天开始", ["w2", "w3", "w4"]],
  ]);
});

test("runs production plan-text-cut then applies the generated caption timeline projection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-text-cut-cli-"));
  await writeJson(join(cwd, "analysis", "transcripts", "talking-head.json"), {
    fps: 30,
    backendId: "local-sensevoice",
    modelId: "iic/SenseVoiceSmall",
    language: "zh-CN",
    averageConfidence: 0.91,
    words: [
      { id: "w1", text: "大家", startFrame: 0, endFrame: 12 },
      { id: "w2", text: "嗯", startFrame: 12, endFrame: 18 },
      { id: "w3", text: "今天", startFrame: 30, endFrame: 42 },
      { id: "w4", text: "啊", startFrame: 42, endFrame: 48 },
      { id: "w5", text: "我们", startFrame: 48, endFrame: 60 },
      { id: "w6", text: "开始", startFrame: 60, endFrame: 72 },
    ],
  });
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-talk", type: "video", metadata: {} }],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-text-cut",
      "--transcript",
      "analysis/transcripts/talking-head.json",
      "--target-asset",
      "asset-talk",
      "--out",
      "actions/talking-head-text-cut.json",
      "--min-silence-frames",
      "10",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.match(payload.actionPath, /actions\/talking-head-text-cut\.json$/);
  assert.ok(existsSync(payload.actionPath));
  const action = JSON.parse(await readFile(payload.actionPath, "utf8"));
  assert.equal(action.metadata.asr.kind, "asr-transcript");
  assert.equal(action.metadata.asr.sourcePath, "analysis/transcripts/talking-head.json");
  assert.match(action.metadata.asr.sourceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(action.metadata.asr.backendId, "local-sensevoice");
  assert.equal(action.metadata.asr.modelId, "iic/SenseVoiceSmall");
  assert.equal(action.metadata.asr.language, "zh-CN");
  assert.equal(action.metadata.asr.wordCount, 6);
  assert.equal(action.metadata.asr.averageConfidence, 0.91);
  const result = await applyProductionMetadataAction({
    cwd,
    actionPath: "actions/talking-head-text-cut.json",
    assetsPath: "assets/manifest.json",
  });
  assert.match(result.timelineProjectionPath!, /asset-talk\.caption\.timeline\.yaml$/);
  assert.match(result.transcriptCutPlanPath!, /projections\/media-cuts\/asset-talk\.transcript-cut-plan\.json$/);
  const transcriptCutPlan = JSON.parse(await readFile(result.transcriptCutPlanPath!, "utf8"));
  assert.equal(transcriptCutPlan.kind, "clash.talking-head.transcript-cut-plan.projection");
  assert.equal(transcriptCutPlan.sourceAssetId, "asset-talk");
  assert.equal(transcriptCutPlan.strategy, "conservative");
  assert.equal(transcriptCutPlan.fps, 30);
  assert.deepEqual(transcriptCutPlan.cuts.map((cut: any) => [
    cut.action,
    cut.sourceStartFrame,
    cut.sourceEndFrame,
    cut.outputStartFrame,
    cut.outputEndFrame,
    cut.reason,
  ]), [
    ["keep", 0, 12, 0, 12, undefined],
    ["delete", 12, 18, 12, 12, "filler"],
    ["delete", 18, 30, 12, 12, "silence"],
    ["keep", 30, 42, 12, 24, undefined],
    ["review", 42, 48, 24, 24, "tone-particle"],
    ["keep", 48, 72, 24, 48, undefined],
  ]);
  assert.deepEqual(transcriptCutPlan.sourceToOutputMap, [
    { sourceStartFrame: 0, sourceEndFrame: 12, outputStartFrame: 0, outputEndFrame: 12 },
    { sourceStartFrame: 30, sourceEndFrame: 42, outputStartFrame: 12, outputEndFrame: 24 },
    { sourceStartFrame: 48, sourceEndFrame: 72, outputStartFrame: 24, outputEndFrame: 48 },
  ]);
  assert.equal(transcriptCutPlan.captionTrack.type, "caption");
  assert.deepEqual(transcriptCutPlan.captionTrack.cues.map((cue: any) => [cue.text, cue.wordIds]), [
    ["大家", ["w1"]],
    ["今天", ["w3"]],
    ["我们开始", ["w5", "w6"]],
  ]);
  const asrProjection = JSON.parse(
    await readFile(join(cwd, "projections", "transcripts", "asset-talk.asr-transcript.json"), "utf8"),
  );
  assert.equal(asrProjection.kind, "clash.talking-head.asr-transcript.projection");
  assert.equal(asrProjection.sourcePath, "analysis/transcripts/talking-head.json");
  assert.equal(asrProjection.wordCount, 6);
  assert.equal(asrProjection.backendId, "local-sensevoice");
  assert.equal(asrProjection.modelId, "iic/SenseVoiceSmall");
  const parsedTimeline = timelineDslFromYaml(await readFile(result.timelineProjectionPath!, "utf8"));
  assert.equal(parsedTimeline.ok, true);
  if (!parsedTimeline.ok) return;
  const captions = parsedTimeline.dsl.tracks[0].items[0] as any;
  assert.deepEqual(captions.cues.map((cue: any) => cue.text), ["大家", "今天", "我们开始"]);
  assert.deepEqual(captions.cues.map((cue: any) => [
    cue.text,
    cue.wordIds,
    cue.sourceStartFrame,
    cue.sourceEndFrame,
  ]), [
    ["大家", ["w1"], 0, 12],
    ["今天", ["w3"], 30, 42],
    ["我们开始", ["w5", "w6"], 48, 72],
  ]);
  assert.deepEqual(captions.wordRefs.map((word: any) => [
    word.id,
    word.text,
    word.sourceStartFrame,
    word.sourceEndFrame,
  ]), [
    ["w1", "大家", 0, 12],
    ["w2", "嗯", 12, 18],
    ["w3", "今天", 30, 42],
    ["w4", "啊", 42, 48],
    ["w5", "我们", 48, 60],
    ["w6", "开始", 60, 72],
  ]);
});

test("text-cut planning rejects symlinked action paths that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-text-cut-path-"));
  await writeJson(join(cwd, "analysis", "transcripts", "talking-head.json"), {
    fps: 30,
    words: [
      { id: "w1", text: "大家", startFrame: 0, endFrame: 12 },
      { id: "w2", text: "今天", startFrame: 12, endFrame: 24 },
    ],
  });
  const outside = join(cwd, "..", "outside-text-cut-action-path");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "actions"), { recursive: true });
  const outsideActionPath = join(outside, "talking-head-text-cut.json");
  await writeFile(outsideActionPath, "outside\n", "utf8");
  await symlink(outsideActionPath, join(cwd, "actions", "talking-head-text-cut.json"));

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const planned = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-text-cut",
      "--transcript",
      "analysis/transcripts/talking-head.json",
      "--target-asset",
      "asset-talk",
      "--out",
      "actions/talking-head-text-cut.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /Agent file path must not traverse a symlink outside the current project cwd/);
  assert.equal(await readFile(outsideActionPath, "utf8"), "outside\n");
});

test("runs production plan-text-cut with adjacent repeats then applies a de-duplicated caption projection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-repeat-cut-cli-"));
  await writeJson(join(cwd, "analysis", "transcripts", "talking-head.json"), {
    fps: 30,
    words: [
      { id: "w1", text: "我们", startFrame: 0, endFrame: 12 },
      { id: "w2", text: "我们", startFrame: 12, endFrame: 24 },
      { id: "w3", text: "今天", startFrame: 24, endFrame: 36 },
      { id: "w4", text: "开始", startFrame: 36, endFrame: 48 },
    ],
  });
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-talk", type: "video", metadata: {} }],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-text-cut",
      "--transcript",
      "analysis/transcripts/talking-head.json",
      "--target-asset",
      "asset-talk",
      "--out",
      "actions/talking-head-text-cut.json",
      "--min-silence-frames",
      "10",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.disfluencies, 1);
  const result = await applyProductionMetadataAction({
    cwd,
    actionPath: "actions/talking-head-text-cut.json",
    assetsPath: "assets/manifest.json",
  });
  const parsedTimeline = timelineDslFromYaml(await readFile(result.timelineProjectionPath!, "utf8"));
  assert.equal(parsedTimeline.ok, true);
  if (!parsedTimeline.ok) return;
  const captions = parsedTimeline.dsl.tracks[0].items[0] as any;
  assert.deepEqual(captions.cues.map((cue: any) => cue.text), ["我们今天开始"]);
  assert.deepEqual(captions.cues[0].wordIds, ["w2", "w3", "w4"]);
  assert.deepEqual([captions.cues[0].sourceStartFrame, captions.cues[0].sourceEndFrame], [12, 48]);
  assert.deepEqual(captions.sourceToOutputMap, [
    { sourceStartFrame: 12, sourceEndFrame: 48, outputStartFrame: 0, outputEndFrame: 36 },
  ]);
});

test("runs production export-captions from structured caption timeline to SRT, VTT, and ASS", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-caption-export-"));
  const timelinePath = join(cwd, "projections", "timelines", "asset-talk.caption.timeline.yaml");
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(timelinePath), { recursive: true });
  await writeFile(timelinePath, [
    "fps: 30",
    "durationInFrames: 120",
    "tracks:",
    "  - id: titles",
    "    role: overlay",
    "    items:",
    "      - id: ignored-title",
    "        type: text",
    "        from: 0",
    "        durationInFrames: 30",
    "        text: not a structured caption",
    "  - id: captions",
    "    role: subtitle",
    "    items:",
    "      - id: clean-caption",
    "        type: caption",
    "        from: 30",
    "        durationInFrames: 60",
    "        language: zh-CN",
    "        cues:",
    "          - id: cue-1",
    "            startFrame: 0",
    "            durationInFrames: 30",
    "            text: 大家好",
    "            wordIds: [w1]",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "          - id: cue-2",
    "            startFrame: 30",
    "            durationInFrames: 30",
    "            text: 今天开始",
    "            wordIds: [w2, w3]",
    "            sourceStartFrame: 30",
    "            sourceEndFrame: 60",
    "        wordRefs:",
    "          - id: w1",
    "            text: 大家好",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "          - id: w2",
    "            text: 今天",
    "            sourceStartFrame: 30",
    "            sourceEndFrame: 45",
    "          - id: w3",
    "            text: 开始",
    "            sourceStartFrame: 45",
    "            sourceEndFrame: 60",
    "        sourceToOutputMap:",
    "          - sourceStartFrame: 0",
    "            sourceEndFrame: 60",
    "            outputStartFrame: 0",
    "            outputEndFrame: 60",
    "",
  ].join("\n"), "utf8");

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runExport = (format: "srt" | "vtt" | "ass", outPath: string) => spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-captions",
      "--timeline",
      "projections/timelines/asset-talk.caption.timeline.yaml",
      "--format",
      format,
      "--out",
      outPath,
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  const srt = runExport("srt", "exports/captions/talk.srt");
  assert.equal(srt.status, 0, srt.stderr);
  const srtPayload = JSON.parse(srt.stdout);
  assert.equal(srtPayload.exported, true);
  assert.equal(srtPayload.format, "srt");
  assert.equal(srtPayload.cues, 2);
  assert.match(srtPayload.manifestPath, /exports\/captions\/talk\.caption-export\.json$/);
  assert.equal(await readFile(join(cwd, "exports", "captions", "talk.srt"), "utf8"), [
    "1",
    "00:00:01,000 --> 00:00:02,000",
    "大家好",
    "",
    "2",
    "00:00:02,000 --> 00:00:03,000",
    "今天开始",
    "",
  ].join("\n"));
  const manifest = JSON.parse(await readFile(join(cwd, "exports", "captions", "talk.caption-export.json"), "utf8"));
  assert.equal(manifest.kind, "clash.caption.export");
  const parsedCaptionTimeline = timelineDslFromYaml(await readFile(timelinePath, "utf8"));
  assert.equal(parsedCaptionTimeline.ok, true);
  const captionTimelineHash = await timelineDslHash(parsedCaptionTimeline.dsl);
  assert.deepEqual({
    sourceTimelineId: manifest.sourceTimelineId,
    sourceTimelinePath: manifest.sourceTimelinePath,
    sourceTimelineHash: manifest.sourceTimelineHash,
    sourceTimelineRevisionId: manifest.sourceTimelineRevisionId,
    sourceTimelineRevisionStatus: manifest.sourceTimelineRevisionStatus,
  }, {
    sourceTimelineId: "timeline:projections/timelines/asset-talk.caption.timeline.yaml",
    sourceTimelinePath: "projections/timelines/asset-talk.caption.timeline.yaml",
    sourceTimelineHash: captionTimelineHash,
    sourceTimelineRevisionId: `tlrev-${captionTimelineHash}`,
    sourceTimelineRevisionStatus: "draft-file",
  });
  assert.equal(manifest.sourceTimelinePath, "projections/timelines/asset-talk.caption.timeline.yaml");
  assert.equal(manifest.format, "srt");
  assert.equal(manifest.captionItems, 1);
  assert.equal(manifest.wordRefs, 3);
  assert.deepEqual(manifest.sources.map((source: any) => [source.trackId, source.itemId, source.cueIds]), [
    ["captions", "clean-caption", ["cue-1", "cue-2"]],
  ]);

  const vtt = runExport("vtt", "exports/captions/talk.vtt");
  assert.equal(vtt.status, 0, vtt.stderr);
  assert.equal(await readFile(join(cwd, "exports", "captions", "talk.vtt"), "utf8"), [
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:02.000",
    "大家好",
    "",
    "00:00:02.000 --> 00:00:03.000",
    "今天开始",
    "",
  ].join("\n"));

  const ass = runExport("ass", "exports/captions/talk.ass");
  assert.equal(ass.status, 0, ass.stderr);
  const assPayload = JSON.parse(ass.stdout);
  assert.equal(assPayload.exported, true);
  assert.equal(assPayload.format, "ass");
  assert.equal(assPayload.cues, 2);
  const assText = await readFile(join(cwd, "exports", "captions", "talk.ass"), "utf8");
  assert.match(assText, /\[Script Info\]/);
  assert.match(assText, /ScriptType: v4\.00\+/);
  assert.match(assText, /\[V4\+ Styles\]/);
  assert.match(assText, /Format: Name, Fontname, Fontsize/);
  assert.match(assText, /\[Events\]/);
  assert.match(assText, /Dialogue: 0,0:00:01\.00,0:00:02\.00,Default,,0,0,0,,大家好/);
  assert.match(assText, /Dialogue: 0,0:00:02\.00,0:00:03\.00,Default,,0,0,0,,今天开始/);
  const assManifest = JSON.parse(await readFile(join(cwd, "exports", "captions", "talk.caption-export.json"), "utf8"));
  assert.equal(assManifest.format, "ass");
  assert.equal(assManifest.outputPath, "exports/captions/talk.ass");
});

test("caption export rejects symlinked output paths that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-caption-export-path-"));
  const timelinePath = join(cwd, "projections", "timelines", "asset-talk.caption.timeline.yaml");
  await mkdir(join(cwd, "projections", "timelines"), { recursive: true });
  await writeFile(timelinePath, [
    "fps: 30",
    "durationInFrames: 60",
    "tracks:",
    "  - id: captions",
    "    role: subtitle",
    "    items:",
    "      - id: clean-caption",
    "        type: caption",
    "        from: 0",
    "        durationInFrames: 30",
    "        cues:",
    "          - id: cue-1",
    "            startFrame: 0",
    "            durationInFrames: 30",
    "            text: 大家好",
    "            wordIds: [w1]",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "        wordRefs:",
    "          - id: w1",
    "            text: 大家好",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "        sourceToOutputMap:",
    "          - sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "            outputStartFrame: 0",
    "            outputEndFrame: 30",
    "",
  ].join("\n"), "utf8");

  const outside = join(cwd, "..", "outside-caption-export-output");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "exports", "captions"), { recursive: true });
  const outsideOutput = join(outside, "talk.srt");
  await writeFile(outsideOutput, "outside\n", "utf8");
  await symlink(outsideOutput, join(cwd, "exports", "captions", "talk.srt"));

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-captions",
      "--timeline",
      "projections/timelines/asset-talk.caption.timeline.yaml",
      "--out",
      "exports/captions/talk.srt",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 1);
  assert.match(child.stderr, /Agent file path must not traverse a symlink outside the current project cwd/);
  assert.equal(await readFile(outsideOutput, "utf8"), "outside\n");
  assert.equal(existsSync(join(cwd, "exports", "captions", "talk.caption-export.json")), false);
});

test("runs production verify-caption-lineage and blocks plain text captions", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-caption-lineage-"));
  const structuredTimelinePath = join(cwd, "projections", "timelines", "asset-talk.caption.timeline.yaml");
  const plainTextTimelinePath = join(cwd, "projections", "timelines", "asset-talk.fake-caption.timeline.yaml");
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(structuredTimelinePath), { recursive: true });
  const structuredTimeline = [
    "fps: 30",
    "durationInFrames: 120",
    "tracks:",
    "  - id: captions",
    "    role: subtitle",
    "    items:",
    "      - id: clean-caption",
    "        type: caption",
    "        from: 0",
    "        durationInFrames: 60",
    "        language: zh-CN",
    "        cues:",
    "          - id: cue-1",
    "            startFrame: 0",
    "            durationInFrames: 30",
    "            text: 大家好",
    "            wordIds: [w1]",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "          - id: cue-2",
    "            startFrame: 30",
    "            durationInFrames: 30",
    "            text: 今天开始",
    "            wordIds: [w2, w3]",
    "            sourceStartFrame: 30",
    "            sourceEndFrame: 60",
    "        wordRefs:",
    "          - id: w1",
    "            text: 大家好",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "          - id: w2",
    "            text: 今天",
    "            sourceStartFrame: 30",
    "            sourceEndFrame: 45",
    "          - id: w3",
    "            text: 开始",
    "            sourceStartFrame: 45",
    "            sourceEndFrame: 60",
    "        sourceToOutputMap:",
    "          - sourceStartFrame: 0",
    "            sourceEndFrame: 60",
    "            outputStartFrame: 0",
    "            outputEndFrame: 60",
    "",
  ].join("\n");
  await writeFile(structuredTimelinePath, structuredTimeline, "utf8");
  await writeFile(plainTextTimelinePath, [
    "fps: 30",
    "durationInFrames: 90",
    "tracks:",
    "  - id: captions",
    "    role: subtitle",
    "    items:",
    "      - id: fake-caption",
    "        type: text",
    "        from: 0",
    "        durationInFrames: 60",
    "        text: this is not a caption system",
    "",
  ].join("\n"), "utf8");

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runVerify = (timeline: string, out: string) => spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "verify-caption-lineage",
      "--timeline",
      timeline,
      "--out",
      out,
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  const pass = runVerify(
    "projections/timelines/asset-talk.caption.timeline.yaml",
    "qa/captions/asset-talk.caption-lineage.json",
  );
  assert.equal(pass.status, 0, pass.stderr);
  const passPayload = JSON.parse(pass.stdout);
  assert.equal(passPayload.status, "pass");
  assert.equal(passPayload.captionItems, 1);
  assert.equal(passPayload.cues, 2);
  assert.equal(passPayload.wordRefs, 3);
  assert.equal(passPayload.sourceToOutputMaps, 1);
  const passReport = JSON.parse(await readFile(passPayload.reportPath, "utf8"));
  assert.equal(passReport.kind, "clash.caption.lineage-verification");
  assert.equal(passReport.status, "pass");
  assert.deepEqual(passReport.blockedReasons, []);
  assert.deepEqual(
    passReport.checks.map((check: any) => [check.id, check.status]),
    [
      ["timeline.valid-structured-caption", "pass"],
      ["caption.items-present", "pass"],
      ["caption.wordrefs-present", "pass"],
      ["caption.source-map-present", "pass"],
      ["caption.cues-covered-by-lineage", "pass"],
    ],
  );
  assert.deepEqual(passReport.tracks[0], {
    trackId: "captions",
    itemIds: ["clean-caption"],
    cueIds: ["cue-1", "cue-2"],
  });

  const blocked = runVerify(
    "projections/timelines/asset-talk.fake-caption.timeline.yaml",
    "qa/captions/asset-talk.fake-caption-lineage.json",
  );
  assert.equal(blocked.status, 0, blocked.stderr);
  const blockedPayload = JSON.parse(blocked.stdout);
  assert.equal(blockedPayload.status, "blocked");
  assert.equal(blockedPayload.captionItems, 0);
  const blockedReport = JSON.parse(await readFile(blockedPayload.reportPath, "utf8"));
  assert.equal(blockedReport.status, "blocked");
  assert.match(blockedReport.blockedReasons.join("\n"), /must contain caption items, not text/);
});

test("projects structured captions into a CAS-required timeline overlay manifest", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-caption-overlay-"));
  const timelinePath = join(cwd, "projections", "timelines", "asset-talk.caption.timeline.yaml");
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(timelinePath), { recursive: true });
  await writeFile(timelinePath, [
    "compositionWidth: 1080",
    "compositionHeight: 1920",
    "fps: 30",
    "durationInFrames: 120",
    "tracks:",
    "  - id: captions",
    "    role: subtitle",
    "    items:",
    "      - id: clean-caption",
    "        type: caption",
    "        from: 30",
    "        durationInFrames: 60",
    "        language: zh-CN",
    "        style:",
    "          position: bottom",
    "          fontSize: 56",
    "        cues:",
    "          - id: cue-1",
    "            startFrame: 0",
    "            durationInFrames: 30",
    "            text: 大家好",
    "            wordIds: [w1]",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "          - id: cue-2",
    "            startFrame: 30",
    "            durationInFrames: 30",
    "            text: 今天开始",
    "            wordIds: [w2, w3]",
    "            sourceStartFrame: 30",
    "            sourceEndFrame: 60",
    "        wordRefs:",
    "          - id: w1",
    "            text: 大家好",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "          - id: w2",
    "            text: 今天",
    "            sourceStartFrame: 30",
    "            sourceEndFrame: 45",
    "          - id: w3",
    "            text: 开始",
    "            sourceStartFrame: 45",
    "            sourceEndFrame: 60",
    "        sourceToOutputMap:",
    "          - sourceStartFrame: 0",
    "            sourceEndFrame: 60",
    "            outputStartFrame: 0",
    "            outputEndFrame: 60",
    "",
  ].join("\n"), "utf8");

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-caption-overlay",
      "--timeline",
      "projections/timelines/asset-talk.caption.timeline.yaml",
      "--out",
      "projections/timelines/asset-talk.caption-overlay.timeline.yaml",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.projected, true);
  assert.match(payload.timelineProjectionPath, /projections\/timelines\/asset-talk\.caption-overlay\.timeline\.yaml$/);
  assert.match(payload.timelineLockPath, /timelines\/main\.timeline\.lock\.json$/);
  assert.match(payload.manifestPath, /projections\/timelines\/asset-talk\.caption-overlay\.timeline-manifest\.json$/);
  assert.ok(existsSync(payload.timelineProjectionPath));
  assert.ok(existsSync(payload.manifestPath));
  assert.equal(existsSync(payload.timelineLockPath), false, "projection command must not mint a fake CAS lock");

  const parsedTimeline = timelineDslFromYaml(await readFile(payload.timelineProjectionPath, "utf8"));
  assert.equal(parsedTimeline.ok, true);
  if (!parsedTimeline.ok) return;
  assert.equal(parsedTimeline.dsl.tracks[0].role, "subtitle");
  const item = parsedTimeline.dsl.tracks[0].items[0] as any;
  assert.equal(item.type, "caption");
  assert.equal(item.id, "clean-caption");
  assert.equal(item.cues.length, 2);
  assert.deepEqual(item.wordRefs.map((word: any) => word.id), ["w1", "w2", "w3"]);
  assert.deepEqual(item.sourceToOutputMap, [
    { sourceStartFrame: 0, sourceEndFrame: 60, outputStartFrame: 0, outputEndFrame: 60 },
  ]);

  const manifest = JSON.parse(await readFile(payload.manifestPath, "utf8"));
  assert.equal(manifest.kind, "clash.caption.timeline-overlay");
  assert.equal(manifest.sourceTimelinePath, "projections/timelines/asset-talk.caption.timeline.yaml");
  assert.deepEqual(
    manifest.casApply,
    expectedTimelineCasApply("projections/timelines/asset-talk.caption-overlay.timeline.yaml"),
  );
  assert.equal(manifest.validation.timelineItemType, "caption");
  assert.equal(manifest.validation.captionItems, 1);
  assert.equal(manifest.validation.cues, 2);
  assert.equal(manifest.validation.wordRefs, 3);
  assert.equal(manifest.validation.sourceToOutputMaps, 1);
  assert.equal(manifest.rendering.previewRenderer, "remotion-components.caption");
  assert.equal(manifest.rendering.burnInRequires, "clash production export-caption-burn");
  assert.equal(manifest.timelineItems[0].type, "caption");

  const parsedForApply = parseTimelineFileForApply(await readFile(payload.timelineProjectionPath, "utf8"));
  assert.equal(parsedForApply.ok, true);
  if (!parsedForApply.ok) return;
  const cas = assertTimelineCas({
    projectId: "project-1",
    nodeId: "editor-1",
    lock: null,
    currentDsl: parsedForApply.dsl,
    force: false,
  });
  assert.equal(cas.ok, false);
  if (cas.ok) return;
  assert.match(cas.error, /Missing timeline CAS lock/);
});

test("rejects caption overlay projection when caption items lack structured cue lineage", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-caption-overlay-invalid-"));
  const timelinePath = join(cwd, "projections", "timelines", "asset-talk.caption.timeline.yaml");
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(timelinePath), { recursive: true });
  await writeFile(timelinePath, [
    "fps: 30",
    "durationInFrames: 60",
    "tracks:",
    "  - id: captions",
    "    role: subtitle",
    "    items:",
    "      - id: fake-caption",
    "        type: caption",
    "        from: 0",
    "        durationInFrames: 60",
    "        text: this is not a structured caption system",
    "",
  ].join("\n"), "utf8");

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-caption-overlay",
      "--timeline",
      "projections/timelines/asset-talk.caption.timeline.yaml",
      "--out",
      "projections/timelines/asset-talk.caption-overlay.timeline.yaml",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 1);
  assert.match(child.stderr, /requires structured caption items with cues, wordRefs, and sourceToOutputMap|Caption item fake-caption must include cues, wordRefs, and sourceToOutputMap/i);
  assert.equal(existsSync(join(cwd, "projections", "timelines", "asset-talk.caption-overlay.timeline.yaml")), false);
});

test("exports structured captions as a non-destructive caption-burn derived asset plan", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-caption-burn-"));
  const timelinePath = join(cwd, "projections", "timelines", "asset-talk.caption.timeline.yaml");
  await mkdir(join(cwd, "projections", "timelines"), { recursive: true });
  await mkdir(join(cwd, "assets", "video"), { recursive: true });
  await writeFile(join(cwd, "assets", "video", "source.mp4"), "fixture", "utf8");
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      {
        id: "asset-talk-source",
        type: "video",
        path: "assets/video/source.mp4",
        metadata: {},
      },
    ],
  });
  await writeFile(timelinePath, [
    "compositionWidth: 1080",
    "compositionHeight: 1920",
    "fps: 30",
    "durationInFrames: 120",
    "tracks:",
    "  - id: captions",
    "    role: subtitle",
    "    items:",
    "      - id: clean-caption",
    "        type: caption",
    "        from: 30",
    "        durationInFrames: 60",
    "        language: zh-CN",
    "        cues:",
    "          - id: cue-1",
    "            startFrame: 0",
    "            durationInFrames: 30",
    "            text: 大家好",
    "            wordIds: [w1]",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "          - id: cue-2",
    "            startFrame: 30",
    "            durationInFrames: 30",
    "            text: 今天开始",
    "            wordIds: [w2, w3]",
    "            sourceStartFrame: 30",
    "            sourceEndFrame: 60",
    "        wordRefs:",
    "          - id: w1",
    "            text: 大家好",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "          - id: w2",
    "            text: 今天",
    "            sourceStartFrame: 30",
    "            sourceEndFrame: 45",
    "          - id: w3",
    "            text: 开始",
    "            sourceStartFrame: 45",
    "            sourceEndFrame: 60",
    "        sourceToOutputMap:",
    "          - sourceStartFrame: 0",
    "            sourceEndFrame: 60",
    "            outputStartFrame: 0",
    "            outputEndFrame: 60",
    "",
  ].join("\n"), "utf8");

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-caption-burn",
      "--timeline",
      "projections/timelines/asset-talk.caption.timeline.yaml",
      "--source-asset",
      "asset-talk-source",
      "--output-asset",
      "asset-talk-caption-burn",
      "--out",
      "assets/video/asset-talk-caption-burn.mp4",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.exported, true);
  assert.equal(payload.rendered, false);
  assert.match(payload.captionSidecarPath, /exports\/captions\/asset-talk-caption-burn\.burn-in\.ass$/);
  assert.match(payload.packagePath, /projections\/caption-burn\/asset-talk-caption-burn\.caption-burn\.json$/);
  assert.match(payload.ffmpegPlanPath, /projections\/caption-burn\/asset-talk-caption-burn\.ffmpeg-plan\.json$/);

  const parsedTimeline = timelineDslFromYaml(await readFile(timelinePath, "utf8"));
  assert.equal(parsedTimeline.ok, true);
  const expectedTimelineHash = await timelineDslHash(parsedTimeline.dsl);
  const expectedTimelineProvenance = {
    sourceTimelineId: "timeline:projections/timelines/asset-talk.caption.timeline.yaml",
    sourceTimelinePath: "projections/timelines/asset-talk.caption.timeline.yaml",
    sourceTimelineHash: expectedTimelineHash,
    sourceTimelineRevisionId: `tlrev-${expectedTimelineHash}`,
    sourceTimelineRevisionStatus: "draft-file",
  };

  const assText = await readFile(join(cwd, "exports", "captions", "asset-talk-caption-burn.burn-in.ass"), "utf8");
  assert.match(assText, /Dialogue: 0,0:00:01\.00,0:00:02\.00,Default,,0,0,0,,大家好/);
  assert.match(assText, /Dialogue: 0,0:00:02\.00,0:00:03\.00,Default,,0,0,0,,今天开始/);

  const ffmpegPlan = JSON.parse(
    await readFile(join(cwd, "projections", "caption-burn", "asset-talk-caption-burn.ffmpeg-plan.json"), "utf8"),
  );
  assert.equal(ffmpegPlan.kind, "clash.caption.burn-in.ffmpeg-plan");
  assert.equal(ffmpegPlan.sourceAssetId, "asset-talk-source");
  assert.equal(ffmpegPlan.outputAssetId, "asset-talk-caption-burn");
  assert.deepEqual({
    sourceTimelineId: ffmpegPlan.sourceTimelineId,
    sourceTimelinePath: ffmpegPlan.sourceTimelinePath,
    sourceTimelineHash: ffmpegPlan.sourceTimelineHash,
    sourceTimelineRevisionId: ffmpegPlan.sourceTimelineRevisionId,
    sourceTimelineRevisionStatus: ffmpegPlan.sourceTimelineRevisionStatus,
  }, expectedTimelineProvenance);
  assert.equal(ffmpegPlan.sourcePath, "assets/video/source.mp4");
  assert.equal(ffmpegPlan.captionSidecarPath, "exports/captions/asset-talk-caption-burn.burn-in.ass");
  assert.equal(ffmpegPlan.outputPath, "assets/video/asset-talk-caption-burn.mp4");
  assert.match(ffmpegPlan.filtergraph, /ass=.*asset-talk-caption-burn\.burn-in\.ass/);
  assert.ok(ffmpegPlan.args.includes("-vf"));

  const burnPackage = JSON.parse(
    await readFile(join(cwd, "projections", "caption-burn", "asset-talk-caption-burn.caption-burn.json"), "utf8"),
  );
  assert.equal(burnPackage.kind, "clash.caption.burn-in-export");
  assert.equal(burnPackage.rendered, false);
  assert.deepEqual({
    sourceTimelineId: burnPackage.sourceTimelineId,
    sourceTimelinePath: burnPackage.sourceTimelinePath,
    sourceTimelineHash: burnPackage.sourceTimelineHash,
    sourceTimelineRevisionId: burnPackage.sourceTimelineRevisionId,
    sourceTimelineRevisionStatus: burnPackage.sourceTimelineRevisionStatus,
  }, expectedTimelineProvenance);
  assert.equal(burnPackage.derivation.kind, "caption-burn");
  assert.deepEqual(burnPackage.sourceToOutputMap, [
    { sourceStartFrame: 0, sourceEndFrame: 60, outputStartFrame: 0, outputEndFrame: 60 },
  ]);
  assert.equal(burnPackage.cues, 2);
  assert.equal(burnPackage.wordRefs, 3);

  const assets = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const outputAsset = assets.assets.find((asset: any) => asset.id === "asset-talk-caption-burn");
  assert.equal(outputAsset.type, "caption-burn-plan");
  assert.equal(outputAsset.path, "projections/caption-burn/asset-talk-caption-burn.caption-burn.json");
  assert.deepEqual(outputAsset.metadata["caption.burn-in-export"], {
    sourceAssetId: "asset-talk-source",
    ...expectedTimelineProvenance,
    captionSidecarPath: "exports/captions/asset-talk-caption-burn.burn-in.ass",
    packagePath: "projections/caption-burn/asset-talk-caption-burn.caption-burn.json",
    ffmpegPlanPath: "projections/caption-burn/asset-talk-caption-burn.ffmpeg-plan.json",
    outputPath: "assets/video/asset-talk-caption-burn.mp4",
    rendered: false,
    derivationKind: "caption-burn",
    copyOnWrite: true,
    cues: 2,
    captionItems: 1,
    wordRefs: 3,
    sourceToOutputMaps: 1,
  });

  const appliedRevision = createTimelineAppliedRevision({
    projectId: "project-1",
    nodeId: "editor-1",
    cwd,
    filePath: timelinePath,
    dsl: parsedTimeline.dsl,
    createdAt: "2026-07-06T00:00:00.000Z",
    loroFrontiers: [{ peer: "1", counter: 8 }],
  });
  await writeJson(join(cwd, "projections", "timelines", "asset-talk.caption.timeline.lock.json"), createTimelineLock({
    projectId: "project-1",
    nodeId: "editor-1",
    filePath: timelinePath,
    dsl: parsedTimeline.dsl,
    pulledAt: "2026-07-06T00:00:00.000Z",
    appliedRevision,
  }));

  const appliedChild = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-caption-burn",
      "--timeline",
      "projections/timelines/asset-talk.caption.timeline.yaml",
      "--source-asset",
      "asset-talk-source",
      "--output-asset",
      "asset-talk-caption-burn-applied",
      "--out",
      "assets/video/asset-talk-caption-burn-applied.mp4",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(appliedChild.status, 0, appliedChild.stderr);
  const appliedPackage = JSON.parse(
    await readFile(join(cwd, "projections", "caption-burn", "asset-talk-caption-burn-applied.caption-burn.json"), "utf8"),
  );
  assert.equal(appliedPackage.sourceTimelineId, "timeline:project-1:editor-1");
  assert.equal(appliedPackage.sourceTimelineHash, appliedRevision.timelineHash);
  assert.equal(appliedPackage.sourceTimelineRevisionId, appliedRevision.revisionId);
  assert.equal(appliedPackage.sourceTimelineRevisionStatus, "applied");
  assert.deepEqual(appliedPackage.sourceTimelineFrontiers, [{ peer: "1", counter: 8 }]);
});

test("caption-burn export rejects symlinked sidecar paths that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-caption-burn-path-"));
  const timelinePath = join(cwd, "projections", "timelines", "asset-talk.caption.timeline.yaml");
  await mkdir(join(cwd, "projections", "timelines"), { recursive: true });
  await mkdir(join(cwd, "assets", "video"), { recursive: true });
  await writeFile(join(cwd, "assets", "video", "source.mp4"), "fixture", "utf8");
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      {
        id: "asset-talk-source",
        type: "video",
        path: "assets/video/source.mp4",
        metadata: {},
      },
    ],
  });
  await writeFile(timelinePath, [
    "compositionWidth: 1080",
    "compositionHeight: 1920",
    "fps: 30",
    "durationInFrames: 60",
    "tracks:",
    "  - id: captions",
    "    role: subtitle",
    "    items:",
    "      - id: clean-caption",
    "        type: caption",
    "        from: 0",
    "        durationInFrames: 30",
    "        language: zh-CN",
    "        cues:",
    "          - id: cue-1",
    "            startFrame: 0",
    "            durationInFrames: 30",
    "            text: 大家好",
    "            wordIds: [w1]",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "        wordRefs:",
    "          - id: w1",
    "            text: 大家好",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "        sourceToOutputMap:",
    "          - sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "            outputStartFrame: 0",
    "            outputEndFrame: 30",
    "",
  ].join("\n"), "utf8");

  const outside = join(cwd, "..", "outside-caption-burn-sidecar");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "exports", "captions"), { recursive: true });
  const outsideSidecar = join(outside, "unsafe.ass");
  await writeFile(outsideSidecar, "outside\n", "utf8");
  await symlink(outsideSidecar, join(cwd, "exports", "captions", "unsafe.ass"));

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-caption-burn",
      "--timeline",
      "projections/timelines/asset-talk.caption.timeline.yaml",
      "--source-asset",
      "asset-talk-source",
      "--output-asset",
      "asset-talk-caption-burn",
      "--caption-sidecar",
      "exports/captions/unsafe.ass",
      "--out",
      "assets/video/asset-talk-caption-burn.mp4",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 1);
  assert.match(child.stderr, /Agent file path must not traverse a symlink outside the current project cwd/);
  assert.equal(await readFile(outsideSidecar, "utf8"), "outside\n");
  assert.equal(existsSync(join(cwd, "projections", "caption-burn", "asset-talk-caption-burn.ffmpeg-plan.json")), false);
});

test("runs production export-timeline-handoff as CSV for external NLE review", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-timeline-handoff-"));
  const timelinePath = join(cwd, "projections", "timelines", "episode.timeline.yaml");
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(timelinePath), { recursive: true });
  await writeFile(timelinePath, [
    "fps: 30",
    "durationInFrames: 150",
    "tracks:",
    "  - id: video",
    "    items:",
    "      - id: shot-1",
    "        type: video",
    "        from: 0",
    "        durationInFrames: 60",
    "        assetId: asset-shot-1",
    "        src: assets/video/shot-1.mp4",
    "      - id: mg-lower",
    "        type: composition",
    "        from: 60",
    "        durationInFrames: 30",
    "        compositionKind: motion-graphics",
    "        runtime: html",
    "        compositionId: lower-third",
    "        sourcePath: projections/mg/lower-third/index.html",
    "        renderedAssetPath: assets/overlays/lower-third.webm",
    "        spec:",
    "          id: lower-third",
    "          width: 1080",
    "          height: 1920",
    "          fps: 30",
    "          durationInFrames: 30",
    "          layers: []",
    "  - id: captions",
    "    role: subtitle",
    "    items:",
    "      - id: cap-1",
    "        type: caption",
    "        from: 30",
    "        durationInFrames: 60",
    "        cues:",
    "          - id: cue-1",
    "            startFrame: 0",
    "            durationInFrames: 30",
    "            text: 开场重点",
    "            wordIds: [w1]",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "        wordRefs:",
    "          - id: w1",
    "            text: 开场重点",
    "            sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "        sourceToOutputMap:",
    "          - sourceStartFrame: 0",
    "            sourceEndFrame: 30",
    "            outputStartFrame: 0",
    "            outputEndFrame: 30",
    "",
  ].join("\n"), "utf8");

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-timeline-handoff",
      "--timeline",
      "projections/timelines/episode.timeline.yaml",
      "--format",
      "csv",
      "--out",
      "exports/handoff/episode.timeline.csv",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.exported, true);
  assert.equal(payload.format, "csv");
  assert.equal(payload.items, 3);
  assert.match(payload.manifestPath, /exports\/handoff\/episode\.timeline\.handoff\.json$/);
  assert.equal(await readFile(join(cwd, "exports", "handoff", "episode.timeline.csv"), "utf8"), [
    "trackId,itemId,type,startFrame,endFrame,startTimecode,endTimecode,durationFrames,assetId,source,notes",
    "video,shot-1,video,0,60,00:00:00:00,00:00:02:00,60,asset-shot-1,assets/video/shot-1.mp4,",
    "video,mg-lower,composition,60,90,00:00:02:00,00:00:03:00,30,,projections/mg/lower-third/index.html,composition lower-third",
    "captions,cap-1,caption,30,90,00:00:01:00,00:00:03:00,60,,,开场重点",
    "",
  ].join("\n"));
  const manifest = JSON.parse(await readFile(join(cwd, "exports", "handoff", "episode.timeline.handoff.json"), "utf8"));
  assert.equal(manifest.kind, "clash.timeline.nle-handoff");
  const parsedHandoffTimeline = timelineDslFromYaml(await readFile(timelinePath, "utf8"));
  assert.equal(parsedHandoffTimeline.ok, true);
  const handoffTimelineHash = await timelineDslHash(parsedHandoffTimeline.dsl);
  assert.deepEqual({
    sourceTimelineId: manifest.sourceTimelineId,
    sourceTimelinePath: manifest.sourceTimelinePath,
    sourceTimelineHash: manifest.sourceTimelineHash,
    sourceTimelineRevisionId: manifest.sourceTimelineRevisionId,
    sourceTimelineRevisionStatus: manifest.sourceTimelineRevisionStatus,
  }, {
    sourceTimelineId: "timeline:projections/timelines/episode.timeline.yaml",
    sourceTimelinePath: "projections/timelines/episode.timeline.yaml",
    sourceTimelineHash: handoffTimelineHash,
    sourceTimelineRevisionId: `tlrev-${handoffTimelineHash}`,
    sourceTimelineRevisionStatus: "draft-file",
  });
  assert.equal(manifest.sourceTimelinePath, "projections/timelines/episode.timeline.yaml");
  assert.equal(manifest.format, "csv");
  assert.deepEqual(manifest.itemTypes, { caption: 1, composition: 1, video: 1 });
  assert.deepEqual(manifest.outputs, ["exports/handoff/episode.timeline.csv"]);
});

test("timeline handoff export rejects symlinked output paths that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-timeline-handoff-path-"));
  const timelinePath = join(cwd, "projections", "timelines", "episode.timeline.yaml");
  await mkdir(join(cwd, "projections", "timelines"), { recursive: true });
  await writeFile(timelinePath, [
    "fps: 30",
    "durationInFrames: 60",
    "tracks:",
    "  - id: video",
    "    items:",
    "      - id: shot-1",
    "        type: video",
    "        from: 0",
    "        durationInFrames: 60",
    "        assetId: asset-shot-1",
    "        src: assets/video/shot-1.mp4",
    "",
  ].join("\n"), "utf8");

  const outside = join(cwd, "..", "outside-timeline-handoff-output");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "exports", "handoff"), { recursive: true });
  const outsideOutput = join(outside, "episode.timeline.csv");
  await writeFile(outsideOutput, "outside\n", "utf8");
  await symlink(outsideOutput, join(cwd, "exports", "handoff", "episode.timeline.csv"));

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-timeline-handoff",
      "--timeline",
      "projections/timelines/episode.timeline.yaml",
      "--out",
      "exports/handoff/episode.timeline.csv",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 1);
  assert.match(child.stderr, /Agent file path must not traverse a symlink outside the current project cwd/);
  assert.equal(await readFile(outsideOutput, "utf8"), "outside\n");
  assert.equal(existsSync(join(cwd, "exports", "handoff", "episode.timeline.handoff.json")), false);
});

test("timeline handoff export rejects symlinked manifest paths that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-timeline-handoff-manifest-path-"));
  const timelinePath = join(cwd, "projections", "timelines", "episode.timeline.yaml");
  await mkdir(join(cwd, "projections", "timelines"), { recursive: true });
  await writeFile(timelinePath, [
    "fps: 30",
    "durationInFrames: 60",
    "tracks:",
    "  - id: video",
    "    items:",
    "      - id: shot-1",
    "        type: video",
    "        from: 0",
    "        durationInFrames: 60",
    "        assetId: asset-shot-1",
    "        src: assets/video/shot-1.mp4",
    "",
  ].join("\n"), "utf8");

  const outside = join(cwd, "..", "outside-timeline-handoff-manifest");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "exports", "handoff"), { recursive: true });
  const outsideManifest = join(outside, "episode.timeline.handoff.json");
  await writeFile(outsideManifest, "{}\n", "utf8");
  await symlink(outsideManifest, join(cwd, "exports", "handoff", "episode.timeline.handoff.json"));

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-timeline-handoff",
      "--timeline",
      "projections/timelines/episode.timeline.yaml",
      "--out",
      "exports/handoff/episode.timeline.csv",
      "--manifest",
      "exports/handoff/episode.timeline.handoff.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 1);
  assert.match(child.stderr, /Agent file path must not traverse a symlink outside the current project cwd/);
  assert.equal(await readFile(outsideManifest, "utf8"), "{}\n");
  assert.equal(existsSync(join(cwd, "exports", "handoff", "episode.timeline.csv")), false);
});

test("runs production export-text-cut-media as a non-destructive talking-head cut asset", async () => {
  const ffmpeg = resolveExecutable("ffmpeg");
  const ffprobe = resolveExecutable("ffprobe");
  assert.ok(ffmpeg, "ffmpeg is required for talking-head media cut export test");
  assert.ok(ffprobe, "ffprobe is required for talking-head media cut export test");

  const cwd = await mkdtemp(join(tmpdir(), "clash-production-text-cut-media-"));
  const sourcePath = join(cwd, "assets", "source", "talk.mp4");
  await makeTalkingHeadFixture(sourcePath, ffmpeg);
  await writeJson(join(cwd, "analysis", "transcripts", "talking-head.json"), {
    fps: 30,
    words: [
      { id: "w1", text: "大家", startFrame: 0, endFrame: 12 },
      { id: "w2", text: "嗯", startFrame: 12, endFrame: 18 },
      { id: "w3", text: "今天", startFrame: 30, endFrame: 42 },
      { id: "w4", text: "开始", startFrame: 42, endFrame: 72 },
    ],
  });
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-talk", type: "video", path: "assets/source/talk.mp4", metadata: {} }],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const planChild = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-text-cut",
      "--transcript",
      "analysis/transcripts/talking-head.json",
      "--target-asset",
      "asset-talk",
      "--out",
      "actions/talking-head-text-cut.json",
      "--min-silence-frames",
      "10",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(planChild.status, 0, planChild.stderr);

  const exportChild = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-text-cut-media",
      "--action",
      "actions/talking-head-text-cut.json",
      "--source-asset",
      "asset-talk",
      "--output-asset",
      "asset-talk-clean",
      "--out",
      "assets/video/talk-clean.mp4",
      "--assets",
      "assets/manifest.json",
      "--ffmpeg",
      ffmpeg,
      "--ffprobe",
      ffprobe,
      "--render",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(exportChild.status, 0, exportChild.stderr);
  const payload = JSON.parse(exportChild.stdout);
  assert.equal(payload.outputAssetId, "asset-talk-clean");
  assert.equal(payload.rendered, true);
  assert.equal(payload.keepSegments, 2);
  assert.equal(payload.deletedRanges, 2);
  assert.equal(payload.reviewRanges, 0);
  assert.ok(payload.probe.durationSeconds >= 1.7 && payload.probe.durationSeconds <= 1.9);
  assert.equal(payload.probe.hasVideo, true);
  assert.equal(payload.probe.hasAudio, true);
  assert.ok(existsSync(payload.outputPath));
  assert.ok(existsSync(payload.packagePath));
  assert.ok(existsSync(payload.concatPath));
  const cutPackage = JSON.parse(await readFile(payload.packagePath, "utf8"));
  assert.equal(cutPackage.kind, "clash.talking-head.media-cut-export");
  assert.equal(cutPackage.sourceAssetId, "asset-talk");
  assert.deepEqual(cutPackage.keepSegments.map((segment: any) => [
    segment.sourceStartFrame,
    segment.sourceEndFrame,
    segment.outputStartFrame,
    segment.outputEndFrame,
  ]), [
    [0, 12, 0, 12],
    [30, 72, 12, 54],
  ]);
  assert.deepEqual(cutPackage.deletedRanges.map((range: any) => range.reason), [
    "filler",
    "silence",
  ]);
  assert.deepEqual(cutPackage.deletedRanges.map((range: any) => [
    range.reason,
    range.confidence,
    range.detectionSource,
  ]), [
    ["filler", 0.92, "configured-token"],
    ["silence", 0.98, "word-gap"],
  ]);
  assert.deepEqual(cutPackage.reviewRanges, []);
  assert.equal(cutPackage.probe.hasAudio, true);
  const concatPlan = await readFile(payload.concatPath, "utf8");
  assert.match(concatPlan, /^ffconcat version 1\.0/);
  assert.match(concatPlan, /inpoint 0\.000000/);
  assert.match(concatPlan, /outpoint 0\.400000/);
  const assets = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const sourceAsset = assets.assets.find((asset: any) => asset.id === "asset-talk");
  const outputAsset = assets.assets.find((asset: any) => asset.id === "asset-talk-clean");
  assert.equal(sourceAsset.path, "assets/source/talk.mp4");
  assert.equal(outputAsset.type, "video");
  assert.equal(outputAsset.path, "assets/video/talk-clean.mp4");
  assert.equal(outputAsset.metadata["talking-head.media-cut-export"].sourceAssetId, "asset-talk");
  assert.deepEqual(outputAsset.metadata["talking-head.media-cut-export"].sourceToOutputMap, [
    { sourceStartFrame: 0, sourceEndFrame: 12, outputStartFrame: 0, outputEndFrame: 12 },
    { sourceStartFrame: 30, sourceEndFrame: 72, outputStartFrame: 12, outputEndFrame: 54 },
  ]);
  assert.deepEqual(outputAsset.metadata["talking-head.media-cut-export"].reviewRanges, []);
});

test("blocks production export-text-cut-media render when review cuts are still pending", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-text-cut-review-gate-"));
  await writeJson(join(cwd, "analysis", "transcripts", "talking-head.json"), {
    fps: 30,
    words: [
      { id: "w1", text: "大家", startFrame: 0, endFrame: 12 },
      { id: "w2", text: "今天", startFrame: 12, endFrame: 24 },
      { id: "w3", text: "今天", startFrame: 24, endFrame: 36 },
      { id: "w4", text: "啊", startFrame: 36, endFrame: 42 },
      { id: "w5", text: "开始", startFrame: 42, endFrame: 60 },
    ],
  });
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-talk", type: "video", path: "assets/source/talk.mp4", metadata: {} }],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const planChild = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-text-cut",
      "--transcript",
      "analysis/transcripts/talking-head.json",
      "--target-asset",
      "asset-talk",
      "--out",
      "actions/talking-head-text-cut.json",
      "--min-silence-frames",
      "10",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(planChild.status, 0, planChild.stderr);

  const planOnlyChild = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-text-cut-media",
      "--action",
      "actions/talking-head-text-cut.json",
      "--source-asset",
      "asset-talk",
      "--output-asset",
      "asset-talk-clean",
      "--assets",
      "assets/manifest.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(planOnlyChild.status, 0, planOnlyChild.stderr);
  const planOnlyPayload = JSON.parse(planOnlyChild.stdout);
  assert.equal(planOnlyPayload.rendered, false);
  assert.equal(planOnlyPayload.deletedRanges, 0);
  assert.equal(planOnlyPayload.reviewRanges, 2);
  const cutPackage = JSON.parse(await readFile(planOnlyPayload.packagePath, "utf8"));
  assert.deepEqual(cutPackage.reviewRanges.map((range: any) => [
    range.reason,
    range.requiresReview,
    range.confidence,
    range.detectionSource,
  ]), [
    ["repeat", true, 0.68, "adjacent-token-repeat"],
    ["tone-particle", true, 0.72, "configured-token"],
  ]);

  const renderChild = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "export-text-cut-media",
      "--action",
      "actions/talking-head-text-cut.json",
      "--source-asset",
      "asset-talk",
      "--output-asset",
      "asset-talk-clean-rendered",
      "--assets",
      "assets/manifest.json",
      "--render",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(renderChild.status, 1);
  assert.match(renderChild.stderr, /review range\(s\)/);
});

test("analyzes a local WAV click track into MV beat metadata", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-beat-"));
  const audioPath = join(cwd, "audio", "click-track.wav");
  await writeBinary(audioPath, makeClickTrackWav({
    sampleRate: 8000,
    durationSeconds: 1.1,
    clickSeconds: [0, 0.5, 1.0],
  }));

  const action = await analyzeWavBeatAction({
    targetAssetId: "asset-song",
    audioPath,
    fps: 30,
  });

  assert.equal(action.metadata.kind, "audio.beat-analysis");
  if (action.metadata.kind !== "audio.beat-analysis") return;
  assert.equal(Math.round(action.metadata.bpm), 120);
  assert.deepEqual(action.metadata.beats.map((beat) => beat.frame), [0, 15, 30]);
  assert.deepEqual(action.metadata.beats.map((beat) => beat.downbeat === true), [true, false, false]);
});

test("segments local WAV beat analysis into bar sections for MV cut planning", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-beat-sections-"));
  const audioPath = join(cwd, "audio", "click-track.wav");
  await writeBinary(audioPath, makeClickTrackWav({
    sampleRate: 8000,
    durationSeconds: 4.1,
    clickSeconds: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
  }));

  const action = await analyzeWavBeatAction({
    targetAssetId: "asset-song",
    audioPath,
    fps: 30,
  });

  assert.equal(action.metadata.kind, "audio.beat-analysis");
  if (action.metadata.kind !== "audio.beat-analysis") return;
  assert.deepEqual(
    action.metadata.sections.map((section) => [
      section.id,
      section.label,
      section.startFrame,
      section.endFrame,
    ]),
    [
      ["bar-1", "bar 1", 0, 60],
      ["bar-2", "bar 2", 60, 120],
    ],
  );
});

test("analyzes WAV energy, novelty, and cut density for MV section planning", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-beat-energy-"));
  const audioPath = join(cwd, "audio", "dynamic-click-track.wav");
  await writeBinary(audioPath, makeVariableClickTrackWav({
    sampleRate: 8000,
    durationSeconds: 4.1,
    clicks: [
      { second: 0, gain: 0.42 },
      { second: 0.5, gain: 0.44 },
      { second: 1.0, gain: 0.43 },
      { second: 1.5, gain: 0.45 },
      { second: 2.0, gain: 1.0 },
      { second: 2.5, gain: 0.98 },
      { second: 3.0, gain: 1.0 },
      { second: 3.5, gain: 0.99 },
    ],
  }));

  const action = await analyzeWavBeatAction({
    targetAssetId: "asset-song",
    audioPath,
    fps: 30,
  });

  assert.equal(action.metadata.kind, "audio.beat-analysis");
  if (action.metadata.kind !== "audio.beat-analysis") return;
  assert.ok(action.metadata.energyCurve.length > 100);
  assert.deepEqual(action.metadata.sections.map((section) => section.cutDensity), ["medium", "fast"]);
  assert.deepEqual(action.metadata.sections.map((section: any) => [
    section.semanticLabel,
    section.semanticConfidence,
    section.reviewRequired,
    section.semanticSource,
  ]), [
    ["intro", 0.72, true, "local-rms-phrase-heuristic"],
    ["drop", 0.87, false, "local-rms-phrase-heuristic"],
  ]);
  assert.ok((action.metadata.sections[1].energy ?? 0) > (action.metadata.sections[0].energy ?? 0));
  assert.ok((action.metadata.sections[1].novelty ?? 0) > (action.metadata.sections[0].novelty ?? 0));
  assert.ok((action.metadata.sections[1].impact ?? 0) > 0.9);
});

test("runs production analyze-audio-beats then applies MV beat hints", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-beat-cli-"));
  await writeBinary(join(cwd, "audio", "click-track.wav"), makeVariableClickTrackWav({
    sampleRate: 8000,
    durationSeconds: 4.1,
    clicks: [
      { second: 0, gain: 0.42 },
      { second: 0.5, gain: 0.44 },
      { second: 1.0, gain: 0.43 },
      { second: 1.5, gain: 0.45 },
      { second: 2.0, gain: 1.0 },
      { second: 2.5, gain: 0.98 },
      { second: 3.0, gain: 1.0 },
      { second: 3.5, gain: 0.99 },
    ],
  }));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-song", type: "audio", metadata: {} }],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "analyze-audio-beats",
      "--audio",
      "audio/click-track.wav",
      "--target-asset",
      "asset-song",
      "--out",
      "actions/mv-beat-fill.json",
      "--fps",
      "30",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.match(payload.actionPath, /actions\/mv-beat-fill\.json$/);
  assert.equal(Math.round(payload.bpm), 120);
  assert.equal(payload.sections, 2);
  assert.ok(payload.energyPoints > 100);
  const result = await applyProductionMetadataAction({
    cwd,
    actionPath: "actions/mv-beat-fill.json",
    assetsPath: "assets/manifest.json",
  });
  const hints = JSON.parse(await readFile(result.timelineProjectionPath!, "utf8"));
  assert.deepEqual(hints.hints.map((hint: any) => hint.frame), [0, 15, 30, 45, 60, 75, 90, 105]);
  assert.ok(hints.energyCurve.length > 100);
  assert.deepEqual(hints.cuts.map((cut: any) => [cut.sectionId, cut.sourceStartFrame, cut.sourceEndFrame]), [
    ["bar-1", 0, 60],
    ["bar-2", 60, 120],
  ]);
  assert.deepEqual(hints.cuts.map((cut: any) => [cut.sectionId, cut.cutDensity, cut.recommendedCutEveryFrames]), [
    ["bar-1", "medium", 60],
    ["bar-2", "fast", 30],
  ]);
});

test("projects MV beat metadata and visual clips into a CAS-required timeline view", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-mv-timeline-cli-"));
  await writeJson(join(cwd, "actions", "mv-beat-fill.json"), {
    actionId: "action-mv-beat-fill",
    targetAssetId: "asset-song",
    metadataKind: "audio.beat-analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.beat-analysis",
      bpm: 120,
      fps: 30,
      beats: [
        { frame: 0, timeSeconds: 0, confidence: 0.95, downbeat: true },
        { frame: 15, timeSeconds: 0.5, confidence: 0.9 },
        { frame: 30, timeSeconds: 1, confidence: 0.91 },
        { frame: 45, timeSeconds: 1.5, confidence: 0.89 },
        { frame: 60, timeSeconds: 2, confidence: 0.98, downbeat: true },
      ],
      sections: [
        {
          id: "intro",
          startFrame: 0,
          endFrame: 60,
          label: "bar 1",
          semanticLabel: "intro",
          semanticConfidence: 0.72,
          reviewRequired: true,
          semanticSource: "local-rms-phrase-heuristic",
          cutDensity: "medium",
        },
        {
          id: "drop",
          startFrame: 60,
          endFrame: 120,
          label: "bar 2",
          semanticLabel: "drop",
          semanticConfidence: 0.87,
          reviewRequired: false,
          semanticSource: "local-rms-phrase-heuristic",
          cutDensity: "fast",
        },
      ],
      energyCurve: [],
    },
  });
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      { id: "asset-song", type: "audio", path: "assets/audio/song.wav", metadata: {} },
      { id: "asset-shot-a", type: "video", path: "assets/video/shot-a.mp4", metadata: {} },
      { id: "asset-shot-b", type: "image", path: "assets/images/shot-b.png", metadata: {} },
    ],
  });
  await writeJson(join(cwd, "plans", "mv-clips.json"), [
    { assetId: "asset-shot-a", type: "video", path: "assets/video/shot-a.mp4", sourceStartFrame: 12 },
    { assetId: "asset-shot-b", type: "image", path: "assets/images/shot-b.png" },
  ]);
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-mv-beat-cuts",
      "--action",
      "actions/mv-beat-fill.json",
      "--audio-src",
      "assets/audio/song.wav",
      "--clips",
      "plans/mv-clips.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.projected, true);
  assert.equal(payload.targetAssetId, "asset-song");
  assert.equal(payload.cuts, 2);
  assert.match(payload.timelineProjectionPath, /projections\/timelines\/asset-song\.mv-beat-cut\.timeline\.yaml$/);
  assert.match(payload.manifestPath, /projections\/timelines\/asset-song\.mv-beat-cut\.timeline-manifest\.json$/);
  assert.match(payload.timelineLockPath, /timelines\/main\.timeline\.lock\.json$/);
  assert.ok(existsSync(payload.timelineProjectionPath));
  assert.ok(existsSync(payload.manifestPath));
  assert.equal(existsSync(payload.timelineLockPath), false, "MV projection command must not mint a fake CAS lock");

  const parsedTimeline = timelineDslFromYaml(await readFile(payload.timelineProjectionPath, "utf8"));
  assert.equal(parsedTimeline.ok, true);
  if (!parsedTimeline.ok) return;
  assert.equal(parsedTimeline.dsl.fps, 30);
  assert.equal(parsedTimeline.dsl.durationInFrames, 120);
  assert.equal(parsedTimeline.dsl.tracks[0].role, "primary-video");
  assert.equal(parsedTimeline.dsl.tracks[1].role, "music");
  assert.deepEqual(parsedTimeline.dsl.tracks[0].items.map((item: any) => [
    item.id,
    item.type,
    item.assetId,
    item.src,
    item.from,
    item.durationInFrames,
    item.sourceStartInFrames,
    item.beatSectionId,
    item.semanticLabel,
    item.semanticConfidence,
    item.reviewRequired,
    item.cutDensity,
  ]), [
    [
      "mv-cut-intro",
      "video",
      "asset-shot-a",
      "assets/video/shot-a.mp4",
      0,
      60,
      12,
      "intro",
      "intro",
      0.72,
      true,
      "medium",
    ],
    [
      "mv-cut-drop",
      "image",
      "asset-shot-b",
      "assets/images/shot-b.png",
      60,
      60,
      undefined,
      "drop",
      "drop",
      0.87,
      false,
      "fast",
    ],
  ]);
  assert.deepEqual(parsedTimeline.dsl.tracks[1].items[0], {
    id: "asset-song-music",
    type: "audio",
    from: 0,
    durationInFrames: 120,
    assetId: "asset-song",
    src: "assets/audio/song.wav",
  });

  const manifest = JSON.parse(await readFile(payload.manifestPath, "utf8"));
  assert.equal(manifest.kind, "clash.mv.beat-cut.timeline-projection");
  assert.deepEqual(
    manifest.casApply,
    expectedTimelineCasApply("projections/timelines/asset-song.mv-beat-cut.timeline.yaml"),
  );
  assert.deepEqual(manifest.cutAssignments.map((assignment: any) => [
    assignment.sectionId,
    assignment.clipAssetId,
    assignment.outputStartFrame,
    assignment.outputEndFrame,
    assignment.semanticLabel,
    assignment.semanticConfidence,
    assignment.reviewRequired,
    assignment.semanticSource,
  ]), [
    ["intro", "asset-shot-a", 0, 60, "intro", 0.72, true, "local-rms-phrase-heuristic"],
    ["drop", "asset-shot-b", 60, 120, "drop", 0.87, false, "local-rms-phrase-heuristic"],
  ]);

  const parsedForApply = parseTimelineFileForApply(await readFile(payload.timelineProjectionPath, "utf8"));
  assert.equal(parsedForApply.ok, true);
  if (!parsedForApply.ok) return;
  const cas = assertTimelineCas({
    projectId: "project-1",
    nodeId: "editor-1",
    lock: null,
    currentDsl: parsedForApply.dsl,
    force: false,
  });
  assert.equal(cas.ok, false);
  if (cas.ok) return;
  assert.match(cas.error, /Missing timeline CAS lock/);
});

test("runs production verify-mv-beat-sync and blocks incomplete beat metadata", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-mv-beat-sync-"));
  await writeJson(join(cwd, "actions", "mv-beat-fill.json"), {
    actionId: "action-mv-beat-fill",
    targetAssetId: "asset-song",
    metadataKind: "audio.beat-analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.beat-analysis",
      bpm: 120,
      fps: 30,
      beats: [
        { frame: 0, timeSeconds: 0, confidence: 0.95, downbeat: true },
        { frame: 15, timeSeconds: 0.5, confidence: 0.9 },
        { frame: 30, timeSeconds: 1, confidence: 0.91 },
        { frame: 45, timeSeconds: 1.5, confidence: 0.89 },
        { frame: 60, timeSeconds: 2, confidence: 0.98, downbeat: true },
      ],
      sections: [
        {
          id: "intro",
          startFrame: 0,
          endFrame: 60,
          label: "bar 1",
          semanticLabel: "intro",
          semanticConfidence: 0.72,
          reviewRequired: true,
          semanticSource: "local-rms-phrase-heuristic",
          cutDensity: "medium",
        },
        {
          id: "drop",
          startFrame: 60,
          endFrame: 120,
          label: "bar 2",
          semanticLabel: "drop",
          semanticConfidence: 0.87,
          reviewRequired: false,
          semanticSource: "local-rms-phrase-heuristic",
          cutDensity: "fast",
        },
      ],
      energyCurve: [],
    },
  });
  await writeJson(join(cwd, "actions", "mv-beat-fill-broken.json"), {
    actionId: "action-mv-beat-fill-broken",
    targetAssetId: "asset-song",
    metadataKind: "audio.beat-analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.beat-analysis",
      bpm: 120,
      fps: 30,
      beats: [
        { frame: 0, timeSeconds: 0, confidence: 0.95 },
        { frame: 15, timeSeconds: 0.5, confidence: 0.9 },
      ],
      sections: [
        { id: "intro", startFrame: 0, endFrame: 60, label: "bar 1" },
      ],
      energyCurve: [],
    },
  });
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      { id: "asset-song", type: "audio", path: "assets/audio/song.wav", metadata: {} },
      { id: "asset-shot-a", type: "video", path: "assets/video/shot-a.mp4", metadata: {} },
      { id: "asset-shot-b", type: "image", path: "assets/images/shot-b.png", metadata: {} },
    ],
  });
  await writeJson(join(cwd, "plans", "mv-clips.json"), [
    { assetId: "asset-shot-a", type: "video", path: "assets/video/shot-a.mp4", sourceStartFrame: 12 },
    { assetId: "asset-shot-b", type: "image", path: "assets/images/shot-b.png" },
  ]);

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const project = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-mv-beat-cuts",
      "--action",
      "actions/mv-beat-fill.json",
      "--audio-src",
      "assets/audio/song.wav",
      "--clips",
      "plans/mv-clips.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(project.status, 0, project.stderr);
  const projectionPayload = JSON.parse(project.stdout);

  const runVerify = (action: string, out: string) => spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "verify-mv-beat-sync",
      "--action",
      action,
      "--projection",
      "projections/timelines/asset-song.mv-beat-cut.timeline-manifest.json",
      "--out",
      out,
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  const pass = runVerify("actions/mv-beat-fill.json", "qa/mv/asset-song.beat-sync.json");
  assert.equal(pass.status, 0, pass.stderr);
  const passPayload = JSON.parse(pass.stdout);
  assert.equal(passPayload.status, "pass");
  assert.equal(passPayload.targetAssetId, "asset-song");
  assert.equal(passPayload.beats, 5);
  assert.equal(passPayload.downbeats, 2);
  assert.equal(passPayload.sections, 2);
  assert.equal(passPayload.cutAssignments, 2);
  assert.match(passPayload.reportPath, /qa\/mv\/asset-song\.beat-sync\.json$/);
  const passReport = JSON.parse(await readFile(passPayload.reportPath, "utf8"));
  assert.equal(passReport.kind, "clash.mv.beat-sync-verification");
  assert.equal(passReport.projectionPath, "projections/timelines/asset-song.mv-beat-cut.timeline-manifest.json");
  assert.equal(passReport.timelineProjectionPath, "projections/timelines/asset-song.mv-beat-cut.timeline.yaml");
  assert.deepEqual(passReport.blockedReasons, []);
  assert.deepEqual(
    passReport.checks.map((check: any) => [check.id, check.status]),
    [
      ["audio.beat-analysis-present", "pass"],
      ["beat.downbeats-present", "pass"],
      ["sections.present", "pass"],
      ["sections.cut-density-present", "pass"],
      ["sections.review-confidence-present", "pass"],
      ["projection.cas-fresh-pull", "pass"],
      ["projection.sections-covered", "pass"],
      ["projection.cut-density-propagated", "pass"],
    ],
  );
  assert.deepEqual(passReport.sectionCoverage.map((item: any) => [item.sectionId, item.covered]), [
    ["intro", true],
    ["drop", true],
  ]);
  assert.ok(
    projectionPayload.timelineProjectionPath.endsWith(`/${passReport.timelineProjectionPath}`),
    "verification report should point at the generated MV timeline projection",
  );

  const blocked = runVerify("actions/mv-beat-fill-broken.json", "qa/mv/asset-song.beat-sync.blocked.json");
  assert.equal(blocked.status, 0, blocked.stderr);
  const blockedPayload = JSON.parse(blocked.stdout);
  assert.equal(blockedPayload.status, "blocked");
  assert.ok(blockedPayload.blockedReasons.some((reason: string) => reason.includes("beat.downbeats-present")));
  assert.ok(blockedPayload.blockedReasons.some((reason: string) => reason.includes("sections.cut-density-present")));
  const blockedReport = JSON.parse(await readFile(blockedPayload.reportPath, "utf8"));
  assert.equal(blockedReport.status, "blocked");
  assert.ok(
    blockedReport.checks.some((check: any) => check.id === "sections.review-confidence-present" && check.status === "fail"),
  );
});

test("rejects MV beat timeline projection when visual clips are not registered assets", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-mv-timeline-unregistered-cli-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      { id: "asset-song", type: "audio", path: "assets/audio/song.wav", metadata: {} },
    ],
  });
  await writeJson(join(cwd, "actions", "mv-beat-fill.json"), {
    actionId: "action-mv-beat-fill",
    targetAssetId: "asset-song",
    metadataKind: "audio.beat-analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.beat-analysis",
      bpm: 120,
      fps: 30,
      beats: [{ frame: 0, timeSeconds: 0, confidence: 0.95, downbeat: true }],
      sections: [{ id: "intro", startFrame: 0, endFrame: 60, label: "intro" }],
      energyCurve: [],
    },
  });
  await writeJson(join(cwd, "plans", "mv-clips.json"), [
    { assetId: "asset-shot-a", type: "video", path: "assets/video/shot-a.mp4" },
  ]);
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-mv-beat-cuts",
      "--action",
      "actions/mv-beat-fill.json",
      "--audio-src",
      "assets/audio/song.wav",
      "--clips",
      "plans/mv-clips.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 1);
  assert.match(child.stderr, /MV clip asset asset-shot-a is not registered in assets\/manifest\.json/i);
  assert.equal(existsSync(join(cwd, "projections", "timelines", "asset-song.mv-beat-cut.timeline.yaml")), false);
});

test("runs production plan-lyrics-alignment and applies a lyric caption timeline projection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-lyrics-cli-"));
  await writeFile(join(cwd, "lyrics.txt"), "tonight we rise\ninto the light\n", "utf8");
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-song", type: "audio", path: "assets/audio/song.wav", metadata: {} }],
  });
  await writeJson(join(cwd, "actions", "mv-beat-fill.json"), {
    actionId: "action-mv-beat-fill",
    targetAssetId: "asset-song",
    metadataKind: "audio.beat-analysis",
    producer: "qa-fixture",
    metadata: {
      kind: "audio.beat-analysis",
      bpm: 120,
      fps: 30,
      beats: [
        { frame: 0, timeSeconds: 0, confidence: 0.95, downbeat: true },
        { frame: 30, timeSeconds: 1, confidence: 0.9 },
        { frame: 60, timeSeconds: 2, confidence: 0.98, downbeat: true },
        { frame: 90, timeSeconds: 3, confidence: 0.9 },
      ],
      sections: [
        { id: "verse", startFrame: 0, endFrame: 60, label: "verse", cutDensity: "medium" },
        { id: "chorus", startFrame: 60, endFrame: 120, label: "chorus", cutDensity: "fast" },
      ],
      energyCurve: [],
    },
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-lyrics-alignment",
      "--target-asset",
      "asset-song",
      "--lyrics",
      "lyrics.txt",
      "--beat-action",
      "actions/mv-beat-fill.json",
      "--out",
      "actions/lyrics-fill.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.planned, true);
  assert.equal(payload.targetAssetId, "asset-song");
  assert.equal(payload.units, 2);
  assert.equal(payload.confidence, 0.62);
  assert.match(payload.actionPath, /actions\/lyrics-fill\.json$/);
  const action = JSON.parse(await readFile(payload.actionPath, "utf8"));
  assert.equal(action.metadata.kind, "audio.lyrics-alignment");
  assert.deepEqual(action.metadata.units.map((unit: any) => [
    unit.lineId,
    unit.text,
    unit.startFrame,
    unit.endFrame,
    unit.source,
  ]), [
    ["line-1", "tonight we rise", 0, 60, "beat-section-heuristic"],
    ["line-2", "into the light", 60, 120, "beat-section-heuristic"],
  ]);

  const result = await applyProductionMetadataAction({
    cwd,
    actionPath: "actions/lyrics-fill.json",
    assetsPath: "assets/manifest.json",
  });
  assert.equal(result.metadataKind, "audio.lyrics-alignment");
  assert.equal(result.timelineProjectionPath, join(cwd, "projections", "timelines", "asset-song.lyrics.caption.timeline.yaml"));
  const lyricsProjection = JSON.parse(
    await readFile(join(cwd, "projections", "lyrics", "asset-song.lyrics-alignment.json"), "utf8"),
  );
  assert.equal(lyricsProjection.kind, "clash.audio.lyrics-alignment.projection");
  assert.equal(lyricsProjection.units[0].startFrame, 0);
  assert.equal(lyricsProjection.units[1].endFrame, 120);

  const parsedTimeline = timelineDslFromYaml(await readFile(result.timelineProjectionPath!, "utf8"));
  assert.equal(parsedTimeline.ok, true);
  if (!parsedTimeline.ok) return;
  assert.equal(parsedTimeline.dsl.tracks[0].role, "subtitle");
  const captions = parsedTimeline.dsl.tracks[0].items[0] as any;
  assert.equal(captions.type, "caption");
  assert.deepEqual(captions.cues.map((cue: any) => [cue.text, cue.startFrame, cue.durationInFrames]), [
    ["tonight we rise", 0, 60],
    ["into the light", 60, 60],
  ]);
  assert.deepEqual(captions.wordRefs.map((word: any) => [word.id, word.text]), [
    ["line-1", "tonight we rise"],
    ["line-2", "into the light"],
  ]);
});

test("runs production plan-visual-moments and applies a reusable source range library", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-visual-moments-cli-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-source-video", type: "video", path: "assets/video/source.mp4", metadata: {} }],
  });
  await writeJson(join(cwd, "analysis", "video", "source-moments.json"), {
    sceneChanges: [0, 45],
    candidates: [
      {
        id: "moment-hook",
        startMs: 0,
        endMs: 1500,
        peakMs: 900,
        sceneIndex: 0,
        motion: 0.82,
        quality: 0.91,
        action: 0.76,
        emotion: 0.55,
        semantic: "fast product reveal",
        tags: ["drop", "product"],
      },
      {
        id: "moment-soft",
        startMs: 1500,
        endMs: 3000,
        peakMs: 2100,
        sceneIndex: 1,
        motion: 0.22,
        quality: 0.8,
        action: 0.2,
        emotion: 0.4,
        tags: ["hold"],
      },
    ],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-visual-moments",
      "--target-asset",
      "asset-source-video",
      "--source-path",
      "assets/video/source.mp4",
      "--moments",
      "analysis/video/source-moments.json",
      "--fps",
      "30",
      "--out",
      "actions/visual-moments.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.planned, true);
  assert.equal(payload.targetAssetId, "asset-source-video");
  assert.equal(payload.candidates, 2);
  assert.equal(payload.topCandidateId, "moment-hook");
  assert.match(payload.actionPath, /actions\/visual-moments\.json$/);
  const action = JSON.parse(await readFile(payload.actionPath, "utf8"));
  assert.equal(action.metadata.kind, "video.visual-moments");
  assert.deepEqual(action.metadata.candidates.map((candidate: any) => [
    candidate.id,
    candidate.startFrame,
    candidate.endFrame,
    candidate.peakFrame,
  ]), [
    ["moment-hook", 0, 45, 27],
    ["moment-soft", 45, 90, 63],
  ]);

  const result = await applyProductionMetadataAction({
    cwd,
    actionPath: "actions/visual-moments.json",
    assetsPath: "assets/manifest.json",
  });
  assert.equal(result.metadataKind, "video.visual-moments");
  const projectionPath = join(cwd, "projections", "visual-moments", "asset-source-video.visual-moments.json");
  assert.ok(existsSync(projectionPath));
  const projection = JSON.parse(await readFile(projectionPath, "utf8"));
  assert.equal(projection.kind, "clash.video.visual-moments.projection");
  assert.equal(projection.sourceVideoAssetId, "asset-source-video");
  assert.deepEqual(projection.recommendedClips.map((clip: any) => [
    clip.id,
    clip.assetId,
    clip.path,
    clip.sourceStartFrame,
    clip.sourceEndFrame,
    clip.score,
  ]), [
    ["moment-hook", "asset-source-video", "assets/video/source.mp4", 0, 45, 0.822],
    ["moment-soft", "asset-source-video", "assets/video/source.mp4", 45, 90, 0.495],
  ]);
});

test("runs production plan-ad-delivery-spec and applies TVC delivery metadata projection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-ad-delivery-cli-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      { id: "asset-tvc", type: "video", path: "assets/video/tvc-master.mp4", metadata: {} },
      { id: "asset-packshot", type: "image", path: "assets/images/packshot.png", metadata: {} },
    ],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-ad-delivery-spec",
      "--target-asset",
      "asset-tvc",
      "--brand",
      "Clash Skin",
      "--platforms",
      "tiktok,youtube-shorts",
      "--durations",
      "6,15,30",
      "--aspect",
      "9:16",
      "--resolution",
      "1080x1920",
      "--fps",
      "30",
      "--safe-zones",
      "120,48,220,48",
      "--packshot-asset",
      "asset-packshot",
      "--packshot-start",
      "360",
      "--packshot-end",
      "420",
      "--end-card-duration",
      "90",
      "--cta",
      "Shop now",
      "--disclaimer",
      "Results vary.",
      "--rights-ledger-asset",
      "asset-reference",
      "--out",
      "actions/ad-delivery-spec.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.planned, true);
  assert.equal(payload.targetAssetId, "asset-tvc");
  assert.equal(payload.variants, 6);
  assert.match(payload.actionPath, /actions\/ad-delivery-spec\.json$/);
  assert.ok(existsSync(payload.actionPath));
  const action = JSON.parse(await readFile(payload.actionPath, "utf8"));
  assert.equal(action.metadata.kind, "ad.delivery-spec");
  assert.equal(action.metadata.brand, "Clash Skin");
  assert.deepEqual(action.metadata.platforms, ["tiktok", "youtube-shorts"]);
  assert.deepEqual(action.metadata.variants.map((variant: any) => [
    variant.id,
    variant.platform,
    variant.durationSeconds,
    variant.aspectRatio,
  ]), [
    ["tiktok-9x16-6s", "tiktok", 6, "9:16"],
    ["tiktok-9x16-15s", "tiktok", 15, "9:16"],
    ["tiktok-9x16-30s", "tiktok", 30, "9:16"],
    ["youtube-shorts-9x16-6s", "youtube-shorts", 6, "9:16"],
    ["youtube-shorts-9x16-15s", "youtube-shorts", 15, "9:16"],
    ["youtube-shorts-9x16-30s", "youtube-shorts", 30, "9:16"],
  ]);

  const result = await applyProductionMetadataAction({
    cwd,
    actionPath: "actions/ad-delivery-spec.json",
    assetsPath: "assets/manifest.json",
  });
  assert.equal(result.metadataKind, "ad.delivery-spec");
  assert.equal(result.timelineProjectionPath, undefined);
  assert.equal(result.metadataPath, join(cwd, "projections", "metadata", "asset-tvc.ad.delivery-spec.json"));
  const deliveryPath = join(cwd, "projections", "delivery", "asset-tvc.delivery-spec.json");
  assert.ok(existsSync(deliveryPath));
  const delivery = JSON.parse(await readFile(deliveryPath, "utf8"));
  assert.equal(delivery.kind, "clash.ad.delivery-spec.projection");
  assert.equal(delivery.targetAssetId, "asset-tvc");
  assert.equal(delivery.packshot.assetId, "asset-packshot");
  assert.equal(delivery.endCard.cta, "Shop now");
  assert.deepEqual(delivery.checklist.map((check: any) => check.id), [
    "duration:tiktok-9x16-6s",
    "safe-zone:tiktok-9x16-6s",
    "subtitles:tiktok-9x16-6s",
    "duration:tiktok-9x16-15s",
    "safe-zone:tiktok-9x16-15s",
    "subtitles:tiktok-9x16-15s",
    "duration:tiktok-9x16-30s",
    "safe-zone:tiktok-9x16-30s",
    "subtitles:tiktok-9x16-30s",
    "duration:youtube-shorts-9x16-6s",
    "safe-zone:youtube-shorts-9x16-6s",
    "subtitles:youtube-shorts-9x16-6s",
    "duration:youtube-shorts-9x16-15s",
    "safe-zone:youtube-shorts-9x16-15s",
    "subtitles:youtube-shorts-9x16-15s",
    "duration:youtube-shorts-9x16-30s",
    "safe-zone:youtube-shorts-9x16-30s",
    "subtitles:youtube-shorts-9x16-30s",
    "packshot",
    "end-card",
    "disclaimer",
    "rights-ledger",
  ]);
});

test("runs production validate-ad-delivery-export and writes a TVC release receipt", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-ad-validate-cli-"));
  await writeJson(join(cwd, "projections", "delivery", "asset-tvc.delivery-spec.json"), {
    schemaVersion: 1,
    kind: "clash.ad.delivery-spec.projection",
    targetAssetId: "asset-tvc",
    brand: "Clash Skin",
    fps: 30,
    platforms: ["tiktok"],
    variants: [
      {
        id: "tiktok-9x16-15s",
        platform: "tiktok",
        durationSeconds: 15,
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        safeZones: { top: 120, right: 48, bottom: 220, left: 48 },
        subtitlesRequired: true,
        loudnessTarget: "platform-default",
      },
    ],
    packshot: { required: true, assetId: "asset-packshot", startFrame: 360, endFrame: 420 },
    endCard: { required: true, durationFrames: 90, cta: "Shop now", disclaimer: "Results vary." },
    rightsLedgerAssetId: "asset-reference",
    checklist: [],
  });
  await writeJson(join(cwd, "analysis", "probe", "tiktok-15s.probe.json"), {
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 15.01,
    hasVideo: true,
    hasAudio: true,
    videoCodec: "h264",
    audioCodec: "aac",
  });
  await writeJson(join(cwd, "qa", "visual", "tiktok-15s.visual-qa.json"), {
    captionsPresent: true,
    safeZoneViolations: [],
    packshotVisible: true,
    endCardVisible: true,
    disclaimerVisible: true,
    ctaVisible: true,
    logoLockupVisible: true,
    finalFrameHolds: true,
  });

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "validate-ad-delivery-export",
      "--delivery-spec",
      "projections/delivery/asset-tvc.delivery-spec.json",
      "--variant",
      "tiktok-9x16-15s",
      "--rendered",
      "exports/tiktok-15s.mp4",
      "--probe",
      "analysis/probe/tiktok-15s.probe.json",
      "--visual-report",
      "qa/visual/tiktok-15s.visual-qa.json",
      "--out",
      "qa/delivery/tiktok-15s.validation.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.validated, true);
  assert.equal(payload.verdict, "pass");
  assert.match(payload.receiptPath, /qa\/delivery\/tiktok-15s\.validation\.json$/);
  const receipt = JSON.parse(await readFile(payload.receiptPath, "utf8"));
  assert.equal(receipt.kind, "clash.ad.delivery-export-validation");
  assert.equal(receipt.targetAssetId, "asset-tvc");
  assert.equal(receipt.variant.id, "tiktok-9x16-15s");
  assert.equal(receipt.renderedPath, "exports/tiktok-15s.mp4");
  assert.deepEqual(receipt.checks.map((check: any) => [check.id, check.status]), [
    ["variant", "pass"],
    ["video-track", "pass"],
    ["audio-track", "pass"],
    ["resolution", "pass"],
    ["aspect-ratio", "pass"],
    ["fps", "pass"],
    ["duration", "pass"],
    ["safe-zone", "pass"],
    ["subtitles", "pass"],
    ["packshot", "pass"],
    ["end-card", "pass"],
    ["disclaimer", "pass"],
    ["rights-ledger", "pass"],
  ]);
});

test("runs production plan-ad-visual-qa from local evidence and applies release-gate metadata", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-ad-visual-qa-cli-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-tvc", type: "video", path: "exports/tiktok-15s.mp4", metadata: {} }],
  });
  await writeJson(join(cwd, "projections", "delivery", "asset-tvc.delivery-spec.json"), {
    schemaVersion: 1,
    kind: "clash.ad.delivery-spec.projection",
    targetAssetId: "asset-tvc",
    brand: "Clash Skin",
    fps: 30,
    platforms: ["tiktok"],
    variants: [
      {
        id: "tiktok-9x16-15s",
        platform: "tiktok",
        durationSeconds: 15,
        width: 1080,
        height: 1920,
        aspectRatio: "9:16",
        safeZones: { top: 120, right: 48, bottom: 220, left: 48 },
        subtitlesRequired: true,
        loudnessTarget: "platform-default",
      },
    ],
    packshot: { required: true, assetId: "asset-packshot", startFrame: 360, endFrame: 420 },
    endCard: { required: true, durationFrames: 90, cta: "Shop now", disclaimer: "Results vary.", qrRequired: false },
    rightsLedgerAssetId: "asset-reference",
    checklist: [],
  });
  await writeJson(join(cwd, "analysis", "visual", "tiktok-15s.evidence.json"), {
    targetAssetId: "asset-tvc",
    variantId: "tiktok-9x16-15s",
    renderedPath: "exports/tiktok-15s.mp4",
    checks: [
      {
        id: "packshot-visible",
        check: "packshot-visible",
        status: "pass",
        required: true,
        expected: "packshot asset-packshot visible in frames 360-420",
        actual: "packshot detected in sampled frames",
        confidence: 0.96,
        frame: 390,
        evidencePath: "analysis/visual/frames/frame-0390.png",
      },
      {
        id: "logo-lockup-visible",
        check: "logo-lockup-visible",
        status: "pass",
        required: true,
        expected: "approved logo visible on end card",
        actual: "logo lockup present",
        confidence: 0.94,
        frame: 430,
      },
      {
        id: "disclaimer-ocr",
        check: "disclaimer-ocr",
        status: "pass",
        required: true,
        expected: "Results vary.",
        actual: "Results vary.",
        confidence: 0.91,
        frame: 430,
      },
      {
        id: "final-frame-hold",
        check: "final-frame-hold",
        status: "pass",
        required: true,
        expected: "final frame holds end card",
        actual: "final frame matches end card sample",
        confidence: 0.98,
        frame: 450,
      },
    ],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = (args: string[]) => spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry.pathname, "production", ...args],
    { cwd, encoding: "utf8" },
  );

  const planned = runCli([
    "plan-ad-visual-qa",
    "--target-asset",
    "asset-tvc",
    "--delivery-spec",
    "projections/delivery/asset-tvc.delivery-spec.json",
    "--variant",
    "tiktok-9x16-15s",
    "--evidence",
    "analysis/visual/tiktok-15s.evidence.json",
    "--out",
    "actions/ad-visual-qa.json",
    "--report",
    "qa/visual/tiktok-15s.visual-qa.json",
    "--json",
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  const payload = JSON.parse(planned.stdout);
  assert.equal(payload.planned, true);
  assert.equal(payload.verdict, "pass");
  assert.equal(payload.checks, 4);

  const action = JSON.parse(await readFile(join(cwd, "actions", "ad-visual-qa.json"), "utf8"));
  assert.equal(action.metadataKind, "ad.visual-qa");
  assert.equal(action.metadata.kind, "ad.visual-qa");
  assert.equal(action.metadata.visualQa.packshotVisible, true);
  assert.equal(action.metadata.visualQa.logoLockupVisible, true);
  assert.equal(action.metadata.visualQa.finalFrameHolds, true);
  assert.deepEqual(action.metadata.decisionLog, [
    "loaded 4 ad visual QA evidence checks",
    "did not execute OCR/logo/pixel analysis backends",
  ]);

  const report = JSON.parse(await readFile(join(cwd, "qa", "visual", "tiktok-15s.visual-qa.json"), "utf8"));
  assert.equal(report.kind, "clash.ad.visual-qa");
  assert.equal(report.verdict, "pass");
  assert.equal(report.visualQa.disclaimerVisible, true);

  const applied = runCli([
    "apply-metadata",
    "--action",
    "actions/ad-visual-qa.json",
    "--assets",
    "assets/manifest.json",
    "--json",
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const projection = JSON.parse(
    await readFile(join(cwd, "projections", "qa", "asset-tvc.tiktok-9x16-15s.ad-visual-qa.json"), "utf8"),
  );
  assert.equal(projection.kind, "clash.ad.visual-qa.projection");
  assert.equal(projection.visualQa.finalFrameHolds, true);

  const manifest = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const target = manifest.assets.find((asset: any) => asset.id === "asset-tvc");
  assert.equal(target.metadata["ad.visual-qa"].verdict, "pass");
});

test("runs production extract-ad-visual-frames before pixel QA analysis", async () => {
  const ffmpeg = resolveExecutable("ffmpeg");
  assert.ok(ffmpeg, "ffmpeg is required for ad visual frame extraction test");

  const cwd = await mkdtemp(join(tmpdir(), "clash-production-ad-frame-extract-cli-"));
  const renderedPath = join(cwd, "exports", "tiktok-15s.mkv");
  await makeAdVisualFixture(renderedPath, ffmpeg);
  await writeJson(join(cwd, "projections", "delivery", "asset-tvc.delivery-spec.json"), {
    schemaVersion: 1,
    kind: "clash.ad.delivery-spec.projection",
    targetAssetId: "asset-tvc",
    brand: "Clash Skin",
    fps: 1,
    platforms: ["tiktok"],
    variants: [
      {
        id: "tiktok-9x16-15s",
        platform: "tiktok",
        durationSeconds: 3,
        width: 16,
        height: 16,
        aspectRatio: "9:16",
        safeZones: { top: 0, right: 0, bottom: 0, left: 0 },
        subtitlesRequired: false,
        loudnessTarget: "platform-default",
      },
    ],
    packshot: { required: true, assetId: "asset-packshot", startFrame: 0, endFrame: 1 },
    endCard: { required: true, durationFrames: 2, cta: "Shop now", disclaimer: "Results vary.", qrRequired: false },
    rightsLedgerAssetId: "asset-reference",
    checklist: [],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = (args: string[]) => spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry.pathname, "production", ...args],
    { cwd, encoding: "utf8" },
  );

  const extracted = runCli([
    "extract-ad-visual-frames",
    "--target-asset",
    "asset-tvc",
    "--delivery-spec",
    "projections/delivery/asset-tvc.delivery-spec.json",
    "--variant",
    "tiktok-9x16-15s",
    "--rendered",
    "exports/tiktok-15s.mkv",
    "--packshot-frame",
    "0",
    "--end-card-frame",
    "1",
    "--final-frame",
    "2",
    "--out-dir",
    "analysis/visual/frames",
    "--manifest",
    "analysis/visual/tiktok-15s.frame-extraction.json",
    "--ffmpeg",
    ffmpeg,
    "--json",
  ]);

  assert.equal(extracted.status, 0, extracted.stderr);
  const extractedPayload = JSON.parse(extracted.stdout);
  assert.equal(extractedPayload.extracted, true);
  assert.equal(extractedPayload.samples, 3);
  const frameManifest = JSON.parse(await readFile(join(cwd, "analysis", "visual", "tiktok-15s.frame-extraction.json"), "utf8"));
  assert.equal(frameManifest.kind, "clash.ad.visual-frame-extraction");
  assert.equal(frameManifest.extractor.id, "ffmpeg");
  assert.deepEqual(frameManifest.samples.map((sample: any) => [sample.id, sample.frame, sample.path]), [
    ["packshot-frame", 0, "analysis/visual/frames/packshot.ppm"],
    ["end-card-frame", 1, "analysis/visual/frames/end-card.ppm"],
    ["final-frame", 2, "analysis/visual/frames/final.ppm"],
  ]);
  assert.ok(existsSync(join(cwd, "analysis", "visual", "frames", "packshot.ppm")));
  assert.ok(existsSync(join(cwd, "analysis", "visual", "frames", "end-card.ppm")));
  assert.ok(existsSync(join(cwd, "analysis", "visual", "frames", "final.ppm")));

  const analyzed = runCli([
    "analyze-ad-visual-pixels",
    "--target-asset",
    "asset-tvc",
    "--delivery-spec",
    "projections/delivery/asset-tvc.delivery-spec.json",
    "--variant",
    "tiktok-9x16-15s",
    "--rendered-path",
    "exports/tiktok-15s.mkv",
    "--packshot-frame",
    "analysis/visual/frames/packshot.ppm",
    "--packshot-color",
    "#f04a2a",
    "--end-card-frame",
    "analysis/visual/frames/end-card.ppm",
    "--final-frame",
    "analysis/visual/frames/final.ppm",
    "--out",
    "analysis/visual/tiktok-15s.pixel-evidence.json",
    "--json",
  ]);
  assert.equal(analyzed.status, 0, analyzed.stderr);
  const evidence = JSON.parse(await readFile(join(cwd, "analysis", "visual", "tiktok-15s.pixel-evidence.json"), "utf8"));
  assert.equal(evidence.checks.find((check: any) => check.id === "packshot-visible").status, "pass");
  assert.equal(evidence.checks.find((check: any) => check.id === "final-frame-hold").status, "pass");
});

test("runs production analyze-ad-visual-pixels then plans visual QA from generated evidence", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-ad-pixel-qa-cli-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-tvc", type: "video", path: "exports/tiktok-15s.mp4", metadata: {} }],
  });
  await writeJson(join(cwd, "projections", "delivery", "asset-tvc.delivery-spec.json"), {
    schemaVersion: 1,
    kind: "clash.ad.delivery-spec.projection",
    targetAssetId: "asset-tvc",
    brand: "Clash Skin",
    fps: 30,
    platforms: ["tiktok"],
    variants: [
      {
        id: "tiktok-9x16-15s",
        platform: "tiktok",
        durationSeconds: 15,
        width: 4,
        height: 4,
        aspectRatio: "9:16",
        safeZones: { top: 0, right: 0, bottom: 0, left: 0 },
        subtitlesRequired: false,
        loudnessTarget: "platform-default",
      },
    ],
    packshot: { required: true, assetId: "asset-packshot", startFrame: 360, endFrame: 420 },
    endCard: { required: true, durationFrames: 90, cta: "Shop now", disclaimer: "Results vary.", qrRequired: false },
    rightsLedgerAssetId: "asset-reference",
    checklist: [],
  });
  await writeBinary(
    join(cwd, "analysis", "visual", "frames", "packshot.ppm"),
    makePpm(4, 4, [
      "#f04a2a", "#f04a2a", "#f04a2a", "#ffffff",
      "#f04a2a", "#f04a2a", "#f04a2a", "#ffffff",
      "#f04a2a", "#f04a2a", "#f04a2a", "#ffffff",
      "#ffffff", "#ffffff", "#ffffff", "#ffffff",
    ]),
  );
  await writeBinary(
    join(cwd, "analysis", "visual", "frames", "end-card.ppm"),
    makePpm(4, 4, Array(16).fill("#112233")),
  );
  await writeBinary(
    join(cwd, "analysis", "visual", "frames", "final.ppm"),
    makePpm(4, 4, Array(16).fill("#112233")),
  );
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runCli = (args: string[]) => spawnSync(
    process.execPath,
    ["--import", tsxLoader, cliEntry.pathname, "production", ...args],
    { cwd, encoding: "utf8" },
  );

  const analyzed = runCli([
    "analyze-ad-visual-pixels",
    "--target-asset",
    "asset-tvc",
    "--delivery-spec",
    "projections/delivery/asset-tvc.delivery-spec.json",
    "--variant",
    "tiktok-9x16-15s",
    "--rendered-path",
    "exports/tiktok-15s.mp4",
    "--packshot-frame",
    "analysis/visual/frames/packshot.ppm",
    "--packshot-color",
    "#f04a2a",
    "--end-card-frame",
    "analysis/visual/frames/end-card.ppm",
    "--final-frame",
    "analysis/visual/frames/final.ppm",
    "--out",
    "analysis/visual/tiktok-15s.pixel-evidence.json",
    "--json",
  ]);

  assert.equal(analyzed.status, 0, analyzed.stderr);
  const analyzedPayload = JSON.parse(analyzed.stdout);
  assert.equal(analyzedPayload.analyzed, true);
  assert.equal(analyzedPayload.checks, 3);
  assert.equal(analyzedPayload.pixelSamples, 3);
  const evidence = JSON.parse(await readFile(join(cwd, "analysis", "visual", "tiktok-15s.pixel-evidence.json"), "utf8"));
  assert.equal(evidence.analysisBackend.id, "clash-local-ad-pixel-analyzer");
  assert.deepEqual(evidence.checks.map((check: any) => [check.id, check.check, check.status]), [
    ["packshot-visible", "packshot-visible", "pass"],
    ["end-card-visible", "end-card-visible", "pass"],
    ["final-frame-hold", "final-frame-hold", "pass"],
  ]);
  assert.deepEqual(evidence.pixelSamples.map((sample: any) => [sample.id, sample.width, sample.height]), [
    ["packshot-frame", 4, 4],
    ["end-card-frame", 4, 4],
    ["final-frame", 4, 4],
  ]);
  assert.match(evidence.checks[0].actual, /56\.25% pixels matched #f04a2a/);
  assert.match(evidence.checks[2].actual, /mean absolute RGB diff 0/);

  const planned = runCli([
    "plan-ad-visual-qa",
    "--target-asset",
    "asset-tvc",
    "--delivery-spec",
    "projections/delivery/asset-tvc.delivery-spec.json",
    "--variant",
    "tiktok-9x16-15s",
    "--evidence",
    "analysis/visual/tiktok-15s.pixel-evidence.json",
    "--out",
    "actions/ad-visual-qa.json",
    "--report",
    "qa/visual/tiktok-15s.visual-qa.json",
    "--json",
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  const action = JSON.parse(await readFile(join(cwd, "actions", "ad-visual-qa.json"), "utf8"));
  assert.equal(action.metadata.visualQa.packshotVisible, true);
  assert.equal(action.metadata.visualQa.endCardVisible, true);
  assert.equal(action.metadata.visualQa.finalFrameHolds, true);
  assert.ok(
    action.metadata.decisionLog.includes("consumed evidence from clash-local-ad-pixel-analyzer"),
    "metadata should preserve local pixel analyzer provenance",
  );
});

test("plans TVC/reference review metadata without granting derivative rights by default", () => {
  const action = planReferenceReviewAction({
    targetAssetId: "asset-reference",
    sourceUrl: "https://example.invalid/watch/tvc",
    shots: [
      { id: "shot-1", startFrame: 0, endFrame: 45, description: "fast product push-in", tags: ["push-in"] },
    ],
  });

  assert.equal(action.metadata.kind, "reference-video.analysis");
  if (action.metadata.kind !== "reference-video.analysis") return;
  assert.equal(action.metadata.rights.derivativeAllowed, false);
  assert.equal(action.metadata.rights.redistributionAllowed, false);
  assert.equal(action.metadata.nonCopyingQa?.status, "requires-review");
  assert.equal(action.metadata.shots[0].description, "fast product push-in");
});

test("runs production plan-reference-review and apply keeps it metadata-only when rights block remix", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-reference-cli-"));
  await writeJson(join(cwd, "analysis", "reference-shots.json"), [
    { id: "shot-1", startFrame: 0, endFrame: 45, description: "fast product push-in", tags: ["push-in"] },
  ]);
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-reference", type: "reference", metadata: {} }],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-reference-review",
      "--source-url",
      "https://example.invalid/watch/tvc",
      "--target-asset",
      "asset-reference",
      "--shots",
      "analysis/reference-shots.json",
      "--out",
      "actions/reference-review.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.derivativeAllowed, false);
  assert.match(payload.actionPath, /actions\/reference-review\.json$/);
  const result = await applyProductionMetadataAction({
    cwd,
    actionPath: "actions/reference-review.json",
    assetsPath: "assets/manifest.json",
  });
  assert.equal(result.timelineProjectionPath, undefined);
  assert.match(result.blockedReason!, /derivative use is not allowed/);
  assert.ok(existsSync(join(cwd, "projections", "references", "asset-reference.reference-review.json")));
  assert.match((result as any).shotAnalysisProjectionPath, /asset-reference\.shot-analysis\.json$/);
  const shotAnalysis = JSON.parse(
    await readFile(join(cwd, "projections", "references", "asset-reference.shot-analysis.json"), "utf8"),
  );
  assert.equal(shotAnalysis.kind, "clash.reference.shot-analysis.projection");
  assert.equal(shotAnalysis.sourceUrl, "https://example.invalid/watch/tvc");
  assert.equal(shotAnalysis.analysisOnly, true);
  assert.equal(shotAnalysis.mediaCopied, false);
  assert.equal(shotAnalysis.finalExportAllowed, false);
  assert.deepEqual(shotAnalysis.allowedUses, ["metadata-analysis", "shot-analysis", "non-copying-reference"]);
  assert.deepEqual(shotAnalysis.shots.map((shot: any) => [shot.id, shot.startFrame, shot.endFrame, shot.tags]), [
    ["shot-1", 0, 45, ["push-in"]],
  ]);
});

test("runs production plan-reference-download with explicit allow gate and raw-reference quarantine", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-reference-download-cli-"));
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runPlan = (extraArgs: string[]) => spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-reference-download",
      "--source-url",
      "https://example.invalid/watch/tvc",
      "--target-asset",
      "asset-reference",
      "--out",
      "references/downloads/asset-reference.download-plan.json",
      "--json",
      ...extraArgs,
    ],
    { cwd, encoding: "utf8" },
  );

  const blocked = runPlan([]);
  assert.equal(blocked.status, 0, blocked.stderr);
  const blockedPayload = JSON.parse(blocked.stdout);
  assert.equal(blockedPayload.planned, true);
  assert.equal(blockedPayload.status, "blocked");
  assert.equal(blockedPayload.downloadAllowed, false);
  assert.match(blockedPayload.planPath, /references\/downloads\/asset-reference\.download-plan\.json$/);
  const blockedPlan = JSON.parse(await readFile(join(cwd, "references", "downloads", "asset-reference.download-plan.json"), "utf8"));
  assert.equal(blockedPlan.kind, "clash.reference.download-plan");
  assert.equal(blockedPlan.status, "blocked");
  assert.deepEqual(blockedPlan.blockedReasons, ["download requires explicit --allow-download"]);
  assert.equal(blockedPlan.finalExportAllowed, false);
  assert.equal(blockedPlan.rawReferenceQuarantine, true);

  const allowed = runPlan([
    "--allow-download",
    "--license",
    "analysis-only",
    "--attribution",
    "Example Brand",
    "--allowed-uses",
    "analysis-only,shot-breakdown",
  ]);
  assert.equal(allowed.status, 0, allowed.stderr);
  const allowedPayload = JSON.parse(allowed.stdout);
  assert.equal(allowedPayload.status, "planned");
  assert.equal(allowedPayload.downloadAllowed, true);
  assert.equal(allowedPayload.tool, "yt-dlp");
  const plan = JSON.parse(await readFile(join(cwd, "references", "downloads", "asset-reference.download-plan.json"), "utf8"));
  assert.equal(plan.status, "planned");
  assert.equal(plan.outputDir, "references/raw/asset-reference");
  assert.equal(plan.rawReferenceQuarantine, true);
  assert.equal(plan.finalExportAllowed, false);
  assert.deepEqual(plan.sourceLedger.allowedUses, ["analysis-only", "shot-breakdown"]);
  assert.deepEqual(plan.downloadCommand.slice(0, 4), ["yt-dlp", "--no-playlist", "--restrict-filenames", "--write-info-json"]);
  assert.ok(plan.downloadCommand.includes("https://example.invalid/watch/tvc"));

  const redistributionOnly = runPlan([
    "--allow-download",
    "--license",
    "raw-reference-redistribution-only",
    "--attribution",
    "Example Brand",
    "--allowed-uses",
    "analysis-only,shot-breakdown,final-export",
    "--redistribution-allowed",
  ]);
  assert.equal(redistributionOnly.status, 0, redistributionOnly.stderr);
  const redistributionOnlyPlan = JSON.parse(
    await readFile(join(cwd, "references", "downloads", "asset-reference.download-plan.json"), "utf8"),
  );
  assert.equal(redistributionOnlyPlan.sourceLedger.redistributionAllowed, true);
  assert.equal(redistributionOnlyPlan.sourceLedger.derivativeAllowed, false);
  assert.equal(
    redistributionOnlyPlan.finalExportAllowed,
    false,
    "reference final export requires derivative rights, not only raw redistribution rights",
  );
});

test("runs production execute-reference-download only for allowed plans and registers a quarantined asset", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-reference-execute-cli-"));
  await writeJson(join(cwd, "assets", "manifest.json"), { assets: [] });
  const fakeRunnerPath = join(cwd, "tools", "fake-yt-dlp.mjs");
  await mkdir(join(cwd, "tools"), { recursive: true });
  await writeFile(fakeRunnerPath, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0) throw new Error("missing --output");
const outputPattern = process.argv[outputIndex + 1];
const mediaPath = outputPattern.replace("%(id)s", "reference-001").replace("%(ext)s", "mp4");
mkdirSync(dirname(mediaPath), { recursive: true });
writeFileSync(mediaPath, "fake-video");
writeFileSync(mediaPath.replace(/\\.mp4$/, ".info.json"), JSON.stringify({ id: "reference-001" }));
`, "utf8");
  await chmod(fakeRunnerPath, 0o755);
  await writeJson(join(cwd, "references", "downloads", "blocked.download-plan.json"), {
    schemaVersion: 1,
    kind: "clash.reference.download-plan",
    targetAssetId: "asset-reference",
    sourceUrl: "https://example.invalid/watch/tvc",
    status: "blocked",
    downloadAllowed: false,
    blockedReasons: ["download requires explicit --allow-download"],
    tool: "yt-dlp",
    outputDir: "references/raw/asset-reference",
    rawReferenceQuarantine: true,
    finalExportAllowed: false,
    requiresUserExecution: true,
    downloadCommand: ["yt-dlp", "--output", "references/raw/asset-reference/%(id)s.%(ext)s", "https://example.invalid/watch/tvc"],
    sourceLedger: {
      sourceUrl: "https://example.invalid/watch/tvc",
      license: "analysis-only",
      attribution: "Example Brand",
      allowedUses: ["analysis-only"],
      redistributionAllowed: false,
      derivativeAllowed: false,
    },
    createdAt: "2026-07-06T00:00:00.000Z",
  });
  await writeJson(join(cwd, "references", "downloads", "allowed.download-plan.json"), {
    schemaVersion: 1,
    kind: "clash.reference.download-plan",
    targetAssetId: "asset-reference",
    sourceUrl: "https://example.invalid/watch/tvc",
    status: "planned",
    downloadAllowed: true,
    blockedReasons: [],
    tool: "yt-dlp",
    outputDir: "references/raw/asset-reference",
    rawReferenceQuarantine: true,
    finalExportAllowed: false,
    requiresUserExecution: true,
    downloadCommand: ["yt-dlp", "--no-playlist", "--output", "references/raw/asset-reference/%(id)s.%(ext)s", "https://example.invalid/watch/tvc"],
    sourceLedger: {
      sourceUrl: "https://example.invalid/watch/tvc",
      license: "analysis-only",
      attribution: "Example Brand",
      allowedUses: ["analysis-only", "shot-breakdown"],
      redistributionAllowed: false,
      derivativeAllowed: false,
    },
    createdAt: "2026-07-06T00:00:00.000Z",
  });
  await writeJson(join(cwd, "references", "downloads", "inconsistent-rights.download-plan.json"), {
    schemaVersion: 1,
    kind: "clash.reference.download-plan",
    targetAssetId: "asset-reference",
    sourceUrl: "https://example.invalid/watch/tvc",
    status: "planned",
    downloadAllowed: true,
    blockedReasons: [],
    tool: "yt-dlp",
    outputDir: "references/raw/asset-reference",
    rawReferenceQuarantine: true,
    finalExportAllowed: true,
    requiresUserExecution: true,
    downloadCommand: ["yt-dlp", "--no-playlist", "--output", "references/raw/asset-reference/%(id)s.%(ext)s", "https://example.invalid/watch/tvc"],
    sourceLedger: {
      sourceUrl: "https://example.invalid/watch/tvc",
      license: "raw-reference-redistribution-only",
      attribution: "Example Brand",
      allowedUses: ["analysis-only", "shot-breakdown", "final-export"],
      redistributionAllowed: true,
      derivativeAllowed: false,
    },
    createdAt: "2026-07-06T00:00:00.000Z",
  });
  const tamperedCommandSideEffectPath = join(cwd, "tampered-command-ran.txt");
  await writeJson(join(cwd, "references", "downloads", "tampered-command.download-plan.json"), {
    schemaVersion: 1,
    kind: "clash.reference.download-plan",
    targetAssetId: "asset-reference",
    sourceUrl: "https://example.invalid/watch/tvc",
    status: "planned",
    downloadAllowed: true,
    blockedReasons: [],
    tool: "yt-dlp",
    outputDir: "references/raw/asset-reference",
    rawReferenceQuarantine: true,
    finalExportAllowed: false,
    requiresUserExecution: true,
    downloadCommand: [
      process.execPath,
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(tamperedCommandSideEffectPath)}, "bad")`,
    ],
    sourceLedger: {
      sourceUrl: "https://example.invalid/watch/tvc",
      license: "analysis-only",
      attribution: "Example Brand",
      allowedUses: ["analysis-only"],
      redistributionAllowed: false,
      derivativeAllowed: false,
    },
    createdAt: "2026-07-06T00:00:00.000Z",
  });
  await writeJson(join(cwd, "references", "downloads", "dangerous-args.download-plan.json"), {
    schemaVersion: 1,
    kind: "clash.reference.download-plan",
    targetAssetId: "asset-dangerous-reference",
    sourceUrl: "https://example.invalid/watch/dangerous",
    status: "planned",
    downloadAllowed: true,
    blockedReasons: [],
    tool: "yt-dlp",
    outputDir: "references/raw/asset-dangerous-reference",
    rawReferenceQuarantine: true,
    finalExportAllowed: false,
    requiresUserExecution: true,
    downloadCommand: [
      "yt-dlp",
      "--exec",
      "echo should-not-run",
      "--output",
      "references/raw/asset-dangerous-reference/%(id)s.%(ext)s",
      "https://example.invalid/watch/dangerous",
    ],
    sourceLedger: {
      sourceUrl: "https://example.invalid/watch/dangerous",
      license: "analysis-only",
      attribution: "Example Brand",
      allowedUses: ["analysis-only"],
      redistributionAllowed: false,
      derivativeAllowed: false,
    },
    createdAt: "2026-07-06T00:00:00.000Z",
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runExecute = (planPath: string) => spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "execute-reference-download",
      "--plan",
      planPath,
      "--assets",
      "assets/manifest.json",
      "--runner",
      fakeRunnerPath,
      "--out",
      "references/downloads/asset-reference.download-receipt.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  const blocked = runExecute("references/downloads/blocked.download-plan.json");
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /blocked|allow-download/i);

  const inconsistentRights = runExecute("references/downloads/inconsistent-rights.download-plan.json");
  assert.equal(inconsistentRights.status, 1);
  assert.match(inconsistentRights.stderr, /final export requires derivative and redistribution rights/i);

  const tamperedCommand = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "execute-reference-download",
      "--plan",
      "references/downloads/tampered-command.download-plan.json",
      "--assets",
      "assets/manifest.json",
      "--out",
      "references/downloads/asset-reference.download-receipt.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(tamperedCommand.status, 1);
  assert.equal(
    existsSync(tamperedCommandSideEffectPath),
    false,
    "tampered reference download commands must be rejected before spawning arbitrary executables",
  );
  assert.match(tamperedCommand.stderr, /download command must start with yt-dlp/i);

  const dangerousArgs = runExecute("references/downloads/dangerous-args.download-plan.json");
  assert.equal(dangerousArgs.status, 1);
  assert.equal(
    existsSync(join(cwd, "references", "raw", "asset-dangerous-reference", "reference-001.mp4")),
    false,
    "dangerous yt-dlp args must be rejected before invoking the runner",
  );
  assert.match(dangerousArgs.stderr, /disallowed yt-dlp argument.*--exec/i);

  const allowed = runExecute("references/downloads/allowed.download-plan.json");
  assert.equal(allowed.status, 0, allowed.stderr);
  const payload = JSON.parse(allowed.stdout);
  assert.equal(payload.executed, true);
  assert.equal(payload.targetAssetId, "asset-reference");
  assert.match(payload.receiptPath, /references\/downloads\/asset-reference\.download-receipt\.json$/);
  assert.deepEqual(payload.downloadedFiles, ["references/raw/asset-reference/reference-001.mp4"]);
  const receipt = JSON.parse(await readFile(join(cwd, "references", "downloads", "asset-reference.download-receipt.json"), "utf8"));
  assert.equal(receipt.kind, "clash.reference.download-receipt");
  assert.equal(receipt.rawReferenceQuarantine, true);
  assert.equal(receipt.finalExportAllowed, false);
  const manifest = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  assert.equal(manifest.assets[0].id, "asset-reference");
  assert.equal(manifest.assets[0].path, "references/raw/asset-reference/reference-001.mp4");
  assert.equal(manifest.assets[0].metadata["reference.download"].kind, "reference.download");
  assert.equal(manifest.assets[0].metadata["reference.download"].rawReferenceQuarantine, true);
});

test("runs production plan-reference-noncopying-qa and writes a metadata-fill action plus QA report", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-reference-qa-cli-"));
  await writeJson(join(cwd, "analysis", "reference-001.json"), {
    schemaVersion: 1,
    referenceId: "reference-001",
    sourceLedger: {
      sourceUrl: "https://example.invalid/public-tvc",
      license: "unknown",
      allowedUses: ["analysis-only"],
      redistributionAllowed: false,
    },
    shots: [
      {
        id: "shot-001",
        startMs: 0,
        endMs: 2500,
        description: "Product close-up with text hook",
        tags: ["product", "hook", "close-up"],
      },
      {
        id: "shot-002",
        startMs: 2500,
        endMs: 6000,
        description: "Problem solution demonstration",
        tags: ["demo", "solution"],
      },
    ],
    remixConstraints: ["Do not reuse source frames in final export", "Use structure only"],
  });
  await writeJson(join(cwd, "plans", "proposed-tvc.json"), {
    shots: [
      {
        id: "new-shot-001",
        description: "Close-up product hook with new generated packshot and rewritten copy",
        tags: ["product", "hook", "packshot"],
        assetPath: "assets/generated/packshot-hook.png",
      },
      {
        id: "new-shot-002",
        description: "New actor demonstrates the solution in a different scene",
        tags: ["demo", "solution"],
        assetPath: "assets/generated/demo-scene.mp4",
      },
    ],
  });
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-reference", type: "reference", metadata: {} }],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-reference-noncopying-qa",
      "--reference",
      "analysis/reference-001.json",
      "--proposal",
      "plans/proposed-tvc.json",
      "--target-asset",
      "asset-reference",
      "--out",
      "actions/reference-noncopying-qa.json",
      "--report",
      "projections/references/reference-001.noncopying-qa.json",
      "--fps",
      "30",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.planned, true);
  assert.equal(payload.status, "requires-review");
  assert.ok(payload.similarityScore >= 0.5 && payload.similarityScore <= 1);
  assert.match(payload.actionPath, /actions\/reference-noncopying-qa\.json$/);
  assert.match(payload.reportPath, /projections\/references\/reference-001\.noncopying-qa\.json$/);
  assert.ok(existsSync(payload.actionPath));
  assert.ok(existsSync(payload.reportPath));

  const report = JSON.parse(await readFile(payload.reportPath, "utf8"));
  assert.equal(report.kind, "clash.reference.noncopying-qa");
  assert.equal(report.referenceId, "reference-001");
  assert.equal(report.status, "requires-review");
  assert.equal(report.checks.rawReferenceAssetReuse.pass, true);
  assert.equal(report.checks.structureSimilarity.pass, false);
  assert.deepEqual(report.blockedReasons, ["proposed shots are structurally close to reference shots"]);
  assert.equal(report.matches[0].referenceShotId, "shot-001");
  assert.equal(report.matches[0].proposedShotId, "new-shot-001");

  const action = JSON.parse(await readFile(payload.actionPath, "utf8"));
  assert.equal(action.metadata.kind, "reference-video.analysis");
  assert.equal(action.metadata.nonCopyingQa.status, "requires-review");
  assert.equal(action.metadata.nonCopyingQa.similarityScore, report.similarityScore);
  assert.deepEqual(action.metadata.shots.map((shot: any) => [shot.id, shot.startFrame, shot.endFrame]), [
    ["shot-001", 0, 75],
    ["shot-002", 75, 180],
  ]);

  const result = await applyProductionMetadataAction({
    cwd,
    actionPath: "actions/reference-noncopying-qa.json",
    assetsPath: "assets/manifest.json",
  });
  assert.equal(result.blockedReason, "reference https://example.invalid/public-tvc derivative use is not allowed");
  const review = JSON.parse(await readFile(join(cwd, "projections", "references", "asset-reference.reference-review.json"), "utf8"));
  assert.equal(review.nonCopyingQa.status, "requires-review");
  assert.equal(review.nonCopyingQa.similarityScore, report.similarityScore);
});

test("runs production verify-reference-isolation and blocks raw reference timeline reuse", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-reference-isolation-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      {
        id: "asset-reference",
        type: "reference",
        path: "references/raw/asset-reference/reference-001.mp4",
        metadata: {
          "reference.download": {
            kind: "reference.download",
            sourceUrl: "https://example.invalid/public-tvc",
            tool: "yt-dlp",
            outputDir: "references/raw/asset-reference",
            downloadedFiles: [
              {
                path: "references/raw/asset-reference/reference-001.mp4",
                mediaType: "video",
                sizeBytes: 12,
              },
            ],
            rawReferenceQuarantine: true,
            finalExportAllowed: false,
            sourceLedger: {
              sourceUrl: "https://example.invalid/public-tvc",
              license: "unknown",
              attribution: "unknown",
              allowedUses: ["analysis-only"],
              redistributionAllowed: false,
              derivativeAllowed: false,
            },
            decisionLog: ["registered raw reference asset in quarantine"],
          },
        },
      },
      {
        id: "asset-generated-shot",
        type: "video",
        path: "assets/generated/new-shot.mp4",
        metadata: {},
      },
    ],
  });
  const goodTimelinePath = join(cwd, "projections", "timelines", "tvc.timeline.yaml");
  const badTimelinePath = join(cwd, "projections", "timelines", "tvc.raw-reference.timeline.yaml");
  await mkdir(join(cwd, "projections", "timelines"), { recursive: true });
  await writeFile(goodTimelinePath, [
    "fps: 30",
    "durationInFrames: 60",
    "tracks:",
    "  - id: primary",
    "    role: primary-video",
    "    items:",
    "      - id: generated-shot",
    "        type: video",
    "        from: 0",
    "        durationInFrames: 60",
    "        assetId: asset-generated-shot",
    "        src: assets/generated/new-shot.mp4",
    "",
  ].join("\n"), "utf8");
  await writeFile(badTimelinePath, [
    "fps: 30",
    "durationInFrames: 60",
    "tracks:",
    "  - id: primary",
    "    role: primary-video",
    "    items:",
    "      - id: raw-reference-shot",
    "        type: video",
    "        from: 0",
    "        durationInFrames: 60",
    "        assetId: asset-reference",
    "        src: references/raw/asset-reference/reference-001.mp4",
    "",
  ].join("\n"), "utf8");

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const runVerify = (timeline: string, out: string) => spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "verify-reference-isolation",
      "--timeline",
      timeline,
      "--assets",
      "assets/manifest.json",
      "--out",
      out,
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  const pass = runVerify("projections/timelines/tvc.timeline.yaml", "qa/reference/tvc.reference-isolation.json");
  assert.equal(pass.status, 0, pass.stderr);
  const passPayload = JSON.parse(pass.stdout);
  assert.equal(passPayload.status, "pass");
  assert.equal(passPayload.rawReferenceAssets, 1);
  assert.equal(passPayload.timelineItems, 1);
  assert.equal(passPayload.offenders, 0);
  const passReport = JSON.parse(await readFile(passPayload.reportPath, "utf8"));
  assert.equal(passReport.kind, "clash.reference.isolation-verification");
  assert.deepEqual(passReport.blockedReasons, []);
  assert.deepEqual(
    passReport.checks.map((check: any) => [check.id, check.status]),
    [
      ["assets.raw-reference-quarantine-known", "pass"],
      ["timeline.valid", "pass"],
      ["timeline.no-unlicensed-raw-reference-assets", "pass"],
      ["timeline.no-unlicensed-raw-reference-paths", "pass"],
    ],
  );

  const blocked = runVerify(
    "projections/timelines/tvc.raw-reference.timeline.yaml",
    "qa/reference/tvc.reference-isolation.blocked.json",
  );
  assert.equal(blocked.status, 0, blocked.stderr);
  const blockedPayload = JSON.parse(blocked.stdout);
  assert.equal(blockedPayload.status, "blocked");
  assert.equal(blockedPayload.offenders, 1);
  assert.ok(blockedPayload.blockedReasons.some((reason: string) => reason.includes("asset-reference")));
  const blockedReport = JSON.parse(await readFile(blockedPayload.reportPath, "utf8"));
  assert.equal(blockedReport.status, "blocked");
  assert.deepEqual(blockedReport.offenders.map((offender: any) => [
    offender.itemId,
    offender.assetId,
    offender.src,
    offender.reason,
  ]), [
    [
      "raw-reference-shot",
      "asset-reference",
      "references/raw/asset-reference/reference-001.mp4",
      "timeline item uses quarantined raw reference without final export rights",
    ],
  ]);
});

test("plans short-drama/image storyboard consistency metadata with character views", () => {
  const action = planStoryboardConsistencyAction({
    targetAssetId: "asset-storyboard",
    characters: [
      {
        id: "hero",
        name: "便利店店员",
        referenceAssetIds: ["asset-hero-front", "asset-hero-side", "asset-hero-back"],
        requiredViews: ["front", "side", "back"],
      },
    ],
    scenes: [
      { id: "store-night", referenceAssetIds: ["asset-store"], prompt: "night convenience store aisle" },
    ],
    panels: [
      { id: "panel-1", sceneId: "store-night", characterIds: ["hero"], assetId: "asset-panel-1", consistencyScore: 0.86 },
    ],
  });

  assert.equal(action.metadata.kind, "image.storyboard-consistency");
  if (action.metadata.kind !== "image.storyboard-consistency") return;
  assert.deepEqual(action.metadata.characters[0].requiredViews, ["front", "side", "back"]);
  assert.equal(action.metadata.panels[0].sceneId, "store-night");
});

test("runs production plan-storyboard-consistency-qa and writes a metadata-fill action plus QA report", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-storyboard-qa-cli-"));
  await writeJson(join(cwd, "storyboards", "characters.json"), [
    {
      id: "hero",
      name: "便利店店员",
      referenceAssetIds: ["asset-hero-front", "asset-hero-side"],
      requiredViews: ["front", "side", "back"],
    },
  ]);
  await writeJson(join(cwd, "storyboards", "scenes.json"), [
    { id: "store-night", referenceAssetIds: ["asset-store"], prompt: "night convenience store aisle" },
  ]);
  await writeJson(join(cwd, "storyboards", "panels.json"), [
    {
      id: "panel-1",
      sceneId: "store-night",
      characterIds: ["hero"],
      assetId: "asset-panel-1",
      path: "assets/storyboards/panel-1.png",
      consistencyScore: 0.58,
    },
    {
      id: "panel-2",
      sceneId: "store-night",
      characterIds: ["hero", "villain"],
      assetId: "asset-panel-2",
      consistencyScore: 0.8,
    },
  ]);
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-storyboard", type: "image", metadata: {} }],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-storyboard-consistency-qa",
      "--target-asset",
      "asset-storyboard",
      "--characters",
      "storyboards/characters.json",
      "--scenes",
      "storyboards/scenes.json",
      "--panels",
      "storyboards/panels.json",
      "--out",
      "actions/storyboard-consistency-qa.json",
      "--report",
      "projections/storyboards/asset-storyboard.consistency-qa.json",
      "--min-consistency",
      "0.75",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.planned, true);
  assert.equal(payload.verdict, "block");
  assert.match(payload.actionPath, /actions\/storyboard-consistency-qa\.json$/);
  assert.match(payload.reportPath, /projections\/storyboards\/asset-storyboard\.consistency-qa\.json$/);
  assert.ok(existsSync(payload.actionPath));
  assert.ok(existsSync(payload.reportPath));

  const report = JSON.parse(await readFile(payload.reportPath, "utf8"));
  assert.equal(report.kind, "clash.image.storyboard-consistency-qa");
  assert.equal(report.assetPackId, "asset-storyboard");
  assert.equal(report.verdict, "block");
  assert.equal(report.checks.requiredCharacterViews.pass, false);
  assert.deepEqual(report.checks.requiredCharacterViews.missing, [
    { characterId: "hero", view: "back" },
  ]);
  assert.equal(report.checks.panelConsistency.pass, false);
  assert.deepEqual(report.checks.panelConsistency.lowScorePanels.map((panel: any) => panel.panelId), ["panel-1"]);
  assert.equal(report.checks.panelReferences.pass, false);
  assert.deepEqual(report.checks.panelReferences.unknownCharacterIds, ["villain"]);
  assert.equal(report.checks.panelAssets.pass, false);
  assert.deepEqual(report.checks.panelAssets.missingPathPanelIds, ["panel-2"]);

  const action = JSON.parse(await readFile(payload.actionPath, "utf8"));
  assert.equal(action.metadata.kind, "image.storyboard-consistency");
  assert.equal(action.metadata.panels.length, 2);
  assert.equal(action.metadata.panels[0].consistencyScore, 0.58);

  await applyProductionMetadataAction({
    cwd,
    actionPath: "actions/storyboard-consistency-qa.json",
    assetsPath: "assets/manifest.json",
  });
  const assets = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const panelAsset = assets.assets.find((asset: any) => asset.id === "asset-panel-1");
  assert.equal(panelAsset.type, "storyboard-panel");
  assert.equal(panelAsset.metadata["image.storyboard-panel"].consistencyScore, 0.58);
});

test("runs production plan-storyboard-review then applies storyboard projection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-storyboard-cli-"));
  await writeJson(join(cwd, "storyboards", "characters.json"), [
    {
      id: "hero",
      name: "便利店店员",
      referenceAssetIds: ["asset-hero-front", "asset-hero-side", "asset-hero-back"],
      requiredViews: ["front", "side", "back"],
      referenceViews: [
        {
          view: "front",
          assetId: "asset-hero-front",
          path: "assets/reference-sheets/hero-front.png",
          locked: true,
          copyOnWriteRequired: true,
        },
        {
          view: "side",
          assetId: "asset-hero-side",
          path: "assets/reference-sheets/hero-side.png",
          locked: true,
          copyOnWriteRequired: true,
        },
        {
          view: "back",
          assetId: "asset-hero-back",
          path: "assets/reference-sheets/hero-back.png",
          locked: true,
          copyOnWriteRequired: true,
        },
      ],
    },
  ]);
  await writeJson(join(cwd, "storyboards", "scenes.json"), [
    { id: "store-night", referenceAssetIds: ["asset-store"], prompt: "night convenience store aisle" },
  ]);
  await writeJson(join(cwd, "storyboards", "panels.json"), [
    {
      id: "panel-1",
      sceneId: "store-night",
      characterIds: ["hero"],
      assetId: "asset-panel-1",
      path: "assets/storyboards/panel-1.png",
      consistencyScore: 0.86,
    },
  ]);
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [{ id: "asset-storyboard", type: "image", metadata: {} }],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "plan-storyboard-review",
      "--target-asset",
      "asset-storyboard",
      "--characters",
      "storyboards/characters.json",
      "--scenes",
      "storyboards/scenes.json",
      "--panels",
      "storyboards/panels.json",
      "--out",
      "actions/storyboard-review.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.characters, 1);
  assert.match(payload.actionPath, /actions\/storyboard-review\.json$/);
  await applyProductionMetadataAction({
    cwd,
    actionPath: "actions/storyboard-review.json",
    assetsPath: "assets/manifest.json",
  });
  const storyboard = JSON.parse(
    await readFile(join(cwd, "projections", "storyboards", "asset-storyboard.storyboard.json"), "utf8"),
  );
  assert.deepEqual(storyboard.characters[0].requiredViews, ["front", "side", "back"]);
  assert.deepEqual(storyboard.characters[0].referenceViews, [
    {
      view: "front",
      assetId: "asset-hero-front",
      path: "assets/reference-sheets/hero-front.png",
      locked: true,
      copyOnWriteRequired: true,
    },
    {
      view: "side",
      assetId: "asset-hero-side",
      path: "assets/reference-sheets/hero-side.png",
      locked: true,
      copyOnWriteRequired: true,
    },
    {
      view: "back",
      assetId: "asset-hero-back",
      path: "assets/reference-sheets/hero-back.png",
      locked: true,
      copyOnWriteRequired: true,
    },
  ]);
  assert.equal(storyboard.panels[0].assetId, "asset-panel-1");
  assert.equal(storyboard.panels[0].path, "assets/storyboards/panel-1.png");
  const assets = JSON.parse(await readFile(join(cwd, "assets", "manifest.json"), "utf8"));
  const panelAsset = assets.assets.find((asset: any) => asset.id === "asset-panel-1");
  assert.equal(panelAsset.type, "storyboard-panel");
  assert.equal(panelAsset.path, "assets/storyboards/panel-1.png");
  const frontReferenceAsset = assets.assets.find((asset: any) => asset.id === "asset-hero-front");
  assert.equal(frontReferenceAsset.type, "character-reference-sheet");
  assert.equal(frontReferenceAsset.path, "assets/reference-sheets/hero-front.png");
  assert.deepEqual(frontReferenceAsset.metadata["image.character-reference-sheet"], {
    storyboardAssetId: "asset-storyboard",
    characterId: "hero",
    view: "front",
    path: "assets/reference-sheets/hero-front.png",
    locked: true,
    copyOnWriteRequired: true,
    downstreamUsage: "identity-reference",
  });
});

test("projects and applies storyboard prompt packs with CAS stale-write protection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-storyboard-prompt-pack-cli-"));
  await writeJson(join(cwd, "actions", "storyboard-review.json"), {
    actionId: "action-storyboard-fill",
    targetAssetId: "asset-storyboard",
    metadataKind: "image.storyboard-consistency",
    producer: "qa-fixture",
    metadata: {
      kind: "image.storyboard-consistency",
      characters: [
        {
          id: "hero",
          name: "便利店店员",
          referenceAssetIds: ["asset-hero-front", "asset-hero-side", "asset-hero-back"],
          requiredViews: ["front", "side", "back"],
        },
      ],
      scenes: [
        { id: "store-night", referenceAssetIds: ["asset-store"], prompt: "night convenience store aisle" },
      ],
      panels: [
        {
          id: "panel-1",
          sceneId: "store-night",
          characterIds: ["hero"],
          assetId: "asset-panel-1",
        },
      ],
    },
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const project = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-storyboard-prompt-pack",
      "--action",
      "actions/storyboard-review.json",
      "--style",
      "vertical short drama, cinematic light",
      "--negative",
      "logo drift, extra fingers",
      "--out",
      "plans/prompt-pack.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(project.status, 0, project.stderr);
  const projected = JSON.parse(project.stdout);
  assert.equal(projected.projected, true);
  assert.equal(projected.storyboardAssetId, "asset-storyboard");
  assert.equal(projected.prompts, 1);
  assert.match(projected.promptPackPath, /plans\/prompt-pack\.json$/);
  assert.match(projected.lockPath, /plans\/prompt-pack\.lock\.json$/);
  assert.match(projected.manifestPath, /projections\/storyboards\/asset-storyboard\.prompt-pack-manifest\.json$/);
  assert.ok(existsSync(projected.promptPackPath));
  assert.ok(existsSync(projected.lockPath));

  const promptPack = JSON.parse(await readFile(projected.promptPackPath, "utf8"));
  assert.equal(promptPack.kind, "clash.storyboard.prompt-pack");
  const lock = JSON.parse(await readFile(projected.lockPath, "utf8"));
  assert.equal(lock.kind, "clash.storyboard.prompt-pack.lock");
  assert.equal(lock.projectionKind, "storyboard-prompt-pack");
  assert.deepEqual(lock.entity, { kind: "storyboard-asset", id: "asset-storyboard" });
  assert.equal(lock.contentHash, lock.promptPackHash);
  assert.match(lock.contentHash, /^[a-f0-9]{16}$/);
  promptPack.prompts[0].prompt += "; close-up emotional hook";
  await writeJson(projected.promptPackPath, promptPack);
  await writeJson(join(cwd, "plans", "other-prompt-pack.json"), promptPack);

  const mismatchedFile = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "apply-storyboard-prompt-pack",
      "--file",
      "plans/other-prompt-pack.json",
      "--lock",
      "plans/prompt-pack.lock.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(mismatchedFile.status, 1);
  assert.match(mismatchedFile.stderr, /Projection file path does not match storyboard prompt-pack CAS lock/);

  const tamperedLock = {
    ...lock,
    entity: { kind: "storyboard-asset", id: "other-storyboard" },
  };
  await writeJson(join(cwd, "plans", "tampered-prompt-pack.lock.json"), tamperedLock);
  const mismatchedEntity = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "apply-storyboard-prompt-pack",
      "--file",
      "plans/prompt-pack.json",
      "--lock",
      "plans/tampered-prompt-pack.lock.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(mismatchedEntity.status, 1);
  assert.match(mismatchedEntity.stderr, /Invalid storyboard prompt-pack lock file/);

  const apply = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "apply-storyboard-prompt-pack",
      "--file",
      "plans/prompt-pack.json",
      "--lock",
      "plans/prompt-pack.lock.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(apply.status, 0, apply.stderr);
  const applied = JSON.parse(apply.stdout);
  assert.equal(applied.applied, true);
  assert.match(applied.projectionPath, /projections\/storyboards\/asset-storyboard\.prompt-pack\.json$/);
  const projection = JSON.parse(await readFile(applied.projectionPath, "utf8"));
  assert.equal(projection.kind, "clash.storyboard.prompt-pack.projection");
  assert.match(projection.promptPack.prompts[0].prompt, /close-up emotional hook/);
  assert.deepEqual(projection.casApply, {
    target: "storyboard-prompt-pack",
    mutation: "managed-projection",
    applyCommand: "clash production apply-storyboard-prompt-pack",
    filePath: "plans/prompt-pack.json",
    lockPath: "plans/prompt-pack.lock.json",
    lockRequired: true,
  });

  const stale = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "apply-storyboard-prompt-pack",
      "--file",
      "plans/prompt-pack.json",
      "--lock",
      "plans/prompt-pack.lock.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /Stale storyboard prompt-pack apply rejected/);

  const reproject = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-storyboard-prompt-pack",
      "--action",
      "actions/storyboard-review.json",
      "--out",
      "plans/prompt-pack.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(reproject.status, 0, reproject.stderr);
  const freshPromptPack = JSON.parse(await readFile(join(cwd, "plans", "prompt-pack.json"), "utf8"));
  freshPromptPack.prompts[0].prompt += "; alternate tense close-up";
  await writeJson(join(cwd, "plans", "prompt-pack.json"), freshPromptPack);

  const replace = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "replace-storyboard-prompt-pack",
      "--file",
      "plans/prompt-pack.json",
      "--lock",
      "plans/prompt-pack.lock.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(replace.status, 0, replace.stderr);
  const replaced = JSON.parse(replace.stdout);
  assert.equal(replaced.replaced, true);
  assert.equal(replaced.copyOnWrite, true);
  assert.equal(replaced.storyboardAssetId, "asset-storyboard");
  assert.match(replaced.projectionPath, /projections\/storyboards\/asset-storyboard\.prompt-pack\.[a-f0-9]{16}\.cow\.json$/);
  assert.ok(existsSync(replaced.projectionPath));
  const replacement = JSON.parse(await readFile(replaced.projectionPath, "utf8"));
  assert.equal(replacement.kind, "clash.storyboard.prompt-pack.replacement");
  assert.equal(replacement.copyOnWrite, true);
  assert.equal(replacement.copyOnWriteKind, "storyboard-prompt-pack-replacement");
  assert.equal(replacement.sourcePromptPackHash, replaced.sourcePromptPackHash);
  assert.equal(replacement.promptPackHash, replaced.promptPackHash);
  assert.match(replacement.promptPack.prompts[0].prompt, /alternate tense close-up/);
  const managedAfterReplace = JSON.parse(await readFile(applied.projectionPath, "utf8"));
  assert.doesNotMatch(managedAfterReplace.promptPack.prompts[0].prompt, /alternate tense close-up/);

  const overwriteManaged = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "apply-storyboard-prompt-pack",
      "--file",
      "plans/prompt-pack.json",
      "--force",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(overwriteManaged.status, 0, overwriteManaged.stderr);

  const staleReplace = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "replace-storyboard-prompt-pack",
      "--file",
      "plans/prompt-pack.json",
      "--lock",
      "plans/prompt-pack.lock.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(staleReplace.status, 1);
  assert.match(staleReplace.stderr, /Stale storyboard prompt-pack replace rejected/);
});

test("rejects symlinked storyboard prompt-pack lock sidecars that resolve outside cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-storyboard-lock-"));
  await writeJson(join(cwd, "actions", "storyboard-review.json"), {
    actionId: "action-storyboard-fill",
    targetAssetId: "asset-storyboard",
    metadataKind: "image.storyboard-consistency",
    producer: "qa-fixture",
    metadata: {
      kind: "image.storyboard-consistency",
      characters: [
        {
          id: "hero",
          name: "便利店店员",
          referenceAssetIds: ["asset-hero-front"],
          requiredViews: ["front"],
        },
      ],
      scenes: [{ id: "store-night", referenceAssetIds: ["asset-store"], prompt: "night convenience store aisle" }],
      panels: [{ id: "panel-1", sceneId: "store-night", characterIds: ["hero"], assetId: "asset-panel-1" }],
    },
  });
  const outside = join(cwd, "..", "outside-storyboard-lock");
  await mkdir(outside, { recursive: true });
  await mkdir(join(cwd, "plans"), { recursive: true });
  await writeFile(join(outside, "prompt-pack.lock.json"), "{}\n", "utf8");
  await symlink(join(outside, "prompt-pack.lock.json"), join(cwd, "plans", "prompt-pack.lock.json"));

  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const project = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-storyboard-prompt-pack",
      "--action",
      "actions/storyboard-review.json",
      "--out",
      "plans/prompt-pack.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(project.status, 1);
  assert.match(project.stderr, /Projection lock sidecar path must not traverse a symlink outside the current project cwd/);
});

test("storyboard prompt-pack apply rejects when the source action changed after projection", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-storyboard-prompt-pack-source-cas-"));
  const actionPath = join(cwd, "actions", "storyboard-review.json");
  await writeJson(actionPath, {
    actionId: "action-storyboard-fill",
    targetAssetId: "asset-storyboard",
    metadataKind: "image.storyboard-consistency",
    producer: "qa-fixture",
    metadata: {
      kind: "image.storyboard-consistency",
      characters: [],
      scenes: [{ id: "store-night", referenceAssetIds: ["asset-store"], prompt: "night convenience store aisle" }],
      panels: [{ id: "panel-1", sceneId: "store-night", characterIds: [], assetId: "asset-panel-1" }],
    },
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const project = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-storyboard-prompt-pack",
      "--action",
      "actions/storyboard-review.json",
      "--out",
      "plans/prompt-pack.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(project.status, 0, project.stderr);
  const projected = JSON.parse(project.stdout);
  const lock = JSON.parse(await readFile(projected.lockPath, "utf8"));
  assert.match(lock.sourceActionHash, /^[a-f0-9]{16}$/);

  const changedAction = JSON.parse(await readFile(actionPath, "utf8"));
  changedAction.metadata.panels.push({
    id: "panel-2",
    sceneId: "store-night",
    characterIds: [],
    assetId: "asset-panel-2",
  });
  await writeJson(actionPath, changedAction);

  const apply = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "apply-storyboard-prompt-pack",
      "--file",
      "plans/prompt-pack.json",
      "--lock",
      "plans/prompt-pack.lock.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(apply.status, 1);
  assert.match(apply.stderr, /Stale storyboard prompt-pack source action rejected/);
});

test("storyboard prompt-pack apply rejects locks with stripped source action proof", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-storyboard-prompt-pack-tampered-lock-"));
  const actionPath = join(cwd, "actions", "storyboard-review.json");
  await writeJson(actionPath, {
    actionId: "action-storyboard-fill",
    targetAssetId: "asset-storyboard",
    metadataKind: "image.storyboard-consistency",
    producer: "qa-fixture",
    metadata: {
      kind: "image.storyboard-consistency",
      characters: [],
      scenes: [{ id: "store-night", referenceAssetIds: ["asset-store"], prompt: "night convenience store aisle" }],
      panels: [{ id: "panel-1", sceneId: "store-night", characterIds: [], assetId: "asset-panel-1" }],
    },
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const project = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-storyboard-prompt-pack",
      "--action",
      "actions/storyboard-review.json",
      "--out",
      "plans/prompt-pack.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(project.status, 0, project.stderr);
  const projected = JSON.parse(project.stdout);

  const lock = JSON.parse(await readFile(projected.lockPath, "utf8"));
  delete lock.sourceActionPath;
  delete lock.sourceActionHash;
  await writeJson(projected.lockPath, lock);

  const changedAction = JSON.parse(await readFile(actionPath, "utf8"));
  changedAction.metadata.panels.push({
    id: "panel-2",
    sceneId: "store-night",
    characterIds: [],
    assetId: "asset-panel-2",
  });
  await writeJson(actionPath, changedAction);

  const apply = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "apply-storyboard-prompt-pack",
      "--file",
      "plans/prompt-pack.json",
      "--lock",
      "plans/prompt-pack.lock.json",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(apply.status, 1);
  assert.match(apply.stderr, /Invalid storyboard prompt-pack lock file/);
});

test("projects storyboard panel assets into a CAS-required timeline view", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-storyboard-timeline-cli-"));
  await writeJson(join(cwd, "actions", "storyboard-review.json"), {
    actionId: "action-storyboard-fill",
    targetAssetId: "asset-storyboard",
    metadataKind: "image.storyboard-consistency",
    producer: "qa-fixture",
    metadata: {
      kind: "image.storyboard-consistency",
      characters: [
        {
          id: "hero",
          name: "便利店店员",
          referenceAssetIds: ["asset-hero-front", "asset-hero-side", "asset-hero-back"],
          requiredViews: ["front", "side", "back"],
        },
      ],
      scenes: [
        { id: "store-night", referenceAssetIds: ["asset-store"], prompt: "night convenience store aisle" },
      ],
      panels: [
        {
          id: "panel-1",
          sceneId: "store-night",
          characterIds: ["hero"],
          assetId: "asset-panel-1",
          path: "assets/storyboards/panel-1.png",
          consistencyScore: 0.86,
        },
        {
          id: "panel-2",
          sceneId: "store-night",
          characterIds: ["hero"],
          assetId: "asset-panel-2",
          path: "assets/storyboards/panel-2.png",
          consistencyScore: 0.9,
        },
      ],
    },
  });
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      { id: "asset-storyboard", type: "storyboard", metadata: {} },
      { id: "asset-panel-1", type: "storyboard-panel", path: "assets/storyboards/panel-1.png", metadata: {} },
      { id: "asset-panel-2", type: "storyboard-panel", path: "assets/storyboards/panel-2.png", metadata: {} },
    ],
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-storyboard-timeline",
      "--action",
      "actions/storyboard-review.json",
      "--duration-per-panel",
      "45",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.projected, true);
  assert.equal(payload.storyboardAssetId, "asset-storyboard");
  assert.equal(payload.panels, 2);
  assert.match(payload.timelineProjectionPath, /projections\/timelines\/asset-storyboard\.storyboard\.timeline\.yaml$/);
  assert.match(payload.manifestPath, /projections\/timelines\/asset-storyboard\.storyboard\.timeline-manifest\.json$/);
  assert.match(payload.timelineLockPath, /timelines\/main\.timeline\.lock\.json$/);
  assert.ok(existsSync(payload.timelineProjectionPath));
  assert.ok(existsSync(payload.manifestPath));
  assert.equal(existsSync(payload.timelineLockPath), false, "storyboard projection command must not mint a fake CAS lock");

  const parsedTimeline = timelineDslFromYaml(await readFile(payload.timelineProjectionPath, "utf8"));
  assert.equal(parsedTimeline.ok, true);
  if (!parsedTimeline.ok) return;
  assert.equal(parsedTimeline.dsl.durationInFrames, 90);
  assert.equal(parsedTimeline.dsl.tracks[0].role, "primary-video");
  assert.deepEqual(parsedTimeline.dsl.tracks[0].items.map((item: any) => [
    item.id,
    item.type,
    item.assetId,
    item.src,
    item.from,
    item.durationInFrames,
    item.storyboardPanelId,
    item.sceneId,
  ]), [
    ["storyboard-panel-1", "image", "asset-panel-1", "assets/storyboards/panel-1.png", 0, 45, "panel-1", "store-night"],
    ["storyboard-panel-2", "image", "asset-panel-2", "assets/storyboards/panel-2.png", 45, 45, "panel-2", "store-night"],
  ]);

  const manifest = JSON.parse(await readFile(payload.manifestPath, "utf8"));
  assert.equal(manifest.kind, "clash.storyboard.timeline-projection");
  assert.deepEqual(
    manifest.casApply,
    expectedTimelineCasApply("projections/timelines/asset-storyboard.storyboard.timeline.yaml"),
  );
  assert.deepEqual(manifest.panels.map((panel: any) => [
    panel.panelId,
    panel.assetId,
    panel.from,
    panel.durationInFrames,
  ]), [
    ["panel-1", "asset-panel-1", 0, 45],
    ["panel-2", "asset-panel-2", 45, 45],
  ]);

  const parsedForApply = parseTimelineFileForApply(await readFile(payload.timelineProjectionPath, "utf8"));
  assert.equal(parsedForApply.ok, true);
  if (!parsedForApply.ok) return;
  const cas = assertTimelineCas({
    projectId: "project-1",
    nodeId: "editor-1",
    lock: null,
    currentDsl: parsedForApply.dsl,
    force: false,
  });
  assert.equal(cas.ok, false);
  if (cas.ok) return;
  assert.match(cas.error, /Missing timeline CAS lock/);
});

test("runs production verify-storyboard-timeline and blocks low-consistency panels", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-storyboard-timeline-verify-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      { id: "asset-storyboard", type: "storyboard", metadata: {} },
      { id: "asset-panel-1", type: "storyboard-panel", path: "assets/storyboards/panel-1.png", metadata: {} },
      { id: "asset-panel-2", type: "storyboard-panel", path: "assets/storyboards/panel-2.png", metadata: {} },
    ],
  });
  await writeJson(join(cwd, "actions", "storyboard-review.json"), {
    actionId: "action-storyboard-fill",
    targetAssetId: "asset-storyboard",
    metadataKind: "image.storyboard-consistency",
    producer: "qa-fixture",
    metadata: {
      kind: "image.storyboard-consistency",
      characters: [
        {
          id: "hero",
          name: "便利店店员",
          referenceAssetIds: ["asset-hero-front", "asset-hero-side", "asset-hero-back"],
          requiredViews: ["front", "side", "back"],
        },
      ],
      scenes: [
        { id: "store-night", referenceAssetIds: ["asset-store"], prompt: "night convenience store aisle" },
      ],
      panels: [
        {
          id: "panel-1",
          sceneId: "store-night",
          characterIds: ["hero"],
          assetId: "asset-panel-1",
          path: "assets/storyboards/panel-1.png",
          consistencyScore: 0.86,
        },
        {
          id: "panel-2",
          sceneId: "store-night",
          characterIds: ["hero"],
          assetId: "asset-panel-2",
          path: "assets/storyboards/panel-2.png",
          consistencyScore: 0.9,
        },
      ],
    },
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const project = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-storyboard-timeline",
      "--action",
      "actions/storyboard-review.json",
      "--duration-per-panel",
      "45",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.equal(project.status, 0, project.stderr);

  const runVerify = (action: string, manifest: string, out: string) => spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "verify-storyboard-timeline",
      "--action",
      action,
      "--manifest",
      manifest,
      "--min-consistency",
      "0.8",
      "--out",
      out,
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  const pass = runVerify(
    "actions/storyboard-review.json",
    "projections/timelines/asset-storyboard.storyboard.timeline-manifest.json",
    "qa/storyboards/asset-storyboard.timeline-verification.json",
  );
  assert.equal(pass.status, 0, pass.stderr);
  const passPayload = JSON.parse(pass.stdout);
  assert.equal(passPayload.status, "pass");
  assert.equal(passPayload.storyboardAssetId, "asset-storyboard");
  assert.equal(passPayload.panels, 2);
  assert.equal(passPayload.timelineItems, 2);
  assert.equal(passPayload.lowConsistencyPanels, 0);
  const passReport = JSON.parse(await readFile(passPayload.reportPath, "utf8"));
  assert.equal(passReport.kind, "clash.storyboard.timeline-verification");
  assert.deepEqual(passReport.blockedReasons, []);
  assert.deepEqual(
    passReport.checks.map((check: any) => [check.id, check.status]),
    [
      ["action.storyboard-metadata-present", "pass"],
      ["manifest.cas-fresh-pull", "pass"],
      ["manifest.panels-covered", "pass"],
      ["manifest.timeline-items-covered", "pass"],
      ["panels.consistency-threshold", "pass"],
      ["panels.assets-local", "pass"],
    ],
  );

  await writeJson(join(cwd, "actions", "storyboard-low.json"), {
    actionId: "action-storyboard-low",
    targetAssetId: "asset-storyboard-low",
    metadataKind: "image.storyboard-consistency",
    producer: "qa-fixture",
    metadata: {
      kind: "image.storyboard-consistency",
      characters: [],
      scenes: [{ id: "store-night", referenceAssetIds: [], prompt: "night convenience store aisle" }],
      panels: [
        {
          id: "panel-low",
          sceneId: "store-night",
          characterIds: [],
          assetId: "asset-panel-1",
          path: "assets/storyboards/panel-1.png",
          consistencyScore: 0.42,
        },
      ],
    },
  });
  await writeJson(join(cwd, "projections", "timelines", "asset-storyboard-low.storyboard.timeline-manifest.json"), {
    schemaVersion: 1,
    kind: "clash.storyboard.timeline-projection",
    storyboardAssetId: "asset-storyboard-low",
    sourceActionPath: "actions/storyboard-low.json",
    durationPerPanel: 45,
    panels: [
      {
        panelId: "panel-low",
        sceneId: "store-night",
        characterIds: [],
        assetId: "asset-panel-1",
        path: "assets/storyboards/panel-1.png",
        from: 0,
        durationInFrames: 45,
        consistencyScore: 0.42,
      },
    ],
    timelineItems: [
      {
        id: "storyboard-panel-low",
        type: "image",
        from: 0,
        durationInFrames: 45,
        assetId: "asset-panel-1",
        src: "assets/storyboards/panel-1.png",
        storyboardPanelId: "panel-low",
        sceneId: "store-night",
        characterIds: [],
        consistencyScore: 0.42,
      },
    ],
    casApply: expectedTimelineCasApply("projections/timelines/asset-storyboard-low.storyboard.timeline.yaml"),
  });
  const blocked = runVerify(
    "actions/storyboard-low.json",
    "projections/timelines/asset-storyboard-low.storyboard.timeline-manifest.json",
    "qa/storyboards/asset-storyboard-low.timeline-verification.json",
  );
  assert.equal(blocked.status, 0, blocked.stderr);
  const blockedPayload = JSON.parse(blocked.stdout);
  assert.equal(blockedPayload.status, "blocked");
  assert.equal(blockedPayload.lowConsistencyPanels, 1);
  assert.ok(blockedPayload.blockedReasons.some((reason: string) => reason.includes("panel-low")));
});

test("rejects storyboard timeline projection when panel assets are not registered", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "clash-production-storyboard-timeline-missing-asset-"));
  await writeJson(join(cwd, "assets", "manifest.json"), {
    assets: [
      { id: "asset-storyboard", type: "storyboard", metadata: {} },
    ],
  });
  await writeJson(join(cwd, "actions", "storyboard-review.json"), {
    actionId: "action-storyboard-fill",
    targetAssetId: "asset-storyboard",
    metadataKind: "image.storyboard-consistency",
    producer: "qa-fixture",
    metadata: {
      kind: "image.storyboard-consistency",
      characters: [],
      scenes: [
        { id: "store-night", referenceAssetIds: [], prompt: "night convenience store aisle" },
      ],
      panels: [
        {
          id: "panel-1",
          sceneId: "store-night",
          characterIds: [],
          assetId: "asset-panel-1",
          path: "assets/storyboards/panel-1.png",
        },
      ],
    },
  });
  const cliEntry = new URL("../index.ts", import.meta.url);
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");

  const child = spawnSync(
    process.execPath,
    [
      "--import",
      tsxLoader,
      cliEntry.pathname,
      "production",
      "project-storyboard-timeline",
      "--action",
      "actions/storyboard-review.json",
      "--duration-per-panel",
      "45",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(child.status, 1);
  assert.match(child.stderr, /Storyboard panel asset asset-panel-1 is not registered in assets\/manifest\.json/i);
  assert.equal(existsSync(join(cwd, "projections", "timelines", "asset-storyboard.storyboard.timeline.yaml")), false);
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8").catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    const { mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
  });
}

async function writeBinary(path: string, value: Buffer): Promise<void> {
  await writeFile(path, value).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    const { mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, value);
  });
}

function makePpm(width: number, height: number, colors: string[]): Buffer {
  assert.equal(colors.length, width * height);
  const header = `P3\n${width} ${height}\n255\n`;
  const body = colors
    .map((color) => {
      const match = color.match(/^#([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i);
      assert.ok(match, `invalid fixture color ${color}`);
      return [
        Number.parseInt(match[1], 16),
        Number.parseInt(match[2], 16),
        Number.parseInt(match[3], 16),
      ].join(" ");
    })
    .join("\n");
  return Buffer.from(`${header}${body}\n`, "utf8");
}

async function makeTalkingHeadFixture(path: string, ffmpeg: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  const child = spawnSync(
    ffmpeg,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=30:duration=2.4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=2.4",
      "-shortest",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      path,
    ],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
}

async function makeAdVisualFixture(path: string, ffmpeg: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  const child = spawnSync(
    ffmpeg,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0xf04a2a:s=16x16:r=1:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x112233:s=16x16:r=1:d=2",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0,format=rgb24[v]",
      "-map",
      "[v]",
      "-c:v",
      "ffv1",
      path,
    ],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
}

function resolveExecutable(name: "ffmpeg" | "ffprobe"): string | undefined {
  const candidates = [
    join("/opt/homebrew/bin", name),
    join("/usr/local/bin", name),
    join("/usr/bin", name),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const resolved = spawnSync("command", ["-v", name], { shell: true, encoding: "utf8" });
  const path = resolved.stdout.trim();
  return resolved.status === 0 && path ? path : undefined;
}

function makeClickTrackWav(options: {
  sampleRate: number;
  durationSeconds: number;
  clickSeconds: number[];
}): Buffer {
  return makeVariableClickTrackWav({
    sampleRate: options.sampleRate,
    durationSeconds: options.durationSeconds,
    clicks: options.clickSeconds.map((second) => ({ second, gain: 1 })),
  });
}

function makeVariableClickTrackWav(options: {
  sampleRate: number;
  durationSeconds: number;
  clicks: Array<{ second: number; gain: number }>;
}): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = Math.ceil(options.sampleRate * options.durationSeconds);
  const dataSize = sampleCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(options.sampleRate, 24);
  buffer.writeUInt32LE(options.sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  const pulseSamples = Math.max(1, Math.round(options.sampleRate * 0.01));
  for (const click of options.clicks) {
    const startSample = Math.round(click.second * options.sampleRate);
    for (let i = 0; i < pulseSamples && startSample + i < sampleCount; i++) {
      const gain = 1 - i / pulseSamples;
      const sample = Math.round(28000 * Math.max(0, Math.min(1, click.gain)) * gain);
      buffer.writeInt16LE(sample, 44 + (startSample + i) * bytesPerSample);
    }
  }
  return buffer;
}
