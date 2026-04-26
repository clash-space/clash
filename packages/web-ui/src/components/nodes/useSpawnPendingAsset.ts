import { useCallback, useMemo } from 'react';
import type { Node as RFNode } from '@xyflow/react';
import {
    parsePromptParts,
    extractPromptText,
    composePromptWithTextRefs,
    resolveAspectRatio,
    validateGenerationInput,
    partitionRefs,
    type ModelCard,
    type CustomActionDefinition,
} from '@clash/shared-types';
import { generateSemanticId } from '@clash/web-ui/lib/utils/semanticId';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';

type ModelParams = Record<string, string | number | boolean>;
type LoroSync = ReturnType<typeof useOptionalLoroSyncContext>;

export interface UseSpawnPendingAssetInput {
    actionBadgeId: string;
    actionType: string;
    isCustom: boolean;
    customDef: CustomActionDefinition | undefined;
    customActionParams: ModelParams;
    modelId: string;
    modelParams: ModelParams;
    selectedModel: ModelCard | undefined;
    content: string;
    dataPrompt: string | undefined;
    projectId: string;
    refNodeIds: string[];
    getNodes: () => RFNode[];
    addNodeWithAutoLayout: (node: Partial<RFNode> & { id: string; type: string; data: Record<string, unknown> }, parentId: string, offset?: { x: number; y: number }) => RFNode | null;
    addEdges: (edge: { id: string; source: string; target: string; type: string }) => void;
    setNodes: (updater: (nds: RFNode[]) => RFNode[]) => void;
    loroSync: LoroSync;
}

export interface SpawnOpts {
    /** If provided, use this as the new node ID. Otherwise, generate a fresh semantic ID. */
    assetId?: string;
    /** Override the extracted label. Run uses this to append `(N)` for batch siblings. */
    labelOverride?: string;
}

export interface AdoptOpts {
    labelOverride?: string;
    /** If provided, stamp `data.cascadeToken` on the adopted node — the cascade controller watches for this. */
    cascadeToken?: string;
}

export interface UseSpawnPendingAssetResult {
    /** Create a new node with `status: 'pending'` and edge from this action. */
    spawnPending: (opts?: SpawnOpts) => Promise<RFNode | null>;
    /** Create a new node with `status: 'draft'` and edge from this action. NodeProcessor ignores drafts. */
    spawnDraft: (opts?: SpawnOpts) => Promise<RFNode | null>;
    /**
     * Update an existing downstream draft: rewrite its data (fresh prompt/model/params + re-partitioned ref URLs),
     * flip `status: 'draft' → 'pending'`. No edge created — the draft already has one.
     */
    adoptDraft: (draftId: string, opts?: AdoptOpts) => Promise<RFNode | null>;
    canSpawn: boolean;
    disabledReason: string | null;
    /** The modality of the node this hook will create. */
    outputKind: 'image' | 'video' | 'audio' | 'text';
}

function extractLabelFromPrompt(promptText: string, fallback: string): string {
    if (!promptText || promptText.trim() === '') return fallback;
    const lines = promptText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line !== 'Prompt' && line !== 'Enter your prompt here...');
    if (lines.length === 0) return fallback;
    const firstLine = lines[0];
    return firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
}

/**
 * Shared primitive set for the action-badge ↔ downstream pending/draft lifecycle.
 *
 * - `spawnPending` — existing eager path (used by Run's batch loop as fallback).
 * - `spawnDraft`   — lazy placeholder (used by the `+` flyout); NodeProcessor
 *                    ignores `status:'idle'` so no generation kicks off until
 *                    something adopts it.
 * - `adoptDraft`   — the unix-pipe trigger. Re-reads the action-badge's CURRENT
 *                    prompt/model/params/refs (crucial: upstream may have become
 *                    `completed` after the draft was created) and writes a fresh
 *                    data payload onto the draft, flipping its status to
 *                    `pending`. Takes an optional `cascadeToken` so the cascade
 *                    controller can track a run's frontier.
 *
 * All three share the same validation, prompt parsing, and ref-partition logic.
 */
export function useSpawnPendingAsset(input: UseSpawnPendingAssetInput): UseSpawnPendingAssetResult {
    const {
        actionBadgeId,
        actionType,
        isCustom,
        customDef,
        customActionParams,
        modelId,
        modelParams,
        selectedModel,
        content,
        dataPrompt,
        projectId,
        refNodeIds,
        getNodes,
        addNodeWithAutoLayout,
        addEdges,
        setNodes,
        loroSync,
    } = input;

    const outputKind = useMemo<'image' | 'video' | 'audio' | 'text'>(() => {
        if (isCustom) {
            const ot = customDef?.outputType;
            if (ot === 'video' || ot === 'audio' || ot === 'text') return ot;
            return 'image';
        }
        if (actionType === 'audio-gen') return 'audio';
        if (actionType === 'text-gen') return 'text';
        return actionType === 'video-gen' ? 'video' : 'image';
    }, [isCustom, customDef, actionType]);

    // Loose gate for draft creation — a draft is just a placeholder slot, so
    // empty prompt / missing refs are fine; validation applies at run time.
    // Only hard blocker: a custom-action badge whose definition hasn't loaded.
    const disabledReason = useMemo(() => {
        if (isCustom && !customDef) return 'Custom action not loaded.';
        return null;
    }, [isCustom, customDef]);

    const canSpawn = disabledReason === null;

    /**
     * Build the `{type, data}` payload for a pending/draft node using the
     * action-badge's current state. Re-partitions refs every call — don't
     * memoize this across draft creation and later adoption.
     *
     * For `status: 'draft'`, prompt and refs are captured as-is (empty is
     * fine — the draft is just a placeholder slot). For `status: 'pending'`,
     * strict validation runs and throws on failure.
     */
    const buildShape = useCallback(
        (status: 'draft' | 'pending', labelOverride: string | undefined): { type: 'image' | 'video' | 'audio' | 'text'; data: Record<string, unknown> } => {
            // Partition refs into modality buckets the model accepts. For
            // custom actions (no selectedModel), the buckets aren't included
            // in the payload anyway, so default to empties.
            const refNodes = refNodeIds
                .map((nid) => getNodes().find((n) => n.id === nid))
                .filter((n): n is NonNullable<typeof n> => !!n);
            const {
                texts: inlineTextRefs,
                imageAssetIds: inlineImageAssetIds,
                videoAssetIds: inlineVideoAssetIds,
                audioAssetIds: inlineAudioAssetIds,
            } = selectedModel
                ? partitionRefs(refNodes, selectedModel)
                : { texts: [], imageAssetIds: [], videoAssetIds: [], audioAssetIds: [] };

            const rawPrompt = (content && content.trim() !== '' ? content : '') || dataPrompt || '';
            const prompt = composePromptWithTextRefs(rawPrompt, inlineTextRefs);

            if (status === 'pending' && (!prompt || prompt.trim() === '')) {
                throw new Error('No prompt provided. Please edit the node or connect a text/prompt node.');
            }

            const promptParts = parsePromptParts(prompt);
            const promptText = extractPromptText(promptParts);

            if (status === 'pending' && !isCustom && selectedModel) {
                const err = validateGenerationInput({
                    prompt: promptText,
                    referenceTextSnippets: inlineTextRefs,
                    referenceImageAssetIds: inlineImageAssetIds,
                    referenceVideoAssetIds: inlineVideoAssetIds,
                    referenceAudioAssetIds: inlineAudioAssetIds,
                    modelCard: selectedModel,
                });
                if (err) throw new Error(err);
            }

            if (isCustom && customDef) {
                const outputType = customDef.outputType || 'image';
                const type = (outputType === 'text' ? 'text' : outputType) as 'image' | 'video' | 'audio' | 'text';
                const generatedLabel = labelOverride ?? extractLabelFromPrompt(prompt, `${customDef.name} Result`);
                const data: Record<string, unknown> = {
                    label: generatedLabel,
                    status,
                    actionType,
                    customActionId: customDef.id,
                    customActionParams,
                    prompt,
                    outputType,
                };
                return { type, data };
            }

            // Pending media nodes intentionally omit `data.src`. Asset
            // identity lives on `referenceImage/Video/AudioAssetIds`; the
            // server resolves R2 keys via D1 lookup. Keeping a stale src
            // field used to be the trap that made partitionRefs / NodeProcessor
            // disagree about what the source of truth is.

            if (actionType === 'image-gen') {
                const generatedLabel = labelOverride ?? extractLabelFromPrompt(promptText, 'Generated Image');
                return {
                    type: 'image',
                    data: {
                        label: generatedLabel,
                        status,
                        prompt: promptText,
                        referenceImageAssetIds: inlineImageAssetIds,
                        aspectRatio: resolveAspectRatio(modelId, modelParams),
                        model: modelId,
                        modelId,
                        modelParams: { ...modelParams, count: 1 },
                    },
                };
            }

            if (actionType === 'video-gen') {
                const durationValue = modelParams.duration ?? 5;
                const durationNumber = typeof durationValue === 'string' ? parseInt(durationValue, 10) : Number(durationValue) || 5;
                const generatedLabel = labelOverride ?? extractLabelFromPrompt(promptText, 'Generated Video');
                return {
                    type: 'video',
                    data: {
                        label: generatedLabel,
                        status,
                        prompt: promptText,
                        referenceImageAssetIds: inlineImageAssetIds,
                        referenceVideoAssetIds: inlineVideoAssetIds,
                        referenceAudioAssetIds: inlineAudioAssetIds,
                        duration: durationNumber,
                        model: modelId,
                        modelId,
                        modelParams,
                        aspectRatio: resolveAspectRatio(modelId, modelParams),
                    },
                };
            }

            if (actionType === 'audio-gen') {
                const generatedLabel = labelOverride ?? extractLabelFromPrompt(promptText, 'Generated Audio');
                return {
                    type: 'audio',
                    data: {
                        label: generatedLabel,
                        status,
                        prompt: promptText,
                        model: modelId,
                        modelId,
                        modelParams,
                    },
                };
            }

            if (actionType === 'text-gen') {
                const generatedLabel = labelOverride ?? extractLabelFromPrompt(promptText, 'Generated Text');
                return {
                    type: 'text',
                    data: {
                        label: generatedLabel,
                        content: '',
                        status,
                        prompt: promptText,
                        referenceImageAssetIds: inlineImageAssetIds,
                        referenceVideoAssetIds: inlineVideoAssetIds,
                        referenceAudioAssetIds: inlineAudioAssetIds,
                        model: modelId,
                        modelId,
                        modelParams,
                    },
                };
            }

            throw new Error(`Unsupported actionType: ${actionType}`);
        },
        [
            actionType,
            isCustom,
            customDef,
            customActionParams,
            modelId,
            modelParams,
            selectedModel,
            content,
            dataPrompt,
            refNodeIds,
            getNodes,
        ],
    );

    const createAndWire = useCallback(
        async (status: 'draft' | 'pending', opts?: SpawnOpts): Promise<RFNode | null> => {
            const { type, data } = buildShape(status, opts?.labelOverride);
            const newId = opts?.assetId ?? (await generateSemanticId(projectId));

            // Offset from the action-badge's actual width + a consistent gap,
            // not the layout manager's fixed 300px default. Otherwise wide
            // downstream drafts (~500px) visually overlap the parent's right
            // edge when starting at parent.x+300, and the mesh collision-
            // resolver has to scatter them.
            const parent = getNodes().find((n) => n.id === actionBadgeId);
            const parentWidth = typeof parent?.width === 'number'
                ? parent.width
                : typeof parent?.style?.width === 'number'
                    ? parent.style.width
                    : 260;
            const offset = { x: parentWidth + 80, y: 0 };

            const newNode = addNodeWithAutoLayout({ id: newId, type, data }, actionBadgeId, offset);
            if (!newNode) return null;

            if (loroSync?.connected) {
                loroSync.addNode(newNode.id, newNode);
            }

            const edgeId = `${actionBadgeId}-${newId}`;
            addEdges({ id: edgeId, source: actionBadgeId, target: newId, type: 'default' });
            if (loroSync?.connected) {
                loroSync.addEdge(edgeId, { id: edgeId, source: actionBadgeId, target: newId, type: 'default' });
            }

            return newNode;
        },
        [actionBadgeId, buildShape, projectId, addNodeWithAutoLayout, addEdges, loroSync, getNodes],
    );

    const spawnPending = useCallback(
        (opts?: SpawnOpts) => createAndWire('pending', opts),
        [createAndWire],
    );

    const spawnDraft = useCallback(
        (opts?: SpawnOpts) => createAndWire('draft', opts),
        [createAndWire],
    );

    const adoptDraft = useCallback(
        async (draftId: string, opts?: AdoptOpts): Promise<RFNode | null> => {
            const { data: nextData } = buildShape('pending', opts?.labelOverride);
            const payload: Record<string, unknown> = { ...nextData };
            if (opts?.cascadeToken) {
                payload.cascadeToken = opts.cascadeToken;
            }

            let updated: RFNode | null = null;
            setNodes((nds) =>
                nds.map((n) => {
                    if (n.id !== draftId) return n;
                    const merged = { ...n, data: { ...n.data, ...payload } };
                    updated = merged;
                    return merged;
                }),
            );

            if (updated && loroSync?.connected) {
                loroSync.updateNode(draftId, { data: payload });
            }

            return updated;
        },
        [buildShape, setNodes, loroSync],
    );

    return { spawnPending, spawnDraft, adoptDraft, canSpawn, disabledReason, outputKind };
}
