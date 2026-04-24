import type { ClientLoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import HomePageClient from "@clash/web-ui/components/HomePageClient";
import LandingRoute from "./landing";

export async function clientLoader(_: ClientLoaderFunctionArgs) {
  try {
    const session = await fetch("/api/better-auth/get-session", {
      credentials: "include",
    });
    if (!session.ok) return { authed: false as const };
    const data = (await session.json()) as { user?: { id?: string } } | null;
    if (!data?.user?.id) return { authed: false as const };

    const res = await fetch("/api/projects", { credentials: "include" });
    const projects = res.ok ? ((await res.json()) as unknown[]) : [];
    return { authed: true as const, projects };
  } catch {
    return { authed: false as const };
  }
}

export default function Home() {
  const data = useLoaderData<typeof clientLoader>();
  if (!data.authed) return <LandingRoute />;
  return <HomePageClient initialProjects={data.projects as any} />;
}
