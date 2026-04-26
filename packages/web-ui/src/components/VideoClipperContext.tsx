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
import { useOptionalLoroSyncContext } from './LoroSyncContext';
import { useSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { generateSemanticId } from '@clash/web-ui/lib/utils/semanticId';
import { autoInsertNode } from '@clash/web-ui/lib/layout';
import { applyVideoScreenshot } from '@clash/web-ui/lib/editPipeline';
import type { VideoClipParams } from '@clash/shared-types';

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

function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
    return (
        <div
            data-testid="video-clipper-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Video clipper"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/30 px-5 py-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="relative h-[min(820px,calc(100vh-48px))] w-[min(1200px,calc(100vw-48px))] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-950/10 flex flex-col">
                {children}
            </div>
        </div>
    );
}

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
                <Overlay onClose={closeEditor}>
                    <VideoClipperPanel input={input} loroSync={loroSync} onClose={closeEditor} />
                </Overlay>
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
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white">
                <h2 className="text-base font-semibold text-slate-800">Video Clipper</h2>
                <button onClick={onClose} disabled={busy}
                    className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-md">
                    Cancel
                </button>
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
                        <div className="text-slate-400">Loading…</div>
                    )}
                </div>

                <div className="w-72 border-l border-slate-200 bg-white p-4 flex flex-col gap-4 overflow-y-auto">
                    <section>
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Mode</h3>
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
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                Time
                            </h3>
                            <div className="text-2xl font-mono text-slate-800 tabular-nums">
                                {formatTime(frameTimeSec)}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">
                                of {formatTime(duration)}
                            </div>
                        </section>
                    ) : (
                        <section>
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                Range
                            </h3>
                            <div className="grid grid-cols-2 gap-3">
                                <RangeReadout label="Start" value={startSec} />
                                <RangeReadout label="End" value={endSec} />
                            </div>
                            <div className="text-[11px] text-slate-500 mt-2 tabular-nums">
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
                        <button onClick={handleApply} disabled={busy}
                            className="w-full px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-md hover:bg-slate-700 disabled:opacity-50">
                            {busy ? 'Applying…' : 'Apply'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
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
        <button onClick={onClick}
            className={`flex-1 py-1.5 text-xs rounded-md border ${
                active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}>
            {children}
        </button>
    );
}

function RangeReadout({ label, value }: { label: string; value: number }) {
    return (
        <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
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
    const trackRef = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<null | 'playhead' | 'start' | 'end' | 'range'>(null);
    const dragOffsetRef = useRef<number>(0);

    const pctOf = useCallback((sec: number) => {
        if (duration <= 0) return 0;
        return Math.max(0, Math.min(100, (sec / duration) * 100));
    }, [duration]);

    const secFromClientX = useCallback((clientX: number): number => {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return 0;
        const ratio = (clientX - rect.left) / rect.width;
        return Math.max(0, Math.min(duration, ratio * duration));
    }, [duration]);

    // Click anywhere on the empty track → seek (screenshot) / nothing (crop:
    // the range stays put, only handle drags move it).
    const onTrackMouseDown = useCallback((e: React.MouseEvent) => {
        // If clicking on a draggable element, its own mousedown handles it.
        const target = e.target as HTMLElement;
        if (target.dataset.handle) return;
        const sec = secFromClientX(e.clientX);
        if (mode === 'screenshot') {
            setFrameTimeSec(sec);
            setDrag('playhead');
        } else {
            // In crop mode, decide which handle is closer and start dragging it.
            // A click between the handles inside the range moves the entire
            // range; outside, it snaps the nearer handle.
            if (sec >= startSec && sec <= endSec) {
                dragOffsetRef.current = sec - startSec;
                setDrag('range');
            } else {
                const closer = Math.abs(sec - startSec) < Math.abs(sec - endSec) ? 'start' : 'end';
                if (closer === 'start') setStartSec(sec);
                else setEndSec(sec);
                setDrag(closer);
            }
        }
    }, [mode, startSec, endSec, secFromClientX, setFrameTimeSec, setStartSec, setEndSec]);

    useEffect(() => {
        if (!drag) return;
        const onMove = (e: MouseEvent) => {
            const sec = secFromClientX(e.clientX);
            if (drag === 'playhead') {
                setFrameTimeSec(sec);
            } else if (drag === 'start') {
                // Don't let start cross end — leave at least 0.05s of crop length
                // so the value object remains meaningful.
                setStartSec(Math.min(sec, endSec - 0.05));
            } else if (drag === 'end') {
                setEndSec(Math.max(sec, startSec + 0.05));
            } else if (drag === 'range') {
                const length = endSec - startSec;
                const newStart = Math.max(0, Math.min(duration - length, sec - dragOffsetRef.current));
                setStartSec(newStart);
                setEndSec(newStart + length);
            }
        };
        const onUp = () => setDrag(null);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [drag, secFromClientX, setFrameTimeSec, setStartSec, setEndSec, startSec, endSec, duration]);

    return (
        <div className="select-none">
            {/* Track */}
            <div
                ref={trackRef}
                onMouseDown={onTrackMouseDown}
                className="relative h-16 rounded-md bg-slate-200 overflow-hidden cursor-pointer"
                role="slider"
                aria-label="Video timeline"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={mode === 'screenshot' ? frameTimeSec : startSec}
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

                {/* Crop range overlay */}
                {mode === 'crop' && (
                    <>
                        {/* Outside-of-range dimmer (left of start) */}
                        <div
                            className="absolute top-0 bottom-0 left-0 bg-slate-900/55 pointer-events-none"
                            style={{ width: `${pctOf(startSec)}%` }}
                        />
                        {/* Outside-of-range dimmer (right of end) */}
                        <div
                            className="absolute top-0 bottom-0 right-0 bg-slate-900/55 pointer-events-none"
                            style={{ width: `${100 - pctOf(endSec)}%` }}
                        />
                        {/* Selection box outline */}
                        <div
                            className="absolute top-0 bottom-0 border-y-2 border-purple-500 pointer-events-none"
                            style={{ left: `${pctOf(startSec)}%`, right: `${100 - pctOf(endSec)}%` }}
                        />
                        {/* Start handle */}
                        <Handle
                            position={pctOf(startSec)}
                            color="purple"
                            data-handle="start"
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                setDrag('start');
                            }}
                        />
                        {/* End handle */}
                        <Handle
                            position={pctOf(endSec)}
                            color="purple"
                            data-handle="end"
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                setDrag('end');
                            }}
                        />
                    </>
                )}

                {/* Screenshot playhead */}
                {mode === 'screenshot' && (
                    <Handle
                        position={pctOf(frameTimeSec)}
                        color="blue"
                        data-handle="playhead"
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            setDrag('playhead');
                        }}
                    />
                )}
            </div>

            {/* Time ruler */}
            <div className="relative h-4 mt-1 text-[10px] font-mono text-slate-500 tabular-nums">
                <span className="absolute left-0">0:00</span>
                <span className="absolute left-1/4 -translate-x-1/2">{formatTime(duration * 0.25)}</span>
                <span className="absolute left-1/2 -translate-x-1/2">{formatTime(duration * 0.5)}</span>
                <span className="absolute left-3/4 -translate-x-1/2">{formatTime(duration * 0.75)}</span>
                <span className="absolute right-0">{formatTime(duration)}</span>
            </div>
        </div>
    );
}

interface HandleProps {
    position: number;
    color: 'blue' | 'purple';
    'data-handle': string;
    onMouseDown: (e: React.MouseEvent) => void;
}

function Handle({ position, color, onMouseDown, ...rest }: HandleProps) {
    const colorClass = color === 'blue'
        ? 'bg-blue-500 ring-blue-300'
        : 'bg-purple-500 ring-purple-300';
    return (
        <div
            {...rest}
            onMouseDown={onMouseDown}
            className={`absolute top-0 bottom-0 w-[3px] cursor-col-resize ${colorClass.split(' ')[0]} hover:scale-x-[2] transition-transform`}
            style={{ left: `${position}%`, transform: `translateX(-50%)` }}
        >
            {/* Bigger hit-target circle on top */}
            <div className={`absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full ${colorClass.split(' ')[0]} ring-2 ${colorClass.split(' ')[1]} ring-opacity-50`} />
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
