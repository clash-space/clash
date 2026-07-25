import { describe, expect, it } from "vitest";
import {
  LOCAL_HOST_PROTOCOL_VERSION,
  LOCAL_HOST_RECORD_SCHEMA_VERSION,
  isCompatibleHost,
  shouldClientOwnShutdown,
  type LocalHostDiscoveryRecord,
} from "./index";

function record(
  launchMode: LocalHostDiscoveryRecord["launchMode"],
  ownerClientId = "desktop-1",
  startedBy: LocalHostDiscoveryRecord["startedBy"] = "desktop",
): LocalHostDiscoveryRecord {
  return {
    schemaVersion: LOCAL_HOST_RECORD_SCHEMA_VERSION,
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    dataSchemaVersion: 1,
    hostId: "host-1",
    endpoint: "http://127.0.0.1:49321",
    pid: 1234,
    launchMode,
    startedBy,
    ownerClientId,
    startedAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
}

describe("local host lifecycle helpers", () => {
  it("allows a desktop client to shut down only the desktop host it owns", () => {
    expect(shouldClientOwnShutdown(record("desktop"), {
      clientKind: "desktop",
      clientId: "desktop-1",
    })).toBe(true);

    expect(shouldClientOwnShutdown(record("desktop"), {
      clientKind: "desktop",
      clientId: "other-desktop",
    })).toBe(false);
  });

  it("prevents desktop from shutting down service-owned hosts", () => {
    for (const launchMode of ["user-service", "launchd"] as const) {
      expect(shouldClientOwnShutdown(record(launchMode), {
        clientKind: "desktop",
        clientId: "desktop-1",
      })).toBe(false);
    }
  });

  it("lets a plugin close only the embedded host instance it owns", () => {
    const pluginHost = record("plugin", "plugin-1", "plugin");

    expect(shouldClientOwnShutdown(pluginHost, {
      clientKind: "plugin",
      clientId: "plugin-1",
    })).toBe(true);
    expect(shouldClientOwnShutdown(pluginHost, {
      clientKind: "plugin",
      clientId: "other-plugin",
    })).toBe(false);
    expect(shouldClientOwnShutdown(pluginHost, {
      clientKind: "desktop",
      clientId: "plugin-1",
    })).toBe(false);
  });

  it("checks host protocol compatibility", () => {
    expect(isCompatibleHost(record("desktop"), LOCAL_HOST_PROTOCOL_VERSION)).toBe(true);
    expect(isCompatibleHost({
      ...record("desktop"),
      protocolVersion: LOCAL_HOST_PROTOCOL_VERSION + 1,
    }, LOCAL_HOST_PROTOCOL_VERSION)).toBe(false);
  });
});
