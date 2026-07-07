import type { Edge, Node } from "@xyflow/react";
import { isCanvasActionCheckpointLocked } from "@clash/shared-types";

export function actionIsCheckpointLocked(options: {
    nodeId: string;
    nodes: Array<Pick<Node, "id" | "type" | "data">>;
    edges: Array<Pick<Edge, "source" | "target">>;
}): boolean {
    return isCanvasActionCheckpointLocked(options);
}
