import type {
  CheckpointPort,
  EventLogPort,
  WorkSchedulerPort,
} from "@clash/replica";

import {
  CHECKPOINT_REQUESTED_SEQ_KEY,
  NEXT_SEQ_KEY,
  SNAPSHOT_KEY,
  SNAPSHOT_SEQ_KEY,
  UPDATE_PREFIX,
  seqKey,
} from "./storage";

const EVENT_ID_PREFIX = "loro:event-id:";
const EVENT_CURSOR_PREFIX = "loro:event-cursor:";
const PROJECTION_WORK_PREFIX = "loro:projection-requested:";
const SEQ_PAD = 12;

function eventCursorKey(cursor: number): string {
  return EVENT_CURSOR_PREFIX + String(cursor).padStart(SEQ_PAD, "0");
}

function eventIdKey(id: string): string {
  if (!id || id.length > 256)
    throw new TypeError("Replica event ID is invalid");
  return EVENT_ID_PREFIX + encodeURIComponent(id);
}

function exactBuffer(view: Uint8Array): ArrayBuffer {
  return view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? (view.buffer as ArrayBuffer)
    : view.slice().buffer;
}

export interface DurableObjectReplicaPorts {
  eventLog: EventLogPort<Uint8Array>;
  checkpoints: CheckpointPort<Uint8Array>;
  scheduler: WorkSchedulerPort;
}

export function createDurableObjectReplicaPorts(
  storage: DurableObjectStorage,
  options: { schedule?: (scheduledTime: number) => Promise<void> } = {},
): DurableObjectReplicaPorts {
  const eventLog: EventLogPort<Uint8Array> = {
    async append(event) {
      const idKey = eventIdKey(event.id);
      const existingCursor = await storage.get<number>(idKey);
      if (existingCursor != null) {
        const persisted = await storage.get<ArrayBuffer>(
          seqKey(existingCursor - 1),
        );
        return {
          appended: false,
          event: {
            id: event.id,
            cursor: existingCursor,
            update: persisted ? new Uint8Array(persisted) : event.update,
          },
        };
      }

      const seq = (await storage.get<number>(NEXT_SEQ_KEY)) ?? 0;
      const cursor = seq + 1;
      await storage.put({
        [seqKey(seq)]: exactBuffer(event.update),
        [NEXT_SEQ_KEY]: cursor,
        [idKey]: cursor,
        [eventCursorKey(cursor)]: event.id,
      });
      return {
        appended: true,
        event: { ...event, cursor },
      };
    },

    async readAfter(cursor) {
      const updates = await storage.list<ArrayBuffer>({
        prefix: UPDATE_PREFIX,
      });
      const events = [];
      for (const [key, value] of updates) {
        const seq = Number(key.slice(UPDATE_PREFIX.length));
        const eventCursor = seq + 1;
        if (!Number.isFinite(seq) || eventCursor <= cursor) continue;
        const id =
          (await storage.get<string>(eventCursorKey(eventCursor))) ??
          `legacy:${eventCursor}`;
        events.push({
          id,
          cursor: eventCursor,
          update: new Uint8Array(value),
        });
      }
      return events.sort((left, right) => left.cursor - right.cursor);
    },

    async truncateThrough(cursor) {
      if (cursor <= 0) return;
      const [updates, cursorIds, eventIds] = await Promise.all([
        storage.list<ArrayBuffer>({ prefix: UPDATE_PREFIX }),
        storage.list<string>({ prefix: EVENT_CURSOR_PREFIX }),
        storage.list<number>({ prefix: EVENT_ID_PREFIX }),
      ]);
      const keys = new Set<string>();
      for (const key of updates.keys()) {
        const seq = Number(key.slice(UPDATE_PREFIX.length));
        if (Number.isFinite(seq) && seq + 1 <= cursor) keys.add(key);
      }
      for (const key of cursorIds.keys()) {
        const eventCursor = Number(key.slice(EVENT_CURSOR_PREFIX.length));
        if (Number.isFinite(eventCursor) && eventCursor <= cursor)
          keys.add(key);
      }
      for (const [key, eventCursor] of eventIds) {
        if (eventCursor <= cursor) keys.add(key);
      }
      if (keys.size > 0) await storage.delete([...keys]);
    },
  };

  const checkpoints: CheckpointPort<Uint8Array> = {
    async load() {
      const snapshot = await storage.get<ArrayBuffer>(SNAPSHOT_KEY);
      if (!snapshot) return null;
      return {
        cursor: (await storage.get<number>(SNAPSHOT_SEQ_KEY)) ?? 0,
        data: new Uint8Array(snapshot),
      };
    },
    async save(checkpoint) {
      await storage.put({
        [SNAPSHOT_KEY]: exactBuffer(checkpoint.data),
        [SNAPSHOT_SEQ_KEY]: checkpoint.cursor,
      });
    },
  };

  const scheduler: WorkSchedulerPort = {
    async request(work) {
      const key =
        work.kind === "checkpoint"
          ? CHECKPOINT_REQUESTED_SEQ_KEY
          : `${PROJECTION_WORK_PREFIX}${encodeURIComponent(work.name)}`;
      const current = await storage.get<number>(key);
      if (current == null || work.throughCursor > current) {
        await storage.put({ [key]: work.throughCursor });
      }
      await options.schedule?.(Date.now());
    },
  };

  return { eventLog, checkpoints, scheduler };
}
