import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalMetadataBody,
  metadataBodyBlobPath,
  metadataBodyContentHash,
  readMetadataBody,
  storeMetadataBody,
} from "./metadata-body-blobs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function dataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "metadata-blobs-"));
  roots.push(root);
  return root;
}

const words = [
  { id: "w1", text: "hello", startMs: 0, endMs: 800 },
  { id: "w2", text: "world", startMs: 900, endMs: 1_800 },
];

describe("metadata body blobs", () => {
  it("stores a body once, read-only, addressed by its own hash", async () => {
    const root = await dataDir();
    const stored = await storeMetadataBody({ dataDir: root, body: { words } });

    expect(stored.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(stored.deduplicated).toBe(false);
    expect(stored.path).toBe(metadataBodyBlobPath(root, stored.contentHash));
    expect((await stat(stored.path)).mode & 0o222).toBe(0);
    expect(await readMetadataBody({ dataDir: root, contentHash: stored.contentHash })).toEqual({
      words,
    });
  });

  it("deduplicates an identical body instead of rewriting it", async () => {
    const root = await dataDir();
    const first = await storeMetadataBody({ dataDir: root, body: { words } });
    const second = await storeMetadataBody({ dataDir: root, body: { words } });

    expect(second.contentHash).toBe(first.contentHash);
    expect(second.deduplicated).toBe(true);
  });

  it("gives key order and spacing no say in a body's identity", async () => {
    const root = await dataDir();
    const first = await storeMetadataBody({
      dataDir: root,
      body: { language: "zh", words },
    });
    const second = await storeMetadataBody({
      dataDir: root,
      body: { words, language: "zh" },
    });

    expect(second.contentHash).toBe(first.contentHash);
    expect(second.deduplicated).toBe(true);
  });

  it("refuses a body that does not hash to the identity the caller pinned", async () => {
    const root = await dataDir();
    await expect(
      storeMetadataBody({
        dataDir: root,
        body: { words },
        expectedContentHash: `sha256:${"a".repeat(64)}`,
      }),
    ).rejects.toThrow(/content hash mismatch/u);
  });

  it("surfaces a corrupted blob at read time instead of downstream", async () => {
    const root = await dataDir();
    const stored = await storeMetadataBody({ dataDir: root, body: { words } });
    // The store writes 0o444, so corrupting it takes deliberate effort -- which is
    // the point; this only simulates bit rot or an out-of-band edit.
    await chmod(stored.path, 0o644);
    await writeFile(stored.path, canonicalMetadataBody({ words: [] }), "utf8");

    await expect(
      readMetadataBody({ dataDir: root, contentHash: stored.contentHash }),
    ).rejects.toThrow(/corrupt/u);
  });

  it("reports a body that was never stored rather than returning nothing", async () => {
    const root = await dataDir();
    await expect(
      readMetadataBody({ dataDir: root, contentHash: `sha256:${"c".repeat(64)}` }),
    ).rejects.toThrow(/is not stored/u);
  });

  it("rejects a malformed hash instead of building a path from it", async () => {
    expect(() => metadataBodyBlobPath("/tmp/x", "../../etc/passwd")).toThrow(
      /Invalid metadata body content hash/u,
    );
    expect(metadataBodyContentHash("{}")).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("shards blobs by hash prefix so one directory never holds them all", async () => {
    const root = await dataDir();
    const stored = await storeMetadataBody({ dataDir: root, body: { words } });
    const digest = stored.contentHash.slice("sha256:".length);

    expect(stored.path).toBe(
      join(root, "metadata-blobs", digest.slice(0, 2), `${digest}.json`),
    );
    expect(await readFile(stored.path, "utf8")).toBe(canonicalMetadataBody({ words }));
  });
});
