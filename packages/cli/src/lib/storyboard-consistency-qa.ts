import {
  AssetMetadataFillActionSchema,
  ImageStoryboardMetadataSchema,
  type AssetMetadataFillAction,
  type ImageStoryboardMetadata,
} from "@clash/shared-types";

export type StoryboardConsistencyQaReport = {
  schemaVersion: 1;
  kind: "clash.image.storyboard-consistency-qa";
  assetPackId: string;
  scores: {
    identity: number;
    wardrobe: number;
    scene: number;
    productLogo: number;
    style: number;
    composition: number;
    temporal: number;
  };
  verdict: "pass" | "warning" | "block";
  issues: string[];
  checks: {
    requiredCharacterViews: {
      pass: boolean;
      missing: Array<{ characterId: string; view: string }>;
    };
    panelReferences: {
      pass: boolean;
      unknownSceneIds: string[];
      unknownCharacterIds: string[];
    };
    panelAssets: {
      pass: boolean;
      missingPathPanelIds: string[];
    };
    panelConsistency: {
      pass: boolean;
      threshold: number;
      lowScorePanels: Array<{ panelId: string; score: number }>;
    };
  };
};

export type PlanStoryboardConsistencyQaOptions = {
  targetAssetId: string;
  characters?: unknown[];
  scenes?: unknown[];
  panels?: unknown[];
  minConsistency?: number;
  actionId?: string;
  producer?: string;
  createdAt?: string;
};

export type PlanStoryboardConsistencyQaResult = {
  action: AssetMetadataFillAction;
  report: StoryboardConsistencyQaReport;
};

export function planStoryboardConsistencyQaAction(
  options: PlanStoryboardConsistencyQaOptions,
): PlanStoryboardConsistencyQaResult {
  const threshold = options.minConsistency ?? 0.75;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("min consistency must be between 0 and 1");
  }

  const metadata = ImageStoryboardMetadataSchema.parse({
    kind: "image.storyboard-consistency",
    characters: options.characters ?? [],
    scenes: options.scenes ?? [],
    panels: options.panels ?? [],
  });
  const checks = buildChecks(metadata, threshold);
  const issues = buildIssues(checks);
  const verdict: StoryboardConsistencyQaReport["verdict"] =
    issues.some((item) => item.startsWith("missing required character view") || item.startsWith("unknown character"))
      ? "block"
      : issues.length > 0
        ? "warning"
        : "pass";
  const scores = scoreChecks(checks);
  const report: StoryboardConsistencyQaReport = {
    schemaVersion: 1,
    kind: "clash.image.storyboard-consistency-qa",
    assetPackId: options.targetAssetId,
    scores,
    verdict,
    issues,
    checks,
  };

  const action = AssetMetadataFillActionSchema.parse({
    actionId: options.actionId ?? `storyboard-consistency-qa-${options.targetAssetId}`,
    targetAssetId: options.targetAssetId,
    metadataKind: "image.storyboard-consistency",
    producer: options.producer ?? "clash-production-plan-storyboard-consistency-qa",
    createdAt: options.createdAt,
    metadata,
  });

  return { action, report };
}

function buildChecks(
  metadata: ImageStoryboardMetadata,
  threshold: number,
): StoryboardConsistencyQaReport["checks"] {
  const characterIds = new Set(metadata.characters.map((character) => character.id));
  const sceneIds = new Set(metadata.scenes.map((scene) => scene.id));
  const missingViews = metadata.characters.flatMap((character) =>
    character.requiredViews
      .filter((view) => !character.referenceAssetIds.some((assetId) => assetIdHasView(assetId, view)))
      .map((view) => ({ characterId: character.id, view })),
  );
  const unknownSceneIds = uniqueSorted(
    metadata.panels
      .filter((panel) => !sceneIds.has(panel.sceneId))
      .map((panel) => panel.sceneId),
  );
  const unknownCharacterIds = uniqueSorted(
    metadata.panels.flatMap((panel) => panel.characterIds.filter((characterId) => !characterIds.has(characterId))),
  );
  const missingPathPanelIds = metadata.panels
    .filter((panel) => !panel.path)
    .map((panel) => panel.id)
    .sort();
  const lowScorePanels = metadata.panels
    .filter((panel) => panel.consistencyScore !== undefined && panel.consistencyScore < threshold)
    .map((panel) => ({ panelId: panel.id, score: roundScore(panel.consistencyScore ?? 0) }))
    .sort((a, b) => a.panelId.localeCompare(b.panelId));

  return {
    requiredCharacterViews: {
      pass: missingViews.length === 0,
      missing: missingViews.sort((a, b) => `${a.characterId}:${a.view}`.localeCompare(`${b.characterId}:${b.view}`)),
    },
    panelReferences: {
      pass: unknownSceneIds.length === 0 && unknownCharacterIds.length === 0,
      unknownSceneIds,
      unknownCharacterIds,
    },
    panelAssets: {
      pass: missingPathPanelIds.length === 0,
      missingPathPanelIds,
    },
    panelConsistency: {
      pass: lowScorePanels.length === 0,
      threshold,
      lowScorePanels,
    },
  };
}

function buildIssues(checks: StoryboardConsistencyQaReport["checks"]): string[] {
  return [
    ...checks.requiredCharacterViews.missing.map((missing) =>
      `missing required character view: ${missing.characterId}/${missing.view}`
    ),
    ...checks.panelReferences.unknownSceneIds.map((sceneId) => `unknown scene referenced by panel: ${sceneId}`),
    ...checks.panelReferences.unknownCharacterIds.map((characterId) => `unknown character referenced by panel: ${characterId}`),
    ...checks.panelAssets.missingPathPanelIds.map((panelId) => `storyboard panel missing asset path: ${panelId}`),
    ...checks.panelConsistency.lowScorePanels.map((panel) =>
      `storyboard panel below consistency threshold: ${panel.panelId} (${panel.score})`
    ),
  ];
}

function scoreChecks(checks: StoryboardConsistencyQaReport["checks"]): StoryboardConsistencyQaReport["scores"] {
  const identity = checks.requiredCharacterViews.pass && checks.panelReferences.unknownCharacterIds.length === 0 ? 1 : 0;
  const scene = checks.panelReferences.unknownSceneIds.length === 0 ? 1 : 0;
  const composition = checks.panelAssets.pass ? 1 : 0;
  const panelScores = checks.panelConsistency.lowScorePanels;
  const temporal = checks.panelConsistency.pass
    ? 1
    : roundScore(Math.max(0, 1 - panelScores.length / Math.max(1, panelScores.length + 1)));
  return {
    identity,
    wardrobe: identity,
    scene,
    productLogo: 1,
    style: checks.panelConsistency.pass ? 1 : 0.5,
    composition,
    temporal,
  };
}

function assetIdHasView(assetId: string, view: string): boolean {
  const normalizedAssetId = assetId.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const normalizedView = view.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return normalizedAssetId.split("-").includes(normalizedView);
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
