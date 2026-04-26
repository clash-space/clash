import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../config";
import { computeSignature, getSigningKey } from "../services/asset-signing";

// Mock the agents package which uses cloudflare: protocol imports
vi.mock("agents", () => ({
  Agent: class MockAgent {},
}));

// Mock cloudflare:workers protocol imports
vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class MockWorkflowEntrypoint {},
  WorkerEntrypoint: class MockWorkerEntrypoint {},
  DurableObject: class MockDurableObject {},
}));

// Mock describe service
vi.mock("../services/describe", () => ({
  generateDescription: vi.fn().mockResolvedValue("A description"),
}));

// Mock generation module (depends on cloudflare:workers)
vi.mock("../agents/generation", () => ({
  GenerationWorkflow: class MockGeneration {},
}));

// Mock project-room module (depends on cloudflare:workers)
vi.mock("../agents/project-room", () => ({
  ProjectRoom: class MockProjectRoom {},
}));

// Mock supervisor module (depends on agents, @cloudflare/ai-chat)
vi.mock("../agents/supervisor", () => ({
  SupervisorAgent: class MockSupervisor {},
}));

// We need to import the app after mocks are set up
import app from "../index";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GOOGLE_API_KEY: "test-key",
    GOOGLE_AI_STUDIO_BASE_URL: "",
    CF_AIG_TOKEN: "",
    KLING_ACCESS_KEY: "",
    KLING_SECRET_KEY: "",
    R2_BUCKET: {
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    } as any,
    R2_PUBLIC_URL: "https://r2.example.com",
    JWT_SECRET: "test-secret",
    ENVIRONMENT: "production",
    ROOM: {
      idFromName: vi.fn().mockReturnValue("room-id"),
      get: vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue(new Response("ok")),
      }),
    } as any,
    GENERATION_WORKFLOW: {
      create: vi.fn().mockResolvedValue({ id: "wf-id" }),
    } as any,
    RENDER_CONTAINER: {} as any,
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
  } as Env;
}

describe("Hono routes", () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("caches", {
      default: {
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      },
    });
    env = makeEnv();
    // Mock crypto.randomUUID
    vi.spyOn(crypto, "randomUUID").mockReturnValue("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  async function signedAssetPath(storageKey: string): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const key = await getSigningKey(env);
    const sig = await computeSignature(key, storageKey, exp);
    return `/assets/${storageKey}?exp=${exp}&sig=${sig}`;
  }

  // ─── Health check ───

  describe("GET /health", () => {
    it("returns 200 { status: 'ok' }", async () => {
      const res = await app.request("/health", {}, env);
      expect(res.status).toBe(200);
      const json: any = await res.json();
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
        size: body.byteLength,
      });

      const res = await app.request(await signedAssetPath("projects/p1/img.png"), {}, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
    });

    it("returns 404 for missing asset", async () => {
      (env.R2_BUCKET.get as any).mockResolvedValue(null);

      const res = await app.request(await signedAssetPath("missing-key"), {}, env);
      expect(res.status).toBe(404);
    });

    it("signs multiple assets in one request", async () => {
      const res = await app.request("/assets/sign-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: ["uploads/a.png", "uploads/b.png"] }),
      }, env);

      expect(res.status).toBe(200);
      const body = await res.json() as { urls: Array<{ key: string; url: string; exp: number }> };
      expect(body.urls).toHaveLength(2);
      expect(body.urls[0].key).toBe("uploads/a.png");
      expect(body.urls[0].url).toMatch(/^\/assets\/uploads\/a\.png\?exp=\d+&sig=/);
      expect(body.urls[1].key).toBe("uploads/b.png");
    });

    it("serves range requests from R2 even when the full object is cached", async () => {
      const storageKey = "projects/p1/video.mp4";
      const cached = new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "Content-Type": "video/mp4" },
      });
      (caches.default.match as any).mockResolvedValue(cached);
      (env.R2_BUCKET.head as any) = vi.fn().mockResolvedValue({ size: 100 });
      (env.R2_BUCKET.get as any).mockResolvedValue({
        body: new Response(new Uint8Array([10, 11, 12, 13, 14, 15])).body,
        httpMetadata: { contentType: "video/mp4" },
      });

      const res = await app.request(await signedAssetPath(storageKey), {
        headers: { Range: "bytes=10-15" },
      }, env);

      expect(res.status).toBe(206);
      expect(res.headers.get("Content-Range")).toBe("bytes 10-15/100");
      expect(caches.default.match).not.toHaveBeenCalled();
      expect(env.R2_BUCKET.get).toHaveBeenCalledWith(storageKey, {
        range: { offset: 10, length: 6 },
      });
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

      const json: any = await res.json();
      expect(json.storageKey).toMatch(/^uploads\/aaaaaaaa-test\.png$/);

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
      const json: any = await res.json();
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
      const json: any = await res.json();
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
      const json: any = await res.json();
      expect(json.status).toBe("completed");
    });

    it("submits audio_gen to the generation workflow", async () => {
      const res = await app.request(
        "/api/tasks/submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_type: "audio_gen",
            project_id: "proj-1",
            node_id: "node-1",
            params: {
              prompt: "read this aloud",
              model: "gemini-3.1-flash-tts",
              model_params: { voice_name: "Kore" },
            },
          }),
        },
        env
      );

      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json).toEqual({
        task_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        status: "pending",
      });
      expect(env.GENERATION_WORKFLOW.create).toHaveBeenCalledWith({
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        params: expect.objectContaining({
          taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          nodeId: "node-1",
          type: "audio_gen",
          projectId: "proj-1",
          prompt: "read this aloud",
          modelName: "gemini-3.1-flash-tts",
          modelParams: { voice_name: "Kore" },
        }),
      });
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
            userId: "user-1",
            kind: "image",
            srcR2Key: "projects/proj-1/assets/img.png",
            coverR2Key: null,
            width: null, height: null, durationMs: null, bytes: null,
            sourceModel: null, sourcePrompt: null, sourceTaskId: "task-123",
            createdAt: 1234567890, updatedAt: 1234567890,
          }),
        }),
      });

      const res = await app.request("/api/tasks/task-123", {}, env);
      expect(res.status).toBe(200);

      const json: any = await res.json();
      expect(json.task_id).toBe("task-123");
      expect(json.status).toBe("completed");
      expect(json.asset_id).toBe("asset-1");
      expect(json.result_url).toBe("projects/proj-1/assets/img.png");
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

    it("propagates cover_r2_key into response when present", async () => {
      (env.DB.prepare as any).mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: "asset-vid",
            userId: "u-1",
            kind: "video",
            srcR2Key: "projects/p1/assets/v.mp4",
            coverR2Key: "projects/p1/assets/v-cover.jpg",
            width: null, height: null, durationMs: null, bytes: null,
            sourceModel: null, sourcePrompt: null, sourceTaskId: "t-vid",
            createdAt: 1, updatedAt: 1,
          }),
        }),
      });

      const res = await app.request("/api/tasks/t-vid", {}, env);
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.asset_id).toBe("asset-vid");
      expect(json.result_url).toBe("projects/p1/assets/v.mp4");
      expect(json.result_data.cover_url).toBe("projects/p1/assets/v-cover.jpg");
    });
  });

  // ─── submitToWorkflow failure path ───

  describe("POST /api/tasks/submit error handling", () => {
    it("returns 500 when workflow.create throws (does NOT write to D1)", async () => {
      (env.GENERATION_WORKFLOW.create as any).mockRejectedValueOnce(new Error("Workflow service unavailable"));
      const dbRun = vi.fn().mockResolvedValue({});
      (env.DB.prepare as any).mockReturnValue({
        bind: vi.fn().mockReturnValue({ run: dbRun, first: vi.fn().mockResolvedValue(null), all: vi.fn().mockResolvedValue({ results: [] }) }),
      });

      const res = await app.request(
        "/api/tasks/submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_type: "image_gen",
            project_id: "proj-1",
            node_id: "node-1",
            params: { prompt: "x" },
          }),
        },
        env,
      );

      expect(res.status).toBe(500);
      // Asset creation only happens inside the workflow; submit-failure must not write D1.
      expect(dbRun).not.toHaveBeenCalled();
    });
  });

  // ─── POST /api/custom-action/upload ───

  describe("POST /api/custom-action/upload", () => {
    it("rejects when required form fields are missing", async () => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));
      // missing projectId / taskId / nodeId

      const res = await app.request("/api/custom-action/upload", { method: "POST", body: form }, env);
      expect(res.status).toBe(400);
    });

    it("text outputType returns content without R2 upload or DB write", async () => {
      const r2Put = env.R2_BUCKET.put as any;
      const dbPrepare = env.DB.prepare as any;

      const form = new FormData();
      form.append("projectId", "p1");
      form.append("taskId", "task-1");
      form.append("nodeId", "node-1");
      form.append("outputType", "text");
      form.append("content", "hello world");

      const res = await app.request("/api/custom-action/upload", { method: "POST", body: form }, env);
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.content).toBe("hello world");
      expect(json.storageKey).toBeNull();
      expect(r2Put).not.toHaveBeenCalled();
      expect(dbPrepare).not.toHaveBeenCalled();
    });

    it("image outputType uploads to R2 + writes asset row + returns assetId", async () => {
      // Project owner lookup returns user-1; subsequent prepare calls run insert.
      (env.DB.prepare as any).mockImplementation((sql: string) => ({
        bind: vi.fn().mockReturnValue({
          run: vi.fn().mockResolvedValue({}),
          first: vi.fn().mockImplementation(async () => {
            if (sql.includes("FROM project")) return { ownerId: "user-1" };
            return null;
          }),
        }),
      }));

      const form = new FormData();
      form.append("projectId", "p1");
      form.append("taskId", "task-img");
      form.append("nodeId", "node-1");
      form.append("outputType", "image");
      form.append("file", new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));

      const res = await app.request("/api/custom-action/upload", { method: "POST", body: form }, env);
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.storageKey).toMatch(/projects\/p1\/custom\/task-img\.png/);
      expect(json.assetId).toBe("task-img");
      expect(env.R2_BUCKET.put).toHaveBeenCalled();
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
      const json: any = await res.json();
      expect(json.task_id).toBe("task-desc");
      expect(json.status).toBe("generating");
    });
  });
});
