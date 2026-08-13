import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedAsset } from "@clash/shared-types";
import {
  PROJECT_ASSET_DRAG_MIME,
  hasProjectAssetDragData,
  readProjectAssetDrag,
  readProjectAssetDragId,
  writeProjectAssetDrag,
} from "./projectAssetDrag";

afterEach(() => {
  globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
});

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  const transfer = {
    effectAllowed: "none",
    dropEffect: "none",
    get types() {
      return [...values.keys()];
    },
    getData(type: string) {
      return values.get(type) ?? "";
    },
    setData(type: string, value: string) {
      values.set(type, value);
    },
  };
  return transfer as unknown as DataTransfer;
}

describe("project asset drag contract", () => {
  const asset: ResolvedAsset = {
    id: "asset-ref-1",
    name: "Edited image",
    url: "https://media.clash.test/assets/hero.png",
    kind: "image",
    metadata: {},
    lifecycle: { state: "active" },
    status: "ready",
  };

  it("writes only the stable Project Asset identity for Host-owned drops", () => {
    const transfer = createDataTransfer();

    writeProjectAssetDrag(transfer, asset);

    expect(transfer.effectAllowed).toBe("copy");
    expect(transfer.getData("assetId")).toBe("");
    expect(transfer.getData("text/plain")).toBe("");
    expect(transfer.getData("asset")).toBe("");
    expect(JSON.parse(transfer.getData(PROJECT_ASSET_DRAG_MIME))).toEqual({
      assetId: "asset-ref-1",
    });
    expect(hasProjectAssetDragData(transfer)).toBe(true);
  });

  it("does not copy a Host URL into the native drag payload", () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = {
      mode: "desktop",
      apiBaseUrl: "http://127.0.0.1:49920",
    };
    const transfer = createDataTransfer();

    writeProjectAssetDrag(transfer, asset);

    expect(transfer.types).toEqual([PROJECT_ASSET_DRAG_MIME]);
  });

  it("resolves a drop back to the canonical project asset", () => {
    const transfer = createDataTransfer();
    writeProjectAssetDrag(transfer, asset);

    expect(readProjectAssetDrag(transfer, [asset])).toBe(asset);
    expect(readProjectAssetDragId(transfer)).toBe(asset.id);
    expect(readProjectAssetDrag(createDataTransfer(), [asset])).toBeUndefined();
  });

  it("does not let a generic or Remotion-native drag masquerade as a Project Asset", () => {
    const transfer = createDataTransfer();
    transfer.setData("text/plain", asset.id);
    transfer.setData("assetId", asset.id);

    expect(hasProjectAssetDragData(transfer)).toBe(false);
    expect(readProjectAssetDrag(transfer, [asset])).toBeUndefined();
    expect(readProjectAssetDragId(transfer)).toBeUndefined();
  });

  it("does not misclassify a Timeline Library drag as a Project Asset", () => {
    const transfer = createDataTransfer();
    transfer.setData(
      "application/x-clash-timeline-library",
      "transition-prism-split",
    );
    transfer.setData("text/plain", "transition-prism-split");

    expect(hasProjectAssetDragData(transfer)).toBe(false);
  });
});
