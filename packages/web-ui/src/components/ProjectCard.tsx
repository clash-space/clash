
/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { FilmSlate, ImageSquare, Trash } from '@phosphor-icons/react';
import type { ResolvedAsset } from '@clash/shared-types';
import { deleteProject } from '@clash/web-ui/lib/clientActions';
import { useConfirm } from './ConfirmDialog';
import { IconButton } from './ui/icon-button';

export interface ProjectWithAssets {
  id: string;
  name: string;
  coverAssetId?: string | null;
  createdAt?: Date | string | number;
  updatedAt: Date | string | number | null;
  assets?: ResolvedAsset[];
}

interface ProjectCardProps {
  project: ProjectWithAssets;
}

function assetPreviewUrl(asset: ResolvedAsset): string | undefined {
  return asset.thumbnailUrl ?? (asset.kind === 'image' ? asset.url : undefined);
}

function isProjectPreviewAsset(asset: ResolvedAsset) {
  return asset.kind === 'image' || asset.kind === 'video';
}

function ProjectAssetPreview({ asset }: { asset: ResolvedAsset }) {
  const [failed, setFailed] = useState(false);
  const src = assetPreviewUrl(asset);

  if (!src || failed) {
    const PlaceholderIcon = asset.kind === 'video'
      ? FilmSlate
      : ImageSquare;
    return (
      <div className="clash-project-card-asset-fallback" aria-hidden="true">
        <PlaceholderIcon
          className="clash-project-card-asset-fallback-mark"
          weight="regular"
        />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className="clash-project-card-preview-img h-full w-full object-cover"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export default function ProjectCard({ project }: ProjectCardProps) {
  const confirm = useConfirm();

  // Format Date
  const date = new Date(project.updatedAt || project.createdAt || new Date());
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);

  const allAssets = project.assets || [];
  const coverAsset = project.coverAssetId
    ? allAssets.find(
        (asset) =>
          asset.id === project.coverAssetId &&
          isProjectPreviewAsset(asset) &&
          Boolean(assetPreviewUrl(asset)),
      )
    : undefined;

  return (
    <article className="group relative">
      <Link to={`/projects/${project.id}`} className="block">
        <motion.div
          className="clash-project-card-frame relative mb-4 aspect-video overflow-hidden rounded-2xl"
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
        >
          {coverAsset ? (
            <div className="clash-project-card-preview-grid grid h-full w-full grid-cols-1">
              <div className="clash-project-card-preview-cell">
                <ProjectAssetPreview asset={coverAsset} />
              </div>
            </div>
          ) : (
            /* No Assets - Empty State */
            <div className="clash-project-card-empty" aria-hidden="true">
              <FilmSlate
                className="clash-project-card-empty-mark"
                weight="regular"
              />
            </div>
          )}
        </motion.div>

        {/* Text Content Below Card */}
        <div className="px-1">
          <h3 className="text-base font-semibold text-slate-950 group-hover:text-brand transition-colors truncate dark:text-slate-50">
            {project.name || 'Untitled'}
          </h3>
          <p className="mt-1 text-xs text-stone-700 dark:text-stone-400">
            {formattedDate}
          </p>
        </div>
      </Link>

      {/* Delete Button (Hover) */}
      <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 z-10">
        <IconButton
          label={`Delete project ${project.name || 'Untitled'}`}
          icon={<Trash className="h-4 w-4" weight="bold" />}
          variant="destructive"
          size="md"
          className="clash-project-card-delete backdrop-blur-sm focus-visible:ring-offset-warm-page"
          onClick={async () => {
            const ok = await confirm({
              title: 'Delete project?',
              message: `${project.name || 'Untitled'} will be removed from this workspace. Its canvas preview and generated assets will no longer show here.`,
              confirmText: 'Delete',
              destructive: true,
            });

            if (ok) {
              await deleteProject(project.id);
            }
          }}
        />
      </div>
    </article>
  );
}
