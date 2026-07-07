import { appendFile, mkdir, open, readFile, rename, rm, truncate, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";

function exactBytes(view: Uint8Array): Uint8Array {
  return view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? view
    : new Uint8Array(view);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export class FileReplicaStore {
  private readonly writeQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly rootDir: string) {}

  async loadSnapshot(projectId: string): Promise<Uint8Array | null> {
    try {
      return exactBytes(await readFile(this.snapshotPath(projectId)));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async appendUpdate(projectId: string, update: Uint8Array): Promise<void> {
    await this.enqueueProjectWrite(projectId, async () => {
      await this.appendUpdateUnsafe(projectId, update);
    });
  }

  private async appendUpdateUnsafe(projectId: string, update: Uint8Array): Promise<void> {
    const logPath = this.updateLogPath(projectId);
    await mkdir(this.loroDir(projectId), { recursive: true });
    const updateBytes = exactBytes(update);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(updateBytes.byteLength, 0);
    await appendFile(logPath, Buffer.concat([header, Buffer.from(updateBytes)]));
  }

  async loadUpdateLog(projectId: string): Promise<Uint8Array[]> {
    const logPath = this.updateLogPath(projectId);
    let log: Buffer;
    try {
      log = await readFile(logPath);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    const updates: Uint8Array[] = [];
    let offset = 0;
    while (offset < log.byteLength) {
      if (offset + 4 > log.byteLength) {
        await truncate(logPath, offset);
        break;
      }

      const length = log.readUInt32BE(offset);
      const recordStart = offset + 4;
      const recordEnd = recordStart + length;
      if (recordEnd > log.byteLength) {
        await truncate(logPath, offset);
        break;
      }

      updates.push(exactBytes(log.subarray(recordStart, recordEnd)));
      offset = recordEnd;
    }

    return updates;
  }

  async saveSnapshotAtomic(projectId: string, snapshot: Uint8Array, _version?: unknown): Promise<void> {
    await this.enqueueProjectWrite(projectId, async () => {
      await this.saveSnapshotAtomicUnsafe(projectId, snapshot);
    });
  }

  async compactSnapshot(projectId: string, snapshot: Uint8Array, _version?: unknown): Promise<void> {
    await this.enqueueProjectWrite(projectId, async () => {
      await this.saveSnapshotAtomicUnsafe(projectId, snapshot);
      await this.truncateUpdateLog(projectId);
    });
  }

  async updateSnapshotAtomic<T>(
    projectId: string,
    mutate: (doc: LoroDoc) => Promise<{ value: T; save?: boolean }> | { value: T; save?: boolean },
  ): Promise<T> {
    return this.enqueueProjectWrite(projectId, async () => {
      const doc = await this.recoverUnsafe(projectId);
      const result = await mutate(doc);
      if (result.save !== false) {
        await this.saveSnapshotAtomicUnsafe(projectId, doc.export({ mode: "snapshot" }));
      }
      return result.value;
    });
  }

  private async saveSnapshotAtomicUnsafe(projectId: string, snapshot: Uint8Array): Promise<void> {
    const dir = this.loroDir(projectId);
    await mkdir(dir, { recursive: true });
    const finalPath = this.snapshotPath(projectId);
    const tempPath = join(dir, `snapshot.bin.${process.pid}.${randomUUID()}.tmp`);
    const snapshotBytes = exactBytes(snapshot);

    try {
      const handle = await open(tempPath, "wx");
      try {
        await handle.writeFile(snapshotBytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tempPath, finalPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  private async truncateUpdateLog(projectId: string): Promise<void> {
    const logPath = this.updateLogPath(projectId);
    await mkdir(this.loroDir(projectId), { recursive: true });
    try {
      await truncate(logPath, 0);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      await writeFile(logPath, new Uint8Array(), { mode: 0o600 });
    }
  }

  async recover(projectId: string): Promise<LoroDoc> {
    return this.recoverUnsafe(projectId);
  }

  async deleteReplica(projectId: string): Promise<void> {
    await this.enqueueProjectWrite(projectId, async () => {
      await rm(this.projectDir(projectId), { recursive: true, force: true });
    });
  }

  private async recoverUnsafe(projectId: string): Promise<LoroDoc> {
    const doc = new LoroDoc();
    const updates = await this.loadUpdateLog(projectId);
    const snapshot = await this.loadSnapshot(projectId);

    if (snapshot?.byteLength) doc.import(snapshot);
    for (const update of updates) {
      if (update.byteLength) doc.import(update);
    }
    return doc;
  }

  private loroDir(projectId: string): string {
    return join(this.projectDir(projectId), "loro");
  }

  private projectDir(projectId: string): string {
    return join(this.rootDir, encodeURIComponent(projectId));
  }

  private snapshotPath(projectId: string): string {
    return join(this.loroDir(projectId), "snapshot.bin");
  }

  private updateLogPath(projectId: string): string {
    return join(this.loroDir(projectId), "updates.log");
  }

  private async enqueueProjectWrite<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    const key = encodeURIComponent(projectId);
    const previous = this.writeQueues.get(key)?.catch(() => undefined) ?? Promise.resolve();
    const next = previous.then(task);
    const queued = next.then(() => undefined, () => undefined);
    this.writeQueues.set(key, queued);
    try {
      return await next;
    } finally {
      if (this.writeQueues.get(key) === queued) this.writeQueues.delete(key);
    }
  }
}
