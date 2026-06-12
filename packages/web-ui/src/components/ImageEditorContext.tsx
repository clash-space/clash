/**
 * Image-editor modal — opens on double-click of an `image-editor` node.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │ Header (title + close)                       │
 *   ├────────────────────────────────────┬─────────┤
 *   │                                    │         │
 *   │      Image preview                 │ Aspect  │
 *   │      with crop rect +              │ Rotate  │
 *   │      8 resize handles +            │ Apply   │
 *   │      darken-outside +              │         │
 *   │      rule-of-thirds guides         │         │
 *   │                                    │         │
 *   └────────────────────────────────────┴─────────┘
 *
 * Apply produces a NEW image asset; the source asset is never mutated.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { useOptionalLoroSyncContext } from './LoroSyncContext';
import { useSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { generateSemanticId } from '@clash/web-ui/lib/utils/semanticId';
import { autoInsertNode } from '@clash/web-ui/lib/layout';
import { applyImageEdit } from '@clash/web-ui/lib/editPipeline';
import type { CropRect, ImageEditParams } from '@clash/shared-types';

interface OpenImageEditorInput {
    editorNodeId: string;
    projectId: string;
    sourceAssetId: string;
    sourceR2Key: string;
    naturalWidth: number;
    naturalHeight: number;
    initialParams: ImageEditParams;
    nodes: Node[];
    edges: Edge[];
    parentId?: string;
}

interface ImageEditorContextType {
    isOpen: boolean;
    openEditor: (input: OpenImageEditorInput) => void;
    closeEditor: () => void;
}

const Ctx = createContext<ImageEditorContextType | undefined>(undefined);

function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
    return (
        <div
            data-testid="image-editor-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Image editor"
            className="clash-editor-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center px-5 py-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="clash-editor-modal-surface relative h-[min(880px,calc(100vh-48px))] w-[min(1200px,calc(100vw-48px))] overflow-hidden rounded-2xl flex flex-col">
                {children}
            </div>
        </div>
    );
}

export function ImageEditorProvider({ children }: { children: ReactNode }) {
    const loroSync = useOptionalLoroSyncContext();
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState<OpenImageEditorInput | null>(null);

    const openEditor = useCallback((next: OpenImageEditorInput) => {
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
                    <ImageEditorPanel input={input} loroSync={loroSync} onClose={closeEditor} />
                </Overlay>
            )}
        </Ctx.Provider>
    );
}

export function useImageEditor() {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error('useImageEditor must be used within ImageEditorProvider');
    return ctx;
}

// ─── Aspect presets ─────────────────────────────────────────

type AspectId = 'free' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
const ASPECT_RATIOS: Record<AspectId, number | null> = {
    'free': null,
    '1:1': 1,
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '4:3': 4 / 3,
    '3:4': 3 / 4,
};
const ASPECT_OPTIONS: AspectId[] = ['free', '1:1', '16:9', '9:16', '4:3', '3:4'];

// ─── Panel ──────────────────────────────────────────────────

function ImageEditorPanel({
    input, loroSync, onClose,
}: {
    input: OpenImageEditorInput;
    loroSync: ReturnType<typeof useOptionalLoroSyncContext>;
    onClose: () => void;
}) {
    const signedUrl = useSignedUrl(input.sourceR2Key);
    const [crop, setCrop] = useState<CropRect>(
        input.initialParams.crop ?? {
            x: 0, y: 0, width: input.naturalWidth, height: input.naturalHeight,
        },
    );
    const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(input.initialParams.rotation ?? 0);
    const [aspect, setAspect] = useState<AspectId>('free');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const params: ImageEditParams = useMemo(() => {
        const isFull =
            crop.x === 0 && crop.y === 0 &&
            crop.width === input.naturalWidth && crop.height === input.naturalHeight;
        const out: ImageEditParams = {};
        if (!isFull) out.crop = crop;
        if (rotation !== 0) out.rotation = rotation;
        return out;
    }, [crop, rotation, input.naturalWidth, input.naturalHeight]);

    // When user picks a non-free aspect, reshape the current crop to match —
    // anchor on the current top-left, shrink to fit (never overflow image
    // bounds). Switching to 'free' is a no-op.
    const applyAspect = useCallback((id: AspectId) => {
        setAspect(id);
        const ratio = ASPECT_RATIOS[id];
        if (ratio == null) return;
        setCrop((c) => {
            // Try preserving width: derive height = width / ratio.
            let w = c.width;
            let h = w / ratio;
            if (c.y + h > input.naturalHeight) {
                // Doesn't fit — shrink width to fit available height.
                h = input.naturalHeight - c.y;
                w = h * ratio;
            }
            if (c.x + w > input.naturalWidth) {
                w = input.naturalWidth - c.x;
                h = w / ratio;
            }
            return {
                x: c.x,
                y: c.y,
                width: Math.max(1, Math.round(w)),
                height: Math.max(1, Math.round(h)),
            };
        });
    }, [input.naturalWidth, input.naturalHeight]);

    const handleApply = useCallback(async () => {
        setBusy(true);
        setError(null);
        try {
            if (loroSync?.connected) {
                loroSync.updateNode(input.editorNodeId, { data: { editParams: params } });
            }
            const result = await applyImageEdit({
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

    const resetCrop = useCallback(() => {
        setCrop({ x: 0, y: 0, width: input.naturalWidth, height: input.naturalHeight });
        setAspect('free');
    }, [input.naturalWidth, input.naturalHeight]);

    return (
        <>
            <div className="flex items-center justify-between px-5 py-3 border-b border-warm-border bg-warm-surface">
                <h2 className="text-base font-semibold text-slate-800">Image Editor</h2>
                <button onClick={onClose} disabled={busy}
                    className="px-3 py-1.5 text-sm text-slate-800 dark:text-slate-200 dark:text-slate-300 hover:bg-slate-100 rounded-md">
                    Cancel
                </button>
            </div>

            <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 bg-warm-muted flex items-center justify-center p-6 overflow-auto">
                    {signedUrl ? (
                        <CropEditor
                            src={signedUrl}
                            crop={crop}
                            setCrop={setCrop}
                            rotation={rotation}
                            naturalWidth={input.naturalWidth}
                            naturalHeight={input.naturalHeight}
                            aspectRatio={ASPECT_RATIOS[aspect]}
                        />
                    ) : (
                        <div className="text-slate-700 dark:text-slate-300 dark:text-slate-400">Loading…</div>
                    )}
                </div>

                <div className="w-72 border-l border-warm-border bg-warm-surface p-4 flex flex-col gap-5 overflow-y-auto">
                    <section>
                        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 dark:text-slate-300 uppercase tracking-wider mb-2">Aspect</h3>
                        <div className="grid grid-cols-3 gap-1.5">
                            {ASPECT_OPTIONS.map((id) => (
                                <button
                                    key={id}
                                    onClick={() => applyAspect(id)}
                                    className={`py-1.5 text-xs rounded-md border ${
                                        aspect === id
                                            ? 'bg-slate-900 text-white border-slate-900'
                                            : 'bg-warm-surface text-slate-800 dark:text-slate-200 border-slate-300 hover:bg-slate-50'
                                    }`}
                                >{id}</button>
                            ))}
                        </div>
                    </section>

                    <section>
                        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 dark:text-slate-300 uppercase tracking-wider mb-2">Crop (px)</h3>
                        <div className="grid grid-cols-2 gap-2">
                            {(['x', 'y', 'width', 'height'] as const).map((k) => (
                                <label key={k} className="text-xs text-slate-800 dark:text-slate-200 dark:text-slate-300 flex flex-col gap-1">
                                    <span className="capitalize">{k}</span>
                                    <input
                                        type="number"
                                        value={crop[k]}
                                        onChange={(e) => {
                                            const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                            setCrop((c) => clampCrop({ ...c, [k]: n }, input.naturalWidth, input.naturalHeight));
                                        }}
                                        className="border border-slate-300 rounded px-2 py-1 text-sm tabular-nums"
                                    />
                                </label>
                            ))}
                        </div>
                        <button
                            onClick={resetCrop}
                            className="mt-2 text-xs text-slate-800 dark:text-slate-200 dark:text-slate-300 hover:text-slate-800 underline"
                        >Reset crop</button>
                    </section>

                    <section>
                        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 dark:text-slate-300 uppercase tracking-wider mb-2">Rotation</h3>
                        <div className="flex gap-1">
                            {([0, 90, 180, 270] as const).map((d) => (
                                <button
                                    key={d}
                                    onClick={() => setRotation(d)}
                                    className={`flex-1 py-1.5 text-xs rounded-md border ${
                                        rotation === d
                                            ? 'bg-slate-900 text-white border-slate-900'
                                            : 'bg-warm-surface text-slate-800 dark:text-slate-200 border-slate-300 hover:bg-slate-50'
                                    }`}
                                >{d}°</button>
                            ))}
                        </div>
                    </section>

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
        </>
    );
}

// ─── CropEditor ─────────────────────────────────────────────

type DragKind = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DragState {
    kind: DragKind;
    /** Image-space mouse start position. */
    startX: number;
    startY: number;
    /** Crop rect at drag start — mouse delta is applied against this. */
    origin: CropRect;
}

interface CropEditorProps {
    src: string;
    crop: CropRect;
    setCrop: (c: CropRect) => void;
    rotation: 0 | 90 | 180 | 270;
    naturalWidth: number;
    naturalHeight: number;
    /** Width / height ratio. null = free. */
    aspectRatio: number | null;
}

function CropEditor({
    src, crop, setCrop, rotation, naturalWidth, naturalHeight, aspectRatio,
}: CropEditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<DragState | null>(null);

    // Display fit: the crop math is in image-natural coords, but the user
    // interacts in screen pixels. `scale` converts between them.
    const scale = useMemo(() => {
        const maxW = 760, maxH = 620;
        return Math.min(maxW / naturalWidth, maxH / naturalHeight, 1);
    }, [naturalWidth, naturalHeight]);
    const dispW = naturalWidth * scale;
    const dispH = naturalHeight * scale;

    const screenToImage = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return {
            x: (clientX - rect.left) / scale,
            y: (clientY - rect.top) / scale,
        };
    }, [scale]);

    const beginDrag = useCallback((kind: DragKind, e: React.MouseEvent) => {
        e.stopPropagation();
        const { x, y } = screenToImage(e.clientX, e.clientY);
        setDrag({ kind, startX: x, startY: y, origin: { ...crop } });
    }, [crop, screenToImage]);

    useEffect(() => {
        if (!drag) return;
        const onMove = (e: MouseEvent) => {
            const { x, y } = screenToImage(e.clientX, e.clientY);
            const dx = x - drag.startX;
            const dy = y - drag.startY;
            const next = applyDrag(drag.kind, drag.origin, dx, dy, naturalWidth, naturalHeight, aspectRatio);
            setCrop(next);
        };
        const onUp = () => setDrag(null);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [drag, screenToImage, setCrop, naturalWidth, naturalHeight, aspectRatio]);

    return (
        <div
            ref={containerRef}
            className="relative shadow-md"
            style={{
                width: dispW,
                height: dispH,
                transform: `rotate(${rotation}deg)`,
                transformOrigin: 'center',
            }}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={src}
                alt="source"
                className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                draggable={false}
            />

            {/* Darken outside the crop rect — four overlays around the rect. */}
            <DarkenMask crop={crop} scale={scale} dispW={dispW} dispH={dispH} />

            {/* Crop rectangle */}
            <div
                className="absolute border-2 border-emerald-400 cursor-move"
                style={{
                    left: crop.x * scale,
                    top: crop.y * scale,
                    width: crop.width * scale,
                    height: crop.height * scale,
                }}
                onMouseDown={(e) => beginDrag('move', e)}
            >
                {/* Rule-of-thirds guides — split the crop into a 3×3 grid. */}
                <div className="absolute inset-0 pointer-events-none">
                    {[1, 2].map((i) => (
                        <div key={`v${i}`} className="absolute top-0 bottom-0 w-px bg-white/40"
                            style={{ left: `${(i / 3) * 100}%` }} />
                    ))}
                    {[1, 2].map((i) => (
                        <div key={`h${i}`} className="absolute left-0 right-0 h-px bg-white/40"
                            style={{ top: `${(i / 3) * 100}%` }} />
                    ))}
                </div>

                {/* Corner handles — bigger hit area, drag both axes. */}
                <CornerHandle pos="nw" onMouseDown={(e) => beginDrag('nw', e)} />
                <CornerHandle pos="ne" onMouseDown={(e) => beginDrag('ne', e)} />
                <CornerHandle pos="sw" onMouseDown={(e) => beginDrag('sw', e)} />
                <CornerHandle pos="se" onMouseDown={(e) => beginDrag('se', e)} />

                {/* Edge handles — drag one axis. Disabled when aspect is locked
                    so you can't break the ratio with a single-axis move. */}
                {aspectRatio == null && (
                    <>
                        <EdgeHandle pos="n" onMouseDown={(e) => beginDrag('n', e)} />
                        <EdgeHandle pos="s" onMouseDown={(e) => beginDrag('s', e)} />
                        <EdgeHandle pos="w" onMouseDown={(e) => beginDrag('w', e)} />
                        <EdgeHandle pos="e" onMouseDown={(e) => beginDrag('e', e)} />
                    </>
                )}
            </div>

            {/* Live size readout — anchors to top-right of the crop rect. */}
            <div
                className="absolute pointer-events-none text-[10px] font-mono text-white bg-slate-900/80 rounded px-1.5 py-0.5 tabular-nums"
                style={{
                    left: (crop.x + crop.width) * scale - 60,
                    top: crop.y * scale - 18,
                }}
            >
                {crop.width} × {crop.height}
            </div>
        </div>
    );
}

function DarkenMask({ crop, scale, dispW, dispH }: { crop: CropRect; scale: number; dispW: number; dispH: number }) {
    const cx = crop.x * scale, cy = crop.y * scale;
    const cw = crop.width * scale, ch = crop.height * scale;
    const cls = 'absolute bg-slate-950/55 pointer-events-none';
    return (
        <>
            <div className={cls} style={{ left: 0, top: 0, width: dispW, height: cy }} />
            <div className={cls} style={{ left: 0, top: cy + ch, width: dispW, height: dispH - (cy + ch) }} />
            <div className={cls} style={{ left: 0, top: cy, width: cx, height: ch }} />
            <div className={cls} style={{ left: cx + cw, top: cy, width: dispW - (cx + cw), height: ch }} />
        </>
    );
}

function CornerHandle({ pos, onMouseDown }: { pos: 'nw' | 'ne' | 'sw' | 'se'; onMouseDown: (e: React.MouseEvent) => void }) {
    const cursor = pos === 'nw' || pos === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize';
    const positionStyle: React.CSSProperties = {
        ...(pos.includes('n') ? { top: -6 } : { bottom: -6 }),
        ...(pos.includes('w') ? { left: -6 } : { right: -6 }),
    };
    return (
        <div
            onMouseDown={onMouseDown}
            className={`absolute w-3 h-3 bg-warm-surface border-2 border-emerald-500 rounded-full ${cursor}`}
            style={positionStyle}
        />
    );
}

function EdgeHandle({ pos, onMouseDown }: { pos: 'n' | 's' | 'e' | 'w'; onMouseDown: (e: React.MouseEvent) => void }) {
    const horizontal = pos === 'n' || pos === 's';
    const cursor = horizontal ? 'cursor-ns-resize' : 'cursor-ew-resize';
    const style: React.CSSProperties = horizontal
        ? {
            left: '50%',
            transform: 'translate(-50%, -50%)',
            ...(pos === 'n' ? { top: 0 } : { top: '100%' }),
            width: 16, height: 6,
        }
        : {
            top: '50%',
            transform: 'translate(-50%, -50%)',
            ...(pos === 'w' ? { left: 0 } : { left: '100%' }),
            width: 6, height: 16,
        };
    return (
        <div
            onMouseDown={onMouseDown}
            className={`absolute bg-warm-surface border-2 border-emerald-500 rounded-sm ${cursor}`}
            style={style}
        />
    );
}

// ─── Drag math ──────────────────────────────────────────────

/**
 * Resolve a drag delta into a new crop rect, clamped to image bounds and
 * (optionally) respecting an aspect-ratio lock.
 *
 * Each handle owns one or two edges; we move those edges by the cursor delta
 * and recompute the rect. For corners with aspect lock, we pick whichever of
 * dx/dy is dominant to drive both dimensions, so the rect stays under the
 * cursor without jitter.
 */
function applyDrag(
    kind: DragKind,
    origin: CropRect,
    dx: number,
    dy: number,
    imgW: number,
    imgH: number,
    aspect: number | null,
): CropRect {
    let { x, y, width, height } = origin;
    const right = x + width;
    const bottom = y + height;

    if (kind === 'move') {
        x = clamp(origin.x + dx, 0, imgW - origin.width);
        y = clamp(origin.y + dy, 0, imgH - origin.height);
        return { x: Math.round(x), y: Math.round(y), width: origin.width, height: origin.height };
    }

    // Edges → single-axis resize. Aspect lock disables these handles in the
    // UI, so we don't need to reconcile the other dimension here.
    if (kind === 'n') {
        const newY = clamp(origin.y + dy, 0, bottom - 1);
        return finalize({ x, y: newY, width, height: bottom - newY }, imgW, imgH, null);
    }
    if (kind === 's') {
        const newH = clamp(origin.height + dy, 1, imgH - origin.y);
        return finalize({ x, y, width, height: newH }, imgW, imgH, null);
    }
    if (kind === 'w') {
        const newX = clamp(origin.x + dx, 0, right - 1);
        return finalize({ x: newX, y, width: right - newX, height }, imgW, imgH, null);
    }
    if (kind === 'e') {
        const newW = clamp(origin.width + dx, 1, imgW - origin.x);
        return finalize({ x, y, width: newW, height }, imgW, imgH, null);
    }

    // Corners → two-axis resize. With aspect lock, pick the dominant delta
    // and derive the other axis from it.
    let next: CropRect;
    if (aspect != null) {
        const dom = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (dom === 'x') {
            const sign = kind.includes('w') ? -1 : 1;
            const newW = Math.max(1, origin.width + sign * dx);
            const newH = newW / aspect;
            next = expandFromCorner(kind, origin, newW, newH);
        } else {
            const sign = kind.includes('n') ? -1 : 1;
            const newH = Math.max(1, origin.height + sign * dy);
            const newW = newH * aspect;
            next = expandFromCorner(kind, origin, newW, newH);
        }
    } else {
        const newX1 = kind.includes('w') ? clamp(origin.x + dx, 0, right - 1) : x;
        const newY1 = kind.includes('n') ? clamp(origin.y + dy, 0, bottom - 1) : y;
        const newX2 = kind.includes('e') ? clamp(right + dx, x + 1, imgW) : right;
        const newY2 = kind.includes('s') ? clamp(bottom + dy, y + 1, imgH) : bottom;
        next = { x: newX1, y: newY1, width: newX2 - newX1, height: newY2 - newY1 };
    }
    return finalize(next, imgW, imgH, aspect);
}

/** Re-anchor a (newW, newH) pair to whichever corner is fixed by the handle. */
function expandFromCorner(kind: DragKind, origin: CropRect, newW: number, newH: number): CropRect {
    const right = origin.x + origin.width;
    const bottom = origin.y + origin.height;
    if (kind === 'se') return { x: origin.x, y: origin.y, width: newW, height: newH };
    if (kind === 'sw') return { x: right - newW, y: origin.y, width: newW, height: newH };
    if (kind === 'ne') return { x: origin.x, y: bottom - newH, width: newW, height: newH };
    /* nw */ return { x: right - newW, y: bottom - newH, width: newW, height: newH };
}

function finalize(c: CropRect, imgW: number, imgH: number, aspect: number | null): CropRect {
    const out = clampCrop(c, imgW, imgH);
    if (aspect != null) {
        // After clamping, re-snap to aspect by shrinking (never overflow).
        const wByH = out.height * aspect;
        const hByW = out.width / aspect;
        if (wByH < out.width) out.width = Math.max(1, Math.round(wByH));
        else out.height = Math.max(1, Math.round(hByW));
    }
    return out;
}

function clampCrop(c: CropRect, imgW: number, imgH: number): CropRect {
    let { x, y, width, height } = c;
    x = clamp(x, 0, imgW - 1);
    y = clamp(y, 0, imgH - 1);
    width = clamp(width, 1, imgW - x);
    height = clamp(height, 1, imgH - y);
    return {
        x: Math.round(x), y: Math.round(y),
        width: Math.round(width), height: Math.round(height),
    };
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(Math.max(n, lo), hi);
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
        data: { label: 'Edited Image', status: 'completed', assetId },
        parentId: parentId ?? editorNode?.parentId,
    };
    const layout = autoInsertNode(newNodeId, [...nodes, tempNode], [...edges, tempEdge]);

    const finalNode = {
        id: newNodeId,
        type: 'image',
        position: layout.position,
        parentId: parentId ?? editorNode?.parentId,
        data: { label: 'Edited Image', status: 'completed', assetId },
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
