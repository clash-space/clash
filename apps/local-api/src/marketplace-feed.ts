export type MarketplaceFeedItem = Record<string, unknown> & { id: string };

export const FEATURED_MARKETPLACE_PLUGIN_IDS = [
  "clash.storyboard",
  "clash.codex-imagegen",
  "clash.video.sd25-pe",
] as const;

export function selectMarketplaceFeed({
  plugins,
  skills = [],
  featuredPluginIds = FEATURED_MARKETPLACE_PLUGIN_IDS,
}: {
  actions?: readonly MarketplaceFeedItem[];
  plugins: readonly MarketplaceFeedItem[];
  skills?: readonly MarketplaceFeedItem[];
  featuredPluginIds?: readonly string[];
}): MarketplaceFeedItem[] {
  const catalog = new Map(
    [...plugins, ...skills].map((plugin) => [plugin.id, plugin]),
  );

  return featuredPluginIds.flatMap((pluginId) => {
    const plugin = catalog.get(pluginId);
    return plugin ? [plugin] : [];
  });
}
