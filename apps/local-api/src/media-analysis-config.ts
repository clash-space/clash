import type {
  ActionRunModelRoute,
  ModelCatalogEntry,
} from "@clash/shared-types";

import { createClashUserConfigStore, type ClashUserConfigStore } from "./user-config.js";

export type MediaAnalysisSourceKind = "image" | "video" | "audio";

export interface MediaAnalysisModelOption {
  id: string;
  name: string;
  provider: string;
  route: string;
  consumer: {
    pluginId: string;
    definitionId?: string;
    actionId?: string;
  };
  visibility: "public" | "plugin-private";
  underlyingModel: string;
  /** Exact implementation identity the Host freezes into a Run's modelSelection. */
  implementation: ActionRunModelRoute;
  sourceKinds: readonly MediaAnalysisSourceKind[];
}

export interface LocalMediaAnalysisConfig {
  videoEnabled: boolean;
  modelId: string | null;
  /** null means every category declared by the media-analysis Generator is available. */
  allowedCategories: string[] | null;
  video: MediaAnalysisVideoConfig;
}

export type MediaAnalysisResolution = "low" | "medium" | "high";

export interface MediaAnalysisBoundaryRefinementConfig {
  enabled: boolean;
  fps: number;
  /** Added on each side of the coarse sample interval when reviewing a candidate boundary. */
  safetyMarginSeconds: number;
}

export interface MediaAnalysisVideoConfig {
  fps: number;
  mediaResolution: MediaAnalysisResolution;
  boundaryRefinement: MediaAnalysisBoundaryRefinementConfig;
}

export interface LocalMediaAnalysisConfigStore {
  get(): Promise<LocalMediaAnalysisConfig>;
  update(input: Partial<LocalMediaAnalysisConfig>): Promise<LocalMediaAnalysisConfig>;
  modelOptions(sourceKind: MediaAnalysisSourceKind): Promise<MediaAnalysisModelOption[]>;
  assertRunnable(input: {
    sourceKind: MediaAnalysisSourceKind;
    modelId: string;
    category?: string;
  }): Promise<MediaAnalysisModelOption>;
}

export class MediaAnalysisConfigError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

interface StoredMediaAnalysisConfig {
  video_enabled?: boolean;
  model_id?: string | null;
  allowed_categories?: string[] | null;
  video?: {
    fps?: number;
    media_resolution?: MediaAnalysisResolution;
    boundary_refinement?: {
      enabled?: boolean;
      fps?: number;
      safety_margin_seconds?: number;
    };
  };
}

const DEFAULT_VIDEO_CONFIG: MediaAnalysisVideoConfig = {
  fps: 1,
  mediaResolution: "medium",
  boundaryRefinement: {
    enabled: false,
    fps: 24,
    safetyMarginSeconds: 0.5,
  },
};

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function mediaResolution(value: unknown): MediaAnalysisResolution {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : DEFAULT_VIDEO_CONFIG.mediaResolution;
}

function normalizedCategories(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map((category) => category.trim()).filter(Boolean))];
}

function validateVideoConfig(config: MediaAnalysisVideoConfig): void {
  if (!Number.isFinite(config.fps) || config.fps <= 0 || config.fps > 24) {
    throw new MediaAnalysisConfigError("Media analysis video fps must be between 0 and 24.");
  }
  if (
    !Number.isFinite(config.boundaryRefinement.fps) ||
    config.boundaryRefinement.fps <= 0 ||
    config.boundaryRefinement.fps > 60
  ) {
    throw new MediaAnalysisConfigError("Media analysis boundary refinement fps must be between 0 and 60.");
  }
  if (
    !Number.isFinite(config.boundaryRefinement.safetyMarginSeconds) ||
    config.boundaryRefinement.safetyMarginSeconds < 0 ||
    config.boundaryRefinement.safetyMarginSeconds > 10
  ) {
    throw new MediaAnalysisConfigError("Media analysis boundary safety margin must be between 0 and 10 seconds.");
  }
}

/**
 * One shared projection from a generic consumer catalog entry to the option
 * shown by Settings and frozen by the run resolver. The full Card keeps all
 * of its providerImplementations; `implementation` names only the currently
 * selected/available one.
 */
export function mediaAnalysisModelOptionFromCatalogEntry(
  entry: ModelCatalogEntry & { selectedRoute: NonNullable<ModelCatalogEntry["selectedRoute"]> },
  consumer: MediaAnalysisModelOption["consumer"],
  sourceKind: MediaAnalysisSourceKind,
  /**
   * The Kernel's own fresh resolution of `route.executorPluginId`/`executorExportId`, taken at
   * the same moment this route is proven executable. Freezing this exact version/schemaHash (and
   * the route's own declared `assetInputs`) into `implementation` is what lets a later durable
   * poll detect Provider-plugin drift instead of silently re-resolving a newer version.
   */
  executorBinding?: import("@clash/shared-types").ExecutablePluginBinding,
): MediaAnalysisModelOption {
  const route = entry.selectedRoute;
  return {
    id: entry.model.id,
    name: entry.model.name,
    provider: route.providerId ?? route.upstreamId,
    route: route.apiShape,
    consumer,
    visibility: entry.model.visibility?.scope ?? "public",
    underlyingModel: route.upstreamModel,
    implementation: {
      ...(route.providerId ? { providerId: route.providerId } : {}),
      ...(route.accountId ? { accountId: route.accountId } : {}),
      ...(route.region ? { region: route.region } : {}),
      upstreamId: route.upstreamId,
      upstreamModel: route.upstreamModel,
      apiShape: route.apiShape,
      ...(route.executorPluginId
        ? { executorPluginId: route.executorPluginId }
        : {}),
      ...(route.executorExportId
        ? { executorExportId: route.executorExportId }
        : {}),
      ...(executorBinding ? { executorBinding } : {}),
      ...(route.assetInputs?.length ? { assetInputs: route.assetInputs } : {}),
    },
    sourceKinds: [sourceKind],
  };
}

/**
 * Product Settings persistence only. Model discovery is injected once and is
 * deliberately shared by options, save validation, and Run validation.
 */
export function createLocalMediaAnalysisConfigStore(options: {
  dataDir: string;
  configStore?: ClashUserConfigStore;
  resolveOptions(sourceKind: MediaAnalysisSourceKind): Promise<MediaAnalysisModelOption[]>;
}): LocalMediaAnalysisConfigStore {
  const configStore = options.configStore ?? createClashUserConfigStore(options.dataDir);
  const read = async (): Promise<LocalMediaAnalysisConfig> => {
    const stored = await configStore.getSection<StoredMediaAnalysisConfig>("media_analysis");
    const storedVideo = stored?.video;
    const storedRefinement = storedVideo?.boundary_refinement;
    return {
      videoEnabled: stored?.video_enabled === true,
      modelId:
        typeof stored?.model_id === "string" && stored.model_id.trim()
          ? stored.model_id.trim()
          : null,
      allowedCategories: normalizedCategories(stored?.allowed_categories),
      video: {
        fps: positiveNumber(storedVideo?.fps, DEFAULT_VIDEO_CONFIG.fps),
        mediaResolution: mediaResolution(storedVideo?.media_resolution),
        boundaryRefinement: {
          enabled: storedRefinement?.enabled === true,
          fps: positiveNumber(storedRefinement?.fps, DEFAULT_VIDEO_CONFIG.boundaryRefinement.fps),
          safetyMarginSeconds:
            typeof storedRefinement?.safety_margin_seconds === "number" &&
            Number.isFinite(storedRefinement.safety_margin_seconds) &&
            storedRefinement.safety_margin_seconds >= 0
              ? storedRefinement.safety_margin_seconds
              : DEFAULT_VIDEO_CONFIG.boundaryRefinement.safetyMarginSeconds,
        },
      },
    };
  };
  return {
    get: read,
    modelOptions: options.resolveOptions,
    async update(input) {
      const current = await read();
      const next: LocalMediaAnalysisConfig = {
        videoEnabled: input.videoEnabled ?? current.videoEnabled,
        modelId: input.modelId === undefined ? current.modelId : input.modelId?.trim() || null,
        allowedCategories:
          input.allowedCategories === undefined
            ? current.allowedCategories
            : normalizedCategories(input.allowedCategories),
        video: input.video ?? current.video,
      };
      validateVideoConfig(next.video);
      if (next.modelId) {
        const candidates = new Set<string>();
        for (const kind of ["image", "video", "audio"] as const) {
          for (const option of await options.resolveOptions(kind)) candidates.add(option.id);
        }
        if (!candidates.has(next.modelId)) {
          throw new MediaAnalysisConfigError(
            `Media analysis model ${next.modelId} has no configured and executable Provider route.`,
          );
        }
      }
      await configStore.setSection("media_analysis", {
        video_enabled: next.videoEnabled,
        model_id: next.modelId,
        allowed_categories: next.allowedCategories,
        video: {
          fps: next.video.fps,
          media_resolution: next.video.mediaResolution,
          boundary_refinement: {
            enabled: next.video.boundaryRefinement.enabled,
            fps: next.video.boundaryRefinement.fps,
            safety_margin_seconds: next.video.boundaryRefinement.safetyMarginSeconds,
          },
        },
      });
      return next;
    },
    async assertRunnable(input) {
      const config = await read();
      if (input.sourceKind === "video" && !config.videoEnabled) {
        throw new MediaAnalysisConfigError("Media analysis video support is disabled.");
      }
      if (
        input.category &&
        config.allowedCategories !== null &&
        !config.allowedCategories.includes(input.category)
      ) {
        throw new MediaAnalysisConfigError(
          `Media analysis category ${input.category} is disabled in Settings.`,
        );
      }
      const selected = (await options.resolveOptions(input.sourceKind)).find(
        (option) => option.id === input.modelId,
      );
      if (!selected) {
        throw new MediaAnalysisConfigError(
          `Media analysis model ${input.modelId} has no configured and executable Provider route for ${input.sourceKind}.`,
        );
      }
      return selected;
    },
  };
}
