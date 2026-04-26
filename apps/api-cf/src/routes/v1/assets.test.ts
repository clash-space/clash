import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../config";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class MockDurableObject {},
  WorkerEntrypoint: class MockWorkerEntrypoint {},
}));

// Pull the routes directly — no need to mock the rest of the app.
import { assetsRoutes } from "./assets";

/** Build a D1 mock that lets each test orchestrate prepare→bind→{run, first} per call. */
function makeDb() {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];
  const responses = {
    project: null as { ownerId: string } | null,
    asset: null as Record<string, unknown> | null,
    assets: [] as Record<string, unknown>[],
  };
  const prepare = vi.fn((sql: string) => {
    return {
      bind: (...binds: unknown[]) => {
        calls.push({ sql, binds });
        return {
          run: vi.fn().mockResolvedValue({}),
          first: vi.fn().mockImplementation(async () => {
            if (sql.includes("FROM project")) return responses.project;
            if (sql.includes("FROM assets")) return responses.asset;
            return null;
          }),
          all: vi.fn().mockImplementation(async () => {
            if (sql.includes("FROM assets")) return { results: responses.assets };
            return { results: [] };
          }),
        };
      },
    };
  });
  return { db: { prepare } as unknown as D1Database, calls, responses, prepare };
}

function makeEnv(overrides: { db?: D1Database } = {}): Env {
  const { db } = makeDb();
  return {
    DB: overrides.db ?? db,
    R2_BUCKET: {
      head: vi.fn().mockResolvedValue({ size: 1024 }),
      get: vi.fn().mockResolvedValue(null),
    } as any,
    R2_PUBLIC_URL: "",
    ENVIRONMENT: "test",
    GOOGLE_API_KEY: "",
    CF_AIG_TOKEN: "",
    KLING_ACCESS_KEY: "",
    KLING_SECRET_KEY: "",
    ROOM: {} as any,
    SUPERVISOR: {} as any,
    GENERATION_WORKFLOW: {} as any,
    RENDER_CONTAINER: {} as any,
  } as Env;
}

/** Wrap assetsRoutes in a tiny app for app.request() driving. */
function makeApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/v1/assets", assetsRoutes);
  return { app, env };
}

const AUTH = { "x-user-id": "user-1" };

describe("assetsRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-2222-3333-4444-555555555555");
  });

  // ─── POST /v1/assets ─────────────────────────────────────

  describe("POST /v1/assets", () => {
    it("rejects missing x-user-id header", async () => {
      const env = makeEnv();
      const { app } = makeApp(env);
      const res = await app.request("/v1/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p", kind: "image", srcR2Key: "k" }),
      }, env);
      expect(res.status).toBe(400);
    });

    it("rejects when caller does not own the project", async () => {
      const dbMock = makeDb();
      dbMock.responses.project = { ownerId: "someone-else" };
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);

      const res = await app.request("/v1/assets", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1", kind: "image", srcR2Key: "k" }),
      }, env);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not owned/);
    });

    it("rejects unknown project", async () => {
      const dbMock = makeDb();
      dbMock.responses.project = null;
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);

      const res = await app.request("/v1/assets", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ projectId: "ghost", kind: "image", srcR2Key: "k" }),
      }, env);
      expect(res.status).toBe(400);
    });

    it("creates asset + ref when caller owns the project", async () => {
      const dbMock = makeDb();
      dbMock.responses.project = { ownerId: "user-1" };
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);

      const res = await app.request("/v1/assets", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "p1",
          kind: "image",
          srcR2Key: "uploads/x.png",
          bytes: 1024,
        }),
      }, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBe("11111111-2222-3333-4444-555555555555");

      // Should have run: SELECT project owner, INSERT assets, INSERT asset_refs
      const sqls = dbMock.calls.map((c) => c.sql);
      expect(sqls.some((s) => /FROM project/.test(s))).toBe(true);
      expect(sqls.some((s) => /INSERT OR REPLACE INTO assets/.test(s))).toBe(true);
      expect(sqls.some((s) => /INSERT OR IGNORE INTO asset_refs/.test(s))).toBe(true);
    });

    it("validates required fields via zod", async () => {
      const dbMock = makeDb();
      dbMock.responses.project = { ownerId: "user-1" };
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);

      // Missing srcR2Key
      const res = await app.request("/v1/assets", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1", kind: "image" }),
      }, env);
      expect(res.status).toBe(400);
    });

    it("rejects invalid kind", async () => {
      const env = makeEnv();
      const { app } = makeApp(env);
      const res = await app.request("/v1/assets", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1", kind: "document", srcR2Key: "k" }),
      }, env);
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /v1/assets/:id ──────────────────────────────────

  describe("POST /v1/assets/batch", () => {
    it("returns owned asset rows in one response", async () => {
      const dbMock = makeDb();
      dbMock.responses.assets = [
        {
          id: "a",
          userId: "user-1",
          kind: "image",
          srcR2Key: "uploads/a.png",
          coverR2Key: null,
          metadata: "{\"width\":100,\"height\":50}",
          sourceModel: null,
          sourcePrompt: null,
          sourceTaskId: null,
          sources: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ];
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);

      const res = await app.request("/v1/assets/batch", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ ids: ["a", "b"] }),
      }, env);

      expect(res.status).toBe(200);
      const body = await res.json() as { assets: Array<{ id: string; metadata: { width: number } }> };
      expect(body.assets).toHaveLength(1);
      expect(body.assets[0].id).toBe("a");
      expect(body.assets[0].metadata.width).toBe(100);
      expect(dbMock.calls.at(-1)?.binds).toEqual(["user-1", "a", "b"]);
    });
  });

  describe("GET /v1/assets/:id", () => {
    it("404 when not found", async () => {
      const dbMock = makeDb();
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);
      const res = await app.request("/v1/assets/missing", { headers: AUTH }, env);
      expect(res.status).toBe(404);
    });

    it("403 when caller is not the owner", async () => {
      const dbMock = makeDb();
      dbMock.responses.asset = {
        id: "a", userId: "other", kind: "image", srcR2Key: "k",
        coverR2Key: null, width: null, height: null, durationMs: null, bytes: null,
        sourceModel: null, sourcePrompt: null, sourceTaskId: null,
        createdAt: 1, updatedAt: 1,
      };
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);
      const res = await app.request("/v1/assets/a", { headers: AUTH }, env);
      expect(res.status).toBe(403);
    });

    it("returns asset for the owner", async () => {
      const dbMock = makeDb();
      dbMock.responses.asset = {
        id: "a", userId: "user-1", kind: "video", srcR2Key: "k",
        coverR2Key: "cover/k.jpg", width: 1920, height: 1080, durationMs: 5000, bytes: null,
        sourceModel: null, sourcePrompt: null, sourceTaskId: null,
        createdAt: 1, updatedAt: 1,
      };
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);
      const res = await app.request("/v1/assets/a", { headers: AUTH }, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; coverR2Key: string };
      expect(body.id).toBe("a");
      expect(body.coverR2Key).toBe("cover/k.jpg");
    });
  });

  // ─── DELETE /v1/assets/:id/ref ───────────────────────────

  describe("DELETE /v1/assets/:id/ref", () => {
    it("requires projectId query parameter", async () => {
      const env = makeEnv();
      const { app } = makeApp(env);
      const res = await app.request("/v1/assets/a/ref", {
        method: "DELETE",
        headers: AUTH,
      }, env);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/projectId required/);
    });

    it("blocks delete if caller does not own the project", async () => {
      const dbMock = makeDb();
      dbMock.responses.project = { ownerId: "other" };
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);
      const res = await app.request("/v1/assets/a/ref?projectId=p1", {
        method: "DELETE",
        headers: AUTH,
      }, env);
      expect(res.status).toBe(400);
    });

    it("removes the (asset, project) pair when authorized", async () => {
      const dbMock = makeDb();
      dbMock.responses.project = { ownerId: "user-1" };
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);
      const res = await app.request("/v1/assets/a/ref?projectId=p1", {
        method: "DELETE",
        headers: AUTH,
      }, env);
      expect(res.status).toBe(200);
      const sqls = dbMock.calls.map((c) => c.sql);
      expect(sqls.some((s) => /DELETE FROM asset_refs/.test(s))).toBe(true);
    });
  });

  // ─── PATCH /v1/assets/:id/cover ──────────────────────────

  describe("PATCH /v1/assets/:id/cover", () => {
    it("404 when asset missing", async () => {
      const env = makeEnv();
      const { app } = makeApp(env);
      const res = await app.request("/v1/assets/missing/cover", {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ coverR2Key: "k" }),
      }, env);
      expect(res.status).toBe(404);
    });

    it("403 when caller does not own the asset", async () => {
      const dbMock = makeDb();
      dbMock.responses.asset = {
        id: "a", userId: "other", kind: "video", srcR2Key: "k",
        coverR2Key: null, width: null, height: null, durationMs: null, bytes: null,
        sourceModel: null, sourcePrompt: null, sourceTaskId: null,
        createdAt: 1, updatedAt: 1,
      };
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);
      const res = await app.request("/v1/assets/a/cover", {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ coverR2Key: "covers/x.jpg" }),
      }, env);
      expect(res.status).toBe(403);
    });

    it("updates cover when authorized", async () => {
      const dbMock = makeDb();
      dbMock.responses.asset = {
        id: "a", userId: "user-1", kind: "video", srcR2Key: "k",
        coverR2Key: null, width: null, height: null, durationMs: null, bytes: null,
        sourceModel: null, sourcePrompt: null, sourceTaskId: null,
        createdAt: 1, updatedAt: 1,
      };
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);
      const res = await app.request("/v1/assets/a/cover", {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ coverR2Key: "covers/x.jpg" }),
      }, env);
      expect(res.status).toBe(200);
      const sqls = dbMock.calls.map((c) => c.sql);
      expect(sqls.some((s) => /UPDATE assets SET cover_r2_key/.test(s))).toBe(true);
    });

    it("400 on missing coverR2Key in body", async () => {
      const dbMock = makeDb();
      dbMock.responses.asset = {
        id: "a", userId: "user-1", kind: "video", srcR2Key: "k",
        coverR2Key: null, width: null, height: null, durationMs: null, bytes: null,
        sourceModel: null, sourcePrompt: null, sourceTaskId: null,
        createdAt: 1, updatedAt: 1,
      };
      const env = makeEnv({ db: dbMock.db });
      const { app } = makeApp(env);
      const res = await app.request("/v1/assets/a/cover", {
        method: "PATCH",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({}),
      }, env);
      expect(res.status).toBe(400);
    });
  });
});
