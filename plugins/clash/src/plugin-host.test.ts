import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type HostRecord = {
  schemaVersion: number;
  protocolVersion: number;
  dataSchemaVersion: number;
  hostId: string;
  endpoint: string;
  pid: number;
  launchMode: "desktop" | "plugin";
  startedBy: "desktop" | "plugin";
  agentCliPath: string;
  ownerClientId?: string;
  startedAt: string;
  updatedAt: string;
};

const existingHost: HostRecord = {
  schemaVersion: 1,
  protocolVersion: 1,
  dataSchemaVersion: 1,
  hostId: "desktop-host",
  endpoint: "http://127.0.0.1:49321",
  pid: process.pid,
  launchMode: "desktop",
  startedBy: "desktop",
  agentCliPath: "/tmp/desktop-clash",
  startedAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
};

async function loadHostModule(): Promise<Record<string, unknown>> {
  try {
    return await import("./plugin-host.js") as Record<string, unknown>;
  } catch {
    return {};
  }
}

test("plugin host manager reuses an active host without taking ownership", async () => {
  const module = await loadHostModule();
  assert.equal(typeof module.createPluginHostManager, "function");
  let starts = 0;
  let closes = 0;
  const manager = (module.createPluginHostManager as (options: Record<string, unknown>) => {
    ensureHost(): Promise<HostRecord>;
    ownsHost(): boolean;
    close(): Promise<void>;
  })({
    readHost: async () => existingHost,
    startHost: async () => {
      starts += 1;
      return { record: existingHost, close: async () => { closes += 1; } };
    },
  });

  assert.equal(await manager.ensureHost(), existingHost);
  assert.equal(manager.ownsHost(), false);
  await manager.close();
  assert.equal(starts, 0);
  assert.equal(closes, 0);
});

test("plugin host manager starts once under concurrent demand and closes only its host", async () => {
  const module = await loadHostModule();
  assert.equal(typeof module.createPluginHostManager, "function");
  let starts = 0;
  let closes = 0;
  const pluginHost: HostRecord = {
    ...existingHost,
    hostId: "plugin-host",
    launchMode: "plugin",
    startedBy: "plugin",
    ownerClientId: "plugin-1",
  };
  const manager = (module.createPluginHostManager as (options: Record<string, unknown>) => {
    ensureHost(): Promise<HostRecord>;
    ownsHost(): boolean;
    close(): Promise<void>;
  })({
    ownerClientId: "plugin-1",
    readHost: async () => undefined,
    startHost: async () => {
      starts += 1;
      await Promise.resolve();
      return { record: pluginHost, close: async () => { closes += 1; } };
    },
  });

  const [first, second] = await Promise.all([manager.ensureHost(), manager.ensureHost()]);
  assert.equal(first, pluginHost);
  assert.equal(second, pluginHost);
  assert.equal(starts, 1);
  assert.equal(manager.ownsHost(), true);
  await manager.close();
  await manager.close();
  assert.equal(closes, 1);
});

test("separate plugin managers coordinate one host startup through the run directory", async () => {
  const module = await loadHostModule();
  assert.equal(typeof module.createPluginHostManager, "function");
  const create = module.createPluginHostManager as (options: Record<string, unknown>) => {
    ensureHost(): Promise<HostRecord>;
    ownsHost(): boolean;
    close(): Promise<void>;
  };
  const runDir = await mkdtemp(join(tmpdir(), "clash-plugin-lock-"));
  let active: HostRecord | undefined;
  let starts = 0;
  const startHost = async ({ ownerClientId }: { ownerClientId: string }) => {
    starts += 1;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    active = {
      ...existingHost,
      hostId: `plugin-${ownerClientId}`,
      launchMode: "plugin",
      startedBy: "plugin",
      ownerClientId,
    };
    return { record: active, close: async () => undefined };
  };
  const options = {
    runDir,
    readHost: async () => active,
    startHost,
  };
  const first = create({ ...options, ownerClientId: "plugin-1" });
  const second = create({ ...options, ownerClientId: "plugin-2" });

  const [firstHost, secondHost] = await Promise.all([first.ensureHost(), second.ensureHost()]);
  assert.equal(starts, 1);
  assert.equal(firstHost.hostId, secondHost.hostId);
  assert.notEqual(first.ownsHost(), second.ownsHost());
  await first.close();
  await second.close();
});
