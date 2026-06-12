
import { useRef, useCallback, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
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
import { SignedImg } from './SignedMedia';
import { getSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';

import '@milkdown/theme-nord/style.css';
import 'prismjs/themes/prism.css';

/** A canvas node that can be #-attached to the prompt */
export interface MentionableNode {
    id: string;
    type: string;       // 'image' | 'video' | 'text' | etc.
    label: string;
    /** R2 key or URL of an image to render inline as the chip thumbnail.
     *  For image nodes: the image itself. For video nodes: the persisted cover frame.
     *  Absent → falls back to a text mention. */
    thumbnail?: string;
}

export interface MilkdownEditorHandle {
    /** Insert markdown at the current cursor position. Images (![alt](url)) are rendered inline. */
    insertAtCursor: (markdown: string) => void;
    /** Clear all editor content */
    clear: () => void;
}

interface MilkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    /** Called when user presses Enter (without Shift). If provided, Enter submits instead of inserting a newline. */
    onSubmit?: () => void;
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

/**
 * Trigger character for the unified mention picker.
 *
 * `@` opens a single picker over BOTH crew members and canvas nodes
 * (GroupChatPanel concatenates `invitedCrew` into `mentionableNodes`
 * before passing them in). Every selection is inserted as
 * `@[label](node:<id>)`. The submit handler then re-partitions:
 * if `<id>` matches an invited crew id it dispatches via the
 * room-mention path, otherwise it's a canvas-asset attachment.
 *
 * Keeping a single trigger avoids the "what's the right key?"
 * cognitive overhead — users always type `@` and let the picker
 * disambiguate.
 */
const MENTION_TRIGGER = '@';

interface MentionPluginState {
    active: boolean;
    query: string;
    from: number;  // Position of the trigger character (#)
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

                    // If not active, check if user just typed the trigger.
                    if (!prev.active) {
                        if (!tr.docChanged) return prev;
                        const { $from } = newState.selection;
                        const textBefore = $from.parent.textBetween(
                            Math.max(0, $from.parentOffset - 1),
                            $from.parentOffset,
                            ''
                        );
                        if (textBefore === MENTION_TRIGGER) {
                            return { active: true, query: '', from: $from.pos - 1, cursorCoords: null };
                        }
                        return prev;
                    }

                    // If active, update query or deactivate.
                    const { $from } = newState.selection;
                    const pos = $from.pos;
                    if (pos <= prev.from) {
                        return { active: false, query: '', from: 0, cursorCoords: null };
                    }
                    const textAfterTrigger = $from.parent.textBetween(
                        prev.from - $from.start(),
                        $from.parentOffset,
                        ''
                    );

                    // Bail out if the trigger char got deleted or the query
                    // wandered onto a new line / grew too long.
                    if (!textAfterTrigger.startsWith(MENTION_TRIGGER)) {
                        return { active: false, query: '', from: 0, cursorCoords: null };
                    }

                    const query = textAfterTrigger.slice(1);
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

    // Filter by modalities and query. Crew bypass the modality filter
    // — they aren't an "asset modality" and the user always wants to
    // be able to @-address an invited crew member regardless of what
    // the surrounding action expects as input.
    const filtered = nodes.filter((n) => {
        if (n.type !== 'crew') {
            const modality = n.type === 'image' ? 'image' : n.type === 'video' ? 'video' : n.type === 'audio' ? 'audio' : 'text';
            if (!promptModalities.includes(modality)) return false;
        }
        if (query && !n.label.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
    });

    // Group: crew first (always at the top — they're who you usually
    // want to talk to), then assets ordered by connected → other.
    const crewEntries = filtered.filter((n) => n.type === 'crew');
    const assetEntries = filtered.filter((n) => n.type !== 'crew');
    const connectedAssets = assetEntries.filter((n) => connectedIds.has(n.id));
    const otherAssets = assetEntries.filter((n) => !connectedIds.has(n.id));
    const sortedAssets = [...connectedAssets, ...otherAssets];
    const sorted = [...crewEntries, ...sortedAssets];

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

    const initialsOf = (label: string): string => {
        const words = label.split(/\s+/).filter(Boolean);
        if (words.length === 0) return '?';
        if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
        return (words[0][0] + words[1][0]).toUpperCase();
    };

    const renderRow = (node: MentionableNode, i: number) => (
        <button
            key={node.id}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                i === selectedIndex ? 'bg-warm-muted' : 'hover:bg-warm-muted/70'
            }`}
            onMouseDown={(e) => { e.preventDefault(); onSelect(node); }}
            onMouseEnter={() => setSelectedIndex(i)}
        >
            {node.type === 'crew' ? (
                <span
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-brand-light text-[10px] font-bold text-slate-950 ring-1 ring-brand/20 dark:bg-brand/20 dark:text-slate-50"
                    aria-hidden="true"
                >
                    {initialsOf(node.label)}
                </span>
            ) : node.thumbnail ? (
                <SignedImg
                    src={node.thumbnail}
                    alt=""
                    className="w-6 h-6 rounded object-cover border border-warm-border flex-shrink-0"
                />
            ) : (
                <span className="w-6 h-6 flex items-center justify-center text-sm flex-shrink-0">
                    {typeIcon(node.type)}
                </span>
            )}
            <span className="text-sm text-slate-800 dark:text-slate-100 truncate flex-1">{node.label}</span>
            {node.type === 'crew' && (
                <span className="text-[9px] uppercase tracking-wider text-stone-700 dark:text-stone-300 font-medium">
                    Crew
                </span>
            )}
        </button>
    );

    return (
        <div
            className="fixed z-[9999] w-64 max-h-60 overflow-y-auto bg-warm-surface rounded-xl border border-warm-border shadow-lg"
            style={{ left: coords.left, bottom: window.innerHeight - coords.top + 4 }}
        >
            {crewEntries.length > 0 && (
                <div className="px-3 py-1 text-[10px] font-medium text-stone-600 dark:text-stone-300 uppercase tracking-wider bg-warm-muted border-b border-warm-border">
                    Crew
                </div>
            )}
            {crewEntries.map((node, j) => renderRow(node, j))}
            {sortedAssets.length > 0 && (
                <div className={`px-3 py-1 text-[10px] font-medium text-stone-600 dark:text-stone-300 uppercase tracking-wider bg-warm-muted ${crewEntries.length > 0 ? 'border-t border-warm-border' : ''}`}>
                    Canvas
                </div>
            )}
            {sortedAssets.map((node, j) => renderRow(node, crewEntries.length + j))}
        </div>
    );
}

// ─── Main Editor Component ───────────────────────────────

const MilkdownEditorInner = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(function MilkdownEditorInner({
    value,
    onChange,
    onSubmit,
    mentionableNodes = [],
    promptModalities = ['text'],
    connectedNodeIds = [],
    onMentionAdded,
}, ref) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [mentionState, setMentionState] = useState<MentionPluginState>({
        active: false, query: '', from: 0, cursorCoords: null,
    });
    const editorViewRef = useRef<EditorView | null>(null);

    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;

    const connectedSet = new Set(connectedNodeIds);

    // Only show @-menu if modalities include non-text types
    const showMentions = promptModalities.some((m) => m !== 'text');

    // Enter to submit, Shift+Enter for newline
    const enterKeyPlugin = useCallback(() => {
        return $prose(() => new Plugin({
            key: new PluginKey('enter-submit'),
            props: {
                handleKeyDown(view, event) {
                    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                        // Don't intercept if @-mention menu is active
                        const mentionActive = mentionPluginKey.getState(view.state) as MentionPluginState | undefined;
                        if (mentionActive?.active) return false;

                        if (onSubmitRef.current) {
                            event.preventDefault();
                            onSubmitRef.current();
                            return true;
                        }
                    }
                    return false;
                },
            },
        }));
    }, []);

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
            .use(captureViewPlugin())
            .use(enterKeyPlugin())
            .use(mentionPlugin())
            .config((ctx) => {
                ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
                    onChange(markdown);
                });
            })
    );

    // Capture EditorView via a plugin (more reliable than ctx.get)
    const captureViewPlugin = useCallback(() => {
        return $prose(() => new Plugin({
            key: new PluginKey('capture-view'),
            view(view) {
                editorViewRef.current = view;
                return {};
            },
        }));
    }, []);

    useImperativeHandle(ref, () => ({
        clear() {
            const view = editorViewRef.current;
            if (!view) return;
            const { tr } = view.state;
            tr.delete(0, view.state.doc.content.size);
            view.dispatch(tr);
        },
        insertAtCursor(markdown: string) {
            const view = editorViewRef.current;
            console.log('[MilkdownEditor] insertAtCursor, view:', !!view);
            if (!view) return;

            const imgMatch = markdown.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
            console.log('[MilkdownEditor] imgMatch:', !!imgMatch, 'schema nodes:', Object.keys(view.state.schema.nodes));
            if (imgMatch) {
                const [, alt, src] = imgMatch;
                const imageType = view.state.schema.nodes.image;
                console.log('[MilkdownEditor] imageType:', !!imageType);
                if (imageType) {
                    const imageNode = imageType.create({ src, alt });
                    const { from } = view.state.selection;
                    const tr = view.state.tr.insert(from, imageNode);
                    view.dispatch(tr);
                    view.focus();
                    return;
                }
            }

            // Fallback: insert as plain text
            const { from } = view.state.selection;
            const tr = view.state.tr.insertText(markdown, from);
            view.dispatch(tr);
            view.focus();
        },
    }), []);

    const handleMentionSelect = useCallback(async (node: MentionableNode) => {
        const view = editorViewRef.current;
        if (!view) return;

        const state = mentionPluginKey.getState(view.state) as MentionPluginState;
        if (!state?.active) return;

        const { from } = state;
        const to = view.state.selection.from;

        // Inline-image mention path. Uses node.thumbnail (image's own src OR video's cover).
        // The alt encodes mention info: "mention:nodeId:label" for parsing by parsePromptParts.
        // Without a thumbnail, falls through to the text mention path — never put an mp4 src
        // into <img> (renders as broken icon).
        if (node.thumbnail) {
            const signedUrl = await getSignedUrl(node.thumbnail);
            const imageType = view.state.schema.nodes.image;
            if (imageType) {
                const imgNode = imageType.create({
                    src: signedUrl,
                    alt: `mention:${node.id}:${node.label}`,
                    title: node.label,
                });
                const tr = view.state.tr.replaceWith(from, to, imgNode);
                tr.setMeta(mentionPluginKey, { active: false, query: '', from: 0, cursorCoords: null });
                view.dispatch(tr);
                view.focus();
            }
        } else {
            // Non-image entries (crew, plain text nodes, etc.): insert as
            // a real link mark, not raw text. If we plug the literal
            // string `@[label](node:id)` straight into a Text node,
            // Milkdown's CommonMark serializer escapes the brackets
            // (→ `@\[label\](node:id)`) to keep them inert on re-parse —
            // which then breaks the submit-time regex that partitions
            // crew vs canvas mentions (`/@\[[^\]]*\]\(node:([^)]+)\)/`).
            // Building it as an `@` text node + a link-marked label +
            // trailing space round-trips through the serializer as
            // exactly `@[label](node:id) `, matches the regex, and the
            // crew gets routed correctly.
            const schema = view.state.schema;
            const linkMark = schema.marks.link;
            // IMPORTANT: do NOT set a `title` on the link mark. Milkdown's
            // CommonMark serializer would emit it as
            // `[label](node:<id> "title")` — and downstream regexes
            // (`/@\[[^\]]*\]\(node:([^)]+)\)/`) then capture
            // `<id> "title"` as the id, which fails the
            // invitedCrewIdSet membership check and silently drops
            // the @-mention from the dispatched crewMentions array.
            // The label itself already serves as the human-readable
            // text; the title attribute brought no value.
            const labelText = linkMark
                ? schema.text(node.label, [linkMark.create({ href: `node:${node.id}` })])
                : schema.text(`[${node.label}](node:${node.id})`);
            const tr = view.state.tr.replaceWith(from, to, [
                schema.text('@'),
                labelText,
                schema.text(' '),
            ]);
            tr.setMeta(mentionPluginKey, { active: false, query: '', from: 0, cursorCoords: null });
            view.dispatch(tr);
            view.focus();
        }

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

    // Compute menu position based on wrapper element
    const menuCoords = (() => {
        if (!mentionState.active || !wrapperRef.current) return mentionState.cursorCoords;
        const rect = wrapperRef.current.getBoundingClientRect();
        return { left: rect.left, top: rect.top, bottom: rect.bottom };
    })();

    return (
        <>
            <div
                ref={wrapperRef}
                className="milkdown-editor-wrapper px-3 py-2"
                onClick={handleClick}
            >
                <Milkdown />
            </div>
            {showMentions && typeof document !== 'undefined' && createPortal(
                <AssetMentionMenu
                    active={mentionState.active}
                    query={mentionState.query}
                    coords={menuCoords}
                    nodes={mentionableNodes}
                    connectedIds={connectedSet}
                    promptModalities={promptModalities}
                    onSelect={handleMentionSelect}
                    onClose={handleMentionClose}
                />,
                document.body
            )}
        </>
    );
});

const MilkdownEditor = forwardRef<MilkdownEditorHandle, MilkdownEditorProps>(function MilkdownEditor(props, ref) {
    return (
        <MilkdownProvider>
            <MilkdownEditorInner ref={ref} {...props} />
        </MilkdownProvider>
    );
});

export default MilkdownEditor;
