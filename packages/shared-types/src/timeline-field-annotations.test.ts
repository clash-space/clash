import { describe, expect, it } from "vitest";
import * as shared from "./index";

const EXPECTED_FIELDS = {
  root: [
    "compositionWidth",
    "compositionHeight",
    "fps",
    "durationInFrames",
    "primaryTrackId",
    "tracks",
    "assetTranscripts",
    "mediaAssetRefs",
  ],
  track: ["id", "name", "role", "category", "items", "hidden", "locked"],
  itemBase: [
    "id",
    "type",
    "from",
    "durationInFrames",
    "assetId",
    "sourceNodeId",
    "properties",
    "keyframes",
    "mask",
    "effects",
    "bakedAssetPath",
    "fromExpr",
  ],
  itemTypes: {
    solid: ["color"],
    text: [
      "text",
      "color",
      "fontSize",
      "fontFamily",
      "fontWeight",
      "textAlign",
      "letterSpacingPx",
      "lineHeight",
      "cues",
      "language",
      "wordRefs",
      "sourceToOutputMap",
      "style",
    ],
    video: [
      "src",
      "mediaFit",
      "sourceStartInFrames",
      "audioGainDb",
      "volume",
      "waveform",
      "entranceAnimation",
      "exitAnimation",
      "videoFadeIn",
      "videoFadeOut",
      "audioFadeInFrames",
      "audioFadeOutFrames",
      "audioFadeIn",
      "audioFadeOut",
      "videoFadeInColor",
      "videoFadeOutColor",
    ],
    audio: [
      "src",
      "sourceStartInFrames",
      "audioGainDb",
      "audioDucking",
      "volume",
      "waveform",
      "audioFadeInFrames",
      "audioFadeOutFrames",
      "audioFadeIn",
      "audioFadeOut",
    ],
    image: [
      "src",
      "mediaFit",
      "imageFadeIn",
      "imageFadeOut",
      "imageFadeInColor",
      "imageFadeOutColor",
    ],
    sticker: ["src", "mediaFit", "sequence"],
    composition: [
      "compositionKind",
      "runtime",
      "compositionId",
      "sourcePath",
      "renderedAssetPath",
      "spec",
    ],
    "derived-overlay": [
      "mediaType",
      "src",
      "mediaFit",
      "sourceAssetId",
      "derivedAssetId",
      "derivation",
    ],
    transition: ["transitionType", "fromItemId", "toItemId", "effect"],
  },
} as const;

describe("complete Timeline field annotations", () => {
  it("publishes every current root, track, common item, and item-type field", () => {
    const catalog = (shared as Record<string, unknown>)
      .TIMELINE_DSL_FIELD_CATALOG as any;

    expect(catalog).toBeDefined();
    if (!catalog) return;
    expect(Object.keys(catalog.root.fields)).toEqual(EXPECTED_FIELDS.root);
    expect(Object.keys(catalog.track.fields)).toEqual(EXPECTED_FIELDS.track);
    expect(Object.keys(catalog.itemBase.fields)).toEqual(EXPECTED_FIELDS.itemBase);
    expect(Object.keys(catalog.itemTypes)).toEqual(Object.keys(EXPECTED_FIELDS.itemTypes));
    for (const [itemType, fields] of Object.entries(EXPECTED_FIELDS.itemTypes)) {
      expect(Object.keys(catalog.itemTypes[itemType].fields), itemType).toEqual(fields);
    }
  });

  it("requires executable schema, documentation, editor, and runtime routing metadata", () => {
    const annotations = (shared as Record<string, unknown>)
      .TIMELINE_DSL_FIELD_ANNOTATIONS as any;

    expect(annotations).toBeDefined();
    if (!annotations) return;
    const groups = [
      annotations.root,
      annotations.track,
      annotations.itemBase,
      ...Object.values(annotations.itemTypes),
    ] as Array<Record<string, any>>;
    for (const group of groups) {
      for (const [field, annotation] of Object.entries(group)) {
        expect(annotation.schema?.safeParse, field).toBeTypeOf("function");
        expect(annotation.description, field).toEqual(expect.any(String));
        expect(annotation.description.length, field).toBeGreaterThan(0);
        expect(annotation.authored, field).toBeTypeOf("boolean");
        expect(annotation.editor?.surface, field).toMatch(/^(timeline|properties-panel|none)$/);
        expect(annotation.runtimeConsumers, field).toEqual(expect.any(Array));
      }
    }
  });

  it("types every runtime consumer against the published consumer taxonomy", () => {
    const consumerTaxonomy = (shared as Record<string, unknown>)
      .TIMELINE_DSL_RUNTIME_CONSUMERS as readonly string[] | undefined;
    expect(consumerTaxonomy).toEqual([
      "asset-loader",
      "audio-ducking",
      "audio-mix",
      "canvas-link",
      "caption-export",
      "caption-generation",
      "composition-runtime",
      "derivation",
      "editor",
      "effect-runtime",
      "export",
      "future-renderer",
      "migration",
      "persistence",
      "preview",
      "render",
      "timeline-semantics",
      "transcript",
      "yaml",
    ]);

    const annotations = (shared as Record<string, unknown>)
      .TIMELINE_DSL_FIELD_ANNOTATIONS as any;
    const declared = new Set(consumerTaxonomy);
    for (const group of [
      annotations.root,
      annotations.track,
      annotations.itemBase,
      ...Object.values(annotations.itemTypes),
    ] as Array<Record<string, any>>) {
      for (const annotation of Object.values(group)) {
        for (const consumer of annotation.runtimeConsumers) {
          expect(declared.has(consumer), consumer).toBe(true);
        }
      }
    }
  });
});
