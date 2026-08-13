import {
  Cube,
  FilmSlate,
  Image as ImageIcon,
  SpeakerHigh,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { AssetKind, ResolvedAsset } from "@clash/shared-types";
import { resolveAssetMediaUrl } from "./media-url";
import { VideoPoster } from "./VideoPoster";

export type AssetThumbnailVariant = "sidebar" | "card";

export interface AssetThumbnailProps {
  kind: AssetKind;
  src: string;
  /** Optional legacy/remote still projection; Local video falls back in-browser. */
  thumbnailSrc?: string | null;
  /** Browser fallback decoding is permitted only for a ready Host projection. */
  status?: ResolvedAsset["status"];
  label: string;
  active?: boolean;
  variant?: AssetThumbnailVariant;
  decorative?: boolean;
  mediaClassName?: string;
  fallbackClassName?: string;
  fallbackIconClassName?: string;
}

const mediaFrameClass: Record<AssetThumbnailVariant, string> = {
  sidebar: "h-5 w-5 shrink-0 rounded-[3px]",
  card: "h-full w-full rounded-lg",
};

/** Shared visual representation for assets in compact lists and media pickers. */
export function AssetThumbnail({
  kind,
  src,
  thumbnailSrc,
  status,
  label,
  active = false,
  variant = "sidebar",
  decorative = false,
  mediaClassName = "",
  fallbackClassName = "",
  fallbackIconClassName = "",
}: AssetThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const mediaUrl = resolveAssetMediaUrl(src) ?? "";
  const thumbnailUrl = resolveAssetMediaUrl(thumbnailSrc);

  useEffect(() => setFailed(false), [src, thumbnailSrc, kind]);

  const frameClass = `${mediaFrameClass[variant]} relative flex items-center justify-center overflow-hidden border border-warm-border/80 bg-warm-muted`;
  const fallbackLabel = decorative
    ? undefined
    : kind === "model"
      ? `${label} model thumbnail unavailable`
      : `${label} thumbnail unavailable`;

  if (kind === "audio") {
    return (
      <span
        className={
          variant === "sidebar"
            ? "flex h-5 w-5 shrink-0 items-center justify-center"
            : frameClass
        }
        aria-label={decorative ? undefined : `${label} audio`}
        aria-hidden={decorative || undefined}
      >
        <SpeakerHigh
          className={
            variant === "sidebar"
              ? `h-3 w-3 ${active ? "text-brand" : "text-stone-400"}`
              : "h-8 w-8 text-stone-400"
          }
          weight={active ? "fill" : "regular"}
        />
      </span>
    );
  }

  if (kind === "model" && (!thumbnailUrl || failed)) {
    return (
      <span
        className={`${frameClass} ${fallbackClassName}`}
        aria-label={fallbackLabel}
        aria-hidden={decorative || undefined}
      >
        <Cube
          className={`${variant === "sidebar" ? "h-3 w-3 text-stone-400" : "h-8 w-8 text-stone-400"} ${fallbackIconClassName}`}
        />
      </span>
    );
  }

  if (failed || (!mediaUrl && !thumbnailUrl)) {
    const FallbackIcon = kind === "video" ? FilmSlate : ImageIcon;
    return (
      <span
        className={`${frameClass} ${fallbackClassName}`}
        aria-label={fallbackLabel}
        aria-hidden={decorative || undefined}
      >
        <FallbackIcon
          className={`${variant === "sidebar" ? "h-3 w-3 text-stone-400" : "h-8 w-8 text-stone-400"} ${fallbackIconClassName}`}
        />
      </span>
    );
  }

  if (kind === "video") {
    return (
      <span className={`${frameClass} bg-stone-800`}>
        <VideoPoster
          thumbnailSrc={thumbnailUrl}
          videoSrc={mediaUrl}
          status={status}
          alt={`${label} thumbnail`}
          decorative={decorative}
          className={`h-full w-full object-cover ${mediaClassName}`}
          fallback={
            <span
              className={`absolute inset-0 flex items-center justify-center ${fallbackClassName}`}
              aria-label={fallbackLabel}
              aria-hidden={decorative || undefined}
            >
              <FilmSlate
                className={`${variant === "sidebar" ? "h-3 w-3 text-stone-400" : "h-8 w-8 text-stone-400"} ${fallbackIconClassName}`}
              />
            </span>
          }
        />
        <FilmSlate
          className={
            variant === "sidebar"
              ? "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-tl-sm bg-black/55 p-px text-white"
              : "absolute bottom-2 right-2 h-5 w-5 rounded bg-black/55 p-1 text-white"
          }
          weight="fill"
          aria-hidden="true"
        />
      </span>
    );
  }

  return (
    <span className={frameClass}>
      <img
        src={
          kind === "model" ? (thumbnailUrl ?? "") : (thumbnailUrl ?? mediaUrl)
        }
        alt={decorative ? "" : `${label} thumbnail`}
        className={`h-full w-full object-cover ${mediaClassName}`}
        draggable={false}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
