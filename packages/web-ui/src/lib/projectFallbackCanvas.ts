import type { Edge, Node } from "@xyflow/react";
import type { ProjectAsset } from "./types";

type FallbackAsset = ProjectAsset & {
  assetId?: string;
};

const NODE_WIDTH = 480;
const NODE_HEIGHT = 270;
const COLUMN_GAP = 80;
const ROW_GAP = 80;
const COLUMNS = 2;

export function buildFallbackCanvasFromAssets(
  assets: readonly FallbackAsset[] | undefined,
): { nodes: Node[]; edges: Edge[] } {
  const mediaAssets = (assets ?? []).filter(
    (asset) => asset.type === "image" || asset.type === "video" || asset.type === "audio",
  );

  return {
    nodes: mediaAssets.map((asset, index) => {
      const assetId = asset.assetId ?? asset.id;
      return {
        id: `asset-ref-${assetId}`,
        type: asset.type,
        position: {
          x: (index % COLUMNS) * (NODE_WIDTH + COLUMN_GAP),
          y: Math.floor(index / COLUMNS) * (NODE_HEIGHT + ROW_GAP),
        },
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        style: {
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        },
        data: {
          label: asset.type === "video"
            ? "Recovered Video"
            : asset.type === "audio"
              ? "Recovered Audio"
              : "Recovered Image",
          assetId,
          src: asset.storageKey,
          status: "completed",
          createdAt: asset.createdAt,
          recoveredFromAssetRef: true,
        },
      };
    }),
    edges: [],
  };
}
