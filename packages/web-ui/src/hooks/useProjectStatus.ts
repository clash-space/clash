import { useCallback, useEffect, useState } from "react";
import type { ProjectStatus, ProjectStatusActionGates } from "@clash/shared-runtime";
import { runtimeApiUrl } from "../lib/runtimeConfig";

export interface UseProjectStatusReturn {
  status: ProjectStatus | null;
  actions: ProjectStatusActionGates | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useProjectStatus(projectId: string | null | undefined): UseProjectStatusReturn {
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(runtimeApiUrl(`/api/v1/projects/${encodeURIComponent(projectId)}/status`), {
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError(`fetch failed: ${res.status}`);
        return;
      }
      const json = (await res.json()) as ProjectStatus;
      setStatus(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setStatus(null);
    setError(null);
    if (projectId) {
      void refetch();
      return;
    }
    setLoading(false);
  }, [projectId, refetch]);

  return {
    status,
    actions: status?.collaboration.actions ?? null,
    loading,
    error,
    refetch,
  };
}
