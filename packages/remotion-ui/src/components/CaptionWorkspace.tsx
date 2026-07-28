import React from 'react';
import {
  deriveTimelineTranscriptWords,
  isSubtitleTextItem,
  selectSpokenMediaTracks,
  useEditorDispatch,
  useEditorStaticState,
  type Asset,
  type EditorAssetTranscript,
  type SubtitleTextItem,
  type Track,
} from '@master-clash/remotion-core';
import { buildCaptionItemFromTimelineWords, parseCaptionFile } from '../captions/captionWorkflow';
import { TimelineLibraryPanel } from './TimelineLibraryPanel';
import { TranscriptEditor } from './TranscriptEditor';
import { RemotionButton, RemotionFileInput, RemotionTextarea } from './ui/controls';

type CaptionWorkspaceView = 'recognize' | 'edit' | 'import' | 'styles';
type CaptionEditMode = 'caption-text' | 'timeline';

export type CaptionWorkspaceProps = {
  onTranscribeAsset?: (asset: Asset) => Promise<EditorAssetTranscript>;
  headerTrailingAction?: React.ReactNode;
  initialView?: CaptionWorkspaceView;
  onTimelineEditModeChange?: (active: boolean) => void;
};

const CAPTION_WORKSPACE_VIEWS: Array<{ id: CaptionWorkspaceView; label: string }> = [
  { id: 'recognize', label: 'Recognize' },
  { id: 'edit', label: 'Edit' },
  { id: 'import', label: 'Import' },
  { id: 'styles', label: 'Styles' },
];

const captionTypography = {
  caption: 'text-[length:var(--clash-editor-text-caption)] leading-[var(--clash-editor-leading-caption)]',
  control: 'text-[length:var(--clash-editor-text-control)] leading-[var(--clash-editor-leading-control)]',
  item: 'text-[length:var(--clash-editor-text-item)] leading-[var(--clash-editor-leading-item)]',
  heading: 'text-[length:var(--clash-editor-text-heading)] leading-[var(--clash-editor-leading-heading)]',
} as const;

type CaptionEntry = { track: Track; item: SubtitleTextItem };

export const CaptionWorkspace: React.FC<CaptionWorkspaceProps> = ({
  onTranscribeAsset,
  headerTrailingAction,
  initialView = 'recognize',
  onTimelineEditModeChange,
}) => {
  const { tracks, primaryTrackId, assets, assetTranscripts, fps, durationInFrames } = useEditorStaticState();
  const dispatch = useEditorDispatch();
  const [view, setView] = React.useState<CaptionWorkspaceView>(initialView);
  const [editMode, setEditMode] = React.useState<CaptionEditMode>('caption-text');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = React.useState(false);
  const idCounter = React.useRef(0);
  const viewTabsRef = React.useRef<HTMLElement | null>(null);
  const createId = React.useCallback((prefix: string) => {
    idCounter.current += 1;
    return `${prefix}-${Date.now().toString(36)}-${idCounter.current.toString(36)}`;
  }, []);

  React.useEffect(() => {
    const selectedTab = viewTabsRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    selectedTab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [view]);

  const timelineEditModeActive = view === 'edit' && editMode === 'timeline';
  React.useEffect(() => {
    onTimelineEditModeChange?.(timelineEditModeActive);
  }, [onTimelineEditModeChange, timelineEditModeActive]);
  React.useEffect(() => () => {
    onTimelineEditModeChange?.(false);
  }, [onTimelineEditModeChange]);

  const captionEntries = React.useMemo<CaptionEntry[]>(() => tracks.flatMap((track) => (
    track.role === 'subtitle'
      ? track.items
      .filter(isSubtitleTextItem)
      .map((item) => ({ track, item }))
      : []
  )), [tracks]);
  const mediaAssets = React.useMemo(() => {
    const byId = new Map<string, Asset>();
    for (const asset of assets) {
      byId.set(asset.id, asset);
      if (asset.backingAssetId) byId.set(asset.backingAssetId, asset);
    }
    const result: Asset[] = [];
    const seen = new Set<string>();
    for (const track of selectSpokenMediaTracks(tracks, primaryTrackId)) {
      for (const item of track.items) {
        if ((item.type !== 'video' && item.type !== 'audio') || !item.assetId || seen.has(item.assetId)) continue;
        const asset = byId.get(item.assetId);
        if (!asset) continue;
        seen.add(item.assetId);
        result.push(asset);
      }
    }
    return result;
  }, [assets, primaryTrackId, tracks]);

  const insertCaptionItem = React.useCallback((item: SubtitleTextItem) => {
    const captionTrack = tracks.find((track) => track.role === 'subtitle');
    if (captionTrack) {
      dispatch({ type: 'ADD_ITEM', payload: { trackId: captionTrack.id, item } });
      if (replaceExisting) {
        for (const existing of captionTrack.items) {
          if (isSubtitleTextItem(existing)) {
            dispatch({ type: 'REMOVE_ITEM', payload: { trackId: captionTrack.id, itemId: existing.id } });
          }
        }
      }
    } else {
      dispatch({
        type: 'ADD_TRACK',
        payload: {
          id: createId('caption-track'),
          name: 'Text',
          role: 'subtitle',
          category: 'text',
          items: [item],
        },
      });
    }
    dispatch({ type: 'SELECT_ITEM', payload: item.id });
  }, [createId, dispatch, replaceExisting, tracks]);

  const recognizeCaptions = React.useCallback(async () => {
    if (busy || mediaAssets.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const transcripts = { ...assetTranscripts };
      for (const asset of mediaAssets) {
        const transcriptId = asset.backingAssetId ?? asset.id;
        if (transcripts[transcriptId] || transcripts[asset.id]) continue;
        if (!onTranscribeAsset) throw new Error('Caption recognition is unavailable for media without a transcript.');
        const transcript = await onTranscribeAsset(asset);
        transcripts[transcript.assetId] = transcript;
        dispatch({ type: 'SET_ASSET_TRANSCRIPT', payload: transcript });
      }
      const words = deriveTimelineTranscriptWords({
        tracks: selectSpokenMediaTracks(tracks, primaryTrackId),
        fps,
        assetTranscripts: transcripts,
      });
      const item = buildCaptionItemFromTimelineWords({ words, durationInFrames, createId });
      insertCaptionItem(item);
      setMessage(`Created ${item.cues.length} caption${item.cues.length === 1 ? '' : 's'}.`);
      setEditMode('caption-text');
      setView('edit');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Caption recognition failed.');
    } finally {
      setBusy(false);
    }
  }, [assetTranscripts, busy, createId, dispatch, durationInFrames, fps, insertCaptionItem, mediaAssets, onTranscribeAsset, primaryTrackId, tracks]);

  const importCaptionFile = React.useCallback(async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const item = parseCaptionFile({
        fileName: file.name,
        contents: await file.text(),
        fps,
        createId,
      });
      insertCaptionItem(item);
      setMessage(`Imported ${item.cues.length} caption${item.cues.length === 1 ? '' : 's'} from ${file.name}.`);
      setEditMode('caption-text');
      setView('edit');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Subtitle import failed.');
    } finally {
      setBusy(false);
    }
  }, [createId, fps, insertCaptionItem]);

  const updateCueText = React.useCallback((entry: CaptionEntry, cueId: string, text: string) => {
    const cues = entry.item.cues.map((cue) => cue.id === cueId ? { ...cue, text } : cue);
    dispatch({
      type: 'UPDATE_ITEM',
      payload: {
        trackId: entry.track.id,
        itemId: entry.item.id,
        updates: {
          cues,
          text: cues.map((cue) => cue.text).join('\n'),
        },
      },
    });
  }, [dispatch]);

  return (
    <section data-editor-caption-workspace="" className="clash-timeline-panel-surface flex h-full min-h-0 flex-col overflow-hidden bg-warm-surface">
      <div className="flex shrink-0 items-center gap-1 border-b border-warm-border/70 px-2 py-2">
        <nav
          ref={viewTabsRef}
          data-caption-workspace-tabs=""
          aria-label="Caption workspace"
          role="tablist"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {CAPTION_WORKSPACE_VIEWS.map((candidate) => (
            <RemotionButton
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={view === candidate.id}
              onClick={() => setView(candidate.id)}
              className={`clash-workbench-control-button h-8 shrink-0 whitespace-nowrap px-2 text-[length:var(--clash-editor-text-control)] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                view === candidate.id
                  ? 'bg-brand/[0.10] text-brand'
                  : 'text-content-muted hover:bg-warm-hover hover:text-content-primary'
              }`}
            >
              {candidate.label}
            </RemotionButton>
          ))}
        </nav>
        {headerTrailingAction}
      </div>

      {view === 'recognize' ? (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <div className="rounded-matrix bg-warm-page p-3 ring-1 ring-warm-border/70">
            <h2 className={`m-0 font-semibold text-content-primary ${captionTypography.heading}`}>Auto captions</h2>
            <p className={`mb-0 mt-1 text-content-secondary ${captionTypography.caption}`}>
              Recognize speech from Timeline media and create frame-aligned captions.
            </p>
            <div className={`mt-3 flex items-center justify-between gap-3 text-content-secondary ${captionTypography.caption}`}>
              <span>{mediaAssets.length} spoken-media asset{mediaAssets.length === 1 ? '' : 's'}</span>
              <RemotionButton
                type="button"
                aria-label="Recognize captions"
                disabled={busy || mediaAssets.length === 0}
                onClick={() => void recognizeCaptions()}
                className={`h-8 rounded-md bg-brand px-3 font-semibold text-brand-foreground hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45 ${captionTypography.control}`}
              >
                {busy ? 'Recognizing…' : 'Recognize'}
              </RemotionButton>
            </div>
          </div>
          {mediaAssets.length === 0 ? (
            <p className={`m-0 mt-3 text-content-secondary ${captionTypography.caption}`}>Add video or audio to the Timeline first.</p>
          ) : null}
          <label className={`mt-auto flex items-center gap-2 pt-3 text-content-secondary ${captionTypography.caption}`}>
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(event) => setReplaceExisting(event.target.checked)}
              className="h-3.5 w-3.5 accent-brand"
            />
            Replace existing captions
          </label>
          {message ? <p role="status" className={`m-0 mt-3 text-content-secondary ${captionTypography.caption}`}>{message}</p> : null}
        </div>
      ) : null}

      {view === 'edit' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <nav
            aria-label="Caption edit mode"
            role="tablist"
            className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-warm-border/70 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <RemotionButton
              type="button"
              role="tab"
              aria-selected={editMode === 'caption-text'}
              onClick={() => setEditMode('caption-text')}
              className={`clash-workbench-control-button h-7 shrink-0 whitespace-nowrap px-2 font-medium transition-colors ${
                editMode === 'caption-text'
                  ? 'bg-brand/[0.10] text-brand'
                  : 'text-content-muted hover:bg-warm-hover hover:text-content-primary'
              } ${captionTypography.control}`}
            >
              Caption text
            </RemotionButton>
            <RemotionButton
              type="button"
              role="tab"
              aria-selected={editMode === 'timeline'}
              onClick={() => setEditMode('timeline')}
              className={`clash-workbench-control-button h-7 shrink-0 whitespace-nowrap px-2 font-medium transition-colors ${
                editMode === 'timeline'
                  ? 'bg-brand/[0.10] text-brand'
                  : 'text-content-muted hover:bg-warm-hover hover:text-content-primary'
              } ${captionTypography.control}`}
            >
              Timeline edit
            </RemotionButton>
          </nav>
          {editMode === 'timeline' ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              <TranscriptEditor onTranscribeAsset={onTranscribeAsset} />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {captionEntries.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className={`m-0 font-semibold text-content-primary ${captionTypography.heading}`}>Caption text</h2>
                    <span className={`text-content-muted ${captionTypography.caption}`}>{captionEntries.length} sentences</span>
                  </div>
                  {captionEntries.flatMap((entry) => entry.item.cues.map((cue) => ({ entry, cue })))
                    .map(({ entry, cue }, index) => (
                      <label key={`${entry.item.id}:${cue.id}`} className="block rounded-matrix bg-warm-page p-2 ring-1 ring-warm-border/70">
                        <span className={`mb-1 block font-medium text-content-secondary ${captionTypography.caption}`}>Sentence {index + 1}</span>
                        <RemotionTextarea
                          aria-label={`Caption sentence ${index + 1} text`}
                          value={cue.text}
                          rows={2}
                          onFocus={() => {
                            dispatch({ type: 'SELECT_TRACK', payload: entry.track.id });
                            dispatch({ type: 'SELECT_ITEM', payload: entry.item.id });
                          }}
                          onChange={(event) => updateCueText(entry, cue.id, event.target.value)}
                          className={`w-full resize-none rounded-md border border-warm-border bg-warm-surface px-2 py-1.5 text-content-primary outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/15 ${captionTypography.item}`}
                        />
                      </label>
                    ))}
                </div>
              ) : (
                <div className="flex h-40 flex-col items-center justify-center text-center">
                  <p className={`m-0 font-semibold text-content-primary ${captionTypography.item}`}>No captions yet</p>
                  <p className={`m-0 mt-1 text-content-secondary ${captionTypography.caption}`}>Recognize speech or import a subtitle file first.</p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {view === 'import' ? (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-matrix border border-dashed border-warm-border bg-warm-page px-4 text-center transition-colors hover:border-brand/45 hover:bg-brand/[0.025]">
            <span className={`font-semibold text-content-primary ${captionTypography.item}`}>Import subtitle file</span>
            <span className={`mt-1 text-content-secondary ${captionTypography.caption}`}>SRT, VTT, ASS, or SSA</span>
            <RemotionFileInput
              aria-label="Import subtitle file"
              accept=".srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importCaptionFile(file);
                event.target.value = '';
              }}
              className="sr-only"
            />
          </label>
          <label className={`mt-3 flex items-center gap-2 text-content-secondary ${captionTypography.caption}`}>
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(event) => setReplaceExisting(event.target.checked)}
              className="h-3.5 w-3.5 accent-brand"
            />
            Replace existing captions
          </label>
          {message ? <p role="status" className={`m-0 mt-3 text-content-secondary ${captionTypography.caption}`}>{message}</p> : null}
        </div>
      ) : null}

      {view === 'styles' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <TimelineLibraryPanel embedded selectedCategory="captions" showCategoryChoices={false} />
        </div>
      ) : null}
    </section>
  );
};
