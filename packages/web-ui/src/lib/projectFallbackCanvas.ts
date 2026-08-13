import type { Edge, Node } from "@xyflow/react";
import type { ResolvedAsset } from "@clash/shared-types";

const NODE_WIDTH = 480;
const NODE_HEIGHT = 270;
const COLUMN_GAP = 80;
const ROW_GAP = 80;
const COLUMNS = 2;

export function buildFallbackCanvasFromAssets(
  assets: readonly ResolvedAsset[] | undefined,
): { nodes: Node[]; edges: Edge[] } {
  const mediaAssets = (assets ?? []).filter(
    (asset) =>
      asset.status === "ready" &&
      Boolean(asset.url) &&
      (asset.kind === "image" ||
        asset.kind === "video" ||
        asset.kind === "audio"),
  );

  return {
    nodes: mediaAssets.map((asset, index) => {
      const assetId = asset.id;
      return {
        id: `asset-ref-${assetId}`,
        type: asset.kind,
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
          label:
            asset.kind === "video"
              ? "Recovered Video"
              : asset.kind === "audio"
                ? "Recovered Audio"
                : "Recovered Image",
          assetId,
          status: "completed",
          recoveredFromAssetRef: true,
        },
      };
    }),
    edges: [],
  };
}
