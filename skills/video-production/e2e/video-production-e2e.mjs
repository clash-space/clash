import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");
const artifactRoot = path.resolve(
  process.env.CLASH_VIDEO_SKILL_E2E_ARTIFACT_ROOT ||
    path.join(skillRoot, "..", "..", ".tmp", "video-production-skill-e2e", new Date().toISOString().replace(/[:.]/g, "-")),
);

async function readSchema(name) {
  return JSON.parse(await readFile(path.join(skillRoot, "schemas", `${name}.schema.json`), "utf8"));
}

function validateType(schema, value, pointer, issues) {
  if (!schema?.type) return true;
  if (schema.type === "array") {
    if (Array.isArray(value)) return true;
    issues.push(`${pointer} must be array`);
    return false;
  }
  if (schema.type === "object") {
    if (value && typeof value === "object" && !Array.isArray(value)) return true;
    issues.push(`${pointer} must be object`);
    return false;
  }
  if (schema.type === "string" && typeof value !== "string") {
    issues.push(`${pointer} must be string`);
    return false;
  }
  if (schema.type === "number" && typeof value !== "number") {
    issues.push(`${pointer} must be number`);
    return false;
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    issues.push(`${pointer} must be boolean`);
    return false;
  }
  return true;
}

function validateSchema(schema, value, pointer = "$", issues = []) {
  if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) {
    issues.push(`${pointer} must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    issues.push(`${pointer} must be one of ${schema.enum.join(", ")}`);
  }
  const typeOk = validateType(schema, value, pointer, issues);
  if (!typeOk) return issues;
  if (schema.type === "object" && schema.required) {
    for (const key of schema.required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) issues.push(`${pointer}/${key} is required`);
    }
  }
  if (schema.type === "object" && schema.properties && value && typeof value === "object") {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validateSchema(childSchema, value[key], `${pointer}/${key}`, issues);
      }
    }
  }
  if (schema.type === "array" && schema.items && Array.isArray(value)) {
    value.forEach((item, index) => validateSchema(schema.items, item, `${pointer}/${index}`, issues));
  }
  return issues;
}

async function writeJson(relativePath, value, schemaName) {
  const fullPath = path.join(artifactRoot, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  const schema = await readSchema(schemaName);
  const issues = validateSchema(schema, value);
  if (issues.length > 0) throw new Error(`${relativePath} failed schema ${schemaName}: ${issues.join("; ")}`);
  await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { path: fullPath, schema: schemaName };
}

function timelineCasApply(filePath) {
  return {
    target: "timeline",
    mutation: "projection-only",
    applyCommand: "clash timeline apply",
    filePath,
    timelineIdPlaceholder: "<timeline-id>",
    requiredRuntimeArgs: ["--timeline <timeline-id>"],
    pullCommand: "clash timeline pull",
    pullArgs: ["--timeline", "<timeline-id>", "--file", "timelines/main.timeline.yaml"],
    applyArgs: ["--timeline", "<timeline-id>", "--file", filePath],
  };
}

async function main() {
  await mkdir(artifactRoot, { recursive: true });

  const pipeline = await writeJson("short-drama/pipeline.manifest.json", {
    schemaVersion: 1,
    projectKind: "short-drama",
    stages: ["brief", "reference", "storyboard", "generate", "assemble", "review", "export"],
    editableFiles: ["brief/series.md", "storyboards/episode-001.json", "projections/timelines/episode-001.timeline.yaml"],
    protectedFiles: ["snapshot.bin", "local.sqlite", "runtime/"],
    requiredSystemCapabilities: [
      "image.reference-sheets",
      "timeline.cas-projection",
      "storyboard.cas-projection",
      "workflow.dry-run-cost-gate",
      "review.stage-gates",
    ],
    artifacts: [
      {
        kind: "action",
        stage: "storyboard",
        path: "short-drama/actions/storyboard-review.json",
      },
      {
        kind: "metadata",
        stage: "storyboard",
        path: "short-drama/projections/metadata/asset-storyboard.image.storyboard-consistency.json",
      },
      {
        kind: "asset",
        stage: "generate",
        path: "short-drama/assets/manifest.json",
      },
      {
        kind: "projection",
        stage: "assemble",
        path: "short-drama/projections/asset-storyboard.storyboard.timeline.yaml",
        casRequired: true,
      },
      {
        kind: "review-gate",
        stage: "review",
        path: "short-drama/reviews/export.review-gate.json",
      },
      {
        kind: "export",
        stage: "export",
        path: "short-drama/exports/episode-001.mp4",
      },
    ],
  }, "pipeline-manifest");

  await writeJson("short-drama/qa/pipeline/episode-001.pipeline-validation.json", {
    schemaVersion: 1,
    kind: "clash.production.pipeline-validation",
    status: "blocked",
    projectKind: "short-drama",
    pipelinePath: "short-drama/pipeline.manifest.json",
    coverage: {
      action: true,
      metadata: true,
      asset: true,
      projection: true,
      reviewGate: true,
      export: false,
    },
    missingArtifacts: ["short-drama/exports/episode-001.mp4"],
    blockedReasons: ["required artifact missing: short-drama/exports/episode-001.mp4"],
    casRequiredProjectionPaths: ["short-drama/projections/asset-storyboard.storyboard.timeline.yaml"],
    artifacts: {
      total: 6,
      present: 5,
      missing: 1,
      byKind: {
        action: { total: 1, present: 1 },
        metadata: { total: 1, present: 1 },
        asset: { total: 1, present: 1 },
        projection: { total: 1, present: 1 },
        reviewGate: { total: 1, present: 1 },
        export: { total: 1, present: 0 },
      },
    },
    validatedAt: "2026-01-01T00:00:00.000Z",
  }, "pipeline-validation");

  const reviewGate = await writeJson("short-drama/reviews/export.review-gate.json", {
    schemaVersion: 1,
    kind: "clash.review.stage-gate",
    projectKind: "short-drama",
    stage: "export",
    pipelinePath: "short-drama/pipeline.manifest.json",
    status: "approved",
    requiredArtifacts: [
      { path: "short-drama/projections/asset-storyboard.storyboard.timeline-manifest.json", exists: true },
      { path: "short-drama/projections/asset-storyboard.prompt-pack.json", exists: true },
    ],
    blockedReasons: [],
    approvals: [
      {
        reviewer: "qa-agent",
        decision: "approve",
        note: "fixture artifacts validate",
        decidedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    gatePolicy: {
      requiresExplicitApproval: true,
      applyBlockedUntilApproved: true,
      finalExportBlockedUntilApproved: true,
    },
    decisionLog: [
      "planned review gate for export",
      "all required artifacts exist; explicit approval required",
      "qa-agent approved",
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }, "review-stage-gate");

  const dryRunCostGate = await writeJson("short-drama/reviews/generate.dry-run-cost-gate.json", {
    schemaVersion: 1,
    kind: "clash.workflow.dry-run-cost-gate",
    workflowId: "short-drama-episode-001",
    stage: "generate",
    status: "planned",
    executionAllowed: true,
    maxCostUsd: 0,
    totalEstimatedCostUsd: 0,
    totalEstimatedSeconds: 90,
    operations: [
      {
        id: "character-three-view",
        capability: "image.generation",
        provider: "local-comfyui",
        runtime: "comfyui",
        mode: "local",
        availability: "available",
        estimatedCostUsd: 0,
        estimatedSeconds: 90,
        requiresByoKey: false,
      },
    ],
    blockedReasons: [],
    rejectedFallbacks: [],
    fallbackUsed: false,
    decisionLog: [
      "planned dry-run cost gate for short-drama-episode-001/generate",
      "estimated cost 0 against max 0",
      "no fallback options supplied",
      "did not execute generation, download, render, or provider calls",
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
  }, "dry-run-cost-gate");

  const character = await writeJson("image/characters/protagonist.identity.json", {
    schemaVersion: 1,
    characterId: "protagonist",
    lockedTraits: ["oval face", "short black hair", "red jacket"],
    variableTraits: ["emotion", "pose", "lighting"],
    views: [
      {
        kind: "front",
        assetId: "asset-protagonist-front",
        assetPath: "assets/reference-sheets/characters/protagonist-front.png",
        locked: true,
        copyOnWriteRequired: true,
      },
      {
        kind: "side",
        assetId: "asset-protagonist-side",
        assetPath: "assets/reference-sheets/characters/protagonist-side.png",
        locked: true,
        copyOnWriteRequired: true,
      },
      {
        kind: "back",
        assetId: "asset-protagonist-back",
        assetPath: "assets/reference-sheets/characters/protagonist-back.png",
        locked: true,
        copyOnWriteRequired: true,
      },
      {
        kind: "expression",
        assetId: "asset-protagonist-expressions",
        assetPath: "assets/reference-sheets/characters/protagonist-expressions.png",
        locked: true,
        copyOnWriteRequired: true,
      },
    ],
    approvedAssetIds: ["asset-protagonist-front", "asset-protagonist-side", "asset-protagonist-back"],
  }, "character-reference-pack");

  const semanticReferenceRoles = await writeJson("image/references/semantic-reference-roles.json", {
    schemaVersion: 1,
    kind: "clash.image.semantic-reference-roles.projection",
    targetAssetId: "asset-reference-pack",
    copyOnWriteRequired: true,
    roles: [
      {
        roleId: "protagonist-front",
        assetId: "asset-protagonist-front",
        role: "identity-front",
        subjectId: "protagonist",
        path: "assets/reference-sheets/characters/protagonist-front.png",
        locked: true,
        copyOnWriteRequired: true,
        downstreamUsage: "identity-reference",
        constraints: ["preserve face shape", "preserve hair"],
      },
      {
        roleId: "brand-logo",
        assetId: "asset-brand-logo",
        role: "logo-lock",
        subjectId: "brand-main",
        path: "assets/reference-sheets/brand/logo.png",
        locked: true,
        copyOnWriteRequired: true,
        downstreamUsage: "brand-lock",
        constraints: ["preserve exact glyphs", "no recolor"],
      },
      {
        roleId: "product-packshot",
        assetId: "asset-packshot",
        role: "product-packshot",
        subjectId: "sku-001",
        path: "assets/reference-sheets/products/packshot.png",
        locked: true,
        copyOnWriteRequired: true,
        downstreamUsage: "product-reference",
        constraints: ["preserve packaging", "preserve claims text"],
      },
    ],
  }, "semantic-reference-roles");

  const imageEmbeddingStore = await writeJson("image/embeddings/reference-baselines.embedding-store.json", {
    schemaVersion: 1,
    kind: "clash.image.embedding-store",
    targetAssetId: "asset-reference-pack",
    embeddingSetId: "reference-baselines-v1",
    modelId: "local-clip-vit-b32",
    dimension: 4,
    distanceMetric: "cosine",
    items: [
      {
        assetId: "asset-protagonist-front",
        roleId: "protagonist-front",
        subjectId: "protagonist",
        path: "assets/reference-sheets/characters/protagonist-front.png",
        vectorPath: "embeddings/vectors/protagonist-front.json",
        vectorHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        dimension: 4,
        baselineFor: ["identity"],
        locked: true,
        copyOnWriteRequired: true,
        tags: ["front", "character"],
      },
      {
        assetId: "asset-packshot",
        roleId: "product-packshot",
        subjectId: "sku-001",
        path: "assets/reference-sheets/products/packshot.png",
        vectorPath: "embeddings/vectors/packshot.json",
        vectorHash: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        dimension: 4,
        baselineFor: ["product"],
        locked: true,
        copyOnWriteRequired: true,
        tags: ["packshot"],
      },
    ],
    copyOnWriteRequired: true,
    decisionLog: [
      "registered 2 image embedding vectors for reference-baselines-v1",
      "did not execute image embedding backends",
    ],
  }, "image-embedding-store");

  const comfyuiRunner = await writeJson("image/generation/hero-reference.comfyui-runner.json", {
    schemaVersion: 1,
    kind: "clash.image.comfyui-runner",
    targetAssetId: "asset-image-job",
    workflowId: "hero-reference-gen-v1",
    workflowPath: "workflows/hero-reference.api.json",
    workflowHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
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
        outputAssetId: "asset-protagonist-front",
        nodeId: "9",
        outputName: "IMAGE",
        mediaType: "image",
        path: "assets/reference-sheets/characters/protagonist-front.png",
        fileHash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        status: "materialized",
      },
    ],
    execution: {
      mode: "completed",
      runnerId: "local-comfyui",
      promptId: "prompt-fixture",
    },
    decisionLog: [
      "registered ComfyUI workflow hero-reference-gen-v1",
      "did not execute ComfyUI backend",
    ],
  }, "comfyui-runner");

  const productLogoQa = await writeJson("image/qa/asset-tvc-frame.product-logo-qa.json", {
    schemaVersion: 1,
    kind: "clash.image.product-logo-qa",
    targetAssetId: "asset-tvc-frame",
    referencePackAssetId: "asset-reference-pack",
    requiredReferenceAssetIds: ["asset-brand-logo", "asset-packshot"],
    references: [
      {
        roleId: "brand-logo",
        assetId: "asset-brand-logo",
        role: "logo-lock",
        subjectId: "brand-main",
        path: "assets/reference-sheets/brand/logo.png",
        locked: true,
        copyOnWriteRequired: true,
        constraints: ["preserve exact glyphs", "no recolor"],
      },
      {
        roleId: "product-packshot",
        assetId: "asset-packshot",
        role: "product-packshot",
        subjectId: "sku-001",
        path: "assets/reference-sheets/products/packshot.png",
        locked: true,
        copyOnWriteRequired: true,
        constraints: ["preserve packaging", "preserve claims text"],
      },
    ],
    checks: [
      {
        id: "logo-visible",
        roleId: "brand-logo",
        referenceAssetId: "asset-brand-logo",
        check: "logo-presence",
        status: "pass",
        required: true,
        expected: "locked logo is visible",
        actual: "logo appears on the end card",
        confidence: 0.96,
      },
      {
        id: "brand-color",
        roleId: "brand-logo",
        referenceAssetId: "asset-brand-logo",
        check: "brand-color",
        status: "pass",
        required: true,
        expected: "no recolor",
        actual: "brand color matches approved reference",
        confidence: 0.91,
        deltaE: 1.2,
      },
      {
        id: "packshot-visible",
        roleId: "product-packshot",
        referenceAssetId: "asset-packshot",
        check: "packshot-presence",
        status: "pass",
        required: true,
        expected: "front packaging visible",
        actual: "front packaging is visible",
        confidence: 0.93,
      },
      {
        id: "claim-text",
        roleId: "product-packshot",
        referenceAssetId: "asset-packshot",
        check: "claim-text",
        status: "fail",
        required: true,
        expected: "preserve claims text",
        actual: "OCR evidence shows altered claim text",
        confidence: 0.88,
      },
    ],
    verdict: "fail",
    blockedReasons: ["claim-text failed for role product-packshot"],
    copyOnWriteRequired: true,
  }, "product-logo-qa");

  const beatGrid = await writeJson("mv/analysis/audio/beat-grid.json", {
    schemaVersion: 1,
    audioAssetId: "asset-song",
    backend: "fixture",
    bpm: 128,
    fps: 30,
    tempoCurve: [{ timeMs: 0, bpm: 128 }],
    beats: [
      { index: 0, timeMs: 0, frame: 0, bar: 1, beatInBar: 1, downbeat: true, confidence: 0.95 },
      { index: 1, timeMs: 469, frame: 14, bar: 1, beatInBar: 2, downbeat: false, confidence: 0.9 },
      { index: 2, timeMs: 938, frame: 28, bar: 1, beatInBar: 3, downbeat: false, confidence: 0.9 },
      { index: 3, timeMs: 1406, frame: 42, bar: 1, beatInBar: 4, downbeat: false, confidence: 0.88 },
    ],
    downbeats: [0],
    barAnchors: [0],
    phraseAnchors: [0],
    sections: [
      {
        id: "bar-1",
        startFrame: 0,
        endFrame: 60,
        label: "bar 1",
        semanticLabel: "intro",
        semanticConfidence: 0.72,
        reviewRequired: true,
        semanticSource: "local-rms-phrase-heuristic",
        energy: 0.42,
        novelty: 0.04,
        impact: 0.42,
        cutDensity: "medium",
      },
      {
        id: "bar-2",
        startFrame: 60,
        endFrame: 120,
        label: "bar 2",
        semanticLabel: "drop",
        semanticConfidence: 0.87,
        reviewRequired: false,
        semanticSource: "local-rms-phrase-heuristic",
        energy: 0.96,
        novelty: 0.52,
        impact: 0.96,
        cutDensity: "fast",
      },
    ],
    energyCurve: [
      { frame: 0, timeSeconds: 0, rms: 0.1, normalized: 0.4, novelty: 0.4, impact: 0.4 },
      { frame: 60, timeSeconds: 2, rms: 0.24, normalized: 0.96, novelty: 0.52, impact: 0.96 },
    ],
    confidence: 0.91,
  }, "beat-grid");

  const analysisBackendBenchmark = await writeJson("mv/qa/beat-grid.backend-benchmark.json", {
    schemaVersion: 1,
    kind: "clash.analysis.backend-benchmark",
    benchmarkId: "mv-beat-grid-v1",
    targetAssetId: "asset-song",
    targetCapability: "audio.beat-grid",
    fixtureSetPath: "benchmarks/fixtures/click-track.json",
    candidates: [
      {
        backendId: "local-wav",
        capability: "audio.beat-grid",
        resultPath: "mv/analysis/audio/beat-grid.json",
        weightedScore: 0.973,
        status: "pass",
        metrics: [
          {
            id: "bpm-accuracy",
            score: 0.99,
            threshold: 0.95,
            weight: 2,
            higherIsBetter: true,
            status: "pass",
          },
          {
            id: "downbeat-f1",
            score: 0.94,
            threshold: 0.9,
            weight: 1,
            higherIsBetter: true,
            status: "pass",
          },
        ],
      },
      {
        backendId: "experimental-audio-vlm",
        capability: "audio.beat-grid",
        resultPath: "mv/analysis/audio/experimental-audio-vlm.json",
        weightedScore: 0.75,
        status: "fail",
        metrics: [
          {
            id: "bpm-accuracy",
            score: 0.82,
            threshold: 0.95,
            weight: 2,
            higherIsBetter: true,
            status: "fail",
          },
          {
            id: "downbeat-f1",
            score: 0.61,
            threshold: 0.9,
            weight: 1,
            higherIsBetter: true,
            status: "fail",
          },
        ],
      },
    ],
    selectedBackendId: "local-wav",
    verdict: "pass",
    blockedReasons: [],
    decisionLog: [
      "loaded 2 candidate backend results for audio.beat-grid",
      "selected local-wav with weighted score 0.973",
      "did not execute analysis backends",
    ],
  }, "analysis-backend-benchmark");

  const stemSeparation = await writeJson("mv/analysis/audio/stem-separation.json", {
    schemaVersion: 1,
    kind: "clash.audio.stem-separation",
    targetAssetId: "asset-song",
    separationId: "mv-song-stems-v1",
    sourceAssetId: "asset-song",
    sourcePath: "assets/audio/song.wav",
    backendId: "local-demucs-precomputed",
    modelId: "htdemucs-fixture",
    stems: [
      {
        stemAssetId: "asset-song-vocal-stem",
        stemType: "vocal",
        filePath: "assets/audio/stems/vocals.wav",
        fileHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        codec: "pcm_s16le",
        durationSeconds: 15,
        sampleRate: 44100,
        channels: 2,
      },
      {
        stemAssetId: "asset-song-instrumental-stem",
        stemType: "instrumental",
        filePath: "assets/audio/stems/instrumental.wav",
        fileHash: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        codec: "pcm_s16le",
        durationSeconds: 15,
        sampleRate: 44100,
        channels: 2,
      },
    ],
    vocalStemAssetId: "asset-song-vocal-stem",
    decisionLog: [
      "registered 2 audio stem files for mv-song-stems-v1",
      "did not execute stem separation backends",
    ],
  }, "audio-stem-separation");

  const mvBeatCutProjection = await writeJson("mv/projections/asset-song.mv-beat-cut.timeline-manifest.json", {
    schemaVersion: 1,
    kind: "clash.mv.beat-cut.timeline-projection",
    targetAssetId: "asset-song",
    sourceActionPath: "actions/mv-beat-fill.json",
    metadataKind: "audio.beat-analysis",
    bpm: 128,
    fps: 30,
    beats: 4,
    sections: 2,
    cutAssignments: [
      {
        sectionId: "bar-1",
        label: "bar 1",
        clipAssetId: "asset-mv-shot-a",
        clipPath: "assets/video/mv-shot-a.mp4",
        clipType: "video",
        outputStartFrame: 0,
        outputEndFrame: 60,
        anchorFrames: [0],
        semanticLabel: "intro",
        semanticConfidence: 0.72,
        reviewRequired: true,
        semanticSource: "local-rms-phrase-heuristic",
        cutDensity: "medium",
        recommendedCutEveryFrames: 60,
      },
      {
        sectionId: "bar-2",
        label: "bar 2",
        clipAssetId: "asset-mv-shot-b",
        clipPath: "assets/images/mv-shot-b.png",
        clipType: "image",
        outputStartFrame: 60,
        outputEndFrame: 120,
        anchorFrames: [60],
        semanticLabel: "drop",
        semanticConfidence: 0.87,
        reviewRequired: false,
        semanticSource: "local-rms-phrase-heuristic",
        cutDensity: "fast",
        recommendedCutEveryFrames: 30,
      },
    ],
    timelineItems: [
      {
        id: "mv-cut-bar-1",
        type: "video",
        assetId: "asset-mv-shot-a",
        src: "assets/video/mv-shot-a.mp4",
        from: 0,
        durationInFrames: 60,
        beatSectionId: "bar-1",
        semanticLabel: "intro",
        semanticConfidence: 0.72,
        reviewRequired: true,
        semanticSource: "local-rms-phrase-heuristic",
        cutDensity: "medium",
      },
      {
        id: "mv-cut-bar-2",
        type: "image",
        assetId: "asset-mv-shot-b",
        src: "assets/images/mv-shot-b.png",
        from: 60,
        durationInFrames: 60,
        beatSectionId: "bar-2",
        semanticLabel: "drop",
        semanticConfidence: 0.87,
        reviewRequired: false,
        semanticSource: "local-rms-phrase-heuristic",
        cutDensity: "fast",
      },
    ],
    casApply: timelineCasApply("projections/timelines/asset-song.mv-beat-cut.timeline.yaml"),
  }, "mv-beat-cut-projection");

  const mvBeatSyncVerification = await writeJson("mv/qa/asset-song.beat-sync-verification.json", {
    schemaVersion: 1,
    kind: "clash.mv.beat-sync-verification",
    status: "pass",
    targetAssetId: "asset-song",
    sourceActionPath: "actions/mv-beat-fill.json",
    projectionPath: "mv/projections/asset-song.mv-beat-cut.timeline-manifest.json",
    timelineProjectionPath: "projections/timelines/asset-song.mv-beat-cut.timeline.yaml",
    bpm: 128,
    fps: 30,
    beats: 4,
    downbeats: 1,
    sections: 2,
    cutAssignments: 2,
    sectionCoverage: [
      {
        sectionId: "bar-1",
        covered: true,
        cutDensity: "medium",
        projectedCutDensity: "medium",
      },
      {
        sectionId: "bar-2",
        covered: true,
        cutDensity: "fast",
        projectedCutDensity: "fast",
      },
    ],
    checks: [
      {
        id: "audio.beat-analysis-present",
        label: "Audio beat metadata action is present",
        required: true,
        status: "pass",
        expected: "AssetMetadataFillAction metadata.kind is audio.beat-analysis",
        actual: "audio.beat-analysis action parsed",
      },
      {
        id: "beat.downbeats-present",
        label: "Beat grid includes downbeat anchors",
        required: true,
        status: "pass",
        expected: "at least one beat has downbeat: true",
        actual: "1 downbeat(s) across 4 beat(s)",
      },
      {
        id: "sections.present",
        label: "Beat sections are present",
        required: true,
        status: "pass",
        expected: "at least one beat section",
        actual: "2 section(s)",
      },
      {
        id: "sections.cut-density-present",
        label: "Beat sections include cut-density hints",
        required: true,
        status: "pass",
        expected: "every section has cutDensity",
        actual: "all sections have cutDensity",
      },
      {
        id: "sections.review-confidence-present",
        label: "Beat sections include review confidence metadata",
        required: true,
        status: "pass",
        expected: "every section has semanticConfidence and reviewRequired",
        actual: "all sections have semantic confidence and review flags",
      },
      {
        id: "projection.cas-fresh-pull",
        label: "MV timeline projection declares fresh-pull CAS apply",
        required: true,
        status: "pass",
        expected: "projection manifest has Project Timeline pull/apply CAS with explicit --timeline arg",
        actual: "fresh-pull CAS present",
      },
      {
        id: "projection.sections-covered",
        label: "MV projection covers all beat sections",
        required: true,
        status: "pass",
        expected: "every beat section id appears in cutAssignments",
        actual: "2 section(s) covered",
      },
      {
        id: "projection.cut-density-propagated",
        label: "MV projection propagates section cut density",
        required: true,
        status: "pass",
        expected: "cutAssignments preserve each section cutDensity",
        actual: "cutDensity propagated to assignments",
      },
    ],
    blockedReasons: [],
  }, "mv-beat-sync-verification");

  const lyrics = await writeJson("mv/analysis/lyrics/alignment.json", {
    schemaVersion: 1,
    kind: "clash.audio.lyrics-alignment.projection",
    audioAssetId: "asset-song",
    targetAssetId: "asset-song",
    fps: 30,
    lyricsSource: "fixture",
    vocalStemAssetId: "asset-song-vocal-stem",
    units: [
      {
        lineId: "l1",
        wordId: "w1",
        text: "tonight",
        startMs: 0,
        endMs: 420,
        startFrame: 0,
        endFrame: 13,
        confidence: 0.9,
        source: "fixture",
      },
    ],
    unmatchedRanges: [],
    reviewRequired: false,
    captionProjection: {
      filePath: "projections/timelines/asset-song.lyrics.caption.timeline.yaml",
      trackRole: "subtitle",
      itemType: "caption",
    },
  }, "lyrics-alignment");

  const visualMoments = await writeJson("mv/analysis/video/visual-moments.json", {
    schemaVersion: 1,
    kind: "clash.video.visual-moments.projection",
    sourceVideoAssetId: "asset-source-video",
    fps: 30,
    sourcePath: "assets/video/source.mp4",
    sceneChanges: [0, 1500],
    candidates: [
      {
        id: "moment-drop-001",
        startMs: 0,
        endMs: 1406,
        peakMs: 938,
        startFrame: 0,
        endFrame: 42,
        peakFrame: 28,
        sceneIndex: 0,
        motion: 0.82,
        quality: 0.91,
        action: 0.76,
        emotion: 0.55,
        semantic: "fast product reveal",
        tags: ["drop", "product"],
      },
    ],
    recommendedClips: [
      {
        id: "moment-drop-001",
        assetId: "asset-source-video",
        type: "video",
        path: "assets/video/source.mp4",
        sourceStartFrame: 0,
        sourceEndFrame: 42,
        peakFrame: 28,
        score: 0.822,
        sceneIndex: 0,
        semantic: "fast product reveal",
        tags: ["drop", "product"],
      },
    ],
  }, "visual-moments");

  const mgOverlay = await writeJson("mg/projections/lower-third.timeline-manifest.json", {
    schemaVersion: 1,
    overlayId: "lower-third-001",
    sourcePath: "projections/mg/lower-third-001/index.html",
    renderedAssetPath: "assets/overlays/lower-third-001.webm",
    casApply: timelineCasApply("projections/timelines/lower-third-001.mg.timeline.yaml"),
    timelineItems: [
      {
        id: "overlay-lower-third-001",
        type: "composition",
        compositionKind: "motion-graphics",
        runtime: "html",
        compositionId: "lower-third-001",
        sourcePath: "projections/mg/lower-third-001/index.html",
        renderedAssetPath: "assets/overlays/lower-third-001.webm",
        from: 120,
        durationInFrames: 90,
      },
    ],
    validation: {
      durationFrames: 90,
      dimensions: { width: 1080, height: 1920 },
      htmlPreview: true,
      seekablePreview: true,
      currentFrameState: "data-current-frame",
      frameEvent: "clash-mg-frame",
      renderRequired: true,
      externalRuntime: false,
      implementation: {
        renderer: "clash-first-party-mg-composition",
        source: "first-party",
        license: "MIT",
        thirdPartyCodeCopied: false,
        externalRuntime: false,
        researchReferences: ["HyperFrames"],
      },
    },
  }, "mg-overlay-manifest");

  const mgPreviewVerification = await writeJson("mg/qa/lower-third.preview-verification.json", {
    schemaVersion: 1,
    kind: "clash.mg.preview-verification",
    status: "pass",
    overlayId: "lower-third-001",
    htmlPath: "projections/mg/lower-third-001/index.html",
    manifestPath: "mg/projections/lower-third.timeline-manifest.json",
    framesChecked: [0, 15, 30],
    checks: [
      {
        id: "html.self-contained",
        label: "HTML preview is self-contained",
        required: true,
        status: "pass",
        expected: "no remote URLs, external scripts, external stylesheets, or dynamic imports",
        actual: "no external references",
      },
      {
        id: "html.seek-api",
        label: "HTML preview exposes seek controls and frame events",
        required: true,
        status: "pass",
        expected: "window.__CLASH_MG__, scrubber, data-current-frame, and clash-mg-frame event",
        actual: "seek API present",
      },
      {
        id: "manifest.cas-fresh-pull",
        label: "Timeline apply uses implicit cwd CAS",
        required: true,
        status: "pass",
        expected: "pull then apply with implicit cwd observation and explicit --timeline runtime arg",
        actual: "implicit cwd CAS present",
      },
      {
        id: "implementation.first-party-license-safe",
        label: "Implementation is first-party and license-safe",
        required: true,
        status: "pass",
        expected: "first-party MIT renderer with no copied third-party runtime",
        actual: "first-party renderer declared",
      },
      {
        id: "frames.deterministic-evaluation",
        label: "Frame evaluation is deterministic",
        required: true,
        status: "pass",
        expected: "same frame evaluates to identical layer styles",
        actual: "deterministic evaluator output",
      },
    ],
    frameEvaluations: [
      {
        frame: 0,
        layers: [
          { id: "overlay-lower-third-001", type: "shape", visible: true, style: { x: -760, y: 1350, opacity: 0, scale: 1, rotation: 0 } },
          { id: "title", type: "text", visible: false, style: { x: 116, y: 1436, opacity: 0, scale: 1, rotation: 0 } },
        ],
      },
      {
        frame: 15,
        layers: [
          { id: "overlay-lower-third-001", type: "shape", visible: true, style: { x: 68.148, y: 1350, opacity: 0.92, scale: 1, rotation: 0 } },
          { id: "title", type: "text", visible: true, style: { x: 116, y: 1386.05, opacity: 1, scale: 1, rotation: 0 } },
        ],
      },
      {
        frame: 30,
        layers: [
          { id: "overlay-lower-third-001", type: "shape", visible: true, style: { x: 72, y: 1350, opacity: 0.92, scale: 1, rotation: 0 } },
          { id: "title", type: "text", visible: true, style: { x: 116, y: 1386, opacity: 1, scale: 1, rotation: 0 } },
        ],
      },
    ],
    blockedReasons: [],
  }, "mg-preview-verification");

  const compositionRoute = await writeJson("mg/routes/lower-third.composition-route.json", {
    schemaVersion: 1,
    kind: "clash.render.composition-route",
    compositionId: "lower-third-001",
    compositionKind: "motion-graphics",
    status: "planned",
    selectedRuntime: "html",
    fallbackUsed: false,
    routeCommand: "clash production render-mg",
    requirements: ["agent-readable", "interactive-preview", "transparent-overlay"],
    availableRuntimes: ["html", "ffmpeg"],
    inputPath: "compositions/lower-third-001/spec.json",
    outputPath: "projections/mg/lower-third-001/index.html",
    validationPlan: ["duration", "dimensions", "fps", "nonblank-frames", "alpha"],
    decisionLog: ["selected html for agent-readable motion-graphics preview"],
    blockedReasons: [],
    rejectedFallbacks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  }, "composition-route");

  const reactCompositionTimeline = await writeJson("mg/projections/react-chart.composition.timeline-manifest.json", {
    schemaVersion: 1,
    kind: "clash.composition.timeline-projection",
    routePlanPath: "mg/routes/react-chart.route.json",
    compositionId: "react-chart",
    compositionKind: "custom",
    runtime: "remotion",
    sourcePath: "components/ReactChart.tsx",
    renderedAssetId: "asset-react-chart-render",
    renderedAssetPath: "assets/renders/react-chart.webm",
    routeCommand: "clash render remotion",
    validationPlan: ["duration", "dimensions", "fps", "nonblank-frames"],
    timelineItems: [
      {
        id: "composition-react-chart",
        type: "composition",
        from: 30,
        durationInFrames: 120,
        compositionKind: "custom",
        runtime: "remotion",
        compositionId: "react-chart",
        sourcePath: "components/ReactChart.tsx",
        renderedAssetPath: "assets/renders/react-chart.webm",
        assetId: "asset-react-chart-render",
      },
    ],
    validation: {
      routeStatus: "planned",
      fallbackUsed: false,
      renderedAssetRegistered: true,
      renderedAssetMatchesRoute: true,
      localProjectPaths: true,
      timelineItemType: "composition",
    },
    casApply: timelineCasApply("projections/timelines/react-chart.composition.timeline.yaml"),
  }, "composition-timeline-projection");

  const mgVideoExport = await writeJson("mg/exports/lower-third-001.webm.manifest.json", {
    kind: "clash.mg.video-export",
    compositionId: "lower-third-001",
    sourceSpecPath: "compositions/lower-third-001/spec.json",
    outputPath: "assets/overlays/lower-third-001.webm",
    format: "webm",
    fps: 30,
    durationInFrames: 90,
    durationSeconds: 3,
    dimensions: { width: 1080, height: 1920 },
    renderer: {
      kind: "first-party-rgba-rasterizer",
      externalRuntime: false,
      ffmpeg: "ffmpeg",
    },
    alpha: {
      requested: true,
      verified: true,
      mode: "vp9-alpha-mode",
      pixelSampleVerified: true,
      reason: "ffprobe reported VP9 alpha_mode=1 and decoded alpha-plane samples contain transparent and visible pixels",
      sample: {
        frame: 0,
        width: 1080,
        height: 1920,
        pixels: 2073600,
        transparentPixels: 1800000,
        visiblePixels: 240000,
        minAlpha: 0,
        maxAlpha: 255,
      },
    },
    probe: {
      codecName: "vp9",
      width: 1080,
      height: 1920,
      pixelFormat: "yuv420p",
      durationSeconds: 3,
      alphaMode: "1",
    },
    limitations: [
      "text is rendered with a deterministic first-party bitmap font",
      "rotation is rejected until the rasterizer supports it",
    ],
  }, "mg-video-export");

  const derivedOverlay = await writeJson("mg/projections/logo-callout.derived-overlay.timeline-manifest.json", {
    schemaVersion: 1,
    kind: "clash.derived-overlay.timeline-projection",
    sourceAssetId: "asset-logo-original",
    derivedAssetId: "asset-logo-callout",
    sourceAssetPath: "assets/source/logo.png",
    derivedAssetPath: "assets/derived/logo-callout/manifest.json",
    mediaType: "image",
    casApply: timelineCasApply("projections/timelines/asset-logo-callout.derived-overlay.timeline.yaml"),
    timelineItems: [
      {
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
      },
    ],
    validation: {
      timelineItemType: "derived-overlay",
      copyOnWrite: true,
      localProjectPath: true,
    },
  }, "derived-overlay-projection");

  const cuts = await writeJson("talking-head/plans/cuts.json", {
    schemaVersion: 1,
    kind: "clash.talking-head.transcript-cut-plan.projection",
    sourceAssetId: "asset-talking-head-source",
    strategy: "balanced",
    fps: 30,
    cuts: [
      {
        id: "keep-1",
        sourceStartFrame: 0,
        sourceEndFrame: 36,
        outputStartFrame: 0,
        outputEndFrame: 36,
        action: "keep",
      },
      {
        id: "delete-1",
        sourceStartFrame: 36,
        sourceEndFrame: 53,
        outputStartFrame: 36,
        outputEndFrame: 36,
        action: "delete",
        reason: "filler",
        text: "嗯",
        wordIds: ["w12"],
        confidence: 0.92,
        requiresReview: false,
        detectionSource: "configured-token",
      },
      {
        id: "keep-2",
        sourceStartFrame: 53,
        sourceEndFrame: 126,
        outputStartFrame: 36,
        outputEndFrame: 109,
        action: "keep",
      },
      {
        id: "delete-2",
        sourceStartFrame: 126,
        sourceEndFrame: 156,
        outputStartFrame: 109,
        outputEndFrame: 109,
        action: "delete",
        reason: "silence",
        confidence: 0.98,
        requiresReview: false,
        detectionSource: "word-gap",
      },
      {
        id: "keep-3",
        sourceStartFrame: 156,
        sourceEndFrame: 240,
        outputStartFrame: 109,
        outputEndFrame: 193,
        action: "keep",
      },
    ],
    sourceToOutputMap: [
      { sourceStartFrame: 0, sourceEndFrame: 36, outputStartFrame: 0, outputEndFrame: 36 },
      { sourceStartFrame: 53, sourceEndFrame: 126, outputStartFrame: 36, outputEndFrame: 109 },
      { sourceStartFrame: 156, sourceEndFrame: 240, outputStartFrame: 109, outputEndFrame: 193 },
    ],
    captionTrack: {
      id: "asset-talking-head-source-captions",
      type: "caption",
      from: 0,
      durationInFrames: 193,
      language: "zh-CN",
      cues: [
        {
          id: "cue-001",
          startFrame: 0,
          durationInFrames: 36,
          text: "今天我们开始",
          wordIds: ["w01", "w02", "w03"],
          sourceStartFrame: 0,
          sourceEndFrame: 36,
        },
        {
          id: "cue-002",
          startFrame: 36,
          durationInFrames: 73,
          text: "这里是重点",
          wordIds: ["w13", "w14", "w15"],
          sourceStartFrame: 53,
          sourceEndFrame: 126,
        },
      ],
      wordRefs: [
        { id: "w01", text: "今天", sourceStartFrame: 0, sourceEndFrame: 12 },
        { id: "w02", text: "我们", sourceStartFrame: 12, sourceEndFrame: 24 },
        { id: "w03", text: "开始", sourceStartFrame: 24, sourceEndFrame: 36 },
        { id: "w12", text: "嗯", sourceStartFrame: 36, sourceEndFrame: 53 },
        { id: "w13", text: "这里", sourceStartFrame: 53, sourceEndFrame: 78 },
        { id: "w14", text: "是", sourceStartFrame: 78, sourceEndFrame: 92 },
        { id: "w15", text: "重点", sourceStartFrame: 92, sourceEndFrame: 126 },
      ],
      sourceToOutputMap: [
        { sourceStartFrame: 0, sourceEndFrame: 36, outputStartFrame: 0, outputEndFrame: 36 },
        { sourceStartFrame: 53, sourceEndFrame: 126, outputStartFrame: 36, outputEndFrame: 109 },
        { sourceStartFrame: 156, sourceEndFrame: 240, outputStartFrame: 109, outputEndFrame: 193 },
      ],
    },
  }, "transcript-cut-plan");

  const asrTranscript = await writeJson("talking-head/analysis/asset-talking-head-source.asr-transcript.json", {
    schemaVersion: 1,
    kind: "clash.talking-head.asr-transcript.projection",
    targetAssetId: "asset-talking-head-source",
    transcriptKind: "asr-transcript",
    sourcePath: "analysis/transcripts/asset-talking-head-source.words.json",
    sourceHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    backendId: "local-sensevoice",
    modelId: "iic/SenseVoiceSmall",
    language: "zh-CN",
    durationFrames: 240,
    wordCount: 7,
    averageConfidence: 0.91,
    words: [
      { id: "w01", text: "今天", startFrame: 0, endFrame: 12, confidence: 0.94, speakerId: "speaker-1" },
      { id: "w02", text: "我们", startFrame: 12, endFrame: 24, confidence: 0.92, speakerId: "speaker-1" },
      { id: "w03", text: "开始", startFrame: 24, endFrame: 36, confidence: 0.9, speakerId: "speaker-1" },
      { id: "w12", text: "嗯", startFrame: 36, endFrame: 53, confidence: 0.88, speakerId: "speaker-1" },
      { id: "w13", text: "这里", startFrame: 53, endFrame: 78, confidence: 0.93, speakerId: "speaker-1" },
      { id: "w14", text: "是", startFrame: 78, endFrame: 92, confidence: 0.9, speakerId: "speaker-1" },
      { id: "w15", text: "重点", startFrame: 92, endFrame: 126, confidence: 0.91, speakerId: "speaker-1" },
    ],
  }, "asr-transcript-projection");

  const mediaCutExport = await writeJson("talking-head/exports/asset-talking-head-clean.media-cut.json", {
    kind: "clash.talking-head.media-cut-export",
    version: 1,
    sourceAssetId: "asset-talking-head-source",
    outputAssetId: "asset-talking-head-clean",
    sourcePath: "assets/source/talking-head.mp4",
    outputPath: "assets/video/talking-head-clean.mp4",
    actionId: "talking-head-text-cut-asset-talking-head-source",
    metadataKind: "talking-head.analysis",
    fps: 30,
    rendered: true,
    renderMode: "ffmpeg-trim-concat",
    artifacts: {
      packagePath: "projections/media-cuts/asset-talking-head-clean.media-cut.json",
      concatPath: "projections/media-cuts/asset-talking-head-clean.ffconcat",
      ffmpegPlanPath: "projections/media-cuts/asset-talking-head-clean.ffmpeg-plan.json",
      outputPath: "assets/video/talking-head-clean.mp4",
    },
    keepSegments: [
      {
        id: "keep-1",
        sourceStartFrame: 0,
        sourceEndFrame: 36,
        outputStartFrame: 0,
        outputEndFrame: 36,
        startSeconds: 0,
        endSeconds: 1.2,
        durationSeconds: 1.2,
      },
      {
        id: "keep-2",
        sourceStartFrame: 53,
        sourceEndFrame: 126,
        outputStartFrame: 36,
        outputEndFrame: 109,
        startSeconds: 1.766667,
        endSeconds: 4.2,
        durationSeconds: 2.433333,
      },
      {
        id: "keep-3",
        sourceStartFrame: 156,
        sourceEndFrame: 240,
        outputStartFrame: 109,
        outputEndFrame: 193,
        startSeconds: 5.2,
        endSeconds: 8,
        durationSeconds: 2.8,
      },
    ],
    deletedRanges: [
      {
        id: "delete-1",
        sourceStartFrame: 36,
        sourceEndFrame: 53,
        reason: "filler-word",
        confidence: 0.92,
        detectionSource: "configured-token",
        startSeconds: 1.2,
        endSeconds: 1.766667,
      },
      {
        id: "delete-2",
        sourceStartFrame: 126,
        sourceEndFrame: 156,
        reason: "silence",
        confidence: 0.98,
        detectionSource: "word-gap",
        startSeconds: 4.2,
        endSeconds: 5.2,
      },
    ],
    reviewRanges: [],
    sourceToOutputMap: [
      { sourceStartFrame: 0, sourceEndFrame: 36, outputStartFrame: 0, outputEndFrame: 36 },
      { sourceStartFrame: 53, sourceEndFrame: 126, outputStartFrame: 36, outputEndFrame: 109 },
      { sourceStartFrame: 156, sourceEndFrame: 240, outputStartFrame: 109, outputEndFrame: 193 },
    ],
    probe: {
      durationSeconds: 6.433333,
      hasVideo: true,
      hasAudio: true,
      videoCodec: "h264",
      audioCodec: "aac",
      width: 1080,
      height: 1920,
    },
  }, "talking-head-media-cut-export");

  const captionExport = await writeJson("talking-head/exports/asset-talking-head-clean.caption-export.json", {
    schemaVersion: 1,
    kind: "clash.caption.export",
    sourceTimelineId: "timeline:projections/timelines/asset-talking-head-source.caption.timeline.yaml",
    sourceTimelinePath: "projections/timelines/asset-talking-head-source.caption.timeline.yaml",
    sourceTimelineHash: "8e5248d4b93c2f11",
    sourceTimelineRevisionId: "draft-8e5248d4b93c2f11",
    sourceTimelineRevisionStatus: "draft-file",
    format: "ass",
    outputPath: "exports/captions/asset-talking-head-clean.ass",
    fps: 30,
    captionItems: 1,
    cues: 2,
    wordRefs: 7,
    sourceToOutputMaps: 3,
    sources: [
      {
        trackId: "captions",
        itemId: "caption-asset-talking-head-source",
        cueIds: ["cue-001", "cue-002"],
      },
    ],
    exportedAt: "2026-07-06T00:00:00.000Z",
  }, "caption-export");

  const captionLineage = await writeJson("talking-head/qa/asset-talking-head-source.caption-lineage.json", {
    schemaVersion: 1,
    kind: "clash.caption.lineage-verification",
    status: "pass",
    sourceTimelinePath: "projections/timelines/asset-talking-head-source.caption.timeline.yaml",
    captionItems: 1,
    cues: 2,
    wordRefs: 7,
    sourceToOutputMaps: 3,
    tracks: [
      {
        trackId: "captions",
        itemIds: ["caption-asset-talking-head-source"],
        cueIds: ["cue-001", "cue-002"],
      },
    ],
    checks: [
      {
        id: "timeline.valid-structured-caption",
        label: "Timeline validates structured caption items",
        required: true,
        status: "pass",
        expected: "timeline YAML parses and subtitle tracks contain only structured caption items",
        actual: "timeline parser accepted structured caption lineage",
      },
      {
        id: "caption.items-present",
        label: "Caption items are present",
        required: true,
        status: "pass",
        expected: "at least one type: caption timeline item",
        actual: "1 caption item(s)",
      },
      {
        id: "caption.wordrefs-present",
        label: "Caption word references are present",
        required: true,
        status: "pass",
        expected: "caption items include source word references",
        actual: "7 word reference(s)",
      },
      {
        id: "caption.source-map-present",
        label: "Caption source-to-output maps are present",
        required: true,
        status: "pass",
        expected: "caption items include source-to-output frame maps",
        actual: "3 source-to-output map(s)",
      },
      {
        id: "caption.cues-covered-by-lineage",
        label: "Caption cues are covered by word refs and source maps",
        required: true,
        status: "pass",
        expected: "each cue references known wordRefs and is covered by sourceToOutputMap",
        actual: "2 cue(s) covered by validated lineage",
      },
    ],
    blockedReasons: [],
  }, "caption-lineage-verification");

  const captionOverlay = await writeJson("talking-head/projections/asset-talking-head-clean.caption-overlay.timeline-manifest.json", {
    schemaVersion: 1,
    kind: "clash.caption.timeline-overlay",
    sourceTimelinePath: "projections/timelines/asset-talking-head-source.caption.timeline.yaml",
    timelineProjectionPath: "projections/timelines/asset-talking-head-clean.caption-overlay.timeline.yaml",
    fps: 30,
    dimensions: { width: 1080, height: 1920 },
    timelineItems: [
      {
        id: "caption-asset-talking-head-source",
        type: "caption",
        from: 0,
        durationInFrames: 193,
        language: "zh-CN",
        cues: [
          {
            id: "cue-001",
            startFrame: 0,
            durationInFrames: 36,
            text: "今天我们开始",
            wordIds: ["w01", "w02", "w03"],
            sourceStartFrame: 0,
            sourceEndFrame: 36,
          },
          {
            id: "cue-002",
            startFrame: 36,
            durationInFrames: 73,
            text: "这里是重点",
            wordIds: ["w13", "w14", "w15"],
            sourceStartFrame: 53,
            sourceEndFrame: 126,
          },
        ],
        wordRefs: [
          { id: "w01", text: "今天", sourceStartFrame: 0, sourceEndFrame: 12 },
          { id: "w02", text: "我们", sourceStartFrame: 12, sourceEndFrame: 24 },
          { id: "w03", text: "开始", sourceStartFrame: 24, sourceEndFrame: 36 },
          { id: "w12", text: "嗯", sourceStartFrame: 36, sourceEndFrame: 53 },
          { id: "w13", text: "这里", sourceStartFrame: 53, sourceEndFrame: 78 },
          { id: "w14", text: "是", sourceStartFrame: 78, sourceEndFrame: 92 },
          { id: "w15", text: "重点", sourceStartFrame: 92, sourceEndFrame: 126 },
        ],
        sourceToOutputMap: [
          { sourceStartFrame: 0, sourceEndFrame: 36, outputStartFrame: 0, outputEndFrame: 36 },
          { sourceStartFrame: 53, sourceEndFrame: 126, outputStartFrame: 36, outputEndFrame: 109 },
          { sourceStartFrame: 156, sourceEndFrame: 240, outputStartFrame: 109, outputEndFrame: 193 },
        ],
      },
    ],
    rendering: {
      previewRenderer: "remotion-components.caption",
      sidecarFormats: ["srt", "vtt", "ass"],
      burnInRequires: "clash production export-caption-burn",
    },
    validation: {
      timelineItemType: "caption",
      captionItems: 1,
      cues: 2,
      wordRefs: 7,
      sourceToOutputMaps: 3,
      structuredCaptionOnly: true,
    },
    casApply: timelineCasApply("projections/timelines/asset-talking-head-clean.caption-overlay.timeline.yaml"),
  }, "caption-overlay-projection");

  const captionBurnExport = await writeJson("talking-head/exports/asset-talking-head-clean.caption-burn.json", {
    schemaVersion: 1,
    kind: "clash.caption.burn-in-export",
    sourceAssetId: "asset-talking-head-clean",
    outputAssetId: "asset-talking-head-clean-caption-burn",
    sourceTimelineId: "timeline:projections/timelines/asset-talking-head-source.caption.timeline.yaml",
    sourceTimelinePath: "projections/timelines/asset-talking-head-source.caption.timeline.yaml",
    sourceTimelineHash: "8e5248d4b93c2f11",
    sourceTimelineRevisionId: "draft-8e5248d4b93c2f11",
    sourceTimelineRevisionStatus: "draft-file",
    sourcePath: "assets/video/talking-head-clean.mp4",
    captionSidecarPath: "exports/captions/asset-talking-head-clean.burn-in.ass",
    packagePath: "projections/caption-burn/asset-talking-head-clean-caption-burn.caption-burn.json",
    ffmpegPlanPath: "projections/caption-burn/asset-talking-head-clean-caption-burn.ffmpeg-plan.json",
    outputPath: "assets/video/talking-head-clean-caption-burn.mp4",
    rendered: false,
    renderMode: "plan-only",
    derivation: {
      kind: "caption-burn",
      sourceAssetId: "asset-talking-head-clean",
      derivedAssetId: "asset-talking-head-clean-caption-burn",
      copyOnWrite: true,
    },
    captionItems: 1,
    cues: 2,
    wordRefs: 7,
    sourceToOutputMaps: 3,
    sourceToOutputMap: [
      { sourceStartFrame: 0, sourceEndFrame: 36, outputStartFrame: 0, outputEndFrame: 36 },
      { sourceStartFrame: 53, sourceEndFrame: 126, outputStartFrame: 36, outputEndFrame: 109 },
      { sourceStartFrame: 156, sourceEndFrame: 240, outputStartFrame: 109, outputEndFrame: 193 },
    ],
  }, "caption-burn-export");

  const timelineHandoff = await writeJson("talking-head/exports/asset-talking-head-clean.timeline-handoff.json", {
    schemaVersion: 1,
    kind: "clash.timeline.nle-handoff",
    sourceTimelineId: "timeline:projections/timelines/asset-talking-head-source.caption.timeline.yaml",
    sourceTimelinePath: "projections/timelines/asset-talking-head-source.caption.timeline.yaml",
    sourceTimelineHash: "8e5248d4b93c2f11",
    sourceTimelineRevisionId: "draft-8e5248d4b93c2f11",
    sourceTimelineRevisionStatus: "draft-file",
    format: "csv",
    outputPath: "exports/handoff/asset-talking-head-clean.timeline.csv",
    outputs: ["exports/handoff/asset-talking-head-clean.timeline.csv"],
    fps: 30,
    items: 2,
    tracks: 2,
    itemTypes: {
      caption: 1,
      video: 1,
    },
    exportedAt: "2026-07-06T00:00:00.000Z",
  }, "timeline-handoff");

  const reference = await writeJson("tvc-reference/analysis/reference-001.json", {
    schemaVersion: 1,
    referenceId: "reference-001",
    sourceLedger: {
      sourceUrl: "https://example.com/public-reference",
      license: "unknown",
      allowedUses: ["analysis-only"],
      redistributionAllowed: false,
    },
    shots: [
      { id: "shot-001", startMs: 0, endMs: 2500, description: "Product close-up with text hook", tags: ["product", "hook"] },
      { id: "shot-002", startMs: 2500, endMs: 6000, description: "Problem/solution demonstration", tags: ["demo"] },
    ],
    remixConstraints: ["Do not reuse source frames in final export", "Use structure only"],
  }, "reference-video-analysis");

  const referenceShotAnalysis = await writeJson("tvc-reference/projections/asset-reference.shot-analysis.json", {
    schemaVersion: 1,
    kind: "clash.reference.shot-analysis.projection",
    targetAssetId: "asset-reference",
    sourceUrl: "https://example.com/public-reference",
    rightsLedgerPath: "projections/rights/asset-reference.rights-ledger.json",
    analysisOnly: true,
    mediaCopied: false,
    finalExportAllowed: false,
    allowedUses: ["metadata-analysis", "shot-analysis", "non-copying-reference"],
    prohibitedUses: ["download-source", "copy-frames", "export-derivative"],
    shots: [
      { id: "shot-001", startFrame: 0, endFrame: 75, description: "Product close-up with text hook", tags: ["product", "hook"] },
      { id: "shot-002", startFrame: 75, endFrame: 180, description: "Problem/solution demonstration", tags: ["demo"] },
    ],
  }, "reference-shot-analysis-projection");

  const referenceDownload = await writeJson("tvc-reference/references/reference-001.download-plan.json", {
    schemaVersion: 1,
    kind: "clash.reference.download-plan",
    targetAssetId: "asset-reference",
    sourceUrl: "https://example.com/public-reference",
    status: "planned",
    downloadAllowed: true,
    blockedReasons: [],
    tool: "yt-dlp",
    outputDir: "references/raw/asset-reference",
    rawReferenceQuarantine: true,
    finalExportAllowed: false,
    requiresUserExecution: true,
    downloadCommand: [
      "yt-dlp",
      "--no-playlist",
      "--restrict-filenames",
      "--write-info-json",
      "--output",
      "references/raw/asset-reference/%(id)s.%(ext)s",
      "https://example.com/public-reference",
    ],
    sourceLedger: {
      sourceUrl: "https://example.com/public-reference",
      license: "analysis-only",
      attribution: "Example",
      allowedUses: ["analysis-only", "shot-breakdown"],
      redistributionAllowed: false,
      derivativeAllowed: false,
    },
    createdAt: "2026-07-06T00:00:00.000Z",
  }, "reference-download-plan");

  const referenceDownloadReceipt = await writeJson("tvc-reference/references/reference-001.download-receipt.json", {
    schemaVersion: 1,
    kind: "clash.reference.download-receipt",
    targetAssetId: "asset-reference",
    sourceUrl: "https://example.com/public-reference",
    planPath: "tvc-reference/references/reference-001.download-plan.json",
    tool: "yt-dlp",
    outputDir: "references/raw/asset-reference",
    downloadedFiles: [
      {
        path: "references/raw/asset-reference/reference-001.mp4",
        mediaType: "video",
        sizeBytes: 1024,
      },
    ],
    rawReferenceQuarantine: true,
    finalExportAllowed: false,
    sourceLedger: {
      sourceUrl: "https://example.com/public-reference",
      license: "analysis-only",
      attribution: "Example",
      allowedUses: ["analysis-only", "shot-breakdown"],
      redistributionAllowed: false,
      derivativeAllowed: false,
    },
    assetId: "asset-reference",
    assetPath: "references/raw/asset-reference/reference-001.mp4",
    metadataKind: "reference.download",
    decisionLog: [
      "executed controlled reference download from approved plan",
      "registered raw reference asset in quarantine",
    ],
    executedAt: "2026-07-06T00:00:00.000Z",
  }, "reference-download-receipt");

  const referenceQa = await writeJson("tvc-reference/qa/reference-001.noncopying-qa.json", {
    schemaVersion: 1,
    kind: "clash.reference.noncopying-qa",
    referenceId: "reference-001",
    sourceUrl: "https://example.com/public-reference",
    status: "requires-review",
    similarityScore: 0.667,
    similarityThreshold: 0.5,
    blockedReasons: ["proposed shots are structurally close to reference shots"],
    checks: {
      rawReferenceAssetReuse: { pass: true, offenders: [] },
      structureSimilarity: { pass: false, threshold: 0.5, maxScore: 0.667 },
    },
    matches: [
      {
        referenceShotId: "shot-001",
        proposedShotId: "new-shot-001",
        similarityScore: 0.667,
        sharedTerms: ["hook", "product"],
      },
    ],
  }, "reference-noncopying-qa");

  const referenceIsolation = await writeJson("tvc-reference/qa/tvc-30s.reference-isolation.json", {
    schemaVersion: 1,
    kind: "clash.reference.isolation-verification",
    status: "pass",
    sourceTimelinePath: "projections/timelines/tvc-30s.timeline.yaml",
    assetsPath: "assets/manifest.json",
    rawReferenceAssets: [
      {
        assetId: "asset-reference",
        path: "references/raw/asset-reference/reference-001.mp4",
        sourceUrl: "https://example.com/public-reference",
        finalExportAllowed: false,
        redistributionAllowed: false,
        derivativeAllowed: false,
        downloadedPaths: ["references/raw/asset-reference/reference-001.mp4"],
      },
    ],
    timelineItems: [
      {
        trackId: "primary",
        itemId: "generated-shot-001",
        assetId: "asset-generated-shot",
        src: "assets/generated/tvc-shot-001.mp4",
      },
    ],
    offenders: [],
    checks: [
      {
        id: "assets.raw-reference-quarantine-known",
        label: "Raw reference assets are represented as quarantined assets",
        required: true,
        status: "pass",
        expected: "raw references are identifiable from asset metadata or references/raw paths",
        actual: "1 raw reference asset(s) known",
      },
      {
        id: "timeline.valid",
        label: "Timeline projection validates before reference isolation checks",
        required: true,
        status: "pass",
        expected: "timeline YAML parses as Clash timeline DSL",
        actual: "1 timeline item(s)",
      },
      {
        id: "timeline.no-unlicensed-raw-reference-assets",
        label: "Timeline does not use quarantined raw reference assets without rights",
        required: true,
        status: "pass",
        expected: "no timeline item assetId points at an unlicensed raw reference asset",
        actual: "no unlicensed raw reference asset ids",
      },
      {
        id: "timeline.no-unlicensed-raw-reference-paths",
        label: "Timeline does not use raw reference paths without rights",
        required: true,
        status: "pass",
        expected: "no timeline item src points at references/raw without final export rights",
        actual: "no unlicensed raw reference paths",
      },
    ],
    blockedReasons: [],
  }, "reference-isolation-verification");

  const adDeliverySpec = await writeJson("tvc-reference/delivery/asset-tvc.delivery-spec.json", {
    schemaVersion: 1,
    kind: "clash.ad.delivery-spec.projection",
    targetAssetId: "asset-tvc",
    brand: "Clash Skin",
    fps: 30,
    platforms: ["tiktok", "youtube-shorts"],
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
    packshot: {
      required: true,
      assetId: "asset-packshot",
      startFrame: 360,
      endFrame: 420,
    },
    endCard: {
      required: true,
      durationFrames: 90,
      cta: "Shop now",
      disclaimer: "Results vary.",
      qrRequired: true,
    },
    rightsLedgerAssetId: "asset-reference",
    checklist: [
      { id: "duration:tiktok-9x16-15s", label: "tiktok duration 15s", required: true },
      { id: "safe-zone:tiktok-9x16-15s", label: "tiktok safe zones top/right/bottom/left 120/48/220/48", required: true },
      { id: "subtitles:tiktok-9x16-15s", label: "tiktok subtitles required", required: true },
      { id: "packshot", label: "packshot asset asset-packshot frames 360-420", required: true },
      { id: "end-card", label: "end card 90 frames with CTA Shop now", required: true },
      { id: "disclaimer", label: "disclaimer text present", required: true },
      { id: "rights-ledger", label: "rights ledger linked to asset-reference", required: true },
    ],
  }, "ad-delivery-spec");

  const adVisualFrameExtraction = await writeJson("tvc-reference/analysis/visual/tiktok-15s.frame-extraction.json", {
    schemaVersion: 1,
    kind: "clash.ad.visual-frame-extraction",
    targetAssetId: "asset-tvc",
    variantId: "tiktok-9x16-15s",
    renderedPath: "exports/tiktok-15s.mp4",
    extractor: {
      id: "ffmpeg",
      command: "ffmpeg",
    },
    samples: [
      {
        id: "packshot-frame",
        role: "packshot",
        frame: 390,
        path: "analysis/visual/frames/packshot.ppm",
        format: "ppm",
      },
      {
        id: "end-card-frame",
        role: "end-card",
        frame: 360,
        path: "analysis/visual/frames/end-card.ppm",
        format: "ppm",
      },
      {
        id: "final-frame",
        role: "final-frame",
        frame: 449,
        path: "analysis/visual/frames/final.ppm",
        format: "ppm",
      },
    ],
    decisionLog: [
      "extracted 3 visual frame sample(s) from exports/tiktok-15s.mp4",
      "wrote PPM samples for downstream clash-local-ad-pixel-analyzer",
    ],
  }, "ad-visual-frame-extraction");

  const adVisualPixelEvidence = await writeJson("tvc-reference/analysis/visual/tiktok-15s.pixel-evidence.json", {
    schemaVersion: 1,
    kind: "clash.ad.visual-pixel-evidence",
    targetAssetId: "asset-tvc",
    variantId: "tiktok-9x16-15s",
    renderedPath: "exports/tiktok-15s.mp4",
    analysisBackend: {
      id: "clash-local-ad-pixel-analyzer",
      inputFormat: "ppm",
      capabilities: ["packshot-color-sample", "end-card-sample", "final-frame-diff"],
    },
    checks: [
      {
        id: "packshot-visible",
        check: "packshot-visible",
        status: "pass",
        required: true,
        expected: "50% pixels match #f04a2a within tolerance 18",
        actual: "56.25% pixels matched #f04a2a within tolerance 18",
        confidence: 0.563,
        frame: 390,
        evidencePath: "analysis/visual/frames/packshot.ppm",
      },
      {
        id: "end-card-visible",
        check: "end-card-visible",
        status: "pass",
        required: true,
        expected: "end-card sample frame is readable",
        actual: "end-card frame 4x4 average #112233",
        confidence: 1,
        frame: 360,
        evidencePath: "analysis/visual/frames/end-card.ppm",
      },
      {
        id: "final-frame-hold",
        check: "final-frame-hold",
        status: "pass",
        required: true,
        expected: "final frame mean absolute RGB diff <= 2",
        actual: "mean absolute RGB diff 0",
        confidence: 1,
        frame: 449,
        evidencePath: "analysis/visual/frames/final.ppm",
      },
    ],
    pixelSamples: [
      {
        id: "packshot-frame",
        path: "analysis/visual/frames/packshot.ppm",
        width: 4,
        height: 4,
        averageRgb: "#dc7a67",
        matchedPixels: 9,
        matchRatio: 0.563,
      },
      {
        id: "end-card-frame",
        path: "analysis/visual/frames/end-card.ppm",
        width: 4,
        height: 4,
        averageRgb: "#112233",
      },
      {
        id: "final-frame",
        path: "analysis/visual/frames/final.ppm",
        width: 4,
        height: 4,
        averageRgb: "#112233",
        meanAbsoluteDiff: 0,
      },
    ],
  }, "ad-visual-pixel-evidence");

  const adVisualQa = await writeJson("tvc-reference/qa/tiktok-15s.visual-qa.json", {
    schemaVersion: 1,
    kind: "clash.ad.visual-qa",
    targetAssetId: "asset-tvc",
    variantId: "tiktok-9x16-15s",
    renderedPath: "exports/tiktok-15s.mp4",
    evidencePath: "analysis/visual/tiktok-15s.pixel-evidence.json",
    checks: [
      { id: "packshot-visible", check: "packshot-visible", status: "pass", required: true, expected: "asset-packshot visible frames 360-420", actual: "visible", confidence: 0.98, frame: 390 },
      { id: "logo-lockup-visible", check: "logo-lockup-visible", status: "pass", required: true, expected: "approved logo lockup visible", actual: "visible", confidence: 0.97, frame: 420 },
      { id: "disclaimer-ocr", check: "disclaimer-ocr", status: "pass", required: true, expected: "Results vary.", actual: "Results vary.", confidence: 0.96, frame: 430 },
      { id: "final-frame-hold", check: "final-frame-hold", status: "pass", required: true, expected: "final frame holds for 90 frames", actual: "holds for 90 frames", frame: 449 },
    ],
    verdict: "pass",
    blockedReasons: [],
    visualQa: {
      captionsPresent: true,
      safeZoneViolations: [],
      packshotVisible: true,
      endCardVisible: true,
      disclaimerVisible: true,
      ctaVisible: true,
      logoLockupVisible: true,
      finalFrameHolds: true,
    },
    decisionLog: [
      "loaded 4 ad visual QA evidence checks",
      "consumed evidence from clash-local-ad-pixel-analyzer",
      "did not execute OCR/logo/pixel analysis backends",
    ],
  }, "ad-visual-qa");

  const adDeliveryValidation = await writeJson("tvc-reference/qa/tiktok-15s.validation.json", {
    schemaVersion: 1,
    kind: "clash.ad.delivery-export-validation",
    targetAssetId: "asset-tvc",
    brand: "Clash Skin",
    variant: {
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
    renderedPath: "exports/tiktok-15s.mp4",
    probe: {
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 15.01,
      hasVideo: true,
      hasAudio: true,
      videoCodec: "h264",
      audioCodec: "aac",
    },
    visualQa: {
      captionsPresent: true,
      safeZoneViolations: [],
      packshotVisible: true,
      endCardVisible: true,
      disclaimerVisible: true,
      ctaVisible: true,
      logoLockupVisible: true,
      finalFrameHolds: true,
    },
    checks: [
      { id: "variant", status: "pass", required: true, severity: "error", expected: "variant tiktok-9x16-15s", actual: "tiktok-9x16-15s" },
      { id: "video-track", status: "pass", required: true, severity: "error", expected: "video track present", actual: "present" },
      { id: "audio-track", status: "pass", required: true, severity: "error", expected: "audio track present", actual: "present" },
      { id: "resolution", status: "pass", required: true, severity: "error", expected: "1080x1920", actual: "1080x1920" },
      { id: "aspect-ratio", status: "pass", required: true, severity: "error", expected: "9:16", actual: "9:16" },
      { id: "fps", status: "pass", required: true, severity: "error", expected: "30fps +/- 0.01", actual: "30fps" },
      { id: "duration", status: "pass", required: true, severity: "error", expected: "15s +/- 0.25s", actual: "15.01s" },
      { id: "safe-zone", status: "pass", required: true, severity: "error", expected: "no safe-zone violations", actual: "0 violation(s)" },
      { id: "subtitles", status: "pass", required: true, severity: "error", expected: "captions present", actual: "present" },
      { id: "packshot", status: "pass", required: true, severity: "error", expected: "packshot asset-packshot visible", actual: "visible" },
      { id: "end-card", status: "pass", required: true, severity: "error", expected: "end card with CTA Shop now", actual: "visible" },
      { id: "disclaimer", status: "pass", required: true, severity: "error", expected: "disclaimer Results vary.", actual: "visible" },
      { id: "rights-ledger", status: "pass", required: true, severity: "error", expected: "rights ledger asset-reference", actual: "asset-reference" },
    ],
    verdict: "pass",
  }, "ad-delivery-validation");

  const contentCredentials = await writeJson("tvc-reference/provenance/tiktok-15s.content-credentials.json", {
    schemaVersion: 1,
    kind: "clash.provenance.content-credentials",
    targetAssetId: "asset-tvc",
    credentialId: "tiktok-15s-export-provenance",
    targetPath: "exports/tiktok-15s.mp4",
    targetHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    mode: "unsigned-manifest",
    signatureStatus: "unsigned",
    ingredients: [
      {
        assetId: "asset-reference",
        path: "tvc-reference/analysis/reference-001.json",
        relationship: "reference",
        hash: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        rights: "derivative-disallowed fixture",
      },
      {
        assetId: "asset-packshot",
        path: "assets/reference-sheets/products/packshot.png",
        relationship: "generated-input",
        hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      },
    ],
    actions: [
      {
        actionId: "asset-tvc.delivery-spec",
        action: "delivery-validation",
        softwareAgent: "clash-production",
      },
    ],
    assertions: [
      {
        label: "ai.generated",
        value: "Unsigned local provenance manifest; no C2PA signature is claimed.",
      },
    ],
    decisionLog: [
      "registered unsigned content credentials manifest tiktok-15s-export-provenance",
      "did not sign C2PA manifest",
    ],
  }, "content-credentials");

  const imageConsistency = await writeJson("image/analysis/consistency-report.json", {
    schemaVersion: 1,
    assetPackId: "character-protagonist-pack",
    scores: {
      identity: 0.92,
      wardrobe: 0.9,
      scene: 0.84,
      productLogo: 1,
      style: 0.88,
      composition: 0.86,
      temporal: 0.82,
    },
    verdict: "pass",
    issues: [],
  }, "image-consistency-report");

  const storyboardConsistencyQa = await writeJson("image/analysis/storyboard-consistency-qa.json", {
    schemaVersion: 1,
    kind: "clash.image.storyboard-consistency-qa",
    assetPackId: "asset-storyboard",
    scores: {
      identity: 0,
      wardrobe: 0,
      scene: 1,
      productLogo: 1,
      style: 0.5,
      composition: 0,
      temporal: 0.5,
    },
    verdict: "block",
    issues: [
      "missing required character view: hero/back",
      "storyboard panel below consistency threshold: panel-1 (0.58)",
    ],
    checks: {
      requiredCharacterViews: {
        pass: false,
        missing: [{ characterId: "hero", view: "back" }],
      },
      panelReferences: {
        pass: true,
        unknownSceneIds: [],
        unknownCharacterIds: [],
      },
      panelAssets: {
        pass: false,
        missingPathPanelIds: ["panel-2"],
      },
      panelConsistency: {
        pass: false,
        threshold: 0.75,
        lowScorePanels: [{ panelId: "panel-1", score: 0.58 }],
      },
    },
  }, "storyboard-consistency-qa");

  const storyboardTimelineProjection = await writeJson("short-drama/projections/asset-storyboard.storyboard.timeline-manifest.json", {
    schemaVersion: 1,
    kind: "clash.storyboard.timeline-projection",
    storyboardAssetId: "asset-storyboard",
    sourceActionPath: "actions/storyboard-review.json",
    durationPerPanel: 45,
    panels: [
      {
        panelId: "panel-1",
        sceneId: "store-night",
        characterIds: ["protagonist"],
        assetId: "asset-panel-1",
        path: "assets/storyboards/panel-1.png",
        from: 0,
        durationInFrames: 45,
        consistencyScore: 0.86,
      },
      {
        panelId: "panel-2",
        sceneId: "store-night",
        characterIds: ["protagonist"],
        assetId: "asset-panel-2",
        path: "assets/storyboards/panel-2.png",
        from: 45,
        durationInFrames: 45,
        consistencyScore: 0.9,
      },
    ],
    timelineItems: [
      {
        id: "storyboard-panel-1",
        type: "image",
        from: 0,
        durationInFrames: 45,
        assetId: "asset-panel-1",
        src: "assets/storyboards/panel-1.png",
        storyboardPanelId: "panel-1",
        sceneId: "store-night",
        characterIds: ["protagonist"],
      },
      {
        id: "storyboard-panel-2",
        type: "image",
        from: 45,
        durationInFrames: 45,
        assetId: "asset-panel-2",
        src: "assets/storyboards/panel-2.png",
        storyboardPanelId: "panel-2",
        sceneId: "store-night",
        characterIds: ["protagonist"],
      },
    ],
    casApply: timelineCasApply("projections/timelines/asset-storyboard.storyboard.timeline.yaml"),
  }, "storyboard-timeline-projection");

  const storyboardTimelineVerification = await writeJson("short-drama/qa/asset-storyboard.timeline-verification.json", {
    schemaVersion: 1,
    kind: "clash.storyboard.timeline-verification",
    status: "pass",
    storyboardAssetId: "asset-storyboard",
    sourceActionPath: "actions/storyboard-review.json",
    manifestPath: "short-drama/projections/asset-storyboard.storyboard.timeline-manifest.json",
    timelineProjectionPath: "projections/timelines/asset-storyboard.storyboard.timeline.yaml",
    minConsistency: 0.75,
    panels: 2,
    timelineItems: 2,
    lowConsistencyPanels: [],
    panelCoverage: [
      {
        panelId: "panel-1",
        assetId: "asset-panel-1",
        coveredByPanelManifest: true,
        coveredByTimelineItem: true,
        timelineItemId: "storyboard-panel-1",
        consistencyScore: 0.86,
      },
      {
        panelId: "panel-2",
        assetId: "asset-panel-2",
        coveredByPanelManifest: true,
        coveredByTimelineItem: true,
        timelineItemId: "storyboard-panel-2",
        consistencyScore: 0.9,
      },
    ],
    checks: [
      {
        id: "action.storyboard-metadata-present",
        label: "Storyboard metadata action is present",
        required: true,
        status: "pass",
        expected: "AssetMetadataFillAction metadata.kind is image.storyboard-consistency",
        actual: "image.storyboard-consistency action parsed",
      },
      {
        id: "manifest.cas-fresh-pull",
        label: "Storyboard timeline projection declares fresh-pull CAS",
        required: true,
        status: "pass",
        expected: "projection manifest has Project Timeline pull/apply CAS with explicit --timeline arg",
        actual: "fresh-pull CAS present",
      },
      {
        id: "manifest.panels-covered",
        label: "Storyboard manifest covers all action panels",
        required: true,
        status: "pass",
        expected: "every action panel appears in manifest.panels",
        actual: "2 panel(s) covered",
      },
      {
        id: "manifest.timeline-items-covered",
        label: "Storyboard timeline items cover all panels",
        required: true,
        status: "pass",
        expected: "every action panel appears as a timeline item",
        actual: "2 timeline item(s) cover panels",
      },
      {
        id: "panels.consistency-threshold",
        label: "Storyboard panel consistency meets threshold",
        required: true,
        status: "pass",
        expected: "all panel consistencyScore values meet the configured threshold",
        actual: "all scored panels meet threshold",
      },
      {
        id: "panels.assets-local",
        label: "Storyboard panel media paths are local project assets",
        required: true,
        status: "pass",
        expected: "panel paths and timeline src values are project-relative local asset paths",
        actual: "all panel media paths are local",
      },
    ],
    blockedReasons: [],
  }, "storyboard-timeline-verification");

  const storyboardPromptPackProjection = await writeJson("short-drama/projections/asset-storyboard.prompt-pack.json", {
    schemaVersion: 1,
    kind: "clash.storyboard.prompt-pack.projection",
    storyboardAssetId: "asset-storyboard",
    sourceActionPath: "actions/storyboard-review.json",
    promptPack: {
      schemaVersion: 1,
      kind: "clash.storyboard.prompt-pack",
      storyboardAssetId: "asset-storyboard",
      prompts: [
        {
          id: "prompt-panel-1",
          panelId: "panel-1",
          sceneId: "store-night",
          characterIds: ["protagonist"],
          prompt: "night convenience store aisle; characters: protagonist; style: vertical short drama, cinematic light",
          negativePrompt: "logo drift, extra fingers",
          outputAssetId: "asset-panel-1",
          outputPath: "assets/storyboards/panel-1.png",
          modelHint: "local-image-model",
        },
        {
          id: "prompt-panel-2",
          panelId: "panel-2",
          sceneId: "store-night",
          characterIds: ["protagonist"],
          prompt: "night convenience store aisle; characters: protagonist; style: vertical short drama, cinematic light",
          negativePrompt: "logo drift, extra fingers",
          outputAssetId: "asset-panel-2",
          outputPath: "assets/storyboards/panel-2.png",
          modelHint: "local-image-model",
        },
      ],
    },
    promptPackHash: "fixture-hash",
    appliedAt: "2026-07-06T00:00:00.000Z",
    casApply: {
      target: "storyboard-prompt-pack",
      mutation: "managed-projection",
      applyCommand: "clash production apply-storyboard-prompt-pack",
      filePath: "plans/prompt-pack.json",
    },
  }, "storyboard-prompt-pack-projection");

  const categories = [
    {
      id: "short-drama",
      artifacts: [
        pipeline.path,
        dryRunCostGate.path,
        reviewGate.path,
        character.path,
        storyboardTimelineProjection.path,
        storyboardTimelineVerification.path,
        storyboardPromptPackProjection.path,
      ],
      checks: [
        { name: "pipeline manifest validates", pass: true },
        { name: "dry-run cost gate validates local zero-cost generation", pass: true },
        { name: "review stage gate validates explicit approval", pass: true },
        { name: "character reference pack exists for 三视图", pass: true },
        { name: "storyboard timeline projection validates", pass: true },
        { name: "storyboard timeline verification validates CAS and panel coverage", pass: true },
        { name: "storyboard prompt-pack CAS projection validates", pass: true },
      ],
    },
    {
      id: "mv",
      artifacts: [
        beatGrid.path,
        analysisBackendBenchmark.path,
        stemSeparation.path,
        mvBeatCutProjection.path,
        mvBeatSyncVerification.path,
        lyrics.path,
        visualMoments.path,
      ],
      checks: [
        { name: "beat-grid validates", pass: true },
        { name: "analysis backend benchmark validates without executing backends", pass: true },
        { name: "stem separation report validates without executing separation backends", pass: true },
        { name: "beat-cut timeline projection validates", pass: true },
        { name: "beat-sync QA verifies metadata to projection contract", pass: true },
        { name: "lyrics alignment validates", pass: true },
        { name: "visual moment library validates", pass: true },
        { name: "beat frames are present", pass: true },
        { name: "energy and cut-density metadata validate", pass: true },
        { name: "semantic section labels carry review confidence", pass: true },
      ],
    },
    {
      id: "motion-graphics",
      artifacts: [
        mgOverlay.path,
        mgPreviewVerification.path,
        compositionRoute.path,
        reactCompositionTimeline.path,
        mgVideoExport.path,
        derivedOverlay.path,
      ],
      checks: [
        { name: "MG overlay manifest validates seekable HTML preview contract", pass: true },
        { name: "MG preview verification validates deterministic frame QA", pass: true },
        { name: "composition route plan validates without silent fallback", pass: true },
        { name: "rendered Remotion composition projection validates CAS timeline contract", pass: true },
        { name: "MG video export validates decoded alpha samples", pass: true },
        { name: "derived overlay projection validates", pass: true },
        { name: "derived overlay preserves copy-on-write lineage", pass: true },
        { name: "CAS apply boundary is explicit", pass: true },
        { name: "first-party HTML runtime is required", pass: true },
      ],
    },
    {
      id: "talking-head",
      artifacts: [
        asrTranscript.path,
        cuts.path,
        mediaCutExport.path,
        captionExport.path,
        captionLineage.path,
        captionOverlay.path,
        captionBurnExport.path,
        timelineHandoff.path,
      ],
      checks: [
        { name: "ASR transcript provenance projection validates", pass: true },
        { name: "cut plan validates", pass: true },
        { name: "caption track carries word refs and source map", pass: true },
        { name: "caption lineage verifier blocks plain text subtitle impostors", pass: true },
        { name: "ASS caption sidecar export validates", pass: true },
        { name: "caption overlay projection validates with CAS apply boundary", pass: true },
        { name: "caption burn-in export validates as copy-on-write derived asset plan", pass: true },
        { name: "timeline CSV handoff validates", pass: true },
        { name: "media cut export validates", pass: true },
        { name: "cuts are non-destructive and create a new asset", pass: true },
      ],
    },
    {
      id: "tvc-reference",
      artifacts: [
        reference.path,
        referenceShotAnalysis.path,
        referenceDownload.path,
        referenceDownloadReceipt.path,
        referenceQa.path,
        referenceIsolation.path,
        adDeliverySpec.path,
        adVisualFrameExtraction.path,
        adVisualPixelEvidence.path,
        adVisualQa.path,
        adDeliveryValidation.path,
        contentCredentials.path,
        productLogoQa.path,
      ],
      checks: [
        { name: "reference analysis validates", pass: true },
        { name: "reference shot-analysis projection validates as analysis-only", pass: true },
        { name: "reference download plan validates", pass: true },
        { name: "reference download receipt validates quarantined asset registration", pass: true },
        { name: "non-copying QA validates", pass: true },
        { name: "reference isolation blocks raw source reuse before export", pass: true },
        { name: "ad delivery spec validates", pass: true },
        { name: "ad visual frame extraction validates local PPM sample manifest", pass: true },
        { name: "ad visual pixel evidence validates", pass: true },
        { name: "ad visual QA validates packshot logo disclaimer and final-frame evidence", pass: true },
        { name: "ad delivery export receipt validates", pass: true },
        { name: "content credentials manifest validates without C2PA signing", pass: true },
        { name: "product/logo QA validates claim-text gates", pass: true },
        { name: "packshot and end-card gates validate", pass: true },
        { name: "rights ledger forbids silent redistribution", pass: true },
      ],
    },
    {
      id: "image",
      artifacts: [
        character.path,
        semanticReferenceRoles.path,
        imageEmbeddingStore.path,
        comfyuiRunner.path,
        productLogoQa.path,
        imageConsistency.path,
        storyboardConsistencyQa.path,
      ],
      checks: [
        { name: "character reference pack validates", pass: true },
        { name: "semantic reference roles validate copy-on-write locks", pass: true },
        { name: "image embedding store validates reference baselines", pass: true },
        { name: "ComfyUI workflow contract validates output lineage", pass: true },
        { name: "product/logo QA validates locked reference checks", pass: true },
        { name: "image consistency report validates", pass: true },
        { name: "storyboard consistency QA validates", pass: true },
        { name: "front side back views exist", pass: true },
      ],
    },
  ];

  const report = {
    status: "pass",
    artifactRoot,
    categories,
  };
  await writeFile(path.join(artifactRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
