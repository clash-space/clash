import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { ReplicaEngine } from "@clash/replica";
import { LoroStateAdapter } from "@clash/replica/loro";

import { FileReplicaStore } from "./file-replica-store.js";
import { createFileReplicaPorts } from "./replica-ports.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("file replica ports", () => {
  it("reopens from a checkpoint and preserves a monotonic event cursor", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-file-replica-"));
    roots.push(root);
    const store = new FileReplicaStore(root);
    const projectId = "project/portable-core";
    const source = new LoroDoc();
    source.getMap("nodes").set("one", { label: "One" });
    source.commit();

    const first = await ReplicaEngine.open({
      adapter: new LoroStateAdapter(),
      ...(await createFileReplicaPorts(store, projectId)),
    });
    const accepted = await first.submit({
      id: "event-one",
      update: source.export({ mode: "snapshot" }),
    });
    await first.checkpoint();

    const reopened = await ReplicaEngine.open({
      adapter: new LoroStateAdapter(),
      ...(await createFileReplicaPorts(store, projectId)),
    });
    const secondSource = new LoroDoc();
    secondSource.getMap("nodes").set("two", { label: "Two" });
    secondSource.commit();
    const second = await reopened.submit({
      id: "event-two",
      update: secondSource.export({ mode: "snapshot" }),
    });

    expect(reopened.read((doc) => doc.getMap("nodes").get("one"))).toEqual({
      label: "One",
    });
    expect(second.event.cursor).toBeGreaterThan(accepted.event.cursor);
  });
});
