/**
 * Runtime-independent shapes shared across the UI package.
 *
 * Originally derived from drizzle-orm's `InferSelectModel`; mirrored here
 * so components don't need to depend on server-only schema files.
 */

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ProjectAsset {
  id: string;
  url: string;
  type: "image" | "video";
  storageKey: string | null;
  createdAt: Date | null;
}

export interface ProjectWithAssets extends Project {
  assets: ProjectAsset[];
}
