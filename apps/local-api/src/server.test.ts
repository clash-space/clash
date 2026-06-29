import { createServer } from "node:net";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LOCAL_HOST_PROTOCOL_VERSION } from "@clash/shared-runtime";
import { readHostDiscovery } from "./host-discovery";
import { createConfiguredLocalAcpAdapter, createLocalAgentToolEnv, startLocalApiServer } from "./server";

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
      launchMode: "desktop",
      ownerClientId: "desktop-1",
      pid: process.pid,
      protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    });

    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    });

    await expect(readHostDiscovery({ runDir })).resolves.toEqual({ status: "inactive" });
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
    expect(env.CLASH_API_KEY).toBe("clsh_local_desktop");
    expect(env.PATH?.split(":")[0]).toBe(join(dataDir, "agent-bin"));

    const shim = join(dataDir, "agent-bin", "clash");
    await expect(stat(shim)).resolves.toMatchObject({ mode: expect.any(Number) });
    const shimText = await readFile(shim, "utf8");
    expect(shimText).toContain("CLASH_API_URL");
    expect(shimText).toContain("command -v node");
    expect(shimText).toContain("ELECTRON_RUN_AS_NODE=1");
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
    expect(shimText).toContain("CLASH_CLI_NODE_PATH");
    expect(childEnv.CLASH_CLI_NODE_PATH).toBe("/Applications/Clash.app/Contents/Resources/clash-cli/vendor");
    expect(shimText).not.toContain("app.asar/node_modules/@clash-space/cli");
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
    expect(sent).toContainEqual({
      type: "session.event",
      session_id: created.session_id,
      turn_id: "turn-smoke",
      event: {
        sessionUpdate: "clash.canvas.patch",
        operations: [
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
        ],
      },
    });

    await expect(adapter.listSessionMessages(created.session_id)).resolves.toMatchObject({
      messages: [
        {
          id: "turn-smoke-user",
          sender_kind: "user",
          sender_id: "local-user",
          turn_id: "turn-smoke",
          events: [{ type: "text", text: "hello local agent" }],
        },
        {
          id: "turn-smoke-agent",
          sender_kind: "agent",
          sender_id: "mock-agent",
          turn_id: "turn-smoke",
          events: [
            { type: "text", text: "Mock ACP reply: hello local agent" },
            { sessionUpdate: "clash.canvas.patch" },
          ],
        },
      ],
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
});
