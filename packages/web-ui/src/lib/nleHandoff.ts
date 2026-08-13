import type { Asset, Item, Track } from "@clash/remotion-core";

const nleMediaItemTypes = new Set<Item["type"]>([
  "video",
  "audio",
  "image",
  "sticker",
]);

export function hydrateTimelineTracksForNle(
  tracks: Track[],
  assets: Asset[],
): Track[] {
  return tracks.map((track) => ({
    ...track,
    items: track.items.map((item) => {
      if (!nleMediaItemTypes.has(item.type)) return item;
      const asset = assets.find(
        (candidate) =>
          Boolean(
            item.sourceNodeId && candidate.sourceNodeId === item.sourceNodeId,
          ) ||
          candidate.id === item.sourceNodeId ||
          Boolean(item.assetId && candidate.projectAssetId === item.assetId) ||
          candidate.id === item.assetId,
      );
      return asset?.src ? ({ ...item, src: asset.src } as Item) : item;
    }),
  }));
}
