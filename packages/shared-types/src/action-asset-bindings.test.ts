import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";

import type { ActionAssetBinding } from "./assets.js";
import {
  ACTION_ASSET_BINDING_AUTHORITY_VERSION,
  actionAssetBindingAuthorityVersion,
  createActionAssetBinding,
  ensureActionAssetBinding,
  listActionAssetBindings,
  listActionAssetReferences,
  markActionAssetBindingAuthority,
  projectAssetMutationReadToken,
  projectAssetMutationReadTokenFromDoc,
  readActionAssetBinding,
  reconcileActionAssetBindingTargets,
  trashProjectAssetIfUnreferenced,
  unbindActionAssetBinding,
  updateActionAssetBinding,
} from "./action-asset-bindings.js";
import {
  createProjectAsset,
  readProjectAsset,
  trashProjectAsset,
} from "./project-assets.js";

const asset = (id: string) => ({
  id,
  kind: "image" as const,
  source: { kind: "owned" as const, resourceId: `resource-${id}` },
  lifecycle: { state: "active" as const },
  metadata: {},
});

const binding = (
  id: string,
  projectAssetId = "asset-1",
  slot = `reference:${id}`,
): ActionAssetBinding => ({
  id,
  owner: { kind: "draft", actionId: "action-1" },
  direction: "input",
  slot,
  projectAssetId,
  role: "reference",
});

function mergePeers(
  left: LoroDoc,
  right: LoroDoc,
  leftVersion: ReturnType<LoroDoc["version"]>,
  rightVersion: ReturnType<LoroDoc["version"]>,
): void {
  const leftUpdate = left.export({ mode: "update", from: leftVersion });
  const rightUpdate = right.export({ mode: "update", from: rightVersion });
  left.import(rightUpdate);
  right.import(leftUpdate);
}

describe("Action Asset binding authority", () => {
  it("ensures one immutable binding fact idempotently and rejects identity collisions", () => {
    const doc = new LoroDoc();
    createProjectAsset(doc, asset("asset-1"));
    createProjectAsset(doc, asset("asset-2"));
    const expected = binding("stable-binding");

    expect(ensureActionAssetBinding(doc, expected)).toEqual({
      ok: true,
      binding: expected,
      changed: true,
    });
    expect(ensureActionAssetBinding(doc, { ...expected })).toEqual({
      ok: true,
      binding: expected,
      changed: false,
    });

    expect(
      ensureActionAssetBinding(doc, {
        ...expected,
        projectAssetId: "asset-2",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "ACTION_ASSET_BINDING_EXISTS",
        bindingId: expected.id,
      },
    });
    expect(readActionAssetBinding(doc, expected.id)).toEqual(expected);
  });

  it("fails closed when deletion runs before legacy references are materialized", () => {
    const doc = new LoroDoc();
    createProjectAsset(doc, asset("asset-1"));

    expect(
      trashProjectAssetIfUnreferenced(doc, {
        id: "asset-1",
        deleteOperationId: "delete-before-cutover",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "ACTION_ASSET_BINDING_AUTHORITY_REQUIRED",
        message:
          "Project Asset deletion is unavailable until legacy Action Asset references are materialized.",
        requiredVersion: ACTION_ASSET_BINDING_AUTHORITY_VERSION,
      },
    });
    expect(actionAssetBindingAuthorityVersion(doc)).toBeUndefined();
  });

  it("records a monotonic authority fact and rejects an unknown merged version", () => {
    const base = new LoroDoc();
    expect(markActionAssetBindingAuthority(base)).toEqual({
      ok: true,
      version: 1,
    });
    const snapshot = base.export({ mode: "snapshot" });
    const currentPeer = LoroDoc.fromSnapshot(snapshot);
    const futurePeer = LoroDoc.fromSnapshot(snapshot);
    const currentVersion = currentPeer.version();
    const futureVersion = futurePeer.version();

    futurePeer
      .getMap("actionAssetBindingSchema")
      .ensureMergeableMap("authorityVersions")
      .set("2", true);
    mergePeers(currentPeer, futurePeer, currentVersion, futureVersion);

    for (const doc of [currentPeer, futurePeer]) {
      expect(actionAssetBindingAuthorityVersion(doc)).toBe(2);
      expect(
        createActionAssetBinding(doc, binding("future-binding")),
      ).toMatchObject({
        ok: false,
        error: { code: "UNSUPPORTED_ACTION_ASSET_BINDING_AUTHORITY" },
      });
      expect(markActionAssetBindingAuthority(doc)).toMatchObject({
        ok: false,
        error: { code: "UNSUPPORTED_ACTION_ASSET_BINDING_AUTHORITY" },
      });
    }
  });

  it("creates, reads, updates, lists and explicitly unbinds", () => {
    const doc = new LoroDoc();
    createProjectAsset(doc, asset("asset-1"));
    createProjectAsset(doc, asset("asset-2"));

    expect(createActionAssetBinding(doc, binding("binding-b"))).toMatchObject({
      ok: true,
    });
    expect(createActionAssetBinding(doc, binding("binding-a"))).toMatchObject({
      ok: true,
    });
    expect(readActionAssetBinding(doc, "binding-a")).toEqual(
      binding("binding-a"),
    );
    expect(listActionAssetBindings(doc).map((value) => value.id)).toEqual([
      "binding-a",
      "binding-b",
    ]);

    const updated = binding("binding-a", "asset-2", "source");
    expect(updateActionAssetBinding(doc, updated)).toEqual({
      ok: true,
      binding: updated,
    });
    expect(listActionAssetReferences(doc, "asset-2")).toEqual([updated]);
    expect(unbindActionAssetBinding(doc, "binding-a")).toEqual({
      ok: true,
      binding: updated,
    });
    expect(readActionAssetBinding(doc, "binding-a")).toBeNull();
  });

  it("only binds active Project Assets", () => {
    const doc = new LoroDoc();
    createProjectAsset(doc, asset("asset-1"));
    trashProjectAsset(doc, {
      id: "asset-1",
      deleteOperationId: "delete-1",
      deletedAt: "2026-08-13T00:00:00.000Z",
      purgeAfter: "2026-08-20T00:00:00.000Z",
    });

    expect(createActionAssetBinding(doc, binding("binding-1"))).toMatchObject({
      ok: false,
      error: { code: "PROJECT_ASSET_NOT_ACTIVE" },
    });
  });

  it("merges concurrent bindings and returns stable reference order", () => {
    const base = new LoroDoc();
    createProjectAsset(base, asset("asset-1"));
    const snapshot = base.export({ mode: "snapshot" });
    const left = LoroDoc.fromSnapshot(snapshot);
    const right = LoroDoc.fromSnapshot(snapshot);
    const leftVersion = left.version();
    const rightVersion = right.version();

    createActionAssetBinding(left, binding("binding-b"));
    createActionAssetBinding(right, binding("binding-a"));
    mergePeers(left, right, leftVersion, rightVersion);

    for (const doc of [left, right]) {
      expect(
        listActionAssetReferences(doc, "asset-1").map((value) => value.id),
      ).toEqual(["binding-a", "binding-b"]);
    }
  });

  it("keeps explicit unbind terminal across a concurrent stale update", () => {
    const base = new LoroDoc();
    createProjectAsset(base, asset("asset-1"));
    createProjectAsset(base, asset("asset-2"));
    createActionAssetBinding(base, binding("binding-1"));
    const snapshot = base.export({ mode: "snapshot" });
    const unbindingPeer = LoroDoc.fromSnapshot(snapshot);
    const stalePeer = LoroDoc.fromSnapshot(snapshot);
    const unbindingVersion = unbindingPeer.version();
    const staleVersion = stalePeer.version();

    unbindActionAssetBinding(unbindingPeer, "binding-1");
    updateActionAssetBinding(stalePeer, binding("binding-1", "asset-2"));
    mergePeers(unbindingPeer, stalePeer, unbindingVersion, staleVersion);

    for (const doc of [unbindingPeer, stalePeer]) {
      expect(readActionAssetBinding(doc, "binding-1")).toBeNull();
      expect(listActionAssetReferences(doc, "asset-1")).toEqual([]);
      expect(listActionAssetReferences(doc, "asset-2")).toEqual([]);
    }
  });

  it("returns structured ASSET_IN_USE and leaves lifecycle active", () => {
    const doc = new LoroDoc();
    createProjectAsset(doc, asset("asset-1"));
    createActionAssetBinding(doc, binding("binding-b"));
    createActionAssetBinding(doc, binding("binding-a"));
    markActionAssetBindingAuthority(doc);

    expect(
      trashProjectAssetIfUnreferenced(doc, {
        id: "asset-1",
        deleteOperationId: "delete-1",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "ASSET_IN_USE",
        projectAssetId: "asset-1",
        references: [binding("binding-a"), binding("binding-b")],
      },
    });
  });

  it("keeps output lineage without treating the producing Action as a downstream use", () => {
    const doc = new LoroDoc();
    createProjectAsset(doc, asset("asset-1"));
    const output: ActionAssetBinding = {
      ...binding("output-1"),
      direction: "output",
      slot: "media",
      role: undefined,
    };
    expect(createActionAssetBinding(doc, output)).toMatchObject({ ok: true });
    markActionAssetBindingAuthority(doc);

    expect(
      trashProjectAssetIfUnreferenced(doc, {
        id: "asset-1",
        deleteOperationId: "delete-output",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      }),
    ).toMatchObject({ ok: true, entry: { lifecycle: { state: "trashed" } } });
    expect(readActionAssetBinding(doc, output.id)).toEqual(output);
    expect(listActionAssetReferences(doc, "asset-1")).toEqual([output]);
  });

  it("restores a logically deleted Asset after a concurrent input binding wins", () => {
    const base = new LoroDoc();
    createProjectAsset(base, asset("asset-1"));
    markActionAssetBindingAuthority(base);
    const snapshot = base.export({ mode: "snapshot" });
    const deletingPeer = LoroDoc.fromSnapshot(snapshot);
    const bindingPeer = LoroDoc.fromSnapshot(snapshot);
    const deletingVersion = deletingPeer.version();
    const bindingVersion = bindingPeer.version();

    expect(
      trashProjectAssetIfUnreferenced(deletingPeer, {
        id: "asset-1",
        deleteOperationId: "delete-1",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      }),
    ).toMatchObject({ ok: true });
    expect(
      createActionAssetBinding(bindingPeer, binding("binding-1")),
    ).toMatchObject({ ok: true });
    mergePeers(deletingPeer, bindingPeer, deletingVersion, bindingVersion);

    for (const doc of [deletingPeer, bindingPeer]) {
      expect(reconcileActionAssetBindingTargets(doc)).toEqual({
        restoredProjectAssetIds: ["asset-1"],
      });
      expect(readActionAssetBinding(doc, "binding-1")).toEqual(
        binding("binding-1"),
      );
      expect(listActionAssetReferences(doc, "asset-1")).toEqual([
        binding("binding-1"),
      ]);
      expect(
        trashProjectAssetIfUnreferenced(doc, {
          id: "asset-1",
          deleteOperationId: "delete-2",
          deletedAt: "2026-08-14T00:00:00.000Z",
          purgeAfter: "2026-08-21T00:00:00.000Z",
        }),
      ).toMatchObject({ ok: false, error: { code: "ASSET_IN_USE" } });
    }
  });

  it("does not restore a logically deleted Asset for output lineage alone", () => {
    const doc = new LoroDoc();
    createProjectAsset(doc, asset("asset-1"));
    markActionAssetBindingAuthority(doc);
    const output: ActionAssetBinding = {
      ...binding("output-1"),
      direction: "output",
      slot: "media",
      role: undefined,
    };
    expect(createActionAssetBinding(doc, output)).toMatchObject({ ok: true });
    expect(
      trashProjectAsset(doc, {
        id: "asset-1",
        deleteOperationId: "delete-output",
        deletedAt: "2026-08-13T00:00:00.000Z",
        purgeAfter: "2026-08-20T00:00:00.000Z",
      }),
    ).toMatchObject({ ok: true });

    expect(reconcileActionAssetBindingTargets(doc)).toEqual({
      restoredProjectAssetIds: [],
    });
    expect(readProjectAsset(doc, "asset-1")?.lifecycle.state).toBe("trashed");
    expect(readActionAssetBinding(doc, output.id)).toEqual(output);
  });

  it("derives Project-scoped CAS from the Asset and blocking input bindings only", () => {
    const doc = new LoroDoc();
    createProjectAsset(doc, asset("asset-1"));
    markActionAssetBindingAuthority(doc);
    const initial = projectAssetMutationReadTokenFromDoc(
      doc,
      "project-a",
      "asset-1",
    );
    expect(initial).toMatch(/^project-asset-v1:[a-f0-9]{16}$/);

    const output: ActionAssetBinding = {
      ...binding("output-1"),
      direction: "output",
      slot: "media",
      role: undefined,
    };
    createActionAssetBinding(doc, output);
    expect(
      projectAssetMutationReadTokenFromDoc(doc, "project-a", "asset-1"),
    ).toBe(initial);

    createActionAssetBinding(doc, binding("input-b"));
    createActionAssetBinding(doc, binding("input-a"));
    const withInputs = projectAssetMutationReadTokenFromDoc(
      doc,
      "project-a",
      "asset-1",
    );
    expect(withInputs).not.toBe(initial);
    expect(
      projectAssetMutationReadToken({
        projectId: "project-a",
        entry: readProjectAsset(doc, "asset-1")!,
        references: [binding("input-b"), output, binding("input-a")],
      }),
    ).toBe(withInputs);
    expect(
      projectAssetMutationReadTokenFromDoc(doc, "project-b", "asset-1"),
    ).not.toBe(withInputs);
  });
});
