import React from 'react';
import type { StickerItem } from '@clash/remotion-core';
import type { ItemRenderProps } from '../registry';

export const StickerRenderer: React.FC<ItemRenderProps> = ({ item, width, height }) => {
  const sticker = item as StickerItem;
  return (
    <div
      style={{ width, height }}
      className="flex items-center overflow-hidden rounded-md bg-[linear-gradient(135deg,rgba(255,107,80,.08),rgba(79,110,169,.08))] px-2"
    >
      <img
        src={sticker.src}
        alt="Sticker"
        draggable={false}
        className="h-full max-w-[42%] shrink-0 object-contain py-1"
      />
      <span className="ml-2 truncate text-[10px] font-semibold text-slate-700">Sticker</span>
    </div>
  );
};
