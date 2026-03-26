import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import { hasPendingTasks, pollNodeTasks } from "./TaskPolling";
import type { Env } from "../config";

// Mock asset-store
vi.mock("../services/asset-store", () => ({
  getAssetByTaskId: vi.fn(),
}));

import { getAssetByTaskId } from "../services/asset-store";

function makeDocWithNodes(
  nodes: Array<{ id: string; type: string; data: Record<string, any> }>
): LoroDoc {
  const doc = new LoroDoc();
  const nodesMap = doc.getMap("nodes");
  for (const node of nodes) {
    nodesMap.set(node.id, {
      type: node.type,
      data: node.data,
      position: { x: 0, y: 0 },
    });
  }
  return doc;
}

function makeEnv(): Env {
  return {
    GOOGLE_API_KEY: "",
    KLING_ACCESS_KEY: "",
    KLING_SECRET_KEY: "",
    R2_BUCKET: {} as any,
    R2_PUBLIC_URL: "",
    ENVIRONMENT: "production",
    ROOM: {} as any,
    SUPERVISOR: {} as any,
    GENERATION: {} as any,
    DB: {} as any,
  };
}

describe("TaskPolling", () => {
  const broadcast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── hasPendingTasks (existing tests) ───

  describe("hasPendingTasks", () => {
    it("returns false for empty doc", () => {
      const doc = new LoroDoc();
      expect(hasPendingTasks(doc)).toBe(false);
    });

    it("returns false when no nodes have pendingTask", () => {
      const doc = makeDocWithNodes([
        { id: "n1", type: "image", data: { status: "completed", src: "url" } },
        { id: "n2", type: "text", data: { label: "hello" } },
      ]);

      expect(hasPendingTasks(doc)).toBe(false);
    });

    it("returns true when a node has pendingTask", () => {
      const doc = makeDocWithNodes([
        { id: "n1", type: "image", data: { status: "generating", pendingTask: "task-123" } },
      ]);

      expect(hasPendingTasks(doc)).toBe(true);
    });

    it("returns true when any node has pendingTask among many", () => {
      const doc = makeDocWithNodes([
        { id: "n1", type: "text", data: { label: "a" } },
        { id: "n2", type: "image", data: { status: "completed" } },
        { id: "n3", type: "video", data: { status: "generating", pendingTask: "task-456" } },
      ]);

      expect(hasPendingTasks(doc)).toBe(true);
    });
  });

  // ─── pollNodeTasks ───

  describe("pollNodeTasks", () => {
    it("returns false when no nodes have pendingTask", async () => {
      const doc = makeDocWithNodes([
        { id: "n1", type: "image", data: { status: "completed", src: "url" } },
      ]);
      const env = makeEnv();

      const result = await pollNodeTasks(doc, env, "proj-1", broadcast);
      expect(result).toBe(false);
    });

    it("skips taskState=submitted but returns true (still pending)", async () => {
      const doc = makeDocWithNodes([
        {
          id: "n1",
          type: "image",
          data: { status: "generating", pendingTask: "task-1", taskState: "submitted" },
        },
      ]);
      const env = makeEnv();

      const result = await pollNodeTasks(doc, env, "proj-1", broadcast);
      expect(result).toBe(true);
      // getAssetByTaskId should NOT have been called (skipped)
      expect(getAssetByTaskId).not.toHaveBeenCalled();
    });

    it("task completed with result_url → updates src + status=completed", async () => {
      const doc = makeDocWithNodes([
        {
          id: "n1",
          type: "image",
          data: { status: "generating", pendingTask: "task-1", taskState: "completed" },
        },
      ]);
      const env = makeEnv();

      (getAssetByTaskId as any).mockResolvedValue({
        status: "completed",
        url: "https://r2.example.com/image.png",
        description: null,
        metadata: null,
      });

      const result = await pollNodeTasks(doc, env, "proj-1", broadcast);
      expect(result).toBe(false);

      // Node should be updated
      const nodesMap = doc.getMap("nodes");
      const nodeData = nodesMap.get("n1") as any;
      expect(nodeData.data.src).toBe("https://r2.example.com/image.png");
      expect(nodeData.data.status).toBe("completed");
      // Loro stores undefined as null
      expect(nodeData.data.pendingTask).toBeNull();
      expect(nodeData.data.taskState).toBeNull();
    });

    it("task completed with description → updates description + status=fin", async () => {
      const doc = makeDocWithNodes([
        {
          id: "n1",
          type: "image",
          data: { status: "completed", src: "img.png", pendingTask: "task-desc", taskState: "completed" },
        },
      ]);
      const env = makeEnv();

      (getAssetByTaskId as any).mockResolvedValue({
        status: "completed",
        url: "", // empty url means no result_url
        description: "A beautiful sunset",
        metadata: null,
      });

      const result = await pollNodeTasks(doc, env, "proj-1", broadcast);
      expect(result).toBe(false);

      const nodesMap = doc.getMap("nodes");
      const nodeData = nodesMap.get("n1") as any;
      expect(nodeData.data.description).toBe("A beautiful sunset");
      expect(nodeData.data.status).toBe("fin");
    });

    it("task completed with cover_url → updates coverUrl", async () => {
      const doc = makeDocWithNodes([
        {
          id: "n1",
          type: "video",
          data: { status: "generating", pendingTask: "task-vid", taskState: "completed" },
        },
      ]);
      const env = makeEnv();

      (getAssetByTaskId as any).mockResolvedValue({
        status: "completed",
        url: "https://r2.example.com/video.mp4",
        description: null,
        metadata: JSON.stringify({ cover_url: "https://r2.example.com/cover.jpg" }),
      });

      const result = await pollNodeTasks(doc, env, "proj-1", broadcast);
      expect(result).toBe(false);

      const nodesMap = doc.getMap("nodes");
      const nodeData = nodesMap.get("n1") as any;
      expect(nodeData.data.coverUrl).toBe("https://r2.example.com/cover.jpg");
      expect(nodeData.data.src).toBe("https://r2.example.com/video.mp4");
      expect(nodeData.data.status).toBe("completed");
    });

    it("task failed (main gen) → status=failed", async () => {
      const doc = makeDocWithNodes([
        {
          id: "n1",
          type: "image",
          data: { status: "generating", pendingTask: "task-fail", taskState: "completed" },
        },
      ]);
      const env = makeEnv();

      (getAssetByTaskId as any).mockResolvedValue({
        status: "failed",
        url: "",
        description: null,
        metadata: JSON.stringify({ error: "Generation failed" }),
      });

      const result = await pollNodeTasks(doc, env, "proj-1", broadcast);
      expect(result).toBe(false);

      const nodesMap = doc.getMap("nodes");
      const nodeData = nodesMap.get("n1") as any;
      expect(nodeData.data.status).toBe("failed");
      expect(nodeData.data.error).toBe("Generation failed");
      expect(nodeData.data.pendingTask).toBeNull();
    });

    it("task failed (auxiliary, node already completed) → preserves status", async () => {
      const doc = makeDocWithNodes([
        {
          id: "n1",
          type: "image",
          data: {
            status: "completed",
            src: "img.png",
            pendingTask: "task-desc-fail",
            taskState: "completed",
          },
        },
      ]);
      const env = makeEnv();

      (getAssetByTaskId as any).mockResolvedValue({
        status: "failed",
        url: "",
        description: null,
        metadata: JSON.stringify({ error: "Desc failed" }),
      });

      const result = await pollNodeTasks(doc, env, "proj-1", broadcast);
      expect(result).toBe(false);

      const nodesMap = doc.getMap("nodes");
      const nodeData = nodesMap.get("n1") as any;
      // Status should NOT change to failed — preserved from before
      expect(nodeData.data.status).toBe("completed");
      expect(nodeData.data.pendingTask).toBeNull();
      expect(nodeData.data.description).toBe("Description generation failed");
    });

    it("task pending (not in D1 yet) → returns true", async () => {
      const doc = makeDocWithNodes([
        {
          id: "n1",
          type: "image",
          data: { status: "generating", pendingTask: "task-new", taskState: "completed" },
        },
      ]);
      const env = makeEnv();

      // getAssetByTaskId returns null → status='pending'
      (getAssetByTaskId as any).mockResolvedValue(null);

      const result = await pollNodeTasks(doc, env, "proj-1", broadcast);
      expect(result).toBe(true);
    });

    it("task processing (still running) → returns true", async () => {
      const doc = makeDocWithNodes([
        {
          id: "n1",
          type: "image",
          data: { status: "generating", pendingTask: "task-proc", taskState: "completed" },
        },
      ]);
      const env = makeEnv();

      (getAssetByTaskId as any).mockResolvedValue({
        status: "processing",
        url: "",
        description: null,
        metadata: null,
      });

      const result = await pollNodeTasks(doc, env, "proj-1", broadcast);
      expect(result).toBe(true);
    });

    it("multiple nodes: some completed, some pending → returns true", async () => {
      const doc = makeDocWithNodes([
        {
          id: "n1",
          type: "image",
          data: { status: "generating", pendingTask: "task-done", taskState: "completed" },
        },
        {
          id: "n2",
          type: "video",
          data: { status: "generating", pendingTask: "task-pending", taskState: "completed" },
        },
      ]);
      const env = makeEnv();

      (getAssetByTaskId as any)
        .mockResolvedValueOnce({
          status: "completed",
          url: "https://r2.example.com/img.png",
          description: null,
          metadata: null,
        })
        .mockResolvedValueOnce(null); // pending

      const result = await pollNodeTasks(doc, env, "proj-1", broadcast);
      expect(result).toBe(true);

      // First node should be completed
      const nodesMap = doc.getMap("nodes");
      const n1Data = nodesMap.get("n1") as any;
      expect(n1Data.data.status).toBe("completed");
    });

    it("broadcast is called when node is updated", async () => {
      const doc = makeDocWithNodes([
        {
          id: "n1",
          type: "image",
          data: { status: "generating", pendingTask: "task-bc", taskState: "completed" },
        },
      ]);
      const env = makeEnv();

      (getAssetByTaskId as any).mockResolvedValue({
        status: "completed",
        url: "https://r2.example.com/img.png",
        description: null,
        metadata: null,
      });

      await pollNodeTasks(doc, env, "proj-1", broadcast);
      expect(broadcast).toHaveBeenCalled();
    });
  });
});
