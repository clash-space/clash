import {
  TIMELINE_DSL_FIELD_ANNOTATIONS,
  type TimelineDslItemType,
} from '@clash/shared-types';
import {
  classifyTimelineField,
  TIMELINE_EDITOR_ROOT_DEFAULT_OVERRIDES,
  TIMELINE_SHARED_DEFAULTS,
  type TimelineDefaultConsumerClassification,
  type TimelineDefaultConsumerCoverage,
  type TimelineFieldConsumerClassification,
  type TimelineRootTrackFieldConsumerRegistry,
} from '@clash/remotion-core';

type BaseField = keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase;
type VariantField<Type extends TimelineDslItemType> =
  keyof typeof TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes[Type];
type ItemFieldConsumerRegistry = {
  [Type in TimelineDslItemType]: Record<
    BaseField | VariantField<Type>,
    TimelineFieldConsumerClassification
  >;
};

const editor = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['editor'], note);
const editorMeta = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['editor', 'meta'], note);
const editorUnsupported = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['editor', 'unsupported'], note);
const meta = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['meta'], note);
const metaUnsupported = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['meta', 'unsupported'], note);
const persistence = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['persistence'], note);
const future = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['future'], note);
const unsupported = (note: string): TimelineFieldConsumerClassification =>
  classifyTimelineField(['unsupported'], note);
const defaultDisposition = (
  mode: TimelineDefaultConsumerClassification['mode'],
  note: string,
): TimelineDefaultConsumerClassification => ({ mode, note });

/**
 * Editor disposition for every root and track field in the shared DSL.
 * `satisfies` makes a newly annotated field a compile error until its behavior
 * is explicitly classified here, whether or not that field has a default.
 */
export const TIMELINE_EDITOR_ROOT_TRACK_FIELD_CONSUMERS = {
  root: {
    compositionWidth: editor('Composition and Canvas sizing workflows consume and update output width.'),
    compositionHeight: editor('Composition and Canvas sizing workflows consume and update output height.'),
    fps: editor('Timeline rulers, playback, transcript timing, and insertion workflows consume fps.'),
    durationInFrames: editor('Playback bounds, ruler width, and duration controls consume Timeline duration.'),
    primaryTrackId: editor('Primary-lane layout, transcript selection, and item-placement rules consume this identity.'),
    tracks: editor('The Timeline, Canvas, transcript, captions, and properties surfaces edit the track collection.'),
    assetTranscripts: editor('Transcript and caption workflows read and update persisted word timing.'),
    mediaAssetRefs: classifyTimelineField(
      ['meta', 'persistence'],
      'Host-owned asset rehydration references are preserved outside interactive editor state and have no direct control.',
    ),
  },
  track: {
    id: editor('Selection, drag-and-drop, updates, annotations, and React identity use the stable track id.'),
    name: editor('Track headers display the lane name and track operations can update it.'),
    role: editor('Semantic lane layout, transcript, captions, and audio workflows consume and author track role.'),
    category: editor('Lane ordering and allowed-item checks consume and author structural category.'),
    items: editor('Timeline and Canvas surfaces display, order, insert, trim, move, and remove track items.'),
    hidden: editor('Track controls toggle visibility and editor presentation reflects the hidden state.'),
    locked: editor('Mutation guards and track controls consume and update the interactive lock state.'),
  },
} as const satisfies TimelineRootTrackFieldConsumerRegistry;

const VISUAL_BASE_FIELD_CONSUMERS = {
  id: editorMeta('Timeline selection, identity, and mutation targeting use the stable item id.'),
  type: editorMeta('Routes Timeline rendering and the item-specific inspector.'),
  from: editor('Timeline placement, drag, trim, and timing controls update the start frame.'),
  durationInFrames: editor('Timeline edges and inspector timing controls update duration.'),
  assetId: meta('Retained for host asset identity and source rehydration.'),
  sourceNodeId: meta('Retained for linked Canvas source identity.'),
  properties: editor('Visual transform controls author static position, size, rotation, and opacity.'),
  keyframes: editor('Timeline and inspector keyframe controls author seek-safe animation channels.'),
  mask: editor('Mask controls author the visual clip-local mask.'),
  effects: editor('The inspector edits the ordered, versioned clip effect stack.'),
  bakedAssetPath: persistence('Preserved for NLE handoff; no editor control reads or writes it.'),
  fromExpr: persistence('Preserved YAML authoring memo; editor moves operate on numeric from.'),
} as const satisfies Record<BaseField, TimelineFieldConsumerClassification>;

const AUDIO_BASE_FIELD_CONSUMERS = {
  id: editorMeta('Timeline selection, identity, and mutation targeting use the stable item id.'),
  type: editorMeta('Routes Timeline rendering and the audio inspector.'),
  from: editor('Timeline placement, drag, trim, and timing controls update the start frame.'),
  durationInFrames: editor('Timeline edges and inspector timing controls update duration.'),
  assetId: meta('Retained for host asset identity and source rehydration.'),
  sourceNodeId: meta('Retained for linked Canvas source identity.'),
  properties: unsupported('Audio items do not expose visual transform controls.'),
  keyframes: unsupported('Audio items do not expose visual or mask keyframe controls.'),
  mask: unsupported('Audio items do not expose a clip mask.'),
  effects: editorUnsupported('Existing base effects can be inspected, but the audio renderer does not execute them yet.'),
  bakedAssetPath: persistence('Preserved for NLE handoff; no editor control reads or writes it.'),
  fromExpr: persistence('Preserved YAML authoring memo; editor moves operate on numeric from.'),
} as const satisfies Record<BaseField, TimelineFieldConsumerClassification>;

const TRANSITION_BASE_FIELD_CONSUMERS = {
  id: editorMeta('Timeline selection and mutation targeting use the transition item id.'),
  type: editorMeta('Routes Timeline rendering and the transition inspector.'),
  from: editor('The transition window is positioned at the edit boundary.'),
  durationInFrames: editor('Timeline edges and the duration control edit transition length.'),
  assetId: unsupported('Transition items do not expose a standalone asset identity.'),
  sourceNodeId: unsupported('Transition items do not expose a standalone Canvas source.'),
  properties: unsupported('Transition items do not expose visual transform controls.'),
  keyframes: unsupported('Transition items do not expose base keyframe controls.'),
  mask: unsupported('Transition items do not expose a base clip mask.'),
  effects: editorUnsupported('Existing base effects can be inspected, but transition output uses transition.effect instead.'),
  bakedAssetPath: persistence('Preserved for NLE handoff; no editor control reads or writes it.'),
  fromExpr: persistence('Preserved YAML authoring memo; editor moves operate on numeric from.'),
} as const satisfies Record<BaseField, TimelineFieldConsumerClassification>;

export const TIMELINE_EDITOR_FIELD_CONSUMERS = {
  video: {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    src: editorMeta('Displayed as read-only source identity and used by Timeline thumbnails.'),
    mediaFit: editor('The inspector edits video fit.'),
    sourceStartInFrames: editor('Trim and source-offset controls edit the in-source start.'),
    audioGainDb: editor('The inspector edits canonical video audio gain.'),
    volume: persistence('Legacy gain is preserved for migration; new controls write audioGainDb.'),
    waveform: editorMeta('Timeline waveform presentation consumes cached peaks.'),
    entranceAnimation: editor('The inspector edits entrance animation type and duration.'),
    exitAnimation: editor('The inspector edits exit animation type and duration.'),
    videoFadeIn: persistence('Preserved and visualized by output; this editor has no video-fade control.'),
    videoFadeOut: persistence('Preserved and visualized by output; this editor has no video-fade control.'),
    audioFadeInFrames: editor('Timeline fade handles author canonical video audio fade-in.'),
    audioFadeOutFrames: editor('Timeline fade handles author canonical video audio fade-out.'),
    audioFadeIn: persistence('Legacy alias is preserved and cleared by canonical fade edits.'),
    audioFadeOut: persistence('Legacy alias is preserved and cleared by canonical fade edits.'),
    videoFadeInColor: persistence('Preserved for output; this editor has no video fade-color control.'),
    videoFadeOutColor: persistence('Preserved for output; this editor has no video fade-color control.'),
  },
  audio: {
    ...AUDIO_BASE_FIELD_CONSUMERS,
    src: editorMeta('Displayed as read-only source identity and used by Timeline audio presentation.'),
    sourceStartInFrames: editor('Trim and source-offset controls edit the in-source start.'),
    audioGainDb: editor('The inspector edits canonical audio gain.'),
    audioDucking: editor('Music-lane ducking controls edit amount, attack, and release.'),
    volume: persistence('Legacy gain is preserved for migration; new controls write audioGainDb.'),
    waveform: editorMeta('Timeline waveform presentation consumes cached peaks.'),
    audioFadeInFrames: editor('Inspector and Timeline fade handles author canonical fade-in.'),
    audioFadeOutFrames: editor('Inspector and Timeline fade handles author canonical fade-out.'),
    audioFadeIn: persistence('Legacy alias is preserved and cleared by canonical fade edits.'),
    audioFadeOut: persistence('Legacy alias is preserved and cleared by canonical fade edits.'),
  },
  image: {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    src: editorMeta('Displayed as read-only source identity and used by Timeline thumbnails.'),
    mediaFit: editor('The inspector edits image fit.'),
    imageFadeIn: editor('The inspector edits image fade-in duration.'),
    imageFadeOut: editor('The inspector edits image fade-out duration.'),
    imageFadeInColor: editor('The inspector edits image fade-in color.'),
    imageFadeOutColor: editor('The inspector edits image fade-out color.'),
  },
  solid: {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    color: editor('The inspector edits generated solid color.'),
  },
  text: {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    text: editor('Plain Text content and caption aggregation are editable workflows.'),
    color: editor('The inspector edits plain-text color and caption fallback color.'),
    fontSize: editor('The inspector edits plain-text font size.'),
    fontFamily: editor('The inspector edits plain-text font family.'),
    fontWeight: editor('The inspector edits plain-text font weight, including string and numeric values.'),
    textAlign: editor('The inspector edits plain-text alignment.'),
    letterSpacingPx: editor('The inspector edits plain-text tracking.'),
    lineHeight: editor('The inspector edits plain-text line height.'),
    cues: editor('Captions workspace edits timed cue text and timing.'),
    language: metaUnsupported('Language is retained as caption metadata, but the declared properties control is not implemented.'),
    wordRefs: meta('Transcript and caption workflows consume immutable source-word lineage.'),
    sourceToOutputMap: meta('Caption editing preserves source-to-output frame lineage.'),
    style: editor('Caption style controls edit typography, background, and position.'),
  },
  sticker: {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    src: editorMeta('Displayed as read-only sticker source identity.'),
    mediaFit: editor('The inspector edits sticker fit.'),
    sequence: future('Still-frame sticker sequence editing and rendering are reserved for future support.'),
  },
  composition: {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    compositionKind: metaUnsupported('Routes the composition inspector, but no control currently edits the declared kind.'),
    runtime: editorMeta('Displayed read-only and used to identify the live Remotion or legacy fallback route.'),
    compositionId: editorMeta('Displayed read-only as composition identity.'),
    sourcePath: editorMeta('Displayed read-only as the user-owned project source.'),
    renderedAssetPath: persistence('Preserved as render fallback; the inspector does not expose it.'),
    spec: classifyTimelineField(
      ['persistence', 'unsupported'],
      'Legacy custom runtime configuration is preserved but has no editor control.',
    ),
  },
  'derived-overlay': {
    ...VISUAL_BASE_FIELD_CONSUMERS,
    mediaType: meta('Routes derived image/video source handling.'),
    src: editorMeta('Displayed read-only as derived source identity.'),
    mediaFit: editor('The inspector edits derived media fit.'),
    sourceAssetId: editorMeta('Displayed read-only as immutable source lineage.'),
    derivedAssetId: editorMeta('Displayed read-only as derived-copy identity.'),
    derivation: editorMeta('Displayed read-only as derivation kind and description.'),
  },
  transition: {
    ...TRANSITION_BASE_FIELD_CONSUMERS,
    transitionType: editor('The inspector edits the built-in transition type.'),
    fromItemId: editorMeta('Displayed read-only and maintained by boundary-aware Timeline operations.'),
    toItemId: editorMeta('Displayed read-only and maintained by boundary-aware Timeline operations.'),
    effect: unsupported('The declared SDK transition effect has no inspector control yet.'),
  },
} as const satisfies ItemFieldConsumerRegistry;

/** Exact disposition for every default published by the shared annotation registry. */
export const TIMELINE_EDITOR_DEFAULT_COVERAGE = {
  root: {
    compositionWidth: defaultDisposition('helper', 'EditorProvider supplies normalized composition width.'),
    compositionHeight: defaultDisposition('helper', 'EditorProvider supplies normalized composition height.'),
    fps: defaultDisposition('helper', 'EditorProvider supplies normalized fps.'),
    durationInFrames: {
      ...defaultDisposition('override', 'EditorProvider intentionally starts a 50-second working canvas.'),
      value: TIMELINE_EDITOR_ROOT_DEFAULT_OVERRIDES.durationInFrames,
    },
    primaryTrackId: defaultDisposition('helper', 'Editor state initialization owns the null primary-track fallback.'),
    assetTranscripts: defaultDisposition('helper', 'Editor state initialization owns the empty transcript map.'),
    mediaAssetRefs: defaultDisposition('not-read', 'Host media references are projection metadata outside the editor state.'),
  },
  track: {
    name: defaultDisposition('schema-normalized', 'Authored normalization supplies the required track label.'),
    hidden: defaultDisposition('schema-normalized', 'Missing hidden is treated as false by editor surfaces.'),
    locked: defaultDisposition('schema-normalized', 'Missing locked is treated as false by interaction guards.'),
  },
  itemBase: {
    properties: defaultDisposition('shared', 'Transform and keyframe controls read the shared properties fallback.'),
    effects: defaultDisposition('schema-normalized', 'An absent effect stack is displayed and mutated as the shared empty stack.'),
  },
  text: {
    text: defaultDisposition('schema-normalized', 'Authored normalization supplies required plain text.'),
    color: defaultDisposition('schema-normalized', 'Authored normalization supplies required plain-text color.'),
    fontSize: defaultDisposition('shared', 'Plain-text controls read the shared snapshot.'),
    fontFamily: defaultDisposition('shared', 'Plain-text controls read the shared snapshot.'),
    fontWeight: defaultDisposition('shared', 'Plain-text controls read the shared snapshot.'),
    textAlign: defaultDisposition('shared', 'Plain-text controls read the shared snapshot.'),
    letterSpacingPx: defaultDisposition('shared', 'Plain-text controls read the shared snapshot.'),
    lineHeight: defaultDisposition('shared', 'Plain-text controls read the shared snapshot.'),
  },
  video: {
    mediaFit: defaultDisposition('shared', 'Media-fit controls read the shared snapshot.'),
    sourceStartInFrames: defaultDisposition('shared', 'Source-offset controls read the shared snapshot.'),
    audioGainDb: defaultDisposition('helper', 'Core gain resolution is gated to the shared zero-dB default.'),
    videoFadeIn: defaultDisposition('not-read', 'This editor preserves but does not expose video fade duration.'),
    videoFadeOut: defaultDisposition('not-read', 'This editor preserves but does not expose video fade duration.'),
    audioFadeInFrames: defaultDisposition('helper', 'Core fade resolution is gated to the shared zero-frame default.'),
    audioFadeOutFrames: defaultDisposition('helper', 'Core fade resolution is gated to the shared zero-frame default.'),
  },
  audio: {
    sourceStartInFrames: defaultDisposition('shared', 'Source-offset controls read the shared snapshot.'),
    audioGainDb: defaultDisposition('helper', 'Core gain resolution is gated to the shared zero-dB default.'),
    audioFadeInFrames: defaultDisposition('helper', 'Core fade resolution is gated to the shared zero-frame default.'),
    audioFadeOutFrames: defaultDisposition('helper', 'Core fade resolution is gated to the shared zero-frame default.'),
  },
  image: {
    mediaFit: defaultDisposition('shared', 'Media-fit controls read the shared snapshot.'),
    imageFadeIn: defaultDisposition('shared', 'Image fade controls read the shared snapshot.'),
    imageFadeOut: defaultDisposition('shared', 'Image fade controls read the shared snapshot.'),
  },
  sticker: {
    mediaFit: defaultDisposition('shared', 'Media-fit controls read the shared snapshot.'),
  },
  'derived-overlay': {
    mediaFit: defaultDisposition('shared', 'Media-fit controls read the shared snapshot.'),
  },
} as const satisfies TimelineDefaultConsumerCoverage<typeof TIMELINE_SHARED_DEFAULTS>;
