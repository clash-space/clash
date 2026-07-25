
/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { FilmSlate, ImageSquare, Trash } from '@phosphor-icons/react';
import { deleteProject } from '@clash/web-ui/lib/clientActions';
import { firstAssetMediaUrl } from '../features/assets/media-url';
import { useConfirm } from './ConfirmDialog';
import { IconButton } from './ui/icon-button';

interface Asset {
  id: string;
  url?: string | null;
  src?: string | null;
  signedUrl?: string | null;
  signedCoverUrl?: string | null;
  type?: 'image' | 'video' | string | null;
  kind?: 'image' | 'video' | string | null;
  storageKey?: string | null;
  srcR2Key?: string | null;
  coverR2Key?: string | null;
  createdAt?: Date | string | number | null;
}

export interface ProjectWithAssets {
  id: string;
  name: string;
  createdAt?: Date | string | number;
  updatedAt: Date | string | number | null;
  assets?: Asset[];
}

interface ProjectCardProps {
  project: ProjectWithAssets;
}

function assetPreviewUrl(asset: Asset) {
  const isVideo = asset.type === 'video' || asset.kind === 'video';
  const keyPreview = isVideo
    ? firstAssetMediaUrl(asset.coverR2Key, asset.storageKey, asset.srcR2Key)
    : firstAssetMediaUrl(asset.srcR2Key, asset.storageKey, asset.coverR2Key);

  return isVideo
    ? firstAssetMediaUrl(
      asset.signedCoverUrl,
      keyPreview,
      asset.url,
      asset.signedUrl,
      asset.src,
    )
    : firstAssetMediaUrl(
      asset.url,
      asset.signedUrl,
      asset.src,
      keyPreview,
    );
}

function isProjectPreviewAsset(asset: Asset) {
  return asset.type === 'image' || asset.type === 'video' ||
    asset.kind === 'image' || asset.kind === 'video';
}

function ProjectAssetPreview({ asset }: { asset: Asset }) {
  const [failed, setFailed] = useState(false);
  const src = assetPreviewUrl(asset);

  if (!src || failed) {
    const PlaceholderIcon = asset.type === 'video' || asset.kind === 'video'
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

  // Sort assets: Newest first
  const displayAssets = [...allAssets]
    .sort((a, b) => {
      // Sort by createdAt (descending)
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      return dateB - dateA;
    })
    .filter((asset) => isProjectPreviewAsset(asset) && assetPreviewUrl(asset))
    .slice(0, 4); // Take up to 4 assets

  const assetCount = displayAssets.length;

  // Determine grid columns based on count
  // 1 asset -> full width
  // 2 assets -> 2 columns, split vertically
  // 3 assets -> 2 up, 1 down (3rd item spans full width)
  // 4 assets -> 2x2 grid
  const gridClass = assetCount === 1 ? 'grid-cols-1' :
                   assetCount === 2 ? 'grid-cols-2' :
                   'grid-cols-2 grid-rows-2';

  return (
    <article className="group relative">
      <Link to={`/projects/${project.id}`} className="block">
        <motion.div
          className="clash-project-card-frame relative mb-4 aspect-video overflow-hidden rounded-2xl"
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
        >
          {/* Asset Grid Logic */}
          {assetCount === 0 ? (
            /* No Assets - Empty State */
            <div className="clash-project-card-empty" aria-hidden="true">
              <FilmSlate
                className="clash-project-card-empty-mark"
                weight="regular"
              />
            </div>
          ) : (
            /* Has Assets */
            <div className={`clash-project-card-preview-grid grid h-full w-full ${gridClass} gap-[2px]`}>
              {displayAssets.map((asset: Asset, index: number) => {
                // Special case for 3 items: the last item (index 2) spans 2 columns
                const isLastOfThree = assetCount === 3 && index === 2;
                return (
                  <div
                    key={asset.id}
                    className={`clash-project-card-preview-cell ${isLastOfThree ? 'col-span-2' : ''}`}
                  >
                    <ProjectAssetPreview asset={asset} />
                  </div>
                );
              })}
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
