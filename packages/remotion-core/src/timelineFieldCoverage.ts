import {
  TIMELINE_CLIP_ANIMATION_TYPES,
  TIMELINE_CAPTION_POSITIONS,
  TIMELINE_COMPOSITION_KINDS,
  TIMELINE_COMPOSITION_RUNTIMES,
  TIMELINE_DERIVATION_KINDS,
  TIMELINE_DERIVED_MEDIA_TYPES,
  TIMELINE_DSL_FIELD_ANNOTATIONS,
  TIMELINE_DSL_ITEM_TYPES,
  TIMELINE_DSL_TRACK_CATEGORIES,
  TIMELINE_DSL_TRACK_ROLES,
  TIMELINE_MEDIA_FITS,
  TIMELINE_OPERATION_REGISTRY,
  TIMELINE_TEXT_ALIGNMENTS,
  TIMELINE_TRANSITION_TYPES,
  TimelineAudioDuckingSchema,
  TimelineCaptionCueSchema,
  TimelineCaptionWordReferenceSchema,
  TimelineClipAnimationSchema,
  TimelineDerivedAssetSchema,
  TimelineEditorAssetTranscriptSchema,
  TimelineEditorTranscriptWordSchema,
  TimelineEffectInstanceRefSchema,
  TimelineItemPropertiesSchema,
  TimelineSourceToOutputFrameMapSchema,
  TimelineSequenceSchema,
  TimelineTypographyStyleSchema,
} from "@clash/shared-types";
import type {
  AudioItem,
  AudioDuckingSettings,
  BaseItem,
  CaptionCue,
  CaptionWordReference,
  ClipAnimationType,
  CompositionItem,
  CompositionRuntime,
  DerivedOverlayItem,
  EditorAssetTranscript,
  EditorTranscriptWord,
  EffectInstanceRef,
  ImageItem,
  Item,
  ItemProperties,
  MediaFit,
  SolidItem,
  SourceToOutputFrameMap,
  StickerItem,
  TextItem,
  TimelineDsl,
  Track,
  TrackCategory,
  TrackRole,
  TransitionItem,
  TransitionType,
  VideoItem,
  EditorAction,
} from "./types";
import type { EditorHistoryCommand } from "./state/EditorContext";
import type { TimelineCommand } from "./timelineSemantics";

type SameKeys<Left extends PropertyKey, Right extends PropertyKey> =
  [Exclude<Left, Right>, Exclude<Right, Left>] extends [never, never]
    ? true
    : false;
type Assert<Condition extends true> = Condition;
type SameType<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? ((<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2) ? true : false)
    : false;
type RequiredKeys<Value> = {
  [Key in keyof Value]-?: Record<string, never> extends Pick<Value, Key> ? never : Key;
}[keyof Value];
type NormalizeObject<Value> = { [Key in keyof Value]: Value[Key] };
type NormalizeFieldValue<Value> = Value extends readonly unknown[]
  ? Value
  : Value extends object
    ? NormalizeObject<Value>
    : Value;
type AnnotationOutputs<
  Fields extends Record<PropertyKey, { schema: { _output: unknown } }>,
> = {
  [Key in keyof Fields]: NormalizeFieldValue<Fields[Key]["schema"]["_output"]>;
};
type RuntimeOutputs<
  Runtime,
  Fields extends Record<PropertyKey, { schema: { _output: unknown } }>,
> = {
  [Key in keyof Fields]: Key extends keyof Runtime
    ? NormalizeFieldValue<Exclude<Runtime[Key], undefined>>
    : never;
};

type RuntimeVariantFields<Variant extends BaseItem> = Exclude<
  keyof Variant,
  keyof BaseItem | "type"
>;

type _RootFieldCoverage = Assert<SameKeys<
  keyof TimelineDsl,
  keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.root
>>;
type _TrackFieldCoverage = Assert<SameKeys<
  keyof Track,
  keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.track
>>;
type _BaseItemFieldCoverage = Assert<SameKeys<
  keyof BaseItem | "type",
  keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase
>>;
type _SolidFieldCoverage = Assert<SameKeys<RuntimeVariantFields<SolidItem>, keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.solid>>;
type _TextFieldCoverage = Assert<SameKeys<RuntimeVariantFields<TextItem>, keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.text>>;
type _VideoFieldCoverage = Assert<SameKeys<RuntimeVariantFields<VideoItem>, keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.video>>;
type _AudioFieldCoverage = Assert<SameKeys<RuntimeVariantFields<AudioItem>, keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.audio>>;
type _ImageFieldCoverage = Assert<SameKeys<RuntimeVariantFields<ImageItem>, keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.image>>;
type _StickerFieldCoverage = Assert<SameKeys<RuntimeVariantFields<StickerItem>, keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.sticker>>;
type _CompositionFieldCoverage = Assert<SameKeys<RuntimeVariantFields<CompositionItem>, keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.composition>>;
type _DerivedOverlayFieldCoverage = Assert<SameKeys<RuntimeVariantFields<DerivedOverlayItem>, keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes["derived-overlay"]>>;
type _TransitionFieldCoverage = Assert<SameKeys<RuntimeVariantFields<TransitionItem>, keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.transition>>;
type _ItemTypeValueCoverage = Assert<SameKeys<Item["type"], (typeof TIMELINE_DSL_ITEM_TYPES)[number]>>;
type _TrackCategoryValueCoverage = Assert<SameKeys<TrackCategory, (typeof TIMELINE_DSL_TRACK_CATEGORIES)[number]>>;
type _TrackRoleValueCoverage = Assert<SameKeys<TrackRole, (typeof TIMELINE_DSL_TRACK_ROLES)[number]>>;
type _MediaFitValueCoverage = Assert<SameKeys<MediaFit, (typeof TIMELINE_MEDIA_FITS)[number]>>;
type _ClipAnimationValueCoverage = Assert<SameKeys<ClipAnimationType, (typeof TIMELINE_CLIP_ANIMATION_TYPES)[number]>>;
type _CompositionRuntimeValueCoverage = Assert<SameKeys<CompositionRuntime, (typeof TIMELINE_COMPOSITION_RUNTIMES)[number]>>;
type _TransitionTypeValueCoverage = Assert<SameKeys<TransitionType, (typeof TIMELINE_TRANSITION_TYPES)[number]>>;
type _DerivationKindValueCoverage = Assert<SameKeys<DerivedOverlayItem["derivation"]["kind"], (typeof TIMELINE_DERIVATION_KINDS)[number]>>;
type _TextAlignmentValueCoverage = Assert<SameKeys<NonNullable<TextItem["textAlign"]>, (typeof TIMELINE_TEXT_ALIGNMENTS)[number]>>;
type _CaptionPositionValueCoverage = Assert<SameKeys<NonNullable<NonNullable<TextItem["style"]>["position"]>, (typeof TIMELINE_CAPTION_POSITIONS)[number]>>;
type _CompositionKindValueCoverage = Assert<SameKeys<CompositionItem["compositionKind"], (typeof TIMELINE_COMPOSITION_KINDS)[number]>>;
type _DerivedMediaTypeValueCoverage = Assert<SameKeys<DerivedOverlayItem["mediaType"], (typeof TIMELINE_DERIVED_MEDIA_TYPES)[number]>>;
type SchemaOutput<Schema extends { _output: unknown }> = Schema["_output"];
type _ItemPropertiesShapeCoverage = Assert<SameKeys<keyof ItemProperties, keyof SchemaOutput<typeof TimelineItemPropertiesSchema>>>;
type _EffectInstanceShapeCoverage = Assert<SameKeys<keyof EffectInstanceRef, keyof SchemaOutput<typeof TimelineEffectInstanceRefSchema>>>;
type _ClipAnimationShapeCoverage = Assert<SameKeys<keyof NonNullable<VideoItem["entranceAnimation"]>, keyof SchemaOutput<typeof TimelineClipAnimationSchema>>>;
type _AudioDuckingShapeCoverage = Assert<SameKeys<keyof AudioDuckingSettings, keyof SchemaOutput<typeof TimelineAudioDuckingSchema>>>;
type _CaptionCueShapeCoverage = Assert<SameKeys<keyof CaptionCue, keyof SchemaOutput<typeof TimelineCaptionCueSchema>>>;
type _CaptionWordShapeCoverage = Assert<SameKeys<keyof CaptionWordReference, keyof SchemaOutput<typeof TimelineCaptionWordReferenceSchema>>>;
type _CaptionMapShapeCoverage = Assert<SameKeys<keyof SourceToOutputFrameMap, keyof SchemaOutput<typeof TimelineSourceToOutputFrameMapSchema>>>;
type _TypographyShapeCoverage = Assert<SameKeys<keyof NonNullable<TextItem["style"]>, keyof SchemaOutput<typeof TimelineTypographyStyleSchema>>>;
type _StickerSequenceShapeCoverage = Assert<SameKeys<keyof NonNullable<StickerItem["sequence"]>, keyof SchemaOutput<typeof TimelineSequenceSchema>>>;
type _DerivedAssetShapeCoverage = Assert<SameKeys<keyof DerivedOverlayItem["derivation"], keyof SchemaOutput<typeof TimelineDerivedAssetSchema>>>;
type _TranscriptWordShapeCoverage = Assert<SameKeys<keyof EditorTranscriptWord, keyof SchemaOutput<typeof TimelineEditorTranscriptWordSchema>>>;
type _TranscriptShapeCoverage = Assert<SameKeys<keyof EditorAssetTranscript, keyof SchemaOutput<typeof TimelineEditorAssetTranscriptSchema>>>;
type _ItemPropertiesTypeCoverage = Assert<SameType<ItemProperties, SchemaOutput<typeof TimelineItemPropertiesSchema>>>;
type _ClipAnimationTypeParity = Assert<SameType<NonNullable<VideoItem["entranceAnimation"]>, SchemaOutput<typeof TimelineClipAnimationSchema>>>;
type _AudioDuckingTypeParity = Assert<SameType<AudioDuckingSettings, SchemaOutput<typeof TimelineAudioDuckingSchema>>>;
type _CaptionCueTypeParity = Assert<SameType<CaptionCue, SchemaOutput<typeof TimelineCaptionCueSchema>>>;
type _CaptionWordTypeParity = Assert<SameType<CaptionWordReference, SchemaOutput<typeof TimelineCaptionWordReferenceSchema>>>;
type _CaptionMapTypeParity = Assert<SameType<SourceToOutputFrameMap, SchemaOutput<typeof TimelineSourceToOutputFrameMapSchema>>>;
type _TypographyTypeParity = Assert<SameType<NormalizeObject<NonNullable<TextItem["style"]>>, SchemaOutput<typeof TimelineTypographyStyleSchema>>>;
type _PlainTextFontWeightParity = Assert<SameType<TextItem["fontWeight"], SchemaOutput<typeof TimelineTypographyStyleSchema>["fontWeight"]>>;
type _StickerSequenceTypeParity = Assert<SameType<NonNullable<StickerItem["sequence"]>, SchemaOutput<typeof TimelineSequenceSchema>>>;
type _DerivedAssetTypeParity = Assert<SameType<DerivedOverlayItem["derivation"], SchemaOutput<typeof TimelineDerivedAssetSchema>>>;
type _TranscriptWordTypeParity = Assert<SameType<EditorTranscriptWord, SchemaOutput<typeof TimelineEditorTranscriptWordSchema>>>;
type _TranscriptTypeParity = Assert<SameType<EditorAssetTranscript, SchemaOutput<typeof TimelineEditorAssetTranscriptSchema>>>;
type _BaseItemRequiredness = Assert<SameKeys<RequiredKeys<BaseItem>, "id" | "from" | "durationInFrames">>;
type _SolidRequiredness = Assert<SameKeys<RequiredKeys<SolidItem>, RequiredKeys<BaseItem> | "type" | "color">>;
type _TextRequiredness = Assert<SameKeys<RequiredKeys<TextItem>, RequiredKeys<BaseItem> | "type" | "text" | "color">>;
type _VideoRequiredness = Assert<SameKeys<RequiredKeys<VideoItem>, RequiredKeys<BaseItem> | "type" | "src">>;
type _AudioRequiredness = Assert<SameKeys<RequiredKeys<AudioItem>, RequiredKeys<BaseItem> | "type" | "src">>;
type _ImageRequiredness = Assert<SameKeys<RequiredKeys<ImageItem>, RequiredKeys<BaseItem> | "type" | "src">>;
type _StickerRequiredness = Assert<SameKeys<RequiredKeys<StickerItem>, RequiredKeys<BaseItem> | "type" | "src">>;
type _CompositionRequiredness = Assert<SameKeys<RequiredKeys<CompositionItem>, RequiredKeys<BaseItem> | "type" | "compositionKind" | "runtime" | "compositionId" | "sourcePath">>;
type _DerivedOverlayRequiredness = Assert<SameKeys<RequiredKeys<DerivedOverlayItem>, RequiredKeys<BaseItem> | "type" | "mediaType" | "src" | "sourceAssetId" | "derivedAssetId" | "derivation">>;
type _TransitionRequiredness = Assert<SameKeys<RequiredKeys<TransitionItem>, RequiredKeys<BaseItem> | "type" | "transitionType" | "fromItemId" | "toItemId">>;
type _RootScalarTypeParity = Assert<SameType<
  RuntimeOutputs<TimelineDsl, Omit<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.root, "tracks">>,
  AnnotationOutputs<Omit<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.root, "tracks">>
>>;
type _TrackScalarTypeParity = Assert<SameType<
  RuntimeOutputs<Track, Omit<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.track, "items">>,
  AnnotationOutputs<Omit<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.track, "items">>
>>;
type RuntimeBaseWithType = BaseItem & { type: Item["type"] };
type BaseFieldsExceptAuthoredFrom = Omit<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase, "from">;
type _BaseItemScalarTypeParity = Assert<SameType<
  RuntimeOutputs<RuntimeBaseWithType, BaseFieldsExceptAuthoredFrom>,
  AnnotationOutputs<BaseFieldsExceptAuthoredFrom>
>>;
type _AuthoredFromNormalizationParity = Assert<SameType<
  BaseItem["from"],
  Extract<SchemaOutput<(typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase.from)["schema"]>, number>
>>;
type _SolidScalarTypeParity = Assert<SameType<
  RuntimeOutputs<SolidItem, typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.solid>,
  AnnotationOutputs<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.solid>
>>;
type _TextScalarTypeParity = Assert<SameType<
  RuntimeOutputs<TextItem, typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.text>,
  AnnotationOutputs<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.text>
>>;
type _VideoScalarTypeParity = Assert<SameType<
  RuntimeOutputs<VideoItem, typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.video>,
  AnnotationOutputs<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.video>
>>;
type _AudioScalarTypeParity = Assert<SameType<
  RuntimeOutputs<AudioItem, typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.audio>,
  AnnotationOutputs<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.audio>
>>;
type _ImageScalarTypeParity = Assert<SameType<
  RuntimeOutputs<ImageItem, typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.image>,
  AnnotationOutputs<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.image>
>>;
type _StickerScalarTypeParity = Assert<SameType<
  RuntimeOutputs<StickerItem, typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.sticker>,
  AnnotationOutputs<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.sticker>
>>;
type _CompositionScalarTypeParity = Assert<SameType<
  RuntimeOutputs<CompositionItem, typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.composition>,
  AnnotationOutputs<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.composition>
>>;
type _DerivedOverlayScalarTypeParity = Assert<SameType<
  RuntimeOutputs<DerivedOverlayItem, typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes["derived-overlay"]>,
  AnnotationOutputs<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes["derived-overlay"]>
>>;
type _TransitionScalarTypeParity = Assert<SameType<
  RuntimeOutputs<TransitionItem, typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.transition>,
  AnnotationOutputs<typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.transition>
>>;
type RegistryEditorActionType = keyof typeof TIMELINE_OPERATION_REGISTRY.editorActions extends infer Key
  ? Key extends `timeline.action.${infer Type}` ? Type : never
  : never;
type RegistryEditorCommandType = keyof typeof TIMELINE_OPERATION_REGISTRY.editorCommands extends infer Key
  ? Key extends `timeline.command.${infer Type}` ? Type : never
  : never;
type _EditorActionOperationCoverage = Assert<SameKeys<
  EditorAction["type"] | EditorHistoryCommand["type"],
  RegistryEditorActionType
>>;
type _EditorCommandOperationCoverage = Assert<SameKeys<
  TimelineCommand["type"],
  RegistryEditorCommandType
>>;

/** Runtime-readable proof that the compile-time descriptor coverage module is linked. */
export const TIMELINE_RUNTIME_FIELD_COVERAGE = {
  root: Object.keys(TIMELINE_DSL_FIELD_ANNOTATIONS.root),
  track: Object.keys(TIMELINE_DSL_FIELD_ANNOTATIONS.track),
  itemBase: Object.keys(TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase),
  itemTypes: Object.fromEntries(
    Object.entries(TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes).map(([type, fields]) => [
      type,
      Object.keys(fields),
    ]),
  ),
  editorOperations: {
    commands: Object.keys(TIMELINE_OPERATION_REGISTRY.editorCommands),
    actions: Object.keys(TIMELINE_OPERATION_REGISTRY.editorActions),
  },
} as const;
