import { redirect, useLoaderData } from "react-router";
import MarketplaceClient from "@clash/web-ui/components/MarketplaceClient";
import type { RegistryItem } from "@clash/web-ui/lib/clientActions";
import { runtimeApiUrl } from "@clash/web-ui/lib/runtimeConfig";

interface RegistryData {
  version: number;
  actions: RegistryItem[];
  skills: RegistryItem[];
}

const emptyRegistry: RegistryData = { version: 1, actions: [], skills: [] };

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 2000);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function fetchRegistry() {
  try {
    const response = await fetchWithTimeout(runtimeApiUrl("/api/marketplace/registry"));
    return response.ok ? (response.json() as Promise<RegistryData>) : emptyRegistry;
  } catch {
    return emptyRegistry;
  }
}

async function fetchInstalled<T>(path: string) {
  const response = await fetchWithTimeout(runtimeApiUrl(path), { credentials: "include" });
  if (response.status === 401) throw redirect("/login");
  return response.ok ? (response.json() as Promise<T[]>) : [];
}

export async function loader() {
  const [registryRes, actions, skills] = await Promise.all([
    fetchRegistry(),
    fetchInstalled<any>("/api/settings/actions"),
    fetchInstalled<any>("/api/settings/skills"),
  ]);

  const items = [...registryRes.actions, ...registryRes.skills];
  return {
    items,
    installedActionIds: actions.map((a: any) => a.actionId),
    installedSkillIds: skills.map((s: any) => s.skillId),
  };
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
