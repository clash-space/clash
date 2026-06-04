import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import ProjectsClient from "@clash/web-ui/components/ProjectsClient";
import { runtimeApiUrl } from "@clash/web-ui/lib/runtimeConfig";

export async function loader(_: LoaderFunctionArgs) {
  const res = await fetch(runtimeApiUrl("/api/projects"), { credentials: "include" });
  if (res.status === 401) throw redirect("/login");
  if (!res.ok) throw new Response("Failed to load projects", { status: 500 });
  const projects = (await res.json()) as unknown[];
  return { projects };
}

export default function ProjectsRoute() {
  const { projects } = useLoaderData<typeof loader>();
  return <ProjectsClient projects={projects as any} />;
}
