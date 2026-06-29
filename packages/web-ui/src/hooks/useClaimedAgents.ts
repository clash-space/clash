/**
 * Fetch the user's claimed agent (agent_member rows in D1) from the
 * server. The list drives both the InviteAgentMenu (uninvited subset)
 * and tab labels (display_name → handle resolution for room mentions).
 *
 * Refetch is exposed so the panel can pull a fresh list after the user
 * claims a new agent in Settings without forcing a full page reload.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AgentRow } from '../_group-chat/panel-types';
import { runtimeApiUrl } from '../lib/runtimeConfig';

interface UseClaimedAgentResult {
  agents: AgentRow[];
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useClaimedAgents(): UseClaimedAgentResult {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(runtimeApiUrl('/api/v1/agents'), { credentials: 'include' });
      if (!res.ok) return;
      const json = (await res.json()) as { agents: AgentRow[] };
      setAgents(json.agents ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  return { agents, loading, refetch };
}
