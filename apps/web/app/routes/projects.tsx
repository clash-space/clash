import type { ClientLoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import ProjectsClient from "@clash/web-ui/components/ProjectsClient";

export async function clientLoader(_: ClientLoaderFunctionArgs) {
  const res = await fetch("/api/projects", { credentials: "include" });
  if (res.status === 401) throw redirect("/login");
  if (!res.ok) throw new Response("Failed to load projects", { status: 500 });
  const projects = (await res.json()) as unknown[];
  return { projects };
}

export default function ProjectsRoute() {
  const { projects } = useLoaderData<typeof clientLoader>();
  return <ProjectsClient projects={projects as any} />;
}
