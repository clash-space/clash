import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalExecutorAssetCapabilityIssuer } from "./executor-asset-capability.js";

const issuers: Array<
  ReturnType<typeof createLocalExecutorAssetCapabilityIssuer>
> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(issuers.splice(0).map((issuer) => issuer.close()));
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "clash-executor-asset-"));
  tempDirs.push(dir);
  const path = join(dir, "private-resource-cas-name.mp4");
  const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await writeFile(path, bytes);
  let currentTime = Date.parse("2026-08-15T08:00:00.000Z");
  const issuer = createLocalExecutorAssetCapabilityIssuer({
    now: () => currentTime,
    ttlMs: 5 * 60_000,
  });
  issuers.push(issuer);
  const capability = await issuer.open({
    invocationId: "invocation-1",
    path,
    byteLength: bytes.byteLength,
    kind: "video",
    mediaType: "video/mp4",
  });
  return {
    bytes,
    path,
    issuer,
    capability,
    advance(ms: number) {
      currentTime += ms;
    },
  };
}

describe("local executor Asset capability", () => {
  it("serves an opaque read-only URL without exposing the Resource path", async () => {
    const { bytes, path, capability } = await fixture();
    const url = new URL(capability.executorUrl);

    expect(url.hostname).toBe("127.0.0.1");
    expect(url.pathname).not.toContain(basename(path));
    expect(url.href).not.toContain(encodeURIComponent(path));
    expect(url.pathname.split("/").at(-1)).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(capability).toMatchObject({
      expiresAt: "2026-08-15T08:05:00.000Z",
      kind: "video",
      mediaType: "video/mp4",
    });
    expect(capability).not.toHaveProperty("path");
    expect(capability).not.toHaveProperty("storageKey");

    const response = await fetch(capability.executorUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-expose-headers")).toContain(
      "Content-Range",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);

    const rejectedWrite = await fetch(capability.executorUrl, {
      method: "POST",
      body: "overwrite",
    });
    expect(rejectedWrite.status).toBe(405);
  });

  it("answers HEAD without streaming a body", async () => {
    const { capability } = await fixture();

    const response = await fetch(capability.executorUrl, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("10");
    expect(await response.text()).toBe("");
  });

  it.each([
    { range: "bytes=2-5", contentRange: "bytes 2-5/10", bytes: [2, 3, 4, 5] },
    { range: "bytes=7-", contentRange: "bytes 7-9/10", bytes: [7, 8, 9] },
    { range: "bytes=-3", contentRange: "bytes 7-9/10", bytes: [7, 8, 9] },
  ])(
    "serves one $range request as 206",
    async ({ range, contentRange, bytes }) => {
      const { capability } = await fixture();

      const response = await fetch(capability.executorUrl, {
        headers: { Range: range },
      });

      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(contentRange);
      expect(response.headers.get("content-length")).toBe(String(bytes.length));
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        Uint8Array.from(bytes),
      );
    },
  );

  it.each(["bytes=20-30", "bytes=7-2", "bytes=0-1,4-5", "items=0-1"])(
    "rejects unsupported or unsatisfiable Range %s as 416",
    async (range) => {
      const { capability } = await fixture();

      const response = await fetch(capability.executorUrl, {
        headers: { Range: range },
      });

      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */10");
      expect(await response.text()).toBe("");
    },
  );

  it("revokes the URL idempotently when the invocation lease releases", async () => {
    const { capability } = await fixture();

    await capability.release();
    await capability.release();

    expect((await fetch(capability.executorUrl)).status).toBe(404);
  });

  it("expires the URL even when a terminal hook is never delivered", async () => {
    const { capability, advance } = await fixture();
    advance(5 * 60_000 + 1);

    expect((await fetch(capability.executorUrl)).status).toBe(404);
  });

  it("releases an expired FileHandle without waiting for another URL request", async () => {
    vi.useFakeTimers();
    const dir = await mkdtemp(join(tmpdir(), "clash-executor-asset-timer-"));
    tempDirs.push(dir);
    const path = join(dir, "resource.bin");
    await writeFile(path, Uint8Array.from([1, 2, 3]));
    const fixedNow = Date.parse("2026-08-15T08:00:00.000Z");
    const issuer = createLocalExecutorAssetCapabilityIssuer({
      now: () => fixedNow,
      ttlMs: 25,
    });
    issuers.push(issuer);

    try {
      const capability = await issuer.open({
        invocationId: "invocation-expiry-timer",
        path,
        byteLength: 3,
        kind: "video",
      });
      await vi.advanceTimersByTimeAsync(25);
      vi.useRealTimers();

      // `now()` deliberately remains before expiresAt. A 404 therefore proves the scheduled
      // release removed the capability; request-time lazy expiry cannot satisfy this assertion.
      expect((await fetch(capability.executorUrl)).status).toBe(404);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to issue a URL when immutable Resource length no longer matches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clash-executor-asset-mismatch-"));
    tempDirs.push(dir);
    const path = join(dir, "resource.bin");
    await writeFile(path, Uint8Array.from([1, 2, 3]));
    const issuer = createLocalExecutorAssetCapabilityIssuer();
    issuers.push(issuer);

    await expect(
      issuer.open({
        invocationId: "invocation-1",
        path,
        byteLength: 4,
        kind: "video",
      }),
    ).rejects.toThrow(/immutable Resource length/i);
  });
});
