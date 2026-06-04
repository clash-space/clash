import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useSearchParams } from "react-router";
import ProjectEditor from "@clash/web-ui/components/ProjectEditor";
import { runtimeApiUrl } from "@clash/web-ui/lib/runtimeConfig";

export async function loader({ params }: LoaderFunctionArgs) {
  const id = params.id!;
  const [projRes, actionsRes] = await Promise.all([
    fetch(runtimeApiUrl(`/api/projects/${encodeURIComponent(id)}`), { credentials: "include" }),
    fetch(runtimeApiUrl("/api/settings/actions"), { credentials: "include" }),
  ]);

  if (projRes.status === 401) throw redirect("/login");
  if (projRes.status === 404) throw new Response("Project not found", { status: 404 });
  if (!projRes.ok) {
    throw new Response(`Failed to load project (${projRes.status})`, {
      status: projRes.status,
    });
  }

  const project = (await projRes.json()) as unknown;
  const globalActions = actionsRes.ok ? await actionsRes.json() : [];
  return { project, globalActions };
}

export default function ProjectRoute() {
  const { project, globalActions } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const prompt = searchParams.get("prompt") ?? undefined;
  const thread = searchParams.get("thread") ?? undefined;
  return (
    <ProjectEditor
      project={project as any}
      initialPrompt={prompt}
      initialThreadId={thread}
      globalActions={globalActions as any}
    />
  );
}
