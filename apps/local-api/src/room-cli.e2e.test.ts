import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalApiApp } from "./app";
import { createLocalSyncConfigStore } from "./sync-config";

let dataDir = "";
let clashHome = "";

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clash-local-room-e2e-data-"));
  clashHome = await mkdtemp(join(tmpdir(), "clash-local-room-e2e-home-"));
});

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  if (clashHome) await rm(clashHome, { recursive: true, force: true });
});

function startLocalApiServer(
  options: {
    syncConfig?: ReturnType<typeof createLocalSyncConfigStore>;
  } = {},
): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = createLocalApiApp({
    dataDir,
    userId: "local-user",
    ...(options.syncConfig ? { syncConfig: options.syncConfig } : {}),
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
      (info) => {
        settled = true;
        resolve({
          baseUrl: `http://127.0.0.1:${info.port}`,
          close: () =>
            new Promise<void>((closeResolve) => {
              let closeTimer: ReturnType<typeof setTimeout> | undefined;
              const done = () => {
                if (closeTimer) clearTimeout(closeTimer);
                closeResolve();
              };
              closeTimer = setTimeout(closeResolve, 2_000);
              server.close(done);
              (
                server as { closeAllConnections?: () => void }
              ).closeAllConnections?.();
            }),
        });
      },
    );
    server.once("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: "Bearer clsh_local_room_e2e",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: "Bearer clsh_local_room_e2e" },
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}

function parseCliJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  expect(trimmed.length).toBeGreaterThan(0);
  return JSON.parse(trimmed);
}

function formatCliResult(result: {
  error?: string;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}): string {
  return JSON.stringify(result, null, 2);
}

function createRoomCliRunner(input: {
  baseUrl: string;
  projectId: string;
  agentMemberId: string;
}) {
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve("tsx");
  const cliEntry = new URL(
    "../../../packages/cli/src/index.ts",
    import.meta.url,
  );
  const env = {
    ...process.env,
    CLASH_API_KEY: "clsh_local_room_e2e",
    CLASH_API_URL: input.baseUrl,
    CLASH_AGENT_MEMBER_ID: input.agentMemberId,
    CLASH_HOME: clashHome,
    CLASH_PROJECT_ID: input.projectId,
  };

  return (args: string[]) =>
    new Promise<{
      status: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
      error?: string;
    }>((resolve) => {
      const child = spawn(
        process.execPath,
        ["--import", tsxLoader, cliEntry.pathname, ...args],
        { cwd: clashHome, env },
      );
      let stdout = "";
      let stderr = "";
      let spawnError: string | undefined;
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        spawnError = error.message;
      });
      child.on("close", (status, signal) => {
        clearTimeout(timer);
        resolve({
          status,
          signal,
          stdout,
          stderr,
          ...(spawnError ? { error: spawnError } : {}),
        });
      });
    });
}

describe("local room CLI e2e", () => {
  it("posts and reads project room messages through the real local-api HTTP server", async () => {
    const server = await startLocalApiServer();
    try {
      const project = await postJson<{ id: string }>(
        `${server.baseUrl}/api/v1/projects`,
        {
          name: "Room CLI Project",
        },
      );
      const agentList = await getJson<{
        agents: Array<{ id: string; template_id: string; user_id: string }>;
      }>(`${server.baseUrl}/api/v1/agents`);
      const masterClash = agentList.agents.find(
        (agent) => agent.template_id === "master-clash",
      );
      expect(masterClash).toMatchObject({
        id: "local-master-clash",
        user_id: "local-user",
      });

      const runCli = createRoomCliRunner({
        baseUrl: server.baseUrl,
        projectId: project.id,
        agentMemberId: masterClash!.id,
      });

      const posted = await runCli([
        "room",
        "say",
        "hello from spawned cli",
        "--json",
      ]);
      expect(posted.status, formatCliResult(posted)).toBe(0);
      expect(parseCliJson(posted.stdout)).toMatchObject({
        project_id: project.id,
        sender_kind: "agent",
        sender_id: "local-master-clash",
        sender_user_id: "local-user",
        text: "hello from spawned cli",
        sync: {
          mode: "local-only",
          remote_room: { enabled: false, status: "disabled" },
        },
        mutation: {
          operation: "room_message_create",
          accepted: true,
        },
      });

      const read = await runCli(["room", "read", "--limit", "5", "--json"]);
      expect(read.status, formatCliResult(read)).toBe(0);
      expect(parseCliJson(read.stdout)).toMatchObject({
        sync: {
          mode: "local-only",
          remote_room: { enabled: false, status: "disabled" },
        },
        messages: [
          {
            project_id: project.id,
            sender_kind: "agent",
            sender_id: "local-master-clash",
            sender_user_id: "local-user",
            text: "hello from spawned cli",
          },
        ],
      });

      const sync = await runCli(["room", "sync", "--json"]);
      expect(sync.status, formatCliResult(sync)).toBe(1);
      expect(sync.stderr).toContain("API error 409");
      expect(sync.stderr).toContain("remote room sync is not configured");
      expect(parseCliJson(sync.stdout)).toMatchObject({
        error: "remote room sync is not configured",
        admission: {
          allowed: false,
          reason: "remote-room-not-configured",
          requirements: ["enable-sync"],
        },
        sync: {
          mode: "local-only",
          remote_room: {
            enabled: false,
            status: "disabled",
            error: "remote room sync is not configured",
          },
        },
        mutation: {
          operation: "room_sync",
          accepted: false,
          error: "remote room sync is not configured",
        },
      });
    } finally {
      await server.close();
    }
  });

  it("resolves inspected remote/local room conflicts through the real CLI without overwriting local text", async () => {
    const fetchMock = async (_input: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response(
          JSON.stringify({
            messages: [
              {
                id: "room-cli-conflict",
                project_id: "ignored-remote-project-id",
                sender_kind: "user",
                sender_id: "remote-user",
                sender_user_id: "remote-user",
                mentions: [],
                text: "remote room text",
                at: 1000,
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unexpected remote room write", { status: 500 });
    };
    const syncConfig = createLocalSyncConfigStore({
      dataDir,
      env: {
        CLASH_REMOTE_LORO_URL: "https://api.example.com",
        CLASH_REMOTE_LORO_TOKEN: "token-1",
      },
      fetch: fetchMock,
    });
    const server = await startLocalApiServer({ syncConfig });
    try {
      const project = await postJson<{ id: string }>(
        `${server.baseUrl}/api/v1/projects`,
        {
          name: "Room CLI Conflict Project",
        },
      );
      await postJson(
        `${server.baseUrl}/api/v1/projects/${project.id}/room/messages`,
        {
          id: "room-cli-conflict",
          text: "local room text",
        },
      );
      const runCli = createRoomCliRunner({
        baseUrl: server.baseUrl,
        projectId: project.id,
        agentMemberId: "local-master-clash",
      });

      const conflicted = await runCli(["room", "sync", "--json"]);
      expect(conflicted.status, formatCliResult(conflicted)).toBe(1);
      expect(conflicted.stderr).toContain("room sync conflict");
      const conflictBody = parseCliJson(conflicted.stdout) as {
        error: string;
        plan: {
          conflicts: Array<{
            id: string;
            local: { contentHash: string; text: string };
            remote: { contentHash: string; text: string };
          }>;
        };
      };
      expect(conflictBody).toMatchObject({
        error: "room sync conflict",
        plan: {
          conflicts: [
            {
              id: "room-cli-conflict",
              local: {
                text: "local room text",
                contentHash: expect.any(String),
              },
              remote: {
                text: "remote room text",
                contentHash: expect.any(String),
              },
            },
          ],
        },
      });
      const conflict = conflictBody.plan.conflicts[0]!;

      const staleResolution = await runCli([
        "room",
        "resolve-conflict",
        "room-cli-conflict",
        "--local-hash",
        "stale-local-hash",
        "--remote-hash",
        conflict.remote.contentHash,
        "--json",
      ]);
      expect(staleResolution.status, formatCliResult(staleResolution)).toBe(1);
      expect(parseCliJson(staleResolution.stdout)).toMatchObject({
        error: "stale room sync conflict resolution",
        mutation: {
          operation: "room_sync_conflict_resolve",
          accepted: false,
        },
      });

      const resolved = await runCli([
        "room",
        "resolve-conflict",
        "room-cli-conflict",
        "--local-hash",
        conflict.local.contentHash,
        "--remote-hash",
        conflict.remote.contentHash,
        "--json",
      ]);
      expect(resolved.status, formatCliResult(resolved)).toBe(0);
      expect(parseCliJson(resolved.stdout)).toMatchObject({
        resolution: {
          strategy: "accept-divergence",
          project_id: project.id,
          message_id: "room-cli-conflict",
          localContentHash: conflict.local.contentHash,
          remoteContentHash: conflict.remote.contentHash,
        },
        mutation: {
          operation: "room_sync_conflict_resolve",
          accepted: true,
          resultEntityId: "room-cli-conflict",
        },
      });

      const resumed = await runCli(["room", "sync", "--json"]);
      expect(resumed.status, formatCliResult(resumed)).toBe(0);
      expect(parseCliJson(resumed.stdout)).toMatchObject({
        sync: {
          mode: "cloud-sync",
          remote_room: { enabled: true, status: "mirrored" },
        },
        plan: {
          exportedIds: [],
          importedIds: [],
          matchedIds: [],
          conflicts: [],
          resolvedConflictIds: ["room-cli-conflict"],
        },
        mutation: {
          operation: "room_sync",
          accepted: true,
        },
      });

      const localMessages = await getJson<{
        messages: Array<{ id: string; text: string }>;
      }>(`${server.baseUrl}/api/v1/projects/${project.id}/room/messages`);
      expect(localMessages.messages).toEqual([
        expect.objectContaining({
          id: "room-cli-conflict",
          text: "local room text",
        }),
      ]);

      const sqlite = new DatabaseSync(join(dataDir, "local.sqlite"));
      try {
        expect(
          sqlite
            .prepare(
              `
          select project_id, message_id, strategy, local_content_hash, remote_content_hash
            from room_sync_conflict_resolution
           where project_id = ? and message_id = ?
        `,
            )
            .get(project.id, "room-cli-conflict"),
        ).toEqual({
          project_id: project.id,
          message_id: "room-cli-conflict",
          strategy: "accept-divergence",
          local_content_hash: conflict.local.contentHash,
          remote_content_hash: conflict.remote.contentHash,
        });
      } finally {
        sqlite.close();
      }
    } finally {
      await server.close();
    }
  });
});
