import { useLoaderData } from "react-router";
import MarketplaceClient from "@clash/web-ui/components/MarketplaceClient";
import { loadMarketplaceData } from "../lib/marketplaceData";

export async function loader() {
  return loadMarketplaceData();
}

export default function MarketplaceManageRoute() {
  const { items, installedActionIds, installedSkillIds } =
    useLoaderData<typeof loader>();
  return (
    <MarketplaceClient
      items={items}
      installedActionIds={installedActionIds}
      installedSkillIds={installedSkillIds}
      mode="manage"
    />
  );
}
