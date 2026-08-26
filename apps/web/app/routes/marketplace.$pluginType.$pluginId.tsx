import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import MarketplacePluginDetail from "@clash/web-ui/components/MarketplacePluginDetail";

import { loadMarketplaceData } from "../lib/marketplaceData";

export async function loader({ params }: LoaderFunctionArgs) {
  const pluginType = params.pluginType;
  const pluginId = params.pluginId;
  if ((pluginType !== "action" && pluginType !== "skill") || !pluginId) {
    throw new Response("Plugin not found", { status: 404 });
  }

  const marketplace = await loadMarketplaceData();
  const item = marketplace.items.find(
    (candidate) => candidate.type === pluginType && candidate.id === pluginId,
  );
  if (!item) throw new Response("Plugin not found", { status: 404 });

  return {
    item,
    installed:
      item.type === "action"
        ? marketplace.installedActionIds.includes(item.id)
        : marketplace.installedSkillIds.includes(item.id),
  };
}

export default function MarketplacePluginDetailRoute() {
  const data = useLoaderData<typeof loader>();
  return <MarketplacePluginDetail {...data} />;
}
