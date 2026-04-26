
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { SignedImg } from '../SignedMedia';
import { useMediaViewer } from '../MediaViewerContext';
import { useSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import type { MentionableNode } from '../MilkdownEditor';

/** Inline thumbnail that opens MediaViewer on double-click */
function InlineThumbnail({ src, alt, title }: { src?: string; alt: string; title: string }) {
    const { openViewer } = useMediaViewer();
    const signedUrl = useSignedUrl(src);

    return (
        // eslint-disable-next-line @next/next/no-img-element
        signedUrl ? <img
            src={signedUrl}
            alt={alt}
            title={title}
            className="inline-block rounded object-cover align-text-bottom mx-0.5 cursor-pointer hover:ring-2 hover:ring-slate-400"
            style={{ height: '1.2em', width: '1.2em' }}
            onDoubleClick={() => openViewer('image', signedUrl, title)}
        /> : null
    );
}

export function UserMessage({ content, mentionNodes }: { content: string; mentionNodes?: MentionableNode[] }) {
    // Strip <!-- asset-keys: ... --> comments (legacy format)
    let cleaned = content.replace(/<!--\s*asset-keys:.+?-->/g, '').replace(/📎\s*\S+/g, '').trim();

    // Convert @[label](node:id) → ![mention:id:label](r2Key) for image / video mentions,
    // or keep as a text chip when no thumbnail is resolved yet (asset still loading,
    // or mention points at a non-media node like text).
    if (mentionNodes?.length) {
        cleaned = cleaned.replace(/@\[([^\]]*)\]\(node:([^)]+)\)/g, (_match, label, nodeId) => {
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
                <motion.div
                    className="px-4 py-3 rounded-matrix shadow-sm border bg-gradient-to-br from-red-50/90 to-pink-50/90 border-red-100/50 text-gray-900"
                    whileHover={{ scale: 1.02, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                    <ReactMarkdown
                        components={{
                            p: ({ children }) => <p className="text-sm leading-relaxed mb-1 last:mb-0">{children}</p>,
                            img: ({ src, alt }) => {
                                const mentionMatch = alt?.match(/^mention:([^:]+):(.+)$/);
                                const label = mentionMatch ? mentionMatch[2] : (alt || '');
                                const imgSrc = typeof src === 'string' ? src : undefined;
                                return <InlineThumbnail src={imgSrc} alt={label} title={label} />;
                            },
                            a: ({ href, children }) => (
                                <a href={href} className="text-blue-600 underline text-sm" target="_blank" rel="noreferrer">{children}</a>
                            ),
                        }}
                    >
                        {cleaned}
                    </ReactMarkdown>
                </motion.div>
            </div>
        </div>
    );
}
