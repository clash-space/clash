import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalApiApp } from "./app";

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

function startLocalApiServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = createLocalApiApp({ dataDir, userId: "local-user" });
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      settled = true;
      resolve({
        baseUrl: `http://127.0.0.1:${info.port}`,
        close: () => new Promise<void>((closeResolve) => {
          let closeTimer: ReturnType<typeof setTimeout> | undefined;
          const done = () => {
            if (closeTimer) clearTimeout(closeTimer);
            closeResolve();
          };
          closeTimer = setTimeout(closeResolve, 2_000);
          server.close(done);
          (server as { closeAllConnections?: () => void }).closeAllConnections?.();
        }),
      });
    });
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
  return await response.json() as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: "Bearer clsh_local_room_e2e" },
  });
  expect(response.ok).toBe(true);
  return await response.json() as T;
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

describe("local room CLI e2e", () => {
  it("posts and reads project room messages through the real local-api HTTP server", async () => {
    const server = await startLocalApiServer();
    try {
      const project = await postJson<{ id: string }>(`${server.baseUrl}/api/v1/projects`, {
        name: "Room CLI Project",
      });
      const agentList = await getJson<{
        agents: Array<{ id: string; template_id: string; user_id: string }>;
      }>(`${server.baseUrl}/api/v1/agents`);
      const masterClash = agentList.agents.find((agent) => agent.template_id === "master-clash");
      expect(masterClash).toMatchObject({
        id: "local-master-clash",
        user_id: "local-user",
      });

      const require = createRequire(import.meta.url);
      const tsxLoader = require.resolve("tsx");
      const cliEntry = new URL("../../../packages/cli/src/index.ts", import.meta.url);
      const env = {
        ...process.env,
        CLASH_API_KEY: "clsh_local_room_e2e",
        CLASH_API_URL: server.baseUrl,
        CLASH_AGENT_MEMBER_ID: masterClash!.id,
        CLASH_HOME: clashHome,
        CLASH_PROJECT_ID: project.id,
      };
      const runCli = (args: string[]) => new Promise<{
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
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", (error) => {
          spawnError = error.message;
        });
        child.on("close", (status, signal) => {
          clearTimeout(timer);
          resolve({ status, signal, stdout, stderr, ...(spawnError ? { error: spawnError } : {}) });
        });
      });

      const posted = await runCli(["room", "say", "hello from spawned cli", "--json"]);
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
    } finally {
      await server.close();
    }
  });
});
