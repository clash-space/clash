import { describe, expect, it, vi } from "vitest";

import { createDurableObjectReplicaPorts } from "./replica-ports";

function storageDouble() {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    put: vi.fn(async (entries: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(entries)) data.set(key, value);
    }),
    list: vi.fn(
      async ({ prefix }: { prefix: string }) =>
        new Map(
          [...data.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
    ),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    }),
    getAlarm: vi.fn(async () => alarm),
    setAlarm: vi.fn(async (value: number) => {
      alarm = value;
    }),
  } as unknown as DurableObjectStorage;
  return { data, storage };
}

describe("Durable Object replica ports", () => {
  it("atomically deduplicates event IDs while keeping a monotonic cursor", async () => {
    const { data, storage } = storageDouble();
    const ports = createDurableObjectReplicaPorts(storage);

    const first = await ports.eventLog.append({
      id: "batch-1",
      update: new Uint8Array([1, 2, 3]),
    });
    const duplicate = await ports.eventLog.append({
      id: "batch-1",
      update: new Uint8Array([9]),
    });

    expect(first).toMatchObject({ appended: true, event: { cursor: 1 } });
    expect(duplicate).toMatchObject({
      appended: false,
      event: { cursor: 1, id: "batch-1" },
    });
    expect(data.get("loro:next-seq")).toBe(1);
    expect(
      new Uint8Array(data.get("loro:u:000000000000") as ArrayBuffer),
    ).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("persists checkpoint bytes before event garbage collection", async () => {
    const { data, storage } = storageDouble();
    const ports = createDurableObjectReplicaPorts(storage);
    await ports.eventLog.append({
      id: "batch-1",
      update: new Uint8Array([1]),
    });

    await ports.checkpoints.save({ cursor: 1, data: new Uint8Array([7, 8]) });
    await ports.eventLog.truncateThrough(1);

    expect(new Uint8Array(data.get("loro:snapshot") as ArrayBuffer)).toEqual(
      new Uint8Array([7, 8]),
    );
    expect(data.get("loro:snapshot-seq")).toBe(1);
    expect(data.has("loro:u:000000000000")).toBe(false);
    expect(data.has("loro:event-id:batch-1")).toBe(false);
  });
});
