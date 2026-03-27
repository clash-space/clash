import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useNodes } from 'reactflow';
import { Image as ImageIcon, TextT } from '@phosphor-icons/react';
import { useMediaViewer } from '../MediaViewerContext';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { normalizeStatus, isActiveStatus, type AssetStatus } from '../../../lib/assetStatus';
import { resolveAssetUrl } from '../../../lib/utils/assets';
import {
    calculateDimensionsFromAspectRatio,
    calculateScaledDimensions,
    hasValidMeasuredSize,
    resolveInitialMediaSize,
} from './assetNodeSizing';

const ImageNode = ({ data, selected, id }: NodeProps) => {
    const [label, setLabel] = useState(data.label || 'Image Node');
    const { openViewer } = useMediaViewer();
    const { setNodes } = useReactFlow();
    const nodes = useNodes();
    const loroSync = useOptionalLoroSyncContext();
    const [status, setStatus] = useState<AssetStatus>(normalizeStatus(data.status) || (data.src ? 'completed' : 'generating'));
    const [imageUrl, setImageUrl] = useState<string | undefined>(data.src);
    const [description, setDescription] = useState(data.description || '');
    const [showDescription, setShowDescription] = useState(false);
    // Removed initialSizeRef
    const didInitSizeRef = useRef(false);

    // Get current node dimensions
    const currentNode = nodes.find((n) => n.id === id);

    // Calculate dimensions from aspect ratio if available (for generating state)
    const aspectRatioDimensions = calculateDimensionsFromAspectRatio(data.aspectRatio);

    // If natural dimensions are provided (from upload), use those for initial sizing
    const naturalDimensions = data.naturalWidth && data.naturalHeight
        ? calculateScaledDimensions(data.naturalWidth, data.naturalHeight)
        : null;

    const hasPreview = Boolean(imageUrl);
    const measuredWidth = currentNode?.width ?? currentNode?.style?.width;
    const measuredHeight = currentNode?.height ?? currentNode?.style?.height;

    const [initialSize] = useState(() => resolveInitialMediaSize({
        status,
        hasPreview,
        measuredWidth,
        measuredHeight,
        naturalDimensions,
        aspectRatioDimensions,
    }));

    const nodeWidth = initialSize.width;
    const nodeHeight = initialSize.height;

    // Sync state with props when they change (e.g. from Loro sync)
    useEffect(() => {
        setImageUrl((prev: string | undefined) => (data.src && data.src !== prev ? data.src : prev));
        setStatus((prev: AssetStatus) => {
            const next = normalizeStatus(data.status);
            return next !== prev ? next : prev;
        });
        setDescription((prev: string) => (data.description && data.description !== prev ? data.description : prev));
    }, [data.src, data.status, data.description]);

    // Loro sync handles state updates - no polling needed

    useEffect(() => {
        if (didInitSizeRef.current) return;
        didInitSizeRef.current = true;
        if (!hasValidMeasuredSize(measuredWidth, measuredHeight)) {
            const nextWidth = nodeWidth;
            const nextHeight = nodeHeight;
            setNodes((nds) =>
                nds.map((node) => {
                    if (node.id !== id) return node;
                    return {
                        ...node,
                        width: nextWidth,
                        height: nextHeight,
                        style: {
                            ...node.style,
                            width: nextWidth,
                            height: nextHeight,
                        },
                    };
                })
            );

            if (loroSync?.connected) {
                loroSync.updateNode(id, { width: nextWidth, height: nextHeight });
            }
        }
    }, [id, loroSync, measuredHeight, measuredWidth, nodeHeight, nodeWidth, setNodes]);

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (imageUrl && (status === 'completed')) {
            openViewer('image', resolveAssetUrl(imageUrl), label);
        }
    };

    return (
        <div
            className="group relative"
        >
            {/* Floating Title Input */}
            <div
                className="absolute -top-8 left-4 z-10"
                onDoubleClick={(e) => e.stopPropagation()}
            >
                <input
                    className="bg-transparent text-lg font-bold font-display text-slate-500 focus:text-slate-900 focus:outline-none"
                    value={label}
                    onChange={(evt) => {
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
                    }}
                />
            </div>

            {/* Main Card */}
            <div
                className={`relative bg-white shadow-md rounded-matrix overflow-hidden transition-all duration-300 hover:shadow-lg ${selected ? 'ring-4 ring-blue-500 ring-offset-2' : 'ring-1 ring-slate-200'
                    }`}
                style={{
                    width: nodeWidth,
                    height: nodeHeight,
                    minWidth: 240,
                    minHeight: 180,
                }}
                onDoubleClick={handleDoubleClick}
            >
                {(status === 'completed') && imageUrl ? (
                    <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={resolveAssetUrl(imageUrl)}
                            alt={label}
                            className="block"
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                            }}
                        />
                        {/* Top Right Controls */}
                        <div className="absolute top-2 right-2 flex gap-1 z-10">
                            <button
                                className="rounded-full bg-black/50 p-1 text-white backdrop-blur-sm hover:bg-black/70 transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowDescription(!showDescription);
                                }}
                            >
                                <TextT size={12} weight="bold" />
                            </button>
                        </div>
                    </div>
                ) : status === 'uploading' && imageUrl ? (
                    <div className="relative" style={{ width: '100%', height: '100%' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={resolveAssetUrl(imageUrl)}
                            alt={label}
                            className="block"
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                filter: 'blur(6px)',
                                transform: 'scale(1.03)',
                            }}
                        />
                        <div className="absolute inset-0 bg-black/25" />
                        <div className="absolute inset-0 flex items-center justify-center backdrop-blur-[2px]">
                            <div className="flex flex-col items-center gap-2">
                                <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/30 border-t-white" />
                                <span className="text-xs font-medium text-white animate-pulse">Uploading...</span>
                            </div>
                        </div>
                    </div>
                ) : isActiveStatus(status) ? (
                    <div className="flex items-center justify-center bg-slate-50 text-slate-400" style={{ width: '100%', height: '100%' }}>
                        <div className="flex flex-col items-center gap-3">
                            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-500" />
                            <span className="text-xs font-medium animate-pulse">Generating Image...</span>
                        </div>
                    </div>
                ) : status === 'failed' ? (
                    <div className="flex items-center justify-center bg-red-50 text-red-400" style={{ width: '100%', height: '100%' }}>
                        <div className="flex flex-col items-center gap-2">
                            <ImageIcon size={32} weight="duotone" />
                            <span className="text-xs font-medium">Generation Failed</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center bg-slate-100 text-slate-400" style={{ width: '100%', height: '100%' }}>
                        <div className="flex flex-col items-center gap-2">
                            <ImageIcon size={32} />
                            <span className="text-xs">No Image</span>
                        </div>
                    </div>
                )}

                {/* Description Box */}
                {showDescription && (
                    <div
                        className="absolute left-0 right-0 bottom-0 z-20 border-t border-slate-100 bg-slate-50/95 p-3 backdrop-blur"
                        onDoubleClick={(e) => e.stopPropagation()}
                    >
                        <textarea
                            className="w-full h-24 resize-none bg-transparent text-xs text-slate-600 focus:outline-none"
                            value={description || ((status === 'completed') ? 'Generating description...' : 'No description available.')}
                            readOnly
                        />
                    </div>
                )}
            </div>

            {/* Asset nodes only have output (source) */}
            <Handle
                type="target"
                position={Position.Left}
                isConnectable={false}
                style={{ top: '50%', left: '-8px' }}
                className="!h-4 !w-4 !border-4 !border-white !bg-slate-400 transition-all hover:!bg-blue-500 hover:scale-125 shadow-sm !opacity-0 !pointer-events-none"
            />
            <Handle
                type="source"
                position={Position.Right}
                style={{ top: '50%', right: '-8px' }}
                className="!h-4 !w-4 !border-4 !border-white !bg-slate-400 transition-all hover:!bg-blue-500 hover:scale-125 shadow-sm"
            />
        </div>
    );
};

export default memo(ImageNode);
