/** D1 asset CRUD — raw SQL, no drizzle dependency. */

export interface AssetRecord {
  id: string;
  name: string;
  projectId: string;
  storageKey: string;
  url: string;
  type: string;
  status: string;
  taskId: string | null;
  metadata: string | null;
  description: string | null;
  createdAt: number | null;
}

export interface CreateAssetParams {
  id: string;
  name: string;
  projectId: string;
  storageKey: string;
  url: string;
  type: string;
  status: string;
  taskId: string;
  metadata?: string | null;
  description?: string | null;
}

export interface UpdateAssetParams {
  status: string;
  url?: string;
  storageKey?: string;
  description?: string | null;
  metadata?: string | null;
}

/** INSERT a new asset row. */
export async function createAsset(
  db: D1Database,
  params: CreateAssetParams
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT OR REPLACE INTO asset (id, name, project_id, storage_key, url, type, status, task_id, metadata, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      params.id,
      params.name,
      params.projectId,
      params.storageKey,
      params.url,
      params.type,
      params.status,
      params.taskId,
      params.metadata ?? null,
      params.description ?? null,
      now
    )
    .run();
}

/** UPDATE an asset's status (and optionally url/storageKey/description) by task_id. */
export async function updateAssetStatus(
  db: D1Database,
  taskId: string,
  params: UpdateAssetParams
): Promise<void> {
  const sets: string[] = ["status = ?"];
  const values: unknown[] = [params.status];

  if (params.url !== undefined) {
    sets.push("url = ?");
    values.push(params.url);
  }
  if (params.storageKey !== undefined) {
    sets.push("storage_key = ?");
    values.push(params.storageKey);
  }
  if (params.description !== undefined) {
    sets.push("description = ?");
    values.push(params.description);
  }
  if (params.metadata !== undefined) {
    sets.push("metadata = ?");
    values.push(params.metadata);
  }

  values.push(taskId);

  await db
    .prepare(`UPDATE asset SET ${sets.join(", ")} WHERE task_id = ?`)
    .bind(...values)
    .run();
}

/** SELECT an asset by task_id. Returns null if not found. */
export async function getAssetByTaskId(
  db: D1Database,
  taskId: string
): Promise<AssetRecord | null> {
  const result = await db
    .prepare(
      `SELECT id, name, project_id as projectId, storage_key as storageKey, url, type, status, task_id as taskId, metadata, description, created_at as createdAt
       FROM asset WHERE task_id = ?`
    )
    .bind(taskId)
    .first<AssetRecord>();

  return result ?? null;
}
