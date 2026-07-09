import { useCallback, useEffect, useState } from "react";
import { runtimeApiUrl } from "../lib/runtimeConfig";

export type RevisionHistoryKind = "text" | "timeline";

export interface RevisionHistoryContentDescriptor {
  kind?: string;
  stored?: boolean;
  url?: string;
  immutable?: boolean;
  hash?: string;
  mediaType?: string;
  storage?: unknown;
}

export interface RevisionHistoryEntry {
  revisionId: string;
  projectId?: string;
  nodeId?: string;
  textId?: string;
  timelineId?: string;
  textHash?: string;
  timelineHash?: string;
  parentRevisionId?: string | null;
  sourceFilePath?: string | null;
  actor?: string | null;
  createdAt?: string;
  content?: RevisionHistoryContentDescriptor;
}

export interface UseRevisionHistoryOptions {
  projectId: string | null | undefined;
  nodeId: string | null | undefined;
  kind: RevisionHistoryKind;
  limit?: number;
  enabled?: boolean;
}

export interface UseRevisionHistoryReturn {
  revisions: RevisionHistoryEntry[];
  latest: RevisionHistoryEntry | null;
  count: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

function endpointFor(kind: RevisionHistoryKind): string {
  return kind === "text" ? "text-revisions" : "timeline-revisions";
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 5;
  return Math.max(1, Math.floor(limit));
}

export function useRevisionHistory({
  projectId,
  nodeId,
  kind,
  limit,
  enabled = true,
}: UseRevisionHistoryOptions): UseRevisionHistoryReturn {
  const [revisions, setRevisions] = useState<RevisionHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedLimit = normalizeLimit(limit);

  const refetch = useCallback(async () => {
    if (!enabled || !projectId || !nodeId) return;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        nodeId,
        limit: String(normalizedLimit),
      });
      const res = await fetch(
        runtimeApiUrl(`/api/v1/projects/${encodeURIComponent(projectId)}/${endpointFor(kind)}?${query}`),
        { credentials: "same-origin" },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        revisions?: unknown[];
      };
      if (!res.ok) {
        setError(json.error ?? `fetch failed: ${res.status}`);
        setRevisions([]);
        return;
      }
      setRevisions(
        (json.revisions ?? []).filter(
          (entry): entry is RevisionHistoryEntry =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { revisionId?: unknown }).revisionId === "string",
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRevisions([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, kind, nodeId, normalizedLimit, projectId]);

  useEffect(() => {
    setRevisions([]);
    setError(null);
    if (!enabled || !projectId || !nodeId) {
      setLoading(false);
      return;
    }
    void refetch();
  }, [enabled, nodeId, projectId, refetch]);

  return {
    revisions,
    latest: revisions[0] ?? null,
    count: revisions.length,
    loading,
    error,
    refetch,
  };
}
