import { memo, useState, useEffect, useCallback, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Handle, Position, type Node as RFNode, NodeProps, useReactFlow, useEdges } from 'reactflow';
import { VideoCamera, Image as ImageIcon, CaretDown, X, Play, Spinner, PuzzlePiece } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useProject } from '../ProjectContext';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { useLayoutManager } from '@/lib/layout';
import { generateSemanticId } from '@/lib/utils/semanticId';
import { SignedImg } from '../SignedMedia';
import { getSignedUrl } from '../../../lib/hooks/useSignedUrl';
import { MODEL_CARDS, resolveAspectRatio, validateGenerationInput, parsePromptParts, extractPromptText, extractAssetRefs, buildMention, type ModelCard, type ModelParameter, type CustomActionDefinition } from '@clash/shared-types';
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

    // @ mention state
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [showMentionMenu, setShowMentionMenu] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionCursor, setMentionCursor] = useState(0);
    const [mentionIndex, setMentionIndex] = useState(0);

    // React Flow hooks
    const { projectId } = useProject();
    const { getNodes, addEdges, setNodes } = useReactFlow();
    const loroSync = useOptionalLoroSyncContext();
    const edges = useEdges();
    const onNodesMutated = useCallback(
        (prevNodes: RFNode[], nextNodes: RFNode[]) => {
            if (!loroSync?.connected) return;
            const patches = collectLayoutNodePatches(prevNodes, nextNodes);
            applyLayoutPatchesToLoro(loroSync, patches);
        },
        [loroSync]
    );
    const { addNodeWithAutoLayout } = useLayoutManager({ onNodesMutated });

    // Prompt editing state
    const cleanContent = (val: string | undefined) => {
        if (!val) return '';
        // Strip legacy default placeholder
        if (val.trim() === '# Prompt\nEnter your prompt here...' || val.trim() === '# Prompt\n\nEnter your prompt here...') return '';
        return val;
    };
    const [label, setLabel] = useState(data.label || 'Prompt');
    const [content, setContent] = useState(cleanContent(data.content));

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

    const editorRef = useRef<HTMLDivElement>(null);

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
    const colorClass = isCustom ? 'text-custom' : actionType === 'video-gen' ? 'text-video' : 'text-image';
    const bgClass = isCustom ? 'bg-custom-light' : actionType === 'video-gen' ? 'bg-video-light' : 'bg-image-light';
    const ringClass = isCustom ? 'ring-custom' : actionType === 'video-gen' ? 'ring-video' : 'ring-image';
    const btnClass = isCustom ? 'bg-custom hover:opacity-90' : actionType === 'video-gen' ? 'bg-video hover:opacity-90' : 'bg-image hover:opacity-90';

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
    const countValue = Number(modelParams.count ?? 1);

    // @ mention: mentionable nodes (with src for thumbnails)
    const mentionableNodes = useMemo(() => {
        const modalities = isCustom
            ? (customDef?.promptModalities ?? ['text'])
            : (selectedModel?.input.promptModalities ?? ['text']);
        const allNodes = getNodes();
        return allNodes
            .filter((n) => modalities.includes(n.type as any))
            .map((n) => ({
                id: n.id,
                type: n.type as string,
                label: (n.data.label as string) || n.id,
                src: n.data.src as string | undefined,
            }));
    }, [getNodes, isCustom, customDef, selectedModel]);

    const filteredMentionNodes = useMemo(() => {
        if (!mentionQuery) return mentionableNodes;
        return mentionableNodes.filter((n) =>
            n.label.toLowerCase().includes(mentionQuery) || n.id.toLowerCase().includes(mentionQuery)
        );
    }, [mentionableNodes, mentionQuery]);

    // Pre-resolve signed URLs for mentionable node thumbnails (used in contentToHtml)
    const [signedUrlMap, setSignedUrlMap] = useState<Record<string, string>>({});
    useEffect(() => {
        let cancelled = false;
        const srcs = mentionableNodes.filter((n) => n.src).map((n) => n.src!);
        if (srcs.length === 0) return;
        Promise.all(srcs.map(async (src) => {
            const url = await getSignedUrl(src);
            return [src, url] as const;
        })).then((entries) => {
            if (cancelled) return;
            setSignedUrlMap(Object.fromEntries(entries));
        });
        return () => { cancelled = true; };
    }, [mentionableNodes]);

    // Render content string → HTML with inline mention chips
    const contentToHtml = useCallback((raw: string) => {
        if (!raw) return '';
        const MENTION_RE = /@\[([^\]]*)\]\(node:([^)]+)\)/g;
        return raw.replace(MENTION_RE, (_match, label, nodeId) => {
            const node = mentionableNodes.find((n) => n.id === nodeId);
            const src = node?.src;
            const resolvedUrl = src ? signedUrlMap[src] : undefined;
            if (resolvedUrl) {
                return `<span contenteditable="false" data-mention-id="${nodeId}" title="${label}" style="display:inline-block;vertical-align:middle;margin:0 2px;"><img src="${resolvedUrl}" style="height:20px;width:20px;border-radius:4px;object-fit:cover;display:block;" /></span>`;
            }
            return `<span contenteditable="false" data-mention-id="${nodeId}" title="${label}" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;margin:0 2px;font-size:8px;color:#94a3b8;vertical-align:middle;">${node?.type?.charAt(0).toUpperCase() || '?'}</span>`;
        });
    }, [mentionableNodes, signedUrlMap]);

    // Read back HTML → content string
    const htmlToContent = useCallback((el: HTMLDivElement): string => {
        let result = '';
        el.childNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                result += node.textContent || '';
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const elem = node as HTMLElement;
                const mentionId = elem.getAttribute('data-mention-id');
                if (mentionId) {
                    const label = elem.textContent || mentionId;
                    result += buildMention(label, mentionId);
                } else if (elem.tagName === 'BR') {
                    result += '\n';
                } else {
                    const inner = htmlToContent(elem as HTMLDivElement);
                    result += inner;
                    if (elem.tagName === 'DIV' || elem.tagName === 'P') result += '\n';
                }
            }
        });
        return result;
    }, []);

    // Sync editor HTML when content changes externally
    const lastContentRef = useRef(content);
    useEffect(() => {
        if (editorRef.current && content !== lastContentRef.current) {
            const sel = window.getSelection();
            const hadFocus = editorRef.current === document.activeElement;
            editorRef.current.innerHTML = contentToHtml(content);
            lastContentRef.current = content;
            if (hadFocus && sel) {
                const range = document.createRange();
                range.selectNodeContents(editorRef.current);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }
    }, [content, contentToHtml]);

    // Init editor on mount
    useEffect(() => {
        if (editorRef.current && showPanel) {
            editorRef.current.innerHTML = contentToHtml(content);
            lastContentRef.current = content;
        }
    }, [showPanel]);

    const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleEditorInput = useCallback(() => {
        const el = editorRef.current;
        if (!el) return;
        const raw = htmlToContent(el);
        lastContentRef.current = raw;
        setContent(raw);

        // Debounce sync to Loro (300ms)
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        syncTimerRef.current = setTimeout(() => {
            setNodes((nds) =>
                nds.map((node) =>
                    node.id === id ? { ...node, data: { ...node.data, content: raw } } : node
                )
            );
            if (loroSync?.connected) {
                loroSync.updateNode(id, { data: { content: raw } });
            }
        }, 300);

        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        if (range.startContainer.nodeType !== Node.TEXT_NODE) {
            setShowMentionMenu(false);
            return;
        }
        const textBefore = (range.startContainer.textContent || '').slice(0, range.startOffset);
        const atMatch = textBefore.match(/@(\w*)$/);
        if (atMatch) {
            setMentionQuery(atMatch[1].toLowerCase());
            setShowMentionMenu(true);
            setMentionIndex(0);
        } else {
            setShowMentionMenu(false);
        }
    }, [htmlToContent, id, setNodes, loroSync]);

    const handleEditorKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (showMentionMenu && filteredMentionNodes.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex((prev) => Math.min(prev + 1, filteredMentionNodes.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex((prev) => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertMention(filteredMentionNodes[mentionIndex]);
            } else if (e.key === 'Escape') {
                setShowMentionMenu(false);
            }
        }
    }, [showMentionMenu, filteredMentionNodes, mentionIndex]);

    const insertMention = useCallback((node: { id: string; label: string; src?: string }) => {
        const el = editorRef.current;
        if (!el) return;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
            const text = range.startContainer.textContent || '';
            const before = text.slice(0, range.startOffset);
            const atPos = before.lastIndexOf('@');
            if (atPos >= 0) {
                range.startContainer.textContent = text.slice(0, atPos) + text.slice(range.startOffset);
                range.setStart(range.startContainer, atPos);
                range.collapse(true);
            }
        }
        const mentionHtml = contentToHtml(buildMention(node.label, node.id));
        const temp = document.createElement('span');
        temp.innerHTML = mentionHtml + '&nbsp;';
        const frag = document.createDocumentFragment();
        let lastInserted: globalThis.Node | null = null;
        while (temp.firstChild) {
            lastInserted = temp.firstChild;
            frag.appendChild(temp.firstChild);
        }
        range.insertNode(frag);
        if (lastInserted) {
            const newRange = document.createRange();
            newRange.setStartAfter(lastInserted);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
        }
        const raw = htmlToContent(el);
        lastContentRef.current = raw;
        setContent(raw);
        setShowMentionMenu(false);
        setMentionIndex(0);
        const edgeId = `${node.id}-${id}`;
        addEdges({ id: edgeId, source: node.id, target: id, type: 'default' });
        if (loroSync?.connected) {
            loroSync.addEdge(edgeId, { id: edgeId, source: node.id, target: id, type: 'default' });
        }
    }, [contentToHtml, htmlToContent, id, addEdges, loroSync]);

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
            const cleaned = cleanContent(data.content);
            setContent((prev: string) => (prev !== cleaned ? cleaned : prev));
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
        setContent(cleanContent(data.content));
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
            const prompt = (content && content.trim() !== '' ? content : '') || data.prompt || '';

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

            // Validate generation inputs against model card
            if (!isCustom && selectedModel) {
                const validationError = validateGenerationInput({
                    prompt: promptText,
                    referenceImageUrls: inlineImageUrls,
                    modelCard: selectedModel,
                });
                if (validationError) throw new Error(validationError);
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
                const referenceImageUrls = inlineImageUrls;
                const generatedLabel = extractLabelFromPrompt(promptText, 'Generated Image');
                const batchCount = countValue;

                for (let i = 0; i < batchCount; i++) {
                    const pendingNodeId = i === 0 ? assetName : await generateSemanticId(projectId);

                    const newNode = addNodeWithAutoLayout(
                        {
                            id: pendingNodeId,
                            type: 'image',
                            data: {
                                label: batchCount > 1 ? `${generatedLabel} (${i + 1})` : generatedLabel,
                                src: '',
                                status: 'pending',
                                prompt: promptText,
                                referenceImageUrls,
                                aspectRatio: resolveAspectRatio(modelId, modelParams),
                                model: modelId,
                                modelId,
                                modelParams: { ...modelParams, count: 1 },
                                referenceMode,
                            },
                        },
                        id
                    );

                    if (!newNode) continue;

                    if (loroSync?.connected) {
                        loroSync.addNode(newNode.id, newNode);
                    }

                    const edgeId = `${id}-${pendingNodeId}`;
                    addEdges({ id: edgeId, source: id, target: pendingNodeId, type: 'default' });
                    if (loroSync?.connected) {
                        loroSync.addEdge(edgeId, { id: edgeId, source: id, target: pendingNodeId, type: 'default' });
                    }
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
                const referenceImageUrls = inlineImageUrls;
                const generatedLabel = extractLabelFromPrompt(promptText, 'Generated Video');
                const durationValue = modelParams.duration ?? 5;
                const durationNumber = typeof durationValue === 'string' ? parseInt(durationValue, 10) : Number(durationValue) || 5;
                const batchCount = countValue;

                for (let i = 0; i < batchCount; i++) {
                    const pendingNodeId = i === 0 ? assetName : await generateSemanticId(projectId);

                    const newNode = addNodeWithAutoLayout(
                        {
                            id: pendingNodeId,
                            type: 'video',
                            data: {
                                label: batchCount > 1 ? `${generatedLabel} (${i + 1})` : generatedLabel,
                                src: '',
                                status: 'pending',
                                prompt: promptText,
                                referenceImageUrls,
                                duration: durationNumber,
                                model: modelId,
                                modelId,
                                modelParams,
                                referenceMode,
                                aspectRatio: resolveAspectRatio(modelId, modelParams),
                            },
                        },
                        id
                    );

                    if (!newNode) continue;

                    if (loroSync?.connected) {
                        loroSync.addNode(newNode.id, newNode);
                    }

                    const edgeId = `${id}-${pendingNodeId}`;
                    addEdges({ id: edgeId, source: id, target: pendingNodeId, type: 'default' });
                    if (loroSync?.connected) {
                        loroSync.addEdge(edgeId, { id: edgeId, source: id, target: pendingNodeId, type: 'default' });
                    }
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
                    transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                    className="relative z-10 w-full max-w-5xl h-[85vh] bg-white rounded-xl shadow-lg overflow-hidden flex flex-col border border-slate-200"
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
                            promptModalities={
                                isCustom
                                    ? (customDef?.promptModalities ?? ['text'])
                                    : (selectedModel?.input.promptModalities ?? ['text'])
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

    // Resolve current param display chips
    const paramChips = useMemo(() => {
        const chips: { label: string; value: string; paramId: string }[] = [];
        const params = isCustom ? customDef?.parameters : selectedModel?.parameters;
        if (!params) return chips;
        params.forEach((p: any) => {
            if (p.id === 'count') return; // count is shown separately as xN chip
            const val = modelParams[p.id] ?? p.defaultValue;
            if (val === undefined) return;
            if (p.type === 'select' && p.options) {
                const opt = p.options.find((o: any) => String(o.value) === String(val));
                chips.push({ label: p.label, value: opt?.label ?? String(val), paramId: p.id });
            } else if (p.type === 'boolean') {
                chips.push({ label: p.label, value: val ? 'On' : 'Off', paramId: p.id });
            } else {
                chips.push({ label: p.label, value: String(val), paramId: p.id });
            }
        });
        return chips;
    }, [isCustom, customDef, selectedModel, modelParams]);

    // Track which param chip has an open dropdown
    const [activeParamDropdown, setActiveParamDropdown] = useState<string | null>(null);
    const [expandedParam, setExpandedParam] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Click outside → close panel (capture phase to beat React Flow's stopPropagation)
    useEffect(() => {
        if (!showPanel) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as globalThis.Node)) {
                setShowPanel(false);
                setShowModelDropdown(false);
                setActiveParamDropdown(null);
                setExpandedParam(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside, true);
        return () => document.removeEventListener('mousedown', handleClickOutside, true);
    }, [showPanel]);

    // Bottom chat-style config panel (portalled)
    const configPanel = showPanel ? (
        <AnimatePresence>
            <motion.div
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                className="fixed bottom-0 left-0 right-0 z-[9998] flex justify-center pointer-events-none pb-5 px-4"
            >
                <div ref={panelRef} className="w-full max-w-2xl flex flex-col items-start">
                    {/* Connected nodes thumbnails — above the panel */}
                    {(() => {
                        const connectedSources = edges.filter(e => e.target === id).map(e => e.source);
                        const connectedImageNodes = getNodes().filter(n => connectedSources.includes(n.id) && n.data.src);
                        if (connectedImageNodes.length === 0) return null;
                        return (
                            <div className="pointer-events-auto flex gap-1.5 mb-2 px-1">
                                {connectedImageNodes.map((n) => (
                                    <SignedImg
                                        key={n.id}
                                        src={n.data.src as string}
                                        alt={(n.data.label as string) || n.id}
                                        className="h-10 w-10 rounded-lg object-cover border border-slate-200 shadow-sm"
                                    />
                                ))}
                            </div>
                        );
                    })()}

                <div
                    className="pointer-events-auto w-full rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-visible"
                    onClick={() => { setShowModelDropdown(false); setActiveParamDropdown(null); }}
                >
                    {/* Prompt editor with inline @ mention chips */}
                    <div className="relative px-4 pt-3 pb-4 nodrag">
                        <div
                            ref={editorRef}
                            contentEditable
                            suppressContentEditableWarning
                            className="w-full max-h-[40vh] overflow-y-auto text-sm text-gray-900 focus:outline-none leading-relaxed empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400"
                            style={{ minHeight: '1.5em' }}
                            data-placeholder="Describe anything you want to generate... (@ to ref assets)"
                            onInput={handleEditorInput}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    if (showMentionMenu && filteredMentionNodes.length > 0) {
                                        e.preventDefault();
                                        insertMention(filteredMentionNodes[mentionIndex]);
                                        return;
                                    }
                                    // Let contentEditable handle Enter naturally (newline)
                                    return;
                                }
                                handleEditorKeyDown(e);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                        />
                        {/* @ mention dropdown with thumbnails */}
                        {showMentionMenu && filteredMentionNodes.length > 0 && (
                            <div className="absolute left-4 right-4 bottom-full mb-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
                                {filteredMentionNodes.map((node, idx) => (
                                    <div
                                        key={node.id}
                                        className={`px-3 py-2 text-xs cursor-pointer flex items-center gap-2.5 transition-colors ${
                                            idx === mentionIndex ? 'bg-gray-100' : 'hover:bg-gray-50'
                                        }`}
                                        onMouseDown={(e) => { e.preventDefault(); insertMention(node); }}
                                    >
                                        {node.src ? (
                                            <SignedImg
                                                src={node.src}
                                                alt={node.label}
                                                className="h-8 w-8 rounded object-cover flex-shrink-0 border border-slate-200"
                                            />
                                        ) : (
                                            <div className="h-8 w-8 rounded bg-gray-100 flex-shrink-0 flex items-center justify-center border border-slate-200">
                                                <span className="text-[9px] uppercase text-gray-400">{node.type}</span>
                                            </div>
                                        )}
                                        <span className="font-medium text-gray-900 truncate">{node.label}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Bottom toolbar: model selector + clickable param chips */}
                    <div className="flex items-center gap-1.5 px-3 pb-3 flex-nowrap overflow-visible">
                        {/* Model selector chip */}
                        <div className="relative">
                            <button
                                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-xs font-medium text-gray-700 transition-colors"
                                onClick={(e) => { e.stopPropagation(); setShowModelDropdown(!showModelDropdown); setActiveParamDropdown(null); }}
                            >
                                <Icon size={12} weight="bold" className={colorClass} />
                                {modelDisplay}
                                <CaretDown size={10} weight="bold" className="text-gray-400" />
                            </button>
                            {showModelDropdown && (
                                <div className="absolute left-0 bottom-full mb-2 w-[220px] bg-white border border-slate-200 rounded-2xl shadow-xl z-50 max-h-48 overflow-hidden [&:hover]:overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

                        {/* Combined params chip → opens single popover with all params */}
                        {paramChips.length > 0 && (
                            <div className="relative flex-shrink-0">
                                <button
                                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-colors ${
                                        activeParamDropdown === '_params' ? 'bg-gray-200 text-gray-900' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                                    }`}
                                    onClick={(e) => { e.stopPropagation(); setActiveParamDropdown(activeParamDropdown === '_params' ? null : '_params'); setShowModelDropdown(false); }}
                                >
                                    <span className="font-medium text-gray-800">
                                        {paramChips.map((c) => c.value).join(' · ')}
                                    </span>
                                    <CaretDown size={10} weight="bold" className="text-gray-400" />
                                </button>
                                {activeParamDropdown === '_params' && (
                                    <div className="absolute left-0 bottom-full mb-2 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 min-w-[240px] overflow-hidden">
                                        {((isCustom ? customDef?.parameters : selectedModel?.parameters) ?? []).map((param: any, idx: number) => {
                                            const p = param as ModelParameter;
                                            const currentVal = modelParams[p.id] ?? p.defaultValue;
                                            const currentLabel = p.type === 'select'
                                                ? (p.options?.find((o) => String(o.value) === String(currentVal))?.label ?? String(currentVal))
                                                : p.type === 'boolean' ? (currentVal ? 'On' : 'Off') : String(currentVal);
                                            const isExpanded = expandedParam === p.id;
                                            return (
                                                <div key={p.id} className={idx > 0 ? 'border-t border-slate-100' : ''}>
                                                    <button
                                                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
                                                        onClick={(e) => { e.stopPropagation(); setExpandedParam(isExpanded ? null : p.id); }}
                                                    >
                                                        <span className="text-xs text-gray-500">{p.label}</span>
                                                        <span className="flex items-center gap-1 text-xs font-semibold text-gray-900">
                                                            {currentLabel}
                                                            <CaretDown size={10} weight="bold" className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                                        </span>
                                                    </button>
                                                    {isExpanded && (
                                                        <div className="px-3 pb-3">
                                                            {(p.type === 'select') && (
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {p.options?.map((opt) => (
                                                                        <button key={String(opt.value)}
                                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${String(currentVal) === String(opt.value) ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                                                            onClick={(e) => { e.stopPropagation(); updateModelParam(p.id, opt.value); setExpandedParam(null); }}
                                                                        >{opt.label}</button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {p.type === 'boolean' && (
                                                                <div className="flex gap-1.5">
                                                                    {[{ l: 'On', v: true }, { l: 'Off', v: false }].map((o) => (
                                                                        <button key={o.l}
                                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${Boolean(currentVal) === o.v ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                                                            onClick={(e) => { e.stopPropagation(); updateModelParam(p.id, o.v); setExpandedParam(null); }}
                                                                        >{o.l}</button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {p.type === 'number' && (
                                                                <input type="number" min={p.min} max={p.max} step={p.step}
                                                                    value={currentVal as number}
                                                                    onChange={(e) => updateModelParam(p.id, Number(e.target.value))}
                                                                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-400"
                                                                    onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                                                                />
                                                            )}
                                                            {p.type === 'slider' && (
                                                                <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                                                                    <div className="flex justify-between text-[10px] text-gray-500">
                                                                        <span>{p.min}</span><span className="font-semibold text-gray-900">{currentVal}</span><span>{p.max}</span>
                                                                    </div>
                                                                    <input type="range" min={p.min} max={p.max} step={p.step}
                                                                        value={currentVal as number}
                                                                        onChange={(e) => updateModelParam(p.id, Number(e.target.value))}
                                                                        className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-gray-900"
                                                                        onMouseDown={(e) => e.stopPropagation()}
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Spacer */}
                        <div className="flex-1 min-w-[8px]" />

                        {/* Batch count chip (xN) */}
                        <div className="relative flex-shrink-0">
                            <button
                                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-xs font-medium text-gray-700 transition-colors"
                                onClick={(e) => { e.stopPropagation(); setActiveParamDropdown(activeParamDropdown === '_count' ? null : '_count'); setShowModelDropdown(false); }}
                            >
                                x{countValue}
                                <CaretDown size={10} weight="bold" className="text-gray-400" />
                            </button>
                            {activeParamDropdown === '_count' && (
                                <div className="absolute right-0 bottom-full mb-1 min-w-[80px] bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50">
                                    {[1, 2, 3, 4].map((n) => (
                                        <div
                                            key={n}
                                            className={`px-3 py-2 text-xs cursor-pointer text-center transition-colors ${
                                                countValue === n ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'
                                            }`}
                                            onClick={() => {
                                                updateModelParam('count', n);
                                                setActiveParamDropdown(null);
                                            }}
                                        >
                                            x{n}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                </div>
            </motion.div>
        </AnimatePresence>
    ) : null;

    return (
        <>
            <div className="group relative">
                {/* Compact Badge — click opens config panel */}
                <div
                    className={`w-[260px] ${bgClass} rounded-xl overflow-hidden transition-all duration-300 hover:shadow-lg cursor-pointer ${
                        selected ? `ring-4 ${ringClass} ring-offset-2` : 'ring-1 ring-slate-200'
                    }`}
                    onClick={() => setShowPanel(!showPanel)}
                >
                    <div className="flex items-center gap-2.5 px-3.5 py-4">
                        <div className={`flex-shrink-0 ${colorClass}`}>
                            <Icon size={16} weight="fill" />
                        </div>
                        <div className="flex flex-col min-w-0 flex-1">
                            <span className={`text-xs font-bold font-display ${colorClass} truncate`}>
                                {label || 'Action'}
                            </span>
                            <span className="text-[10px] text-slate-400 truncate leading-none">
                                {badgeDisplayName}
                            </span>
                        </div>
                        {/* Run button — separate click target */}
                        <button
                            className={`nodrag flex-shrink-0 flex h-7 items-center gap-1.5 px-3 rounded-lg text-xs font-semibold text-white transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${btnClass}`}
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

                {/* Handles */}
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
            className="prose prose-sm max-w-none prose-slate prose-headings:font-bold prose-headings:text-gray-900 prose-p:text-gray-700 prose-a:text-gray-900 prose-a:underline prose-code:text-gray-700 prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded"
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
