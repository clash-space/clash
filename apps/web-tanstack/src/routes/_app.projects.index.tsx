/**
 * Projects route — UI from OSS apps/web's ProjectsClient. Auth is
 * handled by the _app layout, so this just fetches and renders.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import ProjectsClient from "@clash/web-ui/components/ProjectsClient";

export const Route = createFileRoute("/_app/projects/")({
  component: ProjectsPage,
});

function ProjectsPage() {
  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load projects");
      return (await res.json()) as unknown[];
    },
    enabled: typeof window !== "undefined",
  });

  return <ProjectsClient projects={(projectsQ.data ?? []) as any} />;
}
