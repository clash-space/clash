
/* eslint-disable @next/next/no-img-element */

import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { Trash } from '@phosphor-icons/react';
import { deleteProject } from '@clash/web-ui/lib/clientActions';

interface Asset {
  id: string;
  url: string;
  type: 'image' | 'video';
  storageKey?: string;
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

export default function ProjectCard({ project }: ProjectCardProps) {
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
      // @ts-ignore
      const dateA = new Date(a.createdAt || 0).getTime();
      // @ts-ignore
      const dateB = new Date(b.createdAt || 0).getTime();
      return dateB - dateA;
    })
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
    <Link to={`/projects/${project.id}`} className="block group">
      <motion.div
        className="relative aspect-video overflow-hidden rounded-[1.5rem] bg-warm-muted mb-4 transition-all hover:shadow-lg ring-1 ring-black/5"
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.98 }}
      >
        {/* Asset Grid Logic */}
        {assetCount === 0 ? (
          /* No Assets - Empty State */
          <div className="absolute inset-0 flex items-center justify-center bg-warm-muted text-stone-300">
             {/* Empty state placeholder */}
          </div>
        ) : (
          /* Has Assets */
          <div className={`grid h-full w-full ${gridClass} gap-[2px] bg-warm-border`}>
            {displayAssets.map((asset: Asset, index: number) => {
              // Special case for 3 items: the last item (index 2) spans 2 columns
              const isLastOfThree = assetCount === 3 && index === 2;
              return (
                <div
                  key={asset.id}
                  className={`relative overflow-hidden bg-warm-muted ${isLastOfThree ? 'col-span-2' : ''}`}
                >
                  <img
                    src={asset.url}
                    alt="Asset"
                    className="h-full w-full object-cover"
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Delete Button (Hover) */}
        <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 z-10">
            <button
                type="button"
                onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (confirm('Are you sure you want to delete this project?')) {
                        await deleteProject(project.id);
                    }
                }}
                aria-label={`Delete project ${project.name || 'Untitled'}`}
                className="rounded-full bg-warm-surface/90 p-2 min-h-[36px] min-w-[36px] text-slate-600 shadow-sm backdrop-blur-sm transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-950/40 dark:hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page"
            >
                <Trash className="h-4 w-4" weight="bold" aria-hidden="true" />
            </button>
        </div>
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
  );
}
