/**
 * Surfaces peer-selection info to node components without coupling every
 * leaf node to the awareness hook. ProjectEditor owns the awareness hook
 * and feeds the peer list in here; child node components call
 * `usePeersSelectingNode(id)` for the cheap derived slice.
 *
 * The context value updates on every peer broadcast — but since memoised
 * node components only re-render when THEIR peers list changes (we return
 * a referentially stable empty array when no peer selects this node), the
 * common case is no extra renders.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Peer } from '@clash/web-ui/hooks/usePresenceAwareness';

interface PresenceAwarenessContextValue {
  /** All peers (everyone except local user). */
  peers: Peer[];
  /** Pre-indexed: nodeId → peers selecting that node. */
  peersByNodeId: Map<string, Peer[]>;
}

const Ctx = createContext<PresenceAwarenessContextValue>({
  peers: [],
  peersByNodeId: new Map(),
});

const EMPTY_PEERS: Peer[] = [];

export function PresenceAwarenessProvider({
  peers,
  children,
}: {
  peers: Peer[];
  children: ReactNode;
}) {
  const value = useMemo<PresenceAwarenessContextValue>(() => {
    const idx = new Map<string, Peer[]>();
    for (const peer of peers) {
      for (const nodeId of peer.selectedNodeIds) {
        const existing = idx.get(nodeId);
        if (existing) existing.push(peer);
        else idx.set(nodeId, [peer]);
      }
    }
    return { peers, peersByNodeId: idx };
  }, [peers]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePeersSelectingNode(nodeId: string): Peer[] {
  const ctx = useContext(Ctx);
  return ctx.peersByNodeId.get(nodeId) ?? EMPTY_PEERS;
}

/** All peers currently broadcasting awareness in this project — used
 *  by attribution UI to resolve userId → userName cheaply without an
 *  API round-trip when the actor is also a live participant. */
export function useAllPeers(): Peer[] {
  return useContext(Ctx).peers;
}
