import type { Env, SnapshotData } from './types';
import type { LoroDoc } from 'loro-crdt';

/**
 * Load Loro snapshot from D1 database
 */
/**
 * Load Loro snapshot from D1 database
 */
export async function loadSnapshot(
  db: D1Database,
  projectId: string
): Promise<Uint8Array | null> {
  let lastError: any = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[loadSnapshot] Retrying... (attempt ${attempt + 1}/${maxRetries + 1}) for project ${projectId}`);
        // Small backoff
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }

      // Try loading chunks first
      const chunks = await db
        .prepare(
          'SELECT chunk_data FROM loro_snapshot_chunks WHERE project_id = ? ORDER BY chunk_index ASC'
        )
        .bind(projectId)
        .all<{ chunk_data: number[] }>();

      if (chunks.results && chunks.results.length > 0) {
        // Reassemble chunks
        const totalLength = chunks.results.reduce((acc, chunk) => acc + chunk.chunk_data.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks.results) {
          const chunkData = new Uint8Array(chunk.chunk_data);
          result.set(chunkData, offset);
          offset += chunkData.length;
        }
        return result;
      }

      // Fallback to legacy single-blob storage
      const result = await db
        .prepare('SELECT snapshot FROM loro_snapshots WHERE project_id = ?')
        .bind(projectId)
        .first<{ snapshot: ArrayBuffer }>();

      if (!result?.snapshot) {
        return null;
      }

      return new Uint8Array(result.snapshot);
    } catch (error) {
      lastError = error;
      console.warn(`[loadSnapshot] Attempt ${attempt + 1} failed for project ${projectId}:`, error);
      
      // If it's a D1 internal error, we retry. Otherwise, we might want to stop early.
      const errorMsg = String(error);
      if (!errorMsg.includes('internal error') && !errorMsg.includes('D1_ERROR')) {
        break; 
      }
    }
  }

  console.error(`[loadSnapshot] All attempts failed for project ${projectId}. Final error:`, lastError);
  return null;
}

/**
 * Save Loro snapshot to D1 database
 */
export async function saveSnapshot(
  db: D1Database,
  projectId: string,
  snapshot: Uint8Array,
  version: string
): Promise<void> {
  let lastError: any = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[saveSnapshot] Retrying... (attempt ${attempt + 1}/${maxRetries + 1}) for project ${projectId}`);
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }

      const CHUNK_SIZE = 500 * 1024; // 500KB chunks to stay well under 1MB limit
      const totalChunks = Math.ceil(snapshot.length / CHUNK_SIZE);

      // 1. Save metadata to main table
      await db
        .prepare(
          `INSERT OR REPLACE INTO loro_snapshots
           (project_id, snapshot, version, updated_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(projectId, new Uint8Array(0), version, Date.now())
        .run();

      // 2. Prepare statements for atomic execution
      const statements = [];

      // Delete existing chunks first
      statements.push(
        db.prepare('DELETE FROM loro_snapshot_chunks WHERE project_id = ?').bind(projectId)
      );

      // Add insert statements for new chunks
      if (totalChunks > 0) {
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, snapshot.length);
          const chunk = snapshot.slice(start, end);
          
          statements.push(
            db.prepare(
              `INSERT INTO loro_snapshot_chunks (project_id, chunk_index, chunk_data)
               VALUES (?, ?, ?)`
            ).bind(projectId, i, chunk)
          );
        }
      }
        
      // Execute all in a single batch transaction
      await db.batch(statements);

      console.log(`Saved snapshot for project ${projectId}, version: ${version} (${totalChunks} chunks)`);
      return; // Success
    } catch (error) {
      lastError = error;
      const errorMsg = String(error);
      console.warn(`[saveSnapshot] Attempt ${attempt + 1} failed for project ${projectId}:`, error);
      
      // If it's a D1 internal error, we retry. 
      if (!errorMsg.includes('internal error') && !errorMsg.includes('D1_ERROR')) {
        break; 
      }
    }
  }

  const finalErrorMsg = String(lastError);
  if (finalErrorMsg.includes('Failed to parse body as JSON')) {
    console.error(`[saveSnapshot] 🚨 D1 API Error: Could not parse response as JSON. 
This usually means your Wrangler session is expired or your proxy settings are interfering with Cloudflare API calls.
Try running: pnpm wrangler login
Check your HTTP_PROXY env var if using a proxy.`);
  }

  console.error(`[saveSnapshot] All attempts failed for project ${projectId}. Final error:`, lastError);
  throw lastError;
}

/**
 * Initialize database schema if needed
 * This should be run via migrations, but keeping it here for reference
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS loro_snapshots (
  project_id TEXT PRIMARY KEY,
  snapshot BLOB NOT NULL,
  version TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_loro_snapshots_updated_at
ON loro_snapshots(updated_at);
`;
