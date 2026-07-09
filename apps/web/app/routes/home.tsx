import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import HomePageClient from "@clash/web-ui/components/HomePageClient";
import { runtimeApiUrl } from "@clash/web-ui/lib/runtimeConfig";
import LandingRoute from "./landing";

export async function loader(_: LoaderFunctionArgs) {
  try {
    const session = await fetch(runtimeApiUrl("/api/better-auth/get-session"), {
      credentials: "include",
    });
    if (!session.ok) return { authed: false as const };
    const data = (await session.json()) as { user?: { id?: string } } | null;
    if (!data?.user?.id) return { authed: false as const };

    const res = await fetch(runtimeApiUrl("/api/v1/projects"), { credentials: "include" });
    const projectsData = res.ok ? ((await res.json()) as { projects?: unknown[] }) : {};
    const projects = projectsData.projects ?? [];
    return { authed: true as const, projects };
  } catch {
    return { authed: false as const };
  }
}

export default function Home() {
  const data = useLoaderData<typeof loader>();
  if (!data.authed) return <LandingRoute />;
  return <HomePageClient initialProjects={data.projects as any} />;
}
