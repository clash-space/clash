import React, { useState } from "react";
import type { ImageItem } from "@clash/remotion-core";
import { resolveProjectedMediaUrl } from "@clash/remotion-components";
import type { ItemRenderProps } from "../registry";
import { colors } from "../../styles";

export const ImageRenderer: React.FC<ItemRenderProps> = ({
  item,
  asset,
  width,
  height,
}) => {
  const image = item as ImageItem;
  // Support reference-based model: use asset.thumbnail/src as primary source
  // Fallback to image.src for legacy items with direct src
  const src = asset?.thumbnail || asset?.src || image.src;
  const [imageError, setImageError] = useState(false);

  const resolvedSrc = React.useMemo(() => resolveProjectedMediaUrl(src), [src]);

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        background: colors.bg.primary,
        overflow: "hidden",
      }}
    >
      {resolvedSrc && !imageError ? (
        <>
          <div
            data-image-thumbnail-renderer="intrinsic-ratio-tiles"
            style={{
              backgroundImage: `url(${resolvedSrc})`,
              backgroundPosition: "left center",
              backgroundRepeat: "repeat-x",
              backgroundSize: "auto 100%",
              inset: 0,
              position: "absolute",
            }}
          />
          <img
            src={resolvedSrc}
            alt=""
            aria-hidden="true"
            style={{ display: "none" }}
            onError={() => {
              console.error(`[ImageRenderer] Load failed src="${resolvedSrc}"`);
              setImageError(true);
            }}
          />
        </>
      ) : imageError ? (
        <div
          style={{
            width,
            height,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#ff6b6b",
            fontSize: 11,
            gap: 4,
          }}
        >
          <div>⚠️</div>
          <div>Load Failed</div>
        </div>
      ) : (
        <div
          style={{
            width,
            height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#bbb",
            fontSize: 12,
          }}
        >
          Image
        </div>
      )}
    </div>
  );
};
