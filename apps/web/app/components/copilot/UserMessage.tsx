'use client';

import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { SignedImg } from '../SignedMedia';

interface MentionNode {
    id: string;
    label: string;
    src?: string;
}

export function UserMessage({ content, mentionNodes, onNodeDoubleClick }: { content: string; mentionNodes?: MentionNode[]; onNodeDoubleClick?: (nodeId: string) => void }) {
    // Strip <!-- asset-keys: ... --> comments (legacy format)
    let cleaned = content.replace(/<!--\s*asset-keys:.+?-->/g, '').replace(/📎\s*\S+/g, '').trim();

    // Convert @[label](node:id) → ![mention:id:label](src) for image mentions, or keep as text chip
    if (mentionNodes?.length) {
        cleaned = cleaned.replace(/@\[([^\]]*)\]\(node:([^)]+)\)/g, (_match, label, nodeId) => {
            const node = mentionNodes.find(n => n.id === nodeId);
            if (node?.src) {
                return `![mention:${nodeId}:${label}](${node.src})`;
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
                                if (mentionMatch) {
                                    const nodeId = mentionMatch[1];
                                    // Render mention as inline thumbnail, double-click to focus node
                                    return (
                                        <SignedImg
                                            src={typeof src === 'string' ? src : undefined}
                                            alt={mentionMatch[2]}
                                            title={mentionMatch[2]}
                                            className="inline-block rounded object-cover align-text-bottom mx-0.5 cursor-pointer hover:ring-2 hover:ring-slate-400"
                                            style={{ height: '1.2em', width: '1.2em' }}
                                            onDoubleClick={() => onNodeDoubleClick?.(nodeId)}
                                        />
                                    );
                                }
                                return (
                                    <SignedImg
                                        src={typeof src === 'string' ? src : undefined}
                                        alt={alt || ''}
                                        title={alt || ''}
                                        className="inline-block rounded object-cover align-text-bottom mx-0.5 cursor-pointer hover:ring-2 hover:ring-slate-400"
                                        style={{ height: '1.2em', width: '1.2em' }}
                                    />
                                );
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
