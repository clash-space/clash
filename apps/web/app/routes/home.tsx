import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import HomePageClient from "@clash/web-ui/components/HomePageClient";
import { runtimeApiUrl } from "@clash/web-ui/lib/runtimeConfig";
import {
  emptyMarketplaceFeedData,
  loadMarketplaceFeedData,
} from "../lib/marketplaceData";
import LandingRoute from "./landing";

export async function loader(_: LoaderFunctionArgs) {
  let authenticated = false;
  try {
    const session = await fetch(runtimeApiUrl("/api/better-auth/get-session"), {
      credentials: "include",
    });
    if (!session.ok) return { authed: false as const };
    const data = (await session.json()) as { user?: { id?: string } } | null;
    if (!data?.user?.id) return { authed: false as const };
    authenticated = true;
  } catch {
    return { authed: false as const };
  }

  if (!authenticated) return { authed: false as const };

  const [projects, marketplaceFeed] = await Promise.all([
    fetch(runtimeApiUrl("/api/v1/projects"), { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return [];
        const data = (await response.json()) as { projects?: unknown[] };
        return Array.isArray(data.projects) ? data.projects : [];
      })
      .catch(() => []),
    loadMarketplaceFeedData().catch((error: unknown) => {
      if (error instanceof Response) throw error;
      return emptyMarketplaceFeedData;
    }),
  ]);

  return { authed: true as const, projects, marketplaceFeed };
}

export default function Home() {
  const data = useLoaderData<typeof loader>();
  if (!data.authed) return <LandingRoute />;
  return (
    <HomePageClient
      initialProjects={data.projects as any}
      marketplaceFeed={data.marketplaceFeed}
    />
  );
}
