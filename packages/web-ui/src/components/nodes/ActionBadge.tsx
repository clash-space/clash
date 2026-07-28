import { memo, useState, useEffect, useCallback, useMemo, useRef, Fragment, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Handle, NodeToolbar, Position, type Node as RFNode, NodeProps, useReactFlow, useNodeConnections } from '@xyflow/react';
import { VideoCamera, Image as ImageIcon, CaretDown, X, Play, Spinner, PuzzlePiece, Plus, Lock, Copy, SpeakerHigh, TextT } from '@phosphor-icons/react';
import { motion, Reorder } from 'framer-motion';
import { useProject } from '../ProjectContext';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { usePeersSelectingNode } from '../PresenceAwarenessContext';
import PeerSelectionRing from '../PeerSelectionRing';
import { useLayoutManager } from '@clash/web-ui/lib/layout';
import { generateSemanticId } from '@clash/web-ui/lib/utils/semanticId';
import { SignedImg } from '../SignedMedia';
import { getSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { getAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { listCompatibleModelCatalogEntries, MODEL_CARDS, snapAspectRatio, parsePromptParts, extractPromptText, composePromptWithTextRefs, buildMention, capability, directorReferencePackets, referenceAssetId, referenceModality, type DirectorReferencePacket, type ModelCard, type ModelParameter, type CustomActionDefinition, type Modality } from '@clash/shared-types';
import { applyLayoutPatchesToLoro, collectLayoutNodePatches } from '@clash/web-ui/lib/loroNodeSync';
import { useProjectCustomActions } from '../CustomActionsContext';
import {
    useRuntimes,
    isCustomActionRuntimeOnline,
    RUNTIME_OFFLINE_TOOLTIP,
    RUNTIME_OFFLINE_LABEL,
} from '@clash/web-ui/hooks/useRuntimes';
import MilkdownEditor from '../MilkdownEditor';
import { useConfirm } from '../ConfirmDialog';
import { SelectMenu, type SelectOption, type SelectValue } from '../ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import { Input } from '../ui/input';
import { Tooltip } from '../ui/tooltip';
import { Slider, SliderRange, SliderThumb, SliderTrack } from '../ui/slider';
import { ComboboxItem, ComboboxList, ComboboxProvider, useComboboxStore, type ComboboxStore } from '../ui/combobox';
import { replaceContentEditableHtmlPreservingFocus } from '../contentEditableSync';
import { handleMentionComboboxKeyDown } from '../mentionComboboxKeyboard';
import { actionIsCheckpointLocked } from '@clash/web-ui/lib/actionCheckpoint';
import { useSpawnPendingAsset } from './useSpawnPendingAsset';
import ActionBadgePipelineMenu from './ActionBadgePipelineMenu';
import AttributionLine from './AttributionLine';
import { getModelDropdownSecondaryText } from './modelDisplay';
import { NodeModalDialog } from './NodeModalDialog';
import { useCanvasTransientUiOwner } from '../CanvasTransientUiContext';

type ModelParams = Record<string, string | number | boolean>;
type BuiltInActionKind = 'image' | 'video' | 'audio' | 'text';
const getBuiltInActionKind = (actionType: string): BuiltInActionKind => {
    if (actionType === 'video-gen') return 'video';
    if (actionType === 'audio-gen') return 'audio';
    if (actionType === 'text-gen') return 'text';
    return 'image';
};

const FALLBACK_MODEL_BY_KIND: Record<BuiltInActionKind, string> = {
    image: 'nano-banana-2',
    video: 'sora-2',
    audio: 'gemini-3.1-flash-tts',
    text: 'gpt-5.4',
};

const BATCH_COUNT_OPTIONS: SelectOption<number>[] = [
    { value: 1, label: 'x1' },
    { value: 2, label: 'x2' },
    { value: 3, label: 'x3' },
    { value: 4, label: 'x4' },
];

const PARAM_BOOLEAN_OPTIONS: SelectOption<boolean>[] = [
    { value: true, label: 'On' },
    { value: false, label: 'Off' },
];
const NODE_INTERACTION_BOUNDARY_CLASS = 'nodrag nopan';

function paramOptionsToSelectOptions(param: ModelParameter): SelectOption<SelectValue>[] {
    return (param.options ?? []).map((option) => ({
        value: option.value as SelectValue,
        label: option.label,
    }));
}

function normalizeSliderValue(value: unknown, fallback: number): number {
    const numericValue = typeof value === 'number' ? value : Number(value ?? fallback);
    return Number.isFinite(numericValue) ? numericValue : fallback;
}

function ModelParamSlider({
    ariaLabel,
    className = `${NODE_INTERACTION_BOUNDARY_CLASS} h-4 w-full`,
    max,
    min,
    onChange,
    step,
    trackClassName,
    value,
}: {
    ariaLabel: string;
    className?: string;
    max?: number;
    min?: number;
    onChange: (value: number) => void;
    step?: number;
    trackClassName: string;
    value: number;
}) {
    return (
        <Slider
            aria-label={ariaLabel}
            min={min}
            max={max}
            step={step}
            value={[value]}
            onValueChange={(nextValue) => onChange(nextValue[0] ?? value)}
            className={className}
        >
            <SliderTrack className={`h-1.5 rounded-full ${trackClassName}`}>
                <SliderRange className="inset-y-0 rounded-full bg-brand" />
            </SliderTrack>
            <SliderThumb className="h-4 w-4 rounded-full border border-brand bg-warm-surface shadow-sm" />
        </Slider>
    );
}

type ActionMentionNode = {
    id: string;
    type: string;
    label: string;
    thumbnail?: string;
};

const actionMentionItemId = (nodeId: string): string => `action-mention-${nodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
const escapeHtmlAttribute = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

function ActionMentionPicker({
    nodes,
    store,
}: {
    nodes: ActionMentionNode[];
    store: ComboboxStore;
}) {
    return (
        <ComboboxProvider store={store}>
            <ComboboxList
                aria-label="Reference asset matches"
                alwaysVisible
                className="clash-action-mention-menu absolute inset-x-4 bottom-full z-50 mb-1 max-h-48 overflow-y-auto rounded-xl border border-warm-border bg-warm-surface shadow-lg"
            >
                {nodes.map((node) => {
                    return (
                        <ComboboxItem
                            id={actionMentionItemId(node.id)}
                            key={node.id}
                            value={node.id}
                            focusOnHover
                            setValueOnClick={false}
                            onMouseDown={(event) => {
                                event.preventDefault();
                            }}
                            className="flex w-full cursor-default items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors outline-none hover:bg-warm-muted data-[active-item]:bg-warm-muted"
                        >
                            {node.thumbnail ? (
                                <SignedImg
                                    src={node.thumbnail}
                                    alt={node.label}
                                    className="h-8 w-8 flex-shrink-0 rounded border border-warm-border object-cover"
                                />
                            ) : (
                                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-warm-border bg-warm-muted">
                                    <span className="text-[9px] uppercase text-stone-700 dark:text-stone-300">{node.type}</span>
                                </span>
                            )}
                            <span className="truncate font-medium text-slate-900 dark:text-slate-50">{node.label}</span>
                        </ComboboxItem>
                    );
                })}
            </ComboboxList>
        </ComboboxProvider>
    );
}

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

const PromptActionNode = ({ data, selected, id }: NodeProps<RFNode<Record<string, any>>>) => {
    // `data.openPanel` is a one-shot handoff from `handleCopy` — a freshly
    // cloned node mounts with its config panel already open, then clears the
    // flag in an effect so subsequent loads don't re-open.
    const {
        close: closeActionPanel,
        isOpen: showPanel,
        open: openActionPanel,
        toggle: toggleActionPanel,
    } = useCanvasTransientUiOwner('action-panel', id);
    const [showModal, setShowModal] = useState(false);
    // Peers (other connected users) who currently have this node selected.
    const peersSelecting = usePeersSelectingNode(id);
    const [isExecuting, setIsExecuting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // @ mention state
    const [showMentionMenu, setShowMentionMenu] = useState(false);
    const [mentionQuery, setMentionQuery] = useState('');

    // Canvas-node ref picker (click + to attach). Value is slot target:
    // 'append' for non-startEnd strip, 'start' | 'end' for startEnd slots.
    const [refPickerTarget, setRefPickerTarget] = useState<null | 'append' | 'start' | 'end'>(null);

    // React Flow hooks
    const { enabledModelCatalog, projectId } = useProject();
    const { getNode, getNodes, getEdges, addEdges, setNodes, setEdges } = useReactFlow();
    const loroSync = useOptionalLoroSyncContext();
    const connections = useNodeConnections({ id });
    const connectedEdges = useMemo(
        () =>
            connections.map((connection) => ({
                id: connection.edgeId,
                source: connection.source,
                target: connection.target,
            })),
        [connections],
    );
    const confirm = useConfirm();
    const onNodesMutated = useCallback(
        (prevNodes: RFNode[], nextNodes: RFNode[]) => {
            if (!loroSync?.connected) return;
            const patches = collectLayoutNodePatches(prevNodes, nextNodes);
            applyLayoutPatchesToLoro(loroSync, patches);
        },
        [loroSync]
    );
    const { addNodeWithAutoLayout, addNodeWithLayout } = useLayoutManager({ onNodesMutated });

    // Prompt editing state
    const cleanContent = (val: string | undefined) => {
        if (!val) return '';
        // Strip legacy default placeholder
        if (val.trim() === '# Prompt\nEnter your prompt here...' || val.trim() === '# Prompt\n\nEnter your prompt here...') return '';
        return val;
    };
    const [label, setLabel] = useState(data.label || 'Prompt');
    const [content, setContent] = useState(cleanContent(data.content));
    const isCheckpointLocked = useMemo(() => {
        const checkpointEdges = getEdges();
        const downstreamIds = new Set<string>();
        const pendingSourceIds = [id];

        while (pendingSourceIds.length > 0) {
            const sourceId = pendingSourceIds.pop();
            if (!sourceId) break;
            for (const edge of checkpointEdges) {
                if (edge.source !== sourceId || downstreamIds.has(edge.target)) continue;
                downstreamIds.add(edge.target);
                pendingSourceIds.push(edge.target);
            }
        }

        const checkpointNodes = Array.from(downstreamIds)
            .map((nodeId) => getNode(nodeId))
            .filter((node): node is RFNode => Boolean(node));
        return actionIsCheckpointLocked({ nodeId: id, nodes: checkpointNodes, edges: checkpointEdges });
    }, [id, data.hasRun, connectedEdges, getNode, getEdges]);
    const [showRefPicker, setShowRefPicker] = useState(false);
    const [paramsPopoverOpen, setParamsPopoverOpen] = useState(false);

    const resolveConfiguredModelId = (
        type: 'image-gen' | 'video-gen',
        explicitId?: string,
        legacyName?: string
    ): string | undefined => {
        if (explicitId) return explicitId;
        if (!legacyName) return undefined;
        const lower = legacyName.toLowerCase();
        if (type === 'video-gen') return 'sora-2';
        if (lower.includes('pro')) return 'nano-banana-2';
        return 'nano-banana-2';
    };

    const [actionType, setActionType] = useState<string>(data.actionType || 'image-gen');
    const isCustom = actionType.startsWith('custom:');
    const customActionId = isCustom ? actionType.replace('custom:', '') : null;

    const customActions = useProjectCustomActions();
    const customDef: CustomActionDefinition | undefined = customActionId
        ? customActions.find((a) => a.id === customActionId)
        : undefined;

    // Live runtime list (polled). Used to grey out custom-action affordances
    // when their owning runtime is offline — the server already refuses
    // dispatch in that case, this is just to tell the user beforehand.
    const { runtimes: knownRuntimes, loading: runtimesLoading } = useRuntimes();
    // While the first /api/v1/runtimes response is in flight, treat the
    // action as online to avoid a flash-disabled state on every mount.
    // Once we have data, the helper does the real check.
    const customActionOnline = isCustom
        ? (runtimesLoading ? true : isCustomActionRuntimeOnline(customDef, knownRuntimes))
        : true;
    const customActionOffline = !customActionOnline;

    // Custom action params state
    const [customActionParams, _setCustomActionParams] = useState<ModelParams>(
        (data.customActionParams as ModelParams) ?? {}
    );

    const editorRef = useRef<HTMLDivElement>(null);

    const actionKind = getBuiltInActionKind(actionType);
    const initialModelId = isCustom ? '' :
        (actionKind === 'image' || actionKind === 'video'
            ? resolveConfiguredModelId(actionType as 'image-gen' | 'video-gen', data.modelId as string | undefined, data.modelName)
            : (data.modelId as string | undefined)) ||
        (MODEL_CARDS.find((card) => card.kind === actionKind)?.id ?? FALLBACK_MODEL_BY_KIND[actionKind]);

    const [modelId, setModelId] = useState<string>(initialModelId);
    const [modelParams, setModelParams] = useState<ModelParams>({
        ...(MODEL_CARDS.find((card) => card.id === initialModelId)?.defaultParams ?? {}),
        ...(data.modelParams ?? {}),
    });

    const Icon = isCustom
        ? PuzzlePiece
        : actionKind === 'video'
            ? VideoCamera
            : actionKind === 'audio'
                ? SpeakerHigh
                : actionKind === 'text'
                    ? TextT
                    : ImageIcon;
    const colorClass = isCustom
        ? 'text-custom'
        : actionKind === 'video'
            ? 'text-video'
            : actionKind === 'audio'
                ? 'text-audio'
                : actionKind === 'text'
                    ? 'text-slate-800 dark:text-slate-200'
                    : 'text-image';
    const bgClass = isCustom
        ? 'bg-custom-light'
        : actionKind === 'video'
            ? 'bg-video-light'
            : actionKind === 'audio'
                ? 'bg-audio-light'
                : actionKind === 'text'
                    ? 'bg-warm-muted'
                    : 'bg-image-light';
    const ringClass = isCustom
        ? 'ring-custom'
        : actionKind === 'video'
            ? 'ring-video'
            : actionKind === 'audio'
                ? 'ring-audio'
                : actionKind === 'text'
                    ? 'ring-slate-500'
                    : 'ring-image';
    const btnClass = isCustom
        ? 'bg-custom hover:opacity-90'
        : actionKind === 'video'
            ? 'bg-video hover:opacity-90'
            : actionKind === 'audio'
                ? 'bg-audio hover:opacity-90'
                : actionKind === 'text'
                    ? 'clash-node-primary'
                    : 'bg-image hover:opacity-90';

    const availableModels = useMemo(
        () => enabledModelCatalog
            .map((entry) => entry.model)
            .filter((card) => card.kind === actionKind),
        [actionKind, enabledModelCatalog]
    );
    const selectedModel = useMemo<ModelCard | undefined>(
        // For custom actions, fall back to `undefined` rather than the
        // first image model card — otherwise the picker chip shows
        // "Nano Banana 2" on a grid-split badge because the .find()
        // returned nothing and `?? availableModels[0]` picked a random
        // image model. Custom actions have their own name source
        // (`customDef.name`) — see modelDisplay below.
        () => isCustom ? undefined : (MODEL_CARDS.find((card) => card.id === modelId) ?? availableModels[0]),
        [availableModels, modelId, isCustom]
    );

    const modelDisplay = isCustom
        ? (customDef?.name ?? customActionId ?? 'Custom action')
        : (selectedModel?.name || modelId);
    const countValue = Number(modelParams.count ?? 1);
    const modelPickerLabel = customActionOffline ? RUNTIME_OFFLINE_TOOLTIP : modelDisplay;
    const checkpointRunLabel = customActionOffline ? RUNTIME_OFFLINE_TOOLTIP : 'Run again with current parameters';
    const panelRunLabel = customActionOffline ? RUNTIME_OFFLINE_TOOLTIP : 'Run action';

    // Single derivation — all per-modality questions read fields off `cap`.
    // See packages/shared-types/src/model-capabilities.ts.
    const cap = useMemo(
        () => (selectedModel ? capability(selectedModel) : null),
        [selectedModel],
    );
    const acceptsTextRef = cap?.ref.text.accepts ?? false;
    const acceptsImageRef = cap?.ref.image.accepts ?? false;
    const acceptsVideoRef = cap?.ref.video.accepts ?? false;
    const acceptsAudioRef = cap?.ref.audio.accepts ?? false;
    const acceptsAnyRef = acceptsTextRef || acceptsImageRef || acceptsVideoRef || acceptsAudioRef;
    const isStartEnd = cap?.ref.image.isStartEnd ?? false;

    // Resolve a node's ref source if its kind is accepted by the current model.
    // Returns the raw R2 key — renderers use cover for video, placeholder for audio.
    const resolveRefSrc = useCallback(
        (node: { type?: string; data?: Record<string, unknown> } | undefined): string | undefined => {
            if (!node || !cap) return undefined;
            const t = referenceModality(node);
            if (t === 'image' && cap.ref.image.accepts) return node.data?.src as string | undefined;
            if (t === 'video' && cap.ref.video.accepts) {
                return node.type === 'director-stage'
                    ? node.data?.outputVideoPreviewUrl as string | undefined
                        ?? node.data?.outputVideoSrc as string | undefined
                    : node.data?.src as string | undefined;
            }
            if (t === 'audio' && cap.ref.audio.accepts) return node.data?.src as string | undefined;
            return undefined;
        },
        [cap],
    );

    const resolveTextRef = useCallback(
        (node: { type?: string; data?: Record<string, unknown> } | undefined): string | undefined => {
            if (!node || !cap || node.type !== 'text' || !cap.ref.text.accepts) return undefined;
            const raw = node.data?.content ?? node.data?.prompt ?? node.data?.label;
            return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
        },
        [cap],
    );

    // Does `node` have a modality this action accepts? (Independent of whether
    // the node has a real src yet — drafts count, since their src will be
    // resolved at run time by the cascade runner's gate.)
    const hasCompatibleModality = useCallback(
        (node: { type?: string; data?: Record<string, unknown> } | undefined): boolean => {
            if (!node || !cap) return false;
            const t = referenceModality(node);
            return t ? cap.ref[t].accepts : false;
        },
        [cap],
    );

    // Attached node IDs = incoming edges whose source has a compatible modality,
    // including drafts (empty src, will materialize when Build runs).
    const attachedNodeIds = useMemo(() => {
        return connectedEdges
            .filter(e => e.target === id)
            .map(e => getNode(e.source))
            .filter((n): n is NonNullable<typeof n> => !!n && hasCompatibleModality(n))
            .map(n => n.id);
    }, [connectedEdges, id, getNode, hasCompatibleModality]);

    const refNodeIds = useMemo(() => {
        const order = Array.isArray(data.referenceImageOrder) ? (data.referenceImageOrder as string[]) : [];
        const attachedSet = new Set(attachedNodeIds);
        const ordered = order.filter(nid => attachedSet.has(nid));
        const seen = new Set(ordered);
        const extras = attachedNodeIds.filter(nid => !seen.has(nid));
        return [...ordered, ...extras];
    }, [attachedNodeIds, data.referenceImageOrder]);

    // Group attached refs by kind once — used by the model-compat check below.
    const refKindCounts = useMemo(() => {
        const byKind: Record<Modality, number> = { text: 0, image: 0, video: 0, audio: 0 };
        for (const nid of refNodeIds) {
            const n = getNode(nid);
            const t = n ? referenceModality(n) : undefined;
            if (t) byKind[t] += 1;
        }
        return byKind;
    }, [refNodeIds, getNode]);

    const compatibleModelIds = useMemo(
        () => new Set(listCompatibleModelCatalogEntries({
            outputKind: actionKind,
            referenceCounts: refKindCounts,
            enforceMinimums: false,
            models: enabledModelCatalog.map((entry) => entry.model),
        }).map((entry) => entry.model.id)),
        [actionKind, enabledModelCatalog, refKindCounts],
    );

    // Whether `card` can consume the currently attached refs as-is. The UI
    // sees only candidate IDs returned by the catalog anti-corruption layer.
    const isModelCompatibleWithRefs = useCallback((card: ModelCard): boolean => {
        return compatibleModelIds.has(card.id);
    }, [compatibleModelIds]);

    const compatibleAvailableModels = useMemo(
        () => refNodeIds.length === 0
            ? availableModels
            : availableModels.filter(isModelCompatibleWithRefs),
        [availableModels, isModelCompatibleWithRefs, refNodeIds.length],
    );

    const clearAllRefs = useCallback(() => {
        const edgeIds = connectedEdges.filter(e => e.target === id).map(e => e.id);
        if (edgeIds.length === 0) return;
        setEdges(eds => eds.filter(e => !edgeIds.includes(e.id)));
        if (loroSync?.connected) {
            edgeIds.forEach(eid => loroSync.removeEdge(eid));
        }
    }, [id, connectedEdges, setEdges, loroSync]);

    // Read natural dims from an image/video node. Videos store width/height too.
    const getNodeNaturalDims = useCallback((nodeId?: string): { w: number; h: number } | null => {
        if (!nodeId) return null;
        const n = getNode(nodeId);
        if (!n) return null;
        const w = Number(n.data?.naturalWidth) || 0;
        const h = Number(n.data?.naturalHeight) || 0;
        if (!w || !h) return null;
        return { w, h };
    }, [getNode]);

    // Default the model's aspect_ratio from the start reference whenever it
    // changes. Kling i2v / Kling 3 / Seedance i2v all derive output ratio from
    // the source image; pre-selecting the nearest option keeps the pending-node
    // placeholder honest and gives the user a chance to override before submit.
    const startRefId = refNodeIds[0];
    useEffect(() => {
        const dims = getNodeNaturalDims(startRefId);
        if (!dims) return;
        const snap = snapAspectRatio(modelId, dims.w, dims.h);
        if (!snap) return;
        const currentValue = modelParams[snap.paramId];
        if (currentValue === snap.value) return;
        const next = { ...modelParams, [snap.paramId]: snap.value } as ModelParams;
        setModelParams(next);
        syncModelState(modelId, next);
    // Only re-run when the start ref itself changes (or model switches), not on
    // every modelParams update — otherwise user overrides would be clobbered.
    }, [startRefId, modelId]);

    // startEnd mismatch warning: flag when start and end frames have different
    // aspect ratios (fal's Kling 3 / Seedance i2v derive output from start, so a
    // mismatched end frame commonly produces distorted interpolation).
    const startEndMismatch = useMemo(() => {
        if (!isStartEnd) return null;
        const s = getNodeNaturalDims(refNodeIds[0]);
        const e = getNodeNaturalDims(refNodeIds[1]);
        if (!s || !e) return null;
        // 3% tolerance on log-ratio difference — covers pixel rounding.
        return Math.abs(Math.log((s.w / s.h) / (e.w / e.h))) > 0.03 ? { s, e } : null;
    }, [isStartEnd, refNodeIds, getNodeNaturalDims]);

    const persistRefOrder = useCallback((next: string[]) => {
        // Single writer for referenceImageOrder — dedup here so no duplicate
        // ever lands in Loro. Order preserved (first occurrence wins).
        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const nid of next) {
            if (!nid || seen.has(nid)) continue;
            seen.add(nid);
            cleaned.push(nid);
        }
        setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, referenceImageOrder: cleaned } } : n));
        if (loroSync?.connected) {
            loroSync.updateNode(id, { data: { referenceImageOrder: cleaned } });
        }
    }, [id, setNodes, loroSync]);

    const addRefNode = useCallback((sourceNodeId: string) => {
        // Deterministic edgeId means re-adding the same source is a no-op
        // *iff* we early-return when the edge already exists. Without this
        // guard reactflow's setEdges still grows the array (it dedups on
        // change-set, not against current state) and Loro overwrites the
        // entry — but transient duplicates flicker through React Flow.
        const edgeId = `${sourceNodeId}-${id}`;
        if (connectedEdges.some(e => e.id === edgeId)) return;
        addEdges({ id: edgeId, source: sourceNodeId, target: id, type: 'default' });
        if (loroSync?.connected) {
            loroSync.addEdge(edgeId, { id: edgeId, source: sourceNodeId, target: id, type: 'default' });
        }
    }, [id, connectedEdges, addEdges, loroSync]);

    const removeRefNode = useCallback((sourceNodeId: string) => {
        const edgeIds = connectedEdges.filter(e => e.target === id && e.source === sourceNodeId).map(e => e.id);
        if (edgeIds.length === 0) return;
        setEdges(eds => eds.filter(e => !edgeIds.includes(e.id)));
        if (loroSync?.connected) {
            edgeIds.forEach(eid => loroSync.removeEdge(eid));
        }
    }, [id, connectedEdges, setEdges, loroSync]);

    // One-shot cleanup for pre-existing dirty data:
    //   1. referenceImageOrder may have duplicate ids (from before
    //      persistRefOrder dedup'd).
    //   2. Loro may have parallel incoming edges (drag-connect + @-mention
    //      created two edges with different ids for the same source-target,
    //      from before ProjectEditor.onConnect used the canonical id).
    // Rewrite via the canonical writers; no-op for clean data.
    useEffect(() => {
        const order = Array.isArray(data.referenceImageOrder) ? (data.referenceImageOrder as string[]) : null;
        if (order && order.length > 0) {
            const seen = new Set<string>();
            const cleaned: string[] = [];
            for (const nid of order) {
                if (!nid || seen.has(nid)) continue;
                seen.add(nid);
                cleaned.push(nid);
            }
            if (cleaned.length !== order.length) persistRefOrder(cleaned);
        }

        const incoming = connectedEdges.filter(e => e.target === id);
        const bySource = new Map<string, typeof incoming>();
        for (const e of incoming) {
            const list = bySource.get(e.source) ?? [];
            list.push(e);
            bySource.set(e.source, list);
        }
        const stale: string[] = [];
        for (const [, list] of bySource) {
            if (list.length <= 1) continue;
            // Prefer the canonical id; if absent, keep the first.
            const canonical = `${list[0].source}-${id}`;
            const keeper = list.find(e => e.id === canonical) ?? list[0];
            for (const e of list) {
                if (e.id !== keeper.id) stale.push(e.id);
            }
        }
        if (stale.length > 0) {
            setEdges(eds => eds.filter(e => !stale.includes(e.id)));
            if (loroSync?.connected) {
                stale.forEach(eid => loroSync.removeEdge(eid));
            }
        }
    }, []);
    // Drafts qualify (src empty for now — cascade runner waits for them before
    // adopting this action). Cycle guard: exclude anything that transitively
    // depends on this action so users can't pick a descendant.
    const shouldComputeRefPickerCandidates = showRefPicker || refPickerTarget !== null;
    const refPickerCandidates = useMemo(() => {
        if (!shouldComputeRefPickerCandidates) return [];
        const attached = new Set(refNodeIds);
        const downstream = new Set<string>([id]);
        {
            const queue: string[] = [id];
            while (queue.length > 0) {
                const cur = queue.shift()!;
                for (const e of getEdges()) {
                    if (e.source === cur && !downstream.has(e.target)) {
                        downstream.add(e.target);
                        queue.push(e.target);
                    }
                }
            }
        }
        return getNodes().filter(n => {
            if (attached.has(n.id)) return false;
            if (downstream.has(n.id)) return false;
            const t = referenceModality(n);
            if (t === 'text') return acceptsTextRef;
            if (t === 'image') return acceptsImageRef;
            if (t === 'video') return acceptsVideoRef;
            if (t === 'audio') return acceptsAudioRef;
            return false;
        });
    }, [shouldComputeRefPickerCandidates, refNodeIds, getNodes, getEdges, connectedEdges, id, acceptsTextRef, acceptsImageRef, acceptsVideoRef, acceptsAudioRef]);

    // Attach a picked canvas node into the target slot. For startEnd, pad the
    // order array so slot 0/1 are stable even when the other slot is empty.
    const attachRefToSlot = useCallback((sourceNodeId: string, target: 'append' | 'start' | 'end') => {
        addRefNode(sourceNodeId);
        if (target === 'append') return;
        const existing = Array.isArray(data.referenceImageOrder) ? [...(data.referenceImageOrder as string[])] : [...refNodeIds];
        const slotIdx = target === 'start' ? 0 : 1;
        while (existing.length <= slotIdx) existing.push('');
        existing[slotIdx] = sourceNodeId;
        persistRefOrder(existing.filter(Boolean));
    }, [addRefNode, data.referenceImageOrder, refNodeIds, persistRefOrder]);

    // Resolve ref node → asset R2 key map. Used for @-mention thumbnails,
    // startEnd slot previews, and the generic ref grid. node.data.src is
    // no longer maintained — srcR2Key / coverR2Key live on the D1 asset row.
    const [refThumbByNodeId, setRefThumbByNodeId] = useState<Map<string, string>>(
        () => new Map(),
    );
    useEffect(() => {
        if (refNodeIds.length === 0) {
            setRefThumbByNodeId(new Map());
            return;
        }
        let cancelled = false;
        (async () => {
            const next = new Map<string, string>();
            for (const nid of refNodeIds) {
                const n = getNode(nid);
                if (!n) continue;
                const assetId = referenceAssetId(n);
                if (!assetId) continue;
                const modality = referenceModality(n);
                try {
                    const asset = await getAsset(assetId);
                    const r2Key = modality === 'video'
                        ? (asset.coverR2Key ?? asset.srcR2Key)
                        : asset.srcR2Key;
                    if (r2Key) next.set(nid, r2Key);
                } catch {
                    // asset not yet available; skip
                }
            }
            if (!cancelled) setRefThumbByNodeId(next);
        })();
        return () => { cancelled = true; };
    }, [refNodeIds, getNode]);

    // @ mention: only attached reference images, with positional labels "Image 1", "Image 2"...
    const mentionableNodes = useMemo(() => {
        return refNodeIds.map((nodeId, i) => {
            const node = getNode(nodeId);
            const type = (node ? referenceModality(node) : undefined) || 'image';
            const prefix = type === 'text'
                ? 'Text'
                : type === 'video'
                    ? 'Video'
                    : type === 'audio'
                        ? 'Audio'
                        : 'Image';
            return {
                id: nodeId,
                type,
                label: `${prefix} ${i + 1}`,
                thumbnail: refThumbByNodeId.get(nodeId),
            };
        });
    }, [refNodeIds, getNode, refThumbByNodeId]);

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
        const srcs = mentionableNodes.filter((n) => n.thumbnail).map((n) => n.thumbnail!);
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
            const src = node?.thumbnail;
            const resolvedUrl = src ? signedUrlMap[src] : undefined;
            const safeNodeId = escapeHtmlAttribute(nodeId);
            const safeLabel = escapeHtmlAttribute(label);
            if (resolvedUrl) {
                return `<span contenteditable="false" data-mention-id="${safeNodeId}" data-mention-label="${safeLabel}" aria-label="${safeLabel}" style="display:inline-block;vertical-align:middle;margin:0 2px;"><img src="${resolvedUrl}" style="height:20px;width:20px;border-radius:4px;object-fit:cover;display:block;" /></span>`;
            }
            return `<span contenteditable="false" data-mention-id="${safeNodeId}" data-mention-label="${safeLabel}" aria-label="${safeLabel}" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;margin:0 2px;font-size:8px;color:#94a3b8;vertical-align:middle;">${node?.type?.charAt(0).toUpperCase() || '?'}</span>`;
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
                    const label = elem.getAttribute('data-mention-label') || elem.textContent || mentionId;
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
            replaceContentEditableHtmlPreservingFocus(editorRef.current, contentToHtml(content));
            lastContentRef.current = content;
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
        } else {
            setShowMentionMenu(false);
        }
    }, [htmlToContent, id, setNodes, loroSync]);

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
        const edgeId = `${node.id}-${id}`;
        addEdges({ id: edgeId, source: node.id, target: id, type: 'default' });
        if (loroSync?.connected) {
            loroSync.addEdge(edgeId, { id: edgeId, source: node.id, target: id, type: 'default' });
        }
    }, [contentToHtml, htmlToContent, id, addEdges, loroSync]);

    const mentionCombobox = useComboboxStore({
        value: mentionQuery,
        setValue: () => undefined,
        setSelectedValue: (selectedValue) => {
            const node = filteredMentionNodes.find((candidate) => candidate.id === selectedValue);
            if (node) insertMention(node);
        },
        focusLoop: true,
        focusWrap: true,
        orientation: 'vertical',
    });

    useEffect(() => {
        if (!showMentionMenu || filteredMentionNodes.length === 0) {
            mentionCombobox.setActiveId(undefined);
            return;
        }
        mentionCombobox.setActiveId(actionMentionItemId(filteredMentionNodes[0].id));
    }, [mentionCombobox, showMentionMenu, filteredMentionNodes]);

    const handleEditorKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!showMentionMenu || filteredMentionNodes.length === 0) return;

        handleMentionComboboxKeyDown(e, {
            store: mentionCombobox,
            items: filteredMentionNodes,
            getItemId: (node) => actionMentionItemId(node.id),
            onSelect: insertMention,
            onClose: () => setShowMentionMenu(false),
        });
    }, [filteredMentionNodes, insertMention, mentionCombobox, showMentionMenu]);

    const syncModelState = useCallback(
        (nextModelId: string, nextParams: ModelParams) => {
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
                    }
                });
            }
        },
        [id, loroSync, setNodes]
    );

    const handleModelChange = useCallback(async (nextId: string) => {
        const nextModel = MODEL_CARDS.find((card) => card.id === nextId) || availableModels[0];
        if (nextModel && refNodeIds.length > 0 && !isModelCompatibleWithRefs(nextModel)) {
            const ok = await confirm({
                title: `Switch to ${nextModel.name}?`,
                message: `This model can't use the ${refNodeIds.length} attached reference${refNodeIds.length === 1 ? '' : 's'}. Switching will detach them.`,
                confirmText: 'Switch & clear',
                cancelText: 'Keep current',
                destructive: true,
            });
            if (!ok) return;
            clearAllRefs();
        }
        const nextParams = { ...(nextModel?.defaultParams ?? {}) } as ModelParams;
        const resolvedId = nextModel?.id ?? nextId;
        setModelId(resolvedId);
        setModelParams(nextParams);
        syncModelState(resolvedId, nextParams);
    }, [availableModels, refNodeIds.length, isModelCompatibleWithRefs, clearAllRefs, confirm, syncModelState]);

    const updateModelParam = useCallback((paramId: string, value: string | number | boolean) => {
        const next = { ...modelParams, [paramId]: value };
        setModelParams(next);
        syncModelState(modelId, next);
    }, [modelId, modelParams, syncModelState]);

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

    // Clear the one-shot `openPanel` flag once consumed, so reloading or
    // re-hydrating from Loro doesn't force the panel open on every mount.
    useEffect(() => {
        if (!data.openPanel) return;
        openActionPanel();
        setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data: { ...n.data, openPanel: undefined } } : n));
        if (loroSync?.connected) {
            loroSync.updateNode(id, { data: { openPanel: undefined } });
        }
    // Run once on mount if the flag is present; deps intentionally minimal.
    }, []);

    useEffect(() => {
        // Legacy remap only applies to built-in image/video actions — custom
        // actions (`custom:<id>`) resolve their model id through customDef.
        if (actionType !== 'image-gen' && actionType !== 'video-gen') {
            if (data.modelId && data.modelId !== modelId) {
                const nextModel = MODEL_CARDS.find((card) => card.id === data.modelId) || selectedModel;
                const nextParams = { ...(nextModel?.defaultParams ?? {}), ...(data.modelParams ?? {}) } as ModelParams;
                setModelId(nextModel?.id ?? (data.modelId as string));
                setModelParams(nextParams);
                return;
            }
            if (data.modelParams) {
                setModelParams((prev) => ({
                    ...(selectedModel?.defaultParams ?? {}),
                    ...prev,
                    ...data.modelParams,
                }));
            }
            return;
        }
        const incomingModelId = resolveConfiguredModelId(actionType, data.modelId as string | undefined, data.modelName);
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
        // Custom actions intentionally have selectedModel === undefined
        // (they don't use ModelCard at all — see the useMemo at line ~207).
        // Without this guard, the fallback fires for every custom badge,
        // writes modelId = nano-banana-2, which re-renders, selectedModel
        // is still undefined because isCustom is true, fallback fires
        // again — infinite update loop. The fallback only makes sense
        // for built-in gens that lost their model card (legacy data).
        if (isCustom) return;
        if (!selectedModel && availableModels[0]) {
            const fallback = availableModels[0];
            const nextParams = { ...(fallback.defaultParams ?? {}) } as ModelParams;
            setModelId(fallback.id);
            setModelParams(nextParams);
            syncModelState(fallback.id, nextParams);
        }
    }, [availableModels, selectedModel, syncModelState, isCustom]);

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
        if (loroSync?.connected) {
            loroSync.updateNode(id, { data: { label, content } });
        }
    }, [id, label, content, setNodes, loroSync]);

    const handleCancel = useCallback(() => {
        setShowModal(false);
        setLabel(data.label || 'Prompt');
        setContent(cleanContent(data.content));
    }, [data.label, data.content]);

    const handleCopy = useCallback(async () => {
        const newId = await generateSemanticId(projectId);
        const currentNode = getNode(id);
        const pos = currentNode?.position ?? { x: 0, y: 0 };
        const newNode = {
            id: newId,
            type: 'action-badge' as const,
            position: { x: pos.x + 290, y: pos.y },
            // `openPanel: true` — one-shot flag the mounted ActionBadge consumes
            // to auto-open its config panel. Clone also re-attaches ref edges,
            // so the user lands in a ready-to-tweak state.
            data: { label, content, actionType, modelId, modelParams, referenceImageOrder: refNodeIds, openPanel: true },
        };
        setNodes(nds => [...nds, newNode as any]);
        if (loroSync?.connected) {
            loroSync.addNode(newId, newNode);
        }
        // Duplicate incoming reference edges so the new copy shares the same attachments
        refNodeIds.forEach(srcId => {
            const edgeId = `${srcId}-${newId}`;
            addEdges({ id: edgeId, source: srcId, target: newId, type: 'default' });
            if (loroSync?.connected) {
                loroSync.addEdge(edgeId, { id: edgeId, source: srcId, target: newId, type: 'default' });
            }
        });
        setShowModal(false);
        closeActionPanel();
    }, [id, label, content, actionType, modelId, modelParams, refNodeIds, projectId, getNode, setNodes, addEdges, loroSync, closeActionPanel]);

    const handleLabelChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
        const newLabel = evt.target.value;
        setLabel(newLabel);
    };

    // Shared pending-asset primitives. Run always creates a fresh pending
    // output; only a draft node's Build action may adopt that draft.
    const { spawnPending, spawnDraft, canSpawn, disabledReason, outputKind } = useSpawnPendingAsset({
        actionBadgeId: id,
        actionType,
        isCustom,
        customDef,
        customActionParams,
        modelId,
        modelParams,
        selectedModel,
        content,
        dataPrompt: data.prompt as string | undefined,
        projectId,
        refNodeIds,
        getNodes,
        addNodeWithAutoLayout,
        addNodeWithLayout,
        addEdges,
        setNodes,
        loroSync,
    });

    // Auto-run effect
    const handleExecute = useCallback(async () => {
        setIsExecuting(true);
        setError(null);

        try {
            // Capture and clear pre-allocated asset ID (provided by backend; treat as single-use)
            const preAllocatedAssetId = data.preAllocatedAssetId as string | undefined;
            if (preAllocatedAssetId) {
                setNodes((nds) =>
                    nds.map((n) =>
                        n.id === id ? { ...n, data: { ...n.data, preAllocatedAssetId: undefined } } : n
                    )
                );
            }

            // Compute the batch-label base once. Custom actions always spawn 1;
            // image-gen/video-gen honor the countValue chip.
            const rawPrompt = (content && content.trim() !== '' ? content : '') || (data.prompt as string) || '';
            const textRefs = refNodeIds
                .map((nid) => resolveTextRef(getNode(nid)))
                .filter((text): text is string => !!text);
            const composedPrompt = composePromptWithTextRefs(rawPrompt, textRefs);
            const parts = parsePromptParts(composedPrompt);
            const promptText = extractPromptText(parts);
            let baseLabel: string;
            if (isCustom && customDef) {
                baseLabel = extractLabelFromPrompt(composedPrompt, `${customDef.name} Result`);
            } else if (actionType === 'video-gen') {
                baseLabel = extractLabelFromPrompt(promptText, 'Generated Video');
            } else if (actionType === 'audio-gen') {
                baseLabel = extractLabelFromPrompt(promptText, 'Generated Audio');
            } else if (actionType === 'text-gen') {
                baseLabel = extractLabelFromPrompt(promptText, 'Generated Text');
            } else {
                baseLabel = extractLabelFromPrompt(promptText, 'Generated Image');
            }

            const directorShotItems = actionType === 'video-gen'
                ? refNodeIds.flatMap((nodeId) => {
                    const node = getNode(nodeId);
                    if (!node || node.type !== 'director-stage') return [];
                    return directorReferencePackets(node)
                        .filter((packet): packet is DirectorReferencePacket & {
                            scope: { kind: 'shot'; selectedShotIds: [string, ...string[]] };
                        } => packet.scope?.kind === 'shot' && packet.scope.selectedShotIds.length === 1)
                        .map((packet) => ({
                            packet,
                            sourceNodeId: node.id,
                            shotId: packet.scope.selectedShotIds[0],
                            shotName: packet.shotSpec.shots[0]?.name,
                        }));
                })
                : [];

            if (directorShotItems.length > 0) {
                const groupId = await generateSemanticId(projectId);
                const selectedShotIds = directorShotItems.map((item) => item.shotId);
                const firstPacket = directorShotItems[0].packet;
                const groupNode = addNodeWithAutoLayout({
                    id: groupId,
                    type: 'group',
                    data: {
                        label: `Director shots · ${directorShotItems.length}`,
                        directorShotGroupId: groupId,
                        sourceDirectorStageId: firstPacket.stageId,
                        sourceDirectorStageRevisionId: firstPacket.stageRevisionId,
                        selectedDirectorShotIds: selectedShotIds,
                    },
                    style: {
                        width: 560,
                        height: Math.max(420, 112 + directorShotItems.length * 360),
                    },
                }, id, { x: 340, y: 0 });
                if (!groupNode) {
                    throw new Error('Failed to create Director Shot Group.');
                }
                if (loroSync?.connected) {
                    loroSync.addNode(groupNode.id, groupNode);
                }

                for (let i = 0; i < directorShotItems.length; i++) {
                    const item = directorShotItems[i];
                    const created = await spawnPending({
                        assetId: i === 0 ? preAllocatedAssetId : undefined,
                        directorReferencePacket: item.packet,
                        directorShotGroupId: groupId,
                        groupIndex: i,
                        labelOverride: item.shotName || `${baseLabel} · ${item.shotId}`,
                        parentGroupId: groupId,
                        sourceDirectorStageId: item.sourceNodeId,
                        sourceDirectorStageRevisionId: item.packet.stageRevisionId,
                        sourceDirectorStageShotId: item.shotId,
                    });
                    if (!created && i === 0) {
                        throw new Error('Failed to create pending Director Shot node.');
                    }
                }
            } else {
                const batchCount = (isCustom && customDef) ? 1 : countValue;
                for (let i = 0; i < batchCount; i++) {
                    const labelOverride = batchCount > 1 ? `${baseLabel} (${i + 1})` : baseLabel;
                    const assetId = i === 0 ? preAllocatedAssetId : undefined;
                    const created = await spawnPending({ assetId, labelOverride });
                    if (!created && i === 0) {
                        throw new Error('Failed to create pending node.');
                    }
                }
            }

            // Clear preAllocatedAssetId (idempotent) + mark run successful, then freeze
            setNodes((nds) => nds.map((n) => {
                if (n.id !== id) return n;
                return { ...n, data: { ...n.data, preAllocatedAssetId: undefined, status: 'success', hasRun: true } };
            }));
            if (loroSync?.connected) {
                loroSync.updateNode(id, { data: { hasRun: true } });
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
        refNodeIds,
        getNode,
        resolveTextRef,
        actionType,
        isCustom,
        customDef,
        countValue,
        spawnPending,
        setNodes,
        loroSync,
        projectId,
        addNodeWithAutoLayout,
    ]);

    // Helper to extract meaningful label from prompt content (already moved outside)


    // Execute action: generate image or video
    useEffect(() => {
        const requiredUpstreams: string[] = Array.isArray(data.upstreamNodeIds) ? data.upstreamNodeIds : [];

        if (data.autoRun && !isExecuting) {
            if (requiredUpstreams.length > 0) {
                const connectedSources = connectedEdges.filter(e => e.target === id).map(e => e.source);
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
    }, [data, data.autoRun, connectedEdges, data.upstreamNodeIds, id, isExecuting, handleExecute]);

    // Modal content (from PromptNode)
    const modalContent = showModal ? (
        <NodeModalDialog
            open={showModal}
            onClose={handleCancel}
            ariaLabel="Expanded prompt editor"
            overlayClassName="bg-warm-page/80"
        >
                    {/* Header with Title Input */}
                    <div className="px-12 pt-8 pb-2 flex justify-between items-start">
                        <Input
                            type="text"
                            value={label}
                            onChange={handleLabelChange}
                            disabled={isCheckpointLocked}
                            placeholder="Untitled Prompt"
                            className="w-full text-4xl font-bold text-slate-900 dark:text-slate-50 placeholder:text-stone-300 bg-transparent border-none outline-none focus:outline-none disabled:opacity-60"
                            style={{
                                fontFamily: 'var(--font-space-grotesk), var(--font-inter), sans-serif',
                                letterSpacing: '-0.02em'
                            }}
                        />
                        <div className="flex gap-2 items-center">
                            {isCheckpointLocked ? (
                                <>
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-warm-muted text-slate-700 dark:text-slate-300 text-sm font-medium">
                                        <Lock size={13} weight="bold" />
                                        Checkpoint
                                    </div>
                                    <Button
                                        onClick={handleCopy}
                                        leftIcon={<Copy size={14} weight="bold" />}
                                        size="sm"
                                        shape="rounded"
                                        className="clash-node-primary rounded-xl px-4 py-2 text-sm font-medium"
                                    >
                                        Copy to revise
                                    </Button>
                                </>
                            ) : (
                                <Button
                                    onClick={handleSave}
                                    size="sm"
                                    shape="rounded"
                                    className="clash-node-primary rounded-xl px-4 py-2 text-sm font-medium"
                                >
                                    Save
                                </Button>
                            )}
                            <IconButton
                                label="Close expanded prompt editor"
                                onClick={handleCancel}
                                icon={<X className="w-5 h-5" weight="bold" />}
                                size="md"
                                shape="rounded"
                                className="text-stone-700 hover:bg-warm-muted hover:text-stone-600 dark:text-stone-300"
                            />
                        </div>
                    </div>

                    {/* Image Attachment Row */}
                    {(refNodeIds.length > 0 || !isCheckpointLocked) && (
                        <div className="px-12 py-3 flex items-center gap-2 flex-wrap border-b border-warm-border">
                            <Reorder.Group
                                axis="x"
                                values={refNodeIds}
                                onReorder={persistRefOrder}
                                className="flex items-center gap-2 flex-wrap"
                                as="div"
                            >
                                {refNodeIds.map((nodeId, i) => {
                                    const node = getNode(nodeId);
                                    const src = resolveRefSrc(node);
                                    const textRef = resolveTextRef(node);
                                    const isText = node?.type === 'text';
                                    return (
                                        <Reorder.Item
                                            key={nodeId}
                                            value={nodeId}
                                            drag={isCheckpointLocked ? false : 'x'}
                                            className="relative group/thumb flex-shrink-0"
                                            as="div"
                                            whileDrag={{ scale: 1.08, zIndex: 10 }}
                                            style={{ cursor: isCheckpointLocked ? 'default' : 'grab' }}
                                        >
                                            <div className="w-10 h-10 rounded-lg overflow-hidden border border-warm-border bg-warm-muted flex items-center justify-center pointer-events-none">
                                                {src ? (
                                                    <SignedImg src={src} alt={`Image ${i + 1}`} className="w-full h-full object-cover" />
                                                ) : isText && textRef ? (
                                                    <TextT size={16} className="text-slate-700 dark:text-slate-300" weight="bold" />
                                                ) : (
                                                    <ImageIcon size={16} className="text-slate-700 dark:text-slate-300" />
                                                )}
                                            </div>
                                            <span className="clash-node-ref-index absolute -top-1 -left-1 text-[9px] font-bold rounded px-1 min-w-[14px] text-center leading-[14px] pointer-events-none">
                                                {i + 1}
                                            </span>
                                            {!isCheckpointLocked && (
                                                <IconButton
                                                    label={`Remove reference ${i + 1}`}
                                                    icon="×"
                                                    size="sm"
                                                    shape="circle"
                                                    onClick={() => removeRefNode(nodeId)}
                                                    className={`${NODE_INTERACTION_BOUNDARY_CLASS} clash-node-ref-remove absolute -top-1 -right-1 hidden h-5 min-h-5 w-5 min-w-5 text-[11px] leading-none group-hover/thumb:flex`}
                                                />
                                            )}
                                        </Reorder.Item>
                                    );
                                })}
                            </Reorder.Group>
                            {!isCheckpointLocked && (
                                <Popover open={showRefPicker} onOpenChange={setShowRefPicker}>
                                    <PopoverTrigger asChild>
                                        <IconButton
                                            label="Add reference from canvas"
                                            icon={<Plus size={16} weight="bold" />}
                                            size="lg"
                                            shape="rounded"
                                            className="h-10 min-h-10 w-10 min-w-10 rounded-lg border border-dashed border-warm-border text-content-secondary hover:border-brand/45 hover:bg-transparent hover:text-content-primary"
                                        />
                                    </PopoverTrigger>
                                    <PopoverContent
                                        side="bottom"
                                        align="start"
                                        sideOffset={4}
                                        className="z-[9999] w-56 overflow-hidden rounded-xl p-0"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {(() => {
                                            const available = getNodes().filter(n => {
                                                if (refNodeIds.includes(n.id)) return false;
                                                return !!resolveRefSrc(n) || !!resolveTextRef(n);
                                            });
                                            if (available.length === 0) {
                                                return <div className="px-3 py-3 text-xs text-slate-700 dark:text-slate-300">No references available</div>;
                                            }
                                            return available.map(n => {
                                                const refSrc = resolveRefSrc(n);
                                                const textRef = resolveTextRef(n);
                                                if (!refSrc && !textRef) return null;
                                                return (
                                                    <Button
                                                        key={n.id}
                                                        size="sm"
                                                        shape="rounded"
                                                        className="w-full justify-start rounded-none border-0 bg-transparent px-3 py-2 text-left shadow-none hover:bg-warm-muted"
                                                        onClick={() => {
                                                            addRefNode(n.id);
                                                            setShowRefPicker(false);
                                                        }}
                                                    >
                                                        <div className="w-7 h-7 rounded overflow-hidden border border-warm-border flex-shrink-0">
                                                            {refSrc ? (
                                                                <SignedImg src={refSrc} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full bg-warm-muted flex items-center justify-center text-slate-700 dark:text-slate-300">
                                                                    <TextT size={14} weight="bold" />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <span className="text-xs text-slate-800 dark:text-slate-200 truncate">{(n.data.label as string) || n.id}</span>
                                                    </Button>
                                                );
                                            });
                                        })()}
                                    </PopoverContent>
                                </Popover>
                            )}
                        </div>
                    )}

                    {/* Editor Content */}
                    <div className="flex-1 overflow-y-auto bg-warm-surface" style={isCheckpointLocked ? { pointerEvents: 'none', opacity: 0.7 } : undefined}>
                        <MilkdownEditor
                            value={content}
                            onChange={setContent}
                            mentionableNodes={mentionableNodes}
                            promptModalities={[...(cap?.promptModalities ?? ['text'])]}
                            connectedNodeIds={refNodeIds}
                        />
                    </div>
        </NodeModalDialog>
    ) : null;

    // Computed display name for the badge
    const badgeDisplayName = isCustom
        ? (customDef?.name || customActionId || 'Custom')
        : (selectedModel?.name || modelId || (actionKind === 'video' ? 'Video' : actionKind === 'audio' ? 'Audio' : actionKind === 'text' ? 'Text' : 'Image'));

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

    const closeConfigPanelControls = useCallback(() => {
        setParamsPopoverOpen(false);
        setRefPickerTarget(null);
    }, []);

    useEffect(() => {
        if (showPanel) return;
        closeConfigPanelControls();
        setShowMentionMenu(false);
    }, [closeConfigPanelControls, showPanel]);

    useEffect(() => {
        if (!showPanel) return;
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            closeActionPanel();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [closeActionPanel, showPanel]);

    // ReactFlow's NodeToolbar owns screen-space positioning, so this panel
    // follows node drag and viewport transforms without a floating-ui poll.
    const configPanel = (
        <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            data-action-config-panel={id}
            className="w-[min(42rem,calc(100vw-2rem))] max-w-none flex flex-col items-start"
        >
                    {/* Reference images strip above the prompt panel.
                        - startEnd models: two labeled Start/End slots joined by ⇌, always visible.
                        - Other models: Reorder.Group of numbered thumbs (drag to reorder, × to detach). */}
                    {isStartEnd ? (
                        <div className="pointer-events-auto mb-2 px-1 relative">
                            <div className="flex items-center gap-1.5">
                                {(['start', 'end'] as const).map((slot, slotIdx) => {
                                    const nodeId = refNodeIds[slotIdx];
                                    const node = nodeId ? getNode(nodeId) : undefined;
                                    const thumb = nodeId ? refThumbByNodeId.get(nodeId) : undefined;
                                    const badge = slot === 'start' ? 'S' : 'E';
                                    const fullLabel = slot === 'start' ? 'Start' : 'End';

                                    return (
                                        <Fragment key={slot}>
                                            {slotIdx === 1 && (
                                                <span className="text-slate-700 dark:text-slate-300 text-xs select-none px-0.5" aria-hidden>⇌</span>
                                            )}
                                            <div className="relative group/thumb flex-shrink-0">
                                                {node && thumb ? (
                                                    <>
                                                        <SignedImg
                                                            src={thumb}
                                                            alt={fullLabel}
                                                            className="h-10 w-10 rounded-lg object-cover border border-warm-border shadow-sm"
                                                        />
                                                        {!isCheckpointLocked && (
                                                            <IconButton
                                                                label={`Clear ${fullLabel} frame`}
                                                                icon="×"
                                                                size="sm"
                                                                shape="circle"
                                                                onClick={() => removeRefNode(nodeId!)}
                                                                className={`${NODE_INTERACTION_BOUNDARY_CLASS} clash-node-ref-remove absolute -top-1 -right-1 hidden h-5 min-h-5 w-5 min-w-5 text-[11px] leading-none group-hover/thumb:flex`}
                                                            />
                                                        )}
                                                    </>
                                                ) : (
                                                    <Popover
                                                        open={refPickerTarget === slot}
                                                        onOpenChange={(open) => setRefPickerTarget(open ? slot : null)}
                                                    >
                                                        <PopoverTrigger asChild>
                                                            <IconButton
                                                                label={`Pick ${fullLabel} frame`}
                                                                icon={<Plus size={14} weight="bold" />}
                                                                size="lg"
                                                                shape="rounded"
                                                                disabled={isCheckpointLocked}
                                                                className="h-10 min-h-10 w-10 min-w-10 rounded-lg border border-dashed border-warm-border bg-warm-surface text-content-secondary shadow-sm hover:border-brand/45 hover:bg-warm-muted hover:text-content-primary"
                                                            />
                                                        </PopoverTrigger>
                                                        <PopoverContent
                                                            side="top"
                                                            align="start"
                                                            className="z-[9999] w-[320px] overflow-hidden rounded-xl p-0"
                                                            onPointerDown={(e) => e.stopPropagation()}
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <RefPickerContent
                                                                candidates={refPickerCandidates}
                                                                onPick={(nid) => {
                                                                    attachRefToSlot(nid, slot);
                                                                    setRefPickerTarget(null);
                                                                }}
                                                            />
                                                        </PopoverContent>
                                                    </Popover>
                                                )}
                                                <span className="clash-node-ref-index absolute -top-1 -left-1 text-[9px] font-bold rounded px-1 min-w-[14px] text-center leading-[14px] pointer-events-none">
                                                    {badge}
                                                </span>
                                            </div>
                                        </Fragment>
                                    );
                                })}
                            </div>
                            {startEndMismatch && (
                                <p className="mt-1.5 text-[10px] text-amber-600 leading-tight">
                                    Start and end frames have different aspect ratios ({formatRatio(startEndMismatch.s.w, startEndMismatch.s.h)} vs {formatRatio(startEndMismatch.e.w, startEndMismatch.e.h)}). Output will likely be distorted — use frames with matching dimensions.
                                </p>
                            )}
                        </div>
                    ) : acceptsAnyRef && (
                        <div className="pointer-events-auto mb-2 px-1 relative">
                            <div className="flex items-center gap-1.5">
                                <Reorder.Group
                                    axis="x"
                                    values={refNodeIds}
                                    onReorder={persistRefOrder}
                                    className="flex gap-1.5"
                                    as="div"
                                >
                                    {refNodeIds.map((nodeId, i) => {
                                        const node = getNode(nodeId);
                                        if (!node) return null;
                                        // Thumb source: asset row (coverR2Key for video, srcR2Key for
                                        // image) resolved in the refThumbByNodeId effect above. Video
                                        // nodes whose asset hasn't landed yet render as a video-icon
                                        // tile via the `isVideo` fallback below — same UX as before.
                                        const thumb = refThumbByNodeId.get(nodeId);
                                        const isText = node.type === 'text';
                                        const isAudio = node.type === 'audio';
                                        const isVideo = node.type === 'video';
                                        if (!thumb && !isText && !isAudio && !isVideo) return null;
                                        const badge = `${i + 1}`;
                                        return (
                                            <Reorder.Item
                                                key={nodeId}
                                                value={nodeId}
                                                drag={isCheckpointLocked ? false : 'x'}
                                                as="div"
                                                className="relative group/thumb flex-shrink-0"
                                                whileDrag={{ scale: 1.08, zIndex: 10 }}
                                                style={{ cursor: isCheckpointLocked ? 'default' : 'grab' }}
                                            >
                                                {isText ? (
                                                    <div className="h-10 w-10 rounded-lg bg-warm-muted border border-warm-border shadow-sm flex items-center justify-center text-slate-700 dark:text-slate-300 pointer-events-none">
                                                        <TextT size={16} weight="bold" />
                                                    </div>
                                                ) : isAudio ? (
                                                    <div className="h-10 w-10 rounded-lg bg-audio/15 border border-warm-border shadow-sm flex items-center justify-center text-audio text-lg pointer-events-none">
                                                        ♪
                                                    </div>
                                                ) : isVideo && !thumb ? (
                                                    <div className="h-10 w-10 rounded-lg bg-video/15 border border-warm-border shadow-sm flex items-center justify-center text-video pointer-events-none">
                                                        <VideoCamera size={14} weight="bold" />
                                                    </div>
                                                ) : (
                                                    <SignedImg
                                                        src={thumb!}
                                                        alt={(node.data.label as string) || nodeId}
                                                        className="h-10 w-10 rounded-lg object-cover border border-warm-border shadow-sm pointer-events-none"
                                                    />
                                                )}
                                                <span className="clash-node-ref-index absolute -top-1 -left-1 text-[9px] font-bold rounded px-1 min-w-[14px] text-center leading-[14px] pointer-events-none">
                                                    {badge}
                                                </span>
                                                {!isCheckpointLocked && (
                                                    <IconButton
                                                        label={`Remove reference ${i + 1}`}
                                                        icon="×"
                                                        size="sm"
                                                        shape="circle"
                                                        onClick={() => removeRefNode(nodeId)}
                                                        className={`${NODE_INTERACTION_BOUNDARY_CLASS} clash-node-ref-remove absolute -top-1 -right-1 hidden h-5 min-h-5 w-5 min-w-5 text-[11px] leading-none group-hover/thumb:flex`}
                                                    />
                                                )}
                                            </Reorder.Item>
                                        );
                                    })}
                                </Reorder.Group>
                                {!isCheckpointLocked && (
                                    <Popover
                                        open={refPickerTarget === 'append'}
                                        onOpenChange={(open) => setRefPickerTarget(open ? 'append' : null)}
                                    >
                                        <PopoverTrigger asChild>
                                            <IconButton
                                                label="Add reference from canvas"
                                                icon={<Plus size={14} weight="bold" />}
                                                size="lg"
                                                shape="rounded"
                                                className="h-10 min-h-10 w-10 min-w-10 flex-shrink-0 rounded-lg border border-dashed border-warm-border bg-warm-surface text-content-secondary shadow-sm hover:border-brand/45 hover:bg-warm-muted hover:text-content-primary"
                                            />
                                        </PopoverTrigger>
                                        <PopoverContent
                                            side="top"
                                            align="start"
                                            className="z-[9999] w-[320px] overflow-hidden rounded-xl p-0"
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <RefPickerContent
                                                candidates={refPickerCandidates}
                                                onPick={(nid) => {
                                                    attachRefToSlot(nid, 'append');
                                                    setRefPickerTarget(null);
                                                }}
                                            />
                                        </PopoverContent>
                                    </Popover>
                                )}
                            </div>
                        </div>
                    )}

                <div
                    className="pointer-events-auto w-full rounded-2xl bg-warm-surface shadow-2xl border border-warm-border overflow-visible"
                    onClick={() => {
                        setParamsPopoverOpen(false);
                    }}
                >
                    {/* Prompt editor with inline @ mention chips. Materialized
                        checkpoints render read-only because downstream lineage
                        now depends on these inputs. */}
                    <div className="relative px-4 pt-3 pb-4 nodrag">
                        <div
                            ref={editorRef}
                            contentEditable={!isCheckpointLocked}
                            suppressContentEditableWarning
                            className={`${NODE_INTERACTION_BOUNDARY_CLASS} w-full max-h-[40vh] overflow-y-auto text-sm focus:outline-none leading-relaxed empty:before:content-[attr(data-placeholder)] empty:before:text-stone-400 ${
                                isCheckpointLocked ? 'text-stone-700 dark:text-stone-300 cursor-default select-text' : 'text-slate-900 dark:text-slate-50'
                            }`}
                            style={{ minHeight: '3em' }}
                            data-placeholder="Describe anything you want to generate... (@ to ref assets)"
                            onInput={isCheckpointLocked ? undefined : handleEditorInput}
                            onKeyDown={isCheckpointLocked ? undefined : handleEditorKeyDown}
                        />
                        {showMentionMenu && filteredMentionNodes.length > 0 && (
                            <ActionMentionPicker
                                nodes={filteredMentionNodes}
                                store={mentionCombobox}
                            />
                        )}
                    </div>

                    {/* Bottom toolbar: model selector + clickable param chips */}
                    <div className="flex items-center gap-1.5 px-3 pb-3 flex-nowrap overflow-visible">
                        {/* Model selector chip. For custom actions whose runtime is
                            offline, render in a disabled, low-opacity state with a
                            tooltip — we don't auto-switch off the action, but we
                            also don't open the model picker (custom actions don't
                            have alternative models anyway). */}
                        <div
                            className="relative"
                            style={customActionOffline ? { opacity: 0.5 } : undefined}
                        >
                            <Tooltip label={modelPickerLabel}>
                                <span className="inline-flex min-w-0">
                                    <SelectMenu<string>
                                        className="relative"
                                        triggerClassName="px-2.5 py-1 text-xs"
                                        value={modelId}
                                        options={compatibleAvailableModels
                                            .map((card) => {
                                                return {
                                                    value: card.id,
                                                    label: card.name,
                                                    description: getModelDropdownSecondaryText(true),
                                                };
                                            })}
                                        onValueChange={(nextModelId) => {
                                            handleModelChange(nextModelId);
                                            setParamsPopoverOpen(false);
                                        }}
                                        ariaLabel="Model"
                                        triggerLabel={modelDisplay}
                                        triggerPrefix={<Icon size={12} weight="bold" className={colorClass} />}
                                        variant="pill"
                                        size="sm"
                                        placement="top"
                                        menuWidth={240}
                                        maxMenuHeight={192}
                                        disabled={customActionOffline}
                                        stopPropagation
                                    />
                                </span>
                            </Tooltip>
                            {customActionOffline && (
                                <span className="ml-2 text-[10px] text-slate-700 dark:text-slate-300 align-middle">
                                    {RUNTIME_OFFLINE_LABEL}
                                </span>
                            )}
                        </div>

                        {/* Combined params chip → opens single popover with all params */}
                        {paramChips.length > 0 && (
                            <Popover
                                open={paramsPopoverOpen}
                                onOpenChange={(nextOpen) => {
                                    setParamsPopoverOpen(nextOpen);
                                }}
                            >
                                <PopoverTrigger asChild>
                                    <Button
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-colors ${
                                            paramsPopoverOpen ? 'bg-warm-hover text-slate-900 dark:text-slate-50' : 'bg-warm-muted hover:bg-warm-hover text-stone-700 dark:text-stone-300'
                                        } h-auto min-h-0 border-0 shadow-none`}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <span className="font-medium text-current">
                                            {paramChips.map((c) => c.value).join(' · ')}
                                        </span>
                                        <CaretDown size={10} weight="bold" className="text-stone-700 dark:text-stone-300" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                    side="top"
                                    align="start"
                                    className="z-[9999] min-w-[240px] overflow-hidden rounded-2xl p-0"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <Accordion type="single" collapsible>
                                        {((isCustom ? customDef?.parameters : selectedModel?.parameters) ?? []).map((param: any, idx: number) => {
                                            const p = param as ModelParameter;
                                            const currentVal = modelParams[p.id] ?? p.defaultValue;
                                            const currentLabel = p.type === 'select'
                                                ? (p.options?.find((o) => String(o.value) === String(currentVal))?.label ?? String(currentVal))
                                                : p.type === 'boolean' ? (currentVal ? 'On' : 'Off') : String(currentVal);
                                            const sliderValue = p.type === 'slider'
                                                ? normalizeSliderValue(currentVal, p.min ?? 0)
                                                : 0;
                                            return (
                                                <AccordionItem
                                                    key={p.id}
                                                    value={p.id}
                                                    className={idx > 0 ? 'border-t border-warm-border' : ''}
                                                >
                                                    <AccordionTrigger asChild>
                                                        <Button
                                                            size="sm"
                                                            shape="rounded"
                                                            className="group w-full justify-between rounded-none border-0 bg-transparent px-4 py-2.5 shadow-none hover:bg-warm-muted"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <span className="text-xs text-stone-700 dark:text-stone-300">{p.label}</span>
                                                            <span className="flex items-center gap-1 text-xs font-semibold text-slate-900 dark:text-slate-50">
                                                                {currentLabel}
                                                                <CaretDown size={10} weight="bold" className="text-stone-700 transition-transform group-data-[state=open]:rotate-180 dark:text-stone-300" />
                                                            </span>
                                                        </Button>
                                                    </AccordionTrigger>
                                                    <AccordionContent>
                                                        <div className="px-3 pb-3">
                                                            {(p.type === 'select') && (
                                                                <SelectMenu<SelectValue>
                                                                    ariaLabel={p.label}
                                                                    value={currentVal as SelectValue}
                                                                    options={paramOptionsToSelectOptions(p)}
                                                                    onValueChange={(nextValue) => updateModelParam(p.id, nextValue)}
                                                                    triggerLabel={currentLabel}
                                                                    variant="field"
                                                                    placement="bottom"
                                                                    menuWidth="trigger"
                                                                    stopPropagation
                                                                />
                                                            )}
                                                            {p.type === 'boolean' && (
                                                                <SelectMenu<boolean>
                                                                    ariaLabel={p.label}
                                                                    value={Boolean(currentVal)}
                                                                    options={PARAM_BOOLEAN_OPTIONS}
                                                                    onValueChange={(nextValue) => updateModelParam(p.id, nextValue)}
                                                                    triggerLabel={currentLabel}
                                                                    variant="field"
                                                                    placement="bottom"
                                                                    menuWidth="trigger"
                                                                    stopPropagation
                                                                />
                                                            )}
                                                            {p.type === 'number' && (
                                                                <Input type="number" min={p.min} max={p.max} step={p.step}
                                                                    value={currentVal as number}
                                                                    onChange={(e) => updateModelParam(p.id, Number(e.target.value))}
                                                                    className={`${NODE_INTERACTION_BOUNDARY_CLASS} w-full text-xs border border-warm-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand/70`}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                />
                                                            )}
                                                            {p.type === 'slider' && (
                                                                <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                                                                    <div className="flex justify-between text-[10px] text-stone-700 dark:text-stone-300">
                                                                        <span>{p.min}</span><span className="font-semibold text-slate-900 dark:text-slate-50">{sliderValue}</span><span>{p.max}</span>
                                                                    </div>
                                                                    <ModelParamSlider
                                                                        ariaLabel={p.label}
                                                                        min={p.min}
                                                                        max={p.max}
                                                                        step={p.step}
                                                                        value={sliderValue}
                                                                        onChange={(nextValue) => updateModelParam(p.id, nextValue)}
                                                                        trackClassName="bg-warm-hover"
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </AccordionContent>
                                                </AccordionItem>
                                            );
                                        })}
                                    </Accordion>
                                </PopoverContent>
                            </Popover>
                        )}

                        {/* Spacer */}
                        <div className="flex-1 min-w-[8px]" />

                        {/* Batch count chip (xN). Stays interactive even when checkpoint-locked —
                            user can bump the count and then Run to spawn more siblings. */}
                        <SelectMenu<number>
                            ariaLabel="Batch count"
                            value={countValue}
                            options={BATCH_COUNT_OPTIONS}
                            onValueChange={(nextCount) => updateModelParam('count', nextCount)}
                            triggerLabel={`x${countValue}`}
                            variant="pill"
                            size="sm"
                            align="end"
                            placement="top"
                            menuWidth={80}
                            maxMenuHeight={176}
                            showCaret
                            stopPropagation
                            triggerClassName="h-auto min-h-0 px-2.5 py-1 text-xs"
                        />

                        {/* Materialized-checkpoint lock: Run again or copy into a fresh revision. */}
                        {isCheckpointLocked && (
                            <>
                                <Tooltip label="Duplicate this panel and open the copy">
                                    <Button
                                        onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                                        disabled={isExecuting}
                                        leftIcon={<Copy size={12} weight="bold" />}
                                        size="sm"
                                        shape="pill"
                                        className="h-7 min-h-7 flex-shrink-0 border-0 bg-warm-muted px-2.5 text-xs font-medium text-stone-800 shadow-none hover:bg-warm-hover dark:text-stone-200"
                                        aria-label="Duplicate this panel and open the copy"
                                    >
                                        Copy & open
                                    </Button>
                                </Tooltip>
                                <Tooltip label={checkpointRunLabel}>
                                    <span className="inline-flex flex-shrink-0">
                                        <Button
                                            onClick={(e) => { e.stopPropagation(); if (customActionOffline) return; handleExecute(); }}
                                            disabled={isExecuting || customActionOffline}
                                            leftIcon={isExecuting ? (
                                                <Spinner size={12} weight="bold" className="animate-spin" />
                                            ) : (
                                                <Play size={11} weight="fill" />
                                            )}
                                            size="sm"
                                            shape="pill"
                                            className="clash-node-primary h-7 min-h-7 flex-shrink-0 px-3 text-xs font-semibold"
                                            aria-label={checkpointRunLabel}
                                            aria-disabled={customActionOffline || undefined}
                                        >
                                            Run
                                        </Button>
                                    </span>
                                </Tooltip>
                            </>
                        )}
                    </div>
                </div>
        </motion.div>
    );

    return (
        <>
            {/* Outer width matches the capsule so left/right handles snap to
                the visible edges. Without `w-[260px]`, the wrapper inherits
                the wider React Flow bounding rect and the handle floats. */}
            <div className="group relative w-[260px]">
                    {/* Peer selection rings — drawn behind the capsule. Local
                        blue ring is inset on the capsule itself, so peer rings
                        on the outside don't visually fight it. */}
                    <PeerSelectionRing peers={peersSelecting} />

                    <div
                        className={`w-[260px] ${bgClass} rounded-xl overflow-hidden transition-all duration-300 hover:shadow-lg ${
                            selected ? `ring-4 ${ringClass} ring-offset-2` : 'ring-1 ring-slate-200'
                        }`}
                    >
                        <div className="flex items-stretch">
                            <Button
                                aria-label="Configure action"
                                size="sm"
                                shape="rounded"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    toggleActionPanel();
                                }}
                                className="h-auto min-h-0 min-w-0 flex-1 cursor-pointer justify-start gap-2.5 rounded-none border-0 bg-transparent px-3.5 py-4 text-left shadow-none hover:bg-transparent focus-visible:ring-inset"
                            >
                                    <div className={`flex-shrink-0 ${colorClass}`}>
                                        <Icon size={16} weight="fill" />
                                    </div>
                                    <div className="flex flex-col min-w-0 flex-1">
                                        <span className={`text-xs font-bold font-display ${colorClass} truncate`}>
                                            {label || 'Action'}
                                        </span>
                                        <span className="text-[10px] text-slate-700 dark:text-slate-300 truncate leading-none">
                                            {badgeDisplayName}
                                        </span>
                                        {/* Phase 0 attribution — only renders when actor info is populated. */}
                                        <AttributionLine
                                            actorType={data.actorType as 'user' | 'agent' | undefined}
                                            actorUserId={data.actorUserId as string | undefined}
                                            actorAgentId={data.actorAgentId as string | undefined}
                                        />
                                    </div>
                            </Button>
                            <div className="flex flex-shrink-0 items-center pr-3.5">
                                {/* Run button — separate click target */}
                                <Tooltip label={panelRunLabel}>
                                    <span className="inline-flex flex-shrink-0">
                                        <Button
                                            className={`nodrag h-7 min-h-7 flex-shrink-0 rounded-lg px-3 text-xs font-semibold text-white transition-transform hover:scale-[1.02] active:scale-95 ${btnClass}`}
                                            onClick={(e) => { e.stopPropagation(); if (customActionOffline) return; handleExecute(); }}
                                            disabled={isExecuting || customActionOffline}
                                            aria-label={panelRunLabel}
                                            aria-disabled={customActionOffline || undefined}
                                            leftIcon={isExecuting ? (
                                                <Spinner size={12} className="animate-spin" />
                                            ) : (
                                                <Play size={12} weight="fill" />
                                            )}
                                            size="sm"
                                            shape="rounded"
                                        >
                                            {isExecuting ? 'Running' : 'Run'}
                                        </Button>
                                    </span>
                                </Tooltip>
                            </div>
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
                        className="!h-4 !w-4 !border-4 !border-warm-surface !bg-stone-400 transition-all hover:scale-125 shadow-sm hover:!bg-brand"
                    />
                    <ActionBadgePipelineMenu
                        nodeId={id}
                        spawnDraft={spawnDraft}
                        canSpawn={canSpawn}
                        disabledReason={disabledReason}
                        outputKind={outputKind}
                    />
            </div>
            <NodeToolbar
                nodeId={id}
                isVisible={showPanel}
                position={Position.Bottom}
                align="center"
                offset={12}
                className="nodrag nopan nowheel pointer-events-auto z-[9998]"
                style={{ zIndex: 9998 }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
            >
                {configPanel}
            </NodeToolbar>

            {modalContent}
        </>
    );
};

// Reduce raw W/H dimensions to a simplest-form "W:H" label via GCD. Works
// because image/video natural dims are integers, so common ratios collapse
// cleanly (1920×1080 → 16:9) without any hardcoded table of "known" ratios.
function formatRatio(w: number, h: number): string {
    const a = Math.max(1, Math.round(w));
    const b = Math.max(1, Math.round(h));
    const gcd = (x: number, y: number): number => y ? gcd(y, x % y) : x;
    const g = gcd(a, b);
    return `${a / g}:${b / g}`;
}

const RefPickerContent = ({
    candidates,
    onPick,
}: {
    candidates: RFNode[];
    onPick: (nodeId: string) => void;
}) => {
    return (
        <>
            <div className="px-3 py-2 text-[11px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide border-b border-warm-border">
                Pick a canvas asset
            </div>
            {candidates.length === 0 ? (
                <div className="px-3 py-6 text-xs text-slate-700 dark:text-slate-300 text-center">
                    No eligible canvas nodes available.
                </div>
            ) : (
                <div className="max-h-60 overflow-y-auto p-2 grid grid-cols-4 gap-2">
                    {candidates.map((n) => (
                        <RefPickerOptionButton key={n.id} node={n} onPick={onPick} />
                    ))}
                </div>
            )}
        </>
    );
};

function RefPickerOptionButton({
    node,
    onPick,
}: {
    node: RFNode;
    onPick: (nodeId: string) => void;
}) {
    const thumb = node.type === 'video'
        ? (node.data?.coverUrl as string | undefined) ?? (node.data?.src as string | undefined)
        : (node.data?.src as string | undefined);
    const label = (node.data?.label as string) || node.id;
    const handlePick = useCallback(() => {
        onPick(node.id);
    }, [node.id, onPick]);

    return (
        <Tooltip label={label}>
            <Button
                onClick={handlePick}
                size="sm"
                shape="rounded"
                className="group relative h-auto min-h-0 overflow-hidden rounded-lg border border-warm-border bg-transparent p-0 shadow-none hover:border-slate-900 hover:bg-transparent hover:shadow-md"
                aria-label={label}
            >
                {node.type === 'text' ? (
                    <div className="h-16 w-full bg-warm-muted flex items-center justify-center text-slate-700 dark:text-slate-300">
                        <TextT size={22} weight="bold" />
                    </div>
                ) : node.type === 'audio' || !thumb ? (
                    <div className={`h-16 w-full flex items-center justify-center text-xl ${node.type === 'audio' ? 'bg-audio/15 text-audio' : 'bg-warm-muted text-slate-500'}`}>
                        {node.type === 'audio' ? '♪' : '?'}
                    </div>
                ) : (
                    <SignedImg src={thumb} alt={label} className="h-16 w-full object-cover" />
                )}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[10px] text-white truncate">
                    {label}
                </div>
            </Button>
        </Tooltip>
    );
}

export default memo(PromptActionNode);
