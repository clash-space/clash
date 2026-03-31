import { listApiTokens, listVariables, listInstalledActions, listInstalledSkills } from './actions';
import SettingsClient from './SettingsClient';

export const runtime = 'edge';

export default async function SettingsPage() {
    const [tokens, variables, actions, skills] = await Promise.all([
        listApiTokens(),
        listVariables(),
        listInstalledActions(),
        listInstalledSkills(),
    ]);

    return (
        <SettingsClient
            initialTokens={tokens}
            initialVariables={variables}
            initialActions={actions}
            initialSkills={skills}
        />
    );
}
