
import { useRef, useCallback, useState, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { nord } from '@milkdown/theme-nord';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { prism } from '@milkdown/plugin-prism';
import { trailing } from '@milkdown/plugin-trailing';
import { history } from '@milkdown/plugin-history';
import { $prose, replaceAll } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { SignedImg } from './SignedMedia';
import { getSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { ComboboxItem, ComboboxList, ComboboxProvider, useComboboxStore } from './ui/combobox';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover';
import { handleMentionComboboxKeyDown } from './mentionComboboxKeyboard';
import {
    FilmStrip,
    Image as ImageIcon,
    Lightning,
    Robot,
    SpeakerHigh,
    SquaresFour,
    TextT,
} from '@phosphor-icons/react';
import type { CopilotMentionKind, CopilotMentionScope } from '@clash/web-ui/lib/copilotWorkspaceContext';

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
    kind?: CopilotMentionKind;
    scope?: CopilotMentionScope;
    description?: string;
    canvasId?: string;
    canvasName?: string;
}

export interface MilkdownEditorHandle {
    /** Move focus into the editor. */
    focus: () => void;
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
 * `@` opens a single picker over BOTH agent members and canvas nodes
 * (GroupChatPanel concatenates `invitedAgent` into `mentionableNodes`
 * before passing them in). Every selection is inserted as
 * `@[label](node:<id>)`. The submit handler then re-partitions:
 * if `<id>` matches an invited agent id it dispatches via the
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

const mentionValue = (node: MentionableNode) => `${node.kind ?? 'node'}:${node.id}`;
const mentionItemId = (node: MentionableNode) => `milkdown-mention-${mentionValue(node).replace(/[^a-zA-Z0-9_-]/g, '_')}`;

function createMentionPlugin(
    onStateChange: (state: MentionPluginState) => void,
    onKeyDown: (event: KeyboardEvent) => boolean
) {
    return $prose(() => {
        return new Plugin({
            key: mentionPluginKey,
            props: {
                handleKeyDown(_view, event) {
                    return onKeyDown(event);
                },
            },
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

function activateMentionAtCursor(view: EditorView): boolean {
    const { $from } = view.state.selection;
    if (!$from.parent.isTextblock) return false;

    const startOffset = Math.max(0, $from.parentOffset - 51);
    const textBefore = $from.parent.textBetween(startOffset, $from.parentOffset, '');
    const match = textBefore.match(/(?:^|\s)@([^\s@]{0,50})$/);
    if (!match) return false;

    const query = match[1] ?? '';
    const from = $from.pos - query.length - 1;
    view.dispatch(view.state.tr.setMeta(mentionPluginKey, {
        active: true,
        query,
        from,
        cursorCoords: null,
    } satisfies MentionPluginState));
    return true;
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
    onKeyboardHandlerChange,
}: {
    active: boolean;
    query: string;
    coords: { left: number; top: number; bottom: number } | null;
    nodes: MentionableNode[];
    connectedIds: Set<string>;
    promptModalities: string[];
    onSelect: (node: MentionableNode) => void;
    onClose: () => void;
    onKeyboardHandlerChange: (handler: ((event: KeyboardEvent) => boolean) | null) => void;
}) {
    // Media respects the selected model's input modalities. Workspace
    // objects (actions, text/context nodes, timelines, agents) are always
    // referenceable because mentioning them does not upload their payload.
    const filtered = useMemo(() => nodes.filter((n) => {
        if (['image', 'video', 'audio'].includes(n.type)) {
            if (!promptModalities.includes(n.type)) return false;
        }
        const searchable = `${n.label} ${n.description ?? ''} ${n.type}`.toLowerCase();
        if (query && !searchable.includes(query.toLowerCase())) return false;
        return true;
    }), [nodes, promptModalities, query]);

    const sections = useMemo(() => {
        const definitions: Array<{ scope: CopilotMentionScope; label: string }> = [
            { scope: 'agents', label: 'Agents' },
            { scope: 'current-surface', label: 'Current surface' },
            { scope: 'current-canvas', label: 'Current canvas' },
            { scope: 'project-assets', label: 'Project assets' },
            { scope: 'timelines', label: 'Timelines' },
            { scope: 'other-canvases', label: 'Other canvases' },
        ];
        return definitions.flatMap((definition) => {
            const entries = filtered
                .filter((node) => (node.scope ?? (node.type === 'agent' ? 'agents' : 'current-canvas')) === definition.scope)
                .sort((left, right) => Number(connectedIds.has(right.id)) - Number(connectedIds.has(left.id)));
            return entries.length > 0 ? [{ ...definition, entries }] : [];
        });
    }, [connectedIds, filtered]);
    const sorted = useMemo(() => sections.flatMap((section) => section.entries), [sections]);

    const open = active && !!coords && sorted.length > 0;

    const combobox = useComboboxStore({
        value: query,
        setValue: () => undefined,
        selectedValue: '',
        setSelectedValue(value) {
            if (typeof value !== 'string') return;
            const node = sorted.find((candidate) => mentionValue(candidate) === value);
            if (node) onSelect(node);
        },
        focusLoop: true,
        focusWrap: true,
        orientation: 'vertical',
    });

    useEffect(() => {
        if (!open) {
            onKeyboardHandlerChange(null);
            return;
        }

        const firstItemId = sorted[0] ? mentionItemId(sorted[0]) : undefined;
        combobox.setActiveId(firstItemId);

        onKeyboardHandlerChange((event) => handleMentionComboboxKeyDown(event, {
            store: combobox,
            items: sorted,
            getItemId: (node) => mentionItemId(node),
            onSelect,
            onClose,
        }));

        return () => onKeyboardHandlerChange(null);
    }, [combobox, onClose, onKeyboardHandlerChange, onSelect, open, sorted]);

    if (!open || !coords) return null;

    const initialsOf = (label: string): string => {
        const words = label.split(/\s+/).filter(Boolean);
        if (words.length === 0) return '?';
        if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
        return (words[0][0] + words[1][0]).toUpperCase();
    };

    const typeIcon = (node: MentionableNode) => {
        const iconClass = 'h-4 w-4';
        if (node.kind === 'agent' || node.type === 'agent') return <Robot className={iconClass} weight="bold" />;
        if (node.kind === 'timeline' || node.type === 'timeline') return <FilmStrip className={iconClass} weight="bold" />;
        if (node.type === 'image') return <ImageIcon className={iconClass} weight="bold" />;
        if (node.type === 'video') return <FilmStrip className={iconClass} weight="bold" />;
        if (node.type === 'audio') return <SpeakerHigh className={iconClass} weight="bold" />;
        if (node.type === 'action' || node.type.toLowerCase().includes('action')) return <Lightning className={iconClass} weight="fill" />;
        if (node.type === 'group') return <SquaresFour className={iconClass} weight="bold" />;
        return <TextT className={iconClass} weight="bold" />;
    };

    const renderRow = (node: MentionableNode) => (
        <ComboboxItem
            id={mentionItemId(node)}
            key={mentionValue(node)}
            value={mentionValue(node)}
            focusOnHover
            hideOnClick={false}
            setValueOnClick={false}
            className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-warm-muted/80 data-[active-item]:bg-warm-muted focus-visible:bg-warm-muted"
        >
            {node.type === 'agent' ? (
                <span
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-brand/20 bg-brand-light text-[11px] font-bold text-slate-950 dark:bg-brand/20 dark:text-slate-50"
                    aria-hidden="true"
                >
                    {initialsOf(node.label)}
                </span>
            ) : node.thumbnail ? (
                <SignedImg
                    src={node.thumbnail}
                    alt=""
                    className="h-9 w-9 flex-shrink-0 rounded-xl border border-warm-border object-cover"
                />
            ) : (
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-warm-border bg-warm-page text-stone-600 group-data-[active-item]:border-brand/20 group-data-[active-item]:text-brand dark:text-stone-300">
                    {typeIcon(node)}
                </span>
            )}
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-50">{node.label}</span>
                <span className="mt-0.5 block truncate text-xs text-stone-500 dark:text-stone-400">
                    {node.description ?? (node.type === 'agent' ? 'Agent' : node.type)}
                </span>
            </span>
        </ComboboxItem>
    );

    return (
        <Popover
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) onClose();
            }}
        >
            {typeof document !== 'undefined' ? createPortal(
                <PopoverAnchor asChild>
                    <span
                        data-mention-anchor=""
                        aria-hidden="true"
                        style={{
                            position: 'fixed',
                            left: coords.left,
                            top: coords.bottom,
                            width: 1,
                            height: 1,
                            pointerEvents: 'none',
                        }}
                    />
                </PopoverAnchor>,
                document.body,
            ) : null}
            <PopoverContent
                side="top"
                align="start"
                sideOffset={12}
                collisionPadding={16}
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="max-h-[min(26rem,55vh)] w-[min(42rem,calc(100vw-2rem))] overflow-y-auto rounded-[22px] border border-warm-border bg-warm-surface/98 p-2 shadow-[0_24px_70px_rgba(35,29,20,0.16)] backdrop-blur-xl"
            >
                <ComboboxProvider store={combobox}>
                    <ComboboxList aria-label="Mention matches" alwaysVisible className="w-full space-y-1">
                        {sections.map((section) => (
                            <section key={section.scope} aria-label={section.label}>
                                <div className="sticky top-0 z-10 bg-warm-surface/95 px-3 pb-1 pt-2 text-[11px] font-semibold tracking-wide text-stone-500 backdrop-blur dark:text-stone-400">
                                    {section.label}
                                </div>
                                {section.entries.map((node) => renderRow(node))}
                            </section>
                        ))}
                    </ComboboxList>
                </ComboboxProvider>
            </PopoverContent>
        </Popover>
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
    const [mentionState, setMentionState] = useState<MentionPluginState>({
        active: false, query: '', from: 0, cursorCoords: null,
    });
    const editorViewRef = useRef<EditorView | null>(null);
    const mentionKeyHandlerRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);
    const currentMarkdownRef = useRef(value);

    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    const connectedSet = new Set(connectedNodeIds);

    // Only show @-menu if modalities include non-text types
    const showMentions = promptModalities.some((m) => m !== 'text');

    const setMentionKeyHandler = useCallback((handler: ((event: KeyboardEvent) => boolean) | null) => {
        mentionKeyHandlerRef.current = handler;
    }, []);

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
        return createMentionPlugin(setMentionState, (event) => mentionKeyHandlerRef.current?.(event) ?? false);
    }, [showMentions]);

    const { get, loading } = useEditor((root) =>
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
                    currentMarkdownRef.current = markdown;
                    onChangeRef.current(markdown);
                });
            })
    );

    useEffect(() => {
        if (loading || currentMarkdownRef.current === value) return;
        const editor = get();
        if (!editor) return;

        currentMarkdownRef.current = value;
        editor.action(replaceAll(value));
    }, [get, loading, value]);

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
        focus() {
            const view = editorViewRef.current;
            if (!view) return;
            view.focus();
            activateMentionAtCursor(view);
        },
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
            // Non-image entries (agent, plain text nodes, etc.): insert as
            // a real link mark, not raw text. If we plug the literal
            // string `@[label](node:id)` straight into a Text node,
            // Milkdown's CommonMark serializer escapes the brackets
            // (→ `@\[label\](node:id)`) to keep them inert on re-parse —
            // which then breaks the submit-time regex that partitions
            // agent vs canvas mentions (`/@\[[^\]]*\]\(node:([^)]+)\)/`).
            // Building it as an `@` text node + a link-marked label +
            // trailing space round-trips through the serializer as
            // exactly `@[label](node:id) `, matches the regex, and the
            // agent gets routed correctly.
            const schema = view.state.schema;
            const linkMark = schema.marks.link;
            // IMPORTANT: do NOT set a `title` on the link mark. Milkdown's
            // CommonMark serializer would emit it as
            // `[label](node:<id> "title")` — and downstream regexes
            // (`/@\[[^\]]*\]\(node:([^)]+)\)/`) then capture
            // `<id> "title"` as the id, which fails the
            // invitedAgentIdSet membership check and silently drops
            // the @-mention from the dispatched agentMentions array.
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

        // Only current-canvas node references can become graph edges. Project
        // assets, timelines and nodes on other canvases remain prompt context.
        const isCurrentCanvasNode =
            (node.kind ?? 'node') === 'node' &&
            (node.scope ?? 'current-canvas') === 'current-canvas';
        if (isCurrentCanvasNode && !connectedSet.has(node.id) && onMentionAdded) {
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
        const view = editorViewRef.current;
        if (!view) return;
        view.focus();
        activateMentionAtCursor(view);
    };

    return (
        <>
            <div
                className="milkdown-editor-wrapper px-3 py-2"
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
                    onKeyboardHandlerChange={setMentionKeyHandler}
                />
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
