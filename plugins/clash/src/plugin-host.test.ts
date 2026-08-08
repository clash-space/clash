import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type HostRecord = {
  schemaVersion: number;
  protocolVersion: number;
  dataSchemaVersion: number;
  hostId: string;
  endpoint: string;
  pid: number;
  launchMode: "desktop" | "plugin" | "user-service";
  startedBy: "desktop" | "plugin" | "cli";
  profile?: "dev" | "prod";
  agentCliPath: string;
  ownerClientId?: string;
  startedAt: string;
  updatedAt: string;
};

const existingHost: HostRecord = {
  schemaVersion: 1,
  protocolVersion: 1,
  dataSchemaVersion: 1,
  hostId: "daemon-existing",
  endpoint: "http://127.0.0.1:49321",
  pid: process.pid,
  launchMode: "user-service",
  startedBy: "plugin",
  profile: "prod",
  agentCliPath: "/tmp/desktop-clash",
  startedAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
};

async function publish(runDir: string, value: HostRecord): Promise<void> {
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "host.json"), JSON.stringify(value), "utf8");
}

async function loadHostModule(): Promise<Record<string, unknown>> {
  try {
    return await import("./plugin-host.js") as Record<string, unknown>;
  } catch {
    return {};
  }
}

type Manager = {
  ensureHost(): Promise<HostRecord>;
  close(): Promise<void>;
};

type CreateManager = (options: Record<string, unknown>) => Manager;

test("daemon discovery refuses a different runtime profile", async () => {
  const module = await loadHostModule();
  const runDir = await mkdtemp(join(tmpdir(), "clash-daemon-profile-"));
  await publish(runDir, { ...existingHost, profile: "prod" });

  const read = module.readActivePluginHost as (
    runDir: string,
    profile: "dev" | "prod",
  ) => Promise<HostRecord | undefined>;
  assert.equal(await read(runDir, "dev"), undefined);
});

test("MCP reuses a healthy daemon without launching another", async () => {
  const module = await loadHostModule();
  assert.equal(typeof module.createPluginHostManager, "function");
  const runDir = await mkdtemp(join(tmpdir(), "clash-daemon-reuse-"));
  await publish(runDir, existingHost);
  let starts = 0;
  const manager = (module.createPluginHostManager as CreateManager)({
    runDir,
    probeHost: async () => true,
    startHost: async () => {
      starts += 1;
      return { pid: process.pid };
    },
  });

  assert.deepEqual(await manager.ensureHost(), existingHost);
  await manager.close();
  assert.equal(starts, 0);
});

test("one client starts the persistent daemon once under concurrent demand", async () => {
  const module = await loadHostModule();
  const runDir = await mkdtemp(join(tmpdir(), "clash-daemon-concurrent-"));
  let starts = 0;
  let stops = 0;
  const started: HostRecord = { ...existingHost, hostId: "daemon-started" };
  const manager = (module.createPluginHostManager as CreateManager)({
    runDir,
    probeHost: async () => true,
    startHost: async () => {
      starts += 1;
      await publish(runDir, started);
      return { pid: started.pid, stop: async () => { stops += 1; } };
    },
  });

  const [first, second] = await Promise.all([manager.ensureHost(), manager.ensureHost()]);
  assert.equal(first.hostId, started.hostId);
  assert.equal(second.hostId, started.hostId);
  assert.equal(starts, 1);
  await manager.close();
  assert.equal(stops, 0, "closing MCP must not stop the shared daemon");
});

test("separate MCP clients coordinate one persistent daemon startup", async () => {
  const module = await loadHostModule();
  const create = module.createPluginHostManager as CreateManager;
  const runDir = await mkdtemp(join(tmpdir(), "clash-daemon-lock-"));
  let starts = 0;
  const started: HostRecord = { ...existingHost, hostId: "daemon-shared" };
  const options = {
    runDir,
    probeHost: async () => true,
    startHost: async () => {
      starts += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      await publish(runDir, started);
      return { pid: started.pid };
    },
  };
  const first = create(options);
  const second = create(options);

  const [firstHost, secondHost] = await Promise.all([first.ensureHost(), second.ensureHost()]);
  assert.equal(starts, 1);
  assert.equal(firstHost.hostId, secondHost.hostId);
  await first.close();
  await second.close();
});

test("daemon bootstrap derives discovery from the authoritative local-api data directory", async () => {
  const module = await loadHostModule();
  const staleRoot = await mkdtemp(join(tmpdir(), "clash-daemon-stale-root-"));
  const canonicalRoot = await mkdtemp(join(tmpdir(), "clash-daemon-canonical-root-"));
  const dataDir = join(canonicalRoot, "local-api");
  let startedWith: { runDir: string; dataDir: string } | undefined;
  const started: HostRecord = { ...existingHost, hostId: "daemon-canonical" };
  const manager = (module.createPluginHostManager as CreateManager)({
    env: { CLASH_HOME: staleRoot, CLASH_LOCAL_DATA_DIR: dataDir },
    probeHost: async () => true,
    startHost: async (context: { runDir: string; dataDir: string }) => {
      startedWith = { runDir: context.runDir, dataDir: context.dataDir };
      await publish(context.runDir, started);
      return { pid: started.pid };
    },
  });

  await manager.ensureHost();
  assert.deepEqual(startedWith, {
    dataDir,
    runDir: join(canonicalRoot, "run"),
  });
  await manager.close();
});
