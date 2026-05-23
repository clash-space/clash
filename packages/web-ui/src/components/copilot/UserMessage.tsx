
import ReactMarkdown from 'react-markdown';
import { useMediaViewer } from '../MediaViewerContext';
import { useCanvasFocus } from '../CanvasFocusContext';
import { useSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import type { MentionableNode } from '../MilkdownEditor';

/** Inline thumbnail for a `@[label](node:<id>)` mention. Single click
 *  flies the canvas camera to the referenced asset node (via the
 *  `useCanvasFocus` abstraction); double-click opens the full-screen
 *  MediaViewer. `nodeId` is the canvas node id extracted upstream
 *  from the `mention:<id>:<label>` alt encoding. */
function InlineThumbnail({
    src,
    alt,
    title,
    nodeId,
}: {
    src?: string;
    alt: string;
    title: string;
    nodeId?: string;
}) {
    const { openViewer } = useMediaViewer();
    const { focusNode } = useCanvasFocus();
    const signedUrl = useSignedUrl(src);

    return (
        // eslint-disable-next-line @next/next/no-img-element
        signedUrl ? <img
            src={signedUrl}
            alt={alt}
            title={nodeId ? `${title} — click to focus, double-click to preview` : title}
            className="inline-block rounded object-cover align-text-bottom mx-0.5 cursor-pointer hover:ring-2 hover:ring-slate-400 dark:hover:ring-slate-500"
            style={{ height: '1.2em', width: '1.2em' }}
            onClick={(e) => {
                // Single click → pan the canvas to this node. Skipped
                // when no nodeId (the chip came from a non-canvas
                // reference) or outside a CanvasFocusProvider (hook
                // returns a no-op). stopPropagation so the click
                // doesn't bubble to the message bubble's own handlers.
                if (!nodeId) return;
                e.stopPropagation();
                focusNode(nodeId);
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                openViewer('image', signedUrl, title);
            }}
        /> : null
    );
}

export function UserMessage({ content, mentionNodes }: { content: string; mentionNodes?: MentionableNode[] }) {
    // Strip <!-- asset-keys: ... --> comments (legacy format)
    let cleaned = content.replace(/<!--\s*asset-keys:.+?-->/g, '').replace(/📎\s*\S+/g, '').trim();

    if (mentionNodes?.length) {
        // Capture nodeId up to first whitespace OR `)` — robust to
        // markdown link `title` attributes that some serializers emit
        // (`[label](node:<id> "title")`), which would otherwise pollute
        // the captured nodeId and break the mentionNodes lookup.
        cleaned = cleaned.replace(/@\[([^\]]*)\]\(node:([^\s)]+)(?:\s+"[^"]*")?\)/g, (_match, label, nodeId) => {
            const node = mentionNodes.find(n => n.id === nodeId);
            if (node?.thumbnail) {
                return `![mention:${nodeId}:${label}](${node.thumbnail})`;
            }
            return `\`@${label}\``;
        });
    }

    return (
        <div className="flex justify-end">
            <div className="max-w-[82%] items-end">
                <div className="px-4 py-3 rounded-matrix shadow-sm border bg-brand-light text-slate-900 border-warm-border dark:bg-warm-muted dark:text-slate-100 dark:border-warm-border">
                    <ReactMarkdown
                        components={{
                            p: ({ children }) => <p className="text-sm leading-relaxed mb-1 last:mb-0">{children}</p>,
                            img: ({ src, alt }) => {
                                const mentionMatch = alt?.match(/^mention:([^:]+):(.+)$/);
                                const nodeId = mentionMatch ? mentionMatch[1] : undefined;
                                const label = mentionMatch ? mentionMatch[2] : (alt || '');
                                const imgSrc = typeof src === 'string' ? src : undefined;
                                return <InlineThumbnail src={imgSrc} alt={label} title={label} nodeId={nodeId} />;
                            },
                            a: ({ href, children }) => (
                                <a href={href} className="text-brand underline text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface rounded-sm" target="_blank" rel="noreferrer">{children}</a>
                            ),
                        }}
                    >
                        {cleaned}
                    </ReactMarkdown>
                </div>
            </div>
        </div>
    );
}
