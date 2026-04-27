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
 *
 * CRITICAL: Loro returns a Uint8Array that is a *view* into a larger backing
 * buffer. Writing `snapshot.buffer` directly persists trailing junk past the
 * actual snapshot bytes — and on next load `new Uint8Array(arrayBuffer)` reads
 * the full corrupt buffer. Symptom: `RangeError: Invalid array buffer length`
 * inside `doc.export()` after the next restore. Always slice to a fresh buffer.
 */
export async function saveSnapshot(
  storage: DurableObjectStorage,
  projectId: string,
  snapshot: Uint8Array,
  version: string,
): Promise<void> {
  const exact =
    snapshot.byteOffset === 0 && snapshot.byteLength === snapshot.buffer.byteLength
      ? snapshot.buffer
      : snapshot.slice().buffer;
  await storage.put({
    [SNAPSHOT_KEY]: exact,
    [VERSION_KEY]: version,
  });
}
