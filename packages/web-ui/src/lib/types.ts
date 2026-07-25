/**
 * Runtime-independent shapes shared across the UI package.
 *
 * Originally derived from drizzle-orm's `InferSelectModel`; mirrored here
 * so components don't need to depend on server-only schema files.
 */

export interface ProjectAsset {
  id: string;
  assetId?: string;
  name?: string;
  url: string;
  thumbnailUrl?: string;
  type: "image" | "video" | "audio";
  storageKey: string | null;
  createdAt: Date | string | number | null;
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  createdAt: Date | string | number | null;
  updatedAt: Date | string | number | null;
  assets?: ProjectAsset[];
  assetCount?: number;
}

export interface ProjectWithAssets extends Project {
  assets: ProjectAsset[];
}
