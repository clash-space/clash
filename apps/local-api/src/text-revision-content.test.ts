import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  storeTextRevisionContentBlob,
  textRevisionContentBlobPath,
  textRevisionContentHash,
} from "./text-revision-content";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("text revision content blobs", () => {
  it("atomically repairs a truncated writer-owned final after a crash", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "text-revision-blobs-"));
    roots.push(dataDir);
    const content = "portable revision content\n";
    const revision = {
      schemaVersion: 1 as const,
      kind: "clash.text.revision" as const,
      textId: "text-1",
      revisionId: "revision-1",
      projectId: "project-1",
      nodeId: "node-1",
      createdAt: "2026-08-14T00:00:00.000Z",
      contentHash: textRevisionContentHash(content),
      hashAlgorithm: "sha256-64" as const,
      sourceFilePath: "drafts/script.md",
      sourceFileHash: textRevisionContentHash(content),
    };
    const path = textRevisionContentBlobPath(dataDir, revision.contentHash);
    await storeTextRevisionContentBlob(dataDir, revision, content);
    await chmod(path, 0o644);
    await writeFile(path, content.slice(0, 5), "utf8");

    await expect(
      storeTextRevisionContentBlob(dataDir, revision, content),
    ).resolves.toMatchObject({ stored: true });
    expect(await readFile(path, "utf8")).toBe(content);
    expect((await stat(path)).mode & 0o222).toBe(0);
  });
});
