import { Image as ImageIcon, VideoCamera, FilmSlate, SpeakerHigh, TextT, PencilSimple, FilmStrip } from '@phosphor-icons/react';
import {
    listCompatibleModelCatalogEntries,
    pickDefaultModel,
    type ModelCatalogEntry,
    type Modality,
} from '@clash/shared-types';

export interface PipelineMenuOption {
    id: string;
    label: string;
    icon: typeof ImageIcon;
    nodeType: string;
    /**
     * Spawn payload for the new node. Source-aware so the chosen default
     * model can actually consume the upstream node's modality. For modality-agnostic
     * options (video-editor, plain text), `sourceKind` is ignored.
     */
    getNodeData: (sourceKind: Modality | undefined, catalog: ReadonlyArray<ModelCatalogEntry>) => Record<string, unknown>;
    /**
     * Whether the option is sensible for a given source modality. Derived
     * from the model registry — an option is shown only if some model of
     * the right output kind can consume `sourceKind`. Modality-agnostic
     * options (video-editor) accept anything.
     */
    isCompatibleWithSource: (sourceKind: Modality | undefined, catalog: ReadonlyArray<ModelCatalogEntry>) => boolean;
}

/** Build the spawn payload for a generation action-badge. */
function buildGenNodeData(
    actionType: 'image-gen' | 'video-gen' | 'audio-gen' | 'text-gen',
    outputKind: 'image' | 'video' | 'audio' | 'text',
    sourceKind?: Modality,
    catalog: ReadonlyArray<ModelCatalogEntry> = [],
): Record<string, unknown> {
    // `pickDefaultModel` owns the per-kind default, not catalog array order.
    // Taking `[0]` of the compatible list made the default depend on where a
    // card happens to sit in the catalog: adding a music model above the TTS
    // models silently turned "Audio Prompt" into music generation.
    const card = pickDefaultModel({
        outputKind,
        ...(sourceKind ? { sourceKind } : {}),
        cards: catalog.map((entry) => entry.model),
    });
    const modelId = card?.id ?? '';
    const labelByAction = {
        'image-gen': 'Image Prompt',
        'video-gen': 'Video Prompt',
        'audio-gen': 'Audio Prompt',
        'text-gen': 'Text Prompt',
    } as const;
    return {
        label: labelByAction[actionType],
        actionType,
        modelId,
        model: modelId,
        modelParams: { ...(card?.defaultParams ?? {}) },
        content: '# Prompt\nEnter your prompt here...',
    };
}

function hasCompatibleGenerationModel(
    outputKind: 'image' | 'video' | 'audio' | 'text',
    sourceKind?: Modality,
    catalog: ReadonlyArray<ModelCatalogEntry> = [],
): boolean {
    return listCompatibleModelCatalogEntries({
        outputKind,
        sourceKind,
        models: catalog.map((entry) => entry.model),
    }).length > 0;
}

/**
 * Downstream-action options shared by SourceHandleMenu (on data nodes) and
 * ActionBadgePipelineMenu (on action-badge output handle).
 */
export const PIPELINE_MENU_OPTIONS: PipelineMenuOption[] = [
    {
        id: 'image-gen',
        label: 'Image Gen',
        icon: ImageIcon,
        nodeType: 'action-badge',
        getNodeData: (sourceKind, catalog) => buildGenNodeData('image-gen', 'image', sourceKind, catalog),
        // Visible only when some image-output model can consume the source.
        // Without a source (manual placement), always visible.
        isCompatibleWithSource: (sourceKind, catalog) => hasCompatibleGenerationModel('image', sourceKind, catalog),
    },
    {
        id: 'video-gen',
        label: 'Video Gen',
        icon: VideoCamera,
        nodeType: 'action-badge',
        getNodeData: (sourceKind, catalog) => buildGenNodeData('video-gen', 'video', sourceKind, catalog),
        isCompatibleWithSource: (sourceKind, catalog) => hasCompatibleGenerationModel('video', sourceKind, catalog),
    },
    {
        id: 'audio-gen',
        label: 'Audio Gen',
        icon: SpeakerHigh,
        nodeType: 'action-badge',
        getNodeData: (sourceKind, catalog) => buildGenNodeData('audio-gen', 'audio', sourceKind, catalog),
        isCompatibleWithSource: (sourceKind, catalog) => hasCompatibleGenerationModel('audio', sourceKind, catalog),
    },
    {
        id: 'text-gen',
        label: 'Text Gen',
        icon: TextT,
        nodeType: 'action-badge',
        getNodeData: (sourceKind, catalog) => buildGenNodeData('text-gen', 'text', sourceKind, catalog),
        isCompatibleWithSource: (sourceKind, catalog) => hasCompatibleGenerationModel('text', sourceKind, catalog),
    },
    {
        id: 'video-editor',
        label: 'Video Editor',
        icon: FilmSlate,
        nodeType: 'video-editor',
        getNodeData: () => ({ label: 'Video Editor', inputs: [] }),
        isCompatibleWithSource: () => true,
    },
    {
        id: 'image-editor',
        label: 'Image Editor',
        icon: PencilSimple,
        nodeType: 'image-editor',
        // Copy-on-write image editor (crop / rotate). Editor reads upstream
        // image's signed URL, renders via canvas, uploads as a new asset.
        getNodeData: () => ({ label: 'Image Editor' }),
        // Only meaningful with an image upstream — generation/audio/video/text
        // sources can't be CoW'd by the image editor.
        isCompatibleWithSource: (sourceKind) => sourceKind === 'image',
    },
    {
        id: 'video-clipper',
        label: 'Video Clipper',
        icon: FilmStrip,
        nodeType: 'video-clipper',
        getNodeData: () => ({ label: 'Video Clipper' }),
        isCompatibleWithSource: (sourceKind) => sourceKind === 'video',
    },
];
