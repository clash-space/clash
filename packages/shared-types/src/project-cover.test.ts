import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";

import {
  listActionAssetReferences,
  markActionAssetBindingAuthority,
  trashProjectAssetIfUnreferenced,
} from "./action-asset-bindings.js";
import {
  createProjectAsset,
  markProjectAssetAuthority,
} from "./project-assets.js";
import {
  PROJECT_PRESENTATION_CONTAINER,
  readProjectCoverAssetId,
  reconcileProjectCoverBindings,
  setProjectCoverAsset,
} from "./project-cover.js";

function fixture() {
  const doc = new LoroDoc();
  expect(markProjectAssetAuthority(doc).ok).toBe(true);
  expect(markActionAssetBindingAuthority(doc).ok).toBe(true);
  expect(
    createProjectAsset(doc, {
      id: "asset-cover",
      kind: "image",
      source: { kind: "owned", resourceId: "sha256:cover" },
      lifecycle: { state: "active" },
      metadata: {},
    }).ok,
  ).toBe(true);
  return doc;
}

describe("Project cover Asset reference", () => {
  it("stores the stable cover id with an input binding that blocks deletion", () => {
    const doc = fixture();

    expect(
      setProjectCoverAsset(doc, {
        projectAssetId: "asset-cover",
        bindingId: "project-cover:1",
      }),
    ).toEqual({ ok: true, coverAssetId: "asset-cover", changed: true });
    expect(readProjectCoverAssetId(doc)).toBe("asset-cover");
    expect(listActionAssetReferences(doc, "asset-cover")).toEqual([
      expect.objectContaining({
        id: "project-cover:1",
        owner: { kind: "draft", actionId: "project-cover" },
        direction: "input",
        slot: "cover",
        projectAssetId: "asset-cover",
      }),
    ]);
    expect(
      trashProjectAssetIfUnreferenced(doc, {
        id: "asset-cover",
        deleteOperationId: "delete-1",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "ASSET_IN_USE", projectAssetId: "asset-cover" },
    });

    expect(setProjectCoverAsset(doc, { projectAssetId: null })).toEqual({
      ok: true,
      coverAssetId: null,
      changed: true,
    });
    expect(readProjectCoverAssetId(doc)).toBeNull();
    expect(listActionAssetReferences(doc, "asset-cover")).toEqual([]);
  });

  it("converges concurrent cover choices through one binding selector", () => {
    const base = fixture();
    expect(
      createProjectAsset(base, {
        id: "asset-alternate",
        kind: "video",
        source: { kind: "owned", resourceId: "sha256:alternate" },
        lifecycle: { state: "active" },
        metadata: {},
      }).ok,
    ).toBe(true);

    const snapshot = base.export({ mode: "snapshot" });
    const left = new LoroDoc();
    const right = new LoroDoc();
    left.import(snapshot);
    right.import(snapshot);
    const leftVersion = left.version();
    const rightVersion = right.version();

    expect(
      setProjectCoverAsset(left, {
        projectAssetId: "asset-cover",
        bindingId: "project-cover:left",
      }).ok,
    ).toBe(true);
    expect(
      setProjectCoverAsset(right, {
        projectAssetId: "asset-alternate",
        bindingId: "project-cover:right",
      }).ok,
    ).toBe(true);

    const leftUpdate = left.export({ mode: "update", from: leftVersion });
    const rightUpdate = right.export({ mode: "update", from: rightVersion });
    left.import(rightUpdate);
    right.import(leftUpdate);

    const selected = readProjectCoverAssetId(left);
    expect(selected).toBe(readProjectCoverAssetId(right));
    expect(["asset-cover", "asset-alternate"]).toContain(selected);
    for (const doc of [left, right]) {
      const reconciled = reconcileProjectCoverBindings(doc);
      expect(reconciled.coverAssetId).toBe(selected);
      expect(reconciled.changed).toBe(true);
      expect(
        doc.getMap(PROJECT_PRESENTATION_CONTAINER).get("coverAssetId"),
      ).toBeUndefined();
      expect(listActionAssetReferences(doc, selected!)).toHaveLength(1);
      const losingAssetId =
        selected === "asset-cover" ? "asset-alternate" : "asset-cover";
      expect(listActionAssetReferences(doc, losingAssetId)).toEqual([]);
    }
  });

  it("reports an invalid selector cleanup as a persisted change", () => {
    const doc = fixture();
    doc
      .getMap(PROJECT_PRESENTATION_CONTAINER)
      .set("coverBindingId", "missing-cover-binding");

    expect(reconcileProjectCoverBindings(doc)).toEqual({
      coverAssetId: null,
      unboundBindingIds: [],
      changed: true,
    });
    expect(
      doc.getMap(PROJECT_PRESENTATION_CONTAINER).get("coverBindingId"),
    ).toBeUndefined();
  });
});
