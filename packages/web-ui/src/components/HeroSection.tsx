
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
    useTransition,
    type ForwardedRef,
} from 'react';
import { motion } from 'framer-motion';
import {
    createProject,
    persistRuntimeRunPreferences,
} from '@clash/web-ui/lib/clientActions';
import { useClashRuntime } from '@clash/web-ui/hooks/useClashRuntime';
import {
    applyRecentConfigPreferences,
    applyRecentModePreference,
    configValuesFromOptions,
    preferredRecentAgentId,
} from '@clash/web-ui/lib/recentRunPreferences';
import { ChatInput, type ChatInputHandle } from './copilot/ChatInput';
import {
    HarnessPermissionSelector,
    InlineSessionConfigControls,
    SessionConfigSelector,
    SessionPlanTag,
    findAcpSelectConfigOption,
    permissionModeOption,
    resolvePermissionModeForSession,
} from './ChatbotCopilot';

export interface HeroSectionHandle {
    focus: () => void;
}

function HeroSectionInner(_props: object, ref: ForwardedRef<HeroSectionHandle>) {
    const [inputValue, setInputValue] = useState('');
    const [isPending, startTransition] = useTransition();
    const [sessionConfigOpen, setSessionConfigOpen] = useState(false);
    const chatInputRef = useRef<ChatInputHandle>(null);
    const clashRt = useClashRuntime();
    const localRuntime = useMemo(
        () => clashRt.runtimes.find((runtime) => runtime.id === 'desktop-local') ?? null,
        [clashRt.runtimes],
    );
    const selectedHarnessId = clashRt.selectedAgentId
        ?? preferredRecentAgentId(
            localRuntime?.agents ?? [],
            localRuntime?.preferences?.agent_id,
        )
        ?? null;
    const selectedHarness = useMemo(
        () => localRuntime?.agents.find((agent) => agent.id === selectedHarnessId) ?? null,
        [localRuntime, selectedHarnessId],
    );
    const configOptions = useMemo(() => {
        if (
            clashRt.selectedAgentId === selectedHarnessId
            && clashRt.sessionConfigOptions.length > 0
        ) {
            return clashRt.sessionConfigOptions;
        }
        return applyRecentConfigPreferences(
            selectedHarness?.config_options,
            selectedHarnessId
                ? localRuntime?.preferences?.config_by_agent[selectedHarnessId]
                : undefined,
        );
    }, [
        clashRt.selectedAgentId,
        clashRt.sessionConfigOptions,
        localRuntime?.preferences?.config_by_agent,
        selectedHarness?.config_options,
        selectedHarnessId,
    ]);
    const modelConfigOption = useMemo(
        () => findAcpSelectConfigOption(configOptions, 'model'),
        [configOptions],
    );
    const modeConfigOption = useMemo(
        () => findAcpSelectConfigOption(configOptions, 'mode'),
        [configOptions],
    );
    const sessionModes = useMemo(() => {
        if (clashRt.selectedAgentId === selectedHarnessId && clashRt.sessionModes) {
            return clashRt.sessionModes;
        }
        return applyRecentModePreference(
            selectedHarness?.session_modes,
            selectedHarnessId
                ? localRuntime?.preferences?.mode_by_agent[selectedHarnessId]
                : undefined,
        );
    }, [
        clashRt.selectedAgentId,
        clashRt.sessionModes,
        localRuntime?.preferences?.mode_by_agent,
        selectedHarness?.session_modes,
        selectedHarnessId,
    ]);
    const selectedPermissionModeId = useMemo(
        () => resolvePermissionModeForSession(
            selectedHarnessId
                ? localRuntime?.preferences?.mode_by_agent[selectedHarnessId]
                : undefined,
            sessionModes,
            modeConfigOption,
        ),
        [
            localRuntime?.preferences?.mode_by_agent,
            modeConfigOption,
            selectedHarnessId,
            sessionModes,
        ],
    );
    const runtimeReady = (
        clashRt.startupStatus === 'ready'
        && localRuntime?.status === 'online'
        && localRuntime.agents.length > 0
    );

    useImperativeHandle(ref, () => ({
        focus() {
            chatInputRef.current?.focus();
        },
    }), []);

    useEffect(() => {
        if (!runtimeReady || !localRuntime || !selectedHarnessId) return;
        if (
            clashRt.selectedRuntimeId === localRuntime.id
            && clashRt.selectedAgentId === selectedHarnessId
            && clashRt.status === 'draft'
        ) {
            return;
        }
        clashRt.startDraft(localRuntime.id, undefined, {
            agentId: selectedHarnessId,
            ...permissionModeOption(selectedPermissionModeId),
        });
    }, [
        clashRt.selectedAgentId,
        clashRt.selectedRuntimeId,
        clashRt.startDraft,
        clashRt.status,
        localRuntime,
        runtimeReady,
        selectedHarnessId,
        selectedPermissionModeId,
    ]);

    const handleSelectHarness = useCallback((agentId: string) => {
        if (!localRuntime) return;
        const agent = localRuntime.agents.find((candidate) => candidate.id === agentId);
        const nextConfigOptions = applyRecentConfigPreferences(
            agent?.config_options,
            localRuntime.preferences?.config_by_agent[agentId],
        );
        const nextModeConfigOption = findAcpSelectConfigOption(
            nextConfigOptions,
            'mode',
        );
        const nextMode = resolvePermissionModeForSession(
            localRuntime.preferences?.mode_by_agent[agentId],
            applyRecentModePreference(
                agent?.session_modes,
                localRuntime.preferences?.mode_by_agent[agentId],
            ),
            nextModeConfigOption,
        );
        clashRt.startDraft(localRuntime.id, undefined, {
            agentId,
            ...permissionModeOption(nextMode),
        });
        void persistRuntimeRunPreferences(localRuntime.id, {
            agentId,
            configValues: configValuesFromOptions(nextConfigOptions),
            ...(nextMode ? { modeId: nextMode } : {}),
        }).catch(() => undefined);
    }, [clashRt.startDraft, localRuntime]);

    const ensureDraft = useCallback(() => {
        if (!localRuntime || !selectedHarnessId) return false;
        if (
            clashRt.selectedRuntimeId !== localRuntime.id
            || clashRt.selectedAgentId !== selectedHarnessId
            || clashRt.status !== 'draft'
        ) {
            clashRt.startDraft(localRuntime.id, undefined, {
                agentId: selectedHarnessId,
                ...permissionModeOption(selectedPermissionModeId),
            });
        }
        return true;
    }, [
        clashRt.selectedAgentId,
        clashRt.selectedRuntimeId,
        clashRt.startDraft,
        clashRt.status,
        localRuntime,
        selectedHarnessId,
        selectedPermissionModeId,
    ]);

    const handleSelectConfigOption = useCallback((configId: string, value: string | boolean) => {
        if (!ensureDraft()) return;
        clashRt.setConfigOption(configId, value);
        if (!localRuntime || !selectedHarnessId) return;
        const nextConfigOptions = configOptions.map((option) => (
            option.id === configId ? { ...option, currentValue: value } : option
        ));
        void persistRuntimeRunPreferences(localRuntime.id, {
            agentId: selectedHarnessId,
            configValues: configValuesFromOptions(nextConfigOptions),
            ...(selectedPermissionModeId ? { modeId: selectedPermissionModeId } : {}),
        }).catch(() => undefined);
    }, [
        clashRt.setConfigOption,
        configOptions,
        ensureDraft,
        localRuntime,
        selectedHarnessId,
        selectedPermissionModeId,
    ]);

    const handleSelectPermissionMode = useCallback((modeId: string) => {
        if (!ensureDraft()) return;
        if (modeConfigOption) {
            clashRt.setConfigOption(modeConfigOption.id, modeId);
        } else {
            clashRt.setSessionMode(modeId);
        }
        if (!localRuntime || !selectedHarnessId) return;
        const nextConfigOptions = modeConfigOption
            ? configOptions.map((option) => (
                option.id === modeConfigOption.id
                    ? { ...option, currentValue: modeId }
                    : option
            ))
            : configOptions;
        void persistRuntimeRunPreferences(localRuntime.id, {
            agentId: selectedHarnessId,
            configValues: configValuesFromOptions(nextConfigOptions),
            modeId,
        }).catch(() => undefined);
    }, [
        clashRt.setConfigOption,
        clashRt.setSessionMode,
        configOptions,
        ensureDraft,
        localRuntime,
        modeConfigOption,
        selectedHarnessId,
    ]);

    const handleSessionConfigOpenChange = useCallback((open: boolean) => {
        setSessionConfigOpen(open);
        if (open) {
            void clashRt.refresh({ probe: 'config', refresh: true }).catch(() => {
                setSessionConfigOpen(false);
            });
        }
    }, [clashRt.refresh]);

    const handleSend = (text: string) => {
        if (text.trim()) {
            startTransition(async () => {
                if (localRuntime && selectedHarnessId) {
                    await persistRuntimeRunPreferences(localRuntime.id, {
                        agentId: selectedHarnessId,
                        configValues: configValuesFromOptions(configOptions),
                        ...(selectedPermissionModeId ? { modeId: selectedPermissionModeId } : {}),
                    });
                }
                await createProject(text);
            });
        }
    };

    return (
        <section className="clash-home-hero flex w-full items-center px-5 pb-8 pt-8 sm:px-8 lg:px-10">
            <div className="clash-hero-stage mx-auto w-full max-w-[1440px]">
                <div className="clash-home-hero-copy w-full max-w-[1120px]">
                    <motion.h1
                        className="clash-home-hero-heading mb-8 text-left font-display font-bold tracking-tighter text-slate-950 dark:text-slate-50"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                    >
                        Hey! <br />
                        Let&apos;s make some <span className="text-brand">CLASH</span>?
                    </motion.h1>
                </div>

                <div className="clash-hero-prompt">
                    <ChatInput
                        ref={chatInputRef}
                        input={inputValue}
                        onInputChange={setInputValue}
                        onSubmit={(text) => handleSend(text)}
                        isProcessing={isPending}
                        isCreatingSession={isPending}
                        placeholder="Describe your video idea..."
                        variant="hero"
                        disabled={!runtimeReady}
                        toolbarAccessory={(
                            <div className="clash-composer-session-controls flex min-w-0 items-center gap-1">
                                <HarnessPermissionSelector
                                    agentId={selectedHarnessId}
                                    selectedPermissionModeId={selectedPermissionModeId}
                                    sessionModes={sessionModes}
                                    modeConfigOption={modeConfigOption}
                                    onSelectPermissionMode={handleSelectPermissionMode}
                                />
                                <SessionPlanTag
                                    configOptions={configOptions}
                                    onSelectConfigOption={handleSelectConfigOption}
                                />
                                <InlineSessionConfigControls
                                    configOptions={configOptions}
                                    onSelectConfigOption={handleSelectConfigOption}
                                />
                            </div>
                        )}
                        rightToolbarAccessory={(
                            <SessionConfigSelector
                                open={sessionConfigOpen}
                                onOpenChange={handleSessionConfigOpenChange}
                                embedded
                                selectedHarnessId={selectedHarnessId}
                                statusLabel={null}
                                harnessOptions={localRuntime?.agents ?? []}
                                configOptions={configOptions}
                                modelConfigOption={modelConfigOption}
                                onSelectHarness={handleSelectHarness}
                                onSelectConfigOption={handleSelectConfigOption}
                            />
                        )}
                    />
                </div>
            </div>
        </section>
    );
}

const HeroSection = forwardRef<HeroSectionHandle, object>(HeroSectionInner);
HeroSection.displayName = 'HeroSection';

export default HeroSection;
