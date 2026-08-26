import { redirect } from "react-router";
import type { RegistryItem } from "@clash/web-ui/lib/clientActions";
import { runtimeApiUrl } from "@clash/web-ui/lib/runtimeConfig";

interface RegistryData {
  version: number;
  actions: RegistryItem[];
  skills: RegistryItem[];
}

export interface MarketplaceData {
  items: RegistryItem[];
  installedActionIds: string[];
  installedSkillIds: string[];
}

interface MarketplaceFeedResponse {
  version: number;
  featuredPlugins: RegistryItem[];
}

export interface MarketplaceFeedData {
  featuredPlugins: RegistryItem[];
  installedActionIds: string[];
  installedSkillIds: string[];
}

const emptyRegistry: RegistryData = { version: 1, actions: [], skills: [] };

export const emptyMarketplaceData: MarketplaceData = {
  items: [],
  installedActionIds: [],
  installedSkillIds: [],
};

const emptyMarketplaceFeedResponse: MarketplaceFeedResponse = {
  version: 1,
  featuredPlugins: [],
};

export const emptyMarketplaceFeedData: MarketplaceFeedData = {
  featuredPlugins: [],
  installedActionIds: [],
  installedSkillIds: [],
};

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 2000);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function fetchRegistry(): Promise<RegistryData> {
  try {
    const response = await fetchWithTimeout(
      runtimeApiUrl("/api/marketplace/registry"),
    );
    if (!response.ok) return emptyRegistry;
    const registry = (await response.json()) as Partial<RegistryData>;
    return {
      version: typeof registry.version === "number" ? registry.version : 1,
      actions: Array.isArray(registry.actions) ? registry.actions : [],
      skills: Array.isArray(registry.skills) ? registry.skills : [],
    };
  } catch {
    return emptyRegistry;
  }
}

async function fetchMarketplaceFeed(): Promise<MarketplaceFeedResponse> {
  try {
    const response = await fetchWithTimeout(
      runtimeApiUrl("/api/marketplace/feed"),
    );
    if (!response.ok) return emptyMarketplaceFeedResponse;
    const feed = (await response.json()) as Partial<MarketplaceFeedResponse>;
    return {
      version: typeof feed.version === "number" ? feed.version : 1,
      featuredPlugins: Array.isArray(feed.featuredPlugins)
        ? feed.featuredPlugins
        : [],
    };
  } catch {
    return emptyMarketplaceFeedResponse;
  }
}

async function fetchInstalled<T>(path: string): Promise<T[]> {
  try {
    const response = await fetchWithTimeout(runtimeApiUrl(path), {
      credentials: "include",
    });
    if (response.status === 401) throw redirect("/login");
    if (!response.ok) return [];
    const installed = await response.json();
    return Array.isArray(installed) ? (installed as T[]) : [];
  } catch (error) {
    if (error instanceof Response) throw error;
    return [];
  }
}

export async function loadMarketplaceData(): Promise<MarketplaceData> {
  const [registry, actions, skills] = await Promise.all([
    fetchRegistry(),
    fetchInstalled<{ actionId?: unknown }>("/api/settings/actions"),
    fetchInstalled<{ skillId?: unknown }>("/api/settings/skills"),
  ]);

  return {
    items: [...registry.actions, ...registry.skills],
    installedActionIds: actions.flatMap((action) =>
      typeof action.actionId === "string" ? [action.actionId] : [],
    ),
    installedSkillIds: skills.flatMap((skill) =>
      typeof skill.skillId === "string" ? [skill.skillId] : [],
    ),
  };
}

export async function loadMarketplaceFeedData(): Promise<MarketplaceFeedData> {
  const [feed, actions, skills] = await Promise.all([
    fetchMarketplaceFeed(),
    fetchInstalled<{ actionId?: unknown }>("/api/settings/actions"),
    fetchInstalled<{ skillId?: unknown }>("/api/settings/skills"),
  ]);

  return {
    featuredPlugins: feed.featuredPlugins,
    installedActionIds: actions.flatMap((action) =>
      typeof action.actionId === "string" ? [action.actionId] : [],
    ),
    installedSkillIds: skills.flatMap((skill) =>
      typeof skill.skillId === "string" ? [skill.skillId] : [],
    ),
  };
}
