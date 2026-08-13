import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DirectorStageNode", () => {
  const source = readFileSync(
    new URL("./DirectorStageNode.tsx", import.meta.url),
    "utf8",
  );

  it("opens its independently stored Stage through project context", () => {
    expect(source).toContain("readProjectDirectorStage");
    expect(source).toContain("openDirectorStage(stage.id)");
    expect(source).toContain("Open Director Stage");
    expect(source).not.toContain("objects:");
  });

  it("exposes the latest exported reference video on its Canvas output", () => {
    expect(source).toContain("DirectorReferencePacketSchema.safeParse");
    expect(source).toContain("referencePacket?.referenceVideo.assetId");
    expect(source).toContain("useAsset(projectId, outputVideoAssetId)");
    expect(source).toContain("outputVideo?.url");
    expect(source).not.toContain("referencePacket?.referenceVideo.src");
    expect(source).not.toContain("referencePacket?.referenceVideo.previewUrl");
    expect(source).toContain("outputVideoAssetId");
    expect(source).toContain("outputVideoSrc");
    expect(source).toContain("Reference video ready");
  });
});
