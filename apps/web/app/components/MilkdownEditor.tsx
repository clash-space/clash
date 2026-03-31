'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { nord } from '@milkdown/theme-nord';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { prism } from '@milkdown/plugin-prism';
import { trailing } from '@milkdown/plugin-trailing';
import { history } from '@milkdown/plugin-history';
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { resolveAssetUrl } from '../../lib/utils/assets';

import '@milkdown/theme-nord/style.css';
import 'prismjs/themes/prism.css';

/** A canvas node that can be @-mentioned in the prompt */
export interface MentionableNode {
    id: string;
    type: string;       // 'image' | 'video' | 'text' | etc.
    label: string;
    src?: string;        // For image/video: R2 key or URL
}

interface MilkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    /** Available nodes for @-mention */
    mentionableNodes?: MentionableNode[];
    /** Allowed modalities for @-mention filter (from model's input.promptModalities) */
    promptModalities?: string[];
    /** Node IDs already connected via edges (shown first in @-menu) */
    connectedNodeIds?: string[];
    /** Callback when a new @-mention is inserted for an unconnected node */
    onMentionAdded?: (nodeId: string) => void;
}

// ─── @-mention trigger plugin ────────────────────────────

const mentionPluginKey = new PluginKey('asset-mention-trigger');

interface MentionPluginState {
    active: boolean;
    query: string;
    from: number;  // Position of the @ character
    cursorCoords: { left: number; top: number; bottom: number } | null;
}

function createMentionPlugin(
    onStateChange: (state: MentionPluginState) => void
) {
    return $prose(() => {
        return new Plugin({
            key: mentionPluginKey,
            state: {
                init: () => ({ active: false, query: '', from: 0, cursorCoords: null } as MentionPluginState),
                apply(tr, prev, _oldState, newState) {
                    const meta = tr.getMeta(mentionPluginKey);
                    if (meta) return meta;

                    // If not active, check if user just typed @
                    if (!prev.active) {
                        if (!tr.docChanged) return prev;
                        const { $from } = newState.selection;
                        const textBefore = $from.parent.textBetween(
                            Math.max(0, $from.parentOffset - 1),
                            $from.parentOffset,
                            ''
                        );
                        if (textBefore === '@') {
                            return { active: true, query: '', from: $from.pos - 1, cursorCoords: null };
                        }
                        return prev;
                    }

                    // If active, update query or deactivate
                    const { $from } = newState.selection;
                    const pos = $from.pos;
                    if (pos <= prev.from) {
                        return { active: false, query: '', from: 0, cursorCoords: null };
                    }
                    const textAfterAt = $from.parent.textBetween(
                        prev.from - $from.start(),
                        $from.parentOffset,
                        ''
                    );

                    // Check the text starts with @ and hasn't hit a space-breaking pattern
                    if (!textAfterAt.startsWith('@')) {
                        return { active: false, query: '', from: 0, cursorCoords: null };
                    }

                    const query = textAfterAt.slice(1); // Remove the @
                    // Deactivate if query gets too long or has newlines
                    if (query.length > 50 || query.includes('\n')) {
                        return { active: false, query: '', from: 0, cursorCoords: null };
                    }

                    return { ...prev, query };
                },
            },
            view() {
                return {
                    update(view: EditorView) {
                        const state = mentionPluginKey.getState(view.state) as MentionPluginState;
                        if (state?.active) {
                            const coords = view.coordsAtPos(view.state.selection.from);
                            onStateChange({ ...state, cursorCoords: coords });
                        } else {
                            onStateChange(state);
                        }
                    },
                };
            },
        });
    });
}

// ─── Ensure starting paragraph plugin ────────────────────

const ensureStartingParagraph = $prose(() => {
    const key = new PluginKey('ensure-starting-paragraph');
    return new Plugin({
        key,
        appendTransaction: (_transactions, _oldState, newState) => {
            const { doc, schema, tr } = newState;
            if (doc.firstChild && doc.firstChild.type.name !== 'paragraph') {
                const paragraph = schema.nodes.paragraph.create();
                return tr.insert(0, paragraph);
            }
            return null;
        },
    });
});

// ─── AssetMentionMenu (floating @-menu) ──────────────────

function AssetMentionMenu({
    active,
    query,
    coords,
    nodes,
    connectedIds,
    promptModalities,
    onSelect,
    onClose,
}: {
    active: boolean;
    query: string;
    coords: { left: number; top: number; bottom: number } | null;
    nodes: MentionableNode[];
    connectedIds: Set<string>;
    promptModalities: string[];
    onSelect: (node: MentionableNode) => void;
    onClose: () => void;
}) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Filter by modalities and query
    const filtered = nodes.filter((n) => {
        // Filter by allowed modalities (map node type to modality)
        const modality = n.type === 'image' ? 'image' : n.type === 'video' ? 'video' : n.type === 'audio' ? 'audio' : 'text';
        if (!promptModalities.includes(modality)) return false;
        // Filter by search query
        if (query && !n.label.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
    });

    // Sort: connected first, then others
    const connected = filtered.filter((n) => connectedIds.has(n.id));
    const other = filtered.filter((n) => !connectedIds.has(n.id));
    const sorted = [...connected, ...other];
    const hasConnected = connected.length > 0 && other.length > 0;

    useEffect(() => { setSelectedIndex(0); }, [query]);

    useEffect(() => {
        if (!active) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, sorted.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && sorted[selectedIndex]) { e.preventDefault(); onSelect(sorted[selectedIndex]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [active, sorted, selectedIndex, onSelect, onClose]);

    if (!active || !coords || sorted.length === 0) return null;

    const typeIcon = (type: string) => {
        if (type === 'image') return '🖼';
        if (type === 'video') return '🎬';
        if (type === 'audio') return '🔊';
        return '📝';
    };

    return (
        <div
            className="fixed z-[9999] w-64 max-h-60 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-lg"
            style={{ left: coords.left, top: coords.bottom + 4 }}
        >
            {sorted.map((node, i) => {
                const showSeparator = hasConnected && i === connected.length;
                return (
                    <div key={node.id}>
                        {showSeparator && (
                            <div className="px-3 py-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider bg-gray-50 border-t border-slate-100">
                                Other assets
                            </div>
                        )}
                        <button
                            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                                i === selectedIndex ? 'bg-gray-100' : 'hover:bg-gray-50'
                            }`}
                            onMouseDown={(e) => { e.preventDefault(); onSelect(node); }}
                            onMouseEnter={() => setSelectedIndex(i)}
                        >
                            {node.type === 'image' && node.src ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                    src={resolveAssetUrl(node.src)}
                                    alt=""
                                    className="w-6 h-6 rounded object-cover border border-slate-200 flex-shrink-0"
                                />
                            ) : (
                                <span className="w-6 h-6 flex items-center justify-center text-sm flex-shrink-0">
                                    {typeIcon(node.type)}
                                </span>
                            )}
                            <span className="text-sm text-gray-700 truncate">{node.label}</span>
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Main Editor Component ───────────────────────────────

function MilkdownEditorInner({
    value,
    onChange,
    mentionableNodes = [],
    promptModalities = ['text'],
    connectedNodeIds = [],
    onMentionAdded,
}: MilkdownEditorProps) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [mentionState, setMentionState] = useState<MentionPluginState>({
        active: false, query: '', from: 0, cursorCoords: null,
    });
    const editorViewRef = useRef<EditorView | null>(null);

    const connectedSet = new Set(connectedNodeIds);

    // Only show @-menu if modalities include non-text types
    const showMentions = promptModalities.some((m) => m !== 'text');

    const mentionPlugin = useCallback(() => {
        if (!showMentions) {
            // Return a no-op plugin if @-mentions not enabled
            return $prose(() => new Plugin({ key: new PluginKey('mention-noop') }));
        }
        return createMentionPlugin(setMentionState);
    }, [showMentions]);

    const { get } = useEditor((root) =>
        Editor.make()
            .config((ctx) => {
                ctx.set(rootCtx, root);
                ctx.set(defaultValueCtx, value);
            })
            .config(nord)
            .use(commonmark)
            .use(listener)
            .use(prism)
            .use(history)
            .use(trailing)
            .use(ensureStartingParagraph)
            .use(mentionPlugin())
            .config((ctx) => {
                ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
                    onChange(markdown);
                });
            })
    );

    // Capture EditorView reference
    useEffect(() => {
        const editor = get();
        if (editor) {
            // Access the ProseMirror view from the Milkdown editor
            try {
                const ctx = (editor as any).ctx;
                if (ctx) {
                    const { editorViewCtx } = require('@milkdown/core');
                    editorViewRef.current = ctx.get(editorViewCtx);
                }
            } catch {
                // EditorView not yet available
            }
        }
    }, [get]);

    const handleMentionSelect = useCallback((node: MentionableNode) => {
        const view = editorViewRef.current;
        if (!view) return;

        const state = mentionPluginKey.getState(view.state) as MentionPluginState;
        if (!state?.active) return;

        // Replace @query with @[Label](node:id) markdown syntax
        const mentionText = `@[${node.label}](node:${node.id}) `;
        const { from } = state;
        const to = view.state.selection.from;

        const tr = view.state.tr.replaceWith(
            from,
            to,
            view.state.schema.text(mentionText)
        );

        // Deactivate mention
        tr.setMeta(mentionPluginKey, { active: false, query: '', from: 0, cursorCoords: null });
        view.dispatch(tr);
        view.focus();

        // Auto-connect if not already connected
        if (!connectedSet.has(node.id) && onMentionAdded) {
            onMentionAdded(node.id);
        }
    }, [connectedSet, onMentionAdded]);

    const handleMentionClose = useCallback(() => {
        const view = editorViewRef.current;
        if (!view) return;
        const tr = view.state.tr.setMeta(mentionPluginKey, {
            active: false, query: '', from: 0, cursorCoords: null,
        });
        view.dispatch(tr);
    }, []);

    const handleClick = () => {
        const editorElement = wrapperRef.current?.querySelector('.ProseMirror') as HTMLElement;
        if (editorElement) {
            editorElement.focus();
        }
    };

    return (
        <>
            <div
                ref={wrapperRef}
                className="milkdown-editor-wrapper px-12 pb-8"
                onClick={handleClick}
            >
                <Milkdown />
            </div>
            {showMentions && (
                <AssetMentionMenu
                    active={mentionState.active}
                    query={mentionState.query}
                    coords={mentionState.cursorCoords}
                    nodes={mentionableNodes}
                    connectedIds={connectedSet}
                    promptModalities={promptModalities}
                    onSelect={handleMentionSelect}
                    onClose={handleMentionClose}
                />
            )}
        </>
    );
}

export default function MilkdownEditor(props: MilkdownEditorProps) {
    return (
        <MilkdownProvider>
            <MilkdownEditorInner {...props} />
        </MilkdownProvider>
    );
}
