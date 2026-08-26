/* eslint-disable @next/next/no-img-element */

import { motion } from "framer-motion";
import type { PointerEventHandler } from "react";
import { Link } from "react-router";
import { Archive, Plus } from "@phosphor-icons/react";
import { useDraggable } from "@dnd-kit/core";
import type { ResolvedAsset } from "@clash/shared-types";
import { archiveProject } from "@clash/web-ui/lib/clientActions";
import { useConfirm } from "./ConfirmDialog";
import { IconButton } from "./ui/icon-button";
import { Card } from "./ui/card";
import { Tooltip } from "./ui/tooltip";
import { AssetThumbnail } from "../features/assets/AssetThumbnail";
import { assetPreviewMedia } from "../features/assets/media-url";
import { projectAssetDisplayName } from "../features/assets/projectAssetPresentation";
import type { DashboardProjectDragData } from "./dashboardComposerDnd";
import type { ProjectReference } from "./dashboardComposerReferences";

export interface ProjectWithAssets {
  id: string;
  name: string;
  coverAssetId?: string | null;
  createdAt?: Date | string | number;
  updatedAt: Date | string | number | null;
  assets?: ResolvedAsset[];
}

export interface ProjectCardProps {
  project: ProjectWithAssets;
  composerProjectReferenceId?: string | null;
  onAddProjectReference?: (project: ProjectReference) => void;
  onArchived?: (projectId: string) => void;
}

function isProjectPreviewAsset(asset: ResolvedAsset) {
  return (
    (asset.kind === "image" || asset.kind === "video") &&
    assetPreviewMedia(asset) !== null
  );
}

function ProjectAssetPreview({ asset }: { asset: ResolvedAsset }) {
  return (
    <AssetThumbnail
      kind={asset.kind}
      src={asset.url ?? ""}
      thumbnailSrc={asset.thumbnailUrl}
      status={asset.status}
      label={projectAssetDisplayName(asset)}
      variant="card"
      decorative
      mediaClassName="clash-project-card-preview-img"
      fallbackClassName="clash-project-card-asset-fallback"
      fallbackIconClassName="clash-project-card-asset-fallback-mark"
    />
  );
}

export default function ProjectCard({
  project,
  composerProjectReferenceId = null,
  onAddProjectReference,
  onArchived,
}: ProjectCardProps) {
  const confirm = useConfirm();
  const projectReference: ProjectReference = {
    id: project.id,
    name: project.name || "Untitled",
  };
  const hasProjectReference = composerProjectReferenceId !== null;
  const isCurrentProjectReference =
    composerProjectReferenceId === projectReference.id;
  const canAddProject = Boolean(onAddProjectReference) && !hasProjectReference;
  const canDragProject =
    Boolean(onAddProjectReference) &&
    (!hasProjectReference || isCurrentProjectReference);
  const { listeners, setActivatorNodeRef, setNodeRef, isDragging } =
    useDraggable({
      id: `dashboard-project:${projectReference.id}`,
      data: {
        type: "dashboard-project-reference",
        reference: projectReference,
      } satisfies DashboardProjectDragData,
      disabled: !canDragProject,
    });
  const handleProjectPointerDown:
    PointerEventHandler<HTMLDivElement> | undefined = canDragProject
    ? (event) => {
        listeners?.onPointerDown?.(event);
      }
    : undefined;

  // Format Date
  const date = new Date(project.updatedAt || project.createdAt || new Date());
  const formattedDate = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);

  const allAssets = project.assets || [];
  const coverAsset = project.coverAssetId
    ? allAssets.find(
        (asset) =>
          asset.id === project.coverAssetId &&
          isProjectPreviewAsset(asset) &&
          asset.lifecycle.state === "active",
      )
    : undefined;

  return (
    <article
      ref={setNodeRef}
      className="group relative"
      data-project-reference-dragging={isDragging || undefined}
    >
      <Link to={`/projects/${project.id}`} className="block">
        <Card
          asChild
          interaction="border"
          slot="project-card-preview"
          className="relative mb-3 aspect-video overflow-hidden"
        >
          <motion.div
            ref={setActivatorNodeRef}
            className="clash-project-card-frame"
            whileTap={{ scale: 0.98 }}
            onPointerDown={handleProjectPointerDown}
          >
            {coverAsset ? (
              <div className="clash-project-card-preview-grid grid h-full w-full grid-cols-1">
                <div className="clash-project-card-preview-cell">
                  <ProjectAssetPreview asset={coverAsset} />
                </div>
              </div>
            ) : (
              <div className="clash-project-card-empty" aria-hidden="true">
                <span
                  data-slot="project-empty-copy"
                  className="clash-project-card-empty-copy"
                >
                  Nothing to see. Yet.
                </span>
              </div>
            )}
          </motion.div>
        </Card>

        {/* Text Content Below Card */}
        <div className="px-1">
          <h3 className="truncate text-sm font-medium text-content-primary transition-colors group-hover:text-brand">
            {project.name || "Untitled"}
          </h3>
          <p className="mt-1 text-xs text-content-muted">{formattedDate}</p>
        </div>
      </Link>

      {onAddProjectReference ? (
        <div className="absolute left-3 top-3 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Tooltip
            label={
              canAddProject
                ? `Add ${projectReference.name} to composer`
                : isCurrentProjectReference
                  ? `${projectReference.name} is already in the composer`
                  : "Remove the current project reference first"
            }
          >
            <IconButton
              label={`Add project ${projectReference.name} to composer`}
              icon={<Plus className="h-4 w-4" weight="bold" />}
              size="sm"
              disabled={!canAddProject}
              className="text-content-secondary focus-visible:ring-offset-warm-page"
              onClick={() => onAddProjectReference(projectReference)}
            />
          </Tooltip>
        </div>
      ) : null}

      {/* Archive action (hover) */}
      <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 z-10">
        <IconButton
          label={`Archive project ${project.name || "Untitled"}`}
          icon={<Archive className="h-4 w-4" weight="bold" />}
          size="sm"
          className="text-content-secondary focus-visible:ring-offset-warm-page"
          onClick={async () => {
            const ok = await confirm({
              title: "Archive project?",
              message: `${project.name || "Untitled"} will be hidden from the project browser. You can restore it from Settings → Archive.`,
              confirmText: "Archive",
            });

            if (ok) {
              await archiveProject(project.id);
              onArchived?.(project.id);
            }
          }}
        />
      </div>
    </article>
  );
}
