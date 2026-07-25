import { FilmSlate, Image as ImageIcon, SpeakerHigh } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { ProjectAsset } from '../../lib/types';
import { resolveAssetMediaUrl } from './media-url';

export type AssetThumbnailVariant = 'sidebar' | 'card';

export interface AssetThumbnailProps {
  type: ProjectAsset['type'];
  src: string;
  label: string;
  active?: boolean;
  variant?: AssetThumbnailVariant;
  decorative?: boolean;
}

const mediaFrameClass: Record<AssetThumbnailVariant, string> = {
  sidebar: 'h-5 w-5 shrink-0 rounded-[3px]',
  card: 'h-full w-full rounded-lg',
};

/** Shared visual representation for assets in compact lists and media pickers. */
export function AssetThumbnail({
  type,
  src,
  label,
  active = false,
  variant = 'sidebar',
  decorative = false,
}: AssetThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const mediaUrl = resolveAssetMediaUrl(src) ?? '';

  useEffect(() => setFailed(false), [src, type]);

  const frameClass = `${mediaFrameClass[variant]} relative flex items-center justify-center overflow-hidden border border-warm-border/80 bg-warm-muted`;
  const fallbackLabel = decorative ? undefined : `${label} thumbnail unavailable`;

  if (type === 'audio') {
    return (
      <span
        className={variant === 'sidebar' ? 'flex h-5 w-5 shrink-0 items-center justify-center' : frameClass}
        aria-label={decorative ? undefined : `${label} audio`}
        aria-hidden={decorative || undefined}
      >
        <SpeakerHigh
          className={variant === 'sidebar'
            ? `h-3 w-3 ${active ? 'text-brand' : 'text-stone-400'}`
            : 'h-8 w-8 text-stone-400'}
          weight={active ? 'fill' : 'regular'}
        />
      </span>
    );
  }

  if (failed) {
    const FallbackIcon = type === 'video' ? FilmSlate : ImageIcon;
    return (
      <span className={frameClass} aria-label={fallbackLabel} aria-hidden={decorative || undefined}>
        <FallbackIcon className={variant === 'sidebar' ? 'h-3 w-3 text-stone-400' : 'h-8 w-8 text-stone-400'} />
      </span>
    );
  }

  if (type === 'video') {
    return (
      <span className={`${frameClass} bg-stone-800`}>
        <video
          src={mediaUrl}
          aria-label={decorative ? undefined : `${label} thumbnail`}
          aria-hidden={decorative || undefined}
          className="h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
        <FilmSlate
          className={variant === 'sidebar'
            ? 'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-tl-sm bg-black/55 p-px text-white'
            : 'absolute bottom-2 right-2 h-5 w-5 rounded bg-black/55 p-1 text-white'}
          weight="fill"
          aria-hidden="true"
        />
      </span>
    );
  }

  return (
    <span className={frameClass}>
      <img
        src={mediaUrl}
        alt={decorative ? '' : `${label} thumbnail`}
        className="h-full w-full object-cover"
        draggable={false}
        onError={() => setFailed(true)}
      />
    </span>
  );
}

