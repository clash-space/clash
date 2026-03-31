import { listApiTokens, listVariables } from './actions';
import SettingsClient from './SettingsClient';

export const runtime = 'edge';

export default async function SettingsPage() {
    const [tokens, variables] = await Promise.all([
        listApiTokens(),
        listVariables(),
    ]);

    return <SettingsClient initialTokens={tokens} initialVariables={variables} />;
}
