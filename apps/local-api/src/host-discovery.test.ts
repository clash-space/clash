import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOCAL_HOST_PROTOCOL_VERSION,
  LOCAL_HOST_RECORD_SCHEMA_VERSION,
  type LocalHostDiscoveryRecord,
} from "@clash/shared-runtime";
import {
  createHostDiscoveryRecord,
  getDefaultHostDiscoveryRunDir,
  getHostDiscoveryPath,
  readHostDiscovery,
  removeHostDiscovery,
  writeHostDiscovery,
} from "./host-discovery";

function activeRecord(overrides: Partial<LocalHostDiscoveryRecord> = {}): LocalHostDiscoveryRecord {
  return {
    schemaVersion: LOCAL_HOST_RECORD_SCHEMA_VERSION,
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    dataSchemaVersion: 1,
    hostId: "host-1",
    endpoint: "http://127.0.0.1:49321",
    pid: process.pid,
    launchMode: "desktop",
    startedBy: "desktop",
    ownerClientId: "desktop-1",
    startedAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("local host discovery file", () => {
  it("publishes the host-owned agent CLI path for external clients", () => {
    const create = createHostDiscoveryRecord as unknown as (
      input: Record<string, unknown>
    ) => Record<string, unknown>;
    const record = create({
      endpoint: "http://127.0.0.1:49321",
      launchMode: "desktop",
      startedBy: "desktop",
      agentCliPath: "/tmp/clash-host/agent-bin/clash",
    });

    expect(record.agentCliPath).toBe("/tmp/clash-host/agent-bin/clash");
  });

  it("honors CLASH_HOME for the default run directory", async () => {
    const previous = process.env.CLASH_HOME;
    const clashHome = await mkdtemp(join(tmpdir(), "clash-home-"));
    process.env.CLASH_HOME = clashHome;
    try {
      expect(getDefaultHostDiscoveryRunDir()).toBe(join(clashHome, "run"));
    } finally {
      if (previous === undefined) {
        delete process.env.CLASH_HOME;
      } else {
        process.env.CLASH_HOME = previous;
      }
    }
  });

  it("writes and reads a valid discovery record", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "clash-host-discovery-"));
    const record = activeRecord();

    await writeHostDiscovery(record, { runDir });

    await expect(readHostDiscovery({ runDir })).resolves.toEqual({
      status: "active",
      record,
    });
    expect((await stat(getHostDiscoveryPath(runDir))).mode & 0o777).toBe(0o600);
  });

  it("removes only a matching host id", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "clash-host-discovery-"));
    const record = activeRecord({ hostId: "new-host" });
    await writeHostDiscovery(record, { runDir });

    await removeHostDiscovery("old-host", { runDir });
    await expect(readHostDiscovery({ runDir })).resolves.toEqual({
      status: "active",
      record,
    });

    await removeHostDiscovery("new-host", { runDir });
    await expect(readHostDiscovery({ runDir })).resolves.toEqual({ status: "inactive" });
  });

  it("cleans up stale records when the pid is gone", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "clash-host-discovery-"));
    await writeFile(
      getHostDiscoveryPath(runDir),
      JSON.stringify(activeRecord({ pid: 987654321 }), null, 2),
      "utf8",
    );

    await expect(readHostDiscovery({
      runDir,
      pidExists: () => false,
    })).resolves.toEqual({ status: "inactive" });

    await expect(readFile(getHostDiscoveryPath(runDir), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
