import { memo, useState, useCallback, useRef } from 'react';
import { useReactFlow, type Node as RFNode } from '@xyflow/react';
import { Plus, Image as ImageIcon, VideoCamera, TextT, SpeakerHigh, Cube } from '@phosphor-icons/react';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { useProject } from '../ProjectContext';
import { useLayoutManager } from '@clash/web-ui/lib/layout';
import { generateSemanticId } from '@clash/web-ui/lib/utils/semanticId';
import { collectLayoutNodePatches, applyLayoutPatchesToLoro } from '@clash/web-ui/lib/loroNodeSync';
import { PIPELINE_MENU_OPTIONS, type PipelineMenuOption } from './pipelineMenuOptions';
import type { UseSpawnPendingAssetResult } from './useSpawnPendingAsset';
import {
    NodeHandleDropdownMenu,
    NodeHandleDropdownMenuHeader,
    NodeHandleDropdownMenuItem,
    NodeHandleDropdownMenuSeparator,
} from './NodeHandleDropdownMenu';

interface ActionBadgePipelineMenuProps {
    nodeId: string;
    spawnDraft: UseSpawnPendingAssetResult['spawnDraft'];
    canSpawn: boolean;
    disabledReason: string | null;
    outputKind: UseSpawnPendingAssetResult['outputKind'];
}

const OUTPUT_ICON = {
    image: ImageIcon,
    video: VideoCamera,
    audio: SpeakerHigh,
    text: TextT,
    model: Cube,
} as const;

/**
 * Right-handle flyout for action-badge nodes. Lazy-pipeline metaphor:
 *   • Primary row (A) spawns one draft output — the next stage, not yet running.
 *   • Secondary rows (B) spawn the draft AND wire it into a fresh downstream
 *     action, extending the pipe by a full stage in one click.
 *
 * Drafts are `status: 'idle'` — NodeProcessor ignores them. The user runs them
 * explicitly via the draft's own ▶ Run or ⏩ Run-chain buttons. Every click
 * here produces exactly one click's worth of nodes; the `xN` batch chip is a
 * Run concern and intentionally ignored.
 */
const ActionBadgePipelineMenu = ({ nodeId, spawnDraft, canSpawn, disabledReason, outputKind }: ActionBadgePipelineMenuProps) => {
    const [isBusy, setIsBusy] = useState(false);
    const busyRef = useRef(false);
    const { enabledModelCatalog, projectId } = useProject();
    const { addEdges } = useReactFlow();
    const loroSync = useOptionalLoroSyncContext();

    const onNodesMutated = useCallback(
        (prevNodes: RFNode[], nextNodes: RFNode[]) => {
            if (!loroSync) return;
            const patches = collectLayoutNodePatches(prevNodes, nextNodes);
            applyLayoutPatchesToLoro(loroSync, patches);
        },
        [loroSync],
    );
    const { addNodeWithAutoLayout } = useLayoutManager({ onNodesMutated });

    const runLocked = useCallback(async (fn: () => Promise<void>) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setIsBusy(true);
        try {
            await fn();
        } finally {
            busyRef.current = false;
            setIsBusy(false);
        }
    }, []);

    const handlePrimaryClick = useCallback(
        () => {
            if (!canSpawn) return;
            void runLocked(async () => {
                try {
                    await spawnDraft();
                } catch (err) {
                    console.error('Pipeline draft spawn failed:', err);
                }
            });
        },
        [canSpawn, spawnDraft, runLocked],
    );

    const handleChainClick = useCallback(
        (option: PipelineMenuOption) => {
            if (!canSpawn) return;
            void runLocked(async () => {
                try {
                    const draftNode = await spawnDraft();
                    if (!draftNode) return;

                    const nextId = await generateSemanticId(projectId);
                    // Offset from the draft's actual width + a consistent gap —
                    // drafts are wide (~500px), so the default 300 puts the
                    // next action inside the draft's bounding box. Use the
                    // width we just set at creation; RF's measured width isn't
                    // available yet (ResizeObserver hasn't fired).
                    const draftWidth = typeof draftNode.width === 'number'
                        ? draftNode.width
                        : typeof draftNode.style?.width === 'number'
                            ? draftNode.style.width
                            : 500;
                    // The draft we just spawned has the same modality as this
                    // action's output — pass it as sourceKind so the chained
                    // action picks a model that can actually consume it.
                    const sourceKind = outputKind;
                    const nextNode = addNodeWithAutoLayout(
                        { id: nextId, type: option.nodeType, data: option.getNodeData(sourceKind, enabledModelCatalog) },
                        draftNode.id,
                        { x: draftWidth + 80, y: 0 },
                    );
                    if (!nextNode) return;

                    if (loroSync) {
                        loroSync.addNode(nextId, nextNode);
                    }

                    const edgeId = `${draftNode.id}-${nextId}`;
                    addEdges({ id: edgeId, source: draftNode.id, target: nextId, type: 'default' });
                    if (loroSync) {
                        loroSync.addEdge(edgeId, {
                            id: edgeId,
                            source: draftNode.id,
                            target: nextId,
                            type: 'default',
                        });
                    }
                } catch (err) {
                    console.error('Pipeline chain spawn failed:', err);
                }
            });
        },
        [canSpawn, spawnDraft, projectId, outputKind, addNodeWithAutoLayout, addEdges, loroSync, runLocked, enabledModelCatalog],
    );

    const PrimaryIcon = OUTPUT_ICON[outputKind];
    const disabled = !canSpawn || isBusy;
    const primaryLabel = disabled ? (disabledReason ?? 'Busy…') : `Add draft ${outputKind}`;

    return (
        <NodeHandleDropdownMenu
            ariaLabel="Extend pipeline"
            triggerLabel="Open pipeline actions"
            contentClassName="min-w-[220px]"
            handleClassName="!border-white"
            ownerId={`${nodeId}:pipeline`}
        >
            <NodeHandleDropdownMenuHeader>Extend pipeline</NodeHandleDropdownMenuHeader>

            <NodeHandleDropdownMenuItem
                disabled={disabled}
                aria-label={primaryLabel}
                onSelect={handlePrimaryClick}
                className={`font-semibold ${
                    disabled
                        ? 'bg-warm-muted text-slate-700 dark:text-slate-300'
                        : 'clash-node-primary'
                }`}
            >
                <Plus className="h-4 w-4 shrink-0" weight="bold" aria-hidden="true" />
                <PrimaryIcon className="h-4 w-4 shrink-0" weight="regular" aria-hidden="true" />
                <span>Draft {outputKind}</span>
            </NodeHandleDropdownMenuItem>

            <NodeHandleDropdownMenuSeparator>then chain</NodeHandleDropdownMenuSeparator>

            {PIPELINE_MENU_OPTIONS
                .filter((opt) => opt.isCompatibleWithSource(outputKind === 'text' ? undefined : outputKind, enabledModelCatalog))
                .map((option) => {
                    const Icon = option.icon;
                    const rowDisabled = disabled;
                    const rowLabel = rowDisabled ? (disabledReason ?? 'Busy…') : `Draft -> ${option.label}`;
                    return (
                        <NodeHandleDropdownMenuItem
                            key={option.id}
                            disabled={rowDisabled}
                            aria-label={rowLabel}
                            onSelect={() => handleChainClick(option)}
                            className={rowDisabled ? 'text-slate-700 opacity-60 dark:text-slate-300' : 'text-slate-800 hover:bg-warm-muted hover:text-slate-900 dark:text-slate-200'}
                        >
                            <Plus className="h-3.5 w-3.5 shrink-0 text-slate-700 dark:text-slate-300" weight="bold" aria-hidden="true" />
                            <Icon className="h-4 w-4 shrink-0" weight="regular" aria-hidden="true" />
                            <span className="font-medium">Draft -&gt; {option.label}</span>
                        </NodeHandleDropdownMenuItem>
                    );
                })}
        </NodeHandleDropdownMenu>
    );
};

export default memo(ActionBadgePipelineMenu);
