import { useLoaderData } from "react-router";
import MarketplaceClient from "@clash/web-ui/components/MarketplaceClient";
import type { RegistryItem } from "@clash/web-ui/lib/clientActions";
import { runtimeApiUrl } from "@clash/web-ui/lib/runtimeConfig";

interface RegistryData {
  version: number;
  actions: RegistryItem[];
  skills: RegistryItem[];
  plugins: RegistryItem[];
}

const emptyRegistry: RegistryData = {
  version: 1,
  actions: [],
  skills: [],
  plugins: [],
};

async function fetchRegistry() {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(runtimeApiUrl("/api/marketplace/registry"), {
      signal: controller.signal,
    });
    return response.ok ? (response.json() as Promise<RegistryData>) : emptyRegistry;
  } catch {
    return emptyRegistry;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function loader() {
  const registryRes = await fetchRegistry();

  const items = [...registryRes.actions, ...(registryRes.plugins ?? [])];
  return {
    items,
    installedActionIds: [],
    installedSkillIds: [],
    installedPluginIds: [],
  };
}

export default function MarketplaceRoute() {
  const { items, installedActionIds, installedSkillIds, installedPluginIds } =
    useLoaderData<typeof loader>();
  return (
    <MarketplaceClient
      items={items}
      installedActionIds={installedActionIds}
      installedSkillIds={installedSkillIds}
      installedPluginIds={installedPluginIds}
      catalogScope="plugins-and-actions"
      mode="public"
    />
  );
}
