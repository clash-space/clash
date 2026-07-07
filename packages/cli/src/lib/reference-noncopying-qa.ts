import {
  AssetMetadataFillActionSchema,
  ReferenceShotSchema,
  type AssetMetadataFillAction,
} from "@clash/shared-types";

export type ReferenceAnalysisInput = {
  schemaVersion?: number;
  referenceId: string;
  sourceLedger: {
    sourceUrl: string;
    license: string;
    attribution?: string;
    allowedUses?: string[];
    redistributionAllowed?: boolean;
  };
  shots: Array<{
    id: string;
    startMs: number;
    endMs: number;
    description: string;
    tags?: string[];
  }>;
  remixConstraints?: string[];
};

export type ProposedTreatmentInput = {
  shots: Array<{
    id: string;
    description: string;
    tags?: string[];
    assetPath?: string;
    usesRawReference?: boolean;
    sourceFrameIds?: string[];
  }>;
};

export type ReferenceNonCopyingQaReport = {
  schemaVersion: 1;
  kind: "clash.reference.noncopying-qa";
  referenceId: string;
  sourceUrl: string;
  status: "passed" | "requires-review" | "failed";
  similarityScore: number;
  similarityThreshold: number;
  blockedReasons: string[];
  checks: {
    rawReferenceAssetReuse: { pass: boolean; offenders: string[] };
    structureSimilarity: { pass: boolean; threshold: number; maxScore: number };
  };
  matches: Array<{
    referenceShotId: string;
    proposedShotId: string;
    similarityScore: number;
    sharedTerms: string[];
  }>;
};

export type PlanReferenceNonCopyingQaOptions = {
  targetAssetId: string;
  reference: ReferenceAnalysisInput;
  proposal: ProposedTreatmentInput;
  fps?: number;
  similarityThreshold?: number;
  actionId?: string;
  producer?: string;
  createdAt?: string;
};

export type PlanReferenceNonCopyingQaResult = {
  action: AssetMetadataFillAction;
  report: ReferenceNonCopyingQaReport;
};

export function planReferenceNonCopyingQaAction(
  options: PlanReferenceNonCopyingQaOptions,
): PlanReferenceNonCopyingQaResult {
  const fps = options.fps ?? 30;
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("fps must be a positive number");
  }
  const threshold = options.similarityThreshold ?? 0.5;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("similarity threshold must be between 0 and 1");
  }

  const matches = bestShotMatches(options.reference, options.proposal);
  const similarityScore = roundScore(
    matches.reduce((max, match) => Math.max(max, match.similarityScore), 0),
  );
  const rawReferenceOffenders = options.proposal.shots
    .filter((shot) => reusesRawReference(shot))
    .map((shot) => shot.id);
  const rawReferenceAssetReusePass = rawReferenceOffenders.length === 0;
  const structureSimilarityPass = similarityScore < threshold;
  const blockedReasons = [
    ...(rawReferenceAssetReusePass ? [] : ["proposal reuses raw reference assets"]),
    ...(structureSimilarityPass ? [] : ["proposed shots are structurally close to reference shots"]),
  ];
  const status = rawReferenceAssetReusePass
    ? (structureSimilarityPass ? "passed" : "requires-review")
    : "failed";
  const report: ReferenceNonCopyingQaReport = {
    schemaVersion: 1,
    kind: "clash.reference.noncopying-qa",
    referenceId: options.reference.referenceId,
    sourceUrl: options.reference.sourceLedger.sourceUrl,
    status,
    similarityScore,
    similarityThreshold: threshold,
    blockedReasons,
    checks: {
      rawReferenceAssetReuse: { pass: rawReferenceAssetReusePass, offenders: rawReferenceOffenders },
      structureSimilarity: { pass: structureSimilarityPass, threshold, maxScore: similarityScore },
    },
    matches: matches
      .filter((match) => match.similarityScore > 0)
      .map((match) => ({
        ...match,
        similarityScore: roundScore(match.similarityScore),
      })),
  };

  const referenceShots = ReferenceShotSchema.array().parse(
    options.reference.shots.map((shot) => ({
      id: shot.id,
      startFrame: Math.max(0, Math.round((shot.startMs / 1000) * fps)),
      endFrame: Math.max(1, Math.round((shot.endMs / 1000) * fps)),
      description: shot.description,
      tags: shot.tags ?? [],
    })),
  );
  const allowedUses = new Set((options.reference.sourceLedger.allowedUses ?? []).map((item) => item.toLowerCase()));
  const derivativeAllowed = allowedUses.has("derivative") || allowedUses.has("transformative-remix");
  const action = AssetMetadataFillActionSchema.parse({
    actionId: options.actionId ?? `reference-noncopying-qa-${options.targetAssetId}`,
    targetAssetId: options.targetAssetId,
    metadataKind: "reference-video.analysis",
    producer: options.producer ?? "clash-production-plan-reference-noncopying-qa",
    createdAt: options.createdAt,
    metadata: {
      kind: "reference-video.analysis",
      sourceUrl: options.reference.sourceLedger.sourceUrl,
      rights: {
        license: options.reference.sourceLedger.license,
        attribution: options.reference.sourceLedger.attribution ?? "unknown",
        redistributionAllowed: options.reference.sourceLedger.redistributionAllowed === true,
        derivativeAllowed,
      },
      shots: referenceShots,
      nonCopyingQa: {
        status,
        similarityScore,
      },
    },
  });

  return { action, report };
}

function bestShotMatches(
  reference: ReferenceAnalysisInput,
  proposal: ProposedTreatmentInput,
): ReferenceNonCopyingQaReport["matches"] {
  const matches: ReferenceNonCopyingQaReport["matches"] = [];
  for (const referenceShot of reference.shots) {
    const referenceTerms = shotTerms(referenceShot);
    let best: ReferenceNonCopyingQaReport["matches"][number] | undefined;
    for (const proposedShot of proposal.shots) {
      const proposedTerms = shotTerms(proposedShot);
      const sharedTerms = Array.from(referenceTerms).filter((term) => proposedTerms.has(term)).sort();
      const denominator = Math.max(1, Math.min(referenceTerms.size, proposedTerms.size));
      const similarityScore = sharedTerms.length / denominator;
      if (!best || similarityScore > best.similarityScore) {
        best = {
          referenceShotId: referenceShot.id,
          proposedShotId: proposedShot.id,
          similarityScore,
          sharedTerms,
        };
      }
    }
    if (best) matches.push(best);
  }
  return matches.sort((a, b) => b.similarityScore - a.similarityScore);
}

function shotTerms(shot: { description: string; tags?: string[] }): Set<string> {
  const rawTerms = [
    shot.description,
    ...(shot.tags ?? []),
  ].join(" ");
  return new Set(
    rawTerms
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && !STOP_WORDS.has(term)),
  );
}

function reusesRawReference(shot: {
  assetPath?: string;
  usesRawReference?: boolean;
  sourceFrameIds?: string[];
}): boolean {
  if (shot.usesRawReference === true) return true;
  if (Array.isArray(shot.sourceFrameIds) && shot.sourceFrameIds.length > 0) return true;
  if (typeof shot.assetPath === "string") {
    const normalized = shot.assetPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
    return normalized.startsWith("references/raw/") || normalized.startsWith("reference/raw/");
  }
  return false;
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "by",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
]);
