import { describe, expect, it } from "vitest";
import {
  assetReferenceScopePath,
  planAssetScopeCascade,
  visibleAssetSourceScopes,
} from "./asset-scope-cascade.js";

describe("asset scope cascade", () => {
  it("derives propagation from the target reference path", () => {
    expect(
      assetReferenceScopePath({ kind: "canvas", canvasId: "main" }),
    ).toEqual(["project", "canvas"]);
    expect(
      assetReferenceScopePath({
        kind: "timeline",
        timelineId: "standalone",
        owner: { kind: "project" },
      }),
    ).toEqual(["project", "timeline"]);
    expect(
      assetReferenceScopePath({
        kind: "timeline",
        timelineId: "cut",
        owner: {
          kind: "canvas-action",
          canvasId: "main",
          actionNodeId: "editor",
        },
      }),
    ).toEqual(["project", "canvas", "timeline"]);
  });

  it("never invents a parent Canvas scope for a Canvas target", () => {
    expect(
      visibleAssetSourceScopes({ kind: "canvas", canvasId: "main" }),
    ).toEqual(["project", "external"]);
    expect(
      planAssetScopeCascade({
        source: { kind: "project", assetId: "asset-1" },
        target: { kind: "canvas", canvasId: "main" },
      }),
    ).toEqual([
      { kind: "ensure-canvas-placement", canvasId: "main", assetId: "asset-1" },
    ]);
    expect(() =>
      planAssetScopeCascade({
        source: {
          kind: "current-canvas",
          assetId: "asset-1",
          sourceNodeId: "node-1",
          canvasId: "main",
        },
        target: { kind: "canvas", canvasId: "main" },
      }),
    ).toThrow("Current Canvas is only an ancestor of its owned Timeline");
  });

  it("shows current Canvas assets only for a Canvas-owned Timeline", () => {
    const target = {
      kind: "timeline" as const,
      timelineId: "cut",
      owner: {
        kind: "canvas-action" as const,
        canvasId: "main",
        actionNodeId: "editor",
      },
    };
    expect(visibleAssetSourceScopes(target)).toEqual([
      "current-canvas",
      "project",
      "external",
    ]);
    expect(
      planAssetScopeCascade({
        source: {
          kind: "current-canvas",
          assetId: "asset-1",
          sourceNodeId: "image-node",
          canvasId: "main",
        },
        target,
      }),
    ).toEqual([
      {
        kind: "ensure-timeline-input",
        timelineId: "cut",
        assetId: "asset-1",
        via: "canvas-edge",
        canvasId: "main",
        actionNodeId: "editor",
        sourceNodeId: "image-node",
      },
    ]);
    expect(() =>
      planAssetScopeCascade({
        source: {
          kind: "current-canvas",
          assetId: "asset-1",
          sourceNodeId: "image-node",
          canvasId: "other",
        },
        target,
      }),
    ).toThrow("Current Canvas is only an ancestor of its owned Timeline");
  });

  it("cascades a global asset through Project and Canvas before a Canvas-owned Timeline", () => {
    expect(
      planAssetScopeCascade({
        source: { kind: "global-library", assetId: "asset-global" },
        target: {
          kind: "timeline",
          timelineId: "cut",
          owner: {
            kind: "canvas-action",
            canvasId: "main",
            actionNodeId: "editor",
          },
        },
      }),
    ).toEqual([
      { kind: "ensure-project-reference", assetId: "asset-global" },
      {
        kind: "ensure-canvas-placement",
        canvasId: "main",
        assetId: "asset-global",
      },
      {
        kind: "ensure-timeline-input",
        timelineId: "cut",
        assetId: "asset-global",
        via: "canvas-edge",
        canvasId: "main",
        actionNodeId: "editor",
      },
    ]);
  });

  it("uses a direct Timeline reference when the Timeline is Project-owned", () => {
    const target = {
      kind: "timeline" as const,
      timelineId: "standalone",
      owner: { kind: "project" as const },
    };
    expect(visibleAssetSourceScopes(target)).toEqual(["project", "external"]);
    expect(
      planAssetScopeCascade({
        source: { kind: "project", assetId: "asset-1" },
        target,
      }),
    ).toEqual([
      {
        kind: "ensure-timeline-input",
        timelineId: "standalone",
        assetId: "asset-1",
        via: "timeline-reference",
      },
    ]);
  });

  it("never promotes a local upload into the global library", () => {
    const steps = planAssetScopeCascade({
      source: { kind: "local-file" },
      target: { kind: "canvas", canvasId: "main" },
    });
    expect(steps).toEqual([
      { kind: "create-project-asset", addToGlobalLibrary: false },
      { kind: "ensure-canvas-placement", canvasId: "main" },
    ]);
    expect(
      steps.some((step) => step.kind === "ensure-global-library-reference"),
    ).toBe(false);
  });
});
