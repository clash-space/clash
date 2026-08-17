import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { writeArtifactManifest } from "./artifacts.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("demo recording artifacts", () => {
  it("writes portable relative paths with content hashes", async () => {
    const artifactDir = await temporaryDirectory("clash-demo-artifacts-");
    await mkdir(join(artifactDir, "media"));
    await writeFile(join(artifactDir, "media", "demo.mp4"), "video-bytes");
    await writeFile(join(artifactDir, "events.jsonl"), "{\"sequence\":1}\n");

    const manifest = await writeArtifactManifest({
      artifactDir,
      suiteId: "desktop-demos-v1",
      caseId: "agent-canvas",
      caseKind: "agent",
      status: "pass",
      title: "Agent builds on Canvas",
      startedAt: "2026-08-15T10:00:00.000Z",
      completedAt: "2026-08-15T10:01:00.000Z",
      chapters: [{ id: "brief", title: "Submit brief", startMs: 0, endMs: 60_000 }],
      files: [
        { path: "media/demo.mp4", mediaType: "video/mp4" },
        { path: "events.jsonl", mediaType: "application/x-ndjson" },
      ],
    });

    expect(manifest.files).toEqual([
      expect.objectContaining({
        path: "media/demo.mp4",
        bytes: 11,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
      expect.objectContaining({
        path: "events.jsonl",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(manifest.status).toBe("pass");
    expect(JSON.parse(await readFile(join(artifactDir, "manifest.json"), "utf8"))).toEqual(
      manifest,
    );
    expect(JSON.stringify(manifest)).not.toContain(artifactDir);
  });

  it("rejects artifact paths that escape the case directory", async () => {
    const artifactDir = await temporaryDirectory("clash-demo-artifacts-");
    await expect(
      writeArtifactManifest({
        artifactDir,
        suiteId: "desktop-demos-v1",
        caseId: "unsafe",
        caseKind: "feature",
        status: "fail",
        title: "Unsafe",
        startedAt: "2026-08-15T10:00:00.000Z",
        completedAt: "2026-08-15T10:01:00.000Z",
        chapters: [],
        files: [{ path: "../outside.mp4", mediaType: "video/mp4" }],
      }),
    ).rejects.toThrow(/artifact file must stay inside the artifact directory/iu);
  });

  it("rejects symlinked artifacts and a self-referential manifest entry", async () => {
    const artifactDir = await temporaryDirectory("clash-demo-artifacts-");
    const outsideDir = await temporaryDirectory("clash-demo-outside-");
    await writeFile(join(outsideDir, "outside.mp4"), "outside");
    await symlink(join(outsideDir, "outside.mp4"), join(artifactDir, "linked.mp4"));

    const base = {
      artifactDir,
      suiteId: "desktop-demos-v1",
      caseId: "unsafe",
      caseKind: "feature" as const,
      status: "fail" as const,
      title: "Unsafe",
      startedAt: "2026-08-15T10:00:00.000Z",
      completedAt: "2026-08-15T10:01:00.000Z",
      chapters: [],
    };
    await expect(
      writeArtifactManifest({
        ...base,
        files: [{ path: "linked.mp4", mediaType: "video/mp4" }],
      }),
    ).rejects.toThrow(/symbolic link|artifact directory/iu);
    await writeFile(join(artifactDir, "manifest.json"), "{\"old\":true}\n");
    await expect(
      writeArtifactManifest({
        ...base,
        files: [{ path: "sub/../manifest.json", mediaType: "application/json" }],
      }),
    ).rejects.toThrow(/manifest\.json/iu);
  });
});
