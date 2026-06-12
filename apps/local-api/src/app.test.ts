import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalApiApp } from "./app";
import { createLocalSyncConfigStore } from "./sync-config";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-"));
});

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe("local API app", () => {
  it("reports local health and a synthetic local session", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const health = await app.request("/health");
    expect(await health.json()).toEqual({
      ok: true,
      mode: "local",
      runtime: {
        mode: "local",
        capabilities: {
          assets: { storage: "local", signing: "unsigned", upload: "local" },
          workflows: { runner: "local-node", mediaPostprocess: "disabled" },
          loro: { persistence: "local", sync: "local-websocket" },
          auth: { mode: "local-user" },
        },
      },
    });

    const session = await app.request("/api/better-auth/get-session");
    expect(await session.json()).toEqual({
      user: { id: "local-user", name: "Local User", email: "local@clash.local" },
    });

    const me = await app.request("/api/v1/me", {
      headers: { authorization: "Bearer local-test-key" },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ id: "local-user" });
  });

  it("persists local cloud sync configuration without exposing the token", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user", syncEnv: {} });

    const initial = await app.request("/api/v1/local/sync");
    expect(await initial.json()).toEqual({
      mode: "local-only",
      remote_loro: {
        enabled: false,
        url: null,
        has_token: false,
        source: "none",
      },
    });

    const updated = await app.request("/api/v1/local/sync", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "cloud-sync",
        remote_loro_url: " https://cloud.example/ ",
        remote_loro_token: "secret-token",
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      mode: "cloud-sync",
      remote_loro: {
        enabled: true,
        url: "https://cloud.example",
        has_token: true,
        source: "config",
      },
    });

    const reopened = createLocalApiApp({ dataDir, userId: "local-user", syncEnv: {} });
    const persisted = await reopened.request("/api/v1/local/sync");
    expect(await persisted.json()).toEqual({
      mode: "cloud-sync",
      remote_loro: {
        enabled: true,
        url: "https://cloud.example",
        has_token: true,
        source: "config",
      },
    });
  });

  it("rejects cloud sync configuration without a remote Loro URL", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user", syncEnv: {} });

    const res = await app.request("/api/v1/local/sync", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "cloud-sync" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "remote_loro_url is required for cloud-sync mode",
    });
  });

  it("stores local settings variables without exposing secret values", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/settings/variables", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "OPENAI_API_KEY", value: "sk-local" }),
    });
    expect(created.status).toBe(200);
    const createdJson = (await created.json()) as { id: string; key: string; value?: string };
    expect(createdJson).toMatchObject({ key: "OPENAI_API_KEY" });
    expect(createdJson.value).toBeUndefined();

    const listed = await app.request("/api/settings/variables");
    expect(await listed.json()).toEqual([
      expect.objectContaining({
        id: createdJson.id,
        key: "OPENAI_API_KEY",
      }),
    ]);

    const removed = await app.request(`/api/settings/variables/${createdJson.id}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
    const afterDelete = await app.request("/api/settings/variables");
    expect(await afterDelete.json()).toEqual([]);
  });

  it("allows browser requests from the local web runtime", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const preflight = await app.request("/api/projects", {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:3001",
        "access-control-request-method": "GET",
      },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3001");
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");

    const crew = await app.request("/api/v1/crew");
    const crewJson = (await crew.json()) as { crew: Array<Record<string, unknown>> };
    expect(crewJson.crew).toHaveLength(5);
    expect(crewJson.crew).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "local-director",
          user_id: "local-user",
          template_id: "director",
          runtime_id: "desktop-local",
          agent_id: null,
          display_name: "Director",
          runtime_label: "Local Desktop",
          runtime_status: "online",
        }),
      ]),
    );
  });

  it("surfaces and starts the desktop local ACP runtime", async () => {
    const starts: unknown[] = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return {
            runtimes: [
              {
                id: "desktop-local",
                machine_id: "desktop-local",
                hostname: "This Mac",
                os: "darwin/arm64",
                agents: [{ id: "codex-cli", binary: "codex" }],
                version: "desktop",
                status: "online",
                last_heartbeat: 1_700_000_000,
                created_at: 1_700_000_000,
              },
            ],
          };
        },
        async createSession(params) {
          starts.push(params);
          return { session_id: "local-session-1" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });

    const runtimes = await app.request("/api/v1/runtimes");
    expect(await runtimes.json()).toEqual({
      runtimes: [
        {
          id: "desktop-local",
          machine_id: "desktop-local",
          hostname: "This Mac",
          os: "darwin/arm64",
          agents: [{ id: "codex-cli", binary: "codex" }],
          version: "desktop",
          status: "online",
          last_heartbeat: 1_700_000_000,
          created_at: 1_700_000_000,
        },
      ],
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        crew_id: "director",
        project_id: "project-1",
        resume_session_id: "acp-existing",
      }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ session_id: "local-session-1" });
    expect(starts).toEqual([
      {
        runtimeId: "desktop-local",
        crewId: "director",
        projectId: "project-1",
        resumeAcpSessionId: "acp-existing",
      },
    ]);

    const sessions = await app.request("/api/v1/runtimes/desktop-local/local-sessions/scan");
    expect(await sessions.json()).toEqual({ sessions: [] });
  });

  it("passes an explicit local ACP agent override when starting a runtime session", async () => {
    const starts: unknown[] = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return {
            runtimes: [
              {
                id: "desktop-local",
                machine_id: "desktop-local",
                hostname: "This Mac",
                os: "darwin/arm64",
                agents: [
                  { id: "claude-agent-acp", binary: "claude-agent-acp" },
                  { id: "gemini-cli", binary: "gemini" },
                ],
                version: "desktop",
                status: "online",
                last_heartbeat: 1_700_000_000,
                created_at: 1_700_000_000,
              },
            ],
          };
        },
        async createSession(params) {
          starts.push(params);
          return { session_id: "local-session-agent" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        crew_id: "director",
        agent_id: "gemini-cli",
        project_id: "project-agent",
      }),
    });

    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ session_id: "local-session-agent" });
    expect(starts).toEqual([
      {
        runtimeId: "desktop-local",
        crewId: "director",
        agentId: "gemini-cli",
        projectId: "project-agent",
      },
    ]);
  });

  it("resolves local crew_member_id when starting a desktop ACP session", async () => {
    const starts: unknown[] = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return {
            runtimes: [
              {
                id: "desktop-local",
                machine_id: "desktop-local",
                hostname: "This Mac",
                os: "darwin/arm64",
                agents: [{ id: "codex-cli", binary: "codex" }],
                version: "desktop",
                status: "online",
                last_heartbeat: 1_700_000_000,
                created_at: 1_700_000_000,
              },
            ],
          };
        },
        async createSession(params) {
          starts.push(params);
          return { session_id: "local-session-crew" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });

    const crew = await app.request("/api/v1/crew");
    const { crew: rows } = (await crew.json()) as {
      crew: Array<{ id: string; template_id: string; runtime_id: string }>;
    };
    const director = rows.find((row) => row.template_id === "director");
    expect(director).toBeTruthy();

    const created = await app.request(`/api/v1/runtimes/${director!.runtime_id}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        crew_member_id: director!.id,
        project_id: "project-crew",
      }),
    });

    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ session_id: "local-session-crew" });
    expect(starts).toEqual([
      {
        runtimeId: "desktop-local",
        crewId: "director",
        crewMemberId: director!.id,
        projectId: "project-crew",
      },
    ]);
  });

  it("returns a readable local ACP session creation error", async () => {
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return {
            runtimes: [
              {
                id: "desktop-local",
                machine_id: "desktop-local",
                hostname: "This Mac",
                os: "darwin/arm64",
                agents: [],
                version: "desktop",
                status: "online",
                last_heartbeat: 1_700_000_000,
                created_at: 1_700_000_000,
              },
            ],
          };
        },
        async createSession() {
          throw new Error("No local ACP agent found on PATH");
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ crew_id: "director", project_id: "project-1" }),
    });

    expect(created.status).toBe(503);
    expect(await created.text()).toBe(
      "No local ACP agent found. Configure CLASH_ACP_BIN_DIR or expose a native ACP CLI such as claude-agent-acp or gemini, then retry.",
    );
  });

  it("returns local ACP session history with the cloud-compatible message shape", async () => {
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "unused" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async listSessionMessages(sessionId) {
          if (sessionId !== "local-session-history") return null;
          return {
            messages: [
              {
                id: "turn-1-user",
                sender_kind: "user",
                sender_id: "local-user",
                turn_id: "turn-1",
                events: [{ type: "text", text: "hello agent" }],
                created_at: 1_700_000_000,
              },
              {
                id: "turn-1-crew",
                sender_kind: "crew",
                sender_id: "local-director",
                turn_id: "turn-1",
                events: [{ type: "text", text: "agent reply" }],
                created_at: 1_700_000_001,
              },
            ],
          };
        },
      },
    });

    const res = await app.request("/api/v1/local-sessions/local-session-history/messages");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      messages: [
        {
          id: "turn-1-user",
          sender_kind: "user",
          sender_id: "local-user",
          turn_id: "turn-1",
          events: [{ type: "text", text: "hello agent" }],
          created_at: 1_700_000_000,
        },
        {
          id: "turn-1-crew",
          sender_kind: "crew",
          sender_id: "local-director",
          turn_id: "turn-1",
          events: [{ type: "text", text: "agent reply" }],
          created_at: 1_700_000_001,
        },
      ],
    });

    const missing = await app.request("/api/v1/local-sessions/missing/messages");
    expect(missing.status).toBe(404);
  });

  it("creates, lists, renames, and deletes local projects", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ prompt: "A local-first video project" }),
      headers: { "content-type": "application/json" },
    });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };

    const listed = await app.request("/api/projects");
    const projects = (await listed.json()) as Array<{ id: string; name: string; description: string; assets: unknown[] }>;
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id,
      ownerId: "local-user",
      name: "A local-first video ...",
      description: "A local-first video project",
      assets: [],
    });

    const renamed = await app.request(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
      headers: { "content-type": "application/json" },
    });
    expect(renamed.status).toBe(200);

    const loaded = await app.request(`/api/projects/${id}`);
    expect(await loaded.json()).toMatchObject({ id, name: "Renamed" });

    const deleted = await app.request(`/api/projects/${id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect(await (await app.request("/api/projects")).json()).toEqual([]);
  });

  it("persists local project room messages", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const first = await app.request("/api/v1/projects/project-room/room/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "hello local room",
        mentions: [{ user_id: "local-user", crew_member_id: "local-director" }],
      }),
    });
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { id: string; type: string };
    expect(firstJson).toMatchObject({
      type: "room.message",
      project_id: "project-room",
      sender_kind: "user",
      sender_id: "local-user",
      sender_user_id: "local-user",
      mentions: [{ user_id: "local-user", crew_member_id: "local-director" }],
      text: "hello local room",
    });

    const listed = await app.request("/api/v1/projects/project-room/room/messages");
    expect(await listed.json()).toMatchObject({
      messages: [
        {
          id: firstJson.id,
          project_id: "project-room",
          sender_kind: "user",
          sender_id: "local-user",
          sender_user_id: "local-user",
          mentions: [{ user_id: "local-user", crew_member_id: "local-director" }],
          text: "hello local room",
        },
      ],
    });

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const persisted = await reopened.request("/api/v1/projects/project-room/room/messages");
    expect(await persisted.json()).toMatchObject({
      messages: [{ id: firstJson.id, text: "hello local room" }],
    });
  });

  it("mirrors local project room messages to the configured cloud room API", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://cloud.example/api/v1/projects/project-room/room/messages" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "remote-message-1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      syncConfig: createLocalSyncConfigStore({
        dataDir,
        env: {
          CLASH_REMOTE_LORO_URL: "https://cloud.example/",
          CLASH_REMOTE_LORO_TOKEN: "clsh_room_secret",
        },
        fetch: fetchImpl,
      }),
    });

    const res = await app.request("/api/v1/projects/project-room/room/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "hello synced room",
        mentions: [{ user_id: "local-user", crew_member_id: "local-director" }],
      }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      type: "room.message",
      text: "hello synced room",
      sync: {
        mode: "cloud-sync",
        remote_room: { enabled: true, status: "mirrored" },
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0];
    expect(String(input)).toBe("https://cloud.example/api/v1/projects/project-room/room/messages");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer clsh_room_secret");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      id: expect.any(String),
      text: "hello synced room",
      mentions: [{ user_id: "local-user", crew_member_id: "local-director" }],
      sender_kind: "user",
      sender_id: "local-user",
    });
  });

  it("imports cloud room messages into the local room list when cloud sync is enabled", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://cloud.example/api/v1/projects/project-room/room/messages" && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          messages: [
            {
              id: "remote-web-message",
              project_id: "project-room",
              sender_kind: "user",
              sender_id: "web-user",
              sender_user_id: "web-user",
              mentions: [{ user_id: "local-user", crew_member_id: "local-director" }],
              text: "hello from web",
              at: 1_700_000_100,
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      syncConfig: createLocalSyncConfigStore({
        dataDir,
        env: {
          CLASH_REMOTE_LORO_URL: "https://cloud.example/",
          CLASH_REMOTE_LORO_TOKEN: "clsh_room_secret",
        },
        fetch: fetchImpl,
      }),
    });

    const listed = await app.request("/api/v1/projects/project-room/room/messages");

    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      sync: {
        mode: "cloud-sync",
        remote_room: { enabled: true, status: "imported" },
      },
      messages: [
        {
          id: "remote-web-message",
          project_id: "project-room",
          sender_kind: "user",
          sender_id: "web-user",
          sender_user_id: "web-user",
          mentions: [{ user_id: "local-user", crew_member_id: "local-director" }],
          text: "hello from web",
          at: 1_700_000_100,
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0];
    expect(String(input)).toBe("https://cloud.example/api/v1/projects/project-room/room/messages");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer clsh_room_secret");

    const offlineApp = createLocalApiApp({ dataDir, userId: "local-user", syncEnv: {} });
    const persisted = await offlineApp.request("/api/v1/projects/project-room/room/messages");
    expect(await persisted.json()).toMatchObject({
      messages: [{ id: "remote-web-message", text: "hello from web" }],
    });
  });

  it("dispatches local project room mentions to the local ACP adapter", async () => {
    const pushed: unknown[] = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "unused" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async pushRoomMention(projectId, crewMemberId, mention) {
          pushed.push({ projectId, crewMemberId, mention });
          return true;
        },
      },
    });

    const res = await app.request("/api/v1/projects/project-room/room/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "hello local director",
        mentions: [{ user_id: "local-user", crew_member_id: "local-director" }],
      }),
    });
    expect(res.status).toBe(201);
    const message = (await res.json()) as { id: string };

    expect(pushed).toEqual([
      {
        projectId: "project-room",
        crewMemberId: "local-director",
        mention: {
          message_id: message.id,
          from_kind: "user",
          from_id: "local-user",
          from_user_id: "local-user",
          text: "hello local director",
        },
      },
    ]);
  });

  it("returns local project preview assets for the desktop project grid", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ prompt: "Desktop grid previews" }),
      headers: { "content-type": "application/json" },
    });
    const { id: projectId } = (await created.json()) as { id: string };

    for (let index = 1; index <= 4; index++) {
      const res = await app.request("/api/v1/assets", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          kind: "image",
          srcR2Key: `uploads/preview-${index}.png`,
        }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(200);
    }

    const listed = await app.request("/api/projects");
    const projects = (await listed.json()) as Array<{
      id: string;
      assets: Array<{ url: string; type: string; storageKey: string }>;
    }>;
    expect(projects[0].id).toBe(projectId);
    expect(projects[0].assets).toHaveLength(4);
    expect(new Set(projects[0].assets.map((asset) => asset.url))).toEqual(
      new Set([
        "/assets/uploads/preview-1.png",
        "/assets/uploads/preview-2.png",
        "/assets/uploads/preview-3.png",
        "/assets/uploads/preview-4.png",
      ]),
    );

    const loaded = await app.request(`/api/projects/${projectId}`);
    const project = (await loaded.json()) as { assets: unknown[] };
    expect(project.assets).toHaveLength(4);
  });

  it("stores uploaded files locally and exposes unsigned asset URLs", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const form = new FormData();
    form.append("file", new File(["hello"], "hello world.txt", { type: "text/plain" }));

    const upload = await app.request("/upload", { method: "POST", body: form });
    expect(upload.status).toBe(200);
    const { storageKey } = (await upload.json()) as { storageKey: string };
    expect(storageKey).toMatch(/^uploads\/.+-hello_world\.txt$/);

    const sign = await app.request(`/assets/sign?key=${encodeURIComponent(storageKey)}`);
    expect(await sign.json()).toMatchObject({ url: `http://localhost/assets/${storageKey}` });

    const served = await app.request(`/assets/${storageKey}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("text/plain");
    expect(await served.text()).toBe("hello");
  });

  it("returns absolute local API asset URLs for desktop clash:// pages", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const origin = "http://127.0.0.1:49321";

    const created = await app.request(`${origin}/api/v1/assets`, {
      method: "POST",
      body: JSON.stringify({
        projectId: "project-1",
        kind: "image",
        srcR2Key: "generated/mock.svg",
      }),
      headers: { "content-type": "application/json" },
    });
    const createdJson = (await created.json()) as { id: string; signedUrl?: string };
    expect(createdJson.signedUrl).toBe(`${origin}/assets/generated/mock.svg`);

    const loaded = await app.request(`${origin}/api/v1/assets/${createdJson.id}`);
    const asset = (await loaded.json()) as { signedUrl?: string };
    expect(asset.signedUrl).toBe(`${origin}/assets/generated/mock.svg`);

    const signed = await app.request(`${origin}/assets/sign?key=${encodeURIComponent("generated/mock.svg")}`);
    expect(await signed.json()).toMatchObject({
      url: `${origin}/assets/generated/mock.svg`,
    });
  });

  it("simulates the fal queue API and media CDN locally", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const origin = "http://127.0.0.1:49321";
    const modelId = "fal-ai/flux/dev";

    const submitted = await app.request(`${origin}/fal/${modelId}`, {
      method: "POST",
      headers: {
        authorization: "Key mock",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt: "a local fal dog",
        image_size: "landscape_16_9",
        output_format: "png",
      }),
    });
    expect(submitted.status).toBe(200);
    const submitJson = (await submitted.json()) as {
      request_id: string;
      response_url: string;
      status_url: string;
      cancel_url: string;
      queue_position: number;
    };
    expect(submitJson.request_id).toMatch(/^fal-mock-/);
    expect(submitJson.response_url).toBe(`${origin}/fal/${modelId}/requests/${submitJson.request_id}/response`);
    expect(submitJson.status_url).toBe(`${origin}/fal/${modelId}/requests/${submitJson.request_id}/status`);
    expect(submitJson.cancel_url).toBe(`${origin}/fal/${modelId}/requests/${submitJson.request_id}/cancel`);
    expect(submitJson.queue_position).toBe(0);

    const queued = await app.request(submitJson.status_url);
    expect(queued.status).toBe(202);
    expect(await queued.json()).toMatchObject({
      status: "IN_QUEUE",
      request_id: submitJson.request_id,
      queue_position: 0,
      response_url: submitJson.response_url,
    });

    const running = await app.request(`${submitJson.status_url}?logs=1`);
    expect(running.status).toBe(202);
    expect(await running.json()).toMatchObject({
      status: "IN_PROGRESS",
      request_id: submitJson.request_id,
      response_url: submitJson.response_url,
      logs: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("Generating") }),
      ]),
    });

    const completed = await app.request(`${submitJson.status_url}?logs=1`);
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      status: "COMPLETED",
      request_id: submitJson.request_id,
      response_url: submitJson.response_url,
      logs: [expect.objectContaining({ message: "Done." })],
      metrics: { inference_time: expect.any(Number) },
    });

    const result = await app.request(submitJson.response_url);
    expect(result.status).toBe(200);
    const resultJson = (await result.json()) as {
      images: Array<{ url: string; width: number; height: number; content_type: string }>;
      prompt: string;
      seed: number;
      has_nsfw_concepts: boolean[];
    };
    expect(resultJson).toMatchObject({
      prompt: "a local fal dog",
      seed: expect.any(Number),
      has_nsfw_concepts: [false],
    });
    expect(resultJson.images[0]).toMatchObject({
      url: `${origin}/fal/media/${submitJson.request_id}.svg`,
      width: 1024,
      height: 576,
      content_type: "image/svg+xml",
    });

    const media = await app.request(resultJson.images[0].url);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toContain("image/svg+xml");
    expect(await media.text()).toContain("a local fal dog");
  });

  it("simulates fal video and audio outputs with prompt, aspect ratio, and duration", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const origin = "http://127.0.0.1:49321";

    const videoSubmitted = await app.request(`${origin}/fal/fal-ai/sora-2/text-to-video`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "vertical video prompt",
        duration: 4,
        aspect_ratio: "9:16",
      }),
    });
    const videoSubmitJson = (await videoSubmitted.json()) as {
      request_id: string;
      status_url: string;
      response_url: string;
    };
    await app.request(videoSubmitJson.status_url);
    await app.request(videoSubmitJson.status_url);
    await app.request(videoSubmitJson.status_url);
    const videoResponse = await app.request(videoSubmitJson.response_url);
    expect(videoResponse.status).toBe(200);
    const videoJson = (await videoResponse.json()) as {
      video: { url: string; width: number; height: number; duration: number; content_type: string };
      prompt: string;
    };
    expect(videoJson.prompt).toBe("vertical video prompt");
    expect(videoJson.video).toMatchObject({
      url: `${origin}/fal/media/${videoSubmitJson.request_id}.mp4`,
      width: 720,
      height: 1280,
      duration: 4,
      content_type: "video/mp4",
    });
    const videoMedia = await app.request(videoJson.video.url);
    expect(videoMedia.status).toBe(200);
    expect(videoMedia.headers.get("content-type")).toContain("video/mp4");
    expect(videoMedia.headers.get("content-length")).not.toBe("0");

    const audioSubmitted = await app.request(`${origin}/fal/fal-ai/minimax/speech-02-hd`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "audio content prompt",
        duration: 3,
      }),
    });
    const audioSubmitJson = (await audioSubmitted.json()) as {
      request_id: string;
      status_url: string;
      response_url: string;
    };
    await app.request(audioSubmitJson.status_url);
    await app.request(audioSubmitJson.status_url);
    await app.request(audioSubmitJson.status_url);
    const audioResponse = await app.request(audioSubmitJson.response_url);
    expect(audioResponse.status).toBe(200);
    const audioJson = (await audioResponse.json()) as {
      audio: { url: string; duration: number; content_type: string };
      prompt: string;
      transcript: string;
    };
    expect(audioJson.prompt).toBe("audio content prompt");
    expect(audioJson.transcript).toBe("audio content prompt");
    expect(audioJson.audio).toMatchObject({
      url: `${origin}/fal/media/${audioSubmitJson.request_id}.wav`,
      duration: 3,
      content_type: "audio/wav",
    });
    const audioMedia = await app.request(audioJson.audio.url);
    expect(audioMedia.status).toBe(200);
    expect(audioMedia.headers.get("content-type")).toContain("audio/wav");
    expect(await audioMedia.text()).toContain("audio content prompt");
  });
});
