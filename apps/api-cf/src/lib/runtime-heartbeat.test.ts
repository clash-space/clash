import { describe, expect, it } from "vitest";
import { markRuntimeOnline } from "./runtime-heartbeat";

describe("markRuntimeOnline", () => {
  it("sets the runtime online and refreshes last_heartbeat", async () => {
    const calls: { sql?: string; bind?: unknown[]; ran?: boolean } = {};
    const db = {
      prepare(sql: string) {
        calls.sql = sql;
        return {
          bind(...values: unknown[]) {
            calls.bind = values;
            return {
              async run() {
                calls.ran = true;
              },
            };
          },
        };
      },
    };

    await markRuntimeOnline(db, "runtime-1", 1_780_382_000);

    expect(calls.sql).toContain("UPDATE runtime");
    expect(calls.sql).toContain("status = 'online'");
    expect(calls.sql).toContain("last_heartbeat = ?");
    expect(calls.bind).toEqual([1_780_382_000, "runtime-1"]);
    expect(calls.ran).toBe(true);
  });
});
