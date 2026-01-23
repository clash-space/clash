import React, { useState } from 'react';
import type { ImageItem } from '@master-clash/remotion-core';
import type { ItemRenderProps } from '../registry';
import { colors } from '../../styles';

export const ImageRenderer: React.FC<ItemRenderProps> = ({ item, asset, width, height }) => {
  const image = item as ImageItem;
  // Support reference-based model: use asset.thumbnail/src as primary source
  // Fallback to image.src for legacy items with direct src
  const src = asset?.thumbnail || asset?.src || image.src;
  const [imageError, setImageError] = useState(false);

  // Resolve asset URL if needed (convert R2 keys to API URLs)
  const resolvedSrc = React.useMemo(() => {
    if (!src) return '';

    // If it's an R2 key (starts with 'projects/'), convert to API URL
    if (src.startsWith('projects/') || src.startsWith('/projects/')) {
      const cleanKey = src.startsWith('/') ? src.slice(1) : src;
      return `/api/assets/view/${cleanKey}`;
    }

    // Otherwise return as-is (blob:, http:, data:, etc.)
    return src;
  }, [src]);

  return (
    <div style={{ position: 'relative', width, height, background: colors.bg.primary, overflow: 'hidden' }}>
      {resolvedSrc && !imageError ? (
        <img
          src={resolvedSrc}
          alt="thumb"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={() => {
            console.error(`[ImageRenderer] Load failed src="${resolvedSrc}"`);
            setImageError(true);
          }}
        />
      ) : imageError ? (
        <div style={{
          width,
          height,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ff6b6b',
          fontSize: 11,
          gap: 4
        }}>
          <div>⚠️</div>
          <div>Load Failed</div>
        </div>
      ) : (
        <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 12 }}>Image</div>
      )}
    </div>
  );
};

