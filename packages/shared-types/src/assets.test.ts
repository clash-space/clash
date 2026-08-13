import { describe, expect, it } from "vitest";
import {
  assetReadToken,
  assetRefReadToken,
  AssetKindSchema,
  AssetMetadataSchema,
  ProjectAssetPublicationMetadataSchema,
  type Asset,
} from "./assets.js";

describe("asset metadata", () => {
  it("treats uploaded 3D models as durable project-referenced assets", () => {
    expect(AssetKindSchema.parse("model")).toBe("model");
  });

  it("preserves local content-addressed blob provenance", () => {
    const metadata = AssetMetadataSchema.parse({
      bytes: 11,
      contentType: "image/png",
      contentHash: "a".repeat(64),
      localBlobKey: "blobs/aaaaaaaa/original.png",
      originalName: "hero.png",
    });

    expect(metadata).toMatchObject({
      bytes: 11,
      contentType: "image/png",
      contentHash: "a".repeat(64),
      localBlobKey: "blobs/aaaaaaaa/original.png",
      originalName: "hero.png",
    });
  });

  it("accepts byte-probed display orientation and audio-layout facts for publication", () => {
    const metadata = ProjectAssetPublicationMetadataSchema.parse({
      width: 180,
      height: 320,
      rotationDegrees: 90,
      durationMs: 1_000,
      contentType: "video/mp4",
      frameRate: 24,
      videoCodec: "h264",
      hasAudio: true,
      audioCodec: "aac",
      sampleRate: 48_000,
      channelCount: 2,
      channelLayout: "stereo",
    });

    expect(metadata).toMatchObject({
      width: 180,
      height: 320,
      rotationDegrees: 90,
      sampleRate: 48_000,
      channelCount: 2,
      channelLayout: "stereo",
    });
  });

  it("derives read tokens from persistent asset state only", () => {
    const asset: Asset = {
      id: "asset-1",
      userId: "user-1",
      kind: "image",
      srcR2Key: "uploads/source.png",
      coverR2Key: null,
      metadata: { bytes: 100, contentType: "image/png" },
      sourceModel: null,
      sourcePrompt: null,
      sourceTaskId: null,
      sources: null,
      signedUrl: "http://localhost/assets/uploads/source.png?read=1",
      signedUrlExp: 100,
      createdAt: 10,
      updatedAt: 20,
    };

    const refreshedUrl: Asset = {
      ...asset,
      signedUrl: "http://localhost/assets/uploads/source.png?read=2",
      signedUrlExp: 200,
    };
    expect(assetReadToken(refreshedUrl)).toBe(assetReadToken(asset));
    expect(
      assetReadToken({
        ...asset,
        coverR2Key: "uploads/cover.png",
        updatedAt: 21,
      }),
    ).not.toBe(assetReadToken(asset));
  });

  it("derives asset-ref read tokens from the project relation", () => {
    const token = assetRefReadToken({
      assetId: "asset-1",
      projectId: "project-a",
      importedAt: 10,
    });

    expect(token).toMatch(/^asset-ref-v1:[a-f0-9]{16}$/);
    expect(
      assetRefReadToken({
        assetId: "asset-1",
        projectId: "project-a",
        importedAt: 11,
      }),
    ).not.toBe(token);
    expect(
      assetRefReadToken({
        assetId: "asset-1",
        projectId: "project-b",
        importedAt: 10,
      }),
    ).not.toBe(token);
  });
});
