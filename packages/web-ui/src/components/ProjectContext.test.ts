import { describe, expect, it } from 'vitest';
import { MODEL_CARDS, type ModelCard, type ModelCatalogEntry, type ProviderAccountAvailability } from '@clash/shared-types';
import { enabledModelCatalogEntries } from './ProjectContext';

describe('enabledModelCatalogEntries', () => {
    it('uses canvas model enablement rather than catalog readiness tiers', () => {
        const template = MODEL_CARDS.find((model) => model.kind === 'video')!;
        const model = (id: string): ModelCard => ({
            ...template,
            id,
            name: id,
            providerImplementations: [{
                providerId: 'fal',
                upstreamId: 'fal',
                upstreamModel: `test/${id}`,
                apiShape: 'fal',
            }],
        });
        const entry = (card: ModelCard, tier: ModelCatalogEntry['tier'], selectedRoute: unknown) => ({
            model: card,
            tier,
            selectedRoute,
        }) as ModelCatalogEntry;
        const providers: ProviderAccountAvailability[] = [{
            providerId: 'fal',
            upstreamId: 'fal',
            enabled: true,
            supportedModelIds: ['enabled-canvas-model'],
        }];

        const enabled = enabledModelCatalogEntries([
            entry(model('enabled-canvas-model'), 'configured-provider', null),
            entry(model('disabled-canvas-model'), 'available', { providerId: 'configured' }),
        ], providers);

        expect(enabled.map((candidate) => candidate.model.id)).toEqual(['enabled-canvas-model']);
    });
});
