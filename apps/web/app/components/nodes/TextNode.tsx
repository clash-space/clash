'use client';

import { memo, useState, useCallback, useEffect } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { X } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import MilkdownEditor from '../MilkdownEditor';
import ReactMarkdown from 'react-markdown';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';

const TextNode = ({ data, selected, id }: NodeProps) => {
    const [showModal, setShowModal] = useState(false);
    const [label, setLabel] = useState(data.label || 'Text Node');
    const [content, setContent] = useState(data.content || '# Hello World\nDouble click to edit.');
    const { setNodes } = useReactFlow();
    const loroSync = useOptionalLoroSyncContext();

    // Sync when data changes (from Loro or other sources)
    useEffect(() => {
        setLabel((prev: string) => (data.label && data.label !== prev ? data.label : prev));
        setContent((prev: string) => (data.content && data.content !== prev ? data.content : prev));
    }, [data.label, data.content]);

    const handleDoubleClick = useCallback(() => {
        setShowModal(true);
    }, []);

    const handleSave = useCallback(() => {
        setShowModal(false);
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    return { ...node, data: { ...node.data, label, content } };
                }
                return node;
            })
        );
        // Sync to Loro
        if (loroSync?.connected) {
            loroSync.updateNode(id, { data: { label, content } });
        }
    }, [id, label, content, setNodes, loroSync]);

    const handleCancel = useCallback(() => {
        setShowModal(false);
        setLabel(data.label || 'Text Node');
        setContent(data.content || '# Hello World\nDouble click to edit.');
    }, [data.label, data.content]);

    const handleLabelChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
        const newLabel = evt.target.value;
        setLabel(newLabel);
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    return { ...node, data: { ...node.data, label: newLabel } };
                }
                return node;
            })
        );
        if (loroSync?.connected) {
            loroSync.updateNode(id, { data: { label: newLabel } });
        }
    };

    // Modal — conditional inside AnimatePresence so exit animation works
    const modalContent = (
        <AnimatePresence>
            {showModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-8">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-white/80 backdrop-blur-sm"
                        onClick={handleCancel}
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="relative z-10 w-full max-w-5xl h-[85vh] bg-white rounded-xl shadow-xl overflow-hidden flex flex-col border border-slate-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header with Title Input */}
                        <div className="px-12 pt-8 pb-2 flex justify-between items-start">
                            <input
                                type="text"
                                value={label}
                                onChange={handleLabelChange}
                                placeholder="Untitled"
                                className="w-full text-4xl font-bold font-display tracking-tight text-gray-900 placeholder:text-gray-300 bg-transparent border-none outline-none focus:outline-none"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={handleSave}
                                    className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
                                >
                                    Save
                                </button>
                                <button
                                    onClick={handleCancel}
                                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    <X className="w-5 h-5" weight="bold" />
                                </button>
                            </div>
                        </div>

                        {/* Editor Content */}
                        <div className="flex-1 overflow-y-auto bg-white">
                            <MilkdownEditor value={content} onChange={setContent} />
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );

    return (
        <>
            <div
                className="group relative w-[300px] h-[400px]"
                onDoubleClick={handleDoubleClick}
            >
                {/* Floating Title Input */}
                <div
                    className="absolute -top-8 left-4 z-10"
                    onDoubleClick={(e) => e.stopPropagation()}
                >
                    <input
                        className="bg-transparent text-lg font-bold font-display text-slate-500 focus:text-slate-900 focus:outline-none"
                        value={label}
                        onChange={handleLabelChange}
                        placeholder="Text Node"
                    />
                </div>

                {/* Main Card */}
                <div className={`w-full h-full bg-slate-50 rounded-matrix flex flex-col overflow-hidden transition-all duration-300 hover:shadow-xl ${
                    selected ? 'ring-4 ring-blue-500 ring-offset-2' : 'ring-1 ring-slate-200'
                }`}>
                    {/* Card Content */}
                    <div className="flex-1 p-8 flex flex-col relative">
                        {/* Content Preview with Fade Out */}
                        <div className="flex-1 relative overflow-hidden">
                            <div
                                className="absolute inset-0"
                                style={{ maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)' }}
                            >
                                <div className="prose prose-slate prose-p:text-gray-600 prose-headings:text-gray-800">
                                    <MarkdownPreview content={content} />
                                </div>
                            </div>

                            {/* Fade out gradient overlay */}
                            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-50 to-transparent pointer-events-none" />
                        </div>
                    </div>
                </div>

                {/* Handle — consistent with ImageNode/other nodes */}
                <Handle
                    type="target"
                    position={Position.Left}
                    style={{ left: -8, top: '50%', transform: 'translateY(-50%)', zIndex: 100 }}
                    className="!h-4 !w-4 !border-4 !border-white !bg-slate-400 transition-all hover:scale-125 shadow-sm hover:!bg-blue-500"
                />
            </div>

            {/* Render modal in portal */}
            {typeof window !== 'undefined' && createPortal(modalContent, document.body)}
        </>
    );
};

// Simple markdown preview component
const MarkdownPreview = ({ content }: { content: string }) => {
    return (
        <div className="prose prose-lg max-w-none prose-slate prose-headings:font-bold prose-headings:text-gray-900 prose-p:text-gray-700 prose-a:text-blue-600 prose-code:text-blue-600 prose-code:bg-blue-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded">
            <ReactMarkdown>{content}</ReactMarkdown>
        </div>
    );
};

export default memo(TextNode);
