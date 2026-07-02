/**
 * Video-clipper modal — opens on double-click of a `video-clipper` node.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────┐
 *   │ Header (title + close)                         │
 *   ├──────────────────────────────────┬─────────────┤
 *   │                                  │             │
 *   │      Video preview               │ Mode +      │
 *   │                                  │ time inputs │
 *   │                                  │ + apply     │
 *   ├──────────────────────────────────┴─────────────┤
 *   │ Filmstrip + timeline (full width)              │
 *   └────────────────────────────────────────────────┘
 *
 * Modes:
 *   - `screenshot` — single playhead on the timeline. Click / drag to seek;
 *                    the <video> follows so you see the captured frame.
 *   - `crop`       — selected range with two draggable handles. Dragging
 *                    either end seeks the video to that handle's time.
 *
 * Filmstrip thumbnails are captured on mount from a hidden second <video>
 * element so seeking for thumbnails doesn't fight the user's playhead on
 * the visible <video>.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { EditorModalDialog } from './EditorModalDialog';
import { useOptionalLoroSyncContext } from './LoroSyncContext';
import { useSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { generateSemanticId } from '@clash/web-ui/lib/utils/semanticId';
import { autoInsertNode } from '@clash/web-ui/lib/layout';
import { applyVideoScreenshot } from '@clash/web-ui/lib/editPipeline';
import type { VideoClipParams } from '@clash/shared-types';
import { Button } from './ui/button';
import { Slider, SliderRange, SliderThumb, SliderTrack } from './ui/slider';

interface OpenVideoClipperInput {
    editorNodeId: string;
    projectId: string;
    sourceAssetId: string;
    sourceR2Key: string;
    /** Source video duration, used to bound the time slider. */
    durationSec: number;
    initialParams: VideoClipParams | undefined;
    nodes: Node[];
    edges: Edge[];
    parentId?: string;
}

interface VideoClipperContextType {
    isOpen: boolean;
    openEditor: (input: OpenVideoClipperInput) => void;
    closeEditor: () => void;
}

const Ctx = createContext<VideoClipperContextType | undefined>(undefined);

export function VideoClipperProvider({ children }: { children: ReactNode }) {
    const loroSync = useOptionalLoroSyncContext();
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState<OpenVideoClipperInput | null>(null);

    const openEditor = useCallback((next: OpenVideoClipperInput) => {
        setInput(next);
        setOpen(true);
    }, []);
    const closeEditor = useCallback(() => {
        setOpen(false);
        setInput(null);
    }, []);

    return (
        <Ctx.Provider value={{ isOpen: open, openEditor, closeEditor }}>
            {children}
            {open && input && (
                <EditorModalDialog
                    open={open}
                    onClose={closeEditor}
                    ariaLabel="Video clipper"
                    panelClassName="h-[min(820px,calc(100vh-48px))] w-[min(1200px,calc(100vw-48px))] flex flex-col"
                >
                    <VideoClipperPanel input={input} loroSync={loroSync} onClose={closeEditor} />
                </EditorModalDialog>
            )}
        </Ctx.Provider>
    );
}

export function useVideoClipper() {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error('useVideoClipper must be used within VideoClipperProvider');
    return ctx;
}

// ─── Panel ──────────────────────────────────────────────────

const FILMSTRIP_FRAMES = 12;

function VideoClipperPanel({
    input, loroSync, onClose,
}: {
    input: OpenVideoClipperInput;
    loroSync: ReturnType<typeof useOptionalLoroSyncContext>;
    onClose: () => void;
}) {
    const signedUrl = useSignedUrl(input.sourceR2Key);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [duration, setDuration] = useState<number>(Math.max(0.001, input.durationSec));

    // Initial mode/time from existing params, defaulting to screenshot at 0s.
    const initial = input.initialParams;
    const [mode, setMode] = useState<'screenshot' | 'crop'>(
        initial?.mode === 'crop' ? 'crop' : 'screenshot',
    );
    const [frameTimeSec, setFrameTimeSec] = useState<number>(
        initial?.mode === 'screenshot' ? initial.frameTimeSec : 0,
    );
    const [startSec, setStartSec] = useState<number>(
        initial?.mode === 'crop' ? initial.startSec : 0,
    );
    const [endSec, setEndSec] = useState<number>(
        initial?.mode === 'crop' ? initial.endSec : Math.max(1, input.durationSec),
    );
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [frames, setFrames] = useState<string[]>([]);
    const [playing, setPlaying] = useState(false);

    // Refresh duration once the real <video> reports it — the prop comes from
    // D1 metadata which can lag for fresh uploads. We trust the player.
    const onLoadedMetadata = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        const d = v.duration;
        if (Number.isFinite(d) && d > 0) {
            setDuration(d);
            // If initial endSec was clamped to a stale duration, expand to true end.
            if (endSec >= input.durationSec - 0.05 && endSec < d) setEndSec(d);
        }
    }, [endSec, input.durationSec]);

    // Drive the visible video off mode-specific scrub state. In crop mode the
    // playhead "is" whichever handle the user last touched; we don't fight
    // user-initiated playback here — only seek when scrubbing changes.
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const target = mode === 'screenshot' ? frameTimeSec : startSec;
        if (Math.abs(v.currentTime - target) > 0.05) {
            v.currentTime = target;
        }
    }, [frameTimeSec, startSec, mode]);

    const params: VideoClipParams = mode === 'screenshot'
        ? { mode: 'screenshot', frameTimeSec }
        : { mode: 'crop', startSec, endSec };

    const handleApply = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            if (loroSync?.connected) {
                loroSync.updateNode(input.editorNodeId, { data: { editParams: params } });
            }
            if (params.mode === 'crop') {
                throw new Error(
                    'Video crop (time-range trimming) is not implemented yet. Use Screenshot mode for now.',
                );
            }
            const result = await applyVideoScreenshot({
                projectId: input.projectId,
                sourceAssetId: input.sourceAssetId,
                sourceR2Key: input.sourceR2Key,
                params,
            });
            await spawnCompletedImageDownstream({
                editorNodeId: input.editorNodeId,
                parentId: input.parentId,
                projectId: input.projectId,
                assetId: result.assetId,
                nodes: input.nodes,
                edges: input.edges,
                loroSync,
            });
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [input, params, loroSync, onClose]);

    return (
        <>
            <div className="flex items-center justify-between px-5 py-3 border-b border-warm-border bg-warm-surface">
                <h2 className="text-base font-semibold text-slate-800">Video Clipper</h2>
                <Button
                    size="sm"
                    onClick={onClose}
                    disabled={busy}
                    className="rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300"
                >
                    Cancel
                </Button>
            </div>

            <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 bg-black flex items-center justify-center p-4 min-h-0">
                    {signedUrl ? (
                        <video
                            ref={videoRef}
                            src={signedUrl}
                            className="max-h-full max-w-full"
                            preload="auto"
                            playsInline
                            onLoadedMetadata={onLoadedMetadata}
                            onPlay={() => setPlaying(true)}
                            onPause={() => setPlaying(false)}
                            onTimeUpdate={(e) => {
                                if (mode === 'screenshot' && playing) {
                                    setFrameTimeSec((e.target as HTMLVideoElement).currentTime);
                                }
                            }}
                        />
                    ) : (
                        <div className="text-slate-700 dark:text-slate-300">Loading…</div>
                    )}
                </div>

                <div className="w-72 border-l border-warm-border bg-warm-surface p-4 flex flex-col gap-4 overflow-y-auto">
                    <section>
                        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">Mode</h3>
                        <div className="flex gap-1">
                            <ModeButton active={mode === 'screenshot'} onClick={() => setMode('screenshot')}>
                                Screenshot
                            </ModeButton>
                            <ModeButton active={mode === 'crop'} onClick={() => setMode('crop')}>
                                Crop
                            </ModeButton>
                        </div>
                    </section>

                    {mode === 'screenshot' ? (
                        <section>
                            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                                Time
                            </h3>
                            <div className="text-2xl font-mono text-slate-800 tabular-nums">
                                {formatTime(frameTimeSec)}
                            </div>
                            <div className="text-xs text-slate-700 dark:text-slate-300 mt-0.5">
                                of {formatTime(duration)}
                            </div>
                        </section>
                    ) : (
                        <section>
                            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                                Range
                            </h3>
                            <div className="grid grid-cols-2 gap-3">
                                <RangeReadout label="Start" value={startSec} />
                                <RangeReadout label="End" value={endSec} />
                            </div>
                            <div className="text-[11px] text-slate-700 dark:text-slate-300 mt-2 tabular-nums">
                                Length {formatTime(Math.max(0, endSec - startSec))}
                            </div>
                            <div className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                                Crop mode requires server-side trimming (not yet wired). Apply will fail.
                            </div>
                        </section>
                    )}

                    {error && (
                        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
                            {error}
                        </div>
                    )}

                    <div className="mt-auto pt-2">
                        <Button
                            variant="primary"
                            onClick={handleApply}
                            disabled={busy}
                            className="w-full rounded-md px-4 py-2 text-sm"
                        >
                            {busy ? 'Applying…' : 'Apply'}
                        </Button>
                    </div>
                </div>
            </div>

            <div className="border-t border-warm-border bg-warm-muted px-5 py-3">
                <Timeline
                    duration={duration}
                    mode={mode}
                    frameTimeSec={frameTimeSec}
                    setFrameTimeSec={setFrameTimeSec}
                    startSec={startSec}
                    setStartSec={setStartSec}
                    endSec={endSec}
                    setEndSec={setEndSec}
                    frames={frames}
                />
            </div>

            {/* Hidden video used for capturing filmstrip thumbnails. Separate
                element so seeking for thumbnails doesn't fight the visible
                player when the user is scrubbing. */}
            {signedUrl && (
                <FilmstripCapturer
                    src={signedUrl}
                    duration={duration}
                    onCaptured={setFrames}
                />
            )}
        </>
    );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <Button
            size="sm"
            onClick={onClick}
            className={`min-h-0 flex-1 rounded-md px-2 py-1.5 text-xs ${
                active
                    ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-900'
                    : 'bg-warm-surface text-slate-800 dark:text-slate-200 border-slate-300 hover:bg-slate-50'
            }`}
        >
            {children}
        </Button>
    );
}

function RangeReadout({ label, value }: { label: string; value: number }) {
    return (
        <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">{label}</span>
            <span className="text-base font-mono text-slate-800 tabular-nums">{formatTime(value)}</span>
        </div>
    );
}

// ─── Timeline ───────────────────────────────────────────────

interface TimelineProps {
    duration: number;
    mode: 'screenshot' | 'crop';
    frameTimeSec: number;
    setFrameTimeSec: (n: number) => void;
    startSec: number;
    setStartSec: (n: number) => void;
    endSec: number;
    setEndSec: (n: number) => void;
    frames: string[];
}

function Timeline({
    duration, mode, frameTimeSec, setFrameTimeSec,
    startSec, setStartSec, endSec, setEndSec, frames,
}: TimelineProps) {
    const max = Math.max(0.001, duration);
    const step = max > 1 ? 0.01 : Math.max(0.001, max / 100);
    const minClipLength = Math.min(0.05, Math.max(0, max - step));
    const minStepsBetweenThumbs = Math.max(0, Math.round(minClipLength / step));

    const clampSec = useCallback((sec: number) => Math.max(0, Math.min(max, sec)), [max]);

    const timelineValue = mode === 'screenshot'
        ? [clampSec(frameTimeSec)]
        : [clampSec(Math.min(startSec, endSec)), clampSec(Math.max(startSec, endSec))];

    const handleValueChange = useCallback((value: number[]) => {
        if (mode === 'screenshot') {
            setFrameTimeSec(clampSec(value[0] ?? 0));
            return;
        }

        const nextStart = clampSec(value[0] ?? 0);
        const nextEnd = clampSec(value[1] ?? max);
        setStartSec(Math.min(nextStart, nextEnd));
        setEndSec(Math.max(nextStart, nextEnd));
    }, [clampSec, max, mode, setEndSec, setFrameTimeSec, setStartSec]);

    return (
        <div className="select-none">
            <Slider
                aria-label="Video timeline"
                value={timelineValue}
                onValueChange={handleValueChange}
                min={0}
                max={max}
                step={step}
                minStepsBetweenThumbs={mode === 'crop' ? minStepsBetweenThumbs : 0}
                className="relative h-16 rounded-md bg-slate-200 overflow-hidden cursor-pointer"
            >
                {/* Filmstrip — evenly spaced thumbnails. Falls back to a flat
                    bg if frames haven't been captured yet (still scrubbable). */}
                {frames.length > 0 && (
                    <div className="absolute inset-0 flex">
                        {frames.map((src, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                key={i}
                                src={src}
                                alt=""
                                className="h-full flex-1 object-cover pointer-events-none"
                                draggable={false}
                                style={{ minWidth: 0 }}
                            />
                        ))}
                    </div>
                )}

                <SliderTrack className="absolute inset-0 h-full w-full rounded-md bg-transparent">
                    <SliderRange
                        className={
                            mode === 'crop'
                                ? 'top-0 bottom-0 border-y-2 border-brand bg-slate-900/0'
                                : 'top-0 bottom-0 bg-slate-900/15'
                        }
                    />
                </SliderTrack>
                <SliderThumb
                    aria-label={mode === 'screenshot' ? 'Frame time' : 'Clip start'}
                    className={[
                        'h-16 w-[3px] cursor-col-resize rounded-none transition-transform hover:scale-x-[2]',
                        'after:absolute after:-top-1 after:left-1/2 after:h-3 after:w-3 after:-translate-x-1/2 after:rounded-full after:ring-2',
                        mode === 'screenshot'
                            ? 'bg-slate-800 after:bg-slate-800 after:ring-warm-border dark:bg-slate-200 dark:after:bg-slate-200 dark:after:ring-slate-500'
                            : 'bg-brand after:bg-brand after:ring-brand/30',
                    ].join(' ')}
                />
                {mode === 'crop' && (
                    <SliderThumb
                        aria-label="Clip end"
                        className={[
                            'h-16 w-[3px] cursor-col-resize rounded-none bg-brand transition-transform hover:scale-x-[2]',
                            'after:absolute after:-top-1 after:left-1/2 after:h-3 after:w-3 after:-translate-x-1/2 after:rounded-full after:bg-brand after:ring-2 after:ring-brand/30',
                        ].join(' ')}
                    />
                )}
            </Slider>

            {/* Time ruler */}
            <div className="relative h-4 mt-1 text-[10px] font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                <span className="absolute left-0">0:00</span>
                <span className="absolute left-1/4 -translate-x-1/2">{formatTime(duration * 0.25)}</span>
                <span className="absolute left-1/2 -translate-x-1/2">{formatTime(duration * 0.5)}</span>
                <span className="absolute left-3/4 -translate-x-1/2">{formatTime(duration * 0.75)}</span>
                <span className="absolute right-0">{formatTime(duration)}</span>
            </div>
        </div>
    );
}

// ─── Filmstrip capture ──────────────────────────────────────

/**
 * Hidden helper that walks an isolated <video> through evenly-spaced timestamps
 * and emits a list of data-URL frames for the timeline thumbnails.
 *
 * Why not reuse the visible <video>: scrubbing thumbnails would yank the user's
 * playhead around. Two elements + two `currentTime` writes don't conflict.
 *
 * Best-effort: any seek failure shows an empty thumbnail slot. Captures stop
 * at the first seek that doesn't fire `seeked` within 1.5s — no eternal hang.
 */
function FilmstripCapturer({
    src, duration, onCaptured,
}: { src: string; duration: number; onCaptured: (urls: string[]) => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const capturedRef = useRef(false);

    useEffect(() => {
        capturedRef.current = false;
    }, [src]);

    useEffect(() => {
        if (capturedRef.current) return;
        const v = videoRef.current;
        if (!v || !duration || duration <= 0) return;

        let cancelled = false;
        capturedRef.current = true;

        const captureAt = (timeSec: number): Promise<string | null> =>
            new Promise((resolve) => {
                let done = false;
                const finish = (url: string | null) => {
                    if (!done) { done = true; resolve(url); }
                };
                const onSeeked = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        const w = v.videoWidth || 160;
                        const h = v.videoHeight || 90;
                        const scale = 80 / h;
                        canvas.width = Math.max(1, Math.round(w * scale));
                        canvas.height = 80;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) return finish(null);
                        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                        finish(canvas.toDataURL('image/jpeg', 0.6));
                    } catch {
                        finish(null);
                    }
                };
                v.addEventListener('seeked', onSeeked, { once: true });
                v.currentTime = timeSec;
                setTimeout(() => finish(null), 1500);
            });

        (async () => {
            const out: string[] = [];
            // Evenly spaced timestamps, biased to the inside of the clip so the
            // first/last frames aren't black-frame intros / outros.
            for (let i = 0; i < FILMSTRIP_FRAMES; i++) {
                if (cancelled) return;
                const t = duration * (i + 0.5) / FILMSTRIP_FRAMES;
                const url = await captureAt(t);
                if (cancelled) return;
                out.push(url ?? '');
                onCaptured([...out]);
            }
        })();

        return () => { cancelled = true; };
    }, [src, duration, onCaptured]);

    return (
        <video
            ref={videoRef}
            src={src}
            className="hidden"
            crossOrigin="anonymous"
            preload="auto"
            muted
            playsInline
        />
    );
}

// ─── Helpers ────────────────────────────────────────────────

function formatTime(sec: number): string {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// ─── Spawn helper ───────────────────────────────────────────

interface SpawnInput {
    editorNodeId: string;
    parentId?: string;
    projectId: string;
    assetId: string;
    nodes: Node[];
    edges: Edge[];
    loroSync: ReturnType<typeof useOptionalLoroSyncContext>;
}

async function spawnCompletedImageDownstream({
    editorNodeId, parentId, projectId, assetId, nodes, edges, loroSync,
}: SpawnInput): Promise<void> {
    if (!loroSync?.connected) return;

    const newNodeId = await generateSemanticId(projectId);
    const editorNode = nodes.find((n) => n.id === editorNodeId);

    const tempEdge: Edge = {
        id: `temp-${editorNodeId}-${newNodeId}`,
        source: editorNodeId,
        target: newNodeId,
        type: 'default',
    };
    const tempNode: Node = {
        id: newNodeId,
        type: 'image',
        position: { x: 0, y: 0 },
        data: { label: 'Screenshot', status: 'completed', assetId },
        parentId: parentId ?? editorNode?.parentId,
    };
    const layout = autoInsertNode(newNodeId, [...nodes, tempNode], [...edges, tempEdge]);

    const finalNode = {
        id: newNodeId,
        type: 'image',
        position: layout.position,
        parentId: parentId ?? editorNode?.parentId,
        data: { label: 'Screenshot', status: 'completed', assetId },
    };
    loroSync.addNode(newNodeId, finalNode);

    const edgeId = `${editorNodeId}-${newNodeId}`;
    loroSync.addEdge(edgeId, {
        id: edgeId, source: editorNodeId, target: newNodeId, type: 'default',
    });

    if (layout.pushedNodes.size > 0) {
        layout.pushedNodes.forEach((pos, nodeId) => {
            loroSync.updateNode(nodeId, { position: pos });
        });
    }
}
