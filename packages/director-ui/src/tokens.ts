export const directorTokens = {
  viewport: "var(--clash-director-viewport)",
  gridMajor: "var(--clash-director-grid-major)",
  gridMinor: "var(--clash-director-grid-minor)",
  selection: "var(--clash-director-selection)",
  mannequin: "var(--clash-director-mannequin)",
  skeleton: "var(--clash-director-skeleton)",
  camera: "var(--clash-director-camera)",
  axisX: "var(--clash-director-axis-x)",
  axisY: "var(--clash-director-axis-y)",
  axisZ: "var(--clash-director-axis-z)",
  axisLabel: "var(--clash-director-axis-label)",
  timelineSurface: "var(--clash-director-timeline-surface)",
  timelineDivider: "var(--clash-director-timeline-divider)",
  timelineMuted: "var(--clash-director-timeline-muted)",
  timelineLabel: "var(--clash-director-timeline-label)",
  timelineKeyframe: "var(--clash-director-timeline-keyframe)",
} as const;

export interface DirectorRenderPalette {
  selection: string;
  mannequin: string;
  skeleton: string;
  gridMajor: string;
  gridMinor: string;
  camera: string;
  axisX: string;
  axisY: string;
  axisZ: string;
  axisLabel: string;
}

export const directorRenderPaletteFallback: DirectorRenderPalette = {
  selection: "#ff6b50",
  mannequin: "#e8ebef",
  skeleton: "#54d7ea",
  gridMajor: "#3d7697",
  gridMinor: "#254c67",
  camera: "#f5a623",
  axisX: "#ef4444",
  axisY: "#22c55e",
  axisZ: "#3b82f6",
  axisLabel: "#ffffff",
};

function tokenName(value: string): string | undefined {
  return /^var\((--[^)]+)\)$/.exec(value)?.[1];
}

export function resolveDirectorRenderPalette(
  element?: Element | null,
): DirectorRenderPalette {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return directorRenderPaletteFallback;
  }
  const target = element ?? document.documentElement;
  const style = window.getComputedStyle(target);
  const resolve = (value: string, fallback: string) => {
    const name = tokenName(value);
    return (name ? style.getPropertyValue(name).trim() : value) || fallback;
  };
  return {
    selection: resolve(directorTokens.selection, directorRenderPaletteFallback.selection),
    mannequin: resolve(directorTokens.mannequin, directorRenderPaletteFallback.mannequin),
    skeleton: resolve(directorTokens.skeleton, directorRenderPaletteFallback.skeleton),
    gridMajor: resolve(directorTokens.gridMajor, directorRenderPaletteFallback.gridMajor),
    gridMinor: resolve(directorTokens.gridMinor, directorRenderPaletteFallback.gridMinor),
    camera: resolve(directorTokens.camera, directorRenderPaletteFallback.camera),
    axisX: resolve(directorTokens.axisX, directorRenderPaletteFallback.axisX),
    axisY: resolve(directorTokens.axisY, directorRenderPaletteFallback.axisY),
    axisZ: resolve(directorTokens.axisZ, directorRenderPaletteFallback.axisZ),
    axisLabel: resolve(directorTokens.axisLabel, directorRenderPaletteFallback.axisLabel),
  };
}
