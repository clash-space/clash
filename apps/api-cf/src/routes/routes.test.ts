import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../config";

// Mock the agents package which uses cloudflare: protocol imports
vi.mock("agents", () => ({
  Agent: class MockAgent {},
}));

// Mock describe service
vi.mock("../services/describe", () => ({
  generateDescription: vi.fn().mockResolvedValue("A description"),
}));

// Mock generation module (depends on agents)
vi.mock("../agents/generation", () => ({
  GenerationAgent: class MockGeneration {},
}));

// Mock project-room module (depends on agents)
vi.mock("../agents/project-room", () => ({
  ProjectRoom: class MockProjectRoom {},
}));

// We need to import the app after mocks are set up
import app from "../index";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GOOGLE_API_KEY: "test-key",
    GOOGLE_AI_STUDIO_BASE_URL: "",
    KLING_ACCESS_KEY: "",
    KLING_SECRET_KEY: "",
    R2_BUCKET: {
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    } as any,
    R2_PUBLIC_URL: "https://r2.example.com",
    ENVIRONMENT: "production",
    ROOM: {
      idFromName: vi.fn().mockReturnValue("room-id"),
      get: vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue(new Response("ok")),
      }),
    } as any,
    GENERATION: {
      idFromName: vi.fn().mockReturnValue("gen-id"),
      get: vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue(new Response("ok")),
      }),
    } as any,
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run: vi.fn().mockResolvedValue({}),
          all: vi.fn().mockResolvedValue({ results: [] }),
          first: vi.fn().mockResolvedValue(null),
        }),
      }),
    } as any,
    WORKER_PUBLIC_URL: "https://api.example.com",
    ...overrides,
  };
}

describe("Hono routes", () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    env = makeEnv();
    // Mock crypto.randomUUID
    vi.spyOn(crypto, "randomUUID").mockReturnValue("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  // ─── Health check ───

  describe("GET /health", () => {
    it("returns 200 { status: 'ok' }", async () => {
      const res = await app.request("/health", {}, env);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ status: "ok" });
    });
  });

  // ─── Assets ───

  describe("GET /assets/*", () => {
    it("returns asset from R2", async () => {
      const body = new Uint8Array([1, 2, 3]);
      (env.R2_BUCKET.get as any).mockResolvedValue({
        body: new Response(body).body,
        httpMetadata: { contentType: "image/png" },
      });

      const res = await app.request("/assets/projects/p1/img.png", {}, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
    });

    it("returns 404 for missing asset", async () => {
      (env.R2_BUCKET.get as any).mockResolvedValue(null);

      const res = await app.request("/assets/missing-key", {}, env);
      expect(res.status).toBe(404);
    });
  });

  // ─── Upload ───

  describe("POST /upload", () => {
    it("uploads file to R2 and returns storageKey + url", async () => {
      const formData = new FormData();
      const file = new File([new Uint8Array([1, 2, 3])], "test.png", { type: "image/png" });
      formData.append("file", file);
      formData.append("projectId", "proj-1");

      const req = new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      });

      const res = await app.request(req, {}, env);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.storageKey).toMatch(/^projects\/proj-1\/assets\//);
      expect(json.url).toMatch(/^https:\/\/api\.example\.com\/assets\//);

      expect(env.R2_BUCKET.put).toHaveBeenCalled();
    });

    it("returns 400 when file is missing", async () => {
      const formData = new FormData();
      formData.append("projectId", "proj-1");

      const req = new Request("http://localhost/upload", {
        method: "POST",
        body: formData,
      });

      const res = await app.request(req, {}, env);
      expect(res.status).toBe(400);
    });
  });

  // ─── Thumbnails ───

  describe("GET /thumbnails/*", () => {
    it("returns thumbnail from R2", async () => {
      const body = new Uint8Array([10, 20, 30]);
      (env.R2_BUCKET.get as any).mockResolvedValue({
        body: new Response(body).body,
        httpMetadata: { contentType: "image/jpeg" },
      });

      const res = await app.request("/thumbnails/projects/p1/video.mp4", {}, env);
      expect(res.status).toBe(200);
    });

    it("returns 404 when neither thumbnail nor original exists", async () => {
      (env.R2_BUCKET.get as any).mockResolvedValue(null);

      const res = await app.request("/thumbnails/missing.mp4", {}, env);
      expect(res.status).toBe(404);
    });
  });

  // ─── POST /api/generate-ids ───

  describe("POST /api/generate-ids", () => {
    it("returns generated IDs", async () => {
      const res = await app.request(
        "/api/generate-ids",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: "proj-1", count: 3 }),
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ids).toHaveLength(3);
      expect(json.project_id).toBe("proj-1");
    });
  });

  // ─── POST /api/tasks/submit ───

  describe("POST /api/tasks/submit", () => {
    it("submits image_gen task → 200 { task_id }", async () => {
      const res = await app.request(
        "/api/tasks/submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_type: "image_gen",
            project_id: "proj-1",
            node_id: "node-1",
            params: { prompt: "a cat", model: "nano-banana-pro" },
          }),
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.task_id).toBeDefined();
      expect(json.status).toBe("pending");
    });

    it("submits video_gen without image → 400", async () => {
      (env.R2_BUCKET.get as any).mockResolvedValue(null);

      const res = await app.request(
        "/api/tasks/submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_type: "video_gen",
            project_id: "proj-1",
            node_id: "node-1",
            params: { prompt: "a sunset" },
          }),
        },
        env
      );

      expect(res.status).toBe(400);
    });

    it("submits video_thumbnail → 200 completed (no-op)", async () => {
      const res = await app.request(
        "/api/tasks/submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_type: "video_thumbnail",
            project_id: "proj-1",
            node_id: "node-1",
            params: {},
          }),
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("completed");
    });

    it("submits audio_gen → 501 not supported", async () => {
      const res = await app.request(
        "/api/tasks/submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_type: "audio_gen",
            project_id: "proj-1",
            node_id: "node-1",
            params: {},
          }),
        },
        env
      );

      expect(res.status).toBe(501);
    });

    it("submits video_render → 501 client-side", async () => {
      const res = await app.request(
        "/api/tasks/submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_type: "video_render",
            project_id: "proj-1",
            node_id: "node-1",
            params: {},
          }),
        },
        env
      );

      expect(res.status).toBe(501);
    });
  });

  // ─── GET /api/tasks/:taskId ───

  describe("GET /api/tasks/:taskId", () => {
    it("returns task status from D1", async () => {
      (env.DB.prepare as any).mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "asset-1",
            name: "image",
            projectId: "proj-1",
            storageKey: "key",
            url: "https://r2.example.com/img.png",
            type: "image",
            status: "completed",
            taskId: "task-123",
            metadata: null,
            description: "A cat",
            createdAt: 1234567890,
          }),
        }),
      });

      const res = await app.request("/api/tasks/task-123", {}, env);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.task_id).toBe("task-123");
      expect(json.status).toBe("completed");
      expect(json.result_url).toBe("https://r2.example.com/img.png");
      expect(json.result_data.description).toBe("A cat");
    });

    it("returns 404 for missing task", async () => {
      (env.DB.prepare as any).mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
      });

      const res = await app.request("/api/tasks/missing", {}, env);
      expect(res.status).toBe(404);
    });
  });

  // ─── POST /api/describe ───
  // Note: /api/describe uses c.executionCtx.waitUntil() which requires a real
  // Cloudflare execution context. Hono's app.request() doesn't provide this.
  // This endpoint is tested indirectly via the describe service mock.
  // We can test it by providing executionCtx in the env bindings.

  describe("POST /api/describe", () => {
    it("returns task_id and processing status", async () => {
      // Hono's app.request(path, init, env, executionCtx) takes executionCtx as 4th arg
      const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
      const req = new Request("http://localhost/api/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/img.png", task_id: "task-desc" }),
      });

      const res = await app.request(req, undefined, env, executionCtx as any);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.task_id).toBe("task-desc");
      expect(json.status).toBe("processing");
    });
  });
});
