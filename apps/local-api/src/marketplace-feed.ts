export type MarketplaceFeedItem = Record<string, unknown> & { id: string };

export const FEATURED_MARKETPLACE_PLUGIN_IDS = [
  "codex-imagegen",
  "clash.video.sd25-pe",
  "clash.openai.define-goal",
  "clash.openai.cli-creator",
] as const;

export function selectMarketplaceFeed({
  actions,
  skills,
  featuredPluginIds = FEATURED_MARKETPLACE_PLUGIN_IDS,
}: {
  actions: readonly MarketplaceFeedItem[];
  skills: readonly MarketplaceFeedItem[];
  featuredPluginIds?: readonly string[];
}): MarketplaceFeedItem[] {
  const catalog = new Map(
    [...actions, ...skills].map((plugin) => [plugin.id, plugin]),
  );

  return featuredPluginIds.flatMap((pluginId) => {
    const plugin = catalog.get(pluginId);
    return plugin ? [plugin] : [];
  });
}
