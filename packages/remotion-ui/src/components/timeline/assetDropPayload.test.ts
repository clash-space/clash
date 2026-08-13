import { describe, expect, it } from "vitest";
import { resolveAssetDropPayload } from "./assetDropPayload";

function transfer(
  values: Record<string, string>,
): Pick<DataTransfer, "getData"> {
  return {
    getData: (type: string) => values[type] ?? "",
  };
}

describe("resolveAssetDropPayload", () => {
  it("uses an asset already available in the Timeline scope", () => {
    const scopedAsset = { id: "canvas-node-1", type: "image" };
    expect(
      resolveAssetDropPayload({
        assetId: "canvas-node-1",
        dataTransfer: transfer({}),
        assets: [scopedAsset],
      }),
    ).toBe(scopedAsset);
  });

  it("accepts the serialized sidebar asset while its Timeline reference is materializing", () => {
    expect(
      resolveAssetDropPayload({
        assetId: "project-ref-1",
        dataTransfer: transfer({
          asset: JSON.stringify({
            id: "project-ref-1",
            projectAssetId: "asset-1",
            sourceNodeId: "project-ref-1",
            src: "https://example.test/image.png",
            type: "image",
          }),
        }),
        assets: [],
      }),
    ).toMatchObject({
      id: "project-ref-1",
      projectAssetId: "asset-1",
      type: "image",
    });
  });

  it("ignores malformed or mismatched serialized payloads", () => {
    expect(
      resolveAssetDropPayload({
        assetId: "project-ref-1",
        dataTransfer: transfer({ asset: "{not-json" }),
        assets: [],
      }),
    ).toBeUndefined();
    expect(
      resolveAssetDropPayload({
        assetId: "project-ref-1",
        dataTransfer: transfer({
          asset: JSON.stringify({ id: "other", type: "image" }),
        }),
        assets: [],
      }),
    ).toBeUndefined();
  });
});
