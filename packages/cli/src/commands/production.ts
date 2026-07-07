import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Command } from "commander";
import { AssetMetadataFillActionSchema } from "@clash/shared-types";
import { applyProductionMetadataAction, applyProductionMetadataProjection } from "../lib/production-actions";
import { validatePipelineManifest } from "../lib/pipeline-manifest-validation";
import { renderMgProductionProjection } from "../lib/mg-production";
import { verifyMgPreview } from "../lib/mg-preview-verification";
import { planCompositionRoute } from "../lib/composition-route-plan";
import { projectCompositionTimeline } from "../lib/composition-timeline-projection";
import { approveReviewStageGate, parseReviewGateDecision, planReviewStageGate } from "../lib/review-stage-gate";
import { planDryRunCostGate } from "../lib/dry-run-cost-gate";
import { planReferenceRolesAction } from "../lib/reference-roles-plan";
import { planProductLogoQaAction } from "../lib/product-logo-qa-plan";
import { planAnalysisBenchmarkAction } from "../lib/analysis-benchmark-plan";
import { planImageEmbeddingStoreAction } from "../lib/image-embedding-store-plan";
import { planAudioStemSeparationAction } from "../lib/audio-stem-separation-plan";
import { planComfyuiWorkflowAction } from "../lib/comfyui-workflow-plan";
import { planContentCredentialsAction } from "../lib/content-credentials-plan";
import { exportMgSnapshotAsset } from "../lib/mg-snapshot-export";
import { exportMgVideoAsset } from "../lib/mg-video-export";
import { planTalkingHeadTextCutAction } from "../lib/talking-head-plan";
import { exportTextCutMedia } from "../lib/text-cut-media-export";
import { verifyCaptionLineage } from "../lib/caption-lineage-verification";
import { exportCaptionFile, parseCaptionExportFormat } from "../lib/caption-export";
import { projectCaptionOverlayTimeline } from "../lib/caption-overlay-projection";
import { exportCaptionBurn } from "../lib/caption-burn-export";
import { exportTimelineHandoff, parseTimelineHandoffFormat } from "../lib/timeline-handoff-export";
import { analyzeWavBeatAction } from "../lib/audio-beat-analysis";
import { planLyricsAlignmentAction } from "../lib/lyrics-alignment-plan";
import { planVisualMomentsAction, summarizeVisualMomentAction } from "../lib/visual-moment-plan";
import { projectMvBeatCutsTimeline } from "../lib/mv-beat-timeline-projection";
import { verifyMvBeatSync } from "../lib/mv-beat-sync-verification";
import { planAdDeliverySpecAction } from "../lib/ad-delivery-plan";
import { extractAdVisualFrames } from "../lib/ad-visual-frame-extraction";
import { analyzeAdVisualPixels } from "../lib/ad-visual-pixel-analysis";
import { planAdVisualQaAction } from "../lib/ad-visual-qa-plan";
import { validateAdDeliveryExport } from "../lib/ad-delivery-validation";
import { planReferenceReviewAction } from "../lib/reference-review-plan";
import { planReferenceDownload } from "../lib/reference-download-plan";
import { executeReferenceDownload } from "../lib/reference-download-execution";
import { planReferenceNonCopyingQaAction } from "../lib/reference-noncopying-qa";
import { verifyReferenceIsolation } from "../lib/reference-isolation-verification";
import { planStoryboardConsistencyAction } from "../lib/storyboard-plan";
import { planStoryboardConsistencyQaAction } from "../lib/storyboard-consistency-qa";
import { applyStoryboardPromptPack, projectStoryboardPromptPack, replaceStoryboardPromptPack } from "../lib/storyboard-prompt-pack-projection";
import { projectStoryboardTimeline } from "../lib/storyboard-timeline-projection";
import { verifyStoryboardTimeline } from "../lib/storyboard-timeline-verification";
import {
  projectDerivedOverlayTimeline,
  type DerivedOverlayDerivationKind,
  type DerivedOverlayMediaType,
} from "../lib/derived-overlay-projection";
import { isJsonMode, printJson } from "../lib/output";
import { resolveAgentFilePathInsideCwd } from "../lib/projection-cas";

export const productionCommand = new Command("production")
  .description("Run local production actions that fill asset metadata and emit timeline/view projections");

productionCommand
  .command("apply-metadata")
  .description(
    "Apply an action JSON file to assets/manifest.json, writing metadata and timeline/view projections under projections/."
  )
  .requiredOption("--action <path>", "AssetMetadataFillAction JSON file")
  .option("--assets <path>", "Asset manifest path", "assets/manifest.json")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await applyProductionMetadataAction({
        cwd: process.cwd(),
        actionPath: options.action,
        assetsPath: options.assets,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`applied ${result.metadataKind} to ${result.targetAssetId}`);
      console.log(`metadata: ${result.metadataPath}`);
      console.log(`metadata lock: ${result.metadataLockPath}`);
      if (result.timelineProjectionPath) console.log(`projection: ${result.timelineProjectionPath}`);
      for (const lockPath of result.projectionLockPaths.filter((lockPath) => lockPath !== result.metadataLockPath)) {
        console.log(`projection lock: ${lockPath}`);
      }
      if (result.blockedReason) console.log(`blocked: ${result.blockedReason}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("apply-metadata-projection")
  .description("Apply an edited asset metadata projection JSON back to assets/manifest.json with CAS.")
  .requiredOption("--file <path>", "Asset metadata projection JSON file")
  .option("--lock <path>", "Asset metadata projection lock path")
  .option("--assets <path>", "Asset manifest path", "assets/manifest.json")
  .option("--force", "Apply even when the asset metadata lock is stale")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await applyProductionMetadataProjection({
        cwd: process.cwd(),
        filePath: options.file,
        lockPath: options.lock,
        assetsPath: options.assets,
        force: Boolean(options.force),
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`applied ${result.metadataKind} to ${result.targetAssetId}`);
      console.log(`metadata: ${result.metadataPath}`);
      console.log(`metadata lock: ${result.lockPath}`);
      console.log(`before hash: ${result.beforeMetadataHash}`);
      console.log(`after hash: ${result.afterMetadataHash}`);
      if (result.forced) console.log("forced: true");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("validate-pipeline-manifest")
  .description(
    "Validate that a production pipeline manifest has concrete action, metadata, asset, projection, review, and export artifacts."
  )
  .requiredOption("--pipeline <path>", "Pipeline manifest JSON file")
  .option("--out <path>", "Pipeline validation report path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await validatePipelineManifest({
        cwd: process.cwd(),
        pipelinePath: options.pipeline,
        outPath: options.out,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`validated pipeline manifest for ${result.projectKind}`);
      console.log(`status: ${result.status}`);
      console.log(`report: ${result.reportPath}`);
      if (result.missingArtifacts.length > 0) {
        console.log(`missing artifacts: ${result.missingArtifacts.join(", ")}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("render-mg")
  .description(
    "Render a first-party motion-graphics spec into local HTML, manifest, and timeline projection files."
  )
  .requiredOption("--spec <path>", "Agent-authored MgCompositionSpec JSON file")
  .option("--out <path>", "Output directory for HTML preview and manifest")
  .requiredOption("--rendered-asset <path>", "Local project path where the rendered overlay asset will live")
  .option("--from <frame>", "Timeline start frame", parseNonNegativeFrame, 0)
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await renderMgProductionProjection({
        cwd: process.cwd(),
        specPath: options.spec,
        outDir: options.out,
        renderedAssetPath: options.renderedAsset,
        timelineFromFrame: options.from,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`rendered MG ${result.compositionId}`);
      console.log(`html: ${result.htmlPath}`);
      console.log(`manifest: ${result.manifestPath}`);
      console.log(`projection: ${result.timelineProjectionPath}`);
      console.log(`timeline lock required: ${result.timelineLockPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("verify-mg-preview")
  .description(
    "Verify a first-party MG HTML preview, manifest CAS boundary, and deterministic frame evaluation."
  )
  .requiredOption("--html <path>", "Self-contained MG HTML preview path")
  .requiredOption("--manifest <path>", "MG timeline manifest path")
  .option("--frames <list>", "Comma-separated frame numbers to evaluate", parseFrameList)
  .option("--out <path>", "Output preview verification report path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await verifyMgPreview({
        cwd: process.cwd(),
        htmlPath: options.html,
        manifestPath: options.manifest,
        frames: options.frames,
        outPath: options.out,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`verified MG preview ${result.overlayId}`);
      console.log(`status: ${result.status}`);
      console.log(`report: ${result.reportPath}`);
      if (result.blockedReasons.length > 0) console.log(`blocked: ${result.blockedReasons.join("; ")}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-composition-route")
  .description(
    "Plan the explicit render runtime for a composition request without silently falling back to another runtime."
  )
  .requiredOption("--request <path>", "Composition route request JSON file")
  .option("--out <path>", "Output composition route plan JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await planCompositionRoute({
        cwd: process.cwd(),
        requestPath: options.request,
        outPath: options.out,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned composition route for ${result.compositionId}`);
      console.log(`status: ${result.status}`);
      console.log(`runtime: ${result.selectedRuntime ?? "none"}`);
      console.log(`plan: ${result.planPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("project-composition-timeline")
  .description(
    "Project an already rendered Remotion composition asset into a CAS-required composition timeline view."
  )
  .requiredOption("--route <path>", "Composition route plan JSON file")
  .requiredOption("--rendered-asset <id>", "Rendered asset id already registered in assets/manifest.json")
  .option("--rendered-src <path>", "Rendered asset project path; defaults to the route outputPath")
  .option("--assets <path>", "Asset manifest path", "assets/manifest.json")
  .option("--from <frame>", "Timeline start frame", parseNonNegativeFrame, 0)
  .requiredOption("--duration <frames>", "Timeline composition duration in frames", parsePositiveFrame)
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await projectCompositionTimeline({
        cwd: process.cwd(),
        routePath: options.route,
        renderedAssetId: options.renderedAsset,
        renderedSrc: options.renderedSrc,
        assetsPath: options.assets,
        from: options.from,
        durationInFrames: options.duration,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`projected composition ${result.compositionId}`);
      console.log(`runtime: ${result.runtime}`);
      console.log(`timeline: ${result.timelineProjectionPath}`);
      console.log(`manifest: ${result.manifestPath}`);
      console.log(`timeline lock required: ${result.timelineLockPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-review-gate")
  .description(
    "Plan a local review/stage gate over required artifacts, writing a gate file plus path-bound CAS lock."
  )
  .requiredOption("--pipeline <path>", "Pipeline manifest JSON file")
  .requiredOption("--stage <name>", "Pipeline stage to gate")
  .option("--artifact <path>", "Required artifact path; repeat for multiple artifacts", collectString, [])
  .option("--out <path>", "Output review gate JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await planReviewStageGate({
        cwd: process.cwd(),
        pipelinePath: options.pipeline,
        stage: options.stage,
        requiredArtifactPaths: options.artifact,
        outPath: options.out,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned review gate for ${result.stage}`);
      console.log(`status: ${result.status}`);
      console.log(`gate: ${result.gatePath}`);
      console.log(`lock: ${result.lockPath}`);
      if (result.blockedReasons.length > 0) console.log(`blocked: ${result.blockedReasons.join("; ")}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("approve-review-gate")
  .description(
    "Approve or request changes on a review gate, guarded by the gate path and hash CAS lock."
  )
  .requiredOption("--gate <path>", "Review gate JSON file")
  .option("--lock <path>", "Review gate lock path; defaults to sibling .lock.json")
  .requiredOption("--reviewer <name>", "Reviewer identity")
  .requiredOption("--decision <decision>", "Review decision: approve or request-changes", parseReviewGateDecision)
  .option("--note <text>", "Review note")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await approveReviewStageGate({
        cwd: process.cwd(),
        gatePath: options.gate,
        lockPath: options.lock,
        reviewer: options.reviewer,
        decision: options.decision,
        note: options.note,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`${result.decision} review gate for ${result.stage}`);
      console.log(`status: ${result.status}`);
      console.log(`gate: ${result.gatePath}`);
      console.log(`lock: ${result.lockPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-dry-run-cost-gate")
  .description(
    "Plan provider/runtime availability and max-cost gates without executing generation, downloads, or renders."
  )
  .requiredOption("--request <path>", "Dry-run cost gate request JSON file")
  .option("--out <path>", "Output dry-run cost gate JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await planDryRunCostGate({
        cwd: process.cwd(),
        requestPath: options.request,
        outPath: options.out,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned dry-run cost gate for ${result.workflowId}`);
      console.log(`status: ${result.status}`);
      console.log(`execution allowed: ${result.executionAllowed}`);
      console.log(`estimated cost: ${result.totalEstimatedCostUsd}`);
      console.log(`gate: ${result.gatePath}`);
      if (result.blockedReasons.length > 0) console.log(`blocked: ${result.blockedReasons.join("; ")}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-reference-roles")
  .description(
    "Plan semantic reference roles for image/video assets, producing a metadata-fill action."
  )
  .requiredOption("--target-asset <id>", "Reference pack or project asset id to receive image.semantic-reference-roles metadata")
  .requiredOption("--roles <path>", "Reference roles JSON array or object with roles")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await planReferenceRolesAction({
        cwd: process.cwd(),
        targetAssetId: options.targetAsset,
        rolesPath: options.roles,
        outPath: options.out,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned reference roles for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`roles: ${result.roles}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-product-logo-qa")
  .description(
    "Plan product/logo QA from semantic reference roles and agent-provided visual/OCR evidence."
  )
  .requiredOption("--target-asset <id>", "Generated image/video-frame asset id being checked")
  .requiredOption("--reference-roles <path>", "Semantic reference roles projection or roles JSON")
  .requiredOption("--evidence <path>", "Product/logo QA evidence JSON with observations")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--report <path>", "Output product/logo QA report JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await planProductLogoQaAction({
        cwd: process.cwd(),
        targetAssetId: options.targetAsset,
        referenceRolesPath: options.referenceRoles,
        evidencePath: options.evidence,
        outPath: options.out,
        reportPath: options.report,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned product/logo QA for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`verdict: ${result.verdict}`);
      if (result.blockedReasons.length > 0) console.log(`blocked: ${result.blockedReasons.join("; ")}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-analysis-benchmark")
  .description(
    "Plan an analysis backend benchmark from existing local backend results without executing analyzers."
  )
  .requiredOption("--target-asset <id>", "Asset id receiving analysis.backend-benchmark metadata")
  .requiredOption("--request <path>", "Analysis benchmark request JSON")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--report <path>", "Output backend benchmark report JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await planAnalysisBenchmarkAction({
        cwd: process.cwd(),
        targetAssetId: options.targetAsset,
        requestPath: options.request,
        outPath: options.out,
        reportPath: options.report,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned analysis benchmark ${result.benchmarkId} for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`verdict: ${result.verdict}`);
      if (result.selectedBackendId) console.log(`selected: ${result.selectedBackendId}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-image-embedding-store")
  .description(
    "Register existing local image embedding vectors as metadata without executing embedding backends."
  )
  .requiredOption("--target-asset <id>", "Reference pack or project asset id receiving image.embedding-store metadata")
  .requiredOption("--embeddings <path>", "Image embedding store request JSON")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--report <path>", "Output image embedding store report JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await planImageEmbeddingStoreAction({
        cwd: process.cwd(),
        targetAssetId: options.targetAsset,
        embeddingsPath: options.embeddings,
        outPath: options.out,
        reportPath: options.report,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned image embedding store ${result.embeddingSetId} for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`items: ${result.items}`);
      console.log(`dimension: ${result.dimension}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-audio-stem-separation")
  .description(
    "Register existing local audio stem files as metadata without executing stem separation backends."
  )
  .requiredOption("--target-asset <id>", "Audio asset id receiving audio.stem-separation metadata")
  .requiredOption("--stems <path>", "Audio stem separation request JSON")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--report <path>", "Output audio stem separation report JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await planAudioStemSeparationAction({
        cwd: process.cwd(),
        targetAssetId: options.targetAsset,
        stemsPath: options.stems,
        outPath: options.out,
        reportPath: options.report,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned audio stem separation ${result.separationId} for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`stems: ${result.stems}`);
      if (result.vocalStemAssetId) console.log(`vocal stem: ${result.vocalStemAssetId}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-comfyui-workflow")
  .description(
    "Register a pinned local ComfyUI workflow contract and output lineage without executing ComfyUI."
  )
  .requiredOption("--target-asset <id>", "Image generation job asset id receiving image.comfyui-runner metadata")
  .requiredOption("--request <path>", "ComfyUI workflow request JSON")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--report <path>", "Output ComfyUI workflow report JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await planComfyuiWorkflowAction({
        cwd: process.cwd(),
        targetAssetId: options.targetAsset,
        requestPath: options.request,
        outPath: options.out,
        reportPath: options.report,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned ComfyUI workflow ${result.workflowId} for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`outputs: ${result.outputs}`);
      console.log(`materialized outputs: ${result.materializedOutputs}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-content-credentials")
  .description(
    "Register local content credentials/provenance metadata without signing C2PA manifests."
  )
  .requiredOption("--target-asset <id>", "Asset id receiving provenance.content-credentials metadata")
  .requiredOption("--request <path>", "Content credentials request JSON")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--report <path>", "Output content credentials report JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await planContentCredentialsAction({
        cwd: process.cwd(),
        targetAssetId: options.targetAsset,
        requestPath: options.request,
        outPath: options.out,
        reportPath: options.report,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned content credentials ${result.credentialId} for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`signature: ${result.signatureStatus}`);
      console.log(`ingredients: ${result.ingredients}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("export-mg-snapshots")
  .description(
    "Export deterministic SVG snapshots from a first-party MG spec and register them as a local overlay asset."
  )
  .requiredOption("--spec <path>", "Agent-authored MgCompositionSpec JSON file")
  .requiredOption("--asset-id <id>", "Asset id to create or update in assets/manifest.json")
  .option("--out <path>", "Output directory for SVG frames and export manifest")
  .option("--assets <path>", "Asset manifest path", "assets/manifest.json")
  .option("--frames <list>", "Comma-separated frame numbers to export", parseFrameList, [0])
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await exportMgSnapshotAsset({
        cwd: process.cwd(),
        specPath: options.spec,
        assetId: options.assetId,
        outDir: options.out,
        frames: options.frames,
        assetsPath: options.assets,
      });
      const payload = {
        exported: true,
        assetId: result.assetId,
        assetManifestPath: result.assetManifestPath,
        exportManifestPath: result.exportManifestPath,
        frames: result.framePaths.length,
      };
      if (isJsonMode(options)) {
        printJson(payload);
        return;
      }
      console.log(`exported MG snapshots for ${result.assetId}`);
      console.log(`asset manifest: ${result.assetManifestPath}`);
      console.log(`export manifest: ${result.exportManifestPath}`);
      console.log(`frames: ${result.framePaths.length}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("export-mg-video")
  .description(
    "Export a first-party MG spec to a playable local WebM/MP4 overlay asset and validate it with ffprobe."
  )
  .requiredOption("--spec <path>", "Agent-authored MgCompositionSpec JSON file")
  .requiredOption("--asset-id <id>", "Asset id to create or update in assets/manifest.json")
  .option("--out <path>", "Output .webm or .mp4 path; defaults to assets/overlays/<spec-id>.webm")
  .option("--assets <path>", "Asset manifest path", "assets/manifest.json")
  .option("--ffmpeg <path>", "ffmpeg executable path; defaults to CLASH_FFMPEG_PATH, FFMPEG_PATH, or PATH")
  .option("--ffprobe <path>", "ffprobe executable path; defaults to CLASH_FFPROBE_PATH, FFPROBE_PATH, or PATH")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await exportMgVideoAsset({
        cwd: process.cwd(),
        specPath: options.spec,
        assetId: options.assetId,
        outPath: options.out,
        assetsPath: options.assets,
        ffmpegPath: options.ffmpeg,
        ffprobePath: options.ffprobe,
      });
      const payload = {
        exported: true,
        assetId: result.assetId,
        format: result.format,
        outputPath: result.outputPath,
        assetManifestPath: result.assetManifestPath,
        exportManifestPath: result.exportManifestPath,
        probe: result.probe,
      };
      if (isJsonMode(options)) {
        printJson(payload);
        return;
      }
      console.log(`exported MG video for ${result.assetId}`);
      console.log(`format: ${result.format}`);
      console.log(`output: ${result.outputPath}`);
      console.log(`asset manifest: ${result.assetManifestPath}`);
      console.log(`export manifest: ${result.exportManifestPath}`);
      console.log(`probe: ${result.probe.codecName} ${result.probe.width}x${result.probe.height}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("project-derived-overlay")
  .description(
    "Project an existing copy-on-write derived asset into a CAS-required derived-overlay timeline view."
  )
  .requiredOption("--source-asset <id>", "Original/source asset id")
  .requiredOption("--derived-asset <id>", "Derived asset id already registered in assets/manifest.json")
  .requiredOption("--media-type <type>", "Derived overlay media type: image or video", parseDerivedOverlayMediaType)
  .option("--assets <path>", "Asset manifest path", "assets/manifest.json")
  .option("--from <frame>", "Timeline start frame", parseNonNegativeFrame, 0)
  .requiredOption("--duration <frames>", "Timeline overlay duration in frames", parsePositiveFrame)
  .requiredOption(
    "--derivation-kind <kind>",
    "Derivation kind: trim, crop, caption-burn, mg-render, transcode, or other",
    parseDerivedOverlayDerivationKind,
  )
  .option("--description <text>", "Human-readable derivation note")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await projectDerivedOverlayTimeline({
        cwd: process.cwd(),
        assetsPath: options.assets,
        sourceAssetId: options.sourceAsset,
        derivedAssetId: options.derivedAsset,
        mediaType: options.mediaType,
        from: options.from,
        durationInFrames: options.duration,
        derivationKind: options.derivationKind,
        description: options.description,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`projected derived overlay ${result.derivedAssetId}`);
      console.log(`source asset: ${result.sourceAssetId}`);
      console.log(`timeline: ${result.timelineProjectionPath}`);
      console.log(`manifest: ${result.manifestPath}`);
      console.log(`timeline lock required: ${result.timelineLockPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-text-cut")
  .description(
    "Plan filler, tone-particle, and silence removals from ASR words into a talking-head metadata-fill action."
  )
  .requiredOption("--transcript <path>", "ASR transcript JSON with { fps?, words: [{ id, text, startFrame, endFrame }] }")
  .requiredOption("--target-asset <id>", "Target video asset id")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--fps <number>", "Override transcript fps", parsePositiveNumber)
  .option("--min-silence-frames <frames>", "Minimum gap to mark as removable silence", parseNonNegativeFrame, 15)
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const cwd = process.cwd();
      const transcriptPath = resolveLocalPath(cwd, options.transcript);
      const transcriptRaw = await readFile(transcriptPath, "utf8");
      const transcript = parseTranscriptJson(JSON.parse(transcriptRaw));
      const fps = options.fps ?? transcript.fps ?? 30;
      const action = planTalkingHeadTextCutAction({
        targetAssetId: options.targetAsset,
        fps,
        minSilenceFrames: options.minSilenceFrames,
        words: transcript.words,
        asr: {
          kind: "asr-transcript",
          sourcePath: toProjectPath(cwd, transcriptPath),
          sourceHash: `sha256:${createHash("sha256").update(transcriptRaw).digest("hex")}`,
          backendId: transcript.backendId ?? "unknown-asr-backend",
          modelId: transcript.modelId ?? "unknown-asr-model",
          ...(transcript.language ? { language: transcript.language } : {}),
          ...(transcript.durationFrames === undefined ? {} : { durationFrames: transcript.durationFrames }),
          wordCount: transcript.words.length,
          ...(transcript.averageConfidence === undefined ? {} : { averageConfidence: transcript.averageConfidence }),
        },
      });
      const actionPath = resolveAgentOutputPath(
        cwd,
        options.out ?? join("actions", `${options.targetAsset}.talking-head-text-cut.json`),
        "Text-cut action",
      );
      await writeJson(actionPath, action);
      const metadata = action.metadata as Extract<typeof action.metadata, { kind: "talking-head.analysis" }>;
      const result = {
        planned: true,
        targetAssetId: action.targetAssetId,
        actionPath,
        disfluencies: metadata.disfluencies.length,
        cuts: metadata.cuts.length,
        captionCues: metadata.captionCues.length,
      };
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned text cut for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`disfluencies: ${result.disfluencies}`);
      console.log(`cuts: ${result.cuts}`);
      console.log(`caption cues: ${result.captionCues}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("export-text-cut-media")
  .description(
    "Export a talking-head text-cut action into a non-destructive media cut package and optional rendered video asset."
  )
  .requiredOption("--action <path>", "Talking-head AssetMetadataFillAction JSON file")
  .requiredOption("--output-asset <id>", "Output cut asset id to create or update in assets/manifest.json")
  .option("--source-asset <id>", "Source video asset id; defaults to the action target asset")
  .option("--out <path>", "Output video path; defaults to assets/video/<output-asset>.mp4")
  .option("--assets <path>", "Asset manifest path", "assets/manifest.json")
  .option("--render", "Render a new video with ffmpeg instead of producing a plan-only cut package")
  .option("--no-audio", "Render video-only output for sources without audio streams")
  .option("--ffmpeg <path>", "ffmpeg executable path; defaults to CLASH_FFMPEG_PATH, FFMPEG_PATH, or PATH")
  .option("--ffprobe <path>", "ffprobe executable path; defaults to CLASH_FFPROBE_PATH, FFPROBE_PATH, or PATH")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await exportTextCutMedia({
        cwd: process.cwd(),
        actionPath: options.action,
        assetsPath: options.assets,
        sourceAssetId: options.sourceAsset,
        outputAssetId: options.outputAsset,
        outPath: options.out,
        render: options.render === true,
        includeAudio: options.audio !== false,
        ffmpegPath: options.ffmpeg,
        ffprobePath: options.ffprobe,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`exported text cut media for ${result.outputAssetId}`);
      console.log(`rendered: ${result.rendered}`);
      console.log(`output: ${result.outputPath}`);
      console.log(`package: ${result.packagePath}`);
      console.log(`concat: ${result.concatPath}`);
      console.log(`segments: ${result.keepSegments}`);
      console.log(`deleted ranges: ${result.deletedRanges}`);
      console.log(`review ranges: ${result.reviewRanges}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("verify-caption-lineage")
  .description(
    "Verify that a caption timeline uses structured cues, word references, and source-to-output maps."
  )
  .requiredOption("--timeline <path>", "Timeline YAML file to verify")
  .option("--out <path>", "Output caption lineage verification report path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await verifyCaptionLineage({
        cwd: process.cwd(),
        timelinePath: options.timeline,
        outPath: options.out,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`verified caption lineage: ${result.status}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`caption items: ${result.captionItems}`);
      console.log(`cues: ${result.cues}`);
      if (result.blockedReasons.length > 0) console.log(`blocked: ${result.blockedReasons.join("; ")}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("export-captions")
  .description(
    "Export structured caption timeline items to SRT, VTT, or ASS sidecar files."
  )
  .requiredOption("--timeline <path>", "Timeline YAML file containing type: caption items")
  .requiredOption("--out <path>", "Caption output path, usually .srt, .vtt, or .ass")
  .option("--format <format>", "Caption output format: srt, vtt, or ass", parseCaptionExportFormat)
  .option("--manifest <path>", "Caption export manifest path")
  .option("--fps <number>", "Override timeline fps for timestamp conversion", parsePositiveNumber)
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await exportCaptionFile({
        cwd: process.cwd(),
        timelinePath: options.timeline,
        outPath: options.out,
        manifestPath: options.manifest,
        format: options.format,
        fps: options.fps,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`exported ${result.cues} caption cue(s) as ${result.format}`);
      console.log(`output: ${result.outputPath}`);
      console.log(`manifest: ${result.manifestPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("project-caption-overlay")
  .description(
    "Project structured caption timeline items into a CAS-required subtitle timeline view and overlay manifest."
  )
  .requiredOption("--timeline <path>", "Timeline YAML file containing type: caption items")
  .requiredOption("--out <path>", "Caption overlay timeline YAML projection path")
  .option("--manifest <path>", "Caption overlay manifest path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await projectCaptionOverlayTimeline({
        cwd: process.cwd(),
        timelinePath: options.timeline,
        outPath: options.out,
        manifestPath: options.manifest,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`projected ${result.captionItems} caption item(s)`);
      console.log(`projection: ${result.timelineProjectionPath}`);
      console.log(`manifest: ${result.manifestPath}`);
      console.log(`timeline lock required: ${result.timelineLockPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("export-caption-burn")
  .description(
    "Export structured caption timeline items as a non-destructive caption-burn derived asset plan or rendered video."
  )
  .requiredOption("--timeline <path>", "Timeline YAML file containing type: caption items")
  .requiredOption("--source-asset <id>", "Source video asset id in assets/manifest.json")
  .requiredOption("--output-asset <id>", "Output derived video or caption-burn plan asset id")
  .option("--assets <path>", "Asset manifest path", "assets/manifest.json")
  .option("--out <path>", "Output rendered video path")
  .option("--caption-sidecar <path>", "ASS caption sidecar path")
  .option("--package <path>", "Caption burn package JSON path")
  .option("--ffmpeg-plan <path>", "FFmpeg plan JSON path")
  .option("--render", "Run ffmpeg and render the caption-burn video")
  .option("--ffmpeg <path>", "FFmpeg executable path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await exportCaptionBurn({
        cwd: process.cwd(),
        timelinePath: options.timeline,
        assetsPath: options.assets,
        sourceAssetId: options.sourceAsset,
        outputAssetId: options.outputAsset,
        outPath: options.out,
        captionSidecarPath: options.captionSidecar,
        packagePath: options.package,
        ffmpegPlanPath: options.ffmpegPlan,
        render: options.render === true,
        ffmpegPath: options.ffmpeg,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`exported ${result.cues} caption cue(s) as caption burn`);
      console.log(`caption sidecar: ${result.captionSidecarPath}`);
      console.log(`package: ${result.packagePath}`);
      console.log(`ffmpeg plan: ${result.ffmpegPlanPath}`);
      console.log(`rendered: ${result.rendered ? "yes" : "no"}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("export-timeline-handoff")
  .description(
    "Export a timeline YAML view to a CSV handoff for external NLE review."
  )
  .requiredOption("--timeline <path>", "Timeline YAML file to hand off")
  .requiredOption("--out <path>", "CSV handoff output path")
  .option("--format <format>", "Timeline handoff format: csv", parseTimelineHandoffFormat)
  .option("--manifest <path>", "Timeline handoff manifest path")
  .option("--fps <number>", "Override timeline fps for timecode conversion", parsePositiveNumber)
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await exportTimelineHandoff({
        cwd: process.cwd(),
        timelinePath: options.timeline,
        outPath: options.out,
        manifestPath: options.manifest,
        format: options.format,
        fps: options.fps,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`exported ${result.items} timeline item(s) as ${result.format}`);
      console.log(`output: ${result.outputPath}`);
      console.log(`manifest: ${result.manifestPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("analyze-audio-beats")
  .description(
    "Analyze a local 16-bit PCM WAV file into an MV beat metadata-fill action."
  )
  .requiredOption("--audio <path>", "Local 16-bit PCM WAV audio path")
  .requiredOption("--target-asset <id>", "Target audio asset id")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--fps <number>", "Timeline/video fps for beat frame positions", parsePositiveNumber, 30)
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const cwd = process.cwd();
      const action = await analyzeWavBeatAction({
        targetAssetId: options.targetAsset,
        audioPath: resolveLocalPath(cwd, options.audio),
        fps: options.fps,
      });
      const actionPath = resolveAgentOutputPath(
        cwd,
        options.out ?? join("actions", `${options.targetAsset}.audio-beat-analysis.json`),
        "Audio beat analysis action",
      );
      await writeJson(actionPath, action);
      const metadata = action.metadata as Extract<typeof action.metadata, { kind: "audio.beat-analysis" }>;
      const result = {
        analyzed: true,
        targetAssetId: action.targetAssetId,
        actionPath,
        bpm: metadata.bpm,
        beats: metadata.beats.length,
        sections: metadata.sections.length,
        energyPoints: metadata.energyCurve.length,
      };
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`analyzed beats for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`bpm: ${result.bpm}`);
      console.log(`beats: ${result.beats}`);
      console.log(`sections: ${result.sections}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-lyrics-alignment")
  .description(
    "Plan MV/karaoke lyrics alignment metadata from lyric lines and beat-analysis sections."
  )
  .requiredOption("--target-asset <id>", "Target audio asset id")
  .requiredOption("--lyrics <path>", "Project-relative lyrics text file")
  .requiredOption("--beat-action <path>", "Audio beat AssetMetadataFillAction JSON file")
  .option("--source <label>", "Lyrics source label; defaults to the lyrics path")
  .option("--vocal-stem-asset <id>", "Optional vocal stem asset id")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const cwd = process.cwd();
      const lyricsPath = resolveLocalPath(cwd, options.lyrics);
      const beatAction = AssetMetadataFillActionSchema.parse(
        JSON.parse(await readFile(resolveLocalPath(cwd, options.beatAction), "utf8")),
      );
      const action = planLyricsAlignmentAction({
        targetAssetId: options.targetAsset,
        lyricsText: await readFile(lyricsPath, "utf8"),
        beatAction,
        lyricsSource: options.source ?? options.lyrics,
        vocalStemAssetId: options.vocalStemAsset,
      });
      const actionPath = resolveAgentOutputPath(
        cwd,
        options.out ?? join("actions", `${options.targetAsset}.lyrics-alignment.json`),
        "Lyrics alignment action",
      );
      await writeJson(actionPath, action);
      const metadata = action.metadata as Extract<typeof action.metadata, { kind: "audio.lyrics-alignment" }>;
      const confidence = metadata.units.reduce((sum, unit) => sum + unit.confidence, 0) / metadata.units.length;
      const result = {
        planned: true,
        targetAssetId: action.targetAssetId,
        actionPath,
        units: metadata.units.length,
        confidence: roundNumber(confidence),
        source: metadata.units[0]?.source,
      };
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned lyrics alignment for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`units: ${result.units}`);
      console.log(`confidence: ${result.confidence}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-visual-moments")
  .description(
    "Plan a reusable visual moment library from source-video candidate ranges without copying frames."
  )
  .requiredOption("--target-asset <id>", "Target/source video asset id")
  .requiredOption("--moments <path>", "Visual moments JSON array or object with { sceneChanges, candidates }")
  .option("--source-path <path>", "Project-relative source video path for recommended clips")
  .option("--fps <number>", "Source fps", parsePositiveNumber, 30)
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const cwd = process.cwd();
      const action = planVisualMomentsAction({
        targetAssetId: options.targetAsset,
        fps: options.fps,
        sourcePath: options.sourcePath,
        moments: JSON.parse(await readFile(resolveLocalPath(cwd, options.moments), "utf8")),
      });
      const actionPath = resolveAgentOutputPath(
        cwd,
        options.out ?? join("actions", `${options.targetAsset}.visual-moments.json`),
        "Visual moments action",
      );
      await writeJson(actionPath, action);
      const summary = summarizeVisualMomentAction(action);
      const result = {
        planned: true,
        targetAssetId: action.targetAssetId,
        actionPath,
        candidates: summary.candidates,
        topCandidateId: summary.topCandidateId,
      };
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned visual moments for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`candidates: ${result.candidates}`);
      console.log(`top candidate: ${result.topCandidateId}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("project-mv-beat-cuts")
  .description(
    "Project MV beat-analysis metadata and visual clip assets into a CAS-required timeline view."
  )
  .requiredOption("--action <path>", "Audio beat AssetMetadataFillAction JSON file")
  .requiredOption("--audio-src <path>", "Project-relative local audio asset path")
  .requiredOption("--clips <path>", "JSON array of visual clips: { assetId, type, path, sourceStartFrame? }")
  .option("--assets <path>", "Asset manifest path", "assets/manifest.json")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const cwd = process.cwd();
      const clips = parseArrayJson(
        JSON.parse(await readFile(resolveLocalPath(cwd, options.clips), "utf8")),
        "clips",
      );
      const result = await projectMvBeatCutsTimeline({
        cwd,
        actionPath: options.action,
        audioSrc: options.audioSrc,
        clips,
        assetsPath: options.assets,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`projected MV beat cuts for ${result.targetAssetId}`);
      console.log(`timeline: ${result.timelineProjectionPath}`);
      console.log(`manifest: ${result.manifestPath}`);
      console.log(`timeline lock required: ${result.timelineLockPath}`);
      console.log(`cuts: ${result.cuts}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("verify-mv-beat-sync")
  .description(
    "Verify MV beat-analysis metadata, section cut-density, beat-cut projection coverage, and CAS apply contract."
  )
  .requiredOption("--action <path>", "Audio beat AssetMetadataFillAction JSON file")
  .option("--projection <path>", "MV beat-cut timeline projection manifest JSON path")
  .option("--out <path>", "Output MV beat-sync verification report path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await verifyMvBeatSync({
        cwd: process.cwd(),
        actionPath: options.action,
        projectionPath: options.projection,
        outPath: options.out,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`verified MV beat sync: ${result.status}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`beats: ${result.beats}`);
      console.log(`downbeats: ${result.downbeats}`);
      console.log(`sections: ${result.sections}`);
      console.log(`cut assignments: ${result.cutAssignments}`);
      if (result.blockedReasons.length > 0) console.log(`blocked: ${result.blockedReasons.join("; ")}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-ad-delivery-spec")
  .description(
    "Plan TVC/ad platform delivery specs, packshot, end-card, CTA, and disclaimer QA as metadata."
  )
  .requiredOption("--target-asset <id>", "Target ad/video asset id")
  .requiredOption("--brand <name>", "Brand/product name")
  .requiredOption("--platforms <list>", "Comma-separated platform ids, e.g. tiktok,youtube-shorts", parseStringList)
  .requiredOption("--durations <seconds>", "Comma-separated durations in seconds, e.g. 6,15,30", parsePositiveNumberList)
  .requiredOption("--aspect <ratio>", "Aspect ratio, e.g. 9:16")
  .requiredOption("--resolution <width>x<height>", "Output resolution, e.g. 1080x1920", parseResolution)
  .option("--fps <number>", "Output fps", parsePositiveNumber, 30)
  .requiredOption("--safe-zones <top,right,bottom,left>", "Safe zones in pixels", parseSafeZones)
  .requiredOption("--packshot-asset <id>", "Packshot asset id")
  .requiredOption("--packshot-start <frame>", "Packshot start frame", parseNonNegativeFrame)
  .requiredOption("--packshot-end <frame>", "Packshot end frame", parsePositiveFrame)
  .requiredOption("--end-card-duration <frames>", "End-card duration in frames", parsePositiveFrame)
  .requiredOption("--cta <text>", "End-card CTA text")
  .option("--disclaimer <text>", "Disclaimer/legal text")
  .option("--rights-ledger-asset <id>", "Reference/rights ledger asset id")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const cwd = process.cwd();
      const action = planAdDeliverySpecAction({
        targetAssetId: options.targetAsset,
        brand: options.brand,
        platforms: options.platforms,
        durations: options.durations,
        aspectRatio: options.aspect,
        width: options.resolution.width,
        height: options.resolution.height,
        fps: options.fps,
        safeZones: options.safeZones,
        packshotAssetId: options.packshotAsset,
        packshotStartFrame: options.packshotStart,
        packshotEndFrame: options.packshotEnd,
        endCardDurationFrames: options.endCardDuration,
        cta: options.cta,
        disclaimer: options.disclaimer,
        rightsLedgerAssetId: options.rightsLedgerAsset,
      });
      const actionPath = resolveAgentOutputPath(
        cwd,
        options.out ?? join("actions", `${options.targetAsset}.ad-delivery-spec.json`),
        "Ad delivery spec action",
      );
      await writeJson(actionPath, action);
      const metadata = action.metadata as Extract<typeof action.metadata, { kind: "ad.delivery-spec" }>;
      const result = {
        planned: true,
        targetAssetId: action.targetAssetId,
        actionPath,
        platforms: metadata.platforms.length,
        variants: metadata.variants.length,
        packshotAssetId: metadata.packshot.assetId,
        cta: metadata.endCard.cta,
      };
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned ad delivery spec for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`platforms: ${result.platforms}`);
      console.log(`variants: ${result.variants}`);
      console.log(`packshot: ${result.packshotAssetId}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("extract-ad-visual-frames")
  .description("Extract local rendered ad video frames into PPM samples for downstream pixel QA.")
  .requiredOption("--target-asset <id>", "TVC/ad asset id receiving ad.visual-qa metadata")
  .requiredOption("--delivery-spec <path>", "Applied ad delivery spec projection JSON")
  .requiredOption("--variant <id>", "Delivery variant id being checked")
  .requiredOption("--rendered <path>", "Rendered TVC/ad export project-relative path")
  .requiredOption("--packshot-frame <frame>", "Zero-based rendered frame index from the packshot range", parseNonNegativeFrame)
  .requiredOption("--end-card-frame <frame>", "Zero-based rendered frame index from the end-card range", parseNonNegativeFrame)
  .requiredOption("--final-frame <frame>", "Zero-based rendered final frame index", parseNonNegativeFrame)
  .option("--out-dir <path>", "Output directory for extracted PPM frame samples")
  .option("--manifest <path>", "Output visual frame extraction manifest JSON path")
  .option("--ffmpeg <path>", "ffmpeg executable path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await extractAdVisualFrames({
        cwd: process.cwd(),
        targetAssetId: options.targetAsset,
        deliverySpecPath: options.deliverySpec,
        variantId: options.variant,
        renderedPath: options.rendered,
        packshotFrame: options.packshotFrame,
        endCardFrame: options.endCardFrame,
        finalFrame: options.finalFrame,
        outDir: options.outDir,
        manifestPath: options.manifest,
        ffmpegPath: options.ffmpeg,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`extracted ad visual frames for ${result.targetAssetId}`);
      console.log(`variant: ${result.variantId}`);
      console.log(`manifest: ${result.manifestPath}`);
      console.log(`samples: ${result.samples}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("analyze-ad-visual-pixels")
  .description(
    "Analyze local PPM ad frame samples into packshot/end-card/final-frame visual QA evidence."
  )
  .requiredOption("--target-asset <id>", "TVC/ad asset id receiving ad.visual-qa metadata")
  .requiredOption("--delivery-spec <path>", "Applied ad delivery spec projection JSON")
  .requiredOption("--variant <id>", "Delivery variant id being checked")
  .requiredOption("--rendered-path <path>", "Rendered TVC/ad export project-relative path")
  .requiredOption("--packshot-frame <path>", "Project-relative PPM frame sample from the packshot range")
  .requiredOption("--packshot-color <#rrggbb>", "Expected packshot dominant/sample color")
  .requiredOption("--end-card-frame <path>", "Project-relative PPM end-card reference frame sample")
  .requiredOption("--final-frame <path>", "Project-relative PPM final frame sample")
  .option("--out <path>", "Output local ad visual QA evidence JSON path")
  .option("--packshot-min-coverage <ratio>", "Minimum packshot color match ratio", parsePositiveNumber, 0.5)
  .option("--color-tolerance <number>", "Per-channel RGB tolerance for packshot color", parseNonNegativeFrame, 18)
  .option("--final-frame-max-mean-diff <number>", "Maximum final/end-card mean absolute RGB diff", parsePositiveNumber, 2)
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await analyzeAdVisualPixels({
        cwd: process.cwd(),
        targetAssetId: options.targetAsset,
        deliverySpecPath: options.deliverySpec,
        variantId: options.variant,
        renderedPath: options.renderedPath,
        packshotFramePath: options.packshotFrame,
        packshotColor: options.packshotColor,
        endCardFramePath: options.endCardFrame,
        finalFramePath: options.finalFrame,
        outPath: options.out,
        packshotMinCoverage: options.packshotMinCoverage,
        colorTolerance: options.colorTolerance,
        finalFrameMaxMeanDiff: options.finalFrameMaxMeanDiff,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`analyzed ad visual pixels for ${result.targetAssetId}`);
      console.log(`variant: ${result.variantId}`);
      console.log(`evidence: ${result.evidencePath}`);
      console.log(`checks: ${result.checks}`);
      console.log(`pixel samples: ${result.pixelSamples}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-ad-visual-qa")
  .description(
    "Plan ad visual QA metadata from local OCR/logo/pixel evidence without executing visual analysis backends."
  )
  .requiredOption("--target-asset <id>", "TVC/ad asset id receiving ad.visual-qa metadata")
  .requiredOption("--delivery-spec <path>", "Applied ad delivery spec projection JSON")
  .requiredOption("--variant <id>", "Delivery variant id being checked")
  .requiredOption("--evidence <path>", "Local ad visual QA evidence JSON")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--report <path>", "Output ad visual QA report JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await planAdVisualQaAction({
        cwd: process.cwd(),
        targetAssetId: options.targetAsset,
        deliverySpecPath: options.deliverySpec,
        variantId: options.variant,
        evidencePath: options.evidence,
        outPath: options.out,
        reportPath: options.report,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned ad visual QA for ${result.targetAssetId}`);
      console.log(`variant: ${result.variantId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`verdict: ${result.verdict}`);
      console.log(`checks: ${result.checks}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("validate-ad-delivery-export")
  .description(
    "Validate a rendered TVC/ad export against an ad.delivery-spec projection, media probe, and visual QA report."
  )
  .requiredOption("--delivery-spec <path>", "projections/delivery/*.delivery-spec.json")
  .requiredOption("--variant <id>", "Delivery variant id, e.g. tiktok-9x16-15s")
  .requiredOption("--rendered <path>", "Project-relative rendered export path")
  .option("--probe <path>", "Optional precomputed media probe JSON; otherwise ffprobe reads --rendered")
  .option("--visual-report <path>", "Optional packshot/end-card/caption/safe-zone visual QA JSON")
  .option("--out <path>", "Output validation receipt JSON path")
  .option("--ffprobe <path>", "ffprobe binary path when --probe is not supplied")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await validateAdDeliveryExport({
        cwd: process.cwd(),
        deliverySpecPath: options.deliverySpec,
        variantId: options.variant,
        renderedPath: options.rendered,
        probePath: options.probe,
        visualReportPath: options.visualReport,
        outPath: options.out,
        ffprobePath: options.ffprobe,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`validated ad delivery export for ${result.targetAssetId}`);
      console.log(`variant: ${result.variantId}`);
      console.log(`verdict: ${result.verdict}`);
      console.log(`receipt: ${result.receiptPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-reference-review")
  .description(
    "Plan TVC/hotspot reference metadata with rights and non-copying review, without downloading or remixing source media."
  )
  .requiredOption("--source-url <url>", "Public reference URL or local source identifier")
  .requiredOption("--target-asset <id>", "Target reference asset id")
  .option("--shots <path>", "Optional shot-analysis JSON array")
  .option("--license <value>", "Rights license label", "unknown")
  .option("--attribution <value>", "Attribution text", "unknown")
  .option("--redistribution-allowed", "Mark redistribution as allowed")
  .option("--derivative-allowed", "Mark derivative use as allowed")
  .option("--qa-status <status>", "Non-copying QA status: passed, requires-review, failed", parseQaStatus, "requires-review")
  .option("--similarity <score>", "Optional source similarity score from 0 to 1", parseScore)
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const cwd = process.cwd();
      const shots = options.shots
        ? parseShotsJson(JSON.parse(await readFile(resolveLocalPath(cwd, options.shots), "utf8")))
        : [];
      const action = planReferenceReviewAction({
        targetAssetId: options.targetAsset,
        sourceUrl: options.sourceUrl,
        license: options.license,
        attribution: options.attribution,
        redistributionAllowed: options.redistributionAllowed === true,
        derivativeAllowed: options.derivativeAllowed === true,
        shots,
        nonCopyingQa: {
          status: options.qaStatus,
          similarityScore: options.similarity,
        },
      });
      const actionPath = resolveAgentOutputPath(
        cwd,
        options.out ?? join("actions", `${options.targetAsset}.reference-review.json`),
        "Reference review action",
      );
      await writeJson(actionPath, action);
      const metadata = action.metadata as Extract<typeof action.metadata, { kind: "reference-video.analysis" }>;
      const result = {
        planned: true,
        targetAssetId: action.targetAssetId,
        actionPath,
        derivativeAllowed: metadata.rights.derivativeAllowed,
        redistributionAllowed: metadata.rights.redistributionAllowed,
        shots: metadata.shots.length,
        qaStatus: metadata.nonCopyingQa?.status,
      };
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned reference review for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`derivative allowed: ${result.derivativeAllowed}`);
      console.log(`redistribution allowed: ${result.redistributionAllowed}`);
      console.log(`shots: ${result.shots}`);
      console.log(`qa: ${result.qaStatus}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-reference-download")
  .description(
    "Plan a controlled public reference download without executing it or allowing silent redistribution."
  )
  .requiredOption("--source-url <url>", "Public reference URL to be downloaded by the user/agent after review")
  .requiredOption("--target-asset <id>", "Target reference asset id")
  .option("--out <path>", "Output reference download plan JSON path")
  .option("--output-dir <path>", "Quarantined raw reference output directory", "references/raw/<target-asset>")
  .option("--allow-download", "Explicitly allow creating an executable download command plan")
  .option("--license <value>", "Rights license label", "unknown")
  .option("--attribution <value>", "Attribution text", "unknown")
  .option("--allowed-uses <list>", "Comma-separated allowed uses, e.g. analysis-only,shot-breakdown", parseStringList)
  .option("--redistribution-allowed", "Mark raw reference redistribution as allowed")
  .option("--derivative-allowed", "Mark derivative use as allowed")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await planReferenceDownload({
        cwd: process.cwd(),
        sourceUrl: options.sourceUrl,
        targetAssetId: options.targetAsset,
        outPath: options.out,
        outputDir: options.outputDir === "references/raw/<target-asset>" ? undefined : options.outputDir,
        allowDownload: options.allowDownload === true,
        license: options.license,
        attribution: options.attribution,
        allowedUses: options.allowedUses,
        redistributionAllowed: options.redistributionAllowed === true,
        derivativeAllowed: options.derivativeAllowed === true,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned reference download for ${result.targetAssetId}`);
      console.log(`status: ${result.status}`);
      console.log(`plan: ${result.planPath}`);
      console.log(`download allowed: ${result.downloadAllowed}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("execute-reference-download")
  .description(
    "Execute an explicitly allowed reference download plan locally, keep output quarantined, and register the raw reference asset."
  )
  .requiredOption("--plan <path>", "clash.reference.download-plan JSON path")
  .option("--assets <path>", "Asset manifest path", "assets/manifest.json")
  .option("--runner <path>", "Optional yt-dlp-compatible runner path")
  .option("--out <path>", "Output reference download receipt JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await executeReferenceDownload({
        cwd: process.cwd(),
        planPath: options.plan,
        assetsPath: options.assets,
        runnerPath: options.runner,
        outPath: options.out,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`executed reference download for ${result.targetAssetId}`);
      console.log(`receipt: ${result.receiptPath}`);
      console.log(`files: ${result.downloadedFiles.join(", ")}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-reference-noncopying-qa")
  .description(
    "Plan non-copying QA for a reference-inspired TVC/hotspot treatment and emit a reference metadata-fill action."
  )
  .requiredOption("--reference <path>", "Reference analysis JSON with sourceLedger and shots")
  .requiredOption("--proposal <path>", "Proposed treatment JSON with shots")
  .requiredOption("--target-asset <id>", "Target reference asset id")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--report <path>", "Output non-copying QA report JSON path")
  .option("--fps <number>", "Timeline/video fps for converting reference shot ranges", parsePositiveNumber, 30)
  .option("--similarity-threshold <score>", "Review threshold from 0 to 1", parseScore, 0.5)
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const cwd = process.cwd();
      const reference = JSON.parse(await readFile(resolveLocalPath(cwd, options.reference), "utf8"));
      const proposal = JSON.parse(await readFile(resolveLocalPath(cwd, options.proposal), "utf8"));
      const { action, report } = planReferenceNonCopyingQaAction({
        targetAssetId: options.targetAsset,
        reference,
        proposal,
        fps: options.fps,
        similarityThreshold: options.similarityThreshold,
      });
      const actionPath = resolveAgentOutputPath(
        cwd,
        options.out ?? join("actions", `${options.targetAsset}.reference-noncopying-qa.json`),
        "Reference non-copying QA action",
      );
      const reportPath = resolveAgentOutputPath(
        cwd,
        options.report ?? join("projections", "references", `${report.referenceId}.noncopying-qa.json`),
        "Reference non-copying QA report",
      );
      await writeJson(actionPath, action);
      await writeJson(reportPath, report);
      const result = {
        planned: true,
        targetAssetId: action.targetAssetId,
        actionPath,
        reportPath,
        status: report.status,
        similarityScore: report.similarityScore,
        blockedReasons: report.blockedReasons,
      };
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned non-copying QA for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`status: ${result.status}`);
      console.log(`similarity: ${result.similarityScore}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("verify-reference-isolation")
  .description(
    "Verify that a final timeline does not directly reuse unlicensed quarantined raw reference assets."
  )
  .requiredOption("--timeline <path>", "Timeline YAML file to verify")
  .option("--assets <path>", "Asset manifest path", "assets/manifest.json")
  .option("--out <path>", "Output reference isolation verification report path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await verifyReferenceIsolation({
        cwd: process.cwd(),
        timelinePath: options.timeline,
        assetsPath: options.assets,
        outPath: options.out,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`verified reference isolation: ${result.status}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`raw reference assets: ${result.rawReferenceAssets}`);
      console.log(`timeline items: ${result.timelineItems}`);
      console.log(`offenders: ${result.offenders}`);
      if (result.blockedReasons.length > 0) console.log(`blocked: ${result.blockedReasons.join("; ")}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-storyboard-consistency-qa")
  .description(
    "Plan short-drama/image storyboard consistency QA and emit a storyboard metadata-fill action."
  )
  .requiredOption("--target-asset <id>", "Target storyboard/image asset id")
  .option("--characters <path>", "Character/reference-sheet JSON array")
  .option("--scenes <path>", "Scene JSON array")
  .option("--panels <path>", "Storyboard panel JSON array")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--report <path>", "Output storyboard consistency QA report JSON path")
  .option("--min-consistency <score>", "Minimum accepted panel consistency score from 0 to 1", parseScore, 0.75)
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const cwd = process.cwd();
      const characters = options.characters
        ? parseArrayJson(JSON.parse(await readFile(resolveLocalPath(cwd, options.characters), "utf8")), "characters")
        : [];
      const scenes = options.scenes
        ? parseArrayJson(JSON.parse(await readFile(resolveLocalPath(cwd, options.scenes), "utf8")), "scenes")
        : [];
      const panels = options.panels
        ? parseArrayJson(JSON.parse(await readFile(resolveLocalPath(cwd, options.panels), "utf8")), "panels")
        : [];
      const { action, report } = planStoryboardConsistencyQaAction({
        targetAssetId: options.targetAsset,
        characters,
        scenes,
        panels,
        minConsistency: options.minConsistency,
      });
      const actionPath = resolveAgentOutputPath(
        cwd,
        options.out ?? join("actions", `${options.targetAsset}.storyboard-consistency-qa.json`),
        "Storyboard consistency QA action",
      );
      const reportPath = resolveAgentOutputPath(
        cwd,
        options.report ?? join("projections", "storyboards", `${options.targetAsset}.consistency-qa.json`),
        "Storyboard consistency QA report",
      );
      await writeJson(actionPath, action);
      await writeJson(reportPath, report);
      const result = {
        planned: true,
        targetAssetId: action.targetAssetId,
        actionPath,
        reportPath,
        verdict: report.verdict,
        issues: report.issues.length,
        panels: action.metadata.kind === "image.storyboard-consistency" ? action.metadata.panels.length : 0,
      };
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned storyboard consistency QA for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`verdict: ${result.verdict}`);
      console.log(`issues: ${result.issues}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("plan-storyboard-review")
  .description(
    "Plan short-drama/image storyboard consistency metadata from character, scene, and panel JSON files."
  )
  .requiredOption("--target-asset <id>", "Target storyboard/image asset id")
  .option("--characters <path>", "Character/reference-sheet JSON array")
  .option("--scenes <path>", "Scene JSON array")
  .option("--panels <path>", "Storyboard panel JSON array")
  .option("--out <path>", "Output AssetMetadataFillAction JSON path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const cwd = process.cwd();
      const characters = options.characters
        ? parseArrayJson(JSON.parse(await readFile(resolveLocalPath(cwd, options.characters), "utf8")), "characters")
        : [];
      const scenes = options.scenes
        ? parseArrayJson(JSON.parse(await readFile(resolveLocalPath(cwd, options.scenes), "utf8")), "scenes")
        : [];
      const panels = options.panels
        ? parseArrayJson(JSON.parse(await readFile(resolveLocalPath(cwd, options.panels), "utf8")), "panels")
        : [];
      const action = planStoryboardConsistencyAction({
        targetAssetId: options.targetAsset,
        characters,
        scenes,
        panels,
      });
      const actionPath = resolveAgentOutputPath(
        cwd,
        options.out ?? join("actions", `${options.targetAsset}.storyboard-review.json`),
        "Storyboard review action",
      );
      await writeJson(actionPath, action);
      const metadata = action.metadata as Extract<typeof action.metadata, { kind: "image.storyboard-consistency" }>;
      const result = {
        planned: true,
        targetAssetId: action.targetAssetId,
        actionPath,
        characters: metadata.characters.length,
        scenes: metadata.scenes.length,
        panels: metadata.panels.length,
      };
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`planned storyboard review for ${result.targetAssetId}`);
      console.log(`action: ${result.actionPath}`);
      console.log(`characters: ${result.characters}`);
      console.log(`scenes: ${result.scenes}`);
      console.log(`panels: ${result.panels}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("project-storyboard-prompt-pack")
  .description(
    "Project storyboard metadata into an editable CAS-locked prompt pack for image/video generation."
  )
  .requiredOption("--action <path>", "Storyboard AssetMetadataFillAction JSON file")
  .option("--out <path>", "Editable prompt-pack JSON path", "plans/prompt-pack.json")
  .option("--style <text>", "Style prompt appended to every panel prompt")
  .option("--negative <text>", "Negative prompt copied to every panel prompt")
  .option("--model <text>", "Optional model hint copied to every prompt")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await projectStoryboardPromptPack({
        cwd: process.cwd(),
        actionPath: options.action,
        outPath: options.out,
        stylePrompt: options.style,
        negativePrompt: options.negative,
        modelHint: options.model,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`projected storyboard prompt pack for ${result.storyboardAssetId}`);
      console.log(`prompt pack: ${result.promptPackPath}`);
      console.log(`lock: ${result.lockPath}`);
      console.log(`manifest: ${result.manifestPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("apply-storyboard-prompt-pack")
  .description(
    "Apply an edited storyboard prompt pack into managed projections with CAS stale-write protection."
  )
  .requiredOption("--file <path>", "Editable prompt-pack JSON path")
  .option("--lock <path>", "CAS lock path; defaults to prompt-pack sidecar")
  .option("--force", "Bypass CAS and intentionally overwrite the managed prompt-pack projection")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await applyStoryboardPromptPack({
        cwd: process.cwd(),
        filePath: options.file,
        lockPath: options.lock,
        force: options.force === true,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`applied storyboard prompt pack for ${result.storyboardAssetId}`);
      console.log(`projection: ${result.projectionPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("replace-storyboard-prompt-pack")
  .description(
    "Create a copy-on-write storyboard prompt-pack projection with CAS stale-write protection."
  )
  .requiredOption("--file <path>", "Editable prompt-pack JSON path")
  .option("--lock <path>", "CAS lock path; defaults to prompt-pack sidecar")
  .option("--force", "Bypass CAS and intentionally fork from the current managed prompt-pack projection")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await replaceStoryboardPromptPack({
        cwd: process.cwd(),
        filePath: options.file,
        lockPath: options.lock,
        force: options.force === true,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`replaced storyboard prompt pack for ${result.storyboardAssetId}`);
      console.log(`projection: ${result.projectionPath}`);
      console.log(`copy-on-write: ${result.copyOnWrite}`);
      console.log(`prompt-pack hash: ${result.promptPackHash}`);
      if (result.sourcePromptPackHash) {
        console.log(`source prompt-pack hash: ${result.sourcePromptPackHash}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("project-storyboard-timeline")
  .description(
    "Project storyboard panel assets into a CAS-required image timeline view."
  )
  .requiredOption("--action <path>", "Storyboard AssetMetadataFillAction JSON file")
  .option("--assets <path>", "Asset manifest path", "assets/manifest.json")
  .option("--duration-per-panel <frames>", "Frame duration for each storyboard panel", parsePositiveFrame, 90)
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await projectStoryboardTimeline({
        cwd: process.cwd(),
        actionPath: options.action,
        assetsPath: options.assets,
        durationPerPanel: options.durationPerPanel,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`projected storyboard timeline for ${result.storyboardAssetId}`);
      console.log(`timeline: ${result.timelineProjectionPath}`);
      console.log(`manifest: ${result.manifestPath}`);
      console.log(`timeline lock required: ${result.timelineLockPath}`);
      console.log(`panels: ${result.panels}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

productionCommand
  .command("verify-storyboard-timeline")
  .description(
    "Verify storyboard timeline projection coverage, consistency scores, local assets, and CAS apply contract."
  )
  .requiredOption("--action <path>", "Storyboard image.storyboard-consistency AssetMetadataFillAction JSON file")
  .requiredOption("--manifest <path>", "Storyboard timeline projection manifest JSON path")
  .option("--min-consistency <score>", "Minimum panel consistency score from 0 to 1", parseScore, 0.75)
  .option("--out <path>", "Output storyboard timeline verification report path")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const result = await verifyStoryboardTimeline({
        cwd: process.cwd(),
        actionPath: options.action,
        manifestPath: options.manifest,
        minConsistency: options.minConsistency,
        outPath: options.out,
      });
      if (isJsonMode(options)) {
        printJson(result);
        return;
      }
      console.log(`verified storyboard timeline: ${result.status}`);
      console.log(`report: ${result.reportPath}`);
      console.log(`panels: ${result.panels}`);
      console.log(`timeline items: ${result.timelineItems}`);
      console.log(`low consistency panels: ${result.lowConsistencyPanels}`);
      if (result.blockedReasons.length > 0) console.log(`blocked: ${result.blockedReasons.join("; ")}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

function parseNonNegativeFrame(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--from must be a non-negative integer frame");
  }
  return parsed;
}

function parseFrameList(value: string): number[] {
  const frames = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part));
  if (frames.length === 0 || frames.some((frame) => !Number.isInteger(frame) || frame < 0)) {
    throw new Error("--frames must be a comma-separated list of non-negative integer frames");
  }
  return frames;
}

function parseScore(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("score must be between 0 and 1");
  }
  return parsed;
}

function parsePositiveFrame(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("frame count must be a positive integer");
  }
  return parsed;
}

function parseDerivedOverlayMediaType(value: string): DerivedOverlayMediaType {
  if (value === "image" || value === "video") return value;
  throw new Error("derived overlay media type must be image or video");
}

function parseDerivedOverlayDerivationKind(value: string): DerivedOverlayDerivationKind {
  if (
    value === "trim" ||
    value === "crop" ||
    value === "caption-burn" ||
    value === "mg-render" ||
    value === "transcode" ||
    value === "other"
  ) {
    return value;
  }
  throw new Error("derivation kind must be trim, crop, caption-burn, mg-render, transcode, or other");
}

function parseQaStatus(value: string): "passed" | "requires-review" | "failed" {
  if (value === "passed" || value === "requires-review" || value === "failed") return value;
  throw new Error("qa status must be passed, requires-review, or failed");
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("value must be a positive number");
  }
  return parsed;
}

function parseStringList(value: string): string[] {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error("value must be a comma-separated non-empty list");
  }
  return parts;
}

function collectString(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parsePositiveNumberList(value: string): number[] {
  const parts = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));
  if (parts.length === 0 || parts.some((part) => part <= 0)) {
    throw new Error("value must be a comma-separated list of positive numbers");
  }
  return parts;
}

function roundNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function parseResolution(value: string): { width: number; height: number } {
  const match = value.trim().match(/^([0-9]+)x([0-9]+)$/i);
  if (!match) {
    throw new Error("resolution must use <width>x<height>, e.g. 1080x1920");
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("resolution width and height must be positive integers");
  }
  return { width, height };
}

function parseSafeZones(value: string): { top: number; right: number; bottom: number; left: number } {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error("safe zones must be top,right,bottom,left non-negative integer pixels");
  }
  return {
    top: parts[0],
    right: parts[1],
    bottom: parts[2],
    left: parts[3],
  };
}

function parseTranscriptJson(input: unknown): {
  fps?: number;
  words: any[];
  backendId?: string;
  modelId?: string;
  language?: string;
  durationFrames?: number;
  averageConfidence?: number;
} {
  if (Array.isArray(input)) return { words: input };
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (Array.isArray(record.words)) {
      const asr = record.asr && typeof record.asr === "object" && !Array.isArray(record.asr)
        ? record.asr as Record<string, unknown>
        : {};
      return {
        fps: typeof record.fps === "number" ? record.fps : undefined,
        words: record.words,
        backendId: readString(record.backendId) ?? readString(asr.backendId),
        modelId: readString(record.modelId) ?? readString(asr.modelId),
        language: readString(record.language) ?? readString(asr.language),
        durationFrames: readNonNegativeInteger(record.durationFrames) ?? readNonNegativeInteger(asr.durationFrames),
        averageConfidence: readConfidence(record.averageConfidence) ?? readConfidence(asr.averageConfidence),
      };
    }
  }
  throw new Error("Transcript JSON must be an array of words or an object with a words array");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readConfidence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function parseShotsJson(input: unknown): any[] {
  return parseArrayJson(input, "shots");
}

function parseArrayJson(input: unknown, label: string): any[] {
  if (!Array.isArray(input)) {
    throw new Error(`${label} JSON must be an array`);
  }
  return input;
}

function resolveLocalPath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function resolveAgentOutputPath(cwd: string, path: string, writeVerb: string): string {
  return resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveLocalPath(cwd, path),
    writeVerb,
  });
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join("/");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
