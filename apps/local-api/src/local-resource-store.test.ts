import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createLocalResourceStore,
  resourceIdForSha256,
} from "./local-resource-store.js";

async function fixture() {
  const clashRoot = await mkdtemp(join(tmpdir(), "clash-resource-store-"));
  const dataDir = join(clashRoot, "local-api");
  return {
    clashRoot,
    dataDir,
    store: createLocalResourceStore({ dataDir, clashRoot }),
  };
}

describe("local Resource CAS", () => {
  it("keeps staged bytes outside authoritative Resource resolution until they are sealed", async () => {
    const { store } = await fixture();
    const bytes = new TextEncoder().encode("unverified upload bytes");
    const digest = createHash("sha256").update(bytes).digest("hex");

    const staged = await store.stage({ bytes });

    expect(staged.receipt).toEqual({
      resourceId: `sha256:${digest}`,
      digest,
      byteLength: bytes.byteLength,
    });
    expect(staged).toMatchObject({
      resourceId: `sha256:${digest}`,
      digest,
      byteLength: bytes.byteLength,
    });
    expect(new Uint8Array(await readFile(staged.path))).toEqual(bytes);
    await expect(
      store.resolve(staged.receipt.resourceId),
    ).resolves.toBeUndefined();
  });

  it("recovers staged bytes after a Host restart without promoting them", async () => {
    const { clashRoot, dataDir, store } = await fixture();
    const bytes = new TextEncoder().encode("restart-safe staging bytes");
    const staged = await store.stage({ bytes });

    const restarted = createLocalResourceStore({ dataDir, clashRoot });

    await expect(
      restarted.resolveStaged(staged.receipt.resourceId),
    ).resolves.toEqual(staged);
    await expect(
      restarted.resolve(staged.receipt.resourceId),
    ).resolves.toBeUndefined();
  });

  it("lets rejected pre-seal media declarations retry with verified canonical facts", async () => {
    const { store } = await fixture();
    const bytes = new TextEncoder().encode(
      "bytes whose first declaration was wrong",
    );
    const digest = createHash("sha256").update(bytes).digest("hex");

    const stagedUnderRejectedDeclaration = await store.stage({
      bytes,
      originalName: "incorrect-video.mp4",
    });
    // The Host rejected the caller's video/video-mp4 declaration before seal.
    const retried = await store.stage({
      bytes,
      originalName: "verified-image.png",
    });

    expect(retried.receipt).toEqual(stagedUnderRejectedDeclaration.receipt);
    const sealed = await store.seal({
      receipt: retried.receipt,
      kind: "image",
      contentType: " Image/PNG ",
    });

    expect(sealed.resource).toEqual({
      id: `sha256:${digest}`,
      kind: "image",
      digest: { algorithm: "sha256", value: digest },
      byteLength: bytes.byteLength,
      contentType: "image/png",
    });
    await expect(store.resolve(sealed.resource.id)).resolves.toEqual(sealed);
  });

  it("replays the same canonical seal from its stable Resource id after restart", async () => {
    const { clashRoot, dataDir, store } = await fixture();
    const staged = await store.stage({
      bytes: new TextEncoder().encode("idempotent seal bytes"),
    });
    const first = await store.seal({
      receipt: staged.receipt,
      kind: "video",
      contentType: "video/mp4",
    });

    const restarted = createLocalResourceStore({ dataDir, clashRoot });
    const replayed = await restarted.seal({
      resourceId: staged.receipt.resourceId,
      kind: "video",
      contentType: " VIDEO/MP4 ",
    });

    expect(replayed).toEqual(first);
  });

  it("installs immutable bytes once and resolves their Host-private projection", async () => {
    const { clashRoot, store } = await fixture();
    const bytes = new TextEncoder().encode("immutable image bytes");
    const digest = createHash("sha256").update(bytes).digest("hex");

    const first = await store.install({
      kind: "image",
      bytes,
      contentType: "image/png",
      originalName: "hero.png",
    });
    const second = await store.install({
      kind: "image",
      bytes,
      contentType: "image/png",
      originalName: "renamed.png",
    });

    expect(first.resource).toEqual({
      id: `sha256:${digest}`,
      kind: "image",
      digest: { algorithm: "sha256", value: digest },
      byteLength: bytes.byteLength,
      contentType: "image/png",
    });
    expect(second).toEqual(first);
    expect(first.storageKey).toBe(`local-blobs/${digest}/original.png`);
    expect(first.path).toBe(
      join(clashRoot, "assets", "blobs", digest, "original.png"),
    );
    expect(new Uint8Array(await readFile(first.path))).toEqual(bytes);
    expect((await stat(first.path)).mode & 0o777).toBe(0o444);
    await expect(store.resolve(first.resource.id)).resolves.toEqual(first);
  });

  it("adopts a CLI-installed CAS blob only after verifying its digest and size", async () => {
    const { clashRoot, store } = await fixture();
    const bytes = new TextEncoder().encode("existing audio bytes");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const directory = join(clashRoot, "assets", "blobs", digest);
    const path = join(directory, "original.mp3");
    await mkdir(directory, { recursive: true });
    await writeFile(path, bytes);

    const adopted = await store.adopt({
      kind: "audio",
      digest,
      byteLength: bytes.byteLength,
      contentType: "audio/mpeg",
      localBlobKey: `blobs/${digest}/original.mp3`,
    });

    expect(adopted.resource.id).toBe(resourceIdForSha256(digest));
    expect(adopted.storageKey).toBe(`local-blobs/${digest}/original.mp3`);
    await expect(store.resolve(adopted.resource.id)).resolves.toEqual(adopted);
  });

  it("rejects adoption when the claimed digest does not match the bytes", async () => {
    const { clashRoot, store } = await fixture();
    const claimedDigest = "a".repeat(64);
    const directory = join(clashRoot, "assets", "blobs", claimedDigest);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "original.mp4"), "different bytes");

    await expect(
      store.adopt({
        kind: "video",
        digest: claimedDigest,
        byteLength: 15,
        contentType: "video/mp4",
        localBlobKey: `blobs/${claimedDigest}/original.mp4`,
      }),
    ).rejects.toThrow(/digest/i);
    await expect(
      store.resolve(resourceIdForSha256(claimedDigest)),
    ).resolves.toBeUndefined();
  });

  it("fails closed when an indexed Resource loses its immutable bytes", async () => {
    const { store } = await fixture();
    const installed = await store.install({
      kind: "image",
      bytes: new TextEncoder().encode("will disappear"),
      contentType: "image/png",
      originalName: "lost.png",
    });
    await chmod(installed.path, 0o644);
    await writeFile(installed.path, new Uint8Array());

    await expect(store.resolve(installed.resource.id)).rejects.toThrow(
      /byte length|corrupt/i,
    );
  });

  it("fails closed when immutable bytes change without changing length", async () => {
    const { store } = await fixture();
    const installed = await store.install({
      kind: "image",
      bytes: new TextEncoder().encode("original"),
      contentType: "image/png",
      originalName: "corrupt.png",
    });
    await chmod(installed.path, 0o644);
    await writeFile(installed.path, new TextEncoder().encode("tampered"));

    await expect(store.resolve(installed.resource.id)).rejects.toThrow(
      /digest|corrupt/i,
    );
  });

  it("repairs an indexed CAS file when the same verified bytes are installed again", async () => {
    const { store } = await fixture();
    const bytes = new TextEncoder().encode("recoverable immutable bytes");
    const installed = await store.install({
      kind: "video",
      bytes,
      contentType: "video/mp4",
      originalName: "source.mp4",
    });
    await chmod(installed.path, 0o644);
    await writeFile(
      installed.path,
      new TextEncoder().encode("corrupted immutable bytes"),
    );

    await expect(store.resolve(installed.resource.id)).rejects.toThrow(
      /digest|byte length|corrupt/i,
    );

    const repaired = await store.install({
      kind: "video",
      bytes,
      contentType: "video/mp4",
      originalName: "renamed.mp4",
    });

    expect(repaired).toEqual(installed);
    expect(new Uint8Array(await readFile(repaired.path))).toEqual(bytes);
    expect((await stat(repaired.path)).mode & 0o777).toBe(0o444);
    await expect(store.resolve(repaired.resource.id)).resolves.toEqual(
      repaired,
    );
  });

  it("does not reinterpret one digest as a different media kind", async () => {
    const { store } = await fixture();
    const bytes = new TextEncoder().encode("same bytes");
    await store.install({
      kind: "image",
      bytes,
      contentType: "image/png",
      originalName: "same.png",
    });

    await expect(
      store.install({
        kind: "video",
        bytes,
        contentType: "video/mp4",
        originalName: "same.mp4",
      }),
    ).rejects.toThrow(/different immutable facts/i);
  });

  it("never reinterprets facts after a verified seal wins the Resource CAS", async () => {
    const { store } = await fixture();
    const bytes = new TextEncoder().encode("verified Resource winner");
    const legacy = await store.install({
      bytes,
      kind: "video",
      contentType: "video/mp4",
    });
    const verified = await store.seal({
      resourceId: legacy.resource.id,
      kind: "image",
      contentType: "image/png",
    });

    await expect(
      store.seal({
        resourceId: verified.resource.id,
        kind: "video",
        contentType: "video/mp4",
      }),
    ).rejects.toThrow(/different immutable facts/i);
    await expect(store.resolve(verified.resource.id)).resolves.toEqual(
      verified,
    );
  });
});
