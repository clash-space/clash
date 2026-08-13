import { describe, expect, it } from "vitest";
import {
  buildScopedAssetSections,
  buildScopedTimelineAssetInput,
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

  it("adds current Canvas assets only for a Canvas-owned Timeline and removes duplicates downstream", () => {
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
    ]);
  });

  it("removes assets already bound to a standalone Timeline from every larger scope", () => {
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
      waveform: [0.1, 0.7],
    });
  });
});
