import { describe, expect, it } from "vitest";
import type { ProjectAsset } from "../../lib/types";
import {
  canvasNodeAssetDisplayName,
  projectAssetDisplayName,
  projectAssetThumbnailSource,
  resolveCanvasNodeProjectAsset,
} from "./projectAssetPresentation";

const assets: ProjectAsset[] = [
  {
    id: "asset-upload",
    assetId: "asset-upload",
    url: "/assets/uploads/8f73f0e81ad04c93b9f2.JPG",
    type: "image",
    storageKey: "uploads/8f73f0e81ad04c93b9f2.JPG",
    createdAt: null,
  },
  {
    id: "asset-edit",
    assetId: "asset-edit",
    url: "/assets/projects/project/edits/cab88315-e647.png",
    type: "image",
    storageKey: "projects/project/edits/cab88315-e647.png",
    createdAt: null,
  },
  {
    id: "asset-generated",
    assetId: "asset-generated",
    url: "/assets/generated/local-gen-uzfqsk94.svg",
    thumbnailUrl: "/assets/generated/local-gen-uzfqsk94-cover.webp",
    type: "image",
    storageKey: "generated/local-gen-uzfqsk94.svg",
    createdAt: null,
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

  it("uses the cover thumbnail before the source media", () => {
    expect(projectAssetThumbnailSource(assets[2])).toBe(
      "/assets/generated/local-gen-uzfqsk94-cover.webp",
    );
  });

  it("resolves current and legacy canvas nodes to their project asset", () => {
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
    ).toBe(assets[0]);
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
});
