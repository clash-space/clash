import { memo, useState, useEffect, useCallback, useMemo } from 'react';
import { Handle, Position, Node, NodeProps, useReactFlow, useEdges } from 'reactflow';
import { VideoCamera, Image as ImageIcon, CaretDown, X, Play, Spinner, PuzzlePiece } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useProject } from '../ProjectContext';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { useLayoutManager } from '@/lib/layout';
import { generateSemanticId } from '@/lib/utils/semanticId';
import MilkdownEditor from '../MilkdownEditor';
import { resolveAssetUrl, isR2Key } from '../../../lib/utils/assets';
import { MODEL_CARDS, resolveAspectRatio, parsePromptParts, extractPromptText, extractAssetRefs, type ModelCard, type ModelParameter, type CustomActionDefinition } from '@clash/shared-types';
import { applyLayoutPatchesToLoro, collectLayoutNodePatches } from '../../lib/loroNodeSync';
import { useCustomActions } from '../../hooks/useCustomActions';

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
    const [showPanel, setShowPanel] = useState(false);
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

    const [actionType, setActionType] = useState<string>(data.actionType || 'image-gen');
    const isCustom = actionType.startsWith('custom:');
    const customActionId = isCustom ? actionType.replace('custom:', '') : null;

    // Get custom action definitions from Loro
    const customActions = useCustomActions(loroSync?.doc ?? null);
    const customDef: CustomActionDefinition | undefined = customActionId
        ? customActions.find((a) => a.id === customActionId)
        : undefined;

    // Custom action params state
    const [customActionParams, setCustomActionParams] = useState<ModelParams>(
        (data.customActionParams as ModelParams) ?? {}
    );

    const initialModelId = isCustom ? '' :
        mapLegacyModelId(actionType as 'image-gen' | 'video-gen', data.modelId as string | undefined, data.modelName) ||
        (MODEL_CARDS.find((card) => card.kind === (actionType === 'video-gen' ? 'video' : 'image'))?.id ??
            (actionType === 'video-gen' ? 'sora-2-image-to-video' : 'nano-banana-2'));

    const [modelId, setModelId] = useState<string>(initialModelId);
    const [modelParams, setModelParams] = useState<ModelParams>({
        ...(MODEL_CARDS.find((card) => card.id === initialModelId)?.defaultParams ?? {}),
        ...(data.modelParams ?? {}),
    });

    const Icon = isCustom ? PuzzlePiece : actionType === 'video-gen' ? VideoCamera : ImageIcon;
    const colorClass = isCustom ? 'text-purple-500' : actionType === 'video-gen' ? 'text-red-500' : 'text-blue-500';
    const bgClass = isCustom ? 'bg-purple-50' : actionType === 'video-gen' ? 'bg-red-50' : 'bg-blue-50';
    const ringClass = isCustom ? 'ring-purple-500' : actionType === 'video-gen' ? 'ring-red-500' : 'ring-blue-500';

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

            // Parse mixed-modality prompt: extract text + @-mentioned asset references
            const promptParts = parsePromptParts(prompt);
            const promptText = extractPromptText(promptParts);
            const inlineAssetRefs = extractAssetRefs(promptParts);

            // Resolve inline @-mentioned image URLs
            const inlineImageUrls = inlineAssetRefs
                .map((ref) => {
                    const refNode = getNodes().find((n) => n.id === ref.nodeId);
                    return refNode?.data?.src as string | undefined;
                })
                .filter((src): src is string => !!src);

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

            // ── Custom Action Execution ──────────────────────
            if (isCustom && customDef) {
                const pendingNodeId = assetName;
                const outputType = customDef.outputType || 'image';
                const generatedLabel = extractLabelFromPrompt(prompt, `${customDef.name} Result`);

                const pendingData: Record<string, unknown> = {
                    label: generatedLabel,
                    status: 'pending',
                    actionType,
                    customActionId: customDef.id,
                    customActionParams,
                    prompt,
                    outputType,
                };

                // For image/video outputs, set empty src so NodeProcessor detects it
                if (outputType !== 'text') {
                    pendingData.src = '';
                }

                const pendingNodeType = outputType === 'text' ? 'text' : outputType; // 'image' | 'video' | 'text'

                const newNode = addNodeWithAutoLayout(
                    {
                        id: pendingNodeId,
                        type: pendingNodeType,
                        data: pendingData,
                    },
                    id
                );

                if (!newNode) {
                    throw new Error('Failed to create pending node.');
                }

                if (loroSync?.connected) {
                    loroSync.addNode(newNode.id, newNode);
                }

                const edgeId = `${id}-${pendingNodeId}`;
                addEdges({ id: edgeId, source: id, target: pendingNodeId, type: 'default' });
                if (loroSync?.connected) {
                    loroSync.addEdge(edgeId, { id: edgeId, source: id, target: pendingNodeId, type: 'default' });
                }

                setNodes((nds) => nds.map((n) => {
                    if (n.id === id) {
                        return { ...n, data: { ...n.data, preAllocatedAssetId: undefined, status: 'success' } };
                    }
                    return n;
                }));

            } else if (actionType === 'image-gen') {
                // Collect connected images for reference
                const imageNodes = connectedNodes.filter(n => n?.type === 'image');
                const rawReferenceImages = getReferenceImageUrls(imageNodes.map(n => n?.data?.src));
                const connectedImageUrls = forbidReferenceImage ? [] : rawReferenceImages;

                // Merge: inline @-refs + edge-connected images (deduplicate)
                const referenceImageUrls = [...new Set([...inlineImageUrls, ...connectedImageUrls])];

                if (requiresReferenceImage && referenceImageUrls.length === 0) {
                    throw new Error('Selected model requires at least one reference image.');
                }

                // ============================================
                // Create pending node - Loro will handle generation
                // ============================================
                const pendingNodeId = assetName;

                // Extract meaningful label from prompt text (without @-mention syntax)
                const generatedLabel = extractLabelFromPrompt(promptText, 'Generated Image');


                // Create the pending node in React state
                const newNode = addNodeWithAutoLayout(
                    {
                        id: pendingNodeId,
                        type: 'image',
                        data: {
                            label: generatedLabel,
                            src: '', // Empty src = generating
                            status: 'pending',
                            prompt: promptText, // Send clean text to generation API
                            referenceImageUrls, // Pass merged reference images
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
                const connectedVideoImageUrls = forbidReferenceImage ? [] : rawReferenceImages;
                // For start_end mode, only use connected images (not inline @-refs)
                // For other modes, merge inline + connected
                const referenceImageUrls = referenceMode === 'start_end'
                    ? connectedVideoImageUrls
                    : [...new Set([...inlineImageUrls, ...connectedVideoImageUrls])];

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
                const generatedLabel = extractLabelFromPrompt(promptText, 'Generated Video');

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
                            prompt: promptText, // Send clean text to generation API
                            referenceImageUrls, // Pass merged reference images
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
        addEdges,
        isCustom,
        customDef,
        customActionParams
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
                    <div className="flex justify-between text-[10px] font-medium text-gray-500">
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
                        className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-gray-900"
                    />
                    {param.description && (
                        <p className="text-[10px] text-gray-400 leading-snug">{param.description}</p>
                    )}
                </div>
            );
        }

        if (param.type === 'select') {
            const options = param.options ?? [];
            const selected = options.find((opt) => String(opt.value) === String(currentValue))?.value ?? options[0]?.value ?? '';
            return (
                <div key={param.id} className="space-y-1">
                    <div className="flex justify-between text-[10px] font-medium text-gray-500">
                        <span>{param.label}</span>
                    </div>
                    <select
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 focus:outline-none focus:border-gray-400 transition-colors"
                        value={String(selected)}
                        onChange={(e) => {
                            const next = options.find((opt) => String(opt.value) === e.target.value);
                            updateModelParam(param.id, next ? next.value : e.target.value);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        {options.map((opt) => (
                            <option key={`${param.id}-${opt.label}`} value={String(opt.value)}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    {param.description && (
                        <p className="text-[10px] text-gray-400 leading-snug">{param.description}</p>
                    )}
                </div>
            );
        }

        if (param.type === 'number') {
            return (
                <div key={param.id} className="space-y-1">
                    <div className="flex justify-between text-[10px] font-medium text-gray-500">
                        <span>{param.label}</span>
                    </div>
                    <input
                        type="number"
                        min={param.min}
                        max={param.max}
                        step={param.step}
                        value={currentValue as number | string}
                        onChange={(e) => updateModelParam(param.id, Number(e.target.value))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 focus:outline-none focus:border-gray-400 transition-colors"
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                    {param.description && (
                        <p className="text-[10px] text-gray-400 leading-snug">{param.description}</p>
                    )}
                </div>
            );
        }

        if (param.type === 'text') {
            return (
                <div key={param.id} className="space-y-1">
                    <div className="flex justify-between text-[10px] font-medium text-gray-500">
                        <span>{param.label}</span>
                    </div>
                    <textarea
                        rows={2}
                        value={String(currentValue)}
                        onChange={(e) => updateModelParam(param.id, e.target.value)}
                        placeholder={param.placeholder}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 focus:outline-none focus:border-gray-400 resize-none transition-colors"
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                    {param.description && (
                        <p className="text-[10px] text-gray-400 leading-snug">{param.description}</p>
                    )}
                </div>
            );
        }

        if (param.type === 'boolean') {
            return (
                <label key={param.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 border border-slate-200 cursor-pointer">
                    <div className="flex flex-col">
                        <span className="text-xs font-medium text-gray-900">{param.label}</span>
                        {param.description && (
                            <span className="text-[10px] text-gray-400">{param.description}</span>
                        )}
                    </div>
                    <input
                        type="checkbox"
                        checked={Boolean(currentValue)}
                        onChange={(e) => updateModelParam(param.id, e.target.checked)}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="h-4 w-4 accent-gray-900"
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
                                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors"
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
                        <MilkdownEditor
                            value={content}
                            onChange={setContent}
                            mentionableNodes={(() => {
                                const allNodes = getNodes();
                                return allNodes
                                    .filter((n) => ['image', 'video', 'text'].includes(n.type))
                                    .map((n) => ({
                                        id: n.id,
                                        type: n.type,
                                        label: (n.data.label as string) || n.id,
                                        src: n.data.src as string | undefined,
                                    }));
                            })()}
                            inputModalities={
                                isCustom
                                    ? (customDef?.inputModalities ?? ['text'])
                                    : (selectedModel?.input.modalities ?? ['text'])
                            }
                            connectedNodeIds={
                                edges.filter((e) => e.target === id).map((e) => e.source)
                            }
                            onMentionAdded={(referencedNodeId) => {
                                const edgeId = `${referencedNodeId}-${id}`;
                                addEdges({ id: edgeId, source: referencedNodeId, target: id, type: 'default' });
                                if (loroSync?.connected) {
                                    loroSync.addEdge(edgeId, { id: edgeId, source: referencedNodeId, target: id, type: 'default' });
                                }
                            }}
                        />
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    ) : null;

    // Computed display name for the badge
    const badgeDisplayName = isCustom
        ? (customDef?.name || customActionId || 'Custom')
        : (selectedModel?.name || modelId || (actionType === 'video-gen' ? 'Video' : 'Image'));

    // Bottom config panel content (portalled)
    const configPanel = showPanel ? (
        <AnimatePresence>
            <div className="fixed inset-0 z-[9998]" onClick={() => { setShowPanel(false); setShowModelDropdown(false); }}>
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-white/30 backdrop-blur-sm"
                />

                {/* Bottom Panel */}
                <motion.div
                    initial={{ y: '100%', opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: '100%', opacity: 0 }}
                    transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                    className="absolute bottom-0 left-0 right-0 flex justify-center pointer-events-none"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="pointer-events-auto w-full max-w-lg mb-6 mx-4 rounded-2xl bg-white/90 backdrop-blur-xl p-5 shadow-lg border border-slate-200">
                        {/* Panel Header */}
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${
                                    isCustom ? 'bg-gray-100 text-gray-600' :
                                    actionType === 'video-gen' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'
                                }`}>
                                    <Icon size={18} weight="bold" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-display font-bold text-gray-900 leading-tight">
                                        {isCustom ? (customDef?.name || customActionId) : modelDisplay}
                                    </h3>
                                    <p className="text-[11px] text-gray-500">
                                        {isCustom ? (customDef?.description || 'Custom action') : (providerDisplay || 'Configure parameters')}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => { setShowPanel(false); setShowModelDropdown(false); }}
                                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                            >
                                <X size={16} weight="bold" />
                            </button>
                        </div>

                        {/* Tags */}
                        <div className="flex flex-wrap gap-1.5 mb-4">
                            {isCustom ? (
                                <>
                                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-gray-600 font-medium uppercase tracking-wider">
                                        {customDef?.outputType || 'image'}
                                    </span>
                                    {customDef?.runtime === 'worker' ? (
                                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-gray-600 font-medium">
                                            ☁️ Cloud{customDef.version ? ` · v${customDef.version}` : ''}
                                        </span>
                                    ) : (
                                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-gray-500 font-medium uppercase tracking-wider">
                                            🖥 Local
                                        </span>
                                    )}
                                    {customDef?.author && (
                                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-gray-400 font-medium">
                                            @{customDef.author}
                                        </span>
                                    )}
                                </>
                            ) : (
                                <>
                                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-gray-500 font-medium uppercase tracking-wider">
                                        {selectedModel?.kind === 'video' ? 'Video' : 'Image'}
                                    </span>
                                    {selectedModel?.input.referenceImage === 'required' && (
                                        <span className="px-2 py-0.5 rounded-full bg-red-50 text-[10px] text-red-600 font-medium">
                                            Ref required
                                        </span>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Model Selector (for built-in actions) */}
                        {!isCustom && (
                            <div className="mb-4">
                                <div className="relative">
                                    <button
                                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
                                        onClick={() => setShowModelDropdown(!showModelDropdown)}
                                    >
                                        <div className="flex flex-col items-start">
                                            <span className="text-[10px] text-gray-400 font-medium">Model</span>
                                            <span className="text-xs font-bold text-gray-900">{modelDisplay}</span>
                                        </div>
                                        <CaretDown size={12} className="text-gray-400" />
                                    </button>
                                    {showModelDropdown && (
                                        <div className="absolute left-0 right-0 bottom-full mb-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50 max-h-48 overflow-y-auto">
                                            {availableModels.map((card) => (
                                                <div
                                                    key={card.id}
                                                    className={`px-3 py-2 text-xs cursor-pointer transition-colors ${
                                                        card.id === modelId ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'
                                                    }`}
                                                    onClick={() => {
                                                        handleModelChange(card.id);
                                                        setShowModelDropdown(false);
                                                    }}
                                                >
                                                    <div className="font-bold leading-tight">{card.name}</div>
                                                    <div className={`text-[10px] ${card.id === modelId ? 'text-gray-300' : 'text-gray-400'}`}>{card.provider}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Parameters */}
                        <div className="space-y-3">
                            {isCustom && customDef ? (
                                customDef.parameters.map((param) =>
                                    renderParamControl({
                                        ...param,
                                        id: param.id,
                                        label: param.label,
                                        type: param.type as ModelParameter['type'],
                                        defaultValue: param.defaultValue,
                                        options: param.options?.map((o) =>
                                            typeof o === 'string' ? { label: o, value: o } : o
                                        ),
                                        min: param.min,
                                        max: param.max,
                                        step: param.step,
                                    } as ModelParameter)
                                )
                            ) : (
                                selectedModel?.parameters.map(renderParamControl)
                            )}
                        </div>

                        {/* Prompt preview */}
                        <div className="mt-4 pt-3 border-t border-slate-200">
                            <button
                                onClick={(e) => { e.stopPropagation(); setShowPanel(false); handleDoubleClick(); }}
                                className="w-full text-left px-3 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors border border-slate-200"
                            >
                                <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Prompt</span>
                                <p className="text-xs text-gray-600 line-clamp-2 leading-snug mt-0.5">
                                    {content && content !== '# Prompt\nEnter your prompt here...'
                                        ? extractLabelFromPrompt(content, 'Click to edit prompt...')
                                        : 'Click to edit prompt...'}
                                </p>
                            </button>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    ) : null;

    return (
        <>
            <div className="group relative">
                {/* Compact Badge */}
                <div
                    className={`w-[200px] ${bgClass} rounded-xl overflow-hidden transition-all duration-300 hover:shadow-lg cursor-pointer ${
                        selected ? `ring-4 ${ringClass} ring-offset-2` : 'ring-1 ring-slate-200'
                    }`}
                    onClick={() => setShowPanel(!showPanel)}
                >
                    {/* Top Row: Icon + Label */}
                    <div className="flex items-center gap-2 px-3 py-2.5" onDoubleClick={(e) => { e.stopPropagation(); handleDoubleClick(); }}>
                        <div className={`flex-shrink-0 ${colorClass}`}>
                            <Icon size={16} weight="fill" />
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                            <input
                                className={`bg-transparent text-xs font-bold font-display ${colorClass} focus:outline-none w-full truncate nodrag`}
                                value={label}
                                onChange={handleLabelChange}
                                placeholder="Action"
                                onClick={(e) => e.stopPropagation()}
                            />
                            <span className="text-[10px] text-slate-400 truncate leading-none">
                                {badgeDisplayName}
                            </span>
                        </div>
                    </div>

                    {/* Bottom Row: Execute */}
                    <div className="flex items-center gap-1 px-2 pb-2">
                        <div className="flex-1" />
                        <button
                            className={`nodrag flex h-7 items-center gap-1.5 px-3 rounded-lg text-xs font-semibold transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                                isCustom ? 'bg-purple-500 text-white hover:bg-purple-600' :
                                actionType === 'video-gen' ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-blue-500 text-white hover:bg-blue-600'
                            }`}
                            onClick={(e) => { e.stopPropagation(); handleExecute(); }}
                            disabled={isExecuting}
                        >
                            {isExecuting ? (
                                <Spinner size={12} className="animate-spin" />
                            ) : (
                                <Play size={12} weight="fill" />
                            )}
                            {isExecuting ? 'Running' : 'Run'}
                        </button>
                    </div>

                    {error && (
                        <div className="px-3 pb-1.5 text-[10px] text-red-500 truncate">
                            {error}
                        </div>
                    )}
                </div>

                {/* Handles — consistent with ImageNode/VideoNode */}
                <Handle
                    type="target"
                    position={Position.Left}
                    style={{ left: -8, top: '50%', transform: 'translateY(-50%)', zIndex: 100 }}
                    className="!h-4 !w-4 !border-4 !border-white !bg-slate-400 transition-all hover:scale-125 shadow-sm hover:!bg-blue-500"
                />
                <Handle
                    type="source"
                    position={Position.Right}
                    isConnectable={false}
                    className="!h-4 !w-4 !translate-x-1 !border-4 !border-white !bg-slate-400 transition-all hover:scale-125 shadow-sm hover:!bg-slate-600 z-10 !opacity-0 !pointer-events-none"
                />
            </div>

            {/* Portalled panels */}
            {typeof window !== 'undefined' && modalContent && createPortal(modalContent, document.body)}
            {typeof window !== 'undefined' && configPanel && createPortal(configPanel, document.body)}
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
