import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AssetMetadataFillActionSchema,
  applyAssetMetadataFill,
  assertReferenceCanBeRemixed,
  buildAdDeliveryChecklist,
  buildBeatEditHints,
  buildBeatSectionCutPlan,
  buildCaptionItemFromLyricsAlignmentMetadata,
  buildCaptionItemFromTalkingHeadMetadata,
  buildReferenceRightsLedger,
  buildVisualMomentClipLibrary,
  type AudioStemSeparationMetadata,
  type ImageStoryboardMetadata,
  type ImageComfyuiRunnerMetadata,
  type ImageEmbeddingStoreItem,
  type ProductionMetadata,
  ProductionMetadataSchema,
  type SemanticReferenceRole,
  timelineDslToYaml,
} from "@clash/shared-types";
import {
  assertProjectionLockFilePath,
  createProjectionLock,
  hashProjectionContent,
  parseProjectionLock,
  type ProjectionLock,
  resolveProjectionFilePathInsideCwd,
  resolveProjectionLockPathInsideCwd,
  resolveProjectionLockSidecarPathInsideCwd,
} from "./projection-cas";

type ProductionAssetManifestAsset = {
  id: string;
  type: string;
  path?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

type ProductionAssetManifest = {
  assets: ProductionAssetManifestAsset[];
  [key: string]: unknown;
};

export type ApplyProductionMetadataActionOptions = {
  cwd: string;
  actionPath: string;
  assetsPath?: string;
};

export type ApplyProductionMetadataActionResult = {
  applied: true;
  targetAssetId: string;
  metadataKind: string;
  assetsPath: string;
  metadataPath: string;
  metadataLockPath: string;
  projectionLockPaths: string[];
  timelineProjectionPath?: string;
  transcriptCutPlanPath?: string;
  transcriptProjectionPath?: string;
  shotAnalysisProjectionPath?: string;
  blockedReason?: string;
  rightsLedgerPath?: string;
};

type AssetMetadataProjectionLock = ProjectionLock & {
  targetAssetId: string;
  metadataKind: string;
  metadataHash?: string;
  sourceActionPath?: string;
  sourceActionHash?: string;
  appliedFromProjection?: boolean;
  previousMetadataHash?: string;
};

export type ApplyProductionMetadataProjectionOptions = {
  cwd: string;
  filePath: string;
  assetsPath?: string;
  lockPath?: string;
  force?: boolean;
};

export type ApplyProductionMetadataProjectionResult = {
  applied: true;
  targetAssetId: string;
  metadataKind: string;
  assetsPath: string;
  metadataPath: string;
  lockPath: string;
  beforeMetadataHash: string;
  afterMetadataHash: string;
  forced: boolean;
};

export async function applyProductionMetadataAction(
  options: ApplyProductionMetadataActionOptions,
): Promise<ApplyProductionMetadataActionResult> {
  const cwd = options.cwd;
  const actionPath = resolveLocalPath(cwd, options.actionPath, "action");
  const assetsPath = resolveLocalPath(cwd, options.assetsPath ?? join("assets", "manifest.json"), "asset manifest");
  const action = AssetMetadataFillActionSchema.parse(
    JSON.parse(await readFile(actionPath, "utf8")),
  );
  const targetAssetFileStem = safeProjectionFileSegment(action.targetAssetId, "targetAssetId");
  const metadataKindFileStem = safeProjectionFileSegment(action.metadataKind, "metadataKind");
  const branchFileStems = productionMetadataFileStems(action.metadata);
  preflightProductionMetadataGeneratedAssetPaths(action.metadata);
  const metadataPath = resolveProjectionFilePathInsideCwd({
    cwd,
    filePath: join(
      cwd,
      "projections",
      "metadata",
      `${targetAssetFileStem}.${metadataKindFileStem}.json`,
    ),
  });
  const metadataLockPath = resolveProjectionLockPathInsideCwd({ filePath: metadataPath, cwd });
  const manifest = parseAssetManifest(await readFile(assetsPath, "utf8"), assetsPath);
  const assetIndex = manifest.assets.findIndex((asset) => asset.id === action.targetAssetId);
  if (assetIndex < 0) {
    throw new Error(`Asset ${action.targetAssetId} not found in ${assetsPath}`);
  }

  const updatedAsset = applyAssetMetadataFill(manifest.assets[assetIndex], action);
  manifest.assets[assetIndex] = updatedAsset;
  await writeJson(assetsPath, manifest);

  await writeJson(metadataPath, action.metadata);
  await writeJson(metadataLockPath, createAssetMetadataLock({
    cwd,
    targetAssetId: action.targetAssetId,
    metadataKind: action.metadataKind,
    metadata: action.metadata,
    metadataPath,
    actionPath,
    action,
  }));

  const result: ApplyProductionMetadataActionResult = {
    applied: true,
    targetAssetId: action.targetAssetId,
    metadataKind: action.metadataKind,
    assetsPath,
    metadataPath,
    metadataLockPath,
    projectionLockPaths: [metadataLockPath],
  };

  const writeDerivedProjectionJson = async (
    projectionPath: string,
    projectionKind: string,
    value: Record<string, unknown>,
  ): Promise<void> => {
    const safeProjectionPath = resolveProjectionFilePathInsideCwd({ filePath: projectionPath, cwd });
    await writeJson(safeProjectionPath, value);
    const lockPath = resolveProjectionLockPathInsideCwd({ filePath: safeProjectionPath, cwd });
    await writeJson(lockPath, createAssetMetadataProjectionLock({
      cwd,
      targetAssetId: action.targetAssetId,
      metadataKind: action.metadataKind,
      metadata: action.metadata,
      metadataPath,
      projectionKind,
      projection: value,
      projectionPath: safeProjectionPath,
      actionPath,
      action,
    }));
    result.projectionLockPaths.push(lockPath);
  };

  switch (action.metadata.kind) {
    case "audio.beat-analysis": {
      const hintsPath = join(cwd, "projections", "timeline-hints", `${targetAssetFileStem}.beat-hints.json`);
      await writeDerivedProjectionJson(hintsPath, "audio-beat-hints", {
        assetId: action.targetAssetId,
        metadataKind: action.metadataKind,
        hints: buildBeatEditHints(action.metadata),
        sections: action.metadata.sections,
        energyCurve: action.metadata.energyCurve,
        cuts: buildBeatSectionCutPlan(action.metadata),
      });
      result.timelineProjectionPath = hintsPath;
      break;
    }
    case "audio.lyrics-alignment": {
      const lyricsProjectionPath = join(cwd, "projections", "lyrics", `${targetAssetFileStem}.lyrics-alignment.json`);
      await writeDerivedProjectionJson(lyricsProjectionPath, "audio-lyrics-alignment", {
        schemaVersion: 1,
        kind: "clash.audio.lyrics-alignment.projection",
        targetAssetId: action.targetAssetId,
        fps: action.metadata.fps,
        lyricsSource: action.metadata.lyricsSource,
        vocalStemAssetId: action.metadata.vocalStemAssetId,
        units: action.metadata.units,
        unmatchedRanges: action.metadata.unmatchedRanges,
        reviewRequired: action.metadata.units.some((unit) => unit.confidence < 0.7),
      });
      const captionItem = buildCaptionItemFromLyricsAlignmentMetadata(
        `${action.targetAssetId}-lyrics`,
        action.metadata,
        0,
      );
      const timelinePath = join(cwd, "projections", "timelines", `${targetAssetFileStem}.lyrics.caption.timeline.yaml`);
      const timelineYaml = timelineDslToYaml({
        compositionWidth: 1080,
        compositionHeight: 1920,
        fps: action.metadata.fps,
        durationInFrames: captionItem.durationInFrames,
        tracks: [
          {
            id: "lyrics",
            name: "Lyrics",
            role: "subtitle",
            items: [captionItem],
          },
        ],
      } as any);
      await writeText(timelinePath, timelineYaml);
      result.timelineProjectionPath = timelinePath;
      break;
    }
    case "audio.stem-separation": {
      const stemProjectionPath = join(
        cwd,
        "projections",
        "audio",
        `${targetAssetFileStem}.${branchFileStems.separationId}.stem-separation.json`,
      );
      await writeDerivedProjectionJson(stemProjectionPath, "audio-stem-separation", {
        schemaVersion: 1,
        kind: "clash.audio.stem-separation.projection",
        targetAssetId: action.targetAssetId,
        separationId: action.metadata.separationId,
        sourceAssetId: action.metadata.sourceAssetId,
        sourcePath: action.metadata.sourcePath,
        backendId: action.metadata.backendId,
        modelId: action.metadata.modelId,
        stems: action.metadata.stems,
        vocalStemAssetId: action.metadata.vocalStemAssetId,
        decisionLog: action.metadata.decisionLog,
      });
      upsertAudioStemAssets(manifest, action.metadata);
      await writeJson(assetsPath, manifest);
      result.timelineProjectionPath = stemProjectionPath;
      break;
    }
    case "talking-head.analysis": {
      if (action.metadata.asr) {
        const transcriptProjectionPath = join(
          cwd,
          "projections",
          "transcripts",
          `${targetAssetFileStem}.asr-transcript.json`,
        );
        await writeDerivedProjectionJson(transcriptProjectionPath, "talking-head-asr-transcript", {
          schemaVersion: 1,
          targetAssetId: action.targetAssetId,
          ...action.metadata.asr,
          transcriptKind: action.metadata.asr.kind,
          kind: "clash.talking-head.asr-transcript.projection",
          words: action.metadata.words,
        });
        result.transcriptProjectionPath = transcriptProjectionPath;
      }
      const captionItem = buildCaptionItemFromTalkingHeadMetadata(
        `${action.targetAssetId}-captions`,
        action.metadata,
        0,
      );
      const transcriptCutPlanPath = join(
        cwd,
        "projections",
        "media-cuts",
        `${targetAssetFileStem}.transcript-cut-plan.json`,
      );
      await writeDerivedProjectionJson(transcriptCutPlanPath, "talking-head-transcript-cut-plan", {
        schemaVersion: 1,
        kind: "clash.talking-head.transcript-cut-plan.projection",
        sourceAssetId: action.targetAssetId,
        strategy: "conservative",
        fps: action.metadata.fps,
        asr: action.metadata.asr,
        disfluencies: action.metadata.disfluencies,
        cuts: action.metadata.cuts,
        sourceToOutputMap: captionItem.sourceToOutputMap,
        captionTrack: captionItem,
      });
      result.transcriptCutPlanPath = transcriptCutPlanPath;
      const timelinePath = join(cwd, "projections", "timelines", `${targetAssetFileStem}.caption.timeline.yaml`);
      const timelineYaml = timelineDslToYaml({
        compositionWidth: 1080,
        compositionHeight: 1920,
        fps: action.metadata.fps,
        durationInFrames: captionItem.durationInFrames,
        tracks: [
          {
            id: "subtitles",
            name: "Subtitles",
            role: "subtitle",
            items: [captionItem],
          },
        ],
      } as any);
      await writeText(timelinePath, timelineYaml);
      result.timelineProjectionPath = timelinePath;
      break;
    }
    case "reference-video.analysis": {
      let blockedReason: string | undefined;
      try {
        assertReferenceCanBeRemixed(action.metadata);
      } catch (error) {
        blockedReason = error instanceof Error ? error.message : String(error);
      }
      const rightsLedger = buildReferenceRightsLedger(action.targetAssetId, action.metadata);
      const rightsLedgerPath = join(cwd, "projections", "rights", `${targetAssetFileStem}.rights-ledger.json`);
      await writeDerivedProjectionJson(rightsLedgerPath, "reference-rights-ledger", rightsLedger);
      const shotAnalysisPath = join(cwd, "projections", "references", `${targetAssetFileStem}.shot-analysis.json`);
      await writeDerivedProjectionJson(shotAnalysisPath, "reference-shot-analysis", {
        schemaVersion: 1,
        kind: "clash.reference.shot-analysis.projection",
        targetAssetId: action.targetAssetId,
        sourceUrl: action.metadata.sourceUrl,
        rightsLedgerPath,
        analysisOnly: true,
        mediaCopied: false,
        finalExportAllowed: rightsLedger.remixAllowed,
        allowedUses: rightsLedger.allowedUses,
        prohibitedUses: rightsLedger.prohibitedUses,
        shots: action.metadata.shots,
      });
      const reviewPath = join(cwd, "projections", "references", `${targetAssetFileStem}.reference-review.json`);
      await writeDerivedProjectionJson(reviewPath, "reference-review", {
        assetId: action.targetAssetId,
        remixAllowed: !blockedReason,
        blockedReason,
        rightsLedgerPath,
        sourceUrl: action.metadata.sourceUrl,
        rights: action.metadata.rights,
        nonCopyingQa: action.metadata.nonCopyingQa,
        shots: action.metadata.shots,
      });
      result.blockedReason = blockedReason;
      result.rightsLedgerPath = rightsLedgerPath;
      result.shotAnalysisProjectionPath = shotAnalysisPath;
      break;
    }
    case "video.visual-moments": {
      const visualMomentsPath = join(
        cwd,
        "projections",
        "visual-moments",
        `${targetAssetFileStem}.visual-moments.json`,
      );
      await writeDerivedProjectionJson(visualMomentsPath, "video-visual-moments", {
        schemaVersion: 1,
        kind: "clash.video.visual-moments.projection",
        sourceVideoAssetId: action.metadata.sourceVideoAssetId,
        fps: action.metadata.fps,
        sourcePath: action.metadata.sourcePath,
        sceneChanges: action.metadata.sceneChanges,
        candidates: action.metadata.candidates,
        recommendedClips: buildVisualMomentClipLibrary(action.metadata),
      });
      break;
    }
    case "image.storyboard-consistency": {
      const storyboardPath = join(cwd, "projections", "storyboards", `${targetAssetFileStem}.storyboard.json`);
      await writeDerivedProjectionJson(storyboardPath, "image-storyboard", {
        assetId: action.targetAssetId,
        characters: action.metadata.characters,
        scenes: action.metadata.scenes,
        panels: action.metadata.panels,
      });
      upsertCharacterReferenceSheetAssets(manifest, action.targetAssetId, action.metadata.characters);
      upsertStoryboardPanelAssets(manifest, action.targetAssetId, action.metadata.panels);
      await writeJson(assetsPath, manifest);
      break;
    }
    case "image.semantic-reference-roles": {
      const projectionPath = join(
        cwd,
        "projections",
        "references",
        `${targetAssetFileStem}.semantic-reference-roles.json`,
      );
      await writeDerivedProjectionJson(projectionPath, "image-semantic-reference-roles", {
        schemaVersion: 1,
        kind: "clash.image.semantic-reference-roles.projection",
        targetAssetId: action.targetAssetId,
        roles: action.metadata.roles,
        copyOnWriteRequired: action.metadata.roles.every((role) => role.copyOnWriteRequired),
      });
      upsertSemanticReferenceRoleAssets(manifest, action.targetAssetId, action.metadata.roles);
      await writeJson(assetsPath, manifest);
      break;
    }
    case "image.product-logo-qa": {
      const qaPath = join(cwd, "projections", "qa", `${targetAssetFileStem}.product-logo-qa.json`);
      await writeDerivedProjectionJson(qaPath, "image-product-logo-qa", {
        schemaVersion: 1,
        kind: "clash.image.product-logo-qa.projection",
        targetAssetId: action.targetAssetId,
        referencePackAssetId: action.metadata.referencePackAssetId,
        requiredReferenceAssetIds: action.metadata.requiredReferenceAssetIds,
        references: action.metadata.references,
        checks: action.metadata.checks,
        verdict: action.metadata.verdict,
        blockedReasons: action.metadata.blockedReasons,
        copyOnWriteRequired: action.metadata.copyOnWriteRequired,
      });
      break;
    }
    case "analysis.backend-benchmark": {
      const analysisPath = join(
        cwd,
        "projections",
        "analysis",
        `${targetAssetFileStem}.${branchFileStems.benchmarkId}.backend-benchmark.json`,
      );
      await writeDerivedProjectionJson(analysisPath, "analysis-backend-benchmark", {
        schemaVersion: 1,
        kind: "clash.analysis.backend-benchmark.projection",
        targetAssetId: action.targetAssetId,
        benchmarkId: action.metadata.benchmarkId,
        targetCapability: action.metadata.targetCapability,
        fixtureSetPath: action.metadata.fixtureSetPath,
        candidates: action.metadata.candidates,
        selectedBackendId: action.metadata.selectedBackendId,
        verdict: action.metadata.verdict,
        blockedReasons: action.metadata.blockedReasons,
        decisionLog: action.metadata.decisionLog,
      });
      break;
    }
    case "image.embedding-store": {
      const embeddingPath = join(
        cwd,
        "projections",
        "embeddings",
        `${targetAssetFileStem}.${branchFileStems.embeddingSetId}.embedding-store.json`,
      );
      await writeDerivedProjectionJson(embeddingPath, "image-embedding-store", {
        schemaVersion: 1,
        kind: "clash.image.embedding-store.projection",
        targetAssetId: action.targetAssetId,
        embeddingSetId: action.metadata.embeddingSetId,
        modelId: action.metadata.modelId,
        dimension: action.metadata.dimension,
        distanceMetric: action.metadata.distanceMetric,
        items: action.metadata.items,
        copyOnWriteRequired: action.metadata.copyOnWriteRequired,
      });
      upsertImageEmbeddingAssets(manifest, action.metadata.embeddingSetId, action.metadata.items);
      await writeJson(assetsPath, manifest);
      break;
    }
    case "image.comfyui-runner": {
      const comfyuiPath = join(
        cwd,
        "projections",
        "image",
        `${targetAssetFileStem}.${branchFileStems.workflowId}.comfyui-runner.json`,
      );
      await writeDerivedProjectionJson(comfyuiPath, "image-comfyui-runner", {
        schemaVersion: 1,
        kind: "clash.image.comfyui-runner.projection",
        targetAssetId: action.targetAssetId,
        workflowId: action.metadata.workflowId,
        workflowPath: action.metadata.workflowPath,
        workflowHash: action.metadata.workflowHash,
        apiFormat: action.metadata.apiFormat,
        backendId: action.metadata.backendId,
        models: action.metadata.models,
        customNodes: action.metadata.customNodes,
        inputs: action.metadata.inputs,
        outputs: action.metadata.outputs,
        execution: action.metadata.execution,
        decisionLog: action.metadata.decisionLog,
      });
      upsertComfyuiOutputAssets(manifest, action.targetAssetId, action.metadata);
      await writeJson(assetsPath, manifest);
      result.timelineProjectionPath = comfyuiPath;
      break;
    }
    case "ad.delivery-spec": {
      const deliveryPath = join(cwd, "projections", "delivery", `${targetAssetFileStem}.delivery-spec.json`);
      await writeDerivedProjectionJson(deliveryPath, "ad-delivery-spec", {
        schemaVersion: 1,
        kind: "clash.ad.delivery-spec.projection",
        targetAssetId: action.targetAssetId,
        brand: action.metadata.brand,
        fps: action.metadata.fps,
        platforms: action.metadata.platforms,
        variants: action.metadata.variants,
        packshot: action.metadata.packshot,
        endCard: action.metadata.endCard,
        rightsLedgerAssetId: action.metadata.rightsLedgerAssetId,
        checklist: buildAdDeliveryChecklist(action.metadata),
      });
      break;
    }
    case "ad.visual-qa": {
      const qaPath = join(
        cwd,
        "projections",
        "qa",
        `${targetAssetFileStem}.${branchFileStems.variantId}.ad-visual-qa.json`,
      );
      await writeDerivedProjectionJson(qaPath, "ad-visual-qa", {
        schemaVersion: 1,
        kind: "clash.ad.visual-qa.projection",
        targetAssetId: action.targetAssetId,
        variantId: action.metadata.variantId,
        renderedPath: action.metadata.renderedPath,
        evidencePath: action.metadata.evidencePath,
        checks: action.metadata.checks,
        verdict: action.metadata.verdict,
        blockedReasons: action.metadata.blockedReasons,
        visualQa: action.metadata.visualQa,
        decisionLog: action.metadata.decisionLog,
      });
      result.timelineProjectionPath = qaPath;
      break;
    }
    case "provenance.content-credentials": {
      const provenancePath = join(
        cwd,
        "projections",
        "provenance",
        `${targetAssetFileStem}.${branchFileStems.credentialId}.content-credentials.json`,
      );
      await writeDerivedProjectionJson(provenancePath, "provenance-content-credentials", {
        schemaVersion: 1,
        kind: "clash.provenance.content-credentials.projection",
        targetAssetId: action.targetAssetId,
        credentialId: action.metadata.credentialId,
        targetPath: action.metadata.targetPath,
        targetHash: action.metadata.targetHash,
        mode: action.metadata.mode,
        signatureStatus: action.metadata.signatureStatus,
        c2paManifestPath: action.metadata.c2paManifestPath,
        c2paManifestHash: action.metadata.c2paManifestHash,
        issuer: action.metadata.issuer,
        ingredients: action.metadata.ingredients,
        actions: action.metadata.actions,
        assertions: action.metadata.assertions,
        decisionLog: action.metadata.decisionLog,
      });
      result.timelineProjectionPath = provenancePath;
      break;
    }
  }

  return result;
}

export async function applyProductionMetadataProjection(
  options: ApplyProductionMetadataProjectionOptions,
): Promise<ApplyProductionMetadataProjectionResult> {
  const cwd = options.cwd;
  const metadataPath = resolveLocalPath(cwd, options.filePath, "metadata projection");
  const lockPath = options.lockPath
    ? resolveProjectionLockSidecarPathInsideCwd({ lockPath: options.lockPath, cwd })
    : resolveProjectionLockPathInsideCwd({ filePath: metadataPath, cwd });
  const assetsPath = resolveLocalPath(cwd, options.assetsPath ?? join("assets", "manifest.json"), "asset manifest");
  const lock = parseAssetMetadataProjectionLock(await readFile(lockPath, "utf8"));
  const filePathResult = assertProjectionLockFilePath({
    label: "asset metadata",
    lockFilePath: lock.filePath,
    filePath: metadataPath,
    cwd,
    force: options.force,
    readCommand: "clash production apply-metadata",
    writeVerb: "Apply",
  });
  if (!filePathResult.ok) throw new Error(filePathResult.error);

  const metadata = ProductionMetadataSchema.parse(
    JSON.parse(await readFile(metadataPath, "utf8")),
  );
  if (metadata.kind !== lock.metadataKind) {
    throw new Error(`metadata kind mismatch: ${metadata.kind} does not match lock ${lock.metadataKind}`);
  }
  const manifest = parseAssetManifest(await readFile(assetsPath, "utf8"), assetsPath);
  const assetIndex = manifest.assets.findIndex((asset) => asset.id === lock.targetAssetId);
  if (assetIndex < 0) {
    throw new Error(`Asset ${lock.targetAssetId} not found in ${assetsPath}`);
  }

  const currentMetadata = manifest.assets[assetIndex].metadata?.[lock.metadataKind];
  const beforeMetadataHash = productionMetadataHash(currentMetadata ?? null);
  if (!options.force && beforeMetadataHash !== lock.contentHash) {
    throw new Error(
      `Stale asset metadata apply rejected. Manifest metadata hash is ${beforeMetadataHash}, ` +
      `but lock was pulled from ${lock.contentHash}. Run \`clash production apply-metadata\` again and merge, or pass --force to intentionally overwrite.`,
    );
  }

  const afterMetadataHash = productionMetadataHash(metadata);
  manifest.assets[assetIndex] = applyAssetMetadataFill(manifest.assets[assetIndex], {
    actionId: `metadata-projection-apply:${afterMetadataHash}`,
    targetAssetId: lock.targetAssetId,
    metadataKind: lock.metadataKind,
    metadata,
    producer: "clash production apply-metadata-projection",
    createdAt: new Date().toISOString(),
  });
  await writeJson(assetsPath, manifest);
  await writeJson(lockPath, createAppliedAssetMetadataLock({
    cwd,
    targetAssetId: lock.targetAssetId,
    metadataKind: lock.metadataKind,
    metadataPath,
    metadataHash: afterMetadataHash,
    previousMetadataHash: beforeMetadataHash,
    sourceActionPath: lock.sourceActionPath,
    sourceActionHash: lock.sourceActionHash,
  }));

  return {
    applied: true,
    targetAssetId: lock.targetAssetId,
    metadataKind: lock.metadataKind,
    assetsPath,
    metadataPath,
    lockPath,
    beforeMetadataHash,
    afterMetadataHash,
    forced: Boolean(options.force),
  };
}

function upsertImageEmbeddingAssets(
  manifest: ProductionAssetManifest,
  embeddingSetId: string,
  items: ImageEmbeddingStoreItem[],
): void {
  for (const item of items) {
    const existingIndex = manifest.assets.findIndex((asset) => asset.id === item.assetId);
    const embeddingMetadata = {
      embeddingSetId,
      ...(item.roleId ? { roleId: item.roleId } : {}),
      ...(item.subjectId ? { subjectId: item.subjectId } : {}),
      path: normalizeProjectRelativePath(item.path, `embedding item ${item.assetId} path`),
      vectorPath: normalizeProjectRelativePath(item.vectorPath, `embedding item ${item.assetId} vectorPath`),
      vectorHash: item.vectorHash,
      dimension: item.dimension,
      baselineFor: item.baselineFor,
      locked: item.locked,
      copyOnWriteRequired: item.copyOnWriteRequired,
      tags: item.tags,
    };
    if (existingIndex >= 0) {
      const existing = manifest.assets[existingIndex];
      manifest.assets[existingIndex] = {
        ...existing,
        path: existing.path ?? embeddingMetadata.path,
        metadata: {
          ...(existing.metadata ?? {}),
          "image.embedding": embeddingMetadata,
        },
      };
    } else {
      manifest.assets.push({
        id: item.assetId,
        type: "image",
        path: embeddingMetadata.path,
        metadata: {
          "image.embedding": embeddingMetadata,
        },
      });
    }
  }
}

function upsertAudioStemAssets(
  manifest: ProductionAssetManifest,
  metadata: AudioStemSeparationMetadata,
): void {
  for (const stem of metadata.stems) {
    const filePath = normalizeProjectRelativePath(stem.filePath, `audio stem ${stem.stemAssetId} filePath`);
    const existingIndex = manifest.assets.findIndex((asset) => asset.id === stem.stemAssetId);
    const stemMetadata = {
      separationId: metadata.separationId,
      sourceAssetId: metadata.sourceAssetId,
      stemAssetId: stem.stemAssetId,
      stemType: stem.stemType,
      filePath,
      fileHash: stem.fileHash,
      ...(stem.codec ? { codec: stem.codec } : {}),
      ...(stem.durationSeconds === undefined ? {} : { durationSeconds: stem.durationSeconds }),
      ...(stem.sampleRate === undefined ? {} : { sampleRate: stem.sampleRate }),
      ...(stem.channels === undefined ? {} : { channels: stem.channels }),
    };
    if (existingIndex >= 0) {
      const existing = manifest.assets[existingIndex];
      manifest.assets[existingIndex] = {
        ...existing,
        path: existing.path ?? filePath,
        metadata: {
          ...(existing.metadata ?? {}),
          "audio.stem": stemMetadata,
        },
      };
    } else {
      manifest.assets.push({
        id: stem.stemAssetId,
        type: "audio-stem",
        path: filePath,
        metadata: {
          "audio.stem": stemMetadata,
        },
      });
    }
  }
}

function upsertComfyuiOutputAssets(
  manifest: ProductionAssetManifest,
  targetAssetId: string,
  metadata: ImageComfyuiRunnerMetadata,
): void {
  for (const output of metadata.outputs) {
    const outputPath = normalizeProjectRelativePath(output.path, `ComfyUI output ${output.outputAssetId} path`);
    const existingIndex = manifest.assets.findIndex((asset) => asset.id === output.outputAssetId);
    const outputMetadata = {
      workflowId: metadata.workflowId,
      sourceJobAssetId: targetAssetId,
      workflowPath: metadata.workflowPath,
      workflowHash: metadata.workflowHash,
      nodeId: output.nodeId,
      ...(output.outputName ? { outputName: output.outputName } : {}),
      mediaType: output.mediaType,
      path: outputPath,
      ...(output.fileHash ? { fileHash: output.fileHash } : {}),
      status: output.status,
      backendId: metadata.backendId,
      models: metadata.models,
      customNodes: metadata.customNodes,
    };
    const assetType = output.mediaType === "image" ? "image" : output.mediaType;
    if (existingIndex >= 0) {
      const existing = manifest.assets[existingIndex];
      manifest.assets[existingIndex] = {
        ...existing,
        type: existing.type || assetType,
        path: existing.path ?? outputPath,
        metadata: {
          ...(existing.metadata ?? {}),
          "image.comfyui-output": outputMetadata,
        },
      };
    } else {
      manifest.assets.push({
        id: output.outputAssetId,
        type: assetType,
        path: outputPath,
        metadata: {
          "image.comfyui-output": outputMetadata,
        },
      });
    }
  }
}

function upsertSemanticReferenceRoleAssets(
  manifest: ProductionAssetManifest,
  rolePackAssetId: string,
  roles: SemanticReferenceRole[],
): void {
  for (const role of roles) {
    const existingIndex = manifest.assets.findIndex((asset) => asset.id === role.assetId);
    const roleMetadata = {
      rolePackAssetId,
      roleId: role.roleId,
      role: role.role,
      ...(role.subjectId ? { subjectId: role.subjectId } : {}),
      path: normalizeProjectRelativePath(role.path, `reference role ${role.roleId} path`),
      locked: role.locked,
      copyOnWriteRequired: role.copyOnWriteRequired,
      downstreamUsage: role.downstreamUsage,
      constraints: role.constraints,
    };
    if (existingIndex >= 0) {
      const existing = manifest.assets[existingIndex];
      manifest.assets[existingIndex] = {
        ...existing,
        path: existing.path ?? roleMetadata.path,
        metadata: {
          ...(existing.metadata ?? {}),
          "image.semantic-reference-role": roleMetadata,
        },
      };
    } else {
      manifest.assets.push({
        id: role.assetId,
        type: "reference",
        path: roleMetadata.path,
        metadata: {
          "image.semantic-reference-role": roleMetadata,
        },
      });
    }
  }
}

function upsertCharacterReferenceSheetAssets(
  manifest: ProductionAssetManifest,
  storyboardAssetId: string,
  characters: ImageStoryboardMetadata["characters"],
): void {
  for (const character of characters) {
    for (const reference of character.referenceViews) {
      const referencePath = normalizeProjectRelativePath(
        reference.path,
        `character reference ${character.id} ${reference.view} path`,
      );
      const referenceMetadata = {
        storyboardAssetId,
        characterId: character.id,
        view: reference.view,
        path: referencePath,
        locked: reference.locked,
        copyOnWriteRequired: reference.copyOnWriteRequired,
        downstreamUsage: "identity-reference",
      };
      const existingIndex = manifest.assets.findIndex((asset) => asset.id === reference.assetId);
      if (existingIndex >= 0) {
        const existing = manifest.assets[existingIndex];
        manifest.assets[existingIndex] = {
          ...existing,
          path: existing.path ?? referencePath,
          metadata: {
            ...(existing.metadata ?? {}),
            "image.character-reference-sheet": referenceMetadata,
          },
        };
      } else {
        manifest.assets.push({
          id: reference.assetId,
          type: "character-reference-sheet",
          path: referencePath,
          metadata: {
            "image.character-reference-sheet": referenceMetadata,
          },
        });
      }
    }
  }
}

function upsertStoryboardPanelAssets(
  manifest: ProductionAssetManifest,
  storyboardAssetId: string,
  panels: Array<{
    id: string;
    sceneId: string;
    characterIds: string[];
    assetId: string;
    path?: string;
    consistencyScore?: number;
  }>,
): void {
  for (const panel of panels) {
    const metadata = {
      storyboardAssetId,
      panelId: panel.id,
      sceneId: panel.sceneId,
      characterIds: panel.characterIds,
      ...(panel.consistencyScore === undefined ? {} : { consistencyScore: panel.consistencyScore }),
    };
    const existingIndex = manifest.assets.findIndex((asset) => asset.id === panel.assetId);
    const safePath = panel.path ? normalizeProjectRelativePath(panel.path, `panel ${panel.id} path`) : undefined;
    if (existingIndex >= 0) {
      const existing = manifest.assets[existingIndex];
      manifest.assets[existingIndex] = {
        ...existing,
        ...(safePath ? { path: existing.path ?? safePath } : {}),
        metadata: {
          ...(existing.metadata ?? {}),
          "image.storyboard-panel": metadata,
        },
      };
    } else {
      manifest.assets.push({
        id: panel.assetId,
        type: "storyboard-panel",
        ...(safePath ? { path: safePath } : {}),
        metadata: {
          "image.storyboard-panel": metadata,
        },
      });
    }
  }
}

function normalizeProjectRelativePath(path: string, label: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error(`${label} must be a local project-relative path, not a URL`);
  }
  if (isAbsolute(path)) {
    throw new Error(`${label} must be project-relative, not absolute`);
  }
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.includes("..")) {
    throw new Error(`${label} must stay inside the project`);
  }
  return parts.join("/");
}

function safeProjectionFileSegment(value: string, label: string): string {
  const segment = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(segment) || segment === "." || segment === "..") {
    throw new Error(`${label} must be safe for projection file names`);
  }
  return segment;
}

function productionMetadataFileStems(metadata: ProductionMetadata): Record<string, string> {
  switch (metadata.kind) {
    case "audio.stem-separation":
      return { separationId: safeProjectionFileSegment(metadata.separationId, "separationId") };
    case "analysis.backend-benchmark":
      return { benchmarkId: safeProjectionFileSegment(metadata.benchmarkId, "benchmarkId") };
    case "image.embedding-store":
      return { embeddingSetId: safeProjectionFileSegment(metadata.embeddingSetId, "embeddingSetId") };
    case "image.comfyui-runner":
      return { workflowId: safeProjectionFileSegment(metadata.workflowId, "workflowId") };
    case "ad.visual-qa":
      return { variantId: safeProjectionFileSegment(metadata.variantId, "variantId") };
    case "provenance.content-credentials":
      return { credentialId: safeProjectionFileSegment(metadata.credentialId, "credentialId") };
    default:
      return {};
  }
}

function preflightProductionMetadataGeneratedAssetPaths(metadata: ProductionMetadata): void {
  switch (metadata.kind) {
    case "audio.stem-separation": {
      for (const stem of metadata.stems) {
        normalizeProjectRelativePath(stem.filePath, `audio stem ${stem.stemAssetId} filePath`);
      }
      break;
    }
    case "image.embedding-store": {
      for (const item of metadata.items) {
        normalizeProjectRelativePath(item.path, `embedding item ${item.assetId} path`);
        normalizeProjectRelativePath(item.vectorPath, `embedding item ${item.assetId} vectorPath`);
      }
      break;
    }
    case "image.comfyui-runner": {
      for (const output of metadata.outputs) {
        normalizeProjectRelativePath(output.path, `ComfyUI output ${output.outputAssetId} path`);
      }
      break;
    }
    case "image.semantic-reference-roles": {
      for (const role of metadata.roles) {
        normalizeProjectRelativePath(role.path, `reference role ${role.roleId} path`);
      }
      break;
    }
    case "image.storyboard-consistency": {
      for (const character of metadata.characters) {
        for (const reference of character.referenceViews) {
          normalizeProjectRelativePath(
            reference.path,
            `character reference ${character.id} ${reference.view} path`,
          );
        }
      }
      for (const panel of metadata.panels) {
        if (panel.path) {
          normalizeProjectRelativePath(panel.path, `panel ${panel.id} path`);
        }
      }
      break;
    }
  }
}

function createAssetMetadataLock(options: {
  cwd: string;
  targetAssetId: string;
  metadataKind: string;
  metadata: ProductionMetadata;
  metadataPath: string;
  actionPath: string;
  action: unknown;
}) {
  const metadataHash = productionMetadataHash(options.metadata);
  return createProjectionLock({
    kind: "clash.asset.metadata.lock",
    projectionKind: "asset-metadata",
    entity: { kind: "asset", id: options.targetAssetId },
    filePath: toProjectPath(options.cwd, options.metadataPath),
    contentHash: metadataHash,
    extra: {
      targetAssetId: options.targetAssetId,
      metadataKind: options.metadataKind,
      metadataHash,
      sourceActionPath: toProjectPath(options.cwd, options.actionPath),
      sourceActionHash: productionMetadataHash(options.action),
    },
  });
}

function createAssetMetadataProjectionLock(options: {
  cwd: string;
  targetAssetId: string;
  metadataKind: string;
  metadata: ProductionMetadata;
  metadataPath: string;
  projectionKind: string;
  projection: Record<string, unknown>;
  projectionPath: string;
  actionPath: string;
  action: unknown;
}) {
  const projectionHash = productionMetadataHash(options.projection);
  return createProjectionLock({
    kind: "clash.asset.metadata.projection.lock",
    projectionKind: options.projectionKind,
    entity: { kind: "asset", id: options.targetAssetId },
    filePath: toProjectPath(options.cwd, options.projectionPath),
    contentHash: projectionHash,
    extra: {
      targetAssetId: options.targetAssetId,
      metadataKind: options.metadataKind,
      projectionHash,
      sourceMetadataPath: toProjectPath(options.cwd, options.metadataPath),
      sourceMetadataHash: productionMetadataHash(options.metadata),
      sourceActionPath: toProjectPath(options.cwd, options.actionPath),
      sourceActionHash: productionMetadataHash(options.action),
    },
  });
}

function createAppliedAssetMetadataLock(options: {
  cwd: string;
  targetAssetId: string;
  metadataKind: string;
  metadataPath: string;
  metadataHash: string;
  previousMetadataHash: string;
  sourceActionPath?: string;
  sourceActionHash?: string;
}) {
  return createProjectionLock({
    kind: "clash.asset.metadata.lock",
    projectionKind: "asset-metadata",
    entity: { kind: "asset", id: options.targetAssetId },
    filePath: toProjectPath(options.cwd, options.metadataPath),
    contentHash: options.metadataHash,
    extra: {
      targetAssetId: options.targetAssetId,
      metadataKind: options.metadataKind,
      metadataHash: options.metadataHash,
      previousMetadataHash: options.previousMetadataHash,
      ...(options.sourceActionPath ? { sourceActionPath: options.sourceActionPath } : {}),
      ...(options.sourceActionHash ? { sourceActionHash: options.sourceActionHash } : {}),
      appliedFromProjection: true,
    },
  });
}

function parseAssetMetadataProjectionLock(raw: string): AssetMetadataProjectionLock {
  const value = JSON.parse(raw) as Partial<AssetMetadataProjectionLock>;
  const lock = parseProjectionLock(value, {
    kind: "clash.asset.metadata.lock",
    projectionKind: "asset-metadata",
    entityKind: "asset",
  }) as AssetMetadataProjectionLock;
  if (
    typeof value.targetAssetId !== "string" ||
    value.targetAssetId.length === 0 ||
    value.targetAssetId !== lock.entity.id ||
    typeof value.metadataKind !== "string" ||
    value.metadataKind.length === 0 ||
    (value.metadataHash !== undefined && typeof value.metadataHash !== "string") ||
    (value.sourceActionPath !== undefined && typeof value.sourceActionPath !== "string") ||
    (value.sourceActionHash !== undefined && typeof value.sourceActionHash !== "string")
  ) {
    throw new Error("Invalid asset metadata projection lock file");
  }
  return {
    ...lock,
    targetAssetId: value.targetAssetId,
    metadataKind: value.metadataKind,
    ...(value.metadataHash !== undefined ? { metadataHash: value.metadataHash } : {}),
    ...(value.sourceActionPath !== undefined ? { sourceActionPath: value.sourceActionPath } : {}),
    ...(value.sourceActionHash !== undefined ? { sourceActionHash: value.sourceActionHash } : {}),
  };
}

function productionMetadataHash(value: unknown): string {
  return hashProjectionContent(stableJson(value));
}

function parseAssetManifest(raw: string, path: string): ProductionAssetManifest {
  const parsed = JSON.parse(raw) as Partial<ProductionAssetManifest>;
  if (!Array.isArray(parsed.assets)) {
    throw new Error(`Invalid asset manifest at ${path}: expected assets array`);
  }
  return {
    ...parsed,
    assets: parsed.assets.map((asset) => ({
      ...asset,
      metadata: asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
        ? asset.metadata as Record<string, unknown>
        : {},
    })),
  } as ProductionAssetManifest;
}

function resolveLocalPath(cwd: string, path: string, label: string): string {
  if (!path || typeof path !== "string") {
    throw new Error(`${label} path is required`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error(`${label} path must be a local project path, not a URL`);
  }
  const root = resolve(cwd);
  const resolved = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const relativePath = relative(root, resolved);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return resolved;
  }
  throw new Error(`${label} path must stay inside the current project cwd`);
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return relative(resolve(cwd), absolutePath).split(/[\\/]+/).join("/");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => item === undefined ? "null" : stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}
