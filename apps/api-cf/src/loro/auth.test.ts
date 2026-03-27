import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as jose from "jose";

// We test the module's exported function by importing it.
// Global fetch is mocked to prevent real BetterAuth calls.
import { authenticateRequest } from "./auth";
import type { Env } from "../config";

const JWT_SECRET = "test-secret-key-for-unit-tests";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GOOGLE_API_KEY: "",
    CF_AIG_TOKEN: "",
    KLING_ACCESS_KEY: "",
    KLING_SECRET_KEY: "",
    R2_BUCKET: {} as any,
    R2_PUBLIC_URL: "",
    ENVIRONMENT: "production",
    ROOM: {} as any,
    SUPERVISOR: {} as any,
    GENERATION_WORKFLOW: {} as any,
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [{ owner_id: "user-1" }] }),
        }),
      }),
    } as any,
    JWT_SECRET,
    ...overrides,
  };
}

async function signJWT(
  payload: Record<string, unknown>,
  secret: string,
  options: { expiresIn?: string } = {}
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  let builder = new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt();
  if (options.expiresIn) {
    builder = builder.setExpirationTime(options.expiresIn);
  } else {
    builder = builder.setExpirationTime("1h");
  }
  return builder.sign(key);
}

describe("auth", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock global fetch so BetterAuth session check returns null
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(null), { status: 200 })
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ─── extractTokenFromRequest (tested via authenticateRequest) ───

  describe("extractTokenFromRequest", () => {
    it("extracts token from query param ?token=xxx", async () => {
      const token = await signJWT({ sub: "user-1", projectId: "proj-1" }, JWT_SECRET);
      const request = new Request(`http://localhost/sync/proj-1?token=${token}`);
      const env = makeEnv();

      const result = await authenticateRequest(request, env, "proj-1");
      expect(result.userId).toBe("user-1");
      expect(result.projectId).toBe("proj-1");
    });

    it("extracts token from Authorization: Bearer header", async () => {
      const token = await signJWT({ sub: "user-1", projectId: "proj-1" }, JWT_SECRET);
      const request = new Request("http://localhost/sync/proj-1", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const env = makeEnv();

      const result = await authenticateRequest(request, env, "proj-1");
      expect(result.userId).toBe("user-1");
      expect(result.projectId).toBe("proj-1");
    });

    it("returns null when no token → leads to Unauthorized in production", async () => {
      const request = new Request("http://localhost/sync/proj-1");
      const env = makeEnv({ ENVIRONMENT: "production" });

      await expect(authenticateRequest(request, env, "proj-1")).rejects.toThrow("Unauthorized");
    });
  });

  // ─── JWT verification ───

  describe("JWT verification", () => {
    it("valid token → returns userId + projectId", async () => {
      const token = await signJWT({ sub: "user-1", projectId: "proj-1" }, JWT_SECRET);
      const request = new Request(`http://localhost/sync/proj-1?token=${token}`);
      const env = makeEnv();

      const result = await authenticateRequest(request, env, "proj-1");
      expect(result).toEqual({ userId: "user-1", projectId: "proj-1" });
    });

    it("expired token → throws", async () => {
      const key = new TextEncoder().encode(JWT_SECRET);
      const token = await new jose.SignJWT({ sub: "user-1", projectId: "proj-1" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // 1 hour ago
        .sign(key);

      const request = new Request(`http://localhost/sync/proj-1?token=${token}`);
      const env = makeEnv();

      await expect(authenticateRequest(request, env, "proj-1")).rejects.toThrow();
    });

    it("wrong secret → throws", async () => {
      const token = await signJWT({ sub: "user-1", projectId: "proj-1" }, "wrong-secret");
      const request = new Request(`http://localhost/sync/proj-1?token=${token}`);
      const env = makeEnv();

      await expect(authenticateRequest(request, env, "proj-1")).rejects.toThrow();
    });

    it("payload missing sub → throws", async () => {
      const key = new TextEncoder().encode(JWT_SECRET);
      const token = await new jose.SignJWT({ projectId: "proj-1" } as any)
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(key);

      const request = new Request(`http://localhost/sync/proj-1?token=${token}`);
      const env = makeEnv();

      await expect(authenticateRequest(request, env, "proj-1")).rejects.toThrow(
        "Invalid JWT payload"
      );
    });

    it("payload missing projectId → throws", async () => {
      const key = new TextEncoder().encode(JWT_SECRET);
      const token = await new jose.SignJWT({ sub: "user-1" })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(key);

      const request = new Request(`http://localhost/sync/proj-1?token=${token}`);
      const env = makeEnv();

      await expect(authenticateRequest(request, env, "proj-1")).rejects.toThrow(
        "Invalid JWT payload"
      );
    });

    it("projectId mismatch → throws", async () => {
      const token = await signJWT({ sub: "user-1", projectId: "other-project" }, JWT_SECRET);
      const request = new Request(`http://localhost/sync/proj-1?token=${token}`);
      const env = makeEnv();

      await expect(authenticateRequest(request, env, "proj-1")).rejects.toThrow(
        "Project ID mismatch"
      );
    });
  });

  // ─── Development mode fallback ───

  describe("dev mode fallback", () => {
    it("ENVIRONMENT=development, no token → dev-user fallback", async () => {
      const request = new Request("http://localhost/sync/proj-1");
      const env = makeEnv({ ENVIRONMENT: "development" });

      const result = await authenticateRequest(request, env, "proj-1");
      expect(result).toEqual({ userId: "dev-user", projectId: "proj-1" });
    });

    it("ENVIRONMENT=production, no token → Unauthorized", async () => {
      const request = new Request("http://localhost/sync/proj-1");
      const env = makeEnv({ ENVIRONMENT: "production" });

      await expect(authenticateRequest(request, env, "proj-1")).rejects.toThrow("Unauthorized");
    });
  });

  // ─── BetterAuth session ───

  describe("BetterAuth session", () => {
    it("valid session cookie → returns userId", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ session: {}, user: { id: "ba-user-42" } }),
          { status: 200 }
        )
      );

      const request = new Request("http://localhost/sync/proj-1", {
        headers: { cookie: "session=abc123" },
      });
      // DB must return matching owner_id for ba-user-42
      const env = makeEnv({
        DB: {
          prepare: vi.fn().mockReturnValue({
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: [{ owner_id: "ba-user-42" }] }),
            }),
          }),
        } as any,
      });

      const result = await authenticateRequest(request, env, "proj-1");
      expect(result.userId).toBe("ba-user-42");
      expect(result.projectId).toBe("proj-1");
    });

    it("session with mismatched project owner → throws Forbidden", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ session: {}, user: { id: "ba-user-42" } }),
          { status: 200 }
        )
      );

      // DB says owner is "other-user"
      const env = makeEnv({
        DB: {
          prepare: vi.fn().mockReturnValue({
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: [{ owner_id: "other-user" }] }),
            }),
          }),
        } as any,
      });

      const request = new Request("http://localhost/sync/proj-1", {
        headers: { cookie: "session=abc123" },
      });

      await expect(authenticateRequest(request, env, "proj-1")).rejects.toThrow("Forbidden");
    });

    it("BetterAuth returns non-ok response → falls through to JWT", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 401 }));

      const token = await signJWT({ sub: "user-1", projectId: "proj-1" }, JWT_SECRET);
      const request = new Request(`http://localhost/sync/proj-1?token=${token}`, {
        headers: { cookie: "session=invalid" },
      });
      const env = makeEnv();

      const result = await authenticateRequest(request, env, "proj-1");
      expect(result.userId).toBe("user-1");
    });
  });

  // ─── assertProjectOwner (in development mode, it's skipped) ───

  describe("assertProjectOwner", () => {
    it("skips ownership check in development", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ session: {}, user: { id: "ba-user-42" } }),
          { status: 200 }
        )
      );

      const env = makeEnv({
        ENVIRONMENT: "development",
        DB: {
          prepare: vi.fn(), // should never be called for ownership
        } as any,
      });

      const request = new Request("http://localhost/sync/proj-1", {
        headers: { cookie: "session=abc123" },
      });

      const result = await authenticateRequest(request, env, "proj-1");
      expect(result.userId).toBe("ba-user-42");
      // DB.prepare should not have been called for ownership query
      expect(env.DB.prepare).not.toHaveBeenCalled();
    });
  });
});
