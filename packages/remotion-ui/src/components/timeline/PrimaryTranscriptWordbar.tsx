import React from 'react';
import {
  deriveTimelineTranscriptWords,
  deriveTimelineTranscriptWordsFromText,
  deriveTimelineTranscriptSentences,
  isSpokenMediaTrack,
  useEditorDispatch,
  useEditorPlayback,
  useEditorStaticState,
} from '@clash/remotion-core';
import { colors, timeline, typography } from './styles';

type PrimaryTranscriptWordbarProps = {
  trackId: string;
  pixelsPerFrame: number;
};

export const PRIMARY_TRANSCRIPT_WORDBAR_HEIGHT = 24;

function formatPauseDuration(frames: number, fps: number): string {
  const seconds = frames / fps;
  return `${seconds < 0.1 ? seconds.toFixed(2) : seconds.toFixed(1)}s`;
}

export const PrimaryTranscriptWordbar: React.FC<PrimaryTranscriptWordbarProps> = ({
  trackId,
  pixelsPerFrame,
}) => {
  const { tracks, primaryTrackId, assetTranscripts, fps } = useEditorStaticState();
  const { currentFrame } = useEditorPlayback();
  const dispatch = useEditorDispatch();
  const track = React.useMemo(
    () => tracks.find((candidate) => candidate.id === trackId) ?? null,
    [trackId, tracks],
  );
  const words = React.useMemo(() => {
    if (!track || !isSpokenMediaTrack(track, primaryTrackId)) return [];
    const reusableTranscriptWords = deriveTimelineTranscriptWords({
      tracks: [track],
      fps,
      assetTranscripts,
    });
    return reusableTranscriptWords.length > 0
      ? reusableTranscriptWords
      : deriveTimelineTranscriptWordsFromText({
          tracks,
          trackId,
        });
  }, [assetTranscripts, fps, primaryTrackId, track, trackId, tracks]);
  const sentences = React.useMemo(
    () => deriveTimelineTranscriptSentences({ words, fps }),
    [fps, words],
  );
  const pauseBoundaryFrames = Math.max(1, Math.round(fps * 0.45));
  const presentationSentences = React.useMemo(
    () => sentences.map((sentence, index) => {
      const nextSentence = sentences[index + 1];
      const gap = nextSentence
        ? nextSentence.timelineStartFrame - sentence.timelineEndFrame
        : 0;
      return gap > 0 && gap < pauseBoundaryFrames
        ? { ...sentence, timelineEndFrame: nextSentence!.timelineStartFrame }
        : sentence;
    }),
    [pauseBoundaryFrames, sentences],
  );
  const pauses = React.useMemo(
    () => sentences.flatMap((sentence, index) => {
      const previousSentence = sentences[index - 1];
      if (
        !previousSentence
        || sentence.timelineStartFrame - previousSentence.timelineEndFrame < pauseBoundaryFrames
      ) return [];
      const startFrame = previousSentence.timelineEndFrame;
      const endFrame = sentence.timelineStartFrame;
      return [{
        id: `${previousSentence.id}:${sentence.id}:pause`,
        startFrame,
        endFrame,
        label: formatPauseDuration(endFrame - startFrame, fps),
      }];
    }),
    [fps, pauseBoundaryFrames, sentences],
  );

  if (sentences.length === 0) return null;

  return (
    <div
      data-primary-transcript-wordbar=""
      data-primary-transcript-sentencebar=""
      data-transcript-track-id={trackId}
      aria-label={`${track?.name ?? 'Spoken media'} transcript sentences`}
      style={{
        bottom: timeline.trackBubbleInset,
        height: PRIMARY_TRANSCRIPT_WORDBAR_HEIGHT,
        left: 0,
        pointerEvents: 'none',
        position: 'absolute',
        right: 0,
        zIndex: 24,
      }}
    >
      {pauses.map((pause) => {
        const isCurrent = currentFrame >= pause.startFrame
          && currentFrame < pause.endFrame;
        const width = Math.max(1, (pause.endFrame - pause.startFrame) * pixelsPerFrame);
        return (
          <button
            key={pause.id}
            type="button"
            aria-label={`Seek to pause ${pause.label.replace('s', '')} seconds`}
            data-primary-transcript-gap=""
            data-current-gap={isCurrent || undefined}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              dispatch({ type: 'SET_PLAYING', payload: false });
              dispatch({ type: 'SET_CURRENT_FRAME', payload: pause.startFrame });
            }}
            style={{
              alignItems: 'center',
              appearance: 'none',
              background: isCurrent ? colors.bg.hover : colors.bg.secondary,
              border: 0,
              borderLeft: `1px solid ${colors.border.default}`,
              borderRadius: 0,
              bottom: 0,
              boxSizing: 'border-box',
              color: colors.text.tertiary,
              cursor: 'pointer',
              display: 'flex',
              fontFamily: 'inherit',
              fontSize: typography.fontSize.xs,
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 550,
              height: PRIMARY_TRANSCRIPT_WORDBAR_HEIGHT,
              justifyContent: 'center',
              left: pause.startFrame * pixelsPerFrame,
              lineHeight: 1,
              overflow: 'hidden',
              padding: width >= 12 ? '0 2px' : 0,
              pointerEvents: 'auto',
              position: 'absolute',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              width,
            }}
          >
            {width >= 22 ? pause.label : null}
          </button>
        );
      })}
      {presentationSentences.map((sentence) => {
        const isCurrent = currentFrame >= sentence.timelineStartFrame
          && currentFrame < sentence.timelineEndFrame;
        const width = Math.max(
          1,
          (sentence.timelineEndFrame - sentence.timelineStartFrame) * pixelsPerFrame,
        );
        return (
          <button
            key={sentence.id}
            type="button"
            aria-label={`Seek to transcript sentence ${sentence.text}`}
            data-primary-transcript-sentence={sentence.id}
            data-transcript-word-ids={sentence.wordIds.join(' ')}
            data-current-sentence={isCurrent || undefined}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              dispatch({ type: 'SET_PLAYING', payload: false });
              dispatch({
                type: 'SET_CURRENT_FRAME',
                payload: sentence.timelineStartFrame,
              });
            }}
            style={{
              alignItems: 'center',
              appearance: 'none',
              background: isCurrent ? colors.bg.selected : colors.bg.elevated,
              border: 0,
              borderLeft: `1px solid ${isCurrent ? colors.accent.primary : colors.border.default}`,
              borderRadius: 0,
              bottom: 0,
              boxSizing: 'border-box',
              color: isCurrent ? colors.text.primary : colors.text.secondary,
              cursor: 'pointer',
              display: 'flex',
              fontFamily: 'inherit',
              fontSize: typography.fontSize.xs,
              fontWeight: isCurrent ? 650 : 500,
              height: PRIMARY_TRANSCRIPT_WORDBAR_HEIGHT,
              left: sentence.timelineStartFrame * pixelsPerFrame,
              lineHeight: 1,
              overflow: 'hidden',
              padding: width >= 10 ? '0 3px' : 0,
              pointerEvents: 'auto',
              position: 'absolute',
              textAlign: 'left',
              textOverflow: 'ellipsis',
              transition: 'background-color 90ms ease, color 90ms ease',
              whiteSpace: 'nowrap',
              width,
            }}
          >
            {width >= 6 ? (
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {sentence.text}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};
