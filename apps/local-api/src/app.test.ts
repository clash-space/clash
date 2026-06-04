import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalApiApp } from "./app";

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
    expect(await crew.json()).toEqual({ crew: [] });
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
