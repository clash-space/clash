import React from "react";
import {
  deriveTimelineTranscriptWords,
  deriveTimelineTranscriptWordsFromText,
  isSubtitleTextItem,
  selectSpokenMediaTracks,
  useEditorDispatch,
  useEditorHistory,
  useEditorPlayback,
  useEditorStaticState,
  type Asset,
  type EditorAssetTranscript,
  type TimelineTranscriptWord,
} from "@clash/remotion-core";
import { RemotionButton, RemotionInput } from "./ui/controls";

export type TranscriptEditorProps = {
  onTranscribeAsset?: (asset: Asset) => Promise<EditorAssetTranscript>;
  onOpenMedia?: () => void;
  headerTrailingAction?: React.ReactNode;
};

function formatFrame(frame: number, fps: number): string {
  const totalSeconds = Math.max(0, Math.floor(frame / fps));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDuration(frame: number, fps: number): string {
  return `${Math.max(0, frame / fps).toFixed(1)}s`;
}

function groupWordsByClip(words: TimelineTranscriptWord[]): Array<{
  clipId: string;
  startFrame: number;
  words: TimelineTranscriptWord[];
}> {
  const groups: Array<{
    clipId: string;
    startFrame: number;
    words: TimelineTranscriptWord[];
  }> = [];
  for (const word of words) {
    const last = groups[groups.length - 1];
    if (!last || last.clipId !== word.clipId) {
      groups.push({
        clipId: word.clipId,
        startFrame: word.timelineStartFrame,
        words: [word],
      });
    } else {
      last.words.push(word);
    }
  }
  return groups;
}

const SENTENCE_END = /[.!?。！？…]$/;

function groupWordsIntoParagraphs(
  words: TimelineTranscriptWord[],
): TimelineTranscriptWord[][] {
  const paragraphs: TimelineTranscriptWord[][] = [];
  let paragraph: TimelineTranscriptWord[] = [];
  for (const word of words) {
    paragraph.push(word);
    if (SENTENCE_END.test(word.text)) {
      paragraphs.push(paragraph);
      paragraph = [];
    }
  }
  if (paragraph.length > 0) paragraphs.push(paragraph);
  return paragraphs;
}

const CJK_CHARACTER = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const NO_SPACE_BEFORE = /^(?:[,.;:!?%)}，。！？；：、）》】”’…]|\])/;
const NO_SPACE_AFTER = /[([{“‘《【]$/;

function transcriptTokenPrefix(previousText: string | undefined, text: string): string {
  if (!previousText || !text || /\s$/.test(previousText) || /^\s/.test(text)) return "";
  if (NO_SPACE_BEFORE.test(text) || NO_SPACE_AFTER.test(previousText)) return "";
  const previousCharacters = Array.from(previousText);
  const currentCharacters = Array.from(text);
  const previousCharacter = previousCharacters[previousCharacters.length - 1] ?? "";
  const currentCharacter = currentCharacters[0] ?? "";
  if (CJK_CHARACTER.test(previousCharacter) || CJK_CHARACTER.test(currentCharacter)) return "";
  return " ";
}

function joinTranscriptWords(words: ReadonlyArray<{ text: string }>): string {
  return words.reduce(
    (text, word, index) =>
      `${text}${transcriptTokenPrefix(words[index - 1]?.text, word.text)}${word.text}`,
    "",
  );
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target.isContentEditable;
}

const TRANSCRIPT_EDITOR_RESPONSIVE_STYLES = `
  @container transcript-editor (min-width: 480px) {
    [data-transcript-header] {
      height: 48px !important;
      padding-inline: 20px !important;
    }
    [data-transcript-document] {
      max-width: 820px !important;
      padding-inline: clamp(32px, 7cqi, 72px) !important;
      padding-top: 34px !important;
    }
    [data-transcript-clip-group] {
      display: grid !important;
      grid-template-columns: 58px minmax(0, 1fr) !important;
      column-gap: clamp(22px, 4cqi, 40px) !important;
      padding-block: 30px !important;
    }
    [data-transcript-clip-meta] {
      align-items: flex-start !important;
      flex-direction: column !important;
      gap: 2px !important;
      margin-bottom: 0 !important;
      padding-top: 7px !important;
    }
    [data-transcript-paragraph] {
      font-size: clamp(18px, 2.6cqi, 21px) !important;
      line-height: 1.9 !important;
      letter-spacing: -0.015em !important;
    }
  }
  @container transcript-editor (max-width: 300px) {
    [data-transcript-header] {
      gap: 4px !important;
      padding-inline: 8px !important;
    }
    [data-transcript-document] {
      padding-inline: 14px !important;
    }
    [data-transcript-edit-guide] {
      grid-template-columns: minmax(0, 1fr) !important;
      gap: 0 !important;
    }
    [data-transcript-guide-mark] {
      display: none !important;
    }
    [data-transcript-selection-footer] {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px !important;
    }
    [data-transcript-selection-summary] {
      grid-column: 1 / -1;
    }
    [data-transcript-correction-form] {
      min-width: 0;
    }
    [data-transcript-correction-form] input {
      min-width: 0;
      width: 100% !important;
    }
  }
`;

export const TranscriptEditor: React.FC<TranscriptEditorProps> = ({
  onTranscribeAsset,
  onOpenMedia,
  headerTrailingAction,
}) => {
  const { tracks, primaryTrackId, assets, assetTranscripts, fps, durationInFrames } =
    useEditorStaticState();
  const { currentFrame, playing } = useEditorPlayback();
  const dispatch = useEditorDispatch();
  const {
    canUndo,
    canRedo,
    undo: undoTimeline,
    redo: redoTimeline,
  } = useEditorHistory();
  const [selection, setSelection] = React.useState<[number, number] | null>(
    null,
  );
  const [correctionText, setCorrectionText] = React.useState("");
  const [guideExpanded, setGuideExpanded] = React.useState(false);
  const [lastCutSummary, setLastCutSummary] = React.useState<{
    wordCount: number;
    durationInFrames: number;
  } | null>(null);
  const [transcribing, setTranscribing] = React.useState(false);
  const [transcriptionError, setTranscriptionError] = React.useState<
    string | null
  >(null);
  const selectionAnchorRef = React.useRef<number | null>(null);
  const draggingSelectionRef = React.useRef(false);

  const transcriptTracks = React.useMemo(() => {
    return selectSpokenMediaTracks(tracks, primaryTrackId);
  }, [primaryTrackId, tracks]);
  const words = React.useMemo(() => transcriptTracks
    .flatMap((track) => {
      const reusableTranscriptWords = deriveTimelineTranscriptWords({
        tracks: [track],
        fps,
        assetTranscripts,
      });
      return reusableTranscriptWords.length > 0
        ? reusableTranscriptWords
        : deriveTimelineTranscriptWordsFromText({ tracks, trackId: track.id });
    })
    .sort(
      (left, right) =>
        left.timelineStartFrame - right.timelineStartFrame
        || left.timelineEndFrame - right.timelineEndFrame
        || left.id.localeCompare(right.id),
    ), [assetTranscripts, fps, tracks, transcriptTracks]);
  const wordGroups = React.useMemo(() => groupWordsByClip(words), [words]);
  const wordIndexById = React.useMemo(
    () => new Map(words.map((word, index) => [word.id, index])),
    [words],
  );
  const missingAssets = React.useMemo(() => {
    const byId = new Map<string, Asset>();
    for (const asset of assets) {
      if (asset.projectAssetId) byId.set(asset.projectAssetId, asset);
      byId.set(asset.id, asset);
    }
    const seen = new Set<string>();
    const result: Asset[] = [];
    for (const track of transcriptTracks) {
      for (const item of track.items) {
        if ((item.type !== "video" && item.type !== "audio") || !item.assetId)
          continue;
        const hasPersistedTiming = words.some((word) =>
          word.assetId === item.assetId && word.clipId === item.id
        );
        if (assetTranscripts[item.assetId] || hasPersistedTiming || seen.has(item.assetId)) continue;
        const asset = byId.get(item.assetId);
        if (!asset) continue;
        seen.add(item.assetId);
        result.push(asset);
      }
    }
    return result;
  }, [assetTranscripts, assets, transcriptTracks, words]);
  const hasMediaClips = transcriptTracks.some((track) =>
    track.items.some((item) => item.type === "video" || item.type === "audio"),
  );
  const selectedWords = selection
    ? words.slice(selection[0], selection[1] + 1)
    : [];
  const selectedDurationInFrames =
    selectedWords.length > 0
      ? Math.max(...selectedWords.map((word) => word.timelineEndFrame)) -
        Math.min(...selectedWords.map((word) => word.timelineStartFrame))
      : 0;
  const transcriptStatus = transcribing
    ? "Listening…"
    : words.length > 0
      ? `${words.length} words · ${formatFrame(durationInFrames, fps)}`
      : hasMediaClips
        ? "Ready to transcribe"
        : "Add spoken media";

  const selectWord = React.useCallback(
    (index: number, extend: boolean) => {
      const anchor =
        extend && selectionAnchorRef.current !== null
          ? selectionAnchorRef.current
          : index;
      selectionAnchorRef.current = anchor;
      setSelection([Math.min(anchor, index), Math.max(anchor, index)]);
      const word = words[index];
      setCorrectionText(anchor === index ? word?.text ?? "" : "");
      if (word) {
        dispatch({ type: "SET_PLAYING", payload: false });
        dispatch({
          type: "SET_CURRENT_FRAME",
          payload: word.timelineStartFrame,
        });
      }
    },
    [dispatch, words],
  );

  const deleteSelection = React.useCallback(() => {
    if (!selection) return;
    const selectedWords = words.slice(selection[0], selection[1] + 1);
    if (selectedWords.length === 0) return;
    const startFrame = Math.min(
      ...selectedWords.map((word) => word.timelineStartFrame),
    );
    const endFrame = Math.max(
      ...selectedWords.map((word) => word.timelineEndFrame),
    );
    setLastCutSummary({
      wordCount: selectedWords.length,
      durationInFrames: endFrame - startFrame,
    });
    setSelection(null);
    setCorrectionText("");
    selectionAnchorRef.current = null;
    dispatch({
      type: "RIPPLE_DELETE_RANGE",
      payload: { startFrame, endFrame },
    });
  }, [dispatch, selection, words]);

  const correctSelection = React.useCallback(() => {
    if (!selection || selection[0] !== selection[1]) return;
    const selectedWord = words[selection[0]];
    const nextText = correctionText.trim();
    if (!selectedWord || nextText.length === 0 || nextText === selectedWord.text) return;
    const transcript = assetTranscripts[selectedWord.assetId];
    if (transcript) {
      const transcriptWords = transcript.words.map((word) =>
        word.id === selectedWord.assetWordId ? { ...word, text: nextText } : word,
      );
      dispatch({
        type: "SET_ASSET_TRANSCRIPT",
        payload: {
          ...transcript,
          text: joinTranscriptWords(transcriptWords),
          words: transcriptWords,
        },
      });
    } else {
      for (const track of tracks) {
        for (const item of track.items) {
          if (!isSubtitleTextItem(item) || !item.wordRefs?.length) continue;
          const hasSelectedWord = item.wordRefs.some((word) =>
            word.assetId === selectedWord.assetId
            && word.assetWordId === selectedWord.assetWordId
            && word.clipId === selectedWord.clipId
            && word.trackId === selectedWord.trackId
          );
          if (!hasSelectedWord) continue;

          const wordRefs = item.wordRefs.map((word) =>
            word.assetId === selectedWord.assetId
            && word.assetWordId === selectedWord.assetWordId
            && word.clipId === selectedWord.clipId
            && word.trackId === selectedWord.trackId
              ? { ...word, text: nextText }
              : word
          );
          const wordsById = new Map(wordRefs.map((word) => [word.id, word]));
          const cues = item.cues.map((cue) => {
            const cueWords = (cue.wordIds ?? [])
              .map((wordId) => wordsById.get(wordId))
              .filter((word): word is NonNullable<typeof word> => Boolean(word));
            return cueWords.length > 0
              ? { ...cue, text: joinTranscriptWords(cueWords) }
              : cue;
          });
          dispatch({
            type: "UPDATE_ITEM",
            payload: {
              trackId: track.id,
              itemId: item.id,
              updates: {
                wordRefs,
                cues,
                text: cues.map((cue) => cue.text).join("\n"),
              },
            },
          });
        }
      }
    }
    setCorrectionText(nextText);
  }, [assetTranscripts, correctionText, dispatch, selection, tracks, words]);

  const undo = React.useCallback(() => {
    if (!canUndo) return;
    undoTimeline();
    setLastCutSummary(null);
    setSelection(null);
    setCorrectionText("");
    selectionAnchorRef.current = null;
  }, [canUndo, undoTimeline]);

  const redo = React.useCallback(() => {
    if (!canRedo) return;
    redoTimeline();
    setLastCutSummary(null);
    setSelection(null);
    setCorrectionText("");
    selectionAnchorRef.current = null;
  }, [canRedo, redoTimeline]);

  const transcribeMissingAssets = React.useCallback(async () => {
    if (!onTranscribeAsset || transcribing || missingAssets.length === 0)
      return;
    setTranscriptionError(null);
    setTranscribing(true);
    try {
      for (const asset of missingAssets) {
        const transcript = await onTranscribeAsset(asset);
        dispatch({ type: "SET_ASSET_TRANSCRIPT", payload: transcript });
      }
    } catch (error) {
      setTranscriptionError(
        error instanceof Error ? error.message : "Transcription failed",
      );
    } finally {
      setTranscribing(false);
    }
  }, [dispatch, missingAssets, onTranscribeAsset, transcribing]);

  return (
    <section
      data-testid="timeline-transcript-editor"
      aria-label="Timeline transcript editor"
      tabIndex={0}
      onKeyDown={(event) => {
        if (isTextEntryTarget(event.target)) return;
        if (event.key === "Backspace" || event.key === "Delete") {
          if (!selection) return;
          event.preventDefault();
          deleteSelection();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          const action = event.shiftKey ? redo : undo;
          if (event.shiftKey ? !canRedo : !canUndo) return;
          event.preventDefault();
          action();
          return;
        }
        if (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "y") {
          if (!canRedo) return;
          event.preventDefault();
          redo();
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          dispatch({ type: "SET_PLAYING", payload: !playing });
          return;
        }
        if (event.key === "Escape" && selection) {
          event.preventDefault();
          setSelection(null);
          setCorrectionText("");
          selectionAnchorRef.current = null;
        }
      }}
      onPointerUp={() => {
        draggingSelectionRef.current = false;
      }}
      onPointerCancel={() => {
        draggingSelectionRef.current = false;
      }}
      style={{ containerType: "inline-size", containerName: "transcript-editor" }}
      className="flex h-full min-h-0 flex-col bg-warm-surface outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/45"
    >
      <style data-transcript-responsive-styles="">{TRANSCRIPT_EDITOR_RESPONSIVE_STYLES}</style>
      <header data-transcript-header="" className="flex h-10 shrink-0 items-center gap-2 border-b border-warm-border bg-warm-surface px-2">
        <div data-transcript-header-summary="" className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden whitespace-nowrap">
          <span className="shrink-0 text-[12px] font-semibold tracking-[-0.012em] text-content-primary">
            Transcript
          </span>
          <span className="truncate text-[9px] font-medium uppercase tracking-[0.11em] text-content-muted">
            {transcriptStatus}
          </span>
        </div>
        {words.length > 0 && missingAssets.length > 0 && onTranscribeAsset ? (
          <RemotionButton
            type="button"
            disabled={transcribing}
            onClick={transcribeMissingAssets}
            className="h-6 rounded-[5px] border border-warm-border bg-warm-surface px-2 text-[10px] font-semibold text-content-secondary hover:border-brand/50 hover:bg-warm-muted hover:text-brand disabled:cursor-wait disabled:opacity-60"
          >
            {transcribing
              ? "Transcribing…"
              : `Transcribe +${missingAssets.length}`}
          </RemotionButton>
        ) : null}
        {words.length > 0 ? (
          <RemotionButton
            type="button"
            aria-label={
              guideExpanded ? "Hide transcript guide" : "Show transcript guide"
            }
            aria-expanded={guideExpanded}
            onClick={() => setGuideExpanded((expanded) => !expanded)}
            className={`h-6 rounded-[5px] px-1.5 text-[10px] font-semibold transition-colors ${
              guideExpanded
                ? "bg-warm-muted text-content-primary"
                : "text-content-secondary hover:bg-warm-muted hover:text-content-primary"
            }`}
          >
            Guide
          </RemotionButton>
        ) : null}
        <RemotionButton
          type="button"
          aria-label="Undo transcript edit"
          title="Undo transcript edit (⌘Z)"
          disabled={!canUndo}
          onClick={undo}
          className="h-6 rounded-[5px] px-1.5 text-[10px] font-semibold text-content-secondary hover:bg-warm-muted hover:text-content-primary disabled:opacity-25"
        >
          Undo
        </RemotionButton>
        {headerTrailingAction}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {transcriptionError ? (
          <div
            role="alert"
            className="mx-5 mt-5 border-l-2 border-red-400 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
          >
            {transcriptionError}
          </div>
        ) : null}

        {!hasMediaClips ? (
          <div className="mx-auto flex h-full w-full max-w-md flex-col px-7 pt-[clamp(72px,14vh,120px)]">
            <div
              className="mb-7 flex h-5 items-end gap-[3px]"
              aria-hidden="true"
            >
              <span className="h-2 w-[2px] bg-brand" />
              <span className="h-5 w-[2px] bg-brand" />
              <span className="h-3 w-[2px] bg-brand" />
              <span className="h-4 w-[2px] bg-brand" />
              <span className="h-2 w-[2px] bg-brand" />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-content-secondary">
              Your edit starts with a voice
            </p>
            <h2 className="mt-2 max-w-[280px] text-[24px] font-semibold leading-[1.12] tracking-[-0.035em] text-content-primary">
              Bring in the conversation.
            </h2>
            <p className="mt-3 max-w-[300px] text-[12px] leading-5 text-content-secondary">
              Add video or audio to the Timeline. Spoken words will become an
              editable document here.
            </p>
            {onOpenMedia ? (
              <RemotionButton
                type="button"
                onClick={onOpenMedia}
                className="mt-6 h-8 w-fit rounded-[6px] bg-brand px-3 text-[11px] font-semibold text-brand-foreground hover:bg-brand/90"
              >
                Open Media
              </RemotionButton>
            ) : null}
          </div>
        ) : words.length === 0 ? (
          <div className="mx-auto flex h-full w-full max-w-md flex-col px-7 pt-[clamp(72px,14vh,120px)]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
              Media is ready
            </span>
            <h2 className="mt-2 max-w-[300px] text-[24px] font-semibold leading-[1.12] tracking-[-0.035em] text-content-primary">
              Turn speech into an edit.
            </h2>
            <p className="mt-3 max-w-[310px] text-[12px] leading-5 text-content-secondary">
              Generate timing once, select the words you do not need, and the
              Timeline closes the gap immediately.
            </p>
            {missingAssets.length > 0 && onTranscribeAsset ? (
              <RemotionButton
                type="button"
                disabled={transcribing}
                onClick={transcribeMissingAssets}
                className="mt-6 h-8 w-fit rounded-[6px] bg-brand px-3 text-[11px] font-semibold text-brand-foreground hover:bg-brand/90 disabled:cursor-wait disabled:opacity-60"
              >
                {transcribing ? "Transcribing…" : "Transcribe timeline"}
              </RemotionButton>
            ) : (
              <p className="mt-6 text-[11px] font-medium text-content-muted">
                Word timing is not available for these clips.
              </p>
            )}
          </div>
        ) : (
          <div data-transcript-document="" className="mx-auto w-full max-w-[660px] px-5 pb-24 pt-7">
            {guideExpanded ? (
              <div
                data-testid="transcript-edit-guide"
                data-transcript-edit-guide=""
                className="mb-7 grid min-w-0 grid-cols-[36px_minmax(0,1fr)] gap-x-3 border-b border-warm-border pb-5"
              >
                <div
                  data-transcript-guide-mark=""
                  aria-hidden="true"
                  className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-brand-light text-[11px] font-bold tracking-[-0.04em] text-brand"
                >
                  Aa
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold tracking-[-0.012em] text-content-primary">
                    Edit the words. The Timeline follows.
                  </p>
                  <p className="mt-1 max-w-[520px] text-[11px] leading-[1.55] text-content-secondary">
                    Click a word to seek, drag across words to select, then press
                    Delete. The matching clip range is removed and the gap closes
                    automatically.
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-content-muted">
                    <span>Click · Seek</span>
                    <span>Drag · Select</span>
                    <span>Delete · Cut</span>
                    <span>Space · Preview</span>
                  </div>
                </div>
              </div>
            ) : null}
            {wordGroups.map((group, groupIndex) => (
              <div
                key={`${group.clipId}:${group.startFrame}`}
                data-transcript-clip-group=""
                className="min-w-0 border-t border-warm-border py-5 first:border-t-0 first:pt-0"
              >
                <div data-transcript-clip-meta="" className="mb-2 flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: "SET_CURRENT_FRAME",
                        payload: group.startFrame,
                      })
                    }
                    className="h-6 shrink-0 text-left text-[10px] font-semibold tabular-nums text-content-muted hover:text-brand"
                  >
                    {formatFrame(group.startFrame, fps)}
                  </button>
                  <div className="min-w-0 truncate text-[9px] font-semibold uppercase tracking-[0.13em] text-content-muted">
                    Clip {String(groupIndex + 1).padStart(2, "0")}
                  </div>
                </div>
                <div data-transcript-clip-body="" className="min-w-0">
                  {groupWordsIntoParagraphs(group.words).map((paragraphWords, paragraphIndex) => (
                    <p
                      key={`${group.clipId}:paragraph:${paragraphIndex}`}
                      data-transcript-paragraph=""
                      className="mb-3 w-full min-w-0 text-[16px] leading-[2.05] tracking-[-0.008em] text-content-primary last:mb-0"
                    >
                      {paragraphWords.map((word, wordIndex) => {
                        const index = wordIndexById.get(word.id) ?? -1;
                        const isSelected =
                          selection !== null &&
                          index >= selection[0] &&
                          index <= selection[1];
                        const isCurrent =
                          currentFrame >= word.timelineStartFrame &&
                          currentFrame < word.timelineEndFrame;
                        const isSelectionStart = isSelected && index === selection?.[0];
                        const isSelectionEnd = isSelected && index === selection?.[1];
                        const selectionShape = isSelectionStart && isSelectionEnd
                          ? "rounded-[3px]"
                          : isSelectionStart
                            ? "rounded-l-[3px]"
                            : isSelectionEnd
                              ? "rounded-r-[3px]"
                              : "rounded-none";
                        return (
                          <button
                            key={word.id}
                            type="button"
                            aria-label={word.text}
                            data-word-id={word.id}
                            onClick={(event) => selectWord(index, event.shiftKey)}
                            onPointerDown={(event) => {
                              draggingSelectionRef.current = true;
                              selectWord(index, event.shiftKey);
                            }}
                            onPointerEnter={() => {
                              if (draggingSelectionRef.current)
                                selectWord(index, true);
                            }}
                            className={`relative px-0 py-0.5 text-left transition-colors ${selectionShape} ${
                              isSelected
                                ? "bg-brand text-brand-foreground shadow-sm"
                                : isCurrent
                                  ? "bg-brand-light text-content-primary"
                                  : "hover:bg-warm-muted"
                            }`}
                          >
                            {transcriptTokenPrefix(
                              paragraphWords[wordIndex - 1]?.text,
                              word.text,
                            )}
                            {word.text}
                          </button>
                        );
                      })}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selection ? (
        <footer data-transcript-selection-footer="" className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-t border-warm-border bg-warm-surface px-4 py-2 shadow-sm">
          <div data-transcript-selection-summary="" className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold tabular-nums text-content-primary">
              {selectedWords.length}{" "}
              {selectedWords.length === 1 ? "word" : "words"} ·{" "}
              {formatDuration(selectedDurationInFrames, fps)}
            </div>
            <div className="mt-0.5 text-[9px] leading-3 text-content-secondary">
              This will remove the matching clip range and close the gap. Esc
              clears.
            </div>
          </div>
          {selectedWords.length === 1 ? (
            <form
              data-transcript-correction-form=""
              className="flex min-w-0 items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                correctSelection();
              }}
            >
              <RemotionInput
                aria-label="Correct selected transcript word"
                value={correctionText}
                onChange={(event) => setCorrectionText(event.target.value)}
                className="h-7 w-24 rounded-[5px] border border-warm-border bg-warm-page px-2 text-[10px] text-content-primary outline-none placeholder:text-content-muted focus:border-brand/60 focus:ring-2 focus:ring-brand/10"
              />
              <RemotionButton
                type="submit"
                aria-label="Correct transcript word"
                disabled={correctionText.trim().length === 0 || correctionText.trim() === selectedWords[0]?.text}
                className="h-7 rounded-[5px] border border-warm-border bg-warm-surface px-2 text-[10px] font-semibold text-content-secondary hover:border-brand/60 hover:bg-warm-muted hover:text-brand disabled:cursor-not-allowed disabled:opacity-35"
              >
                Correct
              </RemotionButton>
            </form>
          ) : null}
          <RemotionButton
            type="button"
            aria-label="Delete selected transcript words"
            onClick={deleteSelection}
            className="h-7 shrink-0 rounded-[5px] bg-brand px-2.5 text-[10px] font-semibold text-brand-foreground hover:bg-brand/90"
          >
            Cut from Timeline
          </RemotionButton>
        </footer>
      ) : lastCutSummary && canUndo ? (
        <footer
          aria-live="polite"
          className="flex min-h-12 shrink-0 items-center gap-3 border-t border-warm-border bg-warm-muted px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-content-primary">
              Cut applied
            </div>
            <div className="mt-0.5 text-[9px] tabular-nums text-content-secondary">
              Timeline gap closed · {lastCutSummary.wordCount}{" "}
              {lastCutSummary.wordCount === 1 ? "word" : "words"} ·{" "}
              {formatDuration(lastCutSummary.durationInFrames, fps)}
            </div>
          </div>
          <RemotionButton
            type="button"
            aria-label="Undo last transcript cut"
            onClick={undo}
            className="h-7 shrink-0 rounded-[5px] border border-warm-border bg-warm-surface px-2.5 text-[10px] font-semibold text-content-secondary hover:border-brand/50 hover:bg-warm-hover hover:text-brand"
          >
            Undo
          </RemotionButton>
        </footer>
      ) : null}
    </section>
  );
};
