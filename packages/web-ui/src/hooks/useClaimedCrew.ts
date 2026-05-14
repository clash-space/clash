/**
 * Fetch the user's claimed crew (crew_member rows in D1) from the
 * server. The list drives both the InviteCrewMenu (uninvited subset)
 * and tab labels (display_name → handle resolution for room mentions).
 *
 * Refetch is exposed so the panel can pull a fresh list after the user
 * claims a new crew in Settings without forcing a full page reload.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CrewRow } from '../_group-chat/panel-types';

interface UseClaimedCrewResult {
  crew: CrewRow[];
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useClaimedCrew(): UseClaimedCrewResult {
  const [crew, setCrew] = useState<CrewRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/crew', { credentials: 'same-origin' });
      if (!res.ok) return;
      const json = (await res.json()) as { crew: CrewRow[] };
      setCrew(json.crew ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  return { crew, loading, refetch };
}
