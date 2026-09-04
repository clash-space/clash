import { createHash } from "node:crypto";
import type { CheckpointPort, EventLogPort } from "@clash/replica";

import { FileReplicaStore } from "./file-replica-store.js";

function updateId(update: Uint8Array): string {
  return `recovered:${createHash("sha256").update(update).digest("hex")}`;
}

/** Node/file adapters for the same replica core used by the hosted DO. */
export async function createFileReplicaPorts(
  store: FileReplicaStore,
  projectId: string,
): Promise<{
  eventLog: EventLogPort<Uint8Array>;
  checkpoints: CheckpointPort<Uint8Array>;
}> {
  const checkpointCursor = await store.loadReplicaCheckpointCursor(projectId);
  const recoveredUpdates = await store.loadUpdateLog(projectId);
  let nextCursor = checkpointCursor + recoveredUpdates.length;
  let events = recoveredUpdates.map((update, index) => ({
    id: updateId(update),
    cursor: checkpointCursor + index + 1,
    update,
  }));
  const byId = new Map(events.map((event) => [event.id, event]));

  const eventLog: EventLogPort<Uint8Array> = {
    async append(event) {
      const duplicate = byId.get(event.id);
      if (duplicate) return { appended: false, event: duplicate };
      await store.appendUpdate(projectId, event.update);
      const stored = { ...event, cursor: ++nextCursor };
      events.push(stored);
      byId.set(stored.id, stored);
      return { appended: true, event: stored };
    },
    async readAfter(cursor) {
      return events.filter((event) => event.cursor > cursor);
    },
    async truncateThrough(cursor) {
      const retained = events.filter((event) => event.cursor > cursor);
      // The local adapter currently has no lagging projections, so normal
      // checkpoints always consume the complete tail. Keeping extra records is
      // valid if a future caller requests a partial truncation.
      if (retained.length > 0) return;
      await store.truncateReplicaEventLog(projectId);
      events = retained;
      byId.clear();
    },
  };

  const checkpoints: CheckpointPort<Uint8Array> = {
    async load() {
      const snapshot = await store.loadSnapshot(projectId);
      if (!snapshot) return null;
      return { cursor: checkpointCursor, data: snapshot };
    },
    async save(checkpoint) {
      // Publishing the snapshot before its cursor makes an interrupted write
      // replay harmless CRDT updates rather than skip durable state.
      await store.saveSnapshotAtomic(projectId, checkpoint.data);
      await store.saveReplicaCheckpointCursor(projectId, checkpoint.cursor);
    },
  };

  return { eventLog, checkpoints };
}
