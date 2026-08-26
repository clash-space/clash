import type { ImgHTMLAttributes } from "react";

export const CLASH_BRAND_ASSETS = {
  mark: { role: "identity", src: "/brand/logo-mark.svg" },
  markDark: { role: "identity", src: "/brand/logo-mark-dark.svg" },
  markAnimated: { role: "identity", src: "/brand/logo-mark-animated.svg" },
  assets: { role: "feature", src: "/brand/avatar-assets.png" },
  plugins: { role: "feature", src: "/brand/avatar-plugins.png" },
  emptySearch: { role: "state", src: "/brand/avatar-empty-search.png" },
  error: { role: "state", src: "/brand/avatar-error.png" },
} as const;

export type BrandAssetName = keyof typeof CLASH_BRAND_ASSETS;
export type BrandAssetRole =
  (typeof CLASH_BRAND_ASSETS)[BrandAssetName]["role"];

export function BrandAsset({
  alt,
  draggable,
  name,
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  alt: string;
  name: BrandAssetName;
}) {
  const asset = CLASH_BRAND_ASSETS[name];

  return (
    <img
      {...props}
      data-ui="brand-asset"
      data-asset-name={name}
      data-asset-role={asset.role}
      src={asset.src}
      alt={alt}
      aria-hidden={props["aria-hidden"] ?? (alt === "" ? true : undefined)}
      draggable={draggable ?? false}
    />
  );
}
