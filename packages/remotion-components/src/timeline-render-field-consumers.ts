import {
  TIMELINE_DSL_FIELD_ANNOTATIONS,
  type TimelineDslItemType,
} from '@clash/shared-types';
import {
  classifyTimelineField,
  TIMELINE_SHARED_DEFAULTS,
  type Item,
  type TimelineDefaultConsumerClassification,
  type TimelineDefaultConsumerCoverage,
  type TimelineFieldConsumerClassification,
  type TimelineRootTrackFieldConsumerRegistry,
} from '@master-clash/remotion-core';

type BaseField = keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase;
type VariantField<Type extends TimelineDslItemType> =
  keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes[Type];
type ItemFieldConsumerRegistry = {
  [Type in TimelineDslItemType]: Record<
    BaseField | VariantField<Type>,
    TimelineFieldConsumerClassification
  >;
};

const rendered = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['rendered'], note);
const meta = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['meta'], note);
const persistence = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['persistence'], note);
const future = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['future'], note);
const unsupported = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['unsupported'], note);
const renderedUnsupported = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['rendered', 'unsupported'], note);
const defaultDisposition = (
  mode: TimelineDefaultConsumerClassification['mode'],
  note: string,
): TimelineDefaultConsumerClassification => ({ mode, note });

/**
 * Renderer disposition for every root and track field in the shared DSL.
 * `satisfies` makes a newly annotated field a compile error until its behavior
 * is explicitly classified here, whether or not that field has a default.
 */
export const TIMELINE_RENDER_ROOT_TRACK_FIELD_CONSUMERS = {
  root: {
    compositionWidth: rendered('The Remotion composition host supplies output width to useVideoConfig.'),
    compositionHeight: rendered('The Remotion composition host supplies output height to useVideoConfig.'),
    fps: rendered('The Remotion composition host uses Timeline fps for frame sampling.'),
    durationInFrames: rendered('The Remotion composition host uses Timeline duration as the output range.'),
    primaryTrackId: unsupported('VideoComposition preserves authored track order and does not select a semantic primary track.'),
    tracks: rendered('VideoComposition schedules the ordered track and item collection.'),
    assetTranscripts: persistence('Word-level transcript state is preserved upstream; rendered captions consume item cues instead.'),
    mediaAssetRefs: classifyTimelineField(
      ['meta', 'unsupported'],
      'Host asset-resolution metadata is not read by VideoComposition; it receives already resolved nodes and sources.',
    ),
  },
  track: {
    id: meta('Used as stable React identity for a prepared render track.'),
    name: persistence('The human-readable lane label is preserved but does not alter rendered output.'),
    role: rendered('Spoken track roles build the audio-ducking windows used by rendered audio.'),
    category: unsupported('VideoComposition renders the supplied track order and does not interpret or reorder structural categories.'),
    items: rendered('Supplies the ordered clips scheduled and composited for this track.'),
    hidden: rendered('Suppresses the complete track from rendered output when true.'),
    locked: unsupported('Interactive editor locking intentionally has no effect on rendered output.'),
  },
} as const satisfies TimelineRootTrackFieldConsumerRegistry;

const VISUAL_BASE_FIELD_CONSUMERS = {
  id: meta('Used for DOM identity, selection refs, and transition lookup; it does not paint pixels.'),
  type: rendered('Selects the concrete visual renderer branch.'),
  from: rendered('Schedules the item at a composition-absolute frame.'),
  durationInFrames: rendered('Controls Sequence duration and item-local sampling.'),
  assetId: meta('Participates in host asset lookup before rendering.'),
  sourceNodeId: meta('Participates in linked Canvas source lookup before rendering.'),
  properties: rendered('Applies static position, scale, rotation, and opacity.'),
  keyframes: rendered('Samples seek-safe transform, opacity, and mask animation channels.'),
  mask: rendered('Builds the clip-local CSS mask for visual output.'),
  effects: rendered('Resolves and applies the ordered clip effect presentation.'),
  bakedAssetPath: persistence('Preserved for external-NLE export; the Remotion visual renderer does not read it.'),
  fromExpr: persistence('Preserved YAML authoring memo; numeric from is the renderer input.'),
} as const satisfies Record<BaseField, TimelineFieldConsumerClassification>;

const AUDIO_BASE_FIELD_CONSUMERS = {
  id: meta('Used for audio element identity and ducking lookup.'),
  type: rendered('Selects the audio renderer branch.'),
  from: rendered('Schedules audio at a composition-absolute frame.'),
  durationInFrames: rendered('Controls audio Sequence duration and fade sampling.'),
  assetId: meta('Participates in host asset lookup before rendering.'),
  sourceNodeId: meta('Participates in linked Canvas source lookup before rendering.'),
  properties: unsupported('Audio items have no visual transform consumer in VideoComposition.'),
  keyframes: unsupported('Audio item transform/mask keyframes are not sampled by the audio branch.'),
  mask: unsupported('Audio items do not produce pixels and cannot apply a clip mask.'),
  effects: unsupported('The audio branch does not yet execute the base effect stack.'),
  bakedAssetPath: persistence('Preserved for external-NLE export; the audio renderer does not read it.'),
  fromExpr: persistence('Preserved YAML authoring memo; numeric from is the renderer input.'),
} as const satisfies Record<BaseField, TimelineFieldConsumerClassification>;

const TRANSITION_BASE_FIELD_CONSUMERS = {
  id: meta('Used for transition item identity.'),
  type: rendered('Selects the transition compositor branch.'),
  from: rendered('Defines the transition window start.'),
  durationInFrames: rendered('Defines transition progress and the obscured source window.'),
  assetId: unsupported('Transition items do not resolve a standalone media asset.'),
  sourceNodeId: unsupported('Transition items do not resolve a standalone Canvas source.'),
  properties: unsupported('The transition compositor does not apply base item transforms.'),
  keyframes: unsupported('The transition compositor does not sample base item keyframes.'),
  mask: unsupported('A transition item mask is not applied; referenced visual clip masks are sampled instead.'),
  effects: unsupported('The base clip effect stack is not applied to transition items; use transition.effect.'),
  bakedAssetPath: persistence('Preserved for external-NLE export; transition rendering does not read it.'),
  fromExpr: persistence('Preserved YAML authoring memo; numeric from is the renderer input.'),
} as const satisfies Record<BaseField, TimelineFieldConsumerClassification>;

export const TIMELINE_RENDER_FIELD_CONSUMERS = {
  video: {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    src: rendered('Supplies the video source URL.'),
    mediaFit: rendered('Controls video object-fit inside transformed bounds.'),
    sourceStartInFrames: rendered('Offsets video and audio sampling into the source.'),
    audioGainDb: rendered('Controls canonical video audio gain.'),
    volume: rendered('Supplies the legacy linear audio gain fallback.'),
    waveform: meta('Cached peaks are consumed by Timeline UI, not output pixels or audio.'),
    entranceAnimation: rendered('Applies the seek-safe entrance presentation.'),
    exitAnimation: rendered('Applies the seek-safe exit presentation.'),
    videoFadeIn: rendered('Samples visual fade-in opacity or color overlay.'),
    videoFadeOut: rendered('Samples visual fade-out opacity or color overlay.'),
    audioFadeInFrames: rendered('Samples canonical video audio fade-in gain.'),
    audioFadeOutFrames: rendered('Samples canonical video audio fade-out gain.'),
    audioFadeIn: rendered('Supplies the legacy audio fade-in fallback.'),
    audioFadeOut: rendered('Supplies the legacy audio fade-out fallback.'),
    videoFadeInColor: rendered('Paints the fade-through-color entrance overlay.'),
    videoFadeOutColor: rendered('Paints the fade-through-color exit overlay.'),
  },
  audio: {
    ...AUDIO_BASE_FIELD_CONSUMERS,
    src: rendered('Supplies the audio source URL.'),
    sourceStartInFrames: rendered('Offsets playback into the audio source.'),
    audioGainDb: rendered('Controls canonical audio gain.'),
    audioDucking: rendered('Builds and samples automatic ducking windows.'),
    volume: rendered('Supplies the legacy linear audio gain fallback.'),
    waveform: meta('Cached peaks are consumed by Timeline UI, not rendered audio.'),
    audioFadeInFrames: rendered('Samples canonical audio fade-in gain.'),
    audioFadeOutFrames: rendered('Samples canonical audio fade-out gain.'),
    audioFadeIn: rendered('Supplies the legacy audio fade-in fallback.'),
    audioFadeOut: rendered('Supplies the legacy audio fade-out fallback.'),
  },
  image: {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    src: rendered('Supplies the image source URL.'),
    mediaFit: rendered('Controls image object-fit inside transformed bounds.'),
    imageFadeIn: rendered('Samples image fade-in opacity or color overlay.'),
    imageFadeOut: rendered('Samples image fade-out opacity or color overlay.'),
    imageFadeInColor: rendered('Paints the fade-through-color entrance overlay.'),
    imageFadeOutColor: rendered('Paints the fade-through-color exit overlay.'),
  },
  solid: {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    color: rendered('Paints the generated solid background.'),
  },
  text: {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    text: rendered('Paints plain-text content; structured captions paint the active cue instead.'),
    color: rendered('Paints plain-text color; structured captions use style or shared caption defaults.'),
    fontSize: rendered('Controls plain-text font size.'),
    fontFamily: rendered('Controls plain-text font family.'),
    fontWeight: rendered('Controls plain-text font weight.'),
    textAlign: rendered('Controls plain-text horizontal alignment.'),
    letterSpacingPx: rendered('Controls plain-text tracking.'),
    lineHeight: rendered('Controls plain-text line height.'),
    cues: rendered('Selects and paints the active structured caption cue.'),
    language: meta('Caption language is lineage/export metadata and does not alter pixels.'),
    wordRefs: meta('Source-word lineage is retained for transcript synchronization.'),
    sourceToOutputMap: meta('Frame lineage is retained for synchronized caption edits and export.'),
    style: rendered('Controls structured-caption typography, background, and position.'),
  },
  sticker: {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    src: rendered('Supplies the sticker image source.'),
    mediaFit: rendered('Controls sticker object-fit inside transformed bounds.'),
    sequence: future('Still-frame sticker sequences are persisted but not rendered yet.'),
  },
  composition: {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    compositionKind: meta('Preserves the composition domain label; runtime selects the renderer path.'),
    runtime: rendered('Routes live Remotion component execution versus the legacy rendered-asset fallback.'),
    compositionId: rendered('Identifies the live Remotion component during compilation and output inspection.'),
    sourcePath: unsupported('The Remotion renderer does not execute or load the user-owned source project.'),
    renderedAssetPath: rendered('Supplies the pre-rendered composition fallback video.'),
    spec: unsupported('Legacy custom runtime configuration is preserved but never interpreted as motion graphics.'),
  },
  'derived-overlay': {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    mediaType: rendered('Selects image or video output for the immutable derived source.'),
    src: rendered('Supplies the derived media URL.'),
    mediaFit: rendered('Controls derived media object-fit.'),
    sourceAssetId: meta('Emitted as source lineage metadata.'),
    derivedAssetId: meta('Emitted as derived-copy identity metadata.'),
    derivation: meta('Emits derivation kind metadata; description and parameters do not alter pixels.'),
  },
  transition: {
    ...TRANSITION_BASE_FIELD_CONSUMERS,
    transitionType: rendered('Selects the built-in transition presentation.'),
    fromItemId: rendered('Resolves the contiguous visual clip leaving the screen.'),
    toItemId: rendered('Resolves the contiguous visual clip entering the screen.'),
    effect: rendered('Resolves the SDK transition effect that supersedes transitionType.'),
  },
} as const satisfies ItemFieldConsumerRegistry;

const TRANSITION_CONTENT_BASE_FIELD_CONSUMERS = {
  id: meta('Resolves and identifies the visual clip referenced by the transition.'),
  type: rendered('Selects video, image, or solid transition content.'),
  from: rendered('Provides the referenced item-local frame used for mask sampling.'),
  durationInFrames: meta('Validated by transition semantics, but the transition item owns visible duration.'),
  assetId: meta('Participates in source resolution before transition content renders.'),
  sourceNodeId: meta('Participates in linked Canvas source resolution before transition content renders.'),
  properties: unsupported('The stripped transition-content renderer does not apply referenced clip transforms.'),
  keyframes: renderedUnsupported('Mask channels are sampled, but referenced clip transform and opacity channels are ignored.'),
  mask: rendered('The transition wrapper applies the referenced clip mask at its item-local frame.'),
  effects: unsupported('Referenced clip effect stacks are not applied inside transition content.'),
  bakedAssetPath: persistence('Preserved for export; transition content does not read it.'),
  fromExpr: persistence('Preserved YAML authoring memo; numeric from is sampled.'),
} as const satisfies Record<BaseField, TimelineFieldConsumerClassification>;

type TransitionContentRegistry = {
  video: Record<BaseField | VariantField<'video'>, TimelineFieldConsumerClassification>;
  image: Record<BaseField | VariantField<'image'>, TimelineFieldConsumerClassification>;
  solid: Record<BaseField | VariantField<'solid'>, TimelineFieldConsumerClassification>;
  text: Record<BaseField | VariantField<'text'>, TimelineFieldConsumerClassification>;
};

/**
 * The transition compositor intentionally uses a stripped content path.
 * This separate table prevents normal clip support from hiding transition-only gaps.
 */
export const TIMELINE_TRANSITION_CONTENT_FIELD_CONSUMERS = {
  video: {
    ...TRANSITION_CONTENT_BASE_FIELD_CONSUMERS,
    src: rendered('Supplies the referenced transition video source.'),
    mediaFit: unsupported('Transition video content currently hardcodes object-fit fill.'),
    sourceStartInFrames: rendered('Offsets the referenced transition video source.'),
    audioGainDb: unsupported('Transition video content is muted.'),
    volume: unsupported('Transition video content is muted.'),
    waveform: meta('Cached peaks are unrelated to transition pixels.'),
    entranceAnimation: unsupported('Referenced clip entrance animation is not applied inside transitions.'),
    exitAnimation: unsupported('Referenced clip exit animation is not applied inside transitions.'),
    videoFadeIn: unsupported('Referenced clip fade-in is replaced by the transition presentation.'),
    videoFadeOut: unsupported('Referenced clip fade-out is replaced by the transition presentation.'),
    audioFadeInFrames: unsupported('Transition video content is muted.'),
    audioFadeOutFrames: unsupported('Transition video content is muted.'),
    audioFadeIn: unsupported('Transition video content is muted.'),
    audioFadeOut: unsupported('Transition video content is muted.'),
    videoFadeInColor: unsupported('Referenced clip fade color is not painted inside transitions.'),
    videoFadeOutColor: unsupported('Referenced clip fade color is not painted inside transitions.'),
  },
  image: {
    ...TRANSITION_CONTENT_BASE_FIELD_CONSUMERS,
    src: rendered('Supplies the referenced transition image source.'),
    mediaFit: unsupported('Transition image content currently hardcodes object-fit fill.'),
    imageFadeIn: unsupported('Referenced image fade-in is replaced by the transition presentation.'),
    imageFadeOut: unsupported('Referenced image fade-out is replaced by the transition presentation.'),
    imageFadeInColor: unsupported('Referenced image fade color is not painted inside transitions.'),
    imageFadeOutColor: unsupported('Referenced image fade color is not painted inside transitions.'),
  },
  solid: {
    ...TRANSITION_CONTENT_BASE_FIELD_CONSUMERS,
    color: rendered('Paints the referenced solid transition content.'),
  },
  text: {
    ...TRANSITION_CONTENT_BASE_FIELD_CONSUMERS,
    text: rendered('Paints the referenced plain-text content.'),
    color: rendered('Controls referenced transition text color.'),
    fontSize: rendered('Controls referenced transition text size.'),
    fontFamily: rendered('Controls referenced transition text font family.'),
    fontWeight: rendered('Controls referenced transition text string or numeric font weight.'),
    textAlign: unsupported('Transition text content currently hardcodes centered alignment.'),
    letterSpacingPx: unsupported('Transition text content does not currently apply plain-text tracking.'),
    lineHeight: unsupported('Transition text content does not currently apply plain-text line height.'),
    cues: unsupported('Transition text content paints aggregate text rather than selecting structured caption cues.'),
    language: meta('Caption language does not alter transition pixels.'),
    wordRefs: meta('Source-word lineage does not alter transition pixels.'),
    sourceToOutputMap: meta('Caption frame lineage does not alter transition pixels.'),
    style: unsupported('Transition text content does not currently apply structured-caption style.'),
  },
} as const satisfies TransitionContentRegistry;

export const TIMELINE_TRANSITION_RENDER_ITEM_TYPES = [
  'video',
  'image',
  'solid',
  'text',
] as const satisfies readonly Item['type'][];

export type TimelineTransitionRenderItem = Extract<
  Item,
  { type: (typeof TIMELINE_TRANSITION_RENDER_ITEM_TYPES)[number] }
>;

export const isTimelineTransitionRenderItem = (
  item: Item,
): item is TimelineTransitionRenderItem => (
  (TIMELINE_TRANSITION_RENDER_ITEM_TYPES as readonly string[]).includes(item.type)
);

/** Exact disposition for every default published by the shared annotation registry. */
export const TIMELINE_RENDER_DEFAULT_COVERAGE = {
  root: {
    compositionWidth: defaultDisposition('helper', 'Remotion useVideoConfig receives the normalized composition width.'),
    compositionHeight: defaultDisposition('helper', 'Remotion useVideoConfig receives the normalized composition height.'),
    fps: defaultDisposition('helper', 'Remotion useVideoConfig receives the normalized fps.'),
    durationInFrames: defaultDisposition('helper', 'The Remotion composition host owns normalized root duration.'),
    primaryTrackId: defaultDisposition('not-read', 'Pixel rendering is ordered by tracks and does not select the semantic primary track.'),
    assetTranscripts: defaultDisposition('not-read', 'Transcript storage is not a renderer input.'),
    mediaAssetRefs: defaultDisposition('not-read', 'The host resolves media nodes before VideoComposition renders.'),
  },
  track: {
    name: defaultDisposition('not-read', 'Track names do not alter rendered output.'),
    hidden: defaultDisposition('schema-normalized', 'Missing hidden is false and the renderer skips only truthy hidden tracks.'),
    locked: defaultDisposition('not-read', 'Interactive lock state does not alter rendered output.'),
  },
  itemBase: {
    properties: defaultDisposition('shared', 'Transform fallback reads TIMELINE_SHARED_DEFAULTS.itemBase.properties.'),
    effects: defaultDisposition('helper', 'The effect resolver treats an absent stack as the shared empty stack.'),
  },
  text: {
    text: defaultDisposition('schema-normalized', 'Authored normalization supplies required plain text.'),
    color: defaultDisposition('schema-normalized', 'Authored normalization supplies required plain-text color.'),
    fontSize: defaultDisposition('shared', 'Plain and transition text fallbacks read the shared snapshot.'),
    fontFamily: defaultDisposition('shared', 'Plain and transition text fallbacks read the shared snapshot.'),
    fontWeight: defaultDisposition('shared', 'Plain and transition text fallbacks read the shared snapshot.'),
    textAlign: defaultDisposition('shared', 'Plain text fallback reads the shared snapshot.'),
    letterSpacingPx: defaultDisposition('shared', 'Plain text fallback reads the shared snapshot.'),
    lineHeight: defaultDisposition('shared', 'Plain text fallback reads the shared snapshot.'),
  },
  video: {
    mediaFit: defaultDisposition('shared', 'Video object-fit fallback reads the shared snapshot.'),
    sourceStartInFrames: defaultDisposition('shared', 'Video source offset fallback reads the shared snapshot.'),
    audioGainDb: defaultDisposition('helper', 'Core audio-gain resolution is gated to the shared zero-dB default.'),
    videoFadeIn: defaultDisposition('shared', 'Video fade-in fallback reads the shared snapshot.'),
    videoFadeOut: defaultDisposition('shared', 'Video fade-out fallback reads the shared snapshot.'),
    audioFadeInFrames: defaultDisposition('helper', 'Core audio-fade resolution is gated to the shared zero-frame default.'),
    audioFadeOutFrames: defaultDisposition('helper', 'Core audio-fade resolution is gated to the shared zero-frame default.'),
  },
  audio: {
    sourceStartInFrames: defaultDisposition('shared', 'Audio source offset fallback reads the shared snapshot.'),
    audioGainDb: defaultDisposition('helper', 'Core audio-gain resolution is gated to the shared zero-dB default.'),
    audioFadeInFrames: defaultDisposition('helper', 'Core audio-fade resolution is gated to the shared zero-frame default.'),
    audioFadeOutFrames: defaultDisposition('helper', 'Core audio-fade resolution is gated to the shared zero-frame default.'),
  },
  image: {
    mediaFit: defaultDisposition('shared', 'Image object-fit fallback reads the shared snapshot.'),
    imageFadeIn: defaultDisposition('shared', 'Image fade-in fallback reads the shared snapshot.'),
    imageFadeOut: defaultDisposition('shared', 'Image fade-out fallback reads the shared snapshot.'),
  },
  sticker: {
    mediaFit: defaultDisposition('shared', 'Sticker object-fit fallback reads the shared snapshot.'),
  },
  'derived-overlay': {
    mediaFit: defaultDisposition('shared', 'Derived media object-fit fallback reads the shared snapshot.'),
  },
} as const satisfies TimelineDefaultConsumerCoverage<typeof TIMELINE_SHARED_DEFAULTS>;
