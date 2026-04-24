
import { memo, useState, useCallback, useEffect } from 'react';
import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react';
import { X } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import MilkdownEditor from '../MilkdownEditor';
import { useLoroSyncContext } from '../LoroSyncContext';

const PromptNode = ({ data, selected, id }: NodeProps<Node<Record<string, any>>>) => {
    const [showModal, setShowModal] = useState(false);
    const [label, setLabel] = useState(data.label || 'Prompt');
    const [content, setContent] = useState(data.content || '# Prompt\nEnter your prompt here...');
    const { setNodes } = useReactFlow();
    // Access Loro sync context
    const { updateNode } = useLoroSyncContext();

    // Sync when data changes
    useEffect(() => {
         
        setLabel((prev: string) => (data.label && data.label !== prev ? data.label : prev));
         
        setContent((prev: string) => (data.content && data.content !== prev ? data.content : prev));
    }, [data.label, data.content]);

    const handleDoubleClick = useCallback(() => {
        setShowModal(true);
    }, []);

    const handleSave = useCallback(() => {
        setShowModal(false);
        // Update the node data locally
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            label,
                            content,
                        },
                    };
                }
                return node;
            })
        );
        
        // Sync to Loro
        console.log(`[PromptNode] Syncing update to Loro: ${id}`);
        updateNode(id, {
            data: {
                label,
                content
            }
        });
    }, [id, label, content, setNodes, updateNode]);

    const handleCancel = useCallback(() => {
        setShowModal(false);
        // Reset to original values
        setLabel(data.label || 'Prompt');
        setContent(data.content || '# Prompt\nEnter your prompt here...');
    }, [data.label, data.content]);

    const handleLabelChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
        const newLabel = evt.target.value;
        setLabel(newLabel);
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            label: newLabel,
                        },
                    };
                }
                return node;
            })
        );
    };

    const modalContent = showModal ? (
        <AnimatePresence>
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
                    className="relative z-10 w-full max-w-5xl h-[85vh] bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col border border-gray-200"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header with Title Input */}
                    <div className="px-12 pt-8 pb-2 flex justify-between items-start">
                        <input
                            type="text"
                            value={label}
                            onChange={handleLabelChange}
                            placeholder="Untitled Prompt"
                            className="w-full text-4xl font-bold text-gray-900 placeholder:text-gray-300 bg-transparent border-none outline-none focus:outline-none"
                            style={{
                                fontFamily: 'var(--font-space-grotesk), var(--font-inter), sans-serif',
                                letterSpacing: '-0.02em'
                            }}
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={handleSave}
                                className="px-4 py-2 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition-colors"
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
        </AnimatePresence>
    ) : null;

    return (
        <>
            <div
                className="group relative w-[300px] h-[150px]"
                onDoubleClick={handleDoubleClick}
            >
                {/* Floating Title Input */}
                <div
                    className="absolute -top-8 left-4 z-10"
                    onDoubleClick={(e) => e.stopPropagation()}
                >
                    <input
                        className="bg-transparent text-lg font-bold text-blue-600 focus:text-blue-700 focus:outline-none"
                        value={label}
                        onChange={handleLabelChange}
                        placeholder="Prompt"
                    />
                </div>

                {/* Main Card - Smaller height and different styling */}
                <div className={`w-full h-full bg-blue-50 rounded-matrix flex flex-col overflow-hidden transition-all duration-300 hover:shadow-xl ${selected ? 'ring-4 ring-blue-500 ring-offset-2' : 'ring-1 ring-blue-200'
                    }`}>
                    {/* Card Content */}
                    <div className="flex-1 p-6 flex flex-col relative">
                        {/* Content Preview with Fade Out */}
                        <div className="flex-1 relative overflow-hidden">
                            <div className="absolute inset-0">
                                <div className="prose prose-sm prose-slate prose-p:text-gray-600 prose-headings:text-gray-800 prose-p:leading-tight">
                                    <MarkdownPreview content={content} />
                                </div>
                            </div>

                            {/* Fade out gradient overlay */}
                            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-blue-50 to-transparent pointer-events-none" />
                        </div>
                    </div>
                </div>

                {/* Prompt nodes have output handle (source) to connect to action badges */}
                <Handle
                    type="source"
                    position={Position.Right}
                    className="!h-4 !w-4 !translate-x-2 !border-4 !border-white !bg-blue-500 transition-all hover:scale-125 shadow-sm"
                />
            </div>

            {/* Render modal in portal */}
            {typeof window !== 'undefined' && modalContent && createPortal(modalContent, document.body)}
        </>
    );
};

// Simple markdown preview component
const MarkdownPreview = ({ content }: { content: string }) => {
    return (
        <div
            className="prose prose-sm max-w-none prose-slate prose-headings:font-bold prose-headings:text-slate-900 prose-p:text-slate-700 prose-a:text-blue-600 prose-code:text-blue-600 prose-code:bg-blue-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded"
            dangerouslySetInnerHTML={{
                __html: content
                    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
                    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
                    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
                    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
                    .replace(/\*(.*)\*/gim, '<em>$1</em>')
                    .replace(/\n/gim, '<br />')
            }}
        />
    );
};

export default memo(PromptNode);
