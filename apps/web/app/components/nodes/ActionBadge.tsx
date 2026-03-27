import { memo, useState, useEffect, useCallback, useMemo } from 'react';
import { Handle, Position, Node, NodeProps, useReactFlow, useEdges } from 'reactflow';
import { VideoCamera, Image as ImageIcon, CaretDown, X, Play, Spinner, ArrowsInLineVertical } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useProject } from '../ProjectContext';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { useLayoutManager } from '@/lib/layout';
import { generateSemanticId } from '@/lib/utils/semanticId';
import MilkdownEditor from '../MilkdownEditor';
import { resolveAssetUrl, isR2Key } from '../../../lib/utils/assets';
import { MODEL_CARDS, resolveAspectRatio, type ModelCard, type ModelParameter } from '@clash/shared-types';
import { applyLayoutPatchesToLoro, collectLayoutNodePatches } from '../../lib/loroNodeSync';

type ModelParams = Record<string, string | number | boolean>;

// Helper to extract meaningful label from prompt content
const extractLabelFromPrompt = (promptText: string, fallback: string): string => {
    if (!promptText || promptText.trim() === '') return fallback;

    // Remove markdown headers and get first non-empty line
    const lines = promptText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line !== 'Prompt' && line !== 'Enter your prompt here...');

    if (lines.length === 0) return fallback;

    // Take first 50 chars of first meaningful line
    const firstLine = lines[0];
    if (firstLine.length > 50) {
        return firstLine.substring(0, 50) + '...';
    }
    return firstLine;
};

const PromptActionNode = ({ data, selected, id }: NodeProps) => {
    const [isHovered, setIsHovered] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // React Flow hooks
    const { projectId } = useProject();
    const { getNodes, getEdges, addEdges, setNodes } = useReactFlow();
    const loroSync = useOptionalLoroSyncContext();
    const edges = useEdges();
    const onNodesMutated = useCallback(
        (prevNodes: Node[], nextNodes: Node[]) => {
            if (!loroSync?.connected) return;
            const patches = collectLayoutNodePatches(prevNodes, nextNodes);
            applyLayoutPatchesToLoro(loroSync, patches);
        },
        [loroSync]
    );
    const { addNodeWithAutoLayout } = useLayoutManager({ onNodesMutated });

    // Prompt editing state
    const [label, setLabel] = useState(data.label || 'Prompt');
    const [content, setContent] = useState(data.content || '# Prompt\nEnter your prompt here...');

    const mapLegacyModelId = (
        type: 'image-gen' | 'video-gen',
        explicitId?: string,
        legacyName?: string
    ): string | undefined => {
        if (explicitId) return explicitId;
        if (!legacyName) return undefined;
        const lower = legacyName.toLowerCase();
        if (type === 'video-gen') return 'sora-2-image-to-video';
        if (lower.includes('pro')) return 'nano-banana-2';
        return 'nano-banana-2';
    };

    const [actionType, setActionType] = useState<'image-gen' | 'video-gen'>(data.actionType || 'image-gen');
    const initialModelId =
        mapLegacyModelId(actionType, data.modelId as string | undefined, data.modelName) ||
        (MODEL_CARDS.find((card) => card.kind === (actionType === 'video-gen' ? 'video' : 'image'))?.id ??
            (actionType === 'video-gen' ? 'sora-2-image-to-video' : 'nano-banana-2'));

    const [modelId, setModelId] = useState<string>(initialModelId);
    const [modelParams, setModelParams] = useState<ModelParams>({
        ...(MODEL_CARDS.find((card) => card.id === initialModelId)?.defaultParams ?? {}),
        ...(data.modelParams ?? {}),
    });

    const Icon = actionType === 'video-gen' ? VideoCamera : ImageIcon;
    const colorClass = actionType === 'video-gen' ? 'text-red-500' : 'text-blue-500';
    const bgClass = actionType === 'video-gen' ? 'bg-red-50' : 'bg-blue-50';
    const ringClass = actionType === 'video-gen' ? 'ring-red-500' : 'ring-blue-500';

    const availableModels = useMemo(
        () => MODEL_CARDS.filter((card) => card.kind === (actionType === 'video-gen' ? 'video' : 'image')),
        [actionType]
    );
    const selectedModel = useMemo<ModelCard | undefined>(
        () => availableModels.find((card) => card.id === modelId) ?? availableModels[0],
        [availableModels, modelId]
    );

    const modelDisplay = selectedModel?.name || modelId;
    const providerDisplay = selectedModel?.provider || '';
    const referenceMode = selectedModel?.input.referenceMode || 'single';
    const referenceRequirement = selectedModel?.input.referenceImage || 'optional';
    const countValue = Number(modelParams.count ?? 1);

    const syncModelState = useCallback(
        (nextModelId: string, nextParams: ModelParams, nextReferenceMode?: string) => {
            const refMode = nextReferenceMode || referenceMode;
            setNodes((nds) =>
                nds.map((node) => {
                    if (node.id === id) {
                        return {
                            ...node,
                            data: {
                                ...node.data,
                                modelId: nextModelId,
                                model: nextModelId,
                                modelParams: nextParams,
                                referenceMode: refMode,
                            },
                        };
                    }
                    return node;
                })
            );
            if (loroSync?.connected) {
                loroSync.updateNode(id, {
                    data: {
                        modelId: nextModelId,
                        model: nextModelId,
                        modelParams: nextParams,
                        referenceMode: refMode,
                    }
                });
            }
        },
        [id, referenceMode, loroSync, setNodes]
    );

    const handleModelChange = useCallback((nextId: string) => {
        const nextModel = MODEL_CARDS.find((card) => card.id === nextId) || availableModels[0];
        const nextParams = { ...(nextModel?.defaultParams ?? {}) } as ModelParams;
        const resolvedId = nextModel?.id ?? nextId;
        setModelId(resolvedId);
        setModelParams(nextParams);
        const nextRefMode = nextModel?.input.referenceMode || 'single';
        syncModelState(resolvedId, nextParams, nextRefMode);
    }, [availableModels, syncModelState]);

    const updateModelParam = useCallback((paramId: string, value: string | number | boolean) => {
        setModelParams((prev) => {
            const next = { ...prev, [paramId]: value };
            syncModelState(modelId, next);
            return next;
        });
    }, [modelId, syncModelState]);

    // Sync content and label when data changes (from Loro or other sources)
    useEffect(() => {
        if (data.label) {
            setLabel((prev: string) => (prev !== data.label ? data.label : prev));
        }
        if (data.content !== undefined) {
            setContent((prev: string) => (prev !== data.content ? data.content : prev));
        }
    }, [data.label, data.content]);

    useEffect(() => {
        const incomingType = data.actionType || 'image-gen';
        if (incomingType !== actionType) {
            setActionType(incomingType);
        }
    }, [data.actionType, actionType]);

    useEffect(() => {
        const incomingModelId = mapLegacyModelId(actionType, data.modelId as string | undefined, data.modelName);
        if (incomingModelId && incomingModelId !== modelId) {
            const nextModel = MODEL_CARDS.find((card) => card.id === incomingModelId) || selectedModel;
            const nextParams = { ...(nextModel?.defaultParams ?? {}), ...(data.modelParams ?? {}) } as ModelParams;
            setModelId(nextModel?.id ?? incomingModelId);
            setModelParams(nextParams);
        } else if (data.modelParams) {
            setModelParams((prev) => ({
                ...(selectedModel?.defaultParams ?? {}),
                ...prev,
                ...data.modelParams,
            }));
        }
    }, [actionType, data.modelId, data.modelName, data.modelParams, modelId, selectedModel]);

    useEffect(() => {
        if (!selectedModel && availableModels[0]) {
            const fallback = availableModels[0];
            const nextParams = { ...(fallback.defaultParams ?? {}) } as ModelParams;
            setModelId(fallback.id);
            setModelParams(nextParams);
            syncModelState(fallback.id, nextParams);
        }
    }, [availableModels, selectedModel, syncModelState]);

    // Prompt editing handlers (from PromptNode)
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
        if (loroSync?.connected) {
            loroSync.updateNode(id, {
                data: {
                    label,
                    content,
                }
            });
        }
    }, [id, label, content, setNodes, loroSync]);

    const handleCancel = useCallback(() => {
        setShowModal(false);
        // Reset to original values
        setLabel(data.label || 'Prompt');
        setContent(data.content || '# Prompt\nEnter your prompt here...');
    }, [data.label, data.content]);

    const handleLabelChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
        const newLabel = evt.target.value;
        setLabel(newLabel);
    };

    // Type switching handler
    const handleTypeSwitch = () => {
        const newType = actionType === 'image-gen' ? 'video-gen' : 'image-gen';
        setActionType(newType);
        
        const nextCandidates = MODEL_CARDS.filter((card) => card.kind === (newType === 'video-gen' ? 'video' : 'image'));
        const nextModel = nextCandidates[0];
        const nextModelId = nextModel?.id ?? modelId;
        const nextParams = { ...(nextModel?.defaultParams ?? {}) } as ModelParams;
        setModelId(nextModelId);
        setModelParams(nextParams);
        
        // Sync to node data
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === id) {
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            actionType: newType,
                            modelId: nextModelId,
                            model: nextModelId,
                            modelParams: nextParams,
                        },
                    };
                }
                return node;
            })
        );

        // Sync to Loro
        if (loroSync?.connected) {
            loroSync.updateNode(id, {
                data: {
                    actionType: newType,
                    modelId: nextModelId,
                    model: nextModelId,
                    modelParams: nextParams,
                }
            });
        }
    };

    // Auto-run effect
    const handleExecute = useCallback(async () => {
        setIsExecuting(true);
        setError(null);

        try {
            // Get connected input nodes
            const incomingEdges = getEdges().filter(e => e.target === id);
            const nodes = getNodes();
            const connectedNodes = incomingEdges.map(e =>
                nodes.find(n => n.id === e.source)
            ).filter(Boolean);

            // PRIORITY 1: Use embedded content if available
            let prompt = content && content.trim() !== '# Prompt\nEnter your prompt here...' ? content : '';

            // PRIORITY 2: Fallback to connected prompt/text nodes
            if (!prompt) {
                const promptNode = connectedNodes.find(n => n?.type === 'prompt');
                const textNode = connectedNodes.find(n => n?.type === 'text');

                if (promptNode) {
                    prompt = promptNode.data.content || '';
                } else if (textNode) {
                    prompt = textNode.data.content || '';
                }
            }

            // PRIORITY 3: Fallback to data.prompt (legacy)
            if (!prompt) {
                prompt = data.prompt || '';
            }

            if (!prompt || prompt.trim() === '') {
                throw new Error('No prompt provided. Please edit the node or connect a text/prompt node.');
            }

            // Capture and clear pre-allocated asset ID (provided by backend; treat as single-use)
            const preAllocatedAssetId = data.preAllocatedAssetId;
            if (preAllocatedAssetId) {
                setNodes((nds) =>
                    nds.map((n) =>
                        n.id === id ? { ...n, data: { ...n.data, preAllocatedAssetId: undefined } } : n
                    )
                );
            }

            // Generate unique asset name (prefer pre-allocated assetId once; otherwise request semantic ID)
            const assetName = preAllocatedAssetId || await generateSemanticId(projectId);

            const getReferenceImageUrls = (sources: string[]) => {
                const urls: string[] = [];
                sources.forEach((src) => {
                    if (!src) return;
                    if (src.startsWith('http://') || src.startsWith('https://')) {
                        urls.push(src);
                    } else if (isR2Key(src)) {
                        // Pass R2 keys directly
                        urls.push(src);
                    } else if (src.includes('base64,')) {
                        // Also pass base64 images - backend will upload to R2
                        urls.push(src);
                    }
                });
                return urls;
            };
            const requiresReferenceImage = referenceRequirement === 'required';
            const forbidReferenceImage = referenceRequirement === 'forbidden';

            if (actionType === 'image-gen') {
                // Collect connected images for reference
                const imageNodes = connectedNodes.filter(n => n?.type === 'image');
                const rawReferenceImages = getReferenceImageUrls(imageNodes.map(n => n?.data?.src));
                const referenceImageUrls = forbidReferenceImage ? [] : rawReferenceImages;

                if (requiresReferenceImage && referenceImageUrls.length === 0) {
                    throw new Error('Selected model requires at least one reference image.');
                }

                // ============================================
                // Create pending node - Loro will handle generation
                // ============================================
                const pendingNodeId = assetName;

                // Extract meaningful label from prompt
                const generatedLabel = extractLabelFromPrompt(prompt, 'Generated Image');


                // Create the pending node in React state
                const newNode = addNodeWithAutoLayout(
                    {
                        id: pendingNodeId,
                        type: 'image',
                        data: {
                            label: generatedLabel,
                            src: '', // Empty src = generating
                            status: 'pending',
                            prompt: prompt, // Loro uses this for generation
                            referenceImageUrls, // Pass reference images
                            aspectRatio: resolveAspectRatio(modelId, modelParams),
                            model: modelId,
                            modelId,
                            modelParams,
                            referenceMode,
                            count: modelParams.count,
                        },
                    },
                    id
                );

                if (!newNode) {
                    throw new Error('Failed to create pending image node.');
                }

                // Sync pending node to Loro - server will detect and process
                if (loroSync?.connected) {
                    loroSync.addNode(newNode.id, newNode);
                } else {
                    console.warn('[ActionBadge] ⚠️ loroSync not connected - node will not be processed');
                }

                // Add edge
                const edgeId = `${id}-${pendingNodeId}`;
                addEdges({
                    id: edgeId,
                    source: id,
                    target: pendingNodeId,
                    type: 'default',
                });

                // Sync edge
                if (loroSync?.connected) {
                    loroSync.addEdge(edgeId, {
                        id: edgeId,
                        source: id,
                        target: pendingNodeId,
                        type: 'default',
                    });
                }

                // Update ActionBadge status
                setNodes((nds) => nds.map((n) => {
                    if (n.id === id) {
                        return {
                            ...n,
                            data: {
                                ...n.data,
                                preAllocatedAssetId: undefined,
                                status: 'success'
                            }
                        };
                    }
                    return n;
                }));

            } else if (actionType === 'video-gen') {
                // Collect connected images for video generation
                // First image is start frame, second is end frame (if available)
                const imageNodes = connectedNodes.filter(n => n?.type === 'image');

                const rawReferenceImages = getReferenceImageUrls(imageNodes.map(n => n?.data?.src));
                const referenceImageUrls = forbidReferenceImage ? [] : rawReferenceImages;

                if (requiresReferenceImage) {
                    const requiredCount = referenceMode === 'start_end' ? 2 : 1;
                    if (referenceImageUrls.length < requiredCount) {
                        throw new Error(referenceMode === 'start_end'
                            ? 'Selected video model needs start and end frames (connect two images).'
                            : 'Selected video model requires at least one reference image node');
                    }
                }

                const resolveReferenceAspectRatio = () => {
                    const referenceNode = imageNodes.find((n) => {
                        const width = Number(n?.data?.naturalWidth);
                        const height = Number(n?.data?.naturalHeight);
                        return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
                    });
                    if (referenceNode) {
                        const width = Number(referenceNode.data.naturalWidth);
                        const height = Number(referenceNode.data.naturalHeight);
                        const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
                        const ratio = gcd(Math.round(width), Math.round(height));
                        return `${Math.round(width) / ratio}:${Math.round(height) / ratio}`;
                    }
                    const fallbackAspect = imageNodes.find((n) => typeof n?.data?.aspectRatio === 'string')?.data?.aspectRatio;
                    return fallbackAspect || undefined;
                };

                const effectiveAspectRatio = resolveAspectRatio(modelId, modelParams) || resolveReferenceAspectRatio();
                const effectiveModelParams = modelParams;

                // ============================================
                // Create pending video node - Loro will handle generation
                // Same pattern as image generation
                // ============================================
                const pendingNodeId = assetName;

                // Extract meaningful label from prompt
                const generatedLabel = extractLabelFromPrompt(prompt, 'Generated Video');

                const durationValue = modelParams.duration ?? 5;
                const durationNumber = typeof durationValue === 'string' ? parseInt(durationValue, 10) : Number(durationValue) || 5;

                // Create the pending video node in React state
                const newNode = addNodeWithAutoLayout(
                    {
                        id: pendingNodeId,
                        type: 'video',
                        data: {
                            label: generatedLabel,
                            src: '', // Empty src = generating
                            status: 'pending',
                            prompt: prompt, // Loro uses this for generation
                            referenceImageUrls, // Pass reference images
                            duration: durationNumber,
                            model: modelId,
                            modelId,
                            modelParams: effectiveModelParams,
                            referenceMode,
                            aspectRatio: effectiveAspectRatio,
                        },
                    },
                    id
                );

                if (!newNode) {
                    throw new Error('Failed to create pending video node.');
                }

                // Sync pending node to Loro - server will detect and process
                if (loroSync?.connected) {
                    loroSync.addNode(newNode.id, newNode);
                } else {
                    console.warn('[ActionBadge] ⚠️ loroSync not connected - node will not be processed');
                }

                // Add edge
                const edgeId = `${id}-${pendingNodeId}`;
                addEdges({
                    id: edgeId,
                    source: id,
                    target: pendingNodeId,
                    type: 'default',
                });

                // Sync edge
                if (loroSync?.connected) {
                    loroSync.addEdge(edgeId, {
                        id: edgeId,
                        source: id,
                        target: pendingNodeId,
                        type: 'default',
                    });
                }

                // Update ActionBadge status
                setNodes((nds) => nds.map((n) => {
                    if (n.id === id) {
                        return {
                            ...n,
                            data: {
                                ...n.data,
                                preAllocatedAssetId: undefined,
                                status: 'success'
                            }
                        };
                    }
                    return n;
                }));

            }

        } catch (err: any) {
            setError(err.message);
            console.error('Execution error:', err);
        } finally {
            setIsExecuting(false);
        }
    }, [
        id,
        content,
        data.prompt,
        data.preAllocatedAssetId,
        projectId,
        actionType,
        modelParams,
        modelId,
        referenceMode,
        referenceRequirement,
        getEdges,
        getNodes,
        setNodes,
        addNodeWithAutoLayout,
        loroSync,
        addEdges
    ]);

    // Helper to extract meaningful label from prompt content (already moved outside)


    // Execute action: generate image or video
    useEffect(() => {
        const requiredUpstreams: string[] = Array.isArray(data.upstreamNodeIds) ? data.upstreamNodeIds : [];

        if (data.autoRun && !isExecuting) {
            if (requiredUpstreams.length > 0) {
                const connectedSources = edges.filter(e => e.target === id).map(e => e.source);
                const allConnected = requiredUpstreams.every((uid: string) => connectedSources.includes(uid));

                if (!allConnected) {
                    return;
                }
            }

            // Clear the flag to prevent infinite loops
            data.autoRun = false;

            // Small delay to ensure React Flow state is fully synced
            setTimeout(() => {
                handleExecute();
            }, 500);
        }
    }, [data, data.autoRun, edges, data.upstreamNodeIds, id, isExecuting, handleExecute]);

    const renderParamControl = (param: ModelParameter) => {
        const currentValue = modelParams[param.id] ?? param.defaultValue ?? (param.type === 'boolean' ? false : '');

        if (param.type === 'slider') {
            const numericValue = typeof currentValue === 'number' ? currentValue : Number(currentValue ?? 0);
            return (
                <div key={param.id} className="space-y-1">
                    <div className="flex justify-between text-[10px] font-medium text-white/70">
                        <span>{param.label}</span>
                        <span>{numericValue}</span>
                    </div>
                    <input
                        type="range"
                        min={param.min ?? 0}
                        max={param.max ?? 1}
                        step={param.step ?? 1}
                        value={numericValue}
                        onChange={(e) => updateModelParam(param.id, Number(e.target.value))}
                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-400"
                    />
                    {param.description && (
                        <p className="text-[10px] text-white/50 leading-snug">{param.description}</p>
                    )}
                </div>
            );
        }

        if (param.type === 'select') {
            const options = param.options ?? [];
            const selected = options.find((opt) => String(opt.value) === String(currentValue))?.value ?? options[0]?.value ?? '';
            return (
                <div key={param.id} className="space-y-1">
                    <div className="flex justify-between text-[10px] font-medium text-white/70">
                        <span>{param.label}</span>
                    </div>
                    <select
                        className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-xs font-semibold text-white focus:outline-none"
                        value={String(selected)}
                        onChange={(e) => {
                            const next = options.find((opt) => String(opt.value) === e.target.value);
                            updateModelParam(param.id, next ? next.value : e.target.value);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        {options.map((opt) => (
                            <option key={`${param.id}-${opt.label}`} value={String(opt.value)} className="bg-[#1a1a1a] text-white">
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    {param.description && (
                        <p className="text-[10px] text-white/50 leading-snug">{param.description}</p>
                    )}
                </div>
            );
        }

        if (param.type === 'number') {
            return (
                <div key={param.id} className="space-y-1">
                    <div className="flex justify-between text-[10px] font-medium text-white/70">
                        <span>{param.label}</span>
                    </div>
                    <input
                        type="number"
                        min={param.min}
                        max={param.max}
                        step={param.step}
                        value={currentValue as number | string}
                        onChange={(e) => updateModelParam(param.id, Number(e.target.value))}
                        className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-xs font-semibold text-white focus:outline-none"
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                    {param.description && (
                        <p className="text-[10px] text-white/50 leading-snug">{param.description}</p>
                    )}
                </div>
            );
        }

        if (param.type === 'text') {
            return (
                <div key={param.id} className="space-y-1">
                    <div className="flex justify-between text-[10px] font-medium text-white/70">
                        <span>{param.label}</span>
                    </div>
                    <textarea
                        rows={2}
                        value={String(currentValue)}
                        onChange={(e) => updateModelParam(param.id, e.target.value)}
                        placeholder={param.placeholder}
                        className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-xs font-semibold text-white focus:outline-none resize-none"
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                    {param.description && (
                        <p className="text-[10px] text-white/50 leading-snug">{param.description}</p>
                    )}
                </div>
            );
        }

        if (param.type === 'boolean') {
            return (
                <label key={param.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 border border-white/10 cursor-pointer">
                    <div className="flex flex-col">
                        <span className="text-xs font-semibold">{param.label}</span>
                        {param.description && (
                            <span className="text-[10px] text-white/50">{param.description}</span>
                        )}
                    </div>
                    <input
                        type="checkbox"
                        checked={Boolean(currentValue)}
                        onChange={(e) => updateModelParam(param.id, e.target.checked)}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="h-4 w-4 accent-blue-400"
                    />
                </label>
            );
        }

        return null;
    };

    // Modal content (from PromptNode)
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
                className="group relative"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => {
                    setIsHovered(false);
                    setShowModelDropdown(false);
                }}
            >
                {/* Floating Title Input */}
                <div
                    className="absolute -top-8 left-4 z-10"
                    onDoubleClick={(e) => e.stopPropagation()}
                >
                    <input
                        className={`bg-transparent text-lg font-bold font-display ${colorClass} focus:outline-none`}
                        value={label}
                        onChange={handleLabelChange}
                        placeholder="Prompt"
                    />
                </div>

                {/* Main Node Container */}
                <div 
                    className={`w-[320px] h-[220px] ${bgClass} rounded-xl flex flex-col overflow-hidden transition-all duration-300 hover:shadow-xl ${
                        selected ? `ring-4 ${ringClass} ring-offset-2` : 'ring-1 ring-gray-200'
                    }`}
                    onDoubleClick={handleDoubleClick}
                >
                    {/* Content Preview Area */}
                    <div className="flex-1 p-4 relative overflow-hidden cursor-pointer flex flex-col">
                        {/* Prompt Area (No scrollbar, pure fade-out) */}
                        <div className="flex-1 relative overflow-hidden mb-1">
                            {/* Prompt Text */}
                            <div className="prose prose-sm prose-slate prose-p:text-gray-600 prose-headings:text-gray-800 prose-p:leading-tight">
                                <MarkdownPreview content={content} />
                            </div>
                            
                            {/* Bottom fade-out overlay to indicate overflow without scrollbar */}
                            <div className={`absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-${actionType === 'video-gen' ? 'red' : 'blue'}-50 to-transparent pointer-events-none`} />
                        </div>
                        
                        {/* Reference Images Section (Compact) */}
                        {(() => {
                            // Get connected image nodes
                            const incomingEdges = edges.filter(e => e.target === id);
                            const nodes = getNodes();
                            const connectedImages = incomingEdges
                                .map(e => nodes.find(n => n.id === e.source))
                                .filter(n => n?.type === 'image' && n?.data?.src)
                                .map(n => ({
                                    id: n!.id,
                                    src: n!.data.src,
                                    label: n!.data.label || 'Image'
                                }));
                            
                            if (connectedImages.length === 0) return null;
                            
                            return (
                                <div className="space-y-1 pt-1.5 border-t border-gray-200/40 flex-shrink-0">
                                    <div className="flex items-center gap-1">
                                        <ImageIcon size={9} weight="fill" className={`${colorClass} opacity-50`} />
                                        <span className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">
                                            Refs ({connectedImages.length})
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1 pb-0.5">
                                        {connectedImages.map((img) => (
                                            <div
                                                key={img.id}
                                                className="relative"
                                                title={img.label}
                                            >
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={resolveAssetUrl(img.src)}
                                                    alt={img.label}
                                                    className={`w-8 h-8 object-cover rounded-md border-[1.5px] transition-all ${
                                                        actionType === 'video-gen' 
                                                            ? 'border-red-100 hover:border-red-300' 
                                                            : 'border-blue-100 hover:border-blue-300'
                                                    } shadow-sm hover:scale-105`}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    {/* Control Bar */}
                    <div className="px-3 py-2 bg-white/60 backdrop-blur-sm border-t border-gray-200/50 flex items-center gap-2">
                        {/* Type Switch Button */}
                        <button
                            className={`nodrag flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-all hover:scale-105 active:scale-95 ${
                                actionType === 'video-gen' ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                            }`}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleTypeSwitch();
                            }}
                            title={`Switch to ${actionType === 'video-gen' ? 'Image' : 'Video'} Generation`}
                        >
                            <ArrowsInLineVertical size={16} weight="bold" />
                        </button>

                        {/* Model Display */}
                        <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">Model</span>
                            <span className="text-xs font-bold text-slate-900 truncate">{modelDisplay}</span>
                            {providerDisplay && (
                                <span className="text-[10px] text-slate-500 truncate">{providerDisplay}</span>
                            )}
                        </div>

                        {/* Count Display */}
                        <div className="flex flex-col items-center min-w-[32px]">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">Count</span>
                            <span className="text-xs font-bold text-slate-900">{countValue}</span>
                        </div>

                        {/* Execution Button */}
                        <button
                            className={`nodrag flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                                actionType === 'video-gen' ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                            }`}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleExecute();
                            }}
                            disabled={isExecuting}
                            title={error || (isExecuting ? 'Generating...' : 'Execute')}
                        >
                            {isExecuting ? (
                                <Spinner size={16} className="animate-spin" />
                            ) : (
                                <Play size={16} weight="fill" />
                            )}
                        </button>
                    </div>

                    {error && (
                        <div className="absolute -bottom-6 left-0 text-[10px] text-red-500 whitespace-nowrap">
                            {error}
                        </div>
                    )}
                </div>

                {/* Dark Hover Configuration Panel */}
                <div className={`
                    absolute top-full mt-3 w-72 rounded-2xl bg-[#1a1a1a] p-4 shadow-2xl border border-[#333] z-30 origin-top transition-all duration-200 nodrag
                    ${isHovered ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'}
                `}>
                    <div className="absolute -top-4 left-0 w-full h-4 bg-transparent" />
                    <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#1a1a1a] rotate-45 border-t border-l border-[#333]" />

                    <div className="flex flex-col gap-4 text-white" onMouseDown={(e) => e.stopPropagation()}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                                <div className={`h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center ${colorClass}`}>
                                    <Icon size={18} weight="fill" />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="text-sm font-bold leading-tight">{modelDisplay}</span>
                                    <span className="text-[11px] text-white/60">{providerDisplay || 'Model card'}</span>
                                    {selectedModel?.description && (
                                        <p className="text-[11px] text-white/70 leading-snug">{selectedModel.description}</p>
                                    )}
                                    <div className="flex flex-wrap gap-1">
                                        <span className="px-2 py-0.5 rounded-full bg-white/5 text-[10px] uppercase tracking-widest">
                                            {selectedModel?.kind === 'video' ? 'Video' : 'Image'}
                                        </span>
                                        {selectedModel?.input.referenceImage === 'required' && (
                                            <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-[10px] text-red-100">
                                                Needs reference image
                                            </span>
                                        )}
                                        {selectedModel?.input.referenceImage === 'forbidden' && (
                                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-[10px] text-emerald-100">
                                                No reference needed
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="relative w-40">
                                <button
                                    className="w-full bg-white/5 rounded-lg p-2 flex flex-col gap-1 hover:bg-white/10 transition-colors cursor-pointer border border-white/10"
                                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                                >
                                    <span className="text-[10px] text-white/40 font-medium">Model</span>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold truncate">{modelDisplay}</span>
                                        <CaretDown size={10} className="text-white/40" />
                                    </div>
                                </button>
                                {showModelDropdown && (
                                    <div className="absolute right-0 top-full mt-1 w-full bg-[#2a2a2a] border border-[#333] rounded-lg shadow-xl overflow-hidden z-50 flex flex-col">
                                        {availableModels.map((card) => (
                                            <div
                                                key={card.id}
                                                className={`px-3 py-2 text-xs cursor-pointer transition-colors ${card.id === modelId ? 'bg-blue-500 text-white' : 'text-white/80 hover:bg-white/10'}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleModelChange(card.id);
                                                    setShowModelDropdown(false);
                                                }}
                                            >
                                                <div className="font-bold leading-tight">{card.name}</div>
                                                <div className="text-[10px] text-white/60">{card.provider}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-3 pt-1">
                            {selectedModel?.parameters.map(renderParamControl)}
                        </div>
                    </div>
                </div>

                {/* Handles */}
                <Handle
                    type="target"
                    position={Position.Left}
                    style={{ left: -6, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, zIndex: 100, background: '#94a3b8', border: '2px solid white' }}
                    className="transition-all hover:scale-125 shadow-sm hover:!bg-slate-600"
                />

                {/* Output handle (hidden, for programmatic connections) */}
                <Handle
                    type="source"
                    position={Position.Right}
                    isConnectable={false}
                    className="!h-3 !w-3 !translate-x-1 !border-2 !border-white !bg-slate-400 transition-all hover:scale-125 shadow-sm hover:!bg-slate-600 z-10 !opacity-0 !pointer-events-none"
                />
            </div>

            {/* Render modal in portal */}
            {typeof window !== 'undefined' && modalContent && createPortal(modalContent, document.body)}
        </>
    );
};

// Simple markdown preview component (from PromptNode)
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

export default memo(PromptActionNode);
