import { fetchRegistry, getInstalledIds } from './actions';
import MarketplaceClient from './MarketplaceClient';

export const runtime = 'edge';

export default async function MarketplacePage() {
    const [registry, installed] = await Promise.all([
        fetchRegistry(),
        getInstalledIds(),
    ]);

    // Merge actions and skills into a single list with type tags
    const items = [
        ...registry.actions.map((a) => ({ ...a, type: 'action' as const })),
        ...registry.skills.map((s) => ({ ...s, type: 'skill' as const })),
    ];

    return (
        <MarketplaceClient
            items={items}
            installedActionIds={Array.from(installed.actionIds)}
            installedSkillIds={Array.from(installed.skillIds)}
        />
    );
}
