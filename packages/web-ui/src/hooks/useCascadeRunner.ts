import { useEffect, useMemo, useRef } from "react";
import type { Edge, Node as RFNode } from "@xyflow/react";
import { planCascadeTick } from "@clash/shared-runtime";
import type { CustomActionDefinition } from "@clash/shared-types";
import { useOptionalLoroSyncContext } from "../components/LoroSyncContext";
import { computeAdoption } from "../components/nodes/performAdoption";

type SetNodes = (updater: RFNode[] | ((nodes: RFNode[]) => RFNode[])) => void;

/**
 * ReactFlow adapter over the shared cascade scheduler. The scheduler owns gate,
 * cancellation, and failure precedence; this hook performs Canvas adoption and
 * projects each decision back into React state and Loro.
 */
export function useCascadeRunner({
  nodes,
  edges,
  setNodes,
  customActions,
}: {
  nodes: RFNode[];
  edges: Edge[];
  setNodes: SetNodes;
  customActions: CustomActionDefinition[];
}) {
  const loroSync = useOptionalLoroSyncContext();
  const inFlightRef = useRef<Set<string>>(new Set());

  const hasWork = useMemo(
    () =>
      nodes.some((node) => {
        const data = node.data as Record<string, unknown> | undefined;
        return Boolean(
          data?.runRequested ||
          data?.cascadeCancel ||
          (data?.status === "failed" && data?.cascadeToken),
        );
      }),
    [nodes],
  );

  useEffect(() => {
    if (!hasWork) return;

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const tick = planCascadeTick({ nodes, edges });

    const applyPayload = (nodeId: string, payload: Record<string, unknown>) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, ...payload } }
            : node,
        ),
      );
      if (loroSync) {
        loroSync.updateNode(nodeId, { data: payload });
      }
    };

    for (const decision of tick.decisions) {
      if (decision.kind === "clear") {
        applyPayload(decision.nodeId, {
          runRequested: false,
          cascadeCancel: false,
        });
        continue;
      }

      if (inFlightRef.current.has(decision.draftNodeId)) continue;
      const draft = nodeById.get(decision.draftNodeId);
      const action = nodeById.get(decision.actionNodeId);
      if (!draft || !action) {
        applyPayload(decision.draftNodeId, { runRequested: false });
        continue;
      }

      const result = computeAdoption({
        actionBadgeNode: action,
        nodes,
        edges,
        customActions,
      });
      if (!result.ok || !result.data) {
        const failureReason = result.error ?? "Adoption failed";
        console.warn(
          `[cascade] adoption failed for ${decision.draftNodeId}: ${failureReason}`,
        );
        applyPayload(decision.draftNodeId, {
          runRequested: false,
          ...(decision.cascadeToken ? { status: "failed", failureReason } : {}),
        });
        continue;
      }

      inFlightRef.current.add(decision.draftNodeId);
      setTimeout(() => inFlightRef.current.delete(decision.draftNodeId), 1500);

      applyPayload(decision.draftNodeId, {
        ...result.data,
        runRequested: false,
        ...(decision.cascadeToken
          ? { cascadeToken: decision.cascadeToken }
          : {}),
      });
    }
  }, [hasWork, nodes, edges, customActions, setNodes, loroSync]);
}

/**
 * Zero-render component that mounts `useCascadeRunner` against controlled
 * ReactFlow state from `ProjectEditor`.
 */
export function CascadeRunnerMount({
  nodes,
  edges,
  setNodes,
  customActions,
}: {
  nodes: RFNode[];
  edges: Edge[];
  setNodes: SetNodes;
  customActions: CustomActionDefinition[];
}) {
  useCascadeRunner({ nodes, edges, setNodes, customActions });
  return null;
}
