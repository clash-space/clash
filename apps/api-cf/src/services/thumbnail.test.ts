import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractVideoThumbnail } from "./thumbnail";

const JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff]).buffer;

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    JWT_SECRET: "test-secret",
    ...overrides,
  } as any;
}

describe("extractVideoThumbnail — dispatch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when neither transport is configured", async () => {
    const env = makeEnv({ MEDIA_GATEWAY_URL: "http://localhost:3000" });
    await expect(extractVideoThumbnail(env, "videos/a.mp4")).rejects.toThrow(
      /No render backend/,
    );
  });

  it("fails clearly when MEDIA_GATEWAY_URL is missing", async () => {
    const env = makeEnv({ RENDER_SERVER_URL: "http://localhost:8080" });
    await expect(extractVideoThumbnail(env, "videos/x.mp4")).rejects.toThrow(
      /MEDIA_GATEWAY_URL must be set/,
    );
  });

  it("prefers render-server URL when set (dev)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JPG_BYTES, { status: 200 }));
    const env = makeEnv({
      RENDER_SERVER_URL: "http://localhost:8080",
      MEDIA_GATEWAY_URL: "http://localhost:3000",
    });

    const out = await extractVideoThumbnail(env, "videos/abc.mp4", { timeSec: 2 });
    expect(out.bytes).toBeInstanceOf(ArrayBuffer);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8080/thumbnail");
    expect((init as RequestInit).method).toBe("POST");

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.sourceUrl).toContain("http://localhost:3000/assets/videos/abc.mp4?exp=");
    expect(body.sourceUrl).toMatch(/&sig=[A-Za-z0-9_-]+$/);
    expect(body.timeSec).toBe(2);
    expect(body.format).toBe("jpg");
  });

  it("routes through the Container binding when only RENDER_CONTAINER is set", async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response(JPG_BYTES, { status: 200 }));
    const env = makeEnv({
      RENDER_CONTAINER: {
        idFromName: () => ({}),
        get: () => ({ fetch: stubFetch }),
      },
      MEDIA_GATEWAY_URL: "https://prod.example.com",
    });

    await extractVideoThumbnail(env, "videos/abc.mp4", { timeSec: 1 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stubFetch).toHaveBeenCalledOnce();
    const [url] = stubFetch.mock.calls[0];
    expect(String(url)).toBe("http://container/thumbnail");
  });

  it("threads options into the render-server request body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JPG_BYTES, { status: 200 }));
    const env = makeEnv({
      RENDER_SERVER_URL: "http://localhost:8080",
      MEDIA_GATEWAY_URL: "http://localhost:3000",
    });

    await extractVideoThumbnail(env, "videos/a.mp4", { timeSec: 5.5, format: "webp", width: 480 });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ timeSec: 5.5, format: "webp", width: 480 });
  });

  it("surfaces render-server errors with status + body preview", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("ffmpeg exited 1: Invalid data found", { status: 500, statusText: "Internal" }),
    );
    const env = makeEnv({
      RENDER_SERVER_URL: "http://localhost:8080",
      MEDIA_GATEWAY_URL: "http://localhost:3000",
    });
    await expect(extractVideoThumbnail(env, "videos/x.mp4")).rejects.toThrow(
      /render-server \/thumbnail failed \(500 Internal\).*ffmpeg exited 1/,
    );
  });
});
