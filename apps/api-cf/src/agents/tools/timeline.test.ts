import { describe, it, expect, vi } from "vitest";
import { LoroDoc } from "loro-crdt";
import { createTimelineTools } from "./timeline";

const fakeContext = { toolCallId: "1", messages: [] as never[] };

const seedNode = (doc: LoroDoc, nodeId: string, data: Record<string, unknown> = {}) => {
  const nodes = doc.getMap("nodes");
  nodes.set(nodeId, { type: "videoEditor", data, position: { x: 0, y: 0 } });
};

describe("Timeline tools", () => {
  it("writes timelineDsl to node.data when not locked", async () => {
    const doc = new LoroDoc();
    seedNode(doc, "editor-1");
    const broadcast = vi.fn();
    const isNodeLocked = vi.fn().mockReturnValue(false);

    const tools = createTimelineTools(doc, broadcast, isNodeLocked);
    const dsl = { tracks: [{ id: "t1", name: "Track 1", items: [] }], fps: 30 };

    const result = await tools.timeline_editor.execute!(
      { node_id: "editor-1", timeline_dsl: dsl },
      fakeContext,
    );

    expect(result).toContain("Timeline updated");
    expect(isNodeLocked).toHaveBeenCalledWith("editor-1");
    expect(broadcast).toHaveBeenCalled();

    const stored = doc.getMap("nodes").get("editor-1") as Record<string, any>;
    expect(stored.data.timelineDsl).toEqual(dsl);
  });

  it("refuses and does not write when the node is locked", async () => {
    const doc = new LoroDoc();
    seedNode(doc, "editor-2", { timelineDsl: { tracks: [{ id: "t-old", name: "Old", items: [] }] } });
    const broadcast = vi.fn();
    const isNodeLocked = vi.fn().mockImplementation((id: string) => id === "editor-2");

    const tools = createTimelineTools(doc, broadcast, isNodeLocked);
    const dsl = { tracks: [{ id: "t-new", name: "New", items: [] }] };

    const result = await tools.timeline_editor.execute!(
      { node_id: "editor-2", timeline_dsl: dsl },
      fakeContext,
    );

    expect(result).toContain("currently editing");
    expect(broadcast).not.toHaveBeenCalled();

    const stored = doc.getMap("nodes").get("editor-2") as Record<string, any>;
    expect(stored.data.timelineDsl.tracks[0].id).toBe("t-old");
  });

  it("returns a clear error when the node does not exist", async () => {
    const doc = new LoroDoc();
    const broadcast = vi.fn();
    const isNodeLocked = vi.fn().mockReturnValue(false);

    const tools = createTimelineTools(doc, broadcast, isNodeLocked);
    const result = await tools.timeline_editor.execute!(
      { node_id: "missing", timeline_dsl: { tracks: [] } },
      fakeContext,
    );

    expect(result).toContain("not found");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("reports counts in the success message", async () => {
    const doc = new LoroDoc();
    seedNode(doc, "editor-3");
    const broadcast = vi.fn();
    const isNodeLocked = vi.fn().mockReturnValue(false);

    const tools = createTimelineTools(doc, broadcast, isNodeLocked);
    const dsl = {
      tracks: [
        { id: "t1", name: "A", items: [{ id: "i1" }, { id: "i2" }] },
        { id: "t2", name: "B", items: [{ id: "i3" }] },
      ],
    };

    const result = await tools.timeline_editor.execute!(
      { node_id: "editor-3", timeline_dsl: dsl },
      fakeContext,
    );

    expect(result).toContain("2 track(s), 3 item(s)");
  });
});

const seedNodeWithDsl = (doc: LoroDoc, nodeId: string, dsl: unknown) => {
  doc.getMap("nodes").set(nodeId, { type: "videoEditor", data: { timelineDsl: dsl }, position: { x: 0, y: 0 } });
};

describe("read_timeline / edit_timeline / write_timeline", () => {
  const baseDsl = {
    fps: 30,
    durationInFrames: 300,
    tracks: [
      {
        id: "video",
        name: "Main",
        items: [
          { id: "clip-A", type: "video", from: 0, durationInFrames: 150 },
          { id: "clip-B", type: "video", from: 150, durationInFrames: 150 },
        ],
      },
    ],
  };

  it("read_timeline returns YAML with a hash header", async () => {
    const doc = new LoroDoc();
    seedNodeWithDsl(doc, "editor-y", baseDsl);
    const tools = createTimelineTools(doc, vi.fn(), vi.fn().mockReturnValue(false));
    const result = (await tools.read_timeline.execute!({ node_id: "editor-y" }, fakeContext)) as string;
    expect(result.startsWith("# Hash: ")).toBe(true);
    expect(result).toContain("clip-A");
    expect(result).toContain("clip-B");
  });

  it("edit_timeline applies a unique-string replacement and updates the doc", async () => {
    const doc = new LoroDoc();
    seedNodeWithDsl(doc, "editor-y2", baseDsl);
    const isNodeLocked = vi.fn().mockReturnValue(false);
    const tools = createTimelineTools(doc, vi.fn(), isNodeLocked);

    const readResult = (await tools.read_timeline.execute!({ node_id: "editor-y2" }, fakeContext)) as string;
    const hash = readResult.match(/^# Hash: ([0-9a-f]+)/)?.[1];
    expect(hash).toBeTruthy();

    const result = (await tools.edit_timeline.execute!(
      {
        node_id: "editor-y2",
        read_hash: hash!,
        old_str: "      - id: clip-B\n        type: video\n        from: 150",
        new_str: "      - id: clip-B\n        type: video\n        from: 120",
      },
      fakeContext,
    )) as string;

    expect(result).toContain("Timeline updated");
    const stored = doc.getMap("nodes").get("editor-y2") as Record<string, any>;
    const items = stored.data.timelineDsl.tracks[0].items;
    expect(items[1].from).toBe(120);
  });

  it("edit_timeline rejects a stale read_hash", async () => {
    const doc = new LoroDoc();
    seedNodeWithDsl(doc, "editor-y3", baseDsl);
    const tools = createTimelineTools(doc, vi.fn(), vi.fn().mockReturnValue(false));
    const result = (await tools.edit_timeline.execute!(
      { node_id: "editor-y3", read_hash: "deadbeef", old_str: "x", new_str: "y" },
      fakeContext,
    )) as string;
    expect(result).toContain("Stale read");
  });

  it("edit_timeline refuses ambiguous (multi-match) old_str", async () => {
    const doc = new LoroDoc();
    seedNodeWithDsl(doc, "editor-y4", baseDsl);
    const tools = createTimelineTools(doc, vi.fn(), vi.fn().mockReturnValue(false));
    const readResult = (await tools.read_timeline.execute!({ node_id: "editor-y4" }, fakeContext)) as string;
    const hash = readResult.match(/^# Hash: ([0-9a-f]+)/)?.[1]!;
    const result = (await tools.edit_timeline.execute!(
      { node_id: "editor-y4", read_hash: hash, old_str: "type: video", new_str: "type: image" },
      fakeContext,
    )) as string;
    expect(result).toContain("multiple places");
  });

  it("edit_timeline honors the soft-lock", async () => {
    const doc = new LoroDoc();
    seedNodeWithDsl(doc, "editor-y5", baseDsl);
    const tools = createTimelineTools(doc, vi.fn(), () => true);
    const result = (await tools.edit_timeline.execute!(
      { node_id: "editor-y5", read_hash: "x", old_str: "x", new_str: "y" },
      fakeContext,
    )) as string;
    expect(result).toContain("currently editing");
  });

  it("write_timeline parses fresh YAML and replaces the DSL", async () => {
    const doc = new LoroDoc();
    seedNodeWithDsl(doc, "editor-y6", baseDsl);
    const tools = createTimelineTools(doc, vi.fn(), vi.fn().mockReturnValue(false));
    const yaml = `
fps: 30
durationInFrames: 90
tracks:
  - id: video
    name: Solo
    items:
      - id: clip-only
        type: video
        from: 0
        durationInFrames: 90
`;
    const result = (await tools.write_timeline.execute!(
      { node_id: "editor-y6", yaml },
      fakeContext,
    )) as string;
    expect(result).toContain("Timeline replaced");
    const stored = doc.getMap("nodes").get("editor-y6") as Record<string, any>;
    expect(stored.data.timelineDsl.tracks[0].items.map((i: any) => i.id)).toEqual(["clip-only"]);
  });

  it("write_timeline resolves relative references on input", async () => {
    const doc = new LoroDoc();
    seedNodeWithDsl(doc, "editor-y7", baseDsl);
    const tools = createTimelineTools(doc, vi.fn(), vi.fn().mockReturnValue(false));
    const yaml = `
tracks:
  - id: t
    items:
      - id: a
        type: video
        from: 0
        durationInFrames: 60
      - id: b
        type: video
        from: prev
        durationInFrames: 60
`;
    await tools.write_timeline.execute!({ node_id: "editor-y7", yaml }, fakeContext);
    const stored = doc.getMap("nodes").get("editor-y7") as Record<string, any>;
    const items = stored.data.timelineDsl.tracks[0].items;
    expect(items[1].from).toBe(60);
    expect(items[1].fromExpr).toBe("prev");
  });

  it("write_timeline honors the soft-lock", async () => {
    const doc = new LoroDoc();
    seedNodeWithDsl(doc, "editor-y8", baseDsl);
    const tools = createTimelineTools(doc, vi.fn(), () => true);
    const result = (await tools.write_timeline.execute!(
      { node_id: "editor-y8", yaml: "tracks: []\n" },
      fakeContext,
    )) as string;
    expect(result).toContain("currently editing");
    // DSL must not have been replaced
    const stored = doc.getMap("nodes").get("editor-y8") as Record<string, any>;
    expect(stored.data.timelineDsl.tracks).toHaveLength(1);
  });

  it("write_timeline rejects YAML missing tracks", async () => {
    const doc = new LoroDoc();
    seedNodeWithDsl(doc, "editor-y9", baseDsl);
    const tools = createTimelineTools(doc, vi.fn(), vi.fn().mockReturnValue(false));
    const result = (await tools.write_timeline.execute!(
      { node_id: "editor-y9", yaml: "fps: 30\n" },
      fakeContext,
    )) as string;
    expect(result).toContain("Parse error");
    expect(result).toContain("tracks");
    // Original DSL still there
    const stored = doc.getMap("nodes").get("editor-y9") as Record<string, any>;
    expect(stored.data.timelineDsl.tracks[0].items).toHaveLength(2);
  });

  it("write_timeline rejects malformed YAML", async () => {
    const doc = new LoroDoc();
    seedNodeWithDsl(doc, "editor-y10", baseDsl);
    const tools = createTimelineTools(doc, vi.fn(), vi.fn().mockReturnValue(false));
    const result = (await tools.write_timeline.execute!(
      { node_id: "editor-y10", yaml: "tracks:\n  - { unclosed" },
      fakeContext,
    )) as string;
    expect(result).toContain("Parse error");
  });

  it("read_timeline gives a helpful message when timelineDsl is missing", async () => {
    const doc = new LoroDoc();
    // Seed a node WITHOUT timelineDsl
    doc.getMap("nodes").set("editor-y11", { type: "videoEditor", data: {}, position: { x: 0, y: 0 } });
    const tools = createTimelineTools(doc, vi.fn(), vi.fn().mockReturnValue(false));
    const result = (await tools.read_timeline.execute!({ node_id: "editor-y11" }, fakeContext)) as string;
    expect(result).toContain("no timelineDsl");
  });

  it("read_timeline returns NOT-found message for unknown node", async () => {
    const doc = new LoroDoc();
    const tools = createTimelineTools(doc, vi.fn(), vi.fn().mockReturnValue(false));
    const result = (await tools.read_timeline.execute!({ node_id: "ghost" }, fakeContext)) as string;
    expect(result).toContain("not found");
  });

  it("edit_timeline preserves untouched tracks", async () => {
    const dsl = {
      fps: 30,
      tracks: [
        { id: "v", items: [{ id: "a", type: "video", from: 0, durationInFrames: 100 }] },
        { id: "audio", items: [{ id: "bgm", type: "audio", from: 0, durationInFrames: 100 }] },
      ],
    };
    const doc = new LoroDoc();
    seedNodeWithDsl(doc, "editor-y12", dsl);
    const tools = createTimelineTools(doc, vi.fn(), vi.fn().mockReturnValue(false));

    const readResult = (await tools.read_timeline.execute!({ node_id: "editor-y12" }, fakeContext)) as string;
    const hash = readResult.match(/^# Hash: ([0-9a-f]+)/)?.[1]!;

    await tools.edit_timeline.execute!(
      {
        node_id: "editor-y12",
        read_hash: hash,
        old_str: "      - id: a\n        type: video\n        from: 0\n        durationInFrames: 100",
        new_str: "      - id: a\n        type: video\n        from: 0\n        durationInFrames: 50",
      },
      fakeContext,
    );

    const stored = doc.getMap("nodes").get("editor-y12") as Record<string, any>;
    expect(stored.data.timelineDsl.tracks[0].items[0].durationInFrames).toBe(50);
    // The audio track should be untouched
    expect(stored.data.timelineDsl.tracks[1].items[0].id).toBe("bgm");
    expect(stored.data.timelineDsl.tracks[1].items[0].durationInFrames).toBe(100);
  });

  it("edit_timeline rolls back on parse failure (DSL not mutated)", async () => {
    const dsl = {
      fps: 30,
      tracks: [{ id: "v", items: [{ id: "a", type: "video", from: 0, durationInFrames: 100 }] }],
    };
    const doc = new LoroDoc();
    seedNodeWithDsl(doc, "editor-y13", dsl);
    const tools = createTimelineTools(doc, vi.fn(), vi.fn().mockReturnValue(false));

    const readResult = (await tools.read_timeline.execute!({ node_id: "editor-y13" }, fakeContext)) as string;
    const hash = readResult.match(/^# Hash: ([0-9a-f]+)/)?.[1]!;

    // Inject an unbalanced brace into the YAML — must round-trip-fail.
    const result = (await tools.edit_timeline.execute!(
      {
        node_id: "editor-y13",
        read_hash: hash,
        old_str: "tracks:",
        new_str: "tracks: { not-an-array",
      },
      fakeContext,
    )) as string;
    expect(result).toContain("failed to parse");

    const stored = doc.getMap("nodes").get("editor-y13") as Record<string, any>;
    expect(stored.data.timelineDsl.tracks[0].items[0].durationInFrames).toBe(100);
  });
});
