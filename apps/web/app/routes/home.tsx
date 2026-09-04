import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import HomePageClient from "@clash/web-ui/components/HomePageClient";
import {
  getRuntimeCapabilities,
  runtimeApiUrl,
  runtimeFetch,
} from "@clash/web-ui/lib/runtimeConfig";
import {
  emptyMarketplaceFeedData,
  loadMarketplaceFeedData,
} from "../lib/marketplaceData";

export async function loader(_: LoaderFunctionArgs) {
  if (getRuntimeCapabilities().auth.mode === "better-auth") {
    let session: Response;
    try {
      session = await fetch(runtimeApiUrl("/api/better-auth/get-session"), {
        credentials: "include",
      });
    } catch {
      throw new Response("Unable to verify session", { status: 503 });
    }
    if (session.status === 401) throw redirect("/login");
    if (!session.ok) {
      throw new Response("Unable to verify session", {
        status: session.status,
      });
    }
    const data = (await session.json()) as { user?: { id?: string } } | null;
    if (!data?.user?.id) throw redirect("/login");
  }

  const [projects, marketplaceFeed] = await Promise.all([
    runtimeFetch("/api/v1/projects", { credentials: "include" })
      .then(async (response) => {
        if (response.status === 401) throw redirect("/login");
        if (!response.ok) return [];
        const data = (await response.json()) as { projects?: unknown[] };
        return Array.isArray(data.projects) ? data.projects : [];
      })
      .catch((error: unknown) => {
        if (error instanceof Response) throw error;
        return [];
      }),
    loadMarketplaceFeedData().catch((error: unknown) => {
      if (error instanceof Response) throw error;
      return emptyMarketplaceFeedData;
    }),
  ]);

  return { authed: true as const, projects, marketplaceFeed };
}

export default function Home() {
  const data = useLoaderData<typeof loader>();
  return (
    <HomePageClient
      initialProjects={data.projects as any}
      marketplaceFeed={data.marketplaceFeed}
    />
  );
}
