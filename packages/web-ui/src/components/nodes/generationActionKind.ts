import {
  ACTION_TYPE,
  AIGC_ACTION_KINDS,
  type AigcActionKind,
  type BuildPendingAssetNodeInput,
} from "@clash/shared-types";

export type BuiltInGenerationActionType = Exclude<
  BuildPendingAssetNodeInput["actionType"],
  `custom:${string}`
>;

/**
 * The web action-badge spelling for each shared AIGC output kind.
 * Keeping this as an exhaustive Record means adding a sixth shared kind
 * makes every web caller update one mapping instead of silently falling
 * through to image generation.
 */
export const GENERATION_ACTION_TYPE_BY_KIND = {
  image: ACTION_TYPE.ImageGen,
  video: ACTION_TYPE.VideoGen,
  audio: ACTION_TYPE.AudioGen,
  text: ACTION_TYPE.TextGen,
  model: ACTION_TYPE.ModelGen,
} as const satisfies Record<AigcActionKind, BuiltInGenerationActionType>;

/** Resolve persisted/legacy actionType strings without weakening the domain type. */
export function resolveBuiltInActionKind(actionType: string): AigcActionKind {
  for (const kind of AIGC_ACTION_KINDS) {
    if (GENERATION_ACTION_TYPE_BY_KIND[kind] === actionType) return kind;
  }
  return "image";
}

export function resolveGenerationActionType(
  actionType: string,
  customActionId?: string,
): BuildPendingAssetNodeInput["actionType"] {
  if (customActionId) return `custom:${customActionId}`;
  return GENERATION_ACTION_TYPE_BY_KIND[resolveBuiltInActionKind(actionType)];
}
