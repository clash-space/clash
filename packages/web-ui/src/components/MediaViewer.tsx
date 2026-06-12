
/* eslint-disable @next/next/no-img-element */

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '@phosphor-icons/react';

interface MediaViewerProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'image' | 'video';
    src: string;
    title?: string;
}

export default function MediaViewer({ isOpen, onClose, type, src, title }: MediaViewerProps) {
    // Close on escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            window.addEventListener('keydown', handleKeyDown);
        }
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="clash-media-viewer-backdrop absolute inset-0"
                    />

                    {/* Content Container */}
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label={title || 'Media Viewer'}
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                        className="relative z-10 flex max-h-[90vh] max-w-[90vw] flex-col items-center justify-center rounded-2xl bg-transparent p-4 outline-none"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close Button */}
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close media viewer"
                            className="clash-media-viewer-chrome absolute -top-14 right-0 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 text-slate-900 transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-page"
                        >
                            <X size={24} weight="bold" aria-hidden="true" />
                        </button>

                        {/* Title */}
                        {title && (
                            <div className="clash-media-viewer-chrome absolute -top-14 left-0 max-w-[calc(90vw-64px)] truncate rounded-full px-4 py-2 text-sm font-medium text-slate-900">
                                {title}
                            </div>
                        )}

                        {/* Media Content */}
                        <div className="clash-media-viewer-frame overflow-hidden rounded-2xl p-1">
                            {type === 'image' ? (
                                <img
                                    src={src}
                                    alt={title || 'Media Viewer'}
                                    className="block max-h-[80vh] max-w-[85vw] rounded-xl object-contain"
                                />
                            ) : (
                                <video
                                    src={src}
                                    controls
                                    autoPlay
                                    className="block max-h-[80vh] max-w-[85vw] rounded-xl bg-stone-950"
                                />
                            )}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
