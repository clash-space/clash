import { describe, expect, it } from 'vitest';
import type {
    AcpSessionConfigOption,
    AcpSessionModeState,
    RuntimeAgent,
} from '../hooks/useClashRuntime';
import {
    applyRecentConfigPreferences,
    applyRecentModePreference,
    configValuesFromOptions,
    preferredRecentAgentId,
} from './recentRunPreferences';

const agents: RuntimeAgent[] = [
    { id: 'claude-acp' },
    { id: 'codex-acp' },
];

const options: AcpSessionConfigOption[] = [
    {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'gpt-5.6-sol',
        options: [
            { value: 'gpt-5.6-sol', name: 'GPT-5.6-Sol' },
            { value: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' },
        ],
    },
    {
        id: 'effort',
        name: 'Effort',
        category: 'thought_level',
        type: 'select',
        currentValue: 'medium',
        options: [
            { value: 'medium', name: 'Medium' },
            { value: 'high', name: 'High' },
        ],
    },
    {
        id: 'fast-mode',
        name: 'Fast mode',
        type: 'boolean',
        currentValue: false,
    },
];

describe('recent ACP run preferences', () => {
    it('uses the recent agent only while it is still enabled and advertised', () => {
        expect(preferredRecentAgentId(agents, 'codex-acp')).toBe('codex-acp');
        expect(preferredRecentAgentId(agents, 'removed-acp')).toBe('claude-acp');
        expect(preferredRecentAgentId([], 'codex-acp')).toBeUndefined();
    });

    it('restores only values still accepted by the latest ACP schema', () => {
        expect(applyRecentConfigPreferences(options, {
            model: 'gpt-5.6-terra',
            effort: 'removed',
            'fast-mode': true,
            stale: 'ignored',
        })).toEqual([
            expect.objectContaining({ id: 'model', currentValue: 'gpt-5.6-terra' }),
            expect.objectContaining({ id: 'effort', currentValue: 'medium' }),
            expect.objectContaining({ id: 'fast-mode', currentValue: true }),
        ]);
    });

    it('keeps the ACP current mode when the recent mode no longer exists', () => {
        const modes: AcpSessionModeState = {
            currentModeId: 'default',
            availableModes: [
                { id: 'default', name: 'Default' },
                { id: 'plan', name: 'Plan' },
            ],
        };
        expect(applyRecentModePreference(modes, 'plan')).toEqual({
            ...modes,
            currentModeId: 'plan',
        });
        expect(applyRecentModePreference(modes, 'removed')).toEqual(modes);
    });

    it('records the full effective configuration used for a run', () => {
        expect(configValuesFromOptions(options)).toEqual({
            model: 'gpt-5.6-sol',
            effort: 'medium',
            'fast-mode': false,
        });
    });
});
