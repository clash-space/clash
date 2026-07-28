import {
  Cube,
  FilmSlate,
  HashStraight,
  Images,
  type IconProps,
} from "@phosphor-icons/react";

export type ProjectSurfaceIconKind =
  | "canvas"
  | "timeline"
  | "director-stage"
  | "asset";

export interface ProjectSurfaceIconProps extends IconProps {
  surface: ProjectSurfaceIconKind;
}

/**
 * Canonical project-surface iconography.
 *
 * Keep every Canvas affordance on HashStraight so navigation, annotations,
 * Timeline parent links, and Clash MCP results all speak the same language.
 */
export function ProjectSurfaceIcon({
  surface,
  ...props
}: ProjectSurfaceIconProps) {
  const Icon =
    surface === "canvas"
      ? HashStraight
      : surface === "timeline"
        ? FilmSlate
        : surface === "director-stage"
          ? Cube
          : Images;

  return <Icon data-project-surface-icon={surface} {...props} />;
}

export function CanvasIcon(props: IconProps) {
  return <ProjectSurfaceIcon surface="canvas" {...props} />;
}
