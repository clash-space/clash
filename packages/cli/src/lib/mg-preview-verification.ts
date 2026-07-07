import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  MgCompositionSpecSchema,
  evaluateMgLayerAtFrame,
  type MgCompositionSpec,
  type MgEvaluatedLayerStyle,
} from "@clash/shared-types";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type MgPreviewVerificationOptions = {
  cwd: string;
  htmlPath: string;
  manifestPath: string;
  frames?: number[];
  outPath?: string;
};

export type MgPreviewVerificationCheck = {
  id: string;
  label: string;
  required: true;
  status: "pass" | "fail";
  expected: string;
  actual: string;
};

export type MgPreviewFrameEvaluation = {
  frame: number;
  layers: Array<{
    id: string;
    type: string;
    visible: boolean;
    style: MgEvaluatedLayerStyle;
  }>;
};

export type MgPreviewVerificationReport = {
  schemaVersion: 1;
  kind: "clash.mg.preview-verification";
  status: "pass" | "blocked";
  overlayId: string;
  htmlPath: string;
  manifestPath: string;
  framesChecked: number[];
  checks: MgPreviewVerificationCheck[];
  frameEvaluations: MgPreviewFrameEvaluation[];
  blockedReasons: string[];
};

export type MgPreviewVerificationResult = {
  status: "pass" | "blocked";
  overlayId: string;
  reportPath: string;
  framesChecked: number[];
  blockedReasons: string[];
};

export async function verifyMgPreview(
  options: MgPreviewVerificationOptions,
): Promise<MgPreviewVerificationResult> {
  const cwd = resolve(options.cwd);
  const htmlPath = resolveProjectPath(cwd, options.htmlPath, "HTML preview");
  const manifestPath = resolveProjectPath(cwd, options.manifestPath, "MG manifest");
  const html = await readFile(htmlPath, "utf8");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, any>;
  const spec = readManifestSpec(manifest);
  const frames = normalizeFrames(options.frames ?? [0, Math.min(spec.durationInFrames - 1, Math.floor(spec.durationInFrames / 2))], spec);
  const checks = buildChecks({ html, manifest });
  const frameEvaluations = frames.map((frame) => evaluateSpecFrame(spec, frame));
  const blockedReasons = checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.actual}`);
  const report: MgPreviewVerificationReport = {
    schemaVersion: 1,
    kind: "clash.mg.preview-verification",
    status: blockedReasons.length === 0 ? "pass" : "blocked",
    overlayId: requireString(manifest.overlayId, "manifest.overlayId"),
    htmlPath: toProjectPath(cwd, htmlPath),
    manifestPath: toProjectPath(cwd, manifestPath),
    framesChecked: frames,
    checks,
    frameEvaluations,
    blockedReasons,
  };
  const reportPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("qa", "mg", `${report.overlayId}.preview-verification.json`),
      "preview verification output",
    ),
    writeVerb: "MG preview verification report",
  });
  await writeJson(reportPath, report);
  return {
    status: report.status,
    overlayId: report.overlayId,
    reportPath,
    framesChecked: report.framesChecked,
    blockedReasons: report.blockedReasons,
  };
}

function buildChecks(options: { html: string; manifest: Record<string, any> }): MgPreviewVerificationCheck[] {
  const { html, manifest } = options;
  const hasExternalReference =
    /https?:\/\//i.test(html) ||
    /<script\b[^>]*\bsrc=/i.test(html) ||
    /<link\b[^>]*\bhref=/i.test(html) ||
    /\bimport\s*\(/.test(html);
  const hasSeekApi =
    html.includes("window.__CLASH_MG__") &&
    html.includes("id=\"frame-scrubber\"") &&
    html.includes("data-current-frame=\"0\"") &&
    html.includes("clash-mg-frame") &&
    html.includes("seek(frame)");
  const cas = manifest.casApply ?? {};
  const implementation = manifest.validation?.implementation ?? {};
  const spec = readManifestSpec(manifest);
  const deterministic =
    JSON.stringify(evaluateSpecFrame(spec, 0)) === JSON.stringify(evaluateSpecFrame(spec, 0));

  return [
    check({
      id: "html.self-contained",
      label: "HTML preview is self-contained",
      pass: !hasExternalReference,
      expected: "no remote URLs, external scripts, external stylesheets, or dynamic imports",
      actual: hasExternalReference ? "external reference found" : "no external references",
    }),
    check({
      id: "html.seek-api",
      label: "HTML preview exposes seek controls and frame events",
      pass: hasSeekApi,
      expected: "window.__CLASH_MG__, scrubber, data-current-frame, and clash-mg-frame event",
      actual: hasSeekApi ? "seek API present" : "seek API incomplete",
    }),
    check({
      id: "manifest.cas-fresh-pull",
      label: "Timeline apply uses fresh-pull CAS",
      pass:
        cas.target === "timeline" &&
        cas.mutation === "projection-only" &&
        cas.applyCommand === "clash timeline apply" &&
        cas.lockPath === "timelines/main.timeline.lock.json" &&
        cas.lockSource === "fresh-canvas-pull" &&
        cas.nodeIdPlaceholder === "<video-editor-node-id>" &&
        Array.isArray(cas.requiredRuntimeArgs) &&
        cas.requiredRuntimeArgs.includes("--node <video-editor-node-id>") &&
        cas.pullCommand === "clash timeline pull",
      expected: "fresh-canvas-pull lock with explicit --node runtime arg",
      actual: cas.lockSource === "fresh-canvas-pull" ? "fresh-pull CAS present" : "fresh-pull CAS missing",
    }),
    check({
      id: "implementation.first-party-license-safe",
      label: "Implementation is first-party and license-safe",
      pass:
        implementation.renderer === "clash-first-party-mg-composition" &&
        implementation.source === "first-party" &&
        implementation.license === "MIT" &&
        implementation.thirdPartyCodeCopied === false &&
        implementation.externalRuntime === false,
      expected: "first-party MIT renderer with no copied third-party runtime",
      actual: implementation.renderer === "clash-first-party-mg-composition" ? "first-party renderer declared" : "implementation declaration incomplete",
    }),
    check({
      id: "frames.deterministic-evaluation",
      label: "Frame evaluation is deterministic",
      pass: deterministic,
      expected: "same frame evaluates to identical layer styles",
      actual: deterministic ? "deterministic evaluator output" : "non-deterministic evaluator output",
    }),
  ];
}

function evaluateSpecFrame(spec: MgCompositionSpec, frame: number): MgPreviewFrameEvaluation {
  return {
    frame,
    layers: spec.layers.map((layer) => ({
      id: layer.id,
      type: layer.type,
      visible: frame >= layer.from && frame < layer.from + layer.durationInFrames,
      style: evaluateMgLayerAtFrame(layer, frame),
    })),
  };
}

function readManifestSpec(manifest: Record<string, any>): MgCompositionSpec {
  const item = Array.isArray(manifest.timelineItems) ? manifest.timelineItems[0] : undefined;
  return MgCompositionSpecSchema.parse(item?.spec);
}

function check(options: Omit<MgPreviewVerificationCheck, "required" | "status"> & { pass: boolean }): MgPreviewVerificationCheck {
  return {
    id: options.id,
    label: options.label,
    required: true,
    status: options.pass ? "pass" : "fail",
    expected: options.expected,
    actual: options.actual,
  };
}

function normalizeFrames(frames: number[], spec: MgCompositionSpec): number[] {
  const unique = Array.from(new Set(frames));
  if (unique.length === 0) throw new Error("At least one frame is required");
  for (const frame of unique) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= spec.durationInFrames) {
      throw new Error(`Frame ${frame} is outside composition duration 0-${spec.durationInFrames - 1}`);
    }
  }
  return unique.sort((a, b) => a - b);
}

function resolveProjectPath(cwd: string, rawPath: string, label: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error(`${label} path is required`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) {
    throw new Error(`${label} path must be a local project path, not a URL`);
  }
  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
  if (!isInsideOrEqual(cwd, resolved)) {
    throw new Error(`${label} path must stay inside the current project cwd`);
  }
  return resolved;
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join("/");
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
