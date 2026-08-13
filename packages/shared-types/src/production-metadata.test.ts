import { describe, expect, it } from "vitest";
import {
  AssetMetadataFillActionSchema,
  AdDeliveryExportValidationReceiptSchema,
  AdDeliveryMetadataSchema,
  AdVisualQaMetadataSchema,
  AnalysisBackendBenchmarkMetadataSchema,
  AsrTimedTranscriptSchema,
  AudioStemSeparationMetadataSchema,
  AudioBeatMetadataSchema,
  ContentCredentialsMetadataSchema,
  ImageComfyuiRunnerMetadataSchema,
  ImageEmbeddingStoreMetadataSchema,
  ImageStoryboardMetadataSchema,
  LyricsAlignmentMetadataSchema,
  ProductLogoQaMetadataSchema,
  ReferenceDownloadMetadataSchema,
  ReferenceVideoMetadataSchema,
  StoryboardPromptPackSchema,
  TalkingHeadMetadataSchema,
  VideoVisualMomentMetadataSchema,
  applyAssetMetadataFill,
  buildAdDeliveryExportValidationReceipt,
  buildAnalysisBackendBenchmarkVerdict,
  buildBeatEditHints,
  buildBeatSectionCutPlan,
  buildCaptionItemFromTalkingHeadMetadata,
  buildCaptionItemFromLyricsAlignmentMetadata,
  buildProductLogoQaVerdict,
  buildStoryboardPromptPackFromMetadata,
  buildVisualMomentClipLibrary,
  buildAdDeliveryChecklist,
  buildReferenceRightsLedger,
  assertReferenceCanBeRemixed,
  projectAsrTimedTranscriptWords,
} from "./production-metadata.js";

describe("word-aligned ASR transcript contract", () => {
  it("keeps millisecond word timing and projects it to non-zero frame ranges", () => {
    const transcript = AsrTimedTranscriptSchema.parse({
      schemaVersion: 1,
      kind: "clash.asr.timed-transcript",
      timebase: "milliseconds",
      alignment: "word",
      text: "你好 Clash",
      backendId: "funasr",
      modelId: "iic/SenseVoiceSmall",
      language: "zh",
      durationMs: 721,
      words: [
        { id: "word-000001", text: "你", startMs: 40, endMs: 180 },
        { id: "word-000002", text: "好", startMs: 180, endMs: 360 },
        {
          id: "word-000003",
          text: "Clash",
          startMs: 420,
          endMs: 721,
          confidence: 0.96,
        },
      ],
      segments: [
        {
          id: "segment-000001",
          text: "你好 Clash",
          startMs: 40,
          endMs: 721,
          wordIds: ["word-000001", "word-000002", "word-000003"],
        },
      ],
    });

    expect(projectAsrTimedTranscriptWords(transcript, 30)).toEqual([
      { id: "word-000001", text: "你", startFrame: 1, endFrame: 6 },
      { id: "word-000002", text: "好", startFrame: 5, endFrame: 11 },
      {
        id: "word-000003",
        text: "Clash",
        startFrame: 12,
        endFrame: 22,
        confidence: 0.96,
      },
    ]);
  });

  it("rejects duplicate word ids and invalid word ranges", () => {
    expect(() =>
      AsrTimedTranscriptSchema.parse({
        schemaVersion: 1,
        kind: "clash.asr.timed-transcript",
        timebase: "milliseconds",
        alignment: "word",
        text: "bad",
        backendId: "fixture",
        modelId: "fixture-model",
        durationMs: 100,
        words: [
          { id: "word-1", text: "b", startMs: 0, endMs: 50 },
          { id: "word-1", text: "a", startMs: 70, endMs: 60 },
        ],
        segments: [],
      }),
    ).toThrow();
  });
});

describe("production metadata fill contract", () => {
  it("fills MV beat metadata onto an audio asset and derives timeline edit hints", () => {
    const beatMetadata = AudioBeatMetadataSchema.parse({
      kind: "audio.beat-analysis",
      bpm: 128,
      fps: 30,
      beats: [
        {
          frame: 0,
          timeSeconds: 0,
          confidence: 0.99,
          bar: 1,
          beatInBar: 1,
          downbeat: true,
        },
        {
          frame: 14,
          timeSeconds: 0.466,
          confidence: 0.94,
          bar: 1,
          beatInBar: 2,
        },
        {
          frame: 28,
          timeSeconds: 0.933,
          confidence: 0.93,
          bar: 1,
          beatInBar: 3,
        },
      ],
      sections: [
        {
          id: "intro",
          startFrame: 0,
          endFrame: 120,
          label: "intro",
          energy: 0.35,
          novelty: 0.12,
          impact: 0.22,
          cutDensity: "hold",
        },
      ],
      energyCurve: [
        {
          frame: 0,
          timeSeconds: 0,
          rms: 0.1,
          normalized: 0.35,
          novelty: 0.12,
          impact: 0.22,
        },
      ],
    });
    const fill = AssetMetadataFillActionSchema.parse({
      actionId: "action-mv-beat-fill",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-song",
      },
      metadataKind: "audio.beat-analysis",
      metadata: beatMetadata,
      producer: "fixture",
    });

    const asset = applyAssetMetadataFill(
      { id: "asset-song", type: "audio", metadata: {} },
      fill,
    );

    expect(asset.metadata["audio.beat-analysis"]).toMatchObject({ bpm: 128 });
    expect(buildBeatEditHints(beatMetadata)).toEqual([
      { frame: 0, reason: "downbeat", strength: 0.99 },
      { frame: 14, reason: "beat", strength: 0.94 },
      { frame: 28, reason: "beat", strength: 0.93 },
    ]);
    expect(buildBeatSectionCutPlan(beatMetadata)).toEqual([
      {
        id: "section-intro",
        sectionId: "intro",
        label: "intro",
        sourceStartFrame: 0,
        sourceEndFrame: 120,
        outputStartFrame: 0,
        outputEndFrame: 120,
        anchorFrames: [0],
        energy: 0.35,
        novelty: 0.12,
        impact: 0.22,
        cutDensity: "hold",
        recommendedCutEveryFrames: 120,
      },
    ]);
  });

  it("rejects legacy targetAssetId writes at the closed-schema compatibility surface", () => {
    expect(() =>
      AssetMetadataFillActionSchema.parse({
        actionId: "legacy-write",
        targetAssetId: "asset-song",
        metadataKind: "audio.beat-analysis",
        metadata: {
          kind: "audio.beat-analysis",
          bpm: 128,
          fps: 30,
          beats: [],
          sections: [],
          energyCurve: [],
        },
        producer: "fixture",
      }),
    ).toThrow();
  });

  it("derives rhythm-aware cut-density hints for high-impact MV sections", () => {
    const beatMetadata = AudioBeatMetadataSchema.parse({
      kind: "audio.beat-analysis",
      bpm: 120,
      fps: 30,
      beats: [
        {
          frame: 0,
          timeSeconds: 0,
          confidence: 0.4,
          bar: 1,
          beatInBar: 1,
          downbeat: true,
        },
        { frame: 15, timeSeconds: 0.5, confidence: 0.42, bar: 1, beatInBar: 2 },
        { frame: 30, timeSeconds: 1, confidence: 0.43, bar: 1, beatInBar: 3 },
        { frame: 45, timeSeconds: 1.5, confidence: 0.44, bar: 1, beatInBar: 4 },
        {
          frame: 60,
          timeSeconds: 2,
          confidence: 0.95,
          bar: 2,
          beatInBar: 1,
          downbeat: true,
        },
        { frame: 75, timeSeconds: 2.5, confidence: 0.96, bar: 2, beatInBar: 2 },
        { frame: 90, timeSeconds: 3, confidence: 0.96, bar: 2, beatInBar: 3 },
        {
          frame: 105,
          timeSeconds: 3.5,
          confidence: 0.97,
          bar: 2,
          beatInBar: 4,
        },
      ],
      sections: [
        {
          id: "bar-1",
          startFrame: 0,
          endFrame: 60,
          label: "bar 1",
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
        {
          frame: 0,
          timeSeconds: 0,
          rms: 0.1,
          normalized: 0.4,
          novelty: 0.4,
          impact: 0.4,
        },
        {
          frame: 60,
          timeSeconds: 2,
          rms: 0.24,
          normalized: 0.96,
          novelty: 0.52,
          impact: 0.96,
        },
      ],
    });

    expect(
      buildBeatSectionCutPlan(beatMetadata).map((cut: any) => [
        cut.sectionId,
        cut.semanticLabel,
        cut.semanticConfidence,
        cut.reviewRequired,
        cut.semanticSource,
        cut.cutDensity,
        cut.recommendedCutEveryFrames,
        cut.impact,
      ]),
    ).toEqual([
      ["bar-1", undefined, undefined, undefined, undefined, "medium", 60, 0.42],
      [
        "bar-2",
        "drop",
        0.87,
        false,
        "local-rms-phrase-heuristic",
        "fast",
        30,
        0.96,
      ],
    ]);
  });

  it("fills product/logo QA metadata and derives blocked reasons from required checks", () => {
    const metadata = ProductLogoQaMetadataSchema.parse({
      kind: "image.product-logo-qa",
      targetAssetId: "asset-ad-frame",
      referencePackAssetId: "asset-reference-pack",
      requiredReferenceAssetIds: ["asset-logo-lock", "asset-packshot"],
      references: [
        {
          roleId: "brand-logo",
          assetId: "asset-logo-lock",
          role: "logo-lock",
          path: "assets/brand/logo.png",
          locked: true,
          copyOnWriteRequired: true,
          constraints: ["preserve exact glyphs"],
        },
        {
          roleId: "product-packshot",
          assetId: "asset-packshot",
          role: "product-packshot",
          path: "assets/products/packshot.png",
          locked: true,
          copyOnWriteRequired: true,
          constraints: ["claim text SPF50+"],
        },
      ],
      checks: [
        {
          id: "logo-visible",
          roleId: "brand-logo",
          referenceAssetId: "asset-logo-lock",
          check: "logo-presence",
          status: "pass",
          expected: "logo is visible",
          actual: "logo is visible",
          confidence: 0.96,
        },
        {
          id: "claim-text",
          roleId: "product-packshot",
          referenceAssetId: "asset-packshot",
          check: "claim-text",
          status: "fail",
          expected: "SPF50+",
          actual: "SPFSO+",
          confidence: 0.88,
        },
      ],
      verdict: "fail",
      blockedReasons: ["claim-text failed for role product-packshot"],
      copyOnWriteRequired: true,
    });
    const verdict = buildProductLogoQaVerdict(metadata.checks);
    const fill = AssetMetadataFillActionSchema.parse({
      actionId: "action-product-logo-qa",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-ad-frame",
      },
      metadataKind: "image.product-logo-qa",
      metadata,
      producer: "fixture",
    });

    const asset = applyAssetMetadataFill(
      { id: "asset-ad-frame", type: "image", metadata: {} },
      fill,
    );

    expect(verdict).toEqual({
      verdict: "fail",
      blockedReasons: ["claim-text failed for role product-packshot"],
    });
    expect(asset.metadata["image.product-logo-qa"]).toMatchObject({
      verdict: "fail",
      requiredReferenceAssetIds: ["asset-logo-lock", "asset-packshot"],
    });
  });

  it("fills analysis backend benchmark metadata and selects the best passing backend", () => {
    const metadata = AnalysisBackendBenchmarkMetadataSchema.parse({
      kind: "analysis.backend-benchmark",
      benchmarkId: "mv-beat-grid-v1",
      targetCapability: "audio.beat-grid",
      fixtureSetPath: "benchmarks/fixtures/click-track.json",
      candidates: [
        {
          backendId: "local-wav",
          capability: "audio.beat-grid",
          resultPath: "analysis/audio/local-wav.beat-grid.json",
          weightedScore: 0.973,
          status: "pass",
          metrics: [
            {
              id: "bpm-accuracy",
              score: 0.99,
              threshold: 0.95,
              weight: 2,
              status: "pass",
            },
            {
              id: "downbeat-f1",
              score: 0.94,
              threshold: 0.9,
              weight: 1,
              status: "pass",
            },
          ],
        },
        {
          backendId: "vlm-audio",
          capability: "audio.beat-grid",
          resultPath: "analysis/audio/vlm-audio.beat-grid.json",
          weightedScore: 0.75,
          status: "fail",
          metrics: [
            {
              id: "bpm-accuracy",
              score: 0.82,
              threshold: 0.95,
              weight: 2,
              status: "fail",
            },
            {
              id: "downbeat-f1",
              score: 0.61,
              threshold: 0.9,
              weight: 1,
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
    });
    const verdict = buildAnalysisBackendBenchmarkVerdict(metadata.candidates);
    const fill = AssetMetadataFillActionSchema.parse({
      actionId: "analysis-benchmark-mv-beat-grid-v1",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-song",
      },
      metadataKind: "analysis.backend-benchmark",
      metadata,
      producer: "fixture",
    });

    const asset = applyAssetMetadataFill(
      { id: "asset-song", type: "audio", metadata: {} },
      fill,
    );

    expect(verdict).toEqual({
      verdict: "pass",
      selectedBackendId: "local-wav",
      blockedReasons: [],
    });
    expect(asset.metadata["analysis.backend-benchmark"]).toMatchObject({
      selectedBackendId: "local-wav",
      targetCapability: "audio.beat-grid",
    });
  });

  it("fills image embedding store metadata without embedding vectors inline", () => {
    const metadata = ImageEmbeddingStoreMetadataSchema.parse({
      kind: "image.embedding-store",
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
          vectorHash:
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          dimension: 4,
          baselineFor: ["identity"],
          locked: true,
          copyOnWriteRequired: true,
          tags: ["front", "character"],
        },
      ],
      copyOnWriteRequired: true,
    });
    const fill = AssetMetadataFillActionSchema.parse({
      actionId: "image-embedding-store-reference-baselines-v1",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-reference-pack",
      },
      metadataKind: "image.embedding-store",
      metadata,
      producer: "fixture",
    });

    const asset = applyAssetMetadataFill(
      { id: "asset-reference-pack", type: "reference-pack", metadata: {} },
      fill,
    );

    expect(asset.metadata["image.embedding-store"]).toMatchObject({
      embeddingSetId: "reference-baselines-v1",
      modelId: "local-clip-vit-b32",
      dimension: 4,
      copyOnWriteRequired: true,
    });
    expect(
      JSON.stringify(asset.metadata["image.embedding-store"]),
    ).not.toContain("[0.1");
  });

  it("fills audio stem separation metadata with stem asset lineage", () => {
    const metadata = AudioStemSeparationMetadataSchema.parse({
      kind: "audio.stem-separation",
      separationId: "mv-song-stems-v1",
      sourceAssetId: "asset-song",
      sourcePath: "assets/audio/song.wav",
      backendId: "local-demucs-precomputed",
      modelId: "htdemucs-fixture",
      stems: [
        {
          stemAssetId: "asset-song-vocals",
          stemType: "vocal",
          filePath: "assets/audio/stems/vocals.wav",
          fileHash:
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          codec: "pcm_s16le",
          durationSeconds: 15,
          sampleRate: 44100,
          channels: 2,
        },
        {
          stemAssetId: "asset-song-instrumental",
          stemType: "instrumental",
          filePath: "assets/audio/stems/instrumental.wav",
          fileHash:
            "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          codec: "pcm_s16le",
          durationSeconds: 15,
          sampleRate: 44100,
          channels: 2,
        },
      ],
      vocalStemAssetId: "asset-song-vocals",
      decisionLog: [
        "registered 2 audio stem files for mv-song-stems-v1",
        "did not execute stem separation backends",
      ],
    });
    const fill = AssetMetadataFillActionSchema.parse({
      actionId: "audio-stem-separation-mv-song-stems-v1",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-song",
      },
      metadataKind: "audio.stem-separation",
      metadata,
      producer: "fixture",
    });

    const asset = applyAssetMetadataFill(
      { id: "asset-song", type: "audio", metadata: {} },
      fill,
    );

    expect(asset.metadata["audio.stem-separation"]).toMatchObject({
      vocalStemAssetId: "asset-song-vocals",
      sourceAssetId: "asset-song",
    });
    expect((asset.metadata["audio.stem-separation"] as any).stems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stemAssetId: "asset-song-vocals",
          filePath: "assets/audio/stems/vocals.wav",
        }),
      ]),
    );
  });

  it("fills ComfyUI workflow metadata with pinned local output lineage", () => {
    const metadata = ImageComfyuiRunnerMetadataSchema.parse({
      kind: "image.comfyui-runner",
      workflowId: "hero-reference-gen-v1",
      workflowPath: "workflows/hero-reference.api.json",
      workflowHash:
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
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
          fileHash:
            "sha256:1111111111111111111111111111111111111111111111111111111111111111",
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
    });
    const fill = AssetMetadataFillActionSchema.parse({
      actionId: "comfyui-runner-hero-reference-gen-v1",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-image-job",
      },
      metadataKind: "image.comfyui-runner",
      metadata,
      producer: "fixture",
    });

    const asset = applyAssetMetadataFill(
      { id: "asset-image-job", type: "image-generation-job", metadata: {} },
      fill,
    );

    expect(asset.metadata["image.comfyui-runner"]).toMatchObject({
      workflowId: "hero-reference-gen-v1",
      workflowPath: "workflows/hero-reference.api.json",
      outputs: [
        expect.objectContaining({
          outputAssetId: "asset-hero-front",
          status: "materialized",
          fileHash:
            "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        }),
      ],
    });
  });

  it("fills content credentials metadata without claiming a C2PA signature", () => {
    const metadata = ContentCredentialsMetadataSchema.parse({
      kind: "provenance.content-credentials",
      credentialId: "episode-001-export-provenance",
      targetAssetId: "asset-export",
      targetPath: "exports/episode-001.mp4",
      targetHash:
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      mode: "unsigned-manifest",
      signatureStatus: "unsigned",
      ingredients: [
        {
          assetId: "asset-panel-1",
          path: "assets/storyboards/panel-1.png",
          relationship: "generated-input",
          hash: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
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
          value:
            "Generated with local image backend; unsigned local manifest only.",
        },
      ],
      decisionLog: [
        "registered unsigned content credentials manifest episode-001-export-provenance",
        "did not sign C2PA manifest",
      ],
    });
    const fill = AssetMetadataFillActionSchema.parse({
      actionId: "content-credentials-episode-001-export-provenance",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-export",
      },
      metadataKind: "provenance.content-credentials",
      metadata,
      producer: "fixture",
    });

    const asset = applyAssetMetadataFill(
      { id: "asset-export", type: "video", metadata: {} },
      fill,
    );

    expect(asset.metadata["provenance.content-credentials"]).toMatchObject({
      credentialId: "episode-001-export-provenance",
      signatureStatus: "unsigned",
      ingredients: [
        expect.objectContaining({
          assetId: "asset-panel-1",
          relationship: "generated-input",
        }),
      ],
    });
  });

  it("projects MV lyrics alignment metadata into a structured caption item", () => {
    const metadata = LyricsAlignmentMetadataSchema.parse({
      kind: "audio.lyrics-alignment",
      fps: 30,
      lyricsSource: "lyrics.txt",
      units: [
        {
          lineId: "line-1",
          text: "tonight we rise",
          startMs: 0,
          endMs: 1000,
          startFrame: 0,
          endFrame: 30,
          confidence: 0.62,
          source: "beat-section-heuristic",
        },
        {
          lineId: "line-2",
          text: "into the light",
          startMs: 1000,
          endMs: 2500,
          startFrame: 30,
          endFrame: 75,
          confidence: 0.62,
          source: "beat-section-heuristic",
        },
      ],
      unmatchedRanges: [],
    });

    const fill = AssetMetadataFillActionSchema.parse({
      actionId: "action-lyrics-fill",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-song",
      },
      metadataKind: "audio.lyrics-alignment",
      metadata,
      producer: "fixture",
    });
    const asset = applyAssetMetadataFill(
      { id: "asset-song", type: "audio", metadata: {} },
      fill,
    );

    expect(asset.metadata["audio.lyrics-alignment"]).toMatchObject({
      lyricsSource: "lyrics.txt",
    });
    expect(
      buildCaptionItemFromLyricsAlignmentMetadata("lyrics-main", metadata, 0),
    ).toEqual({
      id: "lyrics-main",
      type: "text",
      text: "tonight we rise\ninto the light",
      color: "#ffffff",
      from: 0,
      durationInFrames: 75,
      cues: [
        {
          id: "line-1",
          startFrame: 0,
          durationInFrames: 30,
          text: "tonight we rise",
          wordIds: ["line-1"],
          sourceStartFrame: 0,
          sourceEndFrame: 30,
        },
        {
          id: "line-2",
          startFrame: 30,
          durationInFrames: 45,
          text: "into the light",
          wordIds: ["line-2"],
          sourceStartFrame: 30,
          sourceEndFrame: 75,
        },
      ],
      wordRefs: [
        {
          id: "line-1",
          text: "tonight we rise",
          sourceStartFrame: 0,
          sourceEndFrame: 30,
        },
        {
          id: "line-2",
          text: "into the light",
          sourceStartFrame: 30,
          sourceEndFrame: 75,
        },
      ],
      sourceToOutputMap: [
        {
          sourceStartFrame: 0,
          sourceEndFrame: 30,
          outputStartFrame: 0,
          outputEndFrame: 30,
        },
        {
          sourceStartFrame: 30,
          sourceEndFrame: 75,
          outputStartFrame: 30,
          outputEndFrame: 75,
        },
      ],
    });
  });

  it("fills visual moment metadata and ranks reusable source ranges for MV/TVC planning", () => {
    const metadata = VideoVisualMomentMetadataSchema.parse({
      kind: "video.visual-moments",
      sourceVideoAssetId: "asset-source-video",
      fps: 30,
      sourcePath: "assets/video/source.mp4",
      sceneChanges: [0, 45],
      candidates: [
        {
          id: "moment-hook",
          startMs: 0,
          endMs: 1500,
          peakMs: 900,
          startFrame: 0,
          endFrame: 45,
          peakFrame: 27,
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
    const fill = AssetMetadataFillActionSchema.parse({
      actionId: "action-visual-moments",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-source-video",
      },
      metadataKind: "video.visual-moments",
      metadata,
      producer: "fixture",
    });

    const asset = applyAssetMetadataFill(
      { id: "asset-source-video", type: "video", metadata: {} },
      fill,
    );

    expect(asset.metadata["video.visual-moments"]).toMatchObject({
      sourceVideoAssetId: "asset-source-video",
    });
    expect(
      buildVisualMomentClipLibrary(metadata).map((clip) => [
        clip.id,
        clip.assetId,
        clip.path,
        clip.sourceStartFrame,
        clip.sourceEndFrame,
        clip.score,
        clip.tags,
      ]),
    ).toEqual([
      [
        "moment-hook",
        "asset-source-video",
        "assets/video/source.mp4",
        0,
        45,
        0.822,
        ["drop", "product"],
      ],
      [
        "moment-soft",
        "asset-source-video",
        "assets/video/source.mp4",
        45,
        90,
        0.495,
        ["hold"],
      ],
    ]);
  });

  it("projects talking-head ASR/cut metadata into a real caption timeline item", () => {
    const metadata = TalkingHeadMetadataSchema.parse({
      kind: "talking-head.analysis",
      fps: 30,
      asr: {
        kind: "asr-transcript",
        sourcePath: "analysis/transcripts/talking-head.json",
        sourceHash:
          "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        backendId: "local-sensevoice",
        modelId: "iic/SenseVoiceSmall",
        language: "zh-CN",
        wordCount: 2,
        averageConfidence: 0.94,
      },
      words: [
        { id: "w1", text: "大家", startFrame: 0, endFrame: 12 },
        { id: "w2", text: "好", startFrame: 12, endFrame: 18 },
      ],
      cuts: [
        {
          id: "keep-1",
          sourceStartFrame: 0,
          sourceEndFrame: 60,
          outputStartFrame: 0,
          outputEndFrame: 60,
          action: "keep",
        },
      ],
      captionCues: [
        {
          id: "cue-1",
          startFrame: 0,
          durationInFrames: 45,
          text: "大家好",
          wordIds: ["w1", "w2"],
        },
      ],
    });

    expect(metadata.asr).toMatchObject({
      sourcePath: "analysis/transcripts/talking-head.json",
      backendId: "local-sensevoice",
      modelId: "iic/SenseVoiceSmall",
      language: "zh-CN",
      wordCount: 2,
      averageConfidence: 0.94,
    });
    expect(
      buildCaptionItemFromTalkingHeadMetadata("captions-main", metadata, 0),
    ).toEqual({
      id: "captions-main",
      type: "text",
      text: "大家好",
      color: "#ffffff",
      from: 0,
      durationInFrames: 45,
      cues: [
        {
          id: "cue-1",
          startFrame: 0,
          durationInFrames: 45,
          text: "大家好",
          wordIds: ["w1", "w2"],
          sourceStartFrame: 0,
          sourceEndFrame: 18,
        },
      ],
      wordRefs: [
        { id: "w1", text: "大家", sourceStartFrame: 0, sourceEndFrame: 12 },
        { id: "w2", text: "好", sourceStartFrame: 12, sourceEndFrame: 18 },
      ],
      sourceToOutputMap: [
        {
          sourceStartFrame: 0,
          sourceEndFrame: 60,
          outputStartFrame: 0,
          outputEndFrame: 60,
        },
      ],
    });
  });

  it("blocks TVC/reference remix when rights metadata does not allow derivatives", () => {
    const metadata = ReferenceVideoMetadataSchema.parse({
      kind: "reference-video.analysis",
      sourceUrl: "https://example.invalid/watch/123",
      rights: {
        license: "unknown",
        attribution: "unknown",
        redistributionAllowed: false,
        derivativeAllowed: false,
      },
      shots: [
        {
          id: "shot-1",
          startFrame: 0,
          endFrame: 60,
          description: "fast product push-in",
        },
      ],
      nonCopyingQa: { status: "requires-review", similarityScore: 0.71 },
    });

    expect(() => assertReferenceCanBeRemixed(metadata)).toThrow(
      /derivative use is not allowed/,
    );
    expect(buildReferenceRightsLedger("asset-reference", metadata)).toEqual({
      assetId: "asset-reference",
      sourceUrl: "https://example.invalid/watch/123",
      rights: metadata.rights,
      remixAllowed: false,
      blockedReasons: [
        "derivative use is not allowed",
        "redistribution is not allowed",
      ],
      allowedUses: [
        "metadata-analysis",
        "shot-analysis",
        "non-copying-reference",
      ],
      prohibitedUses: ["download-source", "copy-frames", "export-derivative"],
      shots: metadata.shots,
      nonCopyingQa: metadata.nonCopyingQa,
    });
  });

  it("fills controlled reference download metadata onto a quarantined local asset", () => {
    const metadata = ReferenceDownloadMetadataSchema.parse({
      kind: "reference.download",
      sourceUrl: "https://example.invalid/watch/tvc",
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
        sourceUrl: "https://example.invalid/watch/tvc",
        license: "analysis-only",
        attribution: "Example Brand",
        allowedUses: ["analysis-only", "shot-breakdown"],
        redistributionAllowed: false,
        derivativeAllowed: false,
      },
      decisionLog: [
        "executed controlled reference download from approved plan",
        "registered raw reference asset in quarantine",
      ],
    });
    const fill = AssetMetadataFillActionSchema.parse({
      actionId: "reference-download-asset-reference",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-reference",
      },
      metadataKind: "reference.download",
      producer: "clash-production-execute-reference-download",
      metadata,
    });
    const asset = applyAssetMetadataFill(
      { id: "asset-reference", type: "reference", metadata: {} },
      fill,
    );

    expect(asset.metadata["reference.download"]).toMatchObject({
      outputDir: "references/raw/asset-reference",
      rawReferenceQuarantine: true,
      finalExportAllowed: false,
    });
  });

  it("rejects reference download metadata that grants final export without derivative rights", () => {
    expect(() =>
      ReferenceDownloadMetadataSchema.parse({
        kind: "reference.download",
        sourceUrl: "https://example.invalid/watch/tvc",
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
        finalExportAllowed: true,
        sourceLedger: {
          sourceUrl: "https://example.invalid/watch/tvc",
          license: "raw-reference-redistribution-only",
          attribution: "Example Brand",
          allowedUses: ["analysis-only", "shot-breakdown", "final-export"],
          redistributionAllowed: true,
          derivativeAllowed: false,
        },
        decisionLog: [],
      }),
    ).toThrow(/final export requires derivative and redistribution rights/);
  });

  it("validates short-drama/image storyboard metadata with reference assets", () => {
    const metadata = ImageStoryboardMetadataSchema.parse({
      kind: "image.storyboard-consistency",
      characters: [
        {
          id: "hero",
          name: "便利店店员",
          referenceAssetIds: [
            "asset-hero-front",
            "asset-hero-side",
            "asset-hero-back",
          ],
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
      ],
      scenes: [
        {
          id: "store-night",
          referenceAssetIds: ["asset-store"],
          prompt: "night convenience store aisle",
        },
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
    });

    expect(metadata.characters[0].requiredViews).toEqual([
      "front",
      "side",
      "back",
    ]);
    expect(metadata.characters[0].referenceViews).toEqual([
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
    expect(metadata.panels[0]).toMatchObject({
      sceneId: "store-night",
      path: "assets/storyboards/panel-1.png",
      consistencyScore: 0.86,
    });
  });

  it("derives an editable storyboard prompt pack from storyboard metadata", () => {
    const metadata = ImageStoryboardMetadataSchema.parse({
      kind: "image.storyboard-consistency",
      characters: [
        {
          id: "hero",
          name: "便利店店员",
          referenceAssetIds: [
            "asset-hero-front",
            "asset-hero-side",
            "asset-hero-back",
          ],
          requiredViews: ["front", "side", "back"],
        },
      ],
      scenes: [
        {
          id: "store-night",
          referenceAssetIds: ["asset-store"],
          prompt: "night convenience store aisle",
        },
      ],
      panels: [
        {
          id: "panel-1",
          sceneId: "store-night",
          characterIds: ["hero"],
          assetId: "asset-panel-1",
        },
      ],
    });

    const promptPack = buildStoryboardPromptPackFromMetadata(
      "asset-storyboard",
      metadata,
      {
        stylePrompt: "vertical short drama, cinematic light",
        negativePrompt: "logo drift, extra fingers",
      },
    );

    expect(StoryboardPromptPackSchema.parse(promptPack)).toEqual(promptPack);
    expect(promptPack).toEqual({
      schemaVersion: 1,
      kind: "clash.storyboard.prompt-pack",
      storyboardAssetId: "asset-storyboard",
      prompts: [
        {
          id: "prompt-panel-1",
          panelId: "panel-1",
          sceneId: "store-night",
          characterIds: ["hero"],
          prompt:
            "night convenience store aisle; characters: 便利店店员; style: vertical short drama, cinematic light",
          negativePrompt: "logo drift, extra fingers",
          outputAssetId: "asset-panel-1",
          outputPath: "assets/generated/storyboards/panel-1.png",
        },
      ],
    });
  });

  it("fills TVC delivery metadata with packshot and end-card QA requirements", () => {
    const metadata = AdDeliveryMetadataSchema.parse({
      kind: "ad.delivery-spec",
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
    });
    const fill = AssetMetadataFillActionSchema.parse({
      actionId: "action-ad-delivery",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-tvc",
      },
      metadataKind: "ad.delivery-spec",
      metadata,
      producer: "fixture",
    });

    const asset = applyAssetMetadataFill(
      { id: "asset-tvc", type: "video", metadata: {} },
      fill,
    );

    expect(asset.metadata["ad.delivery-spec"]).toMatchObject({
      brand: "Clash Skin",
      rightsLedgerAssetId: "asset-reference",
    });
    expect(buildAdDeliveryChecklist(metadata)).toEqual([
      {
        id: "duration:tiktok-9x16-15s",
        label: "tiktok duration 15s",
        required: true,
      },
      {
        id: "safe-zone:tiktok-9x16-15s",
        label: "tiktok safe zones top/right/bottom/left 120/48/220/48",
        required: true,
      },
      {
        id: "subtitles:tiktok-9x16-15s",
        label: "tiktok subtitles required",
        required: true,
      },
      {
        id: "packshot",
        label: "packshot asset asset-packshot frames 360-420",
        required: true,
      },
      {
        id: "end-card",
        label: "end card 90 frames with CTA Shop now",
        required: true,
      },
      { id: "disclaimer", label: "disclaimer text present", required: true },
      {
        id: "rights-ledger",
        label: "rights ledger linked to asset-reference",
        required: true,
      },
    ]);
  });

  it("builds an ad delivery export validation receipt from probe and visual QA evidence", () => {
    const receipt = buildAdDeliveryExportValidationReceipt({
      deliverySpec: {
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
          qrRequired: false,
        },
        rightsLedgerAssetId: "asset-reference",
        checklist: [],
      },
      variantId: "tiktok-9x16-15s",
      renderedPath: "exports/tiktok-15s.mp4",
      probe: {
        width: 1080,
        height: 1920,
        fps: 30,
        durationSeconds: 15.02,
        hasVideo: true,
        hasAudio: true,
      },
      visualQa: {
        captionsPresent: true,
        safeZoneViolations: [],
        packshotVisible: true,
        endCardVisible: true,
        disclaimerVisible: true,
        ctaVisible: true,
        finalFrameHolds: true,
      },
    });

    expect(AdDeliveryExportValidationReceiptSchema.parse(receipt)).toEqual(
      receipt,
    );
    expect(receipt.verdict).toBe("pass");
    expect(receipt.checks.map((check) => [check.id, check.status])).toEqual([
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

  it("fills ad visual QA metadata from local evidence without running OCR or pixel analysis", () => {
    const metadata = AdVisualQaMetadataSchema.parse({
      kind: "ad.visual-qa",
      targetAssetId: "asset-tvc",
      variantId: "tiktok-9x16-15s",
      renderedPath: "exports/tiktok-15s.mp4",
      evidencePath: "analysis/visual/tiktok-15s.evidence.json",
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
        "did not execute OCR/logo/pixel analysis backends",
      ],
    });
    const fill = AssetMetadataFillActionSchema.parse({
      actionId: "ad-visual-qa-tiktok-9x16-15s",
      target: {
        kind: "project-asset",
        projectId: "project-cut",
        assetId: "asset-tvc",
      },
      metadataKind: "ad.visual-qa",
      metadata,
      producer: "fixture",
    });

    const asset = applyAssetMetadataFill(
      { id: "asset-tvc", type: "video", metadata: {} },
      fill,
    );

    expect(asset.metadata["ad.visual-qa"]).toMatchObject({
      variantId: "tiktok-9x16-15s",
      verdict: "pass",
      visualQa: {
        packshotVisible: true,
        logoLockupVisible: true,
        finalFrameHolds: true,
      },
    });
  });

  it("fails ad delivery export validation when duration and visual gates do not match the spec", () => {
    const receipt = buildAdDeliveryExportValidationReceipt({
      deliverySpec: {
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
          qrRequired: false,
        },
        checklist: [],
      },
      variantId: "tiktok-9x16-15s",
      renderedPath: "exports/tiktok-15s.mp4",
      probe: {
        width: 1080,
        height: 1920,
        fps: 30,
        durationSeconds: 12.4,
        hasVideo: true,
        hasAudio: true,
      },
      visualQa: {
        captionsPresent: false,
        safeZoneViolations: [
          {
            frame: 42,
            description: "CTA overlaps bottom UI safe zone",
            severity: "error",
          },
        ],
        packshotVisible: false,
        endCardVisible: true,
        disclaimerVisible: false,
      },
    });

    expect(receipt.verdict).toBe("fail");
    expect(
      receipt.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.id),
    ).toEqual(["duration", "safe-zone", "subtitles", "packshot", "disclaimer"]);
  });
});
