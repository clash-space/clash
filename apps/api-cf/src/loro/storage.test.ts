import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadSnapshot, saveSnapshot } from "./storage";

/**
 * Helper to create a mock DurableObjectStorage.
 */
function createMockStorage(data: Map<string, any> = new Map()) {
  const storage = {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    put: vi.fn(async (entries: Record<string, any>) => {
      for (const [k, v] of Object.entries(entries)) {
        data.set(k, v);
      }
    }),
  };
  return storage as any as DurableObjectStorage;
}

describe("storage", () => {
  describe("loadSnapshot", () => {
    it("returns Uint8Array when snapshot exists", async () => {
      const buf = new Uint8Array([1, 2, 3, 4, 5]).buffer;
      const storage = createMockStorage(new Map([["loro:snapshot", buf]]));

      const result = await loadSnapshot(storage);
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    });

    it("returns null when no snapshot exists", async () => {
      const storage = createMockStorage();

      const result = await loadSnapshot(storage);
      expect(result).toBeNull();
    });
  });

  describe("saveSnapshot", () => {
    it("saves snapshot and version to storage", async () => {
      const data = new Map();
      const storage = createMockStorage(data);
      const snapshot = new Uint8Array([10, 20, 30]);

      await saveSnapshot(storage, "proj-1", snapshot, "v1");

      expect((storage.put as any)).toHaveBeenCalledTimes(1);
      expect(data.get("loro:snapshot")).toBe(snapshot.buffer);
      expect(data.get("loro:version")).toBe("v1");
    });
  });

  describe("round-trip", () => {
    it("save → load returns same bytes", async () => {
      const data = new Map();
      const storage = createMockStorage(data);
      const original = new Uint8Array([10, 20, 30, 40, 50]);

      await saveSnapshot(storage, "proj-1", original, "v1");
      const loaded = await loadSnapshot(storage);

      expect(loaded).toEqual(original);
    });
  });
});
