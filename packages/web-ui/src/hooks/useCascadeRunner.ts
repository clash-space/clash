
import { useEffect, useMemo, useRef } from 'react';
import { useReactFlow, useNodes, useEdges } from '@xyflow/react';
import type { Node as RFNode, Edge } from '@xyflow/react';
import { useOptionalLoroSyncContext } from '../components/LoroSyncContext';
import { useCustomActions } from './useCustomActions';
import { computeAdoption } from '../components/nodes/performAdoption';

/**
 * Canvas-level dispatcher for the **backward DAG** build model.
 *
 * Design: the BuildPlanDialog seeds a whole cohort of drafts at click-confirm
 * time — target draft + every incomplete ancestor — each stamped with the same
 * `cascadeToken` and `runRequested: true`. This dispatcher just executes the
 * cohort:
 *
 *   1. For each draft with `runRequested === true`, check the **gate**:
 *      all refs of the upstream action must be `status: 'completed'`. If yes,
 *      call `computeAdoption` and write the pending payload (clears flag).
 *      If not, skip — wait for next tick when upstream state changes.
 *
 *   2. **Failure short-circuit**: if any node in a cohort reaches
 *      `status: 'failed'`, clear runRequested on every peer sharing the same
 *      `cascadeToken`. User sees the failed node; peers stop waiting.
 *
 *   3. **Cancel**: if `data.cascadeCancel` appears on any cohort member, clear
 *      runRequested across the cohort. (Canceller sets the flag; cleanup is
 *      uniform.)
 *
 * No fan-out, no forward propagation — those happened at plan time in the
 * dialog. Dispatcher is a pure executor.
 */
export function useCascadeRunner() {
    const { setNodes } = useReactFlow();
    const nodes = useNodes();
    const edges = useEdges();
    const loroSync = useOptionalLoroSyncContext();
    const customActions = useCustomActions(loroSync?.doc ?? null);

    // Re-entrancy guards against double-processing the same node in a single
    // render cycle (React state batching mid-effect).
    const inFlightRef = useRef<Set<string>>(new Set());

    // Cheap pre-scan: does any node have an actionable flag? Every canvas
    // mutation (drag, dimension-measure, label edit) would otherwise fire
    // the dispatcher's 3 scans for nothing. This reduces the steady-state
    // cost to a single O(N) check. The `inFlight` guard for failed nodes is
    // re-checked inside the effect; pre-scan is conservative (may let a few
    // already-handled failures through, but the effect drops them quickly).
    const hasWork = useMemo(() => {
        for (const n of nodes) {
            const d = n.data as Record<string, unknown> | undefined;
            if (!d) continue;
            if (d.runRequested) return true;
            if (d.cascadeCancel) return true;
            if (d.status === 'failed' && d.cascadeToken) return true;
        }
        return false;
    }, [nodes]);

    useEffect(() => {
        if (!hasWork) return;

        // One-shot indexes rebuilt per effect run. All the `.find()` hotspots
        // below become O(1) lookups, turning O(D×E×N) gate checks into O(D×R).
        const nodeById = new Map<string, RFNode>();
        for (const n of nodes as RFNode[]) nodeById.set(n.id, n);

        const incomingByTarget = new Map<string, Edge[]>();
        for (const e of edges as Edge[]) {
            const list = incomingByTarget.get(e.target);
            if (list) list.push(e);
            else incomingByTarget.set(e.target, [e]);
        }

        // Group cohorts once so phase 1/2 don't re-scan the whole canvas to
        // clear peers.
        const cohortsByToken = new Map<string, RFNode[]>();
        for (const n of nodes as RFNode[]) {
            const token = (n.data as Record<string, unknown> | undefined)?.cascadeToken as string | undefined;
            if (!token) continue;
            const list = cohortsByToken.get(token);
            if (list) list.push(n);
            else cohortsByToken.set(token, [n]);
        }

        const applyPayload = (nodeId: string, payload: Record<string, unknown>) => {
            setNodes((nds) =>
                nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...payload } } : n)),
            );
            if (loroSync?.connected) {
                loroSync.updateNode(nodeId, { data: payload });
            }
        };

        const clearCohort = (token: string, extraPayload: Record<string, unknown> = {}) => {
            const cohort = cohortsByToken.get(token);
            if (!cohort) return;
            for (const n of cohort) {
                const d = n.data as Record<string, unknown> | undefined;
                if (!d) continue;
                if (!d.runRequested && !d.cascadeCancel) continue;
                applyPayload(n.id, { runRequested: false, cascadeCancel: false, ...extraPayload });
            }
        };

        // --- Phase 1: cancel requests ---
        for (const n of nodes) {
            const d = n.data as Record<string, unknown> | undefined;
            if (!d?.cascadeCancel) continue;
            const token = d.cascadeToken as string | undefined;
            if (token) clearCohort(token);
            else applyPayload(n.id, { runRequested: false, cascadeCancel: false });
        }

        // --- Phase 2: failure short-circuit ---
        for (const n of nodes) {
            const d = n.data as Record<string, unknown> | undefined;
            if (!d) continue;
            if (d.status !== 'failed') continue;
            const token = d.cascadeToken as string | undefined;
            if (!token) continue;
            if (inFlightRef.current.has(`fail-${n.id}`)) continue;
            inFlightRef.current.add(`fail-${n.id}`);
            setTimeout(() => inFlightRef.current.delete(`fail-${n.id}`), 2000);
            clearCohort(token);
        }

        // --- Phase 3: adoption (gate + adopt) ---
        for (const n of nodes) {
            const d = n.data as Record<string, unknown> | undefined;
            if (!d) continue;
            if (d.status !== 'draft' && d.status !== 'idle') continue;
            if (!d.runRequested) continue;
            if (inFlightRef.current.has(n.id)) continue;

            // Find the one upstream action-badge via incoming-edges index.
            const draftIncoming = incomingByTarget.get(n.id) ?? [];
            let action: RFNode | undefined;
            for (const e of draftIncoming) {
                const src = nodeById.get(e.source);
                if (src?.type === 'action-badge') { action = src; break; }
            }
            if (!action) {
                applyPayload(n.id, { runRequested: false });
                continue;
            }

            // Gate: all of the action's input refs must be completed. Map
            // lookup per ref is O(1), no more nested scans.
            const refEdges = incomingByTarget.get(action.id) ?? [];
            let allSatisfied = true;
            for (const e of refEdges) {
                const src = nodeById.get(e.source);
                const s = (src?.data as Record<string, unknown> | undefined)?.status;
                if (s !== 'completed') { allSatisfied = false; break; }
            }
            if (!allSatisfied) continue;

            // Adopt — compute fresh payload from action's live state.
            const result = computeAdoption({
                actionBadgeNode: action,
                nodes: nodes as RFNode[],
                edges: edges as Edge[],
                customActions,
            });
            if (!result.ok || !result.data) {
                console.warn(`[cascade] adoption failed for ${n.id}: ${result.error ?? 'unknown'}`);
                applyPayload(n.id, { runRequested: false });
                if (d.cascadeToken) {
                    applyPayload(n.id, { status: 'failed', failureReason: result.error ?? 'Adoption failed' });
                }
                continue;
            }

            inFlightRef.current.add(n.id);
            setTimeout(() => inFlightRef.current.delete(n.id), 1500);

            const existingToken = d.cascadeToken as string | undefined;
            const payload: Record<string, unknown> = { ...result.data, runRequested: false };
            if (existingToken) payload.cascadeToken = existingToken;
            applyPayload(n.id, payload);
        }
    }, [hasWork, nodes, edges, customActions, setNodes, loroSync]);
}

/**
 * Zero-render component that mounts `useCascadeRunner`. Must be rendered
 * INSIDE `<ReactFlow>` — the underlying hooks (useNodes/useEdges) require
 * the React Flow context that ReactFlow provides to its children.
 */
export function CascadeRunnerMount() {
    useCascadeRunner();
    return null;
}
