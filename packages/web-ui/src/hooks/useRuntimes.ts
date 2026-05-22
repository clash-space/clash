import { useCallback, useEffect, useState } from 'react';
import type { CustomActionDefinition } from '@clash/shared-types';
import type { Runtime } from './useClashRuntime';

/**
 * useRuntimes — read-only list of the user's registered runtimes.
 *
 * Thin sibling of `useClashRuntime` (which also wires up sessions / chat).
 * UI surfaces like the action-badge picker only need to KNOW whether the
 * runtime that owns a custom action is currently online — they don't
 * spawn sessions, so they don't want the heavier hook.
 *
 * Refresh cadence: initial fetch on mount + a 15s poll. The runtime
 * heartbeat interval is 30s (see clash-bridge daemon), so 15s gives
 * us at most one missed beat before the UI updates. Polling instead
 * of pushing because there's no project-level WS we can piggyback on
 * — running a dedicated WS for status felt heavier than warranted.
 */

const RUNTIMES_PATH = '/api/v1/runtimes';
const POLL_MS = 15_000;

export interface UseRuntimesReturn {
  runtimes: Runtime[];
  /** True until the first fetch resolves — UI should treat "no data yet"
   *  as "unknown" rather than offline so we don't flash-disable
   *  everything on initial mount. */
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useRuntimes(): UseRuntimesReturn {
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(RUNTIMES_PATH, { credentials: 'same-origin' });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const json = (await res.json()) as { runtimes: Runtime[] };
      setRuntimes(json.runtimes ?? []);
    } catch {
      /* network noise; keep last-known list */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const iv = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(iv);
  }, [refresh]);

  return { runtimes, loading, refresh };
}

/**
 * Decide whether a custom action's owning runtime is currently online.
 *
 * Rules (matching the server-side dispatch gate):
 *   - Worker actions don't depend on a local runtime — always online.
 *   - Local actions whose `registeredByRuntime` is undefined: treated as
 *     offline. These are legacy rows from before option C; the server
 *     will fail dispatch with the same "Local runtime offline" error.
 *   - Otherwise: online iff the matching runtime row exists with
 *     `status === 'online'`.
 *
 * `runtimes` may be empty during the first paint (loading) — callers
 * that want to avoid flash-disable should also check `loading` from
 * the hook and treat unknown as online until the first response.
 */
export function isCustomActionRuntimeOnline(
  action: Pick<CustomActionDefinition, 'runtime' | 'registeredByRuntime'> | undefined,
  runtimes: Runtime[],
): boolean {
  if (!action) return true;
  if (action.runtime === 'worker') return true;
  if (!action.registeredByRuntime) return false;
  const row = runtimes.find((r) => r.id === action.registeredByRuntime);
  return row?.status === 'online';
}

/** Copy users see on hover when an action is offline-gated. Mirrors the
 *  server-side dispatch error so the UI and the failure are consistent. */
export const RUNTIME_OFFLINE_TOOLTIP =
  'Start your local Clash bridge to use this action: clash-bridge daemon';
export const RUNTIME_OFFLINE_LABEL = 'Local runtime offline';
