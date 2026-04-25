import { createFileRoute, useSearch } from "@tanstack/react-router";
import ProjectEditor from "@clash/web-ui/components/ProjectEditor";

export const Route = createFileRoute("/_app/projects/$id")({
  component: ProjectPage,
  // Loader runs before the route mounts → no "Loading…" flash on SPA nav.
  // Skip on SSR (Better Auth cookies aren't forwarded server-side anyway).
  loader: async ({ params }) => {
    if (typeof window === "undefined") return null;
    const [projRes, actionsRes] = await Promise.all([
      fetch(`/api/projects/${encodeURIComponent(params.id)}`, { credentials: "include" }),
      fetch("/api/settings/actions", { credentials: "include" }),
    ]);
    if (projRes.status === 404) throw new Error("Project not found");
    if (!projRes.ok) throw new Error(`Failed to load project (${projRes.status})`);
    const project = await projRes.json();
    const globalActions = actionsRes.ok ? await actionsRes.json() : [];
    return { project, globalActions };
  },
});

function ProjectPage() {
  const data = Route.useLoaderData();
  const search = useSearch({ strict: false }) as { prompt?: string; thread?: string };

  if (!data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-neutral-500">
        Loading…
      </div>
    );
  }

  return (
    <ProjectEditor
      project={data.project as any}
      initialPrompt={search.prompt}
      initialThreadId={search.thread}
      globalActions={(data.globalActions ?? []) as any}
    />
  );
}
