
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
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                    />

                    {/* Content Container */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: 'spring', duration: 0.3 }}
                        className="relative z-10 flex max-h-[90vh] max-w-[90vw] flex-col items-center justify-center rounded-2xl bg-transparent p-4 outline-none"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className="absolute -top-12 right-0 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
                        >
                            <X size={24} weight="bold" />
                        </button>

                        {/* Title */}
                        {title && (
                            <div className="absolute -top-12 left-0 text-lg font-medium text-white">
                                {title}
                            </div>
                        )}

                        {/* Media Content */}
                        <div className="overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10">
                            {type === 'image' ? (
                                <img
                                    src={src}
                                    alt={title || 'Media Viewer'}
                                    className="max-h-[80vh] max-w-[85vw] object-contain"
                                />
                            ) : (
                                <video
                                    src={src}
                                    controls
                                    autoPlay
                                    className="max-h-[80vh] max-w-[85vw]"
                                />
                            )}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
