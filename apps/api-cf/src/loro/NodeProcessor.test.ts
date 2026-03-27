import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import { processPendingNodes } from "./NodeProcessor";
import type { Env } from "../config";

// Mock describe service
vi.mock("../services/describe", () => ({
  generateDescription: vi.fn().mockResolvedValue("A test description"),
}));

// Mock NodeUpdater to avoid Loro proxy spread issues
vi.mock("./NodeUpdater", () => ({
  updateNodeData: vi.fn((doc, nodeId, updates, broadcast) => {
    const nodesMap = doc.getMap("nodes");
    const existing = nodesMap.get(nodeId) as any;
    if (!existing) return;
    const newData = { ...existing.data, ...updates };
    nodesMap.set(nodeId, { ...existing, data: newData });
    broadcast(new Uint8Array(0));
  }),
  appendNodeLog: vi.fn(),
  clearNodeLog: vi.fn(),
}));

function makeDoc(
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

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GOOGLE_API_KEY: "test-key",
    GOOGLE_AI_STUDIO_BASE_URL: "",
    CF_AIG_TOKEN: "",
    KLING_ACCESS_KEY: "",
    KLING_SECRET_KEY: "",
    R2_BUCKET: {
      get: vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
      }),
      put: vi.fn(),
    } as any,
    R2_PUBLIC_URL: "https://r2.example.com",
    ENVIRONMENT: "production",
    ROOM: {} as any,
    SUPERVISOR: {} as any,
    GENERATION_WORKFLOW: {
      create: vi.fn().mockResolvedValue({ id: "wf-id" }),
    } as any,
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run: vi.fn().mockResolvedValue({}),
          all: vi.fn().mockResolvedValue({ results: [] }),
          first: vi.fn().mockResolvedValue(null),
        }),
      }),
    } as any,
    ...overrides,
  };
}

describe("NodeProcessor - processPendingNodes", () => {
  const broadcast = vi.fn();
  const triggerPolling = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock crypto.randomUUID
    vi.spyOn(crypto, "randomUUID").mockReturnValue("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips non-generation node types (text)", async () => {
    const doc = makeDoc([
      { id: "n1", type: "text", data: { label: "hello" } },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(env.GENERATION_WORKFLOW.create).not.toHaveBeenCalled();
    expect(triggerPolling).not.toHaveBeenCalled();
  });

  it("skips nodes that already have pendingTask", async () => {
    const doc = makeDoc([
      {
        id: "n1",
        type: "image",
        data: { status: "pending", pendingTask: "task-123" },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(env.GENERATION_WORKFLOW.create).not.toHaveBeenCalled();
  });

  it("submits image_gen task for pending image without src", async () => {
    const doc = makeDoc([
      {
        id: "node-img-1",
        type: "image",
        data: { status: "pending", prompt: "a cat" },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    // GENERATION_WORKFLOW.create should have been called with correct params
    expect(env.GENERATION_WORKFLOW.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        params: expect.objectContaining({
          type: "image_gen",
          nodeId: "node-img-1",
          projectId: "proj-1",
        }),
      })
    );

    // GENERATION_WORKFLOW should have been called
    expect(env.GENERATION_WORKFLOW.create).toHaveBeenCalled();

    // triggerPolling should have been called
    expect(triggerPolling).toHaveBeenCalled();

    // Node should have pendingTask set + status changed to generating
    const nodesMap = doc.getMap("nodes");
    const nodeData = nodesMap.get("node-img-1") as any;
    expect(nodeData.data.pendingTask).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(nodeData.data.status).toBe("generating");
  });

  it("submits video_gen task for pending video without src", async () => {
    const doc = makeDoc([
      {
        id: "node-vid-1",
        type: "video",
        data: {
          status: "pending",
          prompt: "a sunset",
          referenceImageUrls: ["projects/proj-1/assets/ref.png"],
        },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(env.GENERATION_WORKFLOW.create).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          type: "video_gen",
          nodeId: "node-vid-1",
        }),
      })
    );
    expect(triggerPolling).toHaveBeenCalled();
  });

  it("submits description task for completed asset without description", async () => {
    const doc = makeDoc([
      {
        id: "node-img-2",
        type: "image",
        data: { status: "completed", src: "projects/proj-1/assets/img.png" },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    // Should have submitted desc workflow
    expect(env.GENERATION_WORKFLOW.create).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          type: "image_desc",
          nodeId: "node-img-2",
        }),
      })
    );
  });

  it("when Workflow submission fails, pendingTask is cleared and node marked failed", async () => {
    const doc = makeDoc([
      {
        id: "node-fail",
        type: "image",
        data: { status: "pending", prompt: "test" },
      },
    ]);

    // Make GENERATION_WORKFLOW.create throw
    const env = makeEnv({
      GENERATION_WORKFLOW: {
        create: vi.fn().mockRejectedValue(new Error("Workflow down")),
      } as any,
    });

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    // On failure, pendingTask is cleared and status set to failed
    const nodesMap = doc.getMap("nodes");
    const nodeData = nodesMap.get("node-fail") as any;
    expect(nodeData.data.status).toBe("failed");
    expect(nodeData.data.pendingTask).toBeNull();
  });

  it("sets status=failed when workflow.create throws", async () => {
    const doc = makeDoc([
      {
        id: "node-fail2",
        type: "image",
        data: { status: "pending", prompt: "test" },
      },
    ]);

    const env = makeEnv({
      GENERATION_WORKFLOW: {
        create: vi.fn().mockRejectedValue(new Error("Workflow error")),
      } as any,
    });

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    const nodesMap = doc.getMap("nodes");
    const nodeData = nodesMap.get("node-fail2") as any;
    expect(nodeData.data.status).toBe("failed");
  });

  it("skips video_render nodes", async () => {
    const doc = makeDoc([
      {
        id: "n-render",
        type: "video_render",
        data: { status: "generating" },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(env.GENERATION_WORKFLOW.create).not.toHaveBeenCalled();
    expect(triggerPolling).not.toHaveBeenCalled();
  });

  it("skips video nodes with timelineDsl (client-side Remotion render)", async () => {
    const doc = makeDoc([
      {
        id: "n-timeline",
        type: "video",
        data: { status: "pending", timelineDsl: { tracks: [] } },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(env.GENERATION_WORKFLOW.create).not.toHaveBeenCalled();
  });

  it("does not submit description for audio nodes", async () => {
    const doc = makeDoc([
      {
        id: "n-audio",
        type: "audio",
        data: { status: "completed", src: "audio.mp3" },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(env.GENERATION_WORKFLOW.create).not.toHaveBeenCalled();
  });

  it("does not call triggerPolling when no tasks were submitted", async () => {
    const doc = makeDoc([
      { id: "n1", type: "image", data: { status: "completed", src: "x", description: "y" } },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(triggerPolling).not.toHaveBeenCalled();
  });

  // ─── Optimistic Lock Tests ───

  it("pendingTask is set before workflow.create is called (optimistic lock)", async () => {
    const doc = makeDoc([
      {
        id: "node-lock",
        type: "image",
        data: { status: "pending", prompt: "test" },
      },
    ]);

    let pendingTaskAtCreateTime: string | null = null;
    let statusAtCreateTime: string | null = null;
    const env = makeEnv({
      GENERATION_WORKFLOW: {
        create: vi.fn().mockImplementation(async () => {
          // Check node state at the time workflow.create is called
          const nodesMap = doc.getMap("nodes");
          const nodeData = nodesMap.get("node-lock") as any;
          pendingTaskAtCreateTime = nodeData.data.pendingTask;
          statusAtCreateTime = nodeData.data.status;
          return { id: "wf-id" };
        }),
      } as any,
    });

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    // pendingTask and status should have been set BEFORE workflow.create was called
    expect(pendingTaskAtCreateTime).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(statusAtCreateTime).toBe("generating");
  });

  it("second invocation skips node that already has pendingTask (dedup)", async () => {
    const doc = makeDoc([
      {
        id: "node-dedup",
        type: "image",
        data: { status: "pending", prompt: "test", pendingTask: "existing-task" },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    // Should not submit a new task
    expect(env.GENERATION_WORKFLOW.create).not.toHaveBeenCalled();
    expect(env.GENERATION_WORKFLOW.create).not.toHaveBeenCalled();
  });

  it("completed node with description is not re-processed", async () => {
    const doc = makeDoc([
      {
        id: "node-done",
        type: "image",
        data: { status: "completed", src: "img.png", description: "already described" },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(env.GENERATION_WORKFLOW.create).not.toHaveBeenCalled();
    expect(triggerPolling).not.toHaveBeenCalled();
  });

  it("video_gen with model requiring reference image but none provided → node marked failed", async () => {
    const doc = makeDoc([
      {
        id: "node-vid-noimg",
        type: "video",
        data: { status: "pending", prompt: "test", modelId: "sora-2-image-to-video" },
      },
    ]);

    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    // The node should end up failed since no reference image was provided for a model that requires one
    const nodesMap = doc.getMap("nodes");
    const nodeData = nodesMap.get("node-vid-noimg") as any;
    expect(nodeData.data.status).toBe("failed");
  });
});
