import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  LOCAL_HOST_PROTOCOL_VERSION,
  LOCAL_HOST_RECORD_SCHEMA_VERSION,
  type LocalHostDiscoveryRecord,
} from "@clash/shared-runtime";
import { runHostStatus } from "./host";

function record(): LocalHostDiscoveryRecord {
  return {
    schemaVersion: LOCAL_HOST_RECORD_SCHEMA_VERSION,
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    dataSchemaVersion: 1,
    hostId: "host-status-1",
    endpoint: "http://127.0.0.1:49321",
    pid: process.pid,
    launchMode: "desktop",
    startedBy: "desktop",
    ownerClientId: "desktop-1",
    startedAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
}

it("host status emits stable active JSON", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "clash-host-status-"));
  await writeFile(join(runDir, "host.json"), JSON.stringify(record()), "utf8");
  const lines: string[] = [];

  const output = await runHostStatus({
    json: true,
    runDir,
    stdout: (line) => lines.push(line),
  });

  expect(output).toEqual({
    status: "active",
    profile: "prod",
    endpoint: "http://127.0.0.1:49321",
    launchMode: "desktop",
    pid: process.pid,
    hostId: "host-status-1",
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    dataSchemaVersion: 1,
  });
  expect(JSON.parse(lines.join("\n"))).toEqual(output);
});

it("host status emits stable inactive JSON", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "clash-host-status-"));
  const lines: string[] = [];

  const output = await runHostStatus({
    json: true,
    runDir,
    stdout: (line) => lines.push(line),
  });

  expect(output).toEqual({ status: "inactive", profile: "prod" });
  expect(JSON.parse(lines.join("\n"))).toEqual(output);
});

it("host status does not advertise an unimplemented start command", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "clash-host-status-"));
  const lines: string[] = [];

  await runHostStatus({
    runDir,
    stdout: (line) => lines.push(line),
  });

  expect(lines.join("\n")).toContain("Open Clash Desktop or start the local-api host.");
  expect(lines.join("\n")).not.toContain("clash host start");
});
