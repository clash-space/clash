import { generateSemanticId } from "./utils/semanticId.js";

type OutputKind = "image" | "video";

interface CanvasNodeLike {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  parentId?: string;
  width?: number;
  height?: number;
}

interface CanvasActionWriter {
  createLinkedNode(input: {
    nodeId: string;
    nodeType: string;
    data: Record<string, unknown>;
    parentId: string | null;
    sourceNodeId: string;
    edgeId?: string;
    edgeType?: string;
  }): unknown;
  updateNode(
    nodeId: string,
    patch: {
      data?: Record<string, unknown>;
      position?: { x: number; y: number };
    },
  ): unknown;
}

export interface CanvasAssetActionLifecycle {
  nodeId: string;
  pending(): void;
  complete(assetId: string): void;
  fail(error: unknown): void;
}

export async function beginCanvasAssetAction(input: {
  actionRunId: string;
  actionId: "image-editor" | "video-clipper";
  outputKind: OutputKind;
  sourceNodeId: string;
  parentId?: string;
  projectId: string;
  nodes: CanvasNodeLike[];
  writer: CanvasActionWriter;
  createNodeId?: (projectId: string) => Promise<string>;
}): Promise<CanvasAssetActionLifecycle> {
  const nodeId = await (input.createNodeId ?? generateSemanticId)(
    input.projectId,
  );
  const source = input.nodes.find((node) => node.id === input.sourceNodeId);
  const parentId = input.parentId ?? source?.parentId;
  const label =
    input.outputKind === "video"
      ? "Edited Video"
      : input.actionId === "video-clipper"
        ? "Screenshot"
        : "Edited Image";
  const baseData = {
    label,
    status: "pending",
    actionType: input.actionId,
    taskId: input.actionRunId,
    sourceNodeId: input.sourceNodeId,
  };
  const created = input.writer.createLinkedNode({
    nodeId,
    nodeType: input.outputKind,
    data: baseData,
    parentId: parentId ?? null,
    sourceNodeId: input.sourceNodeId,
    edgeId: `${input.sourceNodeId}-${nodeId}`,
    edgeType: "default",
  });
  if (!created) throw new Error("Could not create the pending Asset output.");

  return {
    nodeId,
    pending() {
      input.writer.updateNode(nodeId, {
        data: {
          ...baseData,
          status: "pending",
        },
      });
    },
    complete(assetId) {
      input.writer.updateNode(nodeId, {
        data: {
          ...baseData,
          status: "completed",
          assetId,
        },
      });
    },
    fail(error) {
      input.writer.updateNode(nodeId, {
        data: {
          ...baseData,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        },
      });
    },
  };
}
