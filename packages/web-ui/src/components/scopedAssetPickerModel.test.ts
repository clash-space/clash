import { describe, expect, it } from "vitest";
import {
  buildComposerAssetSections,
  buildScopedAssetSections,
  buildScopedTimelineAssetInput,
  commitScopedTimelineAssetInsertion,
} from "./scopedAssetPickerModel";

const lifecycle = { state: "active" as const };
const projectAssets = [
  {
    id: "asset-canvas",
    name: "Opening frame",
    url: "https://media.clash.test/assets/opening",
    thumbnailUrl: "https://media.clash.test/thumbnails/opening",
    kind: "image" as const,
    lifecycle,
    metadata: {},
    status: "ready" as const,
  },
  {
    id: "asset-project",
    name: "Voice over",
    url: "https://media.clash.test/assets/voice",
    kind: "audio" as const,
    lifecycle,
    metadata: {},
    status: "ready" as const,
  },
];
const globalAssets = [
  {
    id: "asset-global",
    name: "Brand sting",
    url: "https://media.clash.test/assets/sting",
    thumbnailUrl: "https://media.clash.test/thumbnails/sting",
    kind: "video" as const,
    lifecycle,
    metadata: {},
    status: "ready" as const,
  },
  projectAssets[1],
];
const nodes = [
  {
    id: "opening-node",
    canvasId: "main",
    type: "image",
    data: { assetId: "asset-canvas", label: "Opening frame" },
  },
  {
    id: "other-node",
    canvasId: "other",
    type: "audio",
    data: { assetId: "asset-project", label: "Other voice" },
  },
];

describe("buildScopedAssetSections", () => {
  it("keeps Composer Project and Global library identities in separate scopes", () => {
    const sections = buildComposerAssetSections({
      projectAssets,
      globalAssets,
    });

    expect(sections[0].assets[0].source).toEqual({
      kind: "project",
      assetId: "asset-canvas",
    });
    expect(sections[1].label).toBe("Global Assets");
    expect(sections[1].assets[0].source).toEqual({
      kind: "global-library",
      assetId: "asset-global",
    });
    expect(sections[1].allowLocalUpload).toBe(true);
  });

  it("gives a Canvas project assets plus one external scope and no parent Canvas section", () => {
    const sections = buildScopedAssetSections({
      target: { kind: "canvas", canvasId: "main" },
      projectAssets,
      globalAssets,
      nodes,
    });
    expect(sections.map((section) => section.scope)).toEqual([
      "project",
      "external",
    ]);
    expect(sections.some((section) => section.scope === "current-canvas")).toBe(
      false,
    );
    expect(sections[0].assets.map((asset) => asset.assetId)).toEqual([
      "asset-project",
    ]);
    expect(
      sections.find((section) => section.scope === "external")
        ?.allowLocalUpload,
    ).toBe(true);
  });

  it("adds current Canvas assets only for a Canvas-owned Timeline without conflating scope ids", () => {
    const sections = buildScopedAssetSections({
      target: {
        kind: "timeline",
        timelineId: "cut",
        owner: {
          kind: "canvas-action",
          canvasId: "main",
          actionNodeId: "editor",
        },
      },
      projectAssets,
      globalAssets,
      nodes,
      bindings: [
        {
          id: "binding-opening",
          owner: { kind: "draft", actionId: "node:editor" },
          direction: "input",
          slot: "timeline:item:opening",
          projectAssetId: "asset-canvas",
        },
      ],
    });
    expect(sections.map((section) => section.scope)).toEqual([
      "current-canvas",
      "project",
      "external",
    ]);
    expect(sections[0].assets).toEqual([]);
    expect(sections[1].assets.map((asset) => asset.assetId)).toEqual([
      "asset-project",
    ]);
    expect(sections[2].assets.map((asset) => asset.assetId)).toEqual([
      "asset-global",
      "asset-project",
    ]);
  });

  it("removes bound Project entries while retaining independent Global entries with the same id", () => {
    const sections = buildScopedAssetSections({
      target: {
        kind: "timeline",
        timelineId: "standalone",
        owner: { kind: "project" },
      },
      bindings: [
        {
          id: "binding-1",
          owner: { kind: "draft", actionId: "timeline:standalone" },
          direction: "input",
          slot: "timeline:item:voice-over",
          projectAssetId: "asset-project",
        },
      ],
      projectAssets,
      globalAssets,
      nodes,
    });
    expect(sections[0].assets.map((asset) => asset.assetId)).toEqual([
      "asset-canvas",
    ]);
    expect(sections[1].assets.map((asset) => asset.assetId)).toEqual([
      "asset-global",
      "asset-project",
    ]);
  });

  it("never uses a storage key or UUID as visible copy", () => {
    const sections = buildScopedAssetSections({
      target: { kind: "canvas", canvasId: "main" },
      projectAssets: [
        {
          id: "fce43e93-badc-4c4e-88bf-a4ec8b1a1871",
          url: "https://media.clash.test/assets/fce43e93-badc-4c4e-88bf-a4ec8b1a1871",
          kind: "image",
          lifecycle,
          metadata: {},
          status: "ready",
        },
      ],
      globalAssets: [],
      nodes: [],
    });
    expect(sections[0].assets[0].name).toBe("Image");
  });

  it("inserts playable video bytes while keeping the cover as its thumbnail", () => {
    const sections = buildScopedAssetSections({
      target: {
        kind: "timeline",
        timelineId: "standalone",
        owner: { kind: "project" },
      },
      projectAssets: [
        {
          id: "asset-video",
          name: "Talking head",
          url: "https://media.clash.test/assets/asset-video",
          thumbnailUrl: "https://media.clash.test/thumbnails/asset-video",
          kind: "video",
          lifecycle,
          metadata: {},
          status: "ready",
        },
      ],
      globalAssets: [],
      nodes: [],
    });

    expect(sections[0].assets[0]).toMatchObject({
      src: "https://media.clash.test/assets/asset-video",
      thumbnail: "https://media.clash.test/thumbnails/asset-video",
    });
  });

  it("hydrates Timeline insertion dimensions and duration from the authoritative Asset row", () => {
    expect(
      buildScopedTimelineAssetInput({
        option: {
          assetId: "asset-video",
          name: "Talking head",
          type: "video",
          src: "/fallback.mp4",
          thumbnail: "/fallback-cover.jpg",
          status: "ready",
          source: { kind: "project", assetId: "asset-video" },
        },
        sourceNodeId: "timeline-asset:asset-video",
        projectAssetId: "asset-video",
        asset: {
          id: "asset-video",
          kind: "video",
          status: "ready",
          lifecycle,
          url: "https://media.clash.test/assets/asset-video",
          thumbnailUrl: "https://media.clash.test/thumbnails/asset-video",
          metadata: {
            width: 1920,
            height: 1080,
            durationMs: 32_661,
            waveform: [0.1, 0.7],
          },
        },
      }),
    ).toMatchObject({
      id: "timeline-asset:asset-video",
      projectAssetId: "asset-video",
      sourceNodeId: "timeline-asset:asset-video",
      src: "https://media.clash.test/assets/asset-video",
      thumbnail: "https://media.clash.test/thumbnails/asset-video",
      type: "video",
      width: 1920,
      height: 1080,
      duration: 32.661,
    });
    expect(
      buildScopedTimelineAssetInput({
        option: {
          assetId: "asset-video",
          name: "Talking head",
          type: "video",
          src: "/fallback.mp4",
          status: "ready",
          source: { kind: "project", assetId: "asset-video" },
        },
        sourceNodeId: "timeline-asset:asset-video",
        projectAssetId: "asset-video",
        asset: {
          id: "asset-video",
          kind: "video",
          status: "ready",
          lifecycle,
          url: "https://media.clash.test/assets/asset-video",
          metadata: { waveform: [0.1, 0.7] },
        },
      }),
    ).not.toHaveProperty("waveform");
  });

  it("carries Host availability and disables unavailable Timeline inputs", () => {
    const sections = buildScopedAssetSections({
      target: {
        kind: "timeline",
        timelineId: "standalone",
        owner: { kind: "project" },
      },
      projectAssets: [
        {
          id: "asset-downloading",
          name: "Remote cut",
          kind: "video",
          lifecycle,
          metadata: {},
          status: "downloading",
          progress: 0.42,
        },
      ],
      globalAssets: [],
      nodes: [],
    });

    expect(sections[0].assets[0]).toMatchObject({
      assetId: "asset-downloading",
      status: "downloading",
      progress: 0.42,
      disabledReason: "Downloading 42%",
    });
  });

  it("keeps a Global entry visible when an unrelated Project entry has the same scoped id", () => {
    const sections = buildScopedAssetSections({
      target: { kind: "canvas", canvasId: "main" },
      projectAssets: [
        {
          id: "same-id",
          name: "Project still",
          url: "https://media.clash.test/projects/same-id",
          kind: "image",
          lifecycle,
          metadata: {},
          status: "ready",
        },
      ],
      globalAssets: [
        {
          id: "same-id",
          name: "Global still",
          url: "https://media.clash.test/global/same-id",
          kind: "image",
          lifecycle,
          metadata: {},
          status: "ready",
        },
      ],
      nodes: [],
    });

    expect(
      sections.find((section) => section.scope === "external")?.assets,
    ).toEqual([
      expect.objectContaining({
        assetId: "same-id",
        name: "Global still",
        source: { kind: "global-library", assetId: "same-id" },
      }),
    ]);
  });
});

describe("commitScopedTimelineAssetInsertion", () => {
  it("publishes Host-resolved 32.661s 1920x1080 media only after its cascade completes", async () => {
    const published: unknown[] = [];
    const order: string[] = [];

    await commitScopedTimelineAssetInsertion({
      option: {
        assetId: "asset-video",
        name: "Talking head",
        type: "video",
        src: "/stale.mp4",
        status: "ready",
        source: { kind: "project", assetId: "asset-video" },
      },
      target: {
        kind: "timeline",
        timelineId: "timeline-cut",
        owner: {
          kind: "canvas-action",
          canvasId: "main",
          actionNodeId: "timeline-action",
        },
      },
      runCascade: async () => {
        order.push("cascade");
        return {
          assetId: "asset-video",
          sourceNodeId: "canvas-placement-video",
        };
      },
      resolveProjectAsset: async () => {
        order.push("resolve");
        return {
          id: "asset-video",
          kind: "video",
          status: "ready",
          lifecycle,
          url: "https://media.clash.test/assets/asset-video",
          metadata: { width: 1920, height: 1080, durationMs: 32_661 },
        };
      },
      createRequestId: () => "drop-request-1",
      publishRequest: (request) => {
        order.push("publish");
        published.push(request);
      },
    });

    expect(order).toEqual(["cascade", "resolve", "publish"]);
    expect(published).toEqual([
      {
        timelineId: "timeline-cut",
        requestId: "drop-request-1",
        asset: expect.objectContaining({
          id: "canvas-placement-video",
          projectAssetId: "asset-video",
          sourceNodeId: "canvas-placement-video",
          src: "https://media.clash.test/assets/asset-video",
          width: 1920,
          height: 1080,
          duration: 32.661,
        }),
      },
    ]);
  });

  it("rejects unavailable media before cascade and publishes no item", async () => {
    const published: unknown[] = [];
    const cascadeStates: string[] = [];

    await expect(
      commitScopedTimelineAssetInsertion({
        option: {
          assetId: "asset-downloading",
          name: "Remote cut",
          type: "video",
          src: "",
          status: "downloading",
          progress: 0.42,
          disabledReason: "Downloading 42%",
          source: { kind: "project", assetId: "asset-downloading" },
        },
        target: {
          kind: "timeline",
          timelineId: "timeline-cut",
          owner: { kind: "project" },
        },
        runCascade: async () => {
          cascadeStates.push("started");
          return { assetId: "asset-downloading" };
        },
        resolveProjectAsset: async () => {
          throw new Error("Host resolve must not run");
        },
        createRequestId: () => "unavailable-request",
        publishRequest: (request) => published.push(request),
      }),
    ).rejects.toThrow("Downloading 42%");
    expect(cascadeStates).toEqual([]);
    expect(published).toEqual([]);
  });

  it("publishes no Timeline item when the scope cascade fails", async () => {
    const published: unknown[] = [];

    await expect(
      commitScopedTimelineAssetInsertion({
        option: {
          assetId: "asset-video",
          name: "Talking head",
          type: "video",
          src: "https://media.clash.test/assets/asset-video",
          status: "ready",
          source: { kind: "project", assetId: "asset-video" },
        },
        target: {
          kind: "timeline",
          timelineId: "timeline-cut",
          owner: { kind: "project" },
        },
        runCascade: async () => {
          throw new Error("Canvas placement failed");
        },
        resolveProjectAsset: async () => {
          throw new Error("Host resolve must not run");
        },
        createRequestId: () => "failed-request",
        publishRequest: (request) => published.push(request),
      }),
    ).rejects.toThrow("Canvas placement failed");
    expect(published).toEqual([]);
  });
});
