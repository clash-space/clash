'use client';

import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { SignedImg } from '../SignedMedia';

export function UserMessage({ content }: { content: string }) {
    // Strip <!-- asset-keys: ... --> comments (legacy format)
    const cleaned = content.replace(/<!--\s*asset-keys:.+?-->/g, '').replace(/📎\s*\S+/g, '').trim();

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
                            img: ({ src, alt }) => (
                                <SignedImg
                                    src={typeof src === 'string' ? src : undefined}
                                    alt={alt || ''}
                                    className="max-w-[200px] max-h-[160px] rounded-lg object-cover border border-red-100/50 my-1 inline-block"
                                />
                            ),
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
