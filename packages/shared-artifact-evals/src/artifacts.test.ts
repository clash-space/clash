import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadSubmission } from "./artifacts";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) =>
      rm(workspace, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("artifact loading", () => {
  it("streams media evidence without retaining the media bytes in memory", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artifact-streaming-"));
    workspaces.push(workspace);
    const video = Buffer.alloc(2 * 1024 * 1024, 0x5a);
    await writeFile(join(workspace, "video.mp4"), video);
    await writeFile(
      join(workspace, "submission.json"),
      JSON.stringify({
        schemaVersion: 1,
        taskId: "streaming-media",
        artifacts: [{ id: "final-video", kind: "video", path: "video.mp4" }],
      }),
    );

    const loaded = await loadSubmission(workspace);

    expect(loaded.error).toBeUndefined();
    expect(loaded.artifacts[0]?.content).toBeUndefined();
    expect(loaded.artifacts[0]?.evidence).toMatchObject({
      bytes: video.byteLength,
      sha256: createHash("sha256").update(video).digest("hex"),
    });
  });

  it("keeps bounded structured artifacts available to semantic evaluators", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artifact-structured-"));
    workspaces.push(workspace);
    const timeline = Buffer.from("schemaVersion: 1\ntracks: []\n", "utf8");
    await writeFile(join(workspace, "timeline.yaml"), timeline);
    await writeFile(
      join(workspace, "submission.json"),
      JSON.stringify({
        schemaVersion: 1,
        taskId: "structured-artifact",
        artifacts: [
          { id: "timeline", kind: "timeline", path: "timeline.yaml" },
        ],
      }),
    );

    const loaded = await loadSubmission(workspace);

    expect(loaded.artifacts[0]?.content).toEqual(timeline);
  });
});
