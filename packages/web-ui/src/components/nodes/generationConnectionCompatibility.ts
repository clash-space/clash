import { MODEL_CARDS, capability, type Modality } from '@clash/shared-types';

function isReferenceModality(value: string | undefined): value is Modality {
    return value === 'text' || value === 'image' || value === 'video' || value === 'audio';
}

export function generationConnectionAcceptsSource(_options: {
    sourceType: string | undefined;
    targetData: Record<string, unknown>;
}): boolean {
    const { sourceType, targetData } = _options;
    const rawModelId = targetData.modelId ?? targetData.model;
    if (typeof rawModelId !== 'string') return true;

    const card = MODEL_CARDS.find((candidate) => candidate.id === rawModelId);
    if (!card) return true;
    const modelCapability = capability(card);
    if (sourceType === 'director-stage') {
        return modelCapability.ref.video.accepts || modelCapability.ref.image.accepts;
    }

    if (!isReferenceModality(sourceType)) return true;
    return modelCapability.ref[sourceType].accepts;
}
