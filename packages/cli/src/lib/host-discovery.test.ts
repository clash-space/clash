import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  LOCAL_HOST_PROTOCOL_VERSION,
  LOCAL_HOST_RECORD_SCHEMA_VERSION,
  type LocalHostDiscoveryRecord,
} from "@clash/shared-runtime";
import { getHostDiscoveryStatus, removeHostDiscovery } from "./host-discovery";

function record(): LocalHostDiscoveryRecord {
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
  };
}

it("reports an active local host from the discovery file", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "clash-cli-host-"));
  await writeFile(join(runDir, "host.json"), JSON.stringify(record()), "utf8");

  expect(await getHostDiscoveryStatus({ runDir })).toEqual({
    status: "active",
    record: record(),
  });
});

it("reports inactive when no local host record exists", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "clash-cli-host-"));

  expect(await getHostDiscoveryStatus({ runDir })).toEqual({
    status: "inactive",
  });
});

it("removes only the matching local host discovery record", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "clash-cli-host-"));
  await writeFile(join(runDir, "host.json"), JSON.stringify(record()), "utf8");

  await removeHostDiscovery("other-host", { runDir });
  expect((await getHostDiscoveryStatus({ runDir })).status).toBe("active");

  await removeHostDiscovery("host-1", { runDir });
  expect(await getHostDiscoveryStatus({ runDir })).toEqual({
    status: "inactive",
  });
});
