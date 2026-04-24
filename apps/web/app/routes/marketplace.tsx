import type { ClientLoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import MarketplaceClient from "@clash/web-ui/components/MarketplaceClient";
import type { RegistryItem } from "@clash/web-ui/lib/clientActions";

interface RegistryData {
  version: number;
  actions: RegistryItem[];
  skills: RegistryItem[];
}

export async function clientLoader(_: ClientLoaderFunctionArgs) {
  const guard = await fetch("/api/settings/actions", { credentials: "include" });
  if (guard.status === 401) throw redirect("/login");

  const [registryRes, actions, skills] = await Promise.all([
    fetch("/api/marketplace/registry").then((r) =>
      r.ok
        ? (r.json() as Promise<RegistryData>)
        : ({ version: 1, actions: [], skills: [] } as RegistryData),
    ),
    fetch("/api/settings/actions", { credentials: "include" }).then((r) =>
      r.ok ? (r.json() as Promise<any[]>) : [],
    ),
    fetch("/api/settings/skills", { credentials: "include" }).then((r) =>
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
    useLoaderData<typeof clientLoader>();
  return (
    <MarketplaceClient
      items={items}
      installedActionIds={installedActionIds}
      installedSkillIds={installedSkillIds}
    />
  );
}
