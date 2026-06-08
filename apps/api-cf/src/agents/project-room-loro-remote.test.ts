import { describe, expect, it, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";

const mocks = vi.hoisted(() => ({
  processPendingNodes: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  DurableObject: class MockDurableObject {
    ctx: DurableObjectState;
    env: unknown;

    constructor(ctx: DurableObjectState, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

vi.mock("../loro/NodeProcessor", () => ({
  processPendingNodes: mocks.processPendingNodes,
  recoverOrphanedTasks: vi.fn(),
}));

vi.mock("../loro/TaskPolling", () => ({
  pollNodeTasks: vi.fn(),
}));

vi.mock("../lib/runtime-status", () => ({
  deriveRuntimeStatus: vi.fn(),
}));

vi.mock("../lib/runtime-heartbeat", () => ({
  markRuntimeOnline: vi.fn(),
}));

import { ProjectRoom } from "./project-room";

function createMockStorage(data: Map<string, any> = new Map()) {
  const storage = {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    put: vi.fn(async (entriesOrKey: Record<string, any> | string, value?: any) => {
      if (typeof entriesOrKey === "string") {
        data.set(entriesOrKey, value);
        return;
      }
      for (const [key, entryValue] of Object.entries(entriesOrKey)) {
        data.set(key, entryValue);
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
    setAlarm: vi.fn(async () => undefined),
  };
  return { storage: storage as any as DurableObjectStorage, data };
}

function createRoom() {
  const { storage, data } = createMockStorage();
  const ws = { send: vi.fn() };
  const ctx = {
    storage,
    getWebSockets: vi.fn(() => [ws]),
  } as any as DurableObjectState;
  const room = new ProjectRoom(ctx, { ENVIRONMENT: "development" } as any);
  return { room, data, ws };
}

describe("ProjectRoom Loro remote persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports remote updates, persists them, broadcasts them, and returns snapshots", async () => {
    const { room, data, ws } = createRoom();
    const source = new LoroDoc();
    const before = source.version();
    source.getMap("nodes").set("n1", {
      type: "text",
      data: { label: "Remote mirrored" },
      position: { x: 1, y: 2 },
    });
    const update = source.export({ mode: "update", from: before });

    const updateRes = await room.fetch(new Request("https://room/loro/project%2Fone/updates", {
      method: "POST",
      headers: {
        "x-internal-loro": "true",
        "x-loro-project-id": "project/one",
        "content-type": "application/octet-stream",
      },
      body: update,
    }));

    expect(updateRes.status).toBe(204);
    expect(data.get("projectId")).toBe("project/one");
    expect(data.get("loro:next-seq")).toBe(1);
    expect(new Uint8Array(data.get("loro:u:000000000000"))).toEqual(update);
    expect(ws.send).toHaveBeenCalledWith(update);
    expect(mocks.processPendingNodes).not.toHaveBeenCalled();

    const snapshotRes = await room.fetch(new Request("https://room/loro/project%2Fone/snapshot", {
      headers: {
        "x-internal-loro": "true",
        "x-loro-project-id": "project/one",
      },
    }));

    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.headers.get("content-type")).toBe("application/octet-stream");
    const mirrored = new LoroDoc();
    mirrored.import(new Uint8Array(await snapshotRes.arrayBuffer()));
    expect((mirrored.getMap("nodes").get("n1") as any).data.label).toBe("Remote mirrored");
  });

  it("rejects remote persistence requests without the internal header", async () => {
    const { room } = createRoom();

    const res = await room.fetch(new Request("https://room/loro/project/snapshot", {
      headers: { "x-loro-project-id": "project" },
    }));

    expect(res.status).toBe(403);
  });
});
