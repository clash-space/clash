import type { Node as RFNode, Edge } from '@xyflow/react';
import { MODEL_CARDS } from '@clash/shared-types';

export interface PlanEntry {
    draftId: string;
    actionId: string | null;
    modelId: string | null;
    modelName: string;
    modality: 'image' | 'video' | 'audio' | 'text';
    label: string;
    hasPrompt: boolean;
}

export interface BuildPlan {
    /** Drafts to seed, in reverse-DFS order (target last, deepest ancestors first). */
    entries: PlanEntry[];
    /** modelId → total invocation count across the plan. */
    modelCounts: Map<string, number>;
    /** Pre-flight issues that should block confirmation. */
    blockers: string[];
    /** Soft warnings worth surfacing but non-blocking. */
    warnings: string[];
    /** True iff a cycle was detected in the reverse traversal. */
    cycle: boolean;
}

const isDraftStatus = (s: unknown): boolean => s === 'draft' || s === 'idle';

type BuildPlanNode = Pick<RFNode, 'id' | 'type' | 'data'>;
type BuildPlanEdge = Pick<Edge, 'source' | 'target'>;

/**
 * Reverse-DAG evaluator. Given a target draft node, returns the minimum set of
 * drafts that must run to realize it — plus its own entry.
 *
 * Traversal rules:
 *   • draft node → include, recurse into its upstream action(s)
 *   • action-badge → recurse into its input refs (incoming edges)
 *   • completed / failed / other → stop (dependency already satisfied or
 *     unreachable; don't include)
 *   • cycle → abort, return empty plan + `cycle: true`
 *
 * Used in three places:
 *   • DraftPlaceholder button label ("Build +N")
 *   • BuildPlanDialog confirmation table
 *   • useCascadeRunner seeding (flags runRequested on all plan entries)
 *
 * Pure function — no React Flow / Loro writes. Callers handle state.
 */
export function computeBuildPlan(targetId: string, nodes: RFNode[], edges: Edge[]): BuildPlan {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const incoming = new Map<string, Edge[]>();
    for (const e of edges) {
        const list = incoming.get(e.target);
        if (list) list.push(e);
        else incoming.set(e.target, [e]);
    }

    return computeBuildPlanFromGraph(
        targetId,
        (nodeId) => nodeMap.get(nodeId),
        (nodeId) => incoming.get(nodeId) ?? [],
    );
}

export function computeBuildPlanFromGraph(
    targetId: string,
    getNode: (nodeId: string) => BuildPlanNode | undefined,
    getIncomingEdges: (nodeId: string) => readonly BuildPlanEdge[],
): BuildPlan {
    const visited = new Set<string>();
    const inProgress = new Set<string>();
    const orderedDraftIds: string[] = []; // post-order → ancestors appear before descendants
    let cycle = false;

    const dfs = (nodeId: string): void => {
        if (cycle) return;
        if (inProgress.has(nodeId)) {
            cycle = true;
            return;
        }
        if (visited.has(nodeId)) return;

        inProgress.add(nodeId);
        const node = getNode(nodeId);
        if (!node) {
            inProgress.delete(nodeId);
            visited.add(nodeId);
            return;
        }

        const status = (node.data as Record<string, unknown> | undefined)?.status;
        const isDraft = node.type !== 'action-badge' && isDraftStatus(status);
        const isAction = node.type === 'action-badge';

        if (isAction || isDraft) {
            const ins = getIncomingEdges(nodeId);
            for (const e of ins) dfs(e.source);
            if (cycle) {
                inProgress.delete(nodeId);
                return;
            }
            if (isDraft) orderedDraftIds.push(nodeId);
        }
        // completed / failed / non-action non-draft → stop here, don't recurse

        inProgress.delete(nodeId);
        visited.add(nodeId);
    };

    dfs(targetId);

    if (cycle) {
        return {
            entries: [],
            modelCounts: new Map(),
            blockers: ['Cycle detected in dependency graph.'],
            warnings: [],
            cycle: true,
        };
    }

    const entries: PlanEntry[] = [];
    const modelCounts = new Map<string, number>();
    const blockers: string[] = [];
    const warnings: string[] = [];

    for (const draftId of orderedDraftIds) {
        const draft = getNode(draftId);
        if (!draft) continue;
        const draftData = (draft.data ?? {}) as Record<string, unknown>;

        // Upstream action is the source of the single incoming edge.
        const draftIncoming = getIncomingEdges(draftId);
        const actionEdge = draftIncoming.find((e) => {
            const src = getNode(e.source);
            return src?.type === 'action-badge';
        });
        const action = actionEdge ? getNode(actionEdge.source) : undefined;
        const actionData = (action?.data ?? {}) as Record<string, unknown>;

        const modelId = (actionData.modelId as string | undefined) ?? null;
        const modelName = modelId
            ? MODEL_CARDS.find((c) => c.id === modelId)?.name ?? modelId
            : 'Unknown';

        const label = ((draftData.label as string | undefined) ?? draft.id).trim() || draft.id;

        const rawPrompt = ((actionData.content as string | undefined) ?? '')
            || ((actionData.prompt as string | undefined) ?? '');
        const hasPrompt = rawPrompt.trim().length > 0;

        const modality =
            draft.type === 'video' || draft.type === 'audio' || draft.type === 'text'
                ? draft.type
                : 'image';

        entries.push({
            draftId,
            actionId: action?.id ?? null,
            modelId,
            modelName,
            modality,
            label,
            hasPrompt,
        });

        const modelKey = modelId ?? 'unknown';
        modelCounts.set(modelKey, (modelCounts.get(modelKey) ?? 0) + 1);

        if (!action) {
            warnings.push(`"${label}" has no upstream action — skipped at run time.`);
            continue;
        }
        if (!modelId) {
            blockers.push(`"${label}": no model selected on upstream action.`);
        }
        if (!hasPrompt) {
            blockers.push(`"${label}": upstream action has no prompt.`);
        }
    }

    if (entries.length === 0 && !cycle) {
        // Shouldn't normally happen — target itself should always be a draft at
        // click time. Defensive.
        warnings.push('Nothing to build — target is not a draft.');
    }

    return { entries, modelCounts, blockers, warnings, cycle };
}

/** Pretty-print `modelCounts` for the dialog's summary row. Descending count. */
export function summarizeModelCounts(modelCounts: Map<string, number>): Array<{ modelId: string; modelName: string; count: number }> {
    return Array.from(modelCounts.entries())
        .map(([modelId, count]) => ({
            modelId,
            modelName: modelId === 'unknown'
                ? 'Unknown'
                : (MODEL_CARDS.find((c) => c.id === modelId)?.name ?? modelId),
            count,
        }))
        .sort((a, b) => b.count - a.count);
}
