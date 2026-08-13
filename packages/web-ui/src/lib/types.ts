import type { ResolvedAsset } from '@clash/shared-types';

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  coverAssetId?: string | null;
  createdAt: Date | string | number | null;
  updatedAt: Date | string | number | null;
  assets?: ResolvedAsset[];
  assetCount?: number;
}

export interface ProjectWithAssets extends Project {
  assets: ResolvedAsset[];
}
