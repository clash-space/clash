import { describe, it, expect, vi } from "vitest";
import { LoroDoc } from "loro-crdt";
import {
  appendUpdate,
  compactToSnapshot,
  loadDocState,
  wipeDocState,
} from "./storage";

function createMockStorage(data: Map<string, any> = new Map()) {
  const storage = {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    put: vi.fn(async (entries: Record<string, any>) => {
      for (const [key, value] of Object.entries(entries)) {
        data.set(key, value);
      }
    }),
    list: vi.fn(async (opts?: { prefix?: string }) => {
      const prefix = opts?.prefix ?? "";
      return new Map(
        [...data.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    }),
    delete: vi.fn(async (keyOrKeys: string | string[]) => {
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
      for (const key of keys) data.delete(key);
    }),
  };
  return { storage: storage as any as DurableObjectStorage, data };
}

describe("storage", () => {
  it("loads an empty doc state when no snapshot or updates exist", async () => {
    const { storage } = createMockStorage();

    const state = await loadDocState(storage);

    expect(state.nextSeq).toBe(0);
    expect(state.snapshotSeq).toBe(0);
    expect([...state.doc.getMap("nodes").entries()]).toEqual([]);
  });

  it("appends exact update bytes and advances next sequence", async () => {
    const { storage, data } = createMockStorage();
    const arena = new Uint8Array([0, 1, 2, 3, 4]);
    const view = arena.subarray(1, 4);

    await appendUpdate(storage, 7, view);

    expect(new Uint8Array(data.get("loro:u:000000000007"))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(data.get("loro:next-seq")).toBe(8);
  });

  it("replays appended updates when loading doc state", async () => {
    const source = new LoroDoc();
    const versionBefore = source.version();
    source.getMap("nodes").set("n1", {
      type: "text",
      data: { label: "Loaded" },
      position: { x: 1, y: 2 },
    });
    const update = source.export({ mode: "update", from: versionBefore });
    const { storage } = createMockStorage();

    await appendUpdate(storage, 0, update);
    const state = await loadDocState(storage);

    expect(state.nextSeq).toBe(1);
    expect((state.doc.getMap("nodes").get("n1") as any).data.label).toBe("Loaded");
  });

  it("compacts to a snapshot and deletes only older updates", async () => {
    const doc = new LoroDoc();
    doc.getMap("nodes").set("n1", {
      type: "text",
      data: { label: "Snap" },
      position: { x: 0, y: 0 },
    });
    const { storage, data } = createMockStorage(
      new Map<string, any>([
        ["loro:u:000000000000", new Uint8Array([1]).buffer],
        ["loro:u:000000000001", new Uint8Array([2]).buffer],
        ["loro:u:000000000002", new Uint8Array([3]).buffer],
      ]),
    );

    await compactToSnapshot(storage, doc, 2);

    expect(data.get("loro:snapshot")).toBeInstanceOf(ArrayBuffer);
    expect(data.get("loro:snapshot-seq")).toBe(2);
    expect(data.has("loro:u:000000000000")).toBe(false);
    expect(data.has("loro:u:000000000001")).toBe(false);
    expect(data.has("loro:u:000000000002")).toBe(true);
  });

  it("wipes snapshot, sequence, version, and update log keys", async () => {
    const { storage, data } = createMockStorage(
      new Map<string, any>([
        ["loro:snapshot", new ArrayBuffer(1)],
        ["loro:snapshot-seq", 1],
        ["loro:next-seq", 2],
        ["loro:version", "legacy"],
        ["loro:u:000000000000", new ArrayBuffer(1)],
      ]),
    );

    await wipeDocState(storage);

    expect([...data.keys()]).toEqual([]);
  });
});
