import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import { processPendingNodes } from "./NodeProcessor";
import type { Env } from "../config";

// Mock asset-store
vi.mock("../services/asset-store", () => ({
  createAsset: vi.fn().mockResolvedValue(undefined),
  updateAssetStatus: vi.fn().mockResolvedValue(undefined),
}));

// Mock describe service
vi.mock("../services/describe", () => ({
  generateDescription: vi.fn().mockResolvedValue("A test description"),
}));

import { createAsset, updateAssetStatus } from "../services/asset-store";

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
  const stubFetch = vi.fn().mockResolvedValue(new Response("ok"));
  return {
    GOOGLE_API_KEY: "test-key",
    GOOGLE_AI_STUDIO_BASE_URL: "",
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
    GENERATION: {
      idFromName: vi.fn().mockReturnValue("do-id"),
      get: vi.fn().mockReturnValue({ fetch: stubFetch }),
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

    expect(createAsset).not.toHaveBeenCalled();
    expect(triggerPolling).not.toHaveBeenCalled();
  });

  it("skips nodes that already have pendingTask", async () => {
    const doc = makeDoc([
      {
        id: "n1",
        type: "image",
        data: { status: "generating", pendingTask: "task-123" },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(createAsset).not.toHaveBeenCalled();
  });

  it("skips nodes with taskState=submitted", async () => {
    const doc = makeDoc([
      {
        id: "n1",
        type: "image",
        data: { status: "generating", taskState: "submitted" },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(createAsset).not.toHaveBeenCalled();
  });

  it("skips nodes with taskState=completed", async () => {
    const doc = makeDoc([
      {
        id: "n1",
        type: "image",
        data: { status: "generating", taskState: "completed" },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(createAsset).not.toHaveBeenCalled();
  });

  it("submits image_gen task for generating image without src", async () => {
    const doc = makeDoc([
      {
        id: "node-img-1",
        type: "image",
        data: { status: "generating", prompt: "a cat" },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    // createAsset should have been called
    expect(createAsset).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        id: "node-img-1",
        type: "image",
        status: "pending",
        projectId: "proj-1",
      })
    );

    // GENERATION DO should have been called
    const genStub = (env.GENERATION.get as any).mock.results[0].value;
    expect(genStub.fetch).toHaveBeenCalled();

    // triggerPolling should have been called
    expect(triggerPolling).toHaveBeenCalled();

    // Node should have pendingTask set
    const nodesMap = doc.getMap("nodes");
    const nodeData = nodesMap.get("node-img-1") as any;
    expect(nodeData.data.pendingTask).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(nodeData.data.taskState).toBe("completed");
  });

  it("submits video_gen task for generating video without src", async () => {
    const doc = makeDoc([
      {
        id: "node-vid-1",
        type: "video",
        data: {
          status: "generating",
          prompt: "a sunset",
          referenceImageUrls: ["projects/proj-1/assets/ref.png"],
        },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(createAsset).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        id: "node-vid-1",
        type: "video",
        status: "pending",
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

    // Should have created a desc asset
    expect(createAsset).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        id: "desc-node-img-2",
        type: "image",
        status: "processing",
      })
    );
  });

  it("when DO delegation fails, task_id is still returned and node gets pendingTask", async () => {
    const doc = makeDoc([
      {
        id: "node-fail",
        type: "image",
        data: { status: "generating", prompt: "test" },
      },
    ]);

    // Make GENERATION DO throw — but delegateToGeneration catches internally
    const env = makeEnv({
      GENERATION: {
        idFromName: vi.fn().mockReturnValue("do-id"),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockRejectedValue(new Error("DO down")),
        }),
      } as any,
    });

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    // delegateToGeneration catches the error, so task_id is still returned
    // and the node gets pendingTask set (D1 status is updated to failed separately)
    const nodesMap = doc.getMap("nodes");
    const nodeData = nodesMap.get("node-fail") as any;
    expect(nodeData.data.pendingTask).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(nodeData.data.taskState).toBe("completed");
    // updateAssetStatus should have been called to mark failed in D1
    expect(updateAssetStatus).toHaveBeenCalledWith(
      env.DB,
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      expect.objectContaining({ status: "failed" })
    );
  });

  it("sets status=failed when createAsset itself throws", async () => {
    const doc = makeDoc([
      {
        id: "node-fail2",
        type: "image",
        data: { status: "generating", prompt: "test" },
      },
    ]);

    // Make createAsset throw
    (createAsset as any).mockRejectedValueOnce(new Error("DB error"));

    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    // submitTaskInternal catches the error and returns { error }
    // Node should be marked failed
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

    expect(createAsset).not.toHaveBeenCalled();
    expect(triggerPolling).not.toHaveBeenCalled();
  });

  it("skips video nodes with timelineDsl (client-side Remotion render)", async () => {
    const doc = makeDoc([
      {
        id: "n-timeline",
        type: "video",
        data: { status: "generating", timelineDsl: { tracks: [] } },
      },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(createAsset).not.toHaveBeenCalled();
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

    expect(createAsset).not.toHaveBeenCalled();
  });

  it("does not call triggerPolling when no tasks were submitted", async () => {
    const doc = makeDoc([
      { id: "n1", type: "image", data: { status: "completed", src: "x", description: "y" } },
    ]);
    const env = makeEnv();

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    expect(triggerPolling).not.toHaveBeenCalled();
  });

  it("video_gen without image reference returns error, node marked failed", async () => {
    const doc = makeDoc([
      {
        id: "node-vid-noimg",
        type: "video",
        data: { status: "generating", prompt: "test" },
      },
    ]);

    // R2 get returns null (no image available)
    const env = makeEnv({
      R2_BUCKET: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn(),
      } as any,
    });

    await processPendingNodes(doc, env, "proj-1", broadcast, triggerPolling);

    // The node should end up failed since no image was provided for video gen
    const nodesMap = doc.getMap("nodes");
    const nodeData = nodesMap.get("node-vid-noimg") as any;
    expect(nodeData.data.status).toBe("failed");
  });
});
