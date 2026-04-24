export interface RenderTimelineLike {
  compositionWidth?: number;
  compositionHeight?: number;
  fps?: number;
  durationInFrames?: number;
}

type HeaderReader = Pick<Headers, "get">;

function readPositiveInt(headers: HeaderReader, name: string): number | undefined {
  const raw = headers.get(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

export function getRenderMetadataFromHeaders(
  headers: HeaderReader,
  timelineDsl?: RenderTimelineLike | null,
): { width?: number; height?: number; durationMs?: number } {
  const fps =
    typeof timelineDsl?.fps === "number" && timelineDsl.fps > 0
      ? timelineDsl.fps
      : undefined;
  const durationInFrames =
    typeof timelineDsl?.durationInFrames === "number" && timelineDsl.durationInFrames > 0
      ? timelineDsl.durationInFrames
      : undefined;

  return {
    width:
      readPositiveInt(headers, "X-Render-Width") ??
      (typeof timelineDsl?.compositionWidth === "number" && timelineDsl.compositionWidth > 0
        ? timelineDsl.compositionWidth
        : undefined),
    height:
      readPositiveInt(headers, "X-Render-Height") ??
      (typeof timelineDsl?.compositionHeight === "number" && timelineDsl.compositionHeight > 0
        ? timelineDsl.compositionHeight
        : undefined),
    durationMs:
      readPositiveInt(headers, "X-Render-Duration-Ms") ??
      (fps && durationInFrames ? Math.round((durationInFrames * 1000) / fps) : undefined),
  };
}
