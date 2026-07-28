import type {
    AcpSessionConfigOption,
    AcpSessionModeState,
    RuntimeAgent,
} from '../hooks/useClashRuntime';

export type RunConfigValue = string | boolean;

function selectValues(option: AcpSessionConfigOption): string[] {
    if (option.type !== 'select' || !Array.isArray(option.options)) return [];
    return option.options.flatMap((entry) => {
        if ('options' in entry && Array.isArray(entry.options)) {
            return entry.options.map((value) => value.value);
        }
        return 'value' in entry && typeof entry.value === 'string'
            ? [entry.value]
            : [];
    });
}

export function preferredRecentAgentId(
    agents: readonly RuntimeAgent[],
    recentAgentId: string | null | undefined,
): string | undefined {
    if (
        recentAgentId
        && agents.some((agent) => agent.id === recentAgentId)
    ) {
        return recentAgentId;
    }
    return agents[0]?.id;
}

export function applyRecentConfigPreferences(
    options: readonly AcpSessionConfigOption[] | undefined,
    recent: Record<string, RunConfigValue> | undefined,
): AcpSessionConfigOption[] {
    return (options ?? []).map((option) => {
        const value = recent?.[option.id];
        if (option.type === 'boolean' && typeof value === 'boolean') {
            return { ...option, currentValue: value };
        }
        if (
            option.type === 'select'
            && typeof value === 'string'
            && selectValues(option).includes(value)
        ) {
            return { ...option, currentValue: value };
        }
        return option;
    });
}

export function applyRecentModePreference(
    modes: AcpSessionModeState | null | undefined,
    recentModeId: string | null | undefined,
): AcpSessionModeState | null {
    if (!modes) return null;
    if (
        recentModeId
        && modes.availableModes.some((mode) => mode.id === recentModeId)
    ) {
        return { ...modes, currentModeId: recentModeId };
    }
    return modes;
}

export function configValuesFromOptions(
    options: readonly AcpSessionConfigOption[] | undefined,
): Record<string, RunConfigValue> {
    return Object.fromEntries(
        (options ?? []).flatMap((option): Array<[string, RunConfigValue]> => (
            typeof option.currentValue === 'string'
            || typeof option.currentValue === 'boolean'
                ? [[option.id, option.currentValue]]
                : []
        )),
    );
}
