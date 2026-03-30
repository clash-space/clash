import { listApiTokens } from './actions';
import SettingsClient from './SettingsClient';

export const runtime = 'edge';

export default async function SettingsPage() {
    const tokens = await listApiTokens();

    return <SettingsClient initialTokens={tokens} />;
}
