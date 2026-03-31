'use server';

import {
    installAction as settingsInstallAction,
    uninstallAction as settingsUninstallAction,
    listInstalledActions,
    installSkill as settingsInstallSkill,
    uninstallSkill as settingsUninstallSkill,
    listInstalledSkills,
} from '../settings/actions';

const REGISTRY_URL = 'https://raw.githubusercontent.com/clash-community/awesome-actions/main/registry.json';

export interface RegistryItem {
    id: string;
    name: string;
    type: 'action' | 'skill';
    description?: string;
    repository?: string;
    runtime?: string;
    outputType?: string;
    workerUrl?: string;
    version?: string;
    author?: string;
    icon?: string;
    color?: string;
    tags?: string[];
    secrets?: Array<{ id: string; label: string; required?: boolean }>;
    linkedActionId?: string;
}

export interface RegistryData {
    version: number;
    actions: RegistryItem[];
    skills: RegistryItem[];
}

/**
 * Fetch the community registry from GitHub.
 * Falls back to empty if network fails.
 */
export async function fetchRegistry(): Promise<RegistryData> {
    try {
        const resp = await fetch(REGISTRY_URL, { next: { revalidate: 300 } });
        if (!resp.ok) return { version: 1, actions: [], skills: [] };
        return await resp.json() as RegistryData;
    } catch {
        return { version: 1, actions: [], skills: [] };
    }
}

/**
 * Get IDs of all installed actions and skills for the current user.
 */
export async function getInstalledIds(): Promise<{ actionIds: Set<string>; skillIds: Set<string> }> {
    const [actions, skills] = await Promise.all([listInstalledActions(), listInstalledSkills()]);
    return {
        actionIds: new Set(actions.map((a) => a.actionId)),
        skillIds: new Set(skills.map((s) => s.skillId)),
    };
}

export async function marketplaceInstallAction(item: RegistryItem): Promise<void> {
    await settingsInstallAction({
        id: item.id,
        name: item.name,
        description: item.description,
        runtime: item.runtime || 'worker',
        outputType: item.outputType || 'image',
        workerUrl: item.workerUrl,
        version: item.version,
        author: item.author,
        repository: item.repository,
        icon: item.icon,
        color: item.color,
        tags: item.tags,
        secrets: item.secrets,
        parameters: [],
    });
}

export async function marketplaceUninstallAction(actionId: string): Promise<void> {
    await settingsUninstallAction(actionId);
}

export async function marketplaceInstallSkill(item: RegistryItem): Promise<void> {
    await settingsInstallSkill({
        id: item.id,
        name: item.name,
        description: item.description,
        repository: item.repository,
        version: item.version,
        author: item.author,
        icon: item.icon,
        tags: item.tags,
        linkedActionId: item.linkedActionId,
    });
}

export async function marketplaceUninstallSkill(skillId: string): Promise<void> {
    await settingsUninstallSkill(skillId);
}
