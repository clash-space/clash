import { describe, expect, it } from "vitest";
import {
  TIMELINE_DSL_DEFINITION,
  TIMELINE_DSL_FIELD_ANNOTATIONS,
  TIMELINE_DSL_FIELD_CATALOG,
  TIMELINE_OPERATION_CATALOG,
  TimelineDslItemSchema,
  TimelineDslSchema,
  TimelineDerivedAssetSchema,
  TimelineSequenceSchema,
  renderTimelineDslMarkdown,
} from "./index";

function item(
  type: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `${type}-1`,
    type,
    from: 0,
    durationInFrames: 30,
    ...fields,
  };
}

describe("Timeline field descriptor consumers", () => {
  it("publishes the complete serializable field catalog with the contract", () => {
    expect((TIMELINE_DSL_DEFINITION as any).fieldCatalog).toEqual(
      TIMELINE_DSL_FIELD_CATALOG,
    );
    expect((TIMELINE_DSL_DEFINITION as any).taxonomy).toMatchObject({
      itemTypes: expect.arrayContaining(Object.keys(TIMELINE_DSL_FIELD_CATALOG.itemTypes)),
      trackCategories: ["effect", "text", "visual", "primary", "audio"],
      trackRoles: expect.arrayContaining(["primary-video", "subtitle", "music", "mixed"]),
      categoryAllowedItemTypes: {
        primary: ["video", "image", "solid"],
        visual: expect.arrayContaining(["composition"]),
      },
      roleAllowedItemTypes: {
        music: ["audio"],
      },
      runtimeConsumers: expect.arrayContaining(["editor", "render", "persistence"]),
      mediaFits: ["fill", "cover", "contain"],
      clipAnimationTypes: expect.arrayContaining(["fade", "zoom-in", "slide-left"]),
      textAlignments: ["left", "center", "right"],
      captionPositions: ["bottom", "top", "center"],
      compositionKinds: ["motion-graphics", "custom"],
      compositionRuntimes: ["html", "react", "remotion"],
      derivedMediaTypes: ["image", "video"],
      derivationKinds: expect.arrayContaining(["trim", "crop", "transcode"]),
      transitionTypes: expect.arrayContaining(["crossfade", "circle-wipe", "zoom-in"]),
    });
  });

  it("publishes the complete serializable operation catalog with the contract", () => {
    expect((TIMELINE_DSL_DEFINITION as any).operationCatalog).toEqual(
      TIMELINE_OPERATION_CATALOG,
    );
    expect(Object.keys((TIMELINE_DSL_DEFINITION as any).operationCatalog.agent)).toEqual([
      "timeline.open",
      "timeline.schema",
      "timeline.validate",
      "timeline.list",
      "timeline.get",
      "timeline.create",
      "timeline.save",
      "timeline.attach",
      "timeline.detach",
      "timeline.copy",
      "timeline.render",
      "timeline.pull",
      "timeline.apply",
    ]);
  });

  it("generates JSON Schema coverage for every annotated field", () => {
    const schemaText = JSON.stringify(TIMELINE_DSL_DEFINITION.jsonSchema);
    const groups = [
      TIMELINE_DSL_FIELD_ANNOTATIONS.root,
      TIMELINE_DSL_FIELD_ANNOTATIONS.track,
      TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase,
      ...Object.values(TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes),
    ];

    for (const group of groups) {
      for (const field of Object.keys(group)) {
        expect(schemaText, `JSON Schema missing ${field}`).toContain(
          JSON.stringify(field),
        );
      }
    }
  });

  it("derives common-field item applicability from field annotations", () => {
    expect(TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase.properties).toMatchObject({
      applicabilityRuleId: "timeline.properties.item-type",
      appliesToItemTypes: expect.arrayContaining(["video", "image", "text"]),
    });
    expect(TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase.properties.appliesToItemTypes)
      .not.toContain("audio");

    const result = TimelineDslSchema.safeParse({
      tracks: [{
        id: "audio",
        items: [item("audio", {
          src: "/audio.wav",
          properties: { x: 0, y: 0, width: 1, height: 1 },
        })],
      }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => (
      issue.code === "custom"
      && issue.params?.ruleId === "timeline.properties.item-type"
    ))).toBe(true);
  });

  it("builds every item variant from its annotated executable schemas", () => {
    const validItems = [
      item("solid", { color: "#112233" }),
      item("text", { text: "Title", color: "white" }),
      item("video", { src: "/media/video.mp4", mediaFit: "cover" }),
      item("audio", { src: "/media/audio.wav", audioGainDb: -6 }),
      item("image", { src: "/media/image.png", imageFadeIn: 4 }),
      item("sticker", { src: "/media/sticker.webp" }),
      item("composition", {
        compositionKind: "custom",
        runtime: "react",
        compositionId: "custom-card",
        sourcePath: "./compositions/custom-card.tsx",
      }),
      item("derived-overlay", {
        mediaType: "image",
        src: "/derived/crop.png",
        sourceAssetId: "asset-source",
        derivedAssetId: "asset-derived",
        derivation: { kind: "crop" },
      }),
      item("transition", {
        transitionType: "crossfade",
        fromItemId: "clip-a",
        toItemId: "clip-b",
      }),
    ];

    for (const candidate of validItems) {
      expect(
        TimelineDslItemSchema.safeParse(candidate).success,
        String(candidate.type),
      ).toBe(true);
    }
  });

  it("publishes executable schemas for nested variant-owned objects", () => {
    expect(Object.keys(TimelineSequenceSchema.shape)).toEqual([
      "baseUrl",
      "frameCount",
      "fps",
    ]);
    expect(Object.keys(TimelineDerivedAssetSchema.shape)).toEqual([
      "kind",
      "description",
      "parameters",
    ]);
  });

  it.each([
    ["properties scalar type", item("image", {
      src: "/image.png",
      properties: { x: "bad", y: 0, width: 1, height: 1 },
    })],
    ["mediaFit enum", item("video", { src: "/video.mp4", mediaFit: "stretch" })],
    ["effect descriptor", item("image", {
      src: "/image.png",
      effects: [{ effectId: "Blur", effectVersion: 0, params: { radius: {} } }],
    })],
    ["wrong variant field", item("audio", {
      src: "/audio.wav",
      imageFadeIn: 4,
    })],
    ["required solid field", item("solid")],
    ["required transition fields", item("transition", { transitionType: "crossfade" })],
  ])("rejects invalid annotated %s", (_name, candidate) => {
    expect(TimelineDslItemSchema.safeParse(candidate).success).toBe(false);
  });

  it("uses annotated root and track schemas instead of passthrough typing", () => {
    expect(TimelineDslSchema.safeParse({
      assetTranscripts: {
        speech: {
          schemaVersion: 1,
          kind: "clash.editor.asset-transcript",
          assetId: "speech",
          text: "hello",
          durationMs: 1000,
          words: [],
        },
      },
      mediaAssetRefs: [{ assetId: "speech" }],
      tracks: [{ id: "voice", name: "Voice", role: "narration", items: [] }],
    }).success).toBe(true);

    expect(TimelineDslSchema.safeParse({
      tracks: [{ id: "voice", role: "anything", items: [] }],
    }).success).toBe(false);
  });

  it("generates JavaDoc-style documentation for every field group", () => {
    const markdown = renderTimelineDslMarkdown();

    expect(markdown).toContain("## Complete field catalog");
    expect(markdown).toContain("### Root");
    expect(markdown).toContain("### Track");
    expect(markdown).toContain("### Common item fields");
    for (const [itemType, descriptor] of Object.entries(
      TIMELINE_DSL_FIELD_CATALOG.itemTypes,
    )) {
      expect(markdown).toContain(`### \`${itemType}\` item fields`);
      for (const field of Object.keys(descriptor.fields)) {
        expect(markdown, `${itemType}.${field}`).toContain(`\`${field}\``);
      }
    }
    for (const field of ["assetTranscripts", "mediaAssetRefs", "effects", "fromExpr"]) {
      expect(markdown).toContain(`\`${field}\``);
    }
    expect(markdown).toContain("## Complete operation catalog");
    for (const operation of Object.keys(TIMELINE_OPERATION_CATALOG.agent)) {
      expect(markdown).toContain(`\`${operation}\``);
    }
  });
});
