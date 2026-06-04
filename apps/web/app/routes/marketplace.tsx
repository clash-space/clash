import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import MarketplaceClient from "@clash/web-ui/components/MarketplaceClient";
import type { RegistryItem } from "@clash/web-ui/lib/clientActions";
import { runtimeApiUrl } from "@clash/web-ui/lib/runtimeConfig";

interface RegistryData {
  version: number;
  actions: RegistryItem[];
  skills: RegistryItem[];
}

export async function loader(_: LoaderFunctionArgs) {
  const guard = await fetch(runtimeApiUrl("/api/settings/actions"), { credentials: "include" });
  if (guard.status === 401) throw redirect("/login");

  const [registryRes, actions, skills] = await Promise.all([
    fetch(runtimeApiUrl("/api/marketplace/registry")).then((r) =>
      r.ok
        ? (r.json() as Promise<RegistryData>)
        : ({ version: 1, actions: [], skills: [] } as RegistryData),
    ),
    fetch(runtimeApiUrl("/api/settings/actions"), { credentials: "include" }).then((r) =>
      r.ok ? (r.json() as Promise<any[]>) : [],
    ),
    fetch(runtimeApiUrl("/api/settings/skills"), { credentials: "include" }).then((r) =>
      r.ok ? (r.json() as Promise<any[]>) : [],
    ),
  ]);

  const items = [...registryRes.actions, ...registryRes.skills];
  return {
    items,
    installedActionIds: actions.map((a: any) => a.actionId),
    installedSkillIds: skills.map((s: any) => s.skillId),
  };
}

export default function MarketplaceRoute() {
  const { items, installedActionIds, installedSkillIds } =
    useLoaderData<typeof loader>();
  return (
    <MarketplaceClient
      items={items}
      installedActionIds={installedActionIds}
      installedSkillIds={installedSkillIds}
    />
  );
}
