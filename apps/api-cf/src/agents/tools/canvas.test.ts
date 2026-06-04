import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import { createCanvasTools } from "./canvas";
import type { BroadcastFn } from "@clash/shared-types";

function makeDocWithNodes(
  nodes: Array<{
    id: string;
    type: string;
    data: Record<string, any>;
    parentId?: string;
    position?: { x: number; y: number };
  }>
): LoroDoc {
  const doc = new LoroDoc();
  const nodesMap = doc.getMap("nodes");
  for (const node of nodes) {
    nodesMap.set(node.id, {
      type: node.type,
      data: node.data,
      parentId: node.parentId,
      position: node.position ?? { x: 0, y: 0 },
    });
  }
  return doc;
}

describe("Canvas tools", () => {
  let doc: LoroDoc;
  let broadcast: BroadcastFn;
  let sendMessage: (msg: Record<string, unknown>) => void;
  let generateId: ReturnType<typeof vi.fn<() => string>>;
  let getWorkspaceGroupId: ReturnType<typeof vi.fn<() => string | undefined>>;
  let tools: ReturnType<typeof createCanvasTools>;

  beforeEach(() => {
    broadcast = vi.fn();
    sendMessage = vi.fn((_: Record<string, unknown>) => undefined);
    generateId = vi.fn<() => string>().mockReturnValueOnce("gen-id-1").mockReturnValueOnce("gen-id-2").mockReturnValue("gen-id-3");
    getWorkspaceGroupId = vi.fn<() => string | undefined>().mockReturnValue(undefined);

    doc = makeDocWithNodes([
      { id: "g1", type: "group", data: { label: "Workspace" } },
      {
        id: "n1",
        type: "text",
        data: { label: "Hello World", content: "Some content here" },
        parentId: "g1",
      },
      {
        id: "n2",
        type: "image",
        data: { label: "Cat photo", status: "completed", assetId: "asset-cat" },
        parentId: "g1",
      },
      {
        id: "n3",
        type: "action-badge",
        data: { label: "Generated Cat", status: "generating", assetId: "asset-1", actionType: "image-gen" },
        parentId: "g1",
      },
    ]);

    tools = createCanvasTools(doc, broadcast, sendMessage, generateId, getWorkspaceGroupId);
  });

  // ─── list_canvas_nodes ───

  describe("list_canvas_nodes", () => {
    it("returns tree view of all nodes", async () => {
      const result = await tools.list_canvas_nodes.execute!({}, { toolCallId: "1", messages: [] });
      expect(result).toContain("Canvas nodes (tree):");
      expect(result).toContain("g1 (group)");
      expect(result).toContain("n1 (text)");
      expect(result).toContain("n2 (image)");
    });

    it("filters by node_type", async () => {
      const result = await tools.list_canvas_nodes.execute!(
        { node_type: "text" },
        { toolCallId: "1", messages: [] }
      );
      expect(result).toContain("n1 (text)");
      expect(result).not.toContain("n2 (image)");
    });

    it("returns 'No nodes found.' for empty doc", async () => {
      const emptyDoc = new LoroDoc();
      const emptyTools = createCanvasTools(emptyDoc, broadcast, sendMessage, generateId, getWorkspaceGroupId);
      const result = await emptyTools.list_canvas_nodes.execute!({}, { toolCallId: "1", messages: [] });
      expect(result).toBe("No nodes found.");
    });
  });

  // ─── read_canvas_node ───

  describe("read_canvas_node", () => {
    it("returns node details for text node", async () => {
      const result = await tools.read_canvas_node.execute!(
        { node_id: "n1" },
        { toolCallId: "1", messages: [] }
      ) as string;
      expect(result).toContain("Hello World");
      expect(result).toContain("Some content here");
    });

    it("returns 'not found' for missing node", async () => {
      const result = await tools.read_canvas_node.execute!(
        { node_id: "nonexistent" },
        { toolCallId: "1", messages: [] }
      ) as string;
      expect(result).toContain("not found");
    });

    it("returns node metadata for image node without env (no vision)", async () => {
      const result = await tools.read_canvas_node.execute!(
        { node_id: "n2" },
        { toolCallId: "1", messages: [] }
      ) as string;
      expect(result).toContain("Cat photo");
      // No env → no D1 lookup → no R2 key resolved → no Storage key line, no marker.
      expect(result).not.toContain("Storage key");
      expect(result).not.toContain("CANVAS_IMAGE");
    });

    it("embeds CANVAS_IMAGE marker with base64 for image nodes", async () => {
      const fakeImageBytes = new TextEncoder().encode("fake-image-bytes").buffer;
      const mockR2Object = {
        httpMetadata: { contentType: "image/png" },
        arrayBuffer: () => Promise.resolve(fakeImageBytes),
      };
      const mockAssetRow = {
        id: "asset-cat",
        userId: "u-1",
        kind: "image",
        srcR2Key: "projects/p/assets/cat.png",
        coverR2Key: null,
        metadata: null,
        sources: null,
        sourceModel: null,
        sourcePrompt: null,
        sourceTaskId: null,
        bytes: 0,
        createdAt: 1,
        updatedAt: 1,
      };
      const first = vi.fn().mockResolvedValue({
        ...mockAssetRow,
        metadata: null,
      });
      const bind = vi.fn().mockReturnValue({ first });
      const prepare = vi.fn().mockReturnValue({ bind });

      const mockEnv = {
        DB: { prepare } as any,
        R2_BUCKET: { get: vi.fn().mockResolvedValue(mockR2Object) },
      } as any;

      const toolsWithR2 = createCanvasTools(
        doc, broadcast, sendMessage, generateId, getWorkspaceGroupId, mockEnv
      );

      const result = await toolsWithR2.read_canvas_node.execute!(
        { node_id: "n2" },
        { toolCallId: "1", messages: [] }
      ) as string;

      expect(result).toContain("Cat photo");
      expect(result).toMatch(/\[\[CANVAS_IMAGE:image\/png:[A-Za-z0-9+/=]+\]\]/);
      expect(bind).toHaveBeenCalledWith("asset-cat");
      expect(mockEnv.R2_BUCKET.get).toHaveBeenCalledWith("projects/p/assets/cat.png");
    });
  });

  // ─── create_canvas_node ───

  describe("create_canvas_node", () => {
    it("creates a text node", async () => {
      const result = await tools.create_canvas_node.execute!(
        {
          node_type: "text",
          label: "New Note",
          content: "Note content",
        },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("Created node gen-id-1");

      // Verify node was actually created in Loro
      const nodesMap = doc.getMap("nodes");
      const newNode = nodesMap.get("gen-id-1") as any;
      expect(newNode).toBeDefined();
      expect(newNode.type).toBe("text");
      expect(newNode.data.label).toBe("New Note");
    });

    it("uses workspace group as default parent", async () => {
      getWorkspaceGroupId.mockReturnValue("g1");

      const result = await tools.create_canvas_node.execute!(
        { node_type: "text", label: "Child Note" },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("Created node");

      // Node should have parentId = g1
      const nodesMap = doc.getMap("nodes");
      const newNode = nodesMap.get("gen-id-1") as any;
      expect(newNode.parentId).toBe("g1");
    });
  });

  // ─── create_generation_node ───

  describe("create_generation_node", () => {
    it("creates generation node with assetId", async () => {
      const result = await tools.create_generation_node.execute!(
        {
          node_type: "image_gen",
          label: "AI Cat",
          prompt: "A cute cat in watercolor style",
        },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("Created generation node gen-id-1");
      expect(result).toContain("assetId gen-id-2");
    });

    it("creates video_gen node", async () => {
      const result = await tools.create_generation_node.execute!(
        {
          node_type: "video_gen",
          label: "AI Video",
          prompt: "A cat playing with yarn",
        },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("Created generation node");
    });
  });

  // ─── wait_for_generation ───

  describe("wait_for_generation", () => {
    it("returns completed for finished generation", async () => {
      // Update node to completed status
      const nodesMap = doc.getMap("nodes");
      nodesMap.set("n3", {
        type: "action-badge",
        data: { label: "Generated Cat", status: "completed", assetId: "asset-1", actionType: "image-gen" },
        position: { x: 0, y: 0 },
      });

      const result = await tools.wait_for_generation.execute!(
        { node_id: "n3", timeout_seconds: 1 },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toBe("Task completed.");
    });

    it("returns 'not found' for missing node", async () => {
      const result = await tools.wait_for_generation.execute!(
        { node_id: "nonexistent", timeout_seconds: 1 },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("Node not found");
    });

    it("returns 'failed' for failed generation", async () => {
      const nodesMap = doc.getMap("nodes");
      nodesMap.set("n-fail", {
        type: "action-badge",
        data: { label: "Failed", status: "failed", error: "Out of credits", actionType: "image-gen" },
        position: { x: 0, y: 0 },
      });

      const result = await tools.wait_for_generation.execute!(
        { node_id: "n-fail", timeout_seconds: 1 },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("Task failed");
    });

    it("times out for still-generating node", async () => {
      // n3 is still generating
      const result = await tools.wait_for_generation.execute!(
        { node_id: "n3", timeout_seconds: 0.1 },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("still generating");
    });
  });

  // ─── rerun_generation_node ───

  describe("rerun_generation_node", () => {
    it("sends rerun_generation message with new assetId", async () => {
      const result = await tools.rerun_generation_node.execute!(
        { node_id: "n3" },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("Triggered regeneration for node n3");
      expect(result).toContain("new assetId");
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "rerun_generation",
          nodeId: "n3",
        })
      );
    });

    it("returns error for missing node", async () => {
      const result = await tools.rerun_generation_node.execute!(
        { node_id: "missing" },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("Error");
      expect(result).toContain("not found");
    });
  });

  // ─── search_canvas ───

  describe("search_canvas", () => {
    it("finds nodes by label", async () => {
      const result = await tools.search_canvas.execute!(
        { query: "Cat" },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("Search results for 'Cat':");
      expect(result).toContain("n2");
      expect(result).toContain("n3");
    });

    it("finds nodes by content", async () => {
      const result = await tools.search_canvas.execute!(
        { query: "Some content" },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("n1");
    });

    it("returns no results message for unmatched query", async () => {
      const result = await tools.search_canvas.execute!(
        { query: "xyz-no-match" },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("No nodes found matching");
    });

    it("filters by node_types", async () => {
      const result = await tools.search_canvas.execute!(
        { query: "Cat", node_types: ["image"] },
        { toolCallId: "1", messages: [] }
      );

      expect(result).toContain("n2");
      expect(result).not.toContain("n3"); // image_gen, not image
    });
  });
});
