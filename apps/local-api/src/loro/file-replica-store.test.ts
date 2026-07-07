import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileReplicaStore } from "./file-replica-store";

let rootDir = "";

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "clash-file-replica-store-"));
});

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

function projectDir(projectId: string): string {
  return join(rootDir, encodeURIComponent(projectId), "loro");
}

function lengthPrefix(length: number): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(length, 0);
  return header;
}

describe("FileReplicaStore", () => {
  it("stores exact snapshot bytes and appends exact update records under the encoded project path", async () => {
    const store = new FileReplicaStore(rootDir);
    const projectId = "project/with spaces";
    const doc = new LoroDoc();
    doc.getMap("nodes").set("from-snapshot", { type: "text", data: { label: "Snapshot" } });
    const snapshotArena = new Uint8Array([0, ...doc.export({ mode: "snapshot" }), 255]);
    const snapshot = snapshotArena.subarray(1, snapshotArena.byteLength - 1);

    const versionBefore = doc.version();
    doc.getMap("nodes").set("from-update", { type: "text", data: { label: "Update" } });
    const updateArena = new Uint8Array([9, ...doc.export({ mode: "update", from: versionBefore }), 8]);
    const update = updateArena.subarray(1, updateArena.byteLength - 1);

    await store.saveSnapshotAtomic(projectId, snapshot);
    await store.appendUpdate(projectId, update);

    const loadedSnapshot = await store.loadSnapshot(projectId);
    expect(loadedSnapshot).not.toBeNull();
    expect(Array.from(loadedSnapshot!)).toEqual(Array.from(snapshot));
    const updates = await store.loadUpdateLog(projectId);
    expect(updates).toHaveLength(1);
    expect(Array.from(updates[0])).toEqual(Array.from(update));

    const persistedSnapshot = await readFile(join(projectDir(projectId), "snapshot.bin"));
    const persistedLog = await readFile(join(projectDir(projectId), "updates.log"));
    expect(Array.from(persistedSnapshot)).toEqual(Array.from(snapshot));
    expect(Array.from(persistedLog.subarray(0, 4))).toEqual(Array.from(lengthPrefix(update.byteLength)));
    expect(Array.from(persistedLog.subarray(4))).toEqual(Array.from(update));
  });

  it("recovers a LoroDoc from snapshot plus update log in append order", async () => {
    const store = new FileReplicaStore(rootDir);
    const projectId = "project/recover";
    const doc = new LoroDoc();
    doc.getMap("nodes").set("base", { type: "text", data: { label: "Base" } });
    await store.saveSnapshotAtomic(projectId, doc.export({ mode: "snapshot" }));

    const beforeFirst = doc.version();
    doc.getMap("nodes").set("first", { type: "text", data: { label: "First" } });
    await store.appendUpdate(projectId, doc.export({ mode: "update", from: beforeFirst }));

    const beforeSecond = doc.version();
    doc.getMap("nodes").set("second", { type: "text", data: { label: "Second" } });
    await store.appendUpdate(projectId, doc.export({ mode: "update", from: beforeSecond }));

    const recovered = await store.recover(projectId);
    const nodes = recovered.getMap("nodes");
    expect((nodes.get("base") as any).data.label).toBe("Base");
    expect((nodes.get("first") as any).data.label).toBe("First");
    expect((nodes.get("second") as any).data.label).toBe("Second");
  });

  it("serializes recover-mutate-save updates for a project", async () => {
    const store = new FileReplicaStore(rootDir);
    const projectId = "project/serialized-update";
    const doc = new LoroDoc();
    doc.getMap("nodes").set("base", { type: "text", data: { label: "Base" } });
    await store.saveSnapshotAtomic(projectId, doc.export({ mode: "snapshot" }));

    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstDidStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const order: string[] = [];

    const first = store.updateSnapshotAtomic(projectId, async (current) => {
      order.push("first");
      firstStarted();
      expect((current.getMap("nodes").get("base") as any).data.label).toBe("Base");
      await firstCanFinish;
      current.getMap("nodes").set("first", { type: "text", data: { label: "First" } });
      return { value: "first" };
    });
    await firstDidStart;

    const second = store.updateSnapshotAtomic(projectId, async (current) => {
      order.push("second");
      expect((current.getMap("nodes").get("first") as any).data.label).toBe("First");
      current.getMap("nodes").set("second", { type: "text", data: { label: "Second" } });
      return { value: "second" };
    });

    await Promise.resolve();
    expect(order).toEqual(["first"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(order).toEqual(["first", "second"]);

    const recovered = await store.recover(projectId);
    expect((recovered.getMap("nodes").get("first") as any).data.label).toBe("First");
    expect((recovered.getMap("nodes").get("second") as any).data.label).toBe("Second");
  });

  it("can skip writing a snapshot from a serialized update", async () => {
    const store = new FileReplicaStore(rootDir);
    const projectId = "project/no-save";

    const value = await store.updateSnapshotAtomic(projectId, (current) => {
      current.getMap("nodes").set("rejected", { type: "text", data: { label: "Rejected" } });
      return { value: "rejected", save: false };
    });

    expect(value).toBe("rejected");
    expect(await store.loadSnapshot(projectId)).toBeNull();
    expect((await store.recover(projectId)).getMap("nodes").get("rejected")).toBeUndefined();
  });

  it("ignores and truncates an incomplete trailing update record during recovery", async () => {
    const store = new FileReplicaStore(rootDir);
    const projectId = "project/partial-log";
    const doc = new LoroDoc();
    const before = doc.version();
    doc.getMap("nodes").set("valid", { type: "text", data: { label: "Valid" } });
    const update = doc.export({ mode: "update", from: before });
    await store.appendUpdate(projectId, update);

    const logPath = join(projectDir(projectId), "updates.log");
    await appendFile(logPath, Buffer.concat([lengthPrefix(update.byteLength + 99), Buffer.from([1, 2, 3])]));

    const recovered = await store.recover(projectId);
    expect((recovered.getMap("nodes").get("valid") as any).data.label).toBe("Valid");

    const expectedSize = 4 + update.byteLength;
    expect((await stat(logPath)).size).toBe(expectedSize);
    const updates = await store.loadUpdateLog(projectId);
    expect(updates).toHaveLength(1);
  });

  it("writes snapshots through a temp file rename without leaving temp files behind", async () => {
    const store = new FileReplicaStore(rootDir);
    const projectId = "project/atomic";
    const doc = new LoroDoc();
    doc.getMap("nodes").set("old", { type: "text", data: { label: "Old" } });
    await store.saveSnapshotAtomic(projectId, doc.export({ mode: "snapshot" }));

    const replacement = new LoroDoc();
    replacement.getMap("nodes").set("new", { type: "text", data: { label: "New" } });
    const snapshot = replacement.export({ mode: "snapshot" });
    await store.saveSnapshotAtomic(projectId, snapshot, replacement.version());

    expect(Array.from(await readFile(join(projectDir(projectId), "snapshot.bin")))).toEqual(Array.from(snapshot));
    expect(await readdir(projectDir(projectId))).toEqual(expect.not.arrayContaining([
      expect.stringMatching(/snapshot\.bin\..+\.tmp/),
    ]));
  });

  it("compacts imported update records after writing a covering snapshot", async () => {
    const store = new FileReplicaStore(rootDir);
    const projectId = "project/compact";
    const doc = new LoroDoc();
    doc.getMap("nodes").set("base", { type: "text", data: { label: "Base" } });
    await store.saveSnapshotAtomic(projectId, doc.export({ mode: "snapshot" }));

    const beforeFirst = doc.version();
    doc.getMap("nodes").set("first", { type: "text", data: { label: "First" } });
    await store.appendUpdate(projectId, doc.export({ mode: "update", from: beforeFirst }));

    const beforeSecond = doc.version();
    doc.getMap("nodes").set("second", { type: "text", data: { label: "Second" } });
    await store.appendUpdate(projectId, doc.export({ mode: "update", from: beforeSecond }));

    expect(await store.loadUpdateLog(projectId)).toHaveLength(2);

    await store.compactSnapshot(projectId, doc.export({ mode: "snapshot" }), doc.version());

    expect(await store.loadUpdateLog(projectId)).toHaveLength(0);
    expect((await stat(join(projectDir(projectId), "updates.log"))).size).toBe(0);

    const recovered = await store.recover(projectId);
    expect((recovered.getMap("nodes").get("first") as any).data.label).toBe("First");
    expect((recovered.getMap("nodes").get("second") as any).data.label).toBe("Second");
  });

  it("ignores legacy flat snapshots because v0 only supports the new replica store", async () => {
    const projectId = "project/legacy";
    const legacyDir = join(rootDir, "legacy-loro");
    const store = new FileReplicaStore(join(rootDir, "projects"));
    const legacyDoc = new LoroDoc();
    legacyDoc.getMap("nodes").set("legacy", { type: "text", data: { label: "Legacy" } });
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, `${encodeURIComponent(projectId)}.bin`), legacyDoc.export({ mode: "snapshot" }));

    const recovered = await store.recover(projectId);
    expect(recovered.getMap("nodes").get("legacy")).toBeUndefined();

    const newDoc = new LoroDoc();
    newDoc.getMap("nodes").set("new", { type: "text", data: { label: "New" } });
    await store.saveSnapshotAtomic(projectId, newDoc.export({ mode: "snapshot" }));

    const recoveredAfterNewState = await store.recover(projectId);
    expect(recoveredAfterNewState.getMap("nodes").get("legacy")).toBeUndefined();
    expect((recoveredAfterNewState.getMap("nodes").get("new") as any).data.label).toBe("New");
  });
});
