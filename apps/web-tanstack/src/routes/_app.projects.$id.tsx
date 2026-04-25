/**
 * Project editor route — verbatim port of OSS apps/web's project.$id.tsx.
 * Data fetching adapted to TanStack Query; auth gating handled by _app.tsx.
 */
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import ProjectEditor from "@clash/web-ui/components/ProjectEditor";

export const Route = createFileRoute("/_app/projects/$id")({
  component: ProjectPage,
});

function ProjectPage() {
  const { id } = Route.useParams();
  const search = useSearch({ strict: false }) as { prompt?: string; thread?: string };

  const projectQ = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        credentials: "include",
      });
      if (r.status === 404) throw new Error("Project not found");
      if (!r.ok) throw new Error(`Failed to load project (${r.status})`);
      return r.json();
    },
    enabled: typeof window !== "undefined",
  });
  const actionsQ = useQuery({
    queryKey: ["settings", "actions"],
    queryFn: async () => {
      const r = await fetch("/api/settings/actions", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: typeof window !== "undefined",
  });

  if (projectQ.isPending || !projectQ.data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-neutral-500">
        Loading…
      </div>
    );
  }

  return (
    <ProjectEditor
      project={projectQ.data as any}
      initialPrompt={search.prompt}
      initialThreadId={search.thread}
      globalActions={(actionsQ.data ?? []) as any}
    />
  );
}
