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

import React, { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { EditorModalDialog } from './EditorModalDialog';
import { useOptionalLoroSyncContext } from './LoroSyncContext';
import { generateSemanticId } from '@clash/web-ui/lib/utils/semanticId';
import { autoInsertNode } from '@clash/web-ui/lib/layout';
import { applyImageEdit, type EditApplyResult } from '../features/assets/action-client';
import type { CropRect, ImageEditParams } from '@clash/shared-types';
import { Button } from './ui/button';
import { useDragGesture } from './ui/gesture';
import { Input } from './ui/input';

export interface OpenImageEditorInput {
    editorNodeId?: string;
    projectId: string;
    sourceAssetId: string;
    sourceUrl: string;
    naturalWidth: number;
    naturalHeight: number;
    initialParams: ImageEditParams;
    nodes?: Node[];
    edges?: Edge[];
    parentId?: string;
    onApplied?: (result: EditApplyResult) => void | Promise<void>;
    origin?: 'canvas-node' | 'asset-preview';
}

interface ImageEditorContextType {
    isOpen: boolean;
    openEditor: (input: OpenImageEditorInput) => void;
    closeEditor: () => void;
}

const Ctx = createContext<ImageEditorContextType | undefined>(undefined);

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
    const contextValue = useMemo(
        () => ({ isOpen: open, openEditor, closeEditor }),
        [closeEditor, open, openEditor],
    );

    return (
        <Ctx.Provider value={contextValue}>
            {children}
            {open && input && (
                <EditorModalDialog
                    open={open}
                    onClose={closeEditor}
                    ariaLabel="Image editor"
                    panelClassName="h-[min(880px,calc(100vh-48px))] w-[min(1200px,calc(100vw-48px))] flex flex-col"
                >
                    <ImageEditorPanel input={input} loroSync={loroSync} onClose={closeEditor} />
                </EditorModalDialog>
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

export function ImageEditorPanel({
    input, loroSync, onClose,
}: {
    input: OpenImageEditorInput;
    loroSync: ReturnType<typeof useOptionalLoroSyncContext>;
    onClose: () => void;
}) {
    const signedUrl = input.sourceUrl;
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
            if (loroSync?.connected && input.editorNodeId) {
                loroSync.updateNode(input.editorNodeId, { data: { editParams: params } });
            }
            const result = await applyImageEdit({
                projectId: input.projectId,
                sourceAssetId: input.sourceAssetId,
                sourceUrl: input.sourceUrl,
                params,
                origin: input.origin,
            });
            if (input.editorNodeId && input.nodes && input.edges) {
                await spawnCompletedImageDownstream({
                    editorNodeId: input.editorNodeId,
                    parentId: input.parentId,
                    projectId: input.projectId,
                    assetId: result.assetId,
                    nodes: input.nodes,
                    edges: input.edges,
                    loroSync,
                });
            }
            await input.onApplied?.(result);
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
                <h2 className="text-base font-semibold text-content-primary">Image Editor</h2>
                <Button
                    size="sm"
                    onClick={onClose}
                    disabled={busy}
                    className="rounded-md px-3 py-1.5 text-sm text-content-secondary hover:bg-warm-muted hover:text-content-primary"
                >
                    Cancel
                </Button>
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
                        <div className="text-content-muted">Loading…</div>
                    )}
                </div>

                <div className="w-72 border-l border-warm-border bg-warm-surface p-4 flex flex-col gap-5 overflow-y-auto">
                    <section>
                        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-content-secondary">Aspect</h3>
                        <div className="grid grid-cols-3 gap-1.5">
                            {ASPECT_OPTIONS.map((id) => (
                                <Button
                                    key={id}
                                    size="sm"
                                    onClick={() => applyAspect(id)}
                                    className={`min-h-0 rounded-md px-2 py-1.5 text-xs ${
                                        aspect === id
                                            ? 'border-brand/40 bg-brand-light text-brand hover:bg-brand-light/80'
                                            : 'border-warm-border bg-warm-surface text-content-secondary hover:bg-warm-muted hover:text-content-primary'
                                    }`}
                                >{id}</Button>
                            ))}
                        </div>
                    </section>

                    <section>
                        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-content-secondary">Crop (px)</h3>
                        <div className="grid grid-cols-2 gap-2">
                            {(['x', 'y', 'width', 'height'] as const).map((k) => (
                                <label key={k} className="flex flex-col gap-1 text-xs text-content-secondary">
                                    <span className="capitalize">{k}</span>
                                    <Input
                                        type="number"
                                        value={crop[k]}
                                        onChange={(e) => {
                                            const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                            setCrop((c) => clampCrop({ ...c, [k]: n }, input.naturalWidth, input.naturalHeight));
                                        }}
                                        className="rounded border border-warm-border bg-warm-surface px-2 py-1 text-sm text-content-primary tabular-nums"
                                    />
                                </label>
                            ))}
                        </div>
                        <Button
                            size="sm"
                            onClick={resetCrop}
                            className="mt-2 min-h-0 justify-start border-transparent bg-transparent px-0 py-0 text-xs text-brand shadow-none underline hover:bg-transparent hover:text-brand/80"
                        >Reset crop</Button>
                    </section>

                    <section>
                        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-content-secondary">Rotation</h3>
                        <div className="flex gap-1">
                            {([0, 90, 180, 270] as const).map((d) => (
                                <Button
                                    key={d}
                                    size="sm"
                                    onClick={() => setRotation(d)}
                                    className={`min-h-0 flex-1 rounded-md px-2 py-1.5 text-xs ${
                                        rotation === d
                                            ? 'border-brand/40 bg-brand-light text-brand hover:bg-brand-light/80'
                                            : 'border-warm-border bg-warm-surface text-content-secondary hover:bg-warm-muted hover:text-content-primary'
                                    }`}
                                >{d}°</Button>
                            ))}
                        </div>
                    </section>

                    {error && (
                        <div className="rounded-md border border-red-500/25 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300">
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
        </>
    );
}

// ─── CropEditor ─────────────────────────────────────────────

type DragKind = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type CropDragBindProps = React.DOMAttributes<EventTarget>;

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
    const dragOriginRef = useRef<CropRect>(crop);

    // Display fit: the crop math is in image-natural coords, but the user
    // interacts in screen pixels. `scale` converts between them.
    const scale = useMemo(() => {
        const maxW = 760, maxH = 620;
        return Math.min(maxW / naturalWidth, maxH / naturalHeight, 1);
    }, [naturalWidth, naturalHeight]);
    const dispW = naturalWidth * scale;
    const dispH = naturalHeight * scale;

    const cropDragBind = useDragGesture<PointerEvent>(
        ({ first, movement: [movementX, movementY], args: [kind], event }) => {
            event.stopPropagation();
            if (first) dragOriginRef.current = { ...crop };
            const dx = movementX / scale;
            const dy = movementY / scale;
            const next = applyDrag(kind as DragKind, dragOriginRef.current, dx, dy, naturalWidth, naturalHeight, aspectRatio);
            setCrop(next);
        },
        {
            preventDefault: true,
            pointer: { capture: true },
            eventOptions: { passive: false },
        },
    );

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
                className="absolute cursor-move border-2 border-brand"
                style={{
                    left: crop.x * scale,
                    top: crop.y * scale,
                    width: crop.width * scale,
                    height: crop.height * scale,
                    touchAction: 'none',
                }}
                {...cropDragBind('move')}
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
                <CornerHandle pos="nw" dragProps={cropDragBind('nw')} />
                <CornerHandle pos="ne" dragProps={cropDragBind('ne')} />
                <CornerHandle pos="sw" dragProps={cropDragBind('sw')} />
                <CornerHandle pos="se" dragProps={cropDragBind('se')} />

                {/* Edge handles — drag one axis. Disabled when aspect is locked
                    so you can't break the ratio with a single-axis move. */}
                {aspectRatio == null && (
                    <>
                        <EdgeHandle pos="n" dragProps={cropDragBind('n')} />
                        <EdgeHandle pos="s" dragProps={cropDragBind('s')} />
                        <EdgeHandle pos="w" dragProps={cropDragBind('w')} />
                        <EdgeHandle pos="e" dragProps={cropDragBind('e')} />
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

function CornerHandle({ pos, dragProps }: { pos: 'nw' | 'ne' | 'sw' | 'se'; dragProps: CropDragBindProps }) {
    const cursor = pos === 'nw' || pos === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize';
    const positionStyle: React.CSSProperties = {
        ...(pos.includes('n') ? { top: -6 } : { bottom: -6 }),
        ...(pos.includes('w') ? { left: -6 } : { right: -6 }),
    };
    const { style: dragStyle, ...restDragProps } = dragProps as CropDragBindProps & { style?: React.CSSProperties };
    return (
        <div
            {...restDragProps}
            className={`absolute h-3 w-3 rounded-full border-2 border-brand bg-warm-surface ${cursor}`}
            style={{ ...positionStyle, ...dragStyle, touchAction: 'none' }}
        />
    );
}

function EdgeHandle({ pos, dragProps }: { pos: 'n' | 's' | 'e' | 'w'; dragProps: CropDragBindProps }) {
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
    const { style: dragStyle, ...restDragProps } = dragProps as CropDragBindProps & { style?: React.CSSProperties };
    return (
        <div
            {...restDragProps}
            className={`absolute rounded-sm border-2 border-brand bg-warm-surface ${cursor}`}
            style={{ ...style, ...dragStyle, touchAction: 'none' }}
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
