import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import ProjectEditor from "@clash/web-ui/components/ProjectEditor";

export const Route = createFileRoute("/_app/projects/$id")({
  component: ProjectPage,
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

// loro-crdt's wasm + @xyflow/react both assume a browser; SSR'd ProjectEditor
// hydrates with no edges/handles measured and effects out of order. Mount
// client-only.
function ClientOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <>{children}</> : <>{fallback ?? null}</>;
}

function Loading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center text-sm text-neutral-500">
      Loading…
    </div>
  );
}

function ProjectPage() {
  const data = Route.useLoaderData();
  const search = useSearch({ strict: false }) as { prompt?: string; thread?: string };

  if (!data) return <Loading />;

  return (
    <ClientOnly fallback={<Loading />}>
      <ProjectEditor
        project={data.project as any}
        initialPrompt={search.prompt}
        initialThreadId={search.thread}
        globalActions={(data.globalActions ?? []) as any}
      />
    </ClientOnly>
  );
}
