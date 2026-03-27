/**
 * Loro snapshot persistence via Durable Object storage.
 * Uses ctx.storage.put/get — no D1 tables needed.
 */

const SNAPSHOT_KEY = "loro:snapshot";
const VERSION_KEY = "loro:version";

/**
 * Load Loro snapshot from DO storage.
 */
export async function loadSnapshot(
  storage: DurableObjectStorage,
): Promise<Uint8Array | null> {
  const snapshot = await storage.get<ArrayBuffer>(SNAPSHOT_KEY);
  if (!snapshot) return null;
  return new Uint8Array(snapshot);
}

/**
 * Save Loro snapshot to DO storage.
 */
export async function saveSnapshot(
  storage: DurableObjectStorage,
  projectId: string,
  snapshot: Uint8Array,
  version: string,
): Promise<void> {
  await storage.put({
    [SNAPSHOT_KEY]: snapshot.buffer,
    [VERSION_KEY]: version,
  });
}
