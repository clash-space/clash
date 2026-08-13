import { describe, expect, it } from "vitest";
import type { ResolvedAsset } from "@clash/shared-types";
import {
  canvasNodeAssetDisplayName,
  mergeResolvedAssetProjection,
  projectAssetDisplayName,
  resolveCanvasNodeProjectAsset,
} from "./projectAssetPresentation";

const assets: ResolvedAsset[] = [
  {
    id: "asset-upload",
    url: "https://media.clash.test/assets/asset-upload",
    kind: "image",
    lifecycle: { state: "active" },
    status: "ready",
    metadata: { originalName: "8f73f0e81ad04c93b9f2.JPG" },
    provenance: { kind: "import" },
  },
  {
    id: "asset-edit",
    url: "https://media.clash.test/assets/asset-edit",
    kind: "image",
    lifecycle: { state: "active" },
    status: "ready",
    metadata: {},
    provenance: { kind: "edit" },
  },
  {
    id: "asset-generated",
    url: "https://media.clash.test/assets/asset-generated",
    thumbnailUrl: "https://media.clash.test/thumbnails/asset-generated",
    kind: "image",
    lifecycle: { state: "active" },
    status: "ready",
    metadata: {},
    provenance: { kind: "generation" },
  },
];

describe("project asset presentation", () => {
  it("turns internal storage names into stable business labels", () => {
    expect(projectAssetDisplayName(assets[0])).toBe("Uploaded image");
    expect(projectAssetDisplayName(assets[1])).toBe("Edited image");
    expect(projectAssetDisplayName(assets[2])).toBe("Generated image");
    expect(
      projectAssetDisplayName({ ...assets[0], name: "Opening frame.JPG" }),
    ).toBe("Opening frame.JPG");
  });

  it("resolves canvas nodes only by their stable Project Asset id", () => {
    expect(
      resolveCanvasNodeProjectAsset(
        { data: { assetId: "asset-upload" } },
        assets,
      ),
    ).toBe(assets[0]);
    expect(
      resolveCanvasNodeProjectAsset(
        { data: { fileName: "8f73f0e81ad04c93b9f2.JPG" } },
        assets,
      ),
    ).toBeUndefined();
    expect(
      resolveCanvasNodeProjectAsset(
        { data: { src: assets[0].url, name: "asset-upload" } },
        assets,
      ),
    ).toBeUndefined();
  });

  it("keeps a meaningful canvas label but replaces machine filenames", () => {
    expect(
      canvasNodeAssetDisplayName(
        { type: "image", data: { label: "8f73f0e81ad04c93b9f2.JPG" } },
        assets[0],
      ),
    ).toBe("Uploaded image");
    expect(
      canvasNodeAssetDisplayName(
        { type: "image", data: { label: "改一下" } },
        assets[2],
      ),
    ).toBe("改一下");
  });

  it("never carries a stale media URL into an authoritative unavailable projection", () => {
    expect(
      mergeResolvedAssetProjection(
        {
          id: "asset-upload",
          kind: "image",
          lifecycle: { state: "active" },
          status: "unavailable",
          metadata: {},
          error: "Not installed on this Host",
        },
        assets[0],
      ),
    ).toEqual({
      id: "asset-upload",
      kind: "image",
      lifecycle: { state: "active" },
      status: "unavailable",
      metadata: { originalName: "8f73f0e81ad04c93b9f2.JPG" },
      error: "Not installed on this Host",
    });
  });
});
