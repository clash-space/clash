import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { LOCAL_HOST_PROTOCOL_VERSION } from "@clash/shared-runtime";
import { readHostDiscovery } from "./host-discovery";
import {
  createConfiguredLocalAcpAdapter,
  createLocalAgentToolEnv,
  defaultLocalApiDataDir,
  startLocalApiServer,
} from "./server";

const execFileAsync = promisify(execFile);

async function withLocalDataDir<T>(dataDir: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.CLASH_LOCAL_DATA_DIR;
  process.env.CLASH_LOCAL_DATA_DIR = dataDir;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.CLASH_LOCAL_DATA_DIR;
    } else {
      process.env.CLASH_LOCAL_DATA_DIR = previous;
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function listenOnLoopback(server: ReturnType<typeof createServer>, port = 0): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      if (errorCode(error) === "EPERM") {
        resolve(null);
        return;
      }
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address !== "object") {
        reject(new Error("failed to reserve port"));
        return;
      }
      resolve(address.port);
    });
  });
}

describe("local API server configuration", () => {
  it("keeps local package scripts reproducible without pnpm install checks", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };
    const scripts = packageJson.scripts ?? {};

    expect(scripts["build:deps"]).toContain("npm --prefix ../../packages/shared-types run build");
    expect(scripts["build:deps"]).toContain("npm --prefix ../../packages/cli run build");
    expect(scripts["build:deps"]).toContain("npm --prefix ../../packages/clash-bridge run build");
    expect(scripts.build).toBe("npm run build:deps && tsc");
    expect(scripts.test).toBe("npm run build:deps && vitest run src");
    expect(scripts["test:e2e"]).toBe("npm run build && node e2e/daemon-smoke.mjs");
    expect(`${scripts.build} ${scripts.test} ${scripts["test:e2e"]}`).not.toContain("pnpm");
  });

  it("uses CLASH_HOME for the default local data dir when CLASH_LOCAL_DATA_DIR is absent", () => {
    expect(defaultLocalApiDataDir({
      CLASH_HOME: "/tmp/clash-home",
    })).toBe(join("/tmp/clash-home", "local-api"));
    expect(defaultLocalApiDataDir({
      CLASH_HOME: "/tmp/clash-home",
      CLASH_LOCAL_DATA_DIR: "/tmp/explicit-local-api",
    })).toBe("/tmp/explicit-local-api");
    expect(defaultLocalApiDataDir({
      CLASH_LOCAL_DATA_DIR: "./relative-local-api",
    })).toBe(resolve("./relative-local-api"));
  });

  it("uses the server data directory as the ACP lifecycle directory", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-root-"));
    const dataDir = join(clashRoot, "local-api");
    const acpBinDir = join(dataDir, "acp-bin");
    await mkdir(acpBinDir, { recursive: true });
    const codexShim = join(acpBinDir, "codex-acp");
    await writeFile(codexShim, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(codexShim, 0o755);

    const adapter = createConfiguredLocalAcpAdapter(
      { PATH: "" },
      { dataDir },
    );

    await expect(adapter.listRuntimes()).resolves.toMatchObject({
      runtimes: [{
        agents: expect.arrayContaining([
          expect.objectContaining({
            id: "codex-acp",
            binary: codexShim,
          }),
        ]),
      }],
    });
  });

  it("rejects when the requested listen port is occupied", async () => {
    const blocker = createServer();
    const occupiedPort = await listenOnLoopback(blocker);
    if (occupiedPort === null) return;

    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-port-"));

    try {
      await withLocalDataDir(dataDir, async () => {
        await expect(startLocalApiServer({
          dataDir,
          port: occupiedPort,
          remotePersistence: null,
        })).rejects.toMatchObject({ code: "EADDRINUSE" });
      });
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("writes a discovery record after listen and removes it on close", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-data-"));
    const runDir = await mkdtemp(join(tmpdir(), "clash-local-api-run-"));
    let server: Awaited<ReturnType<typeof startLocalApiServer>>;
    try {
      server = await withLocalDataDir(dataDir, () => startLocalApiServer({
        dataDir,
        port: 0,
        remotePersistence: null,
        discovery: {
          enabled: true,
          runDir,
          launchMode: "desktop",
          ownerClientId: "desktop-1",
          startedBy: "desktop",
        },
      }));
    } catch (error) {
      if (errorCode(error) === "EPERM") return;
      throw error;
    }

    const discovery = await readHostDiscovery({ runDir });
    expect(discovery.status).toBe("active");
    if (discovery.status !== "active") throw new Error("expected active discovery record");
    expect(discovery.record).toMatchObject({
      endpoint: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      agentCliPath: join(dataDir, "agent-bin", "clash"),
      launchMode: "desktop",
      ownerClientId: "desktop-1",
      pid: process.pid,
      protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    });
    const shimText = await readFile(join(dataDir, "agent-bin", "clash"), "utf8");
    expect(shimText).toContain(`CLASH_API_URL='${discovery.record.endpoint}'`);
    expect(shimText).not.toContain("CLASH_API_URL='http://127.0.0.1:0'");

    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    });

    await expect(readHostDiscovery({ runDir })).resolves.toEqual({ status: "inactive" });
  });

  it("keeps default host discovery beside the configured local-api data directory", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-root-"));
    const unrelatedClashHome = await mkdtemp(join(tmpdir(), "clash-unrelated-home-"));
    const dataDir = join(clashRoot, "local-api");
    const runDir = join(clashRoot, "run");
    const previousClashHome = process.env.CLASH_HOME;
    process.env.CLASH_HOME = unrelatedClashHome;
    let server: Awaited<ReturnType<typeof startLocalApiServer>> | undefined;

    try {
      server = await startLocalApiServer({
        dataDir,
        port: 0,
        remotePersistence: null,
        localAcp: createConfiguredLocalAcpAdapter({ CLASH_E2E_STUB_ACP: "1" }),
        discovery: {
          enabled: true,
          launchMode: "desktop",
          ownerClientId: "desktop-canonical-root",
          startedBy: "desktop",
        },
      });

      await expect(readHostDiscovery({ runDir })).resolves.toMatchObject({
        status: "active",
        record: {
          ownerClientId: "desktop-canonical-root",
          agentCliPath: join(dataDir, "agent-bin", "clash"),
        },
      });
    } finally {
      if (server) {
        await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
      }
      if (previousClashHome === undefined) {
        delete process.env.CLASH_HOME;
      } else {
        process.env.CLASH_HOME = previousClashHome;
      }
    }

    await expect(readHostDiscovery({ runDir })).resolves.toEqual({ status: "inactive" });
  });

  it("waits for local ACP disposal before completing server close", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-shutdown-"));
    let releaseDispose!: () => void;
    const disposeGate = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    const disposeAll = vi.fn(async () => disposeGate);
    const localAcp = {
      updateSpawnEnv() {},
      async listRuntimes() {
        return { runtimes: [] };
      },
      async createSession() {
        return { session_id: "unused" };
      },
      async listResumeSessions() {
        return { sessions: [] };
      },
      disposeAll,
    };
    let server: Awaited<ReturnType<typeof startLocalApiServer>>;
    try {
      server = await startLocalApiServer({
        dataDir,
        port: 0,
        remotePersistence: null,
        localAcp: localAcp as never,
      });
    } catch (error) {
      if (errorCode(error) === "EPERM") return;
      throw error;
    }

    let closeSettled = false;
    const closing = new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        closeSettled = true;
        if (error) reject(error);
        else resolve();
      });
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const settledBeforeDispose = closeSettled;
    releaseDispose();
    await closing;

    expect(disposeAll).toHaveBeenCalledOnce();
    expect(settledBeforeDispose).toBe(false);
  });

  it("observes config.yaml edits made while ACP warmup is still running", async () => {
    const clashHome = await mkdtemp(join(tmpdir(), "clash-local-api-startup-config-"));
    const dataDir = join(clashHome, "local-api");
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(clashHome, "config.yaml"),
      "version: 1\nharnesses:\n  enabled:\n    - codex-acp\n",
    );
    let releaseWarmup!: () => void;
    const warmupGate = new Promise<void>((resolve) => {
      releaseWarmup = resolve;
    });
    const reconcileConfiguration = vi.fn(async () => undefined);
    const localAcp = {
      updateSpawnEnv() {},
      warmup: vi.fn(async () => warmupGate),
      reconcileConfiguration,
      async listRuntimes() {
        return { runtimes: [] };
      },
      async createSession() {
        return { session_id: "unused" };
      },
      async listResumeSessions() {
        return { sessions: [] };
      },
      async disposeAll() {},
    };
    let server: Awaited<ReturnType<typeof startLocalApiServer>> | null = null;
    try {
      server = await startLocalApiServer({
        dataDir,
        port: 0,
        remotePersistence: null,
        discovery: { enabled: false },
        localAcp: localAcp as never,
      });
      await writeFile(
        join(clashHome, "config.yaml"),
        "version: 1\nharnesses:\n  enabled:\n    - codex-acp\n    - claude-acp\n",
      );
      await new Promise((resolve) => setTimeout(resolve, 180));
      releaseWarmup();

      await vi.waitFor(
        () => expect(reconcileConfiguration).toHaveBeenCalledOnce(),
        { timeout: 1_000 },
      );
    } catch (error) {
      if (errorCode(error) === "EPERM") return;
      throw error;
    } finally {
      releaseWarmup();
      if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
      }
      await rm(clashHome, { recursive: true, force: true });
    }
  });

  it("creates a local Clash CLI shim and injects it into agent spawn env", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-agent-tools-"));
    const env = createLocalAgentToolEnv({
      dataDir,
      apiBaseUrl: "http://127.0.0.1:49397",
      env: {
        PATH: "/usr/bin:/bin",
      },
    });

    expect(env.CLASH_API_URL).toBe("http://127.0.0.1:49397");
    expect(env).not.toHaveProperty("CLASH_API_KEY");
    expect(env.PATH?.split(":")[0]).toBe(join(dataDir, "agent-bin"));

    const shim = join(dataDir, "agent-bin", "clash");
    await expect(stat(shim)).resolves.toMatchObject({ mode: expect.any(Number) });
    const shimText = await readFile(shim, "utf8");
    expect(shimText).toContain("CLASH_API_URL");
    expect(shimText).not.toContain("CLASH_API_KEY");
    expect(shimText).toContain("command -v node");
    expect(shimText).toContain("ELECTRON_RUN_AS_NODE=1");
  });

  it("pins the published Clash CLI to the authoritative Clash home", async () => {
    const clashHome = await mkdtemp(join(tmpdir(), "canonical-clash-home-"));
    const dataDir = join(clashHome, "local-api");
    const env = createLocalAgentToolEnv({
      dataDir,
      apiBaseUrl: "http://127.0.0.1:49397",
      env: {
        PATH: "/usr/bin:/bin",
        CLASH_HOME: "/tmp/stale-clash-home",
        CLASH_LOCAL_DATA_DIR: "/tmp/stale-clash-home/local-api",
      },
    });

    expect(env.CLASH_HOME).toBe(clashHome);
    expect(env.CLASH_LOCAL_DATA_DIR).toBe(dataDir);

    const shimText = await readFile(join(dataDir, "agent-bin", "clash"), "utf8");
    expect(shimText).toContain(`export CLASH_HOME='${clashHome}'`);
    expect(shimText).toContain(`export CLASH_LOCAL_DATA_DIR='${dataDir}'`);
    expect(shimText).not.toContain("/tmp/stale-clash-home");
  });

  it("passes an explicit Node runtime through to the local Clash CLI shim", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-agent-tools-"));
    const env = createLocalAgentToolEnv({
      dataDir,
      apiBaseUrl: "http://127.0.0.1:49397",
      env: {
        PATH: "/usr/bin:/bin",
        CLASH_NODE_EXEC_PATH: "/custom/node",
      },
    });

    expect(env.CLASH_NODE_EXEC_PATH).toBe("/custom/node");

    const shim = join(dataDir, "agent-bin", "clash");
    const shimText = await readFile(shim, "utf8");
    expect(shimText).toContain('exec "$CLASH_NODE_EXEC_PATH"');
  });

  it("uses an explicit Clash CLI entry path for child-process-safe packaged apps", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-agent-tools-"));
    const childEnv = createLocalAgentToolEnv({
      dataDir,
      apiBaseUrl: "http://127.0.0.1:49397",
      env: {
        PATH: "/usr/bin:/bin",
        CLASH_NODE_EXEC_PATH: "/custom/node",
        CLASH_CLI_ENTRY_PATH: "/Applications/Clash.app/Contents/Resources/clash-cli/dist/index.js",
        CLASH_CLI_NODE_PATH: "/Applications/Clash.app/Contents/Resources/clash-cli/vendor",
      },
    });

    const shim = join(dataDir, "agent-bin", "clash");
    const shimText = await readFile(shim, "utf8");
    expect(shimText).toContain("/Applications/Clash.app/Contents/Resources/clash-cli/dist/index.js");
    expect(shimText).toContain(
      "export CLASH_CLI_NODE_PATH='/Applications/Clash.app/Contents/Resources/clash-cli/vendor'",
    );
    expect(childEnv.CLASH_CLI_NODE_PATH).toBe("/Applications/Clash.app/Contents/Resources/clash-cli/vendor");
    expect(shimText).not.toContain("app.asar/node_modules/@clash-space/cli");
  });

  it("keeps the packaged CLI vendor path when the shim runs from a clean shell", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-agent-tools-"));
    const cliEntry = join(dataDir, "print-node-path.cjs");
    const vendorPath = join(dataDir, "packaged-vendor");
    await writeFile(
      cliEntry,
      'process.stdout.write(process.env.NODE_PATH ?? "");\n',
      "utf8",
    );

    createLocalAgentToolEnv({
      dataDir,
      apiBaseUrl: "http://127.0.0.1:49397",
      env: {
        PATH: process.env.PATH,
        CLASH_CLI_ENTRY_PATH: cliEntry,
        CLASH_CLI_NODE_PATH: vendorPath,
      },
    });

    const shim = join(dataDir, "agent-bin", "clash");
    const { stdout } = await execFileAsync(shim, [], {
      env: { PATH: process.env.PATH },
    });
    expect(stdout).toBe(vendorPath);
  });

  it("can expose a deterministic mock ACP agent for desktop smoke tests", async () => {
    const adapter = createConfiguredLocalAcpAdapter({ CLASH_E2E_STUB_ACP: "1" });

    await expect(adapter.listRuntimes()).resolves.toMatchObject({
      runtimes: [
        {
          id: "desktop-local",
          agents: [{ id: "mock-acp", binary: "mock-acp" }],
          status: "online",
        },
      ],
    });

    const created = await adapter.createSession({
      runtimeId: "desktop-local",
      agentTemplateId: "master-clash",
      agentMemberId: "mock-agent",
      projectId: "mock-project",
    });
    const handlers = new Map<string, (raw?: unknown) => void>();
    const sent: unknown[] = [];
    const ws = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn((raw: string) => sent.push(JSON.parse(raw) as unknown)),
      on: vi.fn((event: string, handler: (raw?: unknown) => void) => {
        handlers.set(event, handler);
      }),
      close: vi.fn(),
    };

    adapter.bindSessionSocket(created.session_id, ws as never);
    handlers.get("message")?.(JSON.stringify({
      type: "prompt",
      turn_id: "turn-smoke",
      text: "hello local agent",
    }));

    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        type: "session.complete",
        session_id: created.session_id,
        turn_id: "turn-smoke",
      });
    });
    const patchEvent = sent.find((message) => {
      const record = message as {
        type?: string;
        session_id?: string;
        turn_id?: string;
        event?: { sessionUpdate?: string; operations?: unknown[] };
      };
      return record.type === "session.event" &&
        record.session_id === created.session_id &&
        record.turn_id === "turn-smoke" &&
        record.event?.sessionUpdate === "clash.canvas.patch" &&
        Array.isArray(record.event.operations);
    }) as {
      event: { operations: unknown[] };
    } | undefined;
    expect(patchEvent).toBeTruthy();
    expect(patchEvent?.event.operations).toEqual(expect.arrayContaining([
      {
        op: "add_node",
        node: {
          id: "mock-agent-stage-turn-smoke",
          type: "group",
          data: { label: "Agent Stage" },
          position: { x: 480, y: 140 },
          width: 620,
          height: 360,
          style: { width: 620, height: 360 },
        },
      },
      {
        op: "add_node",
        node: {
          id: "mock-agent-brief-turn-smoke",
          type: "action-badge",
          data: {
            label: "Agent Brief",
            actionType: "text-gen",
            content: "# Agent Brief\nhello local agent",
          },
          position: { x: 530, y: 210 },
          width: 260,
          height: 48,
        },
      },
      {
        op: "add_node",
        node: {
          id: "mock-agent-action-turn-smoke",
          type: "action-badge",
          data: {
            label: "Agent Image Pass",
            actionType: "image-gen",
            content: "# Prompt\nhello local agent",
          },
          position: { x: 530, y: 320 },
          width: 260,
          height: 48,
        },
      },
      {
        op: "timeline_apply",
        timeline: expect.objectContaining({
          nodeId: "mock-agent-timeline-turn-smoke",
        }),
      },
    ]));

    const persisted = await adapter.listSessionMessages(created.session_id);
    expect(persisted).not.toBeNull();
    if (!persisted) throw new Error("expected persisted local session messages");
    expect(persisted.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "turn-smoke-user",
        sender_kind: "user",
        sender_id: "local-user",
        turn_id: "turn-smoke",
        events: [{ type: "text", text: "hello local agent" }],
      }),
      expect.objectContaining({
        id: "turn-smoke-agent",
        sender_kind: "agent",
        sender_id: "mock-agent",
        turn_id: "turn-smoke",
      }),
    ]));
    const agentMessage = persisted.messages.find((message) => message.id === "turn-smoke-agent");
    expect(agentMessage?.events).toEqual(expect.arrayContaining([
      { type: "text", text: "Mock ACP reply: hello local agent" },
      expect.objectContaining({ sessionUpdate: "clash.canvas.patch" }),
    ]));
  });

  it("can stage a managed harness update and session restart for GUI E2E", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-harness-update-e2e-"));
    const adapter = createConfiguredLocalAcpAdapter({
      CLASH_E2E_STUB_ACP: "1",
      CLASH_E2E_STUB_HARNESS_UPDATE: "1",
      CLASH_LOCAL_DATA_DIR: dataDir,
    });

    await expect(adapter.listHarnesses()).resolves.not.toMatchObject({
      harnesses: [expect.objectContaining({ updateAvailable: true })],
    });
    await writeFile(join(dataDir, ".e2e-harness-update-ready"), "ready\n");
    const staged = await adapter.listHarnesses();
    expect(staged.harnesses.find((harness) => harness.id === "mock-acp")).toMatchObject({
      installedVersion: "1.0.0",
      latestVersion: "2.0.0",
      updateAvailable: true,
    });

    const created = await adapter.createSession({
      runtimeId: "desktop-local",
      agentTemplateId: "master-clash",
      projectId: "mock-project",
    });
    await adapter.upgradeHarness("mock-acp");
    await expect(adapter.getSessionRuntimeStatus(created.session_id)).resolves.toMatchObject({
      running_version: "1.0.0",
      installed_version: "2.0.0",
      restart_required: true,
    });
    await adapter.restartSession(created.session_id, { mode: "now" });
    await expect(adapter.getSessionRuntimeStatus(created.session_id)).resolves.toMatchObject({
      running_version: "2.0.0",
      installed_version: "2.0.0",
      restart_required: false,
    });
  });

  it("can run a one-shot local ACP text task", async () => {
    const adapter = createConfiguredLocalAcpAdapter({ CLASH_E2E_STUB_ACP: "1" });

    await expect(adapter.runTextTask?.({
      projectId: "mock-project",
      prompt: "write a short caption",
      timeoutMs: 2_000,
    })).resolves.toMatchObject({
      text: expect.stringContaining("Mock ACP reply:"),
      sessionId: expect.any(String),
    });
  });

  it("does not expose the mock ACP agent from the legacy flag alone", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-real-path-"));
    const adapter = createConfiguredLocalAcpAdapter({
      CLASH_LOCAL_ACP_MOCK: "1",
      CLASH_LOCAL_DATA_DIR: dataDir,
      CLASH_ACP_BIN_DIR: dataDir,
      PATH: "",
    });

    const runtimes = await adapter.listRuntimes();

    expect(runtimes.runtimes[0]?.agents.some((agent) => agent.id === "mock-acp")).toBe(false);
  });

  it("uses only the self-hosted ACP directory when a packaged runtime directory is also present", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-data-"));
    const packagedBinDir = await mkdtemp(join(tmpdir(), "clash-local-api-packaged-acp-bin-"));
    const managedBinDir = join(dataDir, "acp-bin");
    await mkdir(managedBinDir, { recursive: true });
    const packagedCodexShim = join(packagedBinDir, "codex-acp");
    const codexShim = join(managedBinDir, "codex-acp");
    await writeFile(packagedCodexShim, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(packagedCodexShim, 0o755);
    await writeFile(codexShim, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(codexShim, 0o755);

    const adapter = createConfiguredLocalAcpAdapter({
      CLASH_LOCAL_DATA_DIR: dataDir,
      CLASH_ACP_BIN_DIR: packagedBinDir,
      PATH: "",
    });

    await expect(adapter.listRuntimes()).resolves.toMatchObject({
      runtimes: [
        {
          agents: expect.arrayContaining([
            expect.objectContaining({
              id: "codex-acp",
              binary: codexShim,
            }),
          ]),
        },
      ],
    });
  });
});
