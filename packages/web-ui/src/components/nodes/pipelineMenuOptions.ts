import { Image as ImageIcon, VideoCamera, FilmSlate, SpeakerHigh, TextT, PencilSimple, FilmStrip } from '@phosphor-icons/react';
import {
    capability,
    pickDefaultModel,
    type Modality,
} from '@clash/shared-types';

export interface PipelineMenuOption {
    id: string;
    label: string;
    icon: typeof ImageIcon;
    nodeType: string;
    /**
     * Spawn payload for the new node. Source-aware so the chosen default
     * model can actually consume the upstream node's modality (e.g. video
     * source → seedance-ref instead of sora-2). For modality-agnostic
     * options (video-editor, plain text), `sourceKind` is ignored.
     */
    getNodeData: (sourceKind?: Modality) => Record<string, unknown>;
    /**
     * Whether the option is sensible for a given source modality. Derived
     * from the model registry — an option is shown only if some model of
     * the right output kind can consume `sourceKind`. Modality-agnostic
     * options (video-editor) accept anything.
     */
    isCompatibleWithSource: (sourceKind?: Modality) => boolean;
}

/** Build the spawn payload for a generation action-badge. */
function buildGenNodeData(
    actionType: 'image-gen' | 'video-gen' | 'audio-gen' | 'text-gen',
    outputKind: 'image' | 'video' | 'audio' | 'text',
    sourceKind?: Modality,
): Record<string, unknown> {
    const card = pickDefaultModel({ outputKind, sourceKind });
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
        getNodeData: (sourceKind) => buildGenNodeData('image-gen', 'image', sourceKind),
        // Visible only when some image-output model can consume the source.
        // Without a source (manual placement), always visible.
        isCompatibleWithSource: (sourceKind) => {
            if (!sourceKind) return true;
            const card = pickDefaultModel({ outputKind: 'image', sourceKind });
            return !!card && capability(card).ref[sourceKind].accepts;
        },
    },
    {
        id: 'video-gen',
        label: 'Video Gen',
        icon: VideoCamera,
        nodeType: 'action-badge',
        getNodeData: (sourceKind) => buildGenNodeData('video-gen', 'video', sourceKind),
        isCompatibleWithSource: (sourceKind) => {
            if (!sourceKind) return true;
            const card = pickDefaultModel({ outputKind: 'video', sourceKind });
            return !!card && capability(card).ref[sourceKind].accepts;
        },
    },
    {
        id: 'audio-gen',
        label: 'Audio Gen',
        icon: SpeakerHigh,
        nodeType: 'action-badge',
        getNodeData: (sourceKind) => buildGenNodeData('audio-gen', 'audio', sourceKind),
        // TTS is prompt-first today; keep this available as a downstream
        // lineage step even when the upstream media is not consumed as a ref.
        isCompatibleWithSource: () => true,
    },
    {
        id: 'text-gen',
        label: 'Text Gen',
        icon: TextT,
        nodeType: 'action-badge',
        getNodeData: (sourceKind) => buildGenNodeData('text-gen', 'text', sourceKind),
        isCompatibleWithSource: () => true,
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
