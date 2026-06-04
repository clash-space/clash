export interface RuntimeHeartbeatDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
    };
  };
}

export async function markRuntimeOnline(
  db: RuntimeHeartbeatDb,
  runtimeId: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<void> {
  await db
    .prepare("UPDATE runtime SET status = 'online', last_heartbeat = ? WHERE id = ?")
    .bind(nowSec, runtimeId)
    .run();
}
