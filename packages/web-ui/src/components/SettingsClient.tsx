
import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
    Combobox,
    ComboboxItem,
    ComboboxList,
    ComboboxProvider,
} from '@ariakit/react';
import {
    closestCenter,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Plus, Trash, Copy, Check, ArrowLeft, ArrowUp, ArrowDown, Lock, Eye, EyeSlash, PuzzlePiece, BookOpen, Terminal, Plug, CloudArrowUp, MagnifyingGlass, CaretDown, CaretRight, Microphone, X, ImageSquare, VideoCamera, SpeakerHigh, TextT } from '@phosphor-icons/react';
import { useClashRuntime } from '@clash/web-ui/hooks/useClashRuntime';
import { Link, useSearchParams } from 'react-router';
import { ACTION_PROVIDER_PRESETS, CustomActionDefinitionSchema, listModelCatalogEntries, listProviderModelSupport, normalizeActionProviderId, type ProviderOAuthId } from '@clash/shared-types';
import {
    createApiToken, revokeApiToken, type ApiTokenInfo,
    setVariable, deleteVariable, type VariableInfo,
    uninstallAction, type InstalledActionInfo,
    uninstallSkill, type InstalledSkillInfo,
    updateModelProviders, deleteModelProvider, listModelProviders, listModelCatalog, listProviderOAuth, startProviderOAuth, completeProviderOAuth, testModelProvider,
    type ModelProviderAccountInfo, type ModelCatalogEntryInfo, type ProviderOAuthInfo, type ModelProviderTestResult,
} from '@clash/web-ui/lib/clientActions';
import { runtimeApiUrl } from '@clash/web-ui/lib/runtimeConfig';
import { cn } from './ai-elements/utils';
import { Dialog } from './ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { SelectMenu, type SelectOption } from './ui/select';
import { SearchableSelect } from './ui/searchable-select';
import { Switch } from './ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { useAppFeedback } from './AppFeedback';

/** Stable identifiers for each section pane — shared between the legacy
 *  SettingsSurface. The host uses these as its sidebar nav keys. */
export type SettingsSection =
    | 'agents'
    | 'sync'
    | 'audio'
    | 'tokens'
    | 'providers'
    | 'variables'
    | 'models'
    | 'actions'
    | 'skills'
    | 'cli';

interface Props {
    initialTokens: ApiTokenInfo[];
    initialVariables: VariableInfo[];
    initialActions: InstalledActionInfo[];
    initialSkills: InstalledSkillInfo[];
    initialModelProviders?: ModelProviderAccountInfo[];
    initialModelCatalog?: ModelCatalogEntryInfo[];
    /** When provided, only that section's body renders — used by
     *  SettingsSurface's content pane. */
    activeSection?: SettingsSection;
    /** When true, the sticky header / page chrome is suppressed and
     *  the layout is meant to live inside a modal panel. */
    embedded?: boolean;
}

const settingsPrimaryButtonClass =
    'clash-settings-primary inline-flex items-center justify-center rounded-xl px-5 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40';
const settingsSmallPrimaryButtonClass =
    'clash-settings-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-medium';
const settingsDangerGhostButtonClass =
    'clash-settings-danger-ghost opacity-0 group-hover:opacity-100 rounded-lg p-1.5';
const settingsCodeBlockClass =
    'clash-settings-code block overflow-x-auto whitespace-nowrap rounded-xl px-4 py-3 font-mono text-sm';
const settingsErrorAlertClass =
    'clash-settings-alert-error rounded-xl px-3 py-2 text-sm';
const settingsSkeletonLineClass =
    'rounded-full bg-warm-muted';
const settingsFieldClass =
    'clash-settings-field w-full rounded-xl px-3 py-2 text-sm text-slate-900 placeholder:text-stone-400 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-50 dark:placeholder:text-stone-500';
const settingsSearchFieldClass =
    `${settingsFieldClass} pl-9 pr-3`;
const settingsMonoFieldClass =
    `${settingsFieldClass} font-mono`;
const settingsTextareaFieldClass =
    `${settingsMonoFieldClass} resize-y leading-5`;
const settingsSecondaryButtonClass =
    'clash-settings-secondary inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60';
const settingsCompactSecondaryButtonClass =
    'clash-settings-secondary inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60';
const settingsSelectTriggerClass =
    'clash-settings-select-trigger h-10 w-full';

function formatProviderTestPayload(payload: Record<string, unknown>): string {
    return JSON.stringify(payload, null, 2);
}

const MODEL_PROVIDER_FILTER_OPTIONS: SelectOption<'all' | 'ready' | 'missing'>[] = [
    { value: 'all', label: 'All provider states' },
    { value: 'ready', label: 'Provider ready' },
    { value: 'missing', label: 'Provider missing' },
];

const AUTH_LAUNCH_OPENING_TIMEOUT_MS = 8_000;
const AUTH_RECHECK_INTERVAL_MS = 2_000;
const AUTH_RECHECK_MAX_ATTEMPTS = 30;

function displayErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function usePrefersReducedMotion(): boolean {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        setPrefersReducedMotion(media.matches);
        const onChange = () => setPrefersReducedMotion(media.matches);
        media.addEventListener?.("change", onChange);
        return () => {
            media.removeEventListener?.("change", onChange);
        };
    }, []);

    return prefersReducedMotion;
}

function SettingsAnimatedBody({
    children,
    className = "space-y-4",
}: {
    children: ReactNode;
    className?: string;
}) {
    const prefersReducedMotion = usePrefersReducedMotion();

    return (
        <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className={className}
        >
            {children}
        </motion.div>
    );
}

function SettingsSkeletonLine({ className = "" }: { className?: string }) {
    return (
        <span className={`${settingsSkeletonLineClass} block ${className}`} />
    );
}

function SettingsFieldSkeleton({ wide = false }: { wide?: boolean }) {
    return (
        <div className="space-y-2">
            <SettingsSkeletonLine className={wide ? "h-2.5 w-40" : "h-2.5 w-28"} />
            <SettingsSkeletonLine className="h-9 w-full rounded-lg" />
        </div>
    );
}

function SettingsFormSkeleton({
    ariaLabel,
    variant,
}: {
    ariaLabel: string;
    variant: "sync" | "audio";
}) {
    return (
        <div role="status" aria-label={ariaLabel} className="space-y-4">
            {variant === "sync" ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {[0, 1].map((index) => (
                        <div key={index} className="rounded-xl border border-warm-border bg-warm-surface p-4">
                            <SettingsSkeletonLine className="h-3 w-24" />
                            <SettingsSkeletonLine className="mt-2 h-2.5 w-36" />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="rounded-xl border border-warm-border bg-warm-surface p-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <SettingsSkeletonLine className="h-3 w-24" />
                            <SettingsSkeletonLine className="mt-2 h-2.5 w-64 max-w-full" />
                        </div>
                        <SettingsSkeletonLine className="h-6 w-11 shrink-0" />
                    </div>
                </div>
            )}
            <div className="space-y-3 rounded-xl border border-warm-border bg-warm-surface p-4">
                <SettingsFieldSkeleton wide />
                <SettingsFieldSkeleton />
                {variant === "audio" && (
                    <>
                        <SettingsFieldSkeleton />
                        <SettingsFieldSkeleton />
                    </>
                )}
                <div className="flex gap-2">
                    <SettingsSkeletonLine className="h-2.5 w-20" />
                    <SettingsSkeletonLine className="h-2.5 w-16" />
                </div>
            </div>
            {variant === "audio" && (
                <div className="rounded-xl border border-warm-border bg-warm-surface p-4">
                    <SettingsSkeletonLine className="h-3 w-28" />
                    <div className="mt-3 space-y-2">
                        <SettingsSkeletonLine className="h-10 w-full rounded-xl" />
                        <SettingsSkeletonLine className="h-10 w-full rounded-xl" />
                    </div>
                </div>
            )}
        </div>
    );
}

function AgentRowsSkeleton({ ariaLabel }: { ariaLabel: string }) {
    return (
        <div role="status" aria-label={ariaLabel} className="divide-y divide-warm-border">
            {[0, 1, 2].map((index) => (
                <div key={index} className="grid min-h-[4.75rem] grid-cols-[minmax(0,1fr)_10rem] items-center gap-4 px-4 py-3">
                    <div className="min-w-0">
                        <SettingsSkeletonLine className="h-3 w-28" />
                        <SettingsSkeletonLine className="mt-2 h-2.5 w-44 max-w-full" />
                        <SettingsSkeletonLine className="mt-2 h-2.5 w-36 max-w-full" />
                    </div>
                    <div className="flex justify-end gap-2">
                        <SettingsSkeletonLine className="h-8 w-20 rounded-lg" />
                        <SettingsSkeletonLine className="h-8 w-10 rounded-lg" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function isAbortError(error: unknown): boolean {
    return (
        typeof DOMException !== "undefined" &&
        error instanceof DOMException &&
        error.name === "AbortError"
    );
}

interface LocalHarnessInfo {
    id: string;
    label: string;
    binary: string;
    enabled: boolean;
    available: boolean;
    custom?: boolean;
    installed?: boolean;
    installedVersion?: string;
    latestVersion?: string;
    updateAvailable?: boolean;
    installable?: boolean;
    installSource?: "registry" | "adapter";
    downloadUrl?: string;
    downloadKind?: "adapter";
    homepage?: string;
    auth?: {
        status: 'configured' | 'needs-auth' | 'unknown';
        message: string;
        command?: string;
        methodId?: string;
        methodName?: string;
        methods?: Array<{
            id: string;
            name?: string;
            description?: string;
            type?: string;
            vars?: Array<{
                name: string;
                label?: string;
                secret?: boolean;
                optional?: boolean;
            }>;
            link?: string;
        }>;
    };
}

type HarnessSavingAction = "toggle" | "probe" | "install" | "uninstall" | "upgrade" | "auth";

function harnessBusyMessage(label: string, action: HarnessSavingAction | null): string | null {
    if (action === "probe") return `Checking ${label} auth…`;
    if (action === "install") return `Installing ${label} from the ACP registry…`;
    if (action === "upgrade") return `Upgrading ${label} from the ACP registry…`;
    if (action === "uninstall") return `Removing ${label} from Clash-managed installs…`;
    if (action === "toggle") return `Saving ${label} enablement…`;
    return null;
}

function harnessBusyStatusLabel(action: HarnessSavingAction | null): string | null {
    if (action === "probe") return "Checking auth…";
    if (action === "install") return "Installing…";
    if (action === "upgrade") return "Upgrading…";
    if (action === "uninstall") return "Uninstalling…";
    if (action === "toggle") return "Saving enablement…";
    return null;
}

type AuthLaunchStatus = "opening" | "waiting" | "attention";

interface AuthLaunchState {
    status: AuthLaunchStatus;
    methodId?: string;
    methodLabel?: string;
    message?: string;
}

type LocalAgentServersConfig = Record<string, {
    type: "custom";
    command: string;
    args?: string[];
    env?: Record<string, string>;
}>;

const CUSTOM_AGENT_SERVER_STARTERS = [
    {
        id: "blank",
        label: "Blank",
        name: "my-agent",
        command: "",
        args: [],
        env: {},
    },
    {
        id: "node-script",
        label: "Node script",
        name: "node-agent",
        command: "node",
        args: ["~/projects/my-agent/index.js", "--acp"],
        env: {},
    },
    {
        id: "package-runner",
        label: "Package",
        name: "package-agent",
        command: "npx",
        args: ["-y", "<agent-package>", "--acp"],
        env: {},
    },
] as const;

function formatArgsText(args: readonly string[] | undefined): string {
    return (args ?? []).join("\n");
}

function parseArgsText(value: string): string[] {
    return value.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean);
}

function formatEnvText(env: Record<string, string> | undefined): string {
    return JSON.stringify(env ?? {}, null, 2);
}

function formatAgentCommand(server: LocalAgentServersConfig[string]): string {
    return [server.command, ...(server.args ?? [])].join(" ");
}

function formatHarnessVersionLine(harness: LocalHarnessInfo): string | null {
    if (!harness.installed) return null;
    if (harness.updateAvailable) {
        if (harness.installedVersion && harness.latestVersion) {
            return `Version: ${harness.installedVersion} -> ${harness.latestVersion}`;
        }
        if (harness.latestVersion) return `Latest version: ${harness.latestVersion}`;
        if (harness.installedVersion) return `Version: ${harness.installedVersion}`;
        return null;
    }
    const version = harness.installedVersion ?? harness.latestVersion;
    return version ? `Version: ${version}` : null;
}

function harnessStatus(harness: LocalHarnessInfo): { label: string; className: string } {
    if (harness.auth?.status === 'needs-auth') {
        return {
            label: "Auth needed",
            className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
        };
    }
    if (harness.auth?.status === 'unknown') {
        return {
            label: "Check auth",
            className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
        };
    }
    if (harness.updateAvailable) {
        return {
            label: "Update available",
            className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
        };
    }
    if (harness.auth?.status === 'configured') {
        return {
            label: "Auth configured",
            className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
        };
    }
    if (harness.available) {
        return {
            label: "Ready",
            className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
        };
    }
    if (harness.installable) {
        return {
            label: "Not installed",
            className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
        };
    }
    return {
        label: "Needs setup",
        className: "bg-stone-100 text-stone-600 dark:bg-stone-700/50 dark:text-stone-300",
    };
}

function harnessAuthBlocksEnable(harness: LocalHarnessInfo | undefined): boolean {
    return harness?.auth?.status === 'needs-auth' || harness?.auth?.status === 'unknown';
}

function harnessIsConfigured(harness: LocalHarnessInfo): boolean {
    return harness.enabled;
}

type LocalAuthMethod = NonNullable<NonNullable<LocalHarnessInfo["auth"]>["methods"]>[number];

type LocalAuthProtocol = "none" | "agent" | "terminal" | "env_var" | "unsupported";

function authEnvVarNamesFromText(text: string | undefined): string[] {
    if (!text || !/\benvironment variable\b|\benv(?:ironment)? var\b/i.test(text)) return [];
    return [...new Set([...text.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g)].map((match) => match[1]))];
}

function authMethodProtocol(method: LocalAuthMethod | undefined): LocalAuthProtocol {
    if (!method) return "none";
    if (method.type === "terminal") {
        return authEnvVarNamesFromText(method.description).length > 0 ? "env_var" : "terminal";
    }
    if (method.type === "env_var") return "env_var";
    if (!method.type || method.type === "agent") return "agent";
    return "unsupported";
}

function authMethodIsTerminal(method: LocalAuthMethod | undefined): boolean {
    return authMethodProtocol(method) === "terminal";
}

function authMethodIsEnvVar(method: LocalAuthMethod | undefined): boolean {
    return authMethodProtocol(method) === "env_var";
}

function authActionLabel(method: LocalAuthMethod | undefined, multiple: boolean): string {
    const protocol = authMethodProtocol(method);
    const methodLabel = method?.name ?? method?.id ?? "setup";
    if (protocol === "terminal") {
        return multiple ? `Open ${methodLabel}` : "Open setup";
    }
    if (protocol === "env_var") {
        return multiple ? `Configure ${methodLabel}` : "Configure";
    }
    return multiple && method ? `Sign in with ${method.name ?? method.id}` : "Sign in";
}

function authActionAriaLabel(harnessLabel: string, method: LocalAuthMethod | undefined, multiple: boolean): string {
    const protocol = authMethodProtocol(method);
    const methodLabel = method?.name ?? method?.id ?? "setup";
    if (protocol === "terminal") {
        return multiple
            ? `Open ${harnessLabel} setup with ${methodLabel}`
            : `Open ${harnessLabel} setup`;
    }
    if (protocol === "env_var") {
        return multiple
            ? `Configure ${harnessLabel} credentials for ${methodLabel}`
            : `Configure ${harnessLabel} credentials`;
    }
    return multiple && method
        ? `Sign in to ${harnessLabel} with ${method.name ?? method.id}`
        : `Sign in to ${harnessLabel}`;
}

function authMethodVariableNames(method: LocalAuthMethod | undefined): string[] {
    const explicit = method?.vars?.map((variable) => variable.name).filter(Boolean) ?? [];
    return explicit.length > 0 ? explicit : authEnvVarNamesFromText(method?.description);
}

export default function SettingsClient({
    initialTokens,
    initialVariables,
    initialActions,
    initialSkills,
    initialModelProviders = [],
    initialModelCatalog = [],
    activeSection,
    embedded = false,
}: Props) {
    const showAll = activeSection == null;
    const showSection = (s: SettingsSection) => showAll || activeSection === s;
    const [tokens, setTokens] = useState<ApiTokenInfo[]>(initialTokens);
    const [newTokenName, setNewTokenName] = useState('');
    const [revealedToken, setRevealedToken] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const [variables, setVariables] = useState<VariableInfo[]>(initialVariables);
    const [newVarKey, setNewVarKey] = useState('');
    const [newVarValue, setNewVarValue] = useState('');
    const [isAddingVar, setIsAddingVar] = useState(false);
    const [showVarValue, setShowVarValue] = useState(false);

    const [actions, setActions] = useState<InstalledActionInfo[]>(initialActions);
    const [skills, setSkills] = useState<InstalledSkillInfo[]>(initialSkills);
    const [modelProviders, setModelProviders] = useState<ModelProviderAccountInfo[]>(initialModelProviders);
    const [modelCatalog, setModelCatalog] = useState<ModelCatalogEntryInfo[]>(initialModelCatalog);
    const [isSavingModelProviders, setIsSavingModelProviders] = useState(false);
    const [modelProviderError, setModelProviderError] = useState<string | null>(null);
    const [providerOAuth, setProviderOAuth] = useState<ProviderOAuthInfo[]>([]);
    const feedback = useAppFeedback();

    const variableKeys = new Set(variables.map((v) => v.key));
    const providerPresets = Object.values(ACTION_PROVIDER_PRESETS);
    const modelProviderRows = useMemo(() => buildModelProviderRows(modelProviders), [modelProviders]);
    const modelCatalogProviderInputs = useMemo(
        () => buildModelCatalogProviderInputs(modelProviders, modelProviderRows),
        [modelProviderRows, modelProviders],
    );
    const effectiveModelCatalog = useMemo<ModelCatalogEntryInfo[]>(() => (
        modelCatalog.length > 0
            ? modelCatalog
            : listModelCatalogEntries({ configuredProviders: modelCatalogProviderInputs })
    ), [modelCatalog, modelCatalogProviderInputs]);
    const modelTierCounts = useMemo(() => countModelCatalogTiers(effectiveModelCatalog), [effectiveModelCatalog]);
    const asrModelEntries = useMemo(
        () => effectiveModelCatalog.filter((entry) => (entry.model.kind as string) === 'asr'),
        [effectiveModelCatalog],
    );

    const handleCreate = useCallback(async () => {
        if (!newTokenName.trim()) return;
        setIsCreating(true);
        try {
            const result = await createApiToken(newTokenName.trim());
            setTokens((prev) => [result.info, ...prev]);
            setRevealedToken(result.token);
            setNewTokenName('');
        } catch (err) {
            console.error('Failed to create token:', err);
        } finally {
            setIsCreating(false);
        }
    }, [newTokenName]);

    const handleRevoke = useCallback(async (tokenId: string) => {
        try {
            await revokeApiToken(tokenId);
            setTokens((prev) => prev.filter((t) => t.id !== tokenId));
            if (revealedToken) setRevealedToken(null);
        } catch (err) {
            console.error('Failed to revoke token:', err);
        }
    }, [revealedToken]);

    const handleAddVariable = useCallback(async () => {
        if (!newVarKey.trim() || !newVarValue.trim()) return;
        setIsAddingVar(true);
        try {
            const result = await setVariable(newVarKey.trim().toUpperCase(), newVarValue.trim());
            setVariables((prev) => {
                const filtered = prev.filter((v) => v.key !== result.key);
                return [result, ...filtered];
            });
            setNewVarKey('');
            setNewVarValue('');
            setShowVarValue(false);
        } catch (err) {
            console.error('Failed to set variable:', err);
        } finally {
            setIsAddingVar(false);
        }
    }, [newVarKey, newVarValue]);

    const handleSetVariable = useCallback(async (key: string, value: string) => {
        const normalizedKey = key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
        const normalizedValue = value.trim();
        if (!normalizedKey || !normalizedValue) return;
        const result = await setVariable(normalizedKey, normalizedValue);
        setVariables((prev) => {
            const filtered = prev.filter((v) => v.key !== result.key);
            return [result, ...filtered];
        });
    }, []);

    const handleDeleteVariable = useCallback(async (varId: string) => {
        try {
            await deleteVariable(varId);
            setVariables((prev) => prev.filter((v) => v.id !== varId));
        } catch (err) {
            console.error('Failed to delete variable:', err);
        }
    }, []);

    const handleUninstallAction = useCallback(async (actionId: string) => {
        try {
            await uninstallAction(actionId);
            setActions((prev) => prev.filter((a) => a.actionId !== actionId));
        } catch (err) {
            console.error('Failed to uninstall action:', err);
        }
    }, []);

    const handleUninstallSkill = useCallback(async (skillId: string) => {
        try {
            await uninstallSkill(skillId);
            setSkills((prev) => prev.filter((s) => s.skillId !== skillId));
        } catch (err) {
            console.error('Failed to uninstall skill:', err);
        }
    }, []);

    const saveModelProviders = useCallback(async (nextProviders: ModelProviderAccountInfo[]) => {
        const previousProviders = modelProviders;
        setModelProviders(nextProviders);
        setIsSavingModelProviders(true);
        setModelProviderError(null);
        try {
            const savedProviders = await updateModelProviders(nextProviders);
            const nextCatalog = await listModelCatalog();
            setModelProviders(savedProviders);
            setModelCatalog(nextCatalog);
            feedback.notify({
                variant: 'success',
                title: 'Provider settings saved',
            });
            return savedProviders;
        } catch (err) {
            setModelProviders(previousProviders);
            const message = displayErrorMessage(err);
            setModelProviderError(message);
            feedback.notify({
                variant: 'error',
                title: 'Could not save provider settings',
                message,
            });
            throw err;
        } finally {
            setIsSavingModelProviders(false);
        }
    }, [feedback, modelProviders]);

    const handlePatchModelProvider = useCallback((key: string, patch: Partial<ModelProviderAccountInfo>) => {
        const nextProviders = patchModelProviderList(modelProviders, key, patch);
        if (nextProviders === modelProviders) return Promise.resolve(modelProviders);
        return saveModelProviders(nextProviders);
    }, [modelProviders, saveModelProviders]);

    const handlePatchModelProviders = useCallback((patches: ModelProviderPatch[]) => {
        const nextProviders = patchModelProviderLists(modelProviders, patches);
        if (nextProviders === modelProviders) return Promise.resolve(modelProviders);
        return saveModelProviders(nextProviders);
    }, [modelProviders, saveModelProviders]);

    const handleDeleteModelProvider = useCallback(async (accountId: string) => {
        const previousProviders = modelProviders;
        setModelProviders((prev) => prev.filter((provider) => provider.id !== accountId));
        setIsSavingModelProviders(true);
        setModelProviderError(null);
        try {
            await deleteModelProvider(accountId);
            const [savedProviders, nextCatalog] = await Promise.all([
                listModelProviders(),
                listModelCatalog(),
            ]);
            setModelProviders(savedProviders);
            setModelCatalog(nextCatalog);
            feedback.notify({
                variant: 'success',
                title: 'Provider account removed',
            });
        } catch (err) {
            setModelProviders(previousProviders);
            const message = displayErrorMessage(err);
            setModelProviderError(message);
            feedback.notify({
                variant: 'error',
                title: 'Could not remove provider account',
                message,
            });
            throw err;
        } finally {
            setIsSavingModelProviders(false);
        }
    }, [feedback, modelProviders]);

    useEffect(() => {
        let cancelled = false;
        void listProviderOAuth()
            .then((rows) => {
                if (!cancelled) setProviderOAuth(rows);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    const handleStartProviderOAuth = useCallback(async (providerId: string, accountId?: string, accountLabel?: string) => {
        try {
            const row = await startProviderOAuth(providerId, accountId, accountLabel);
            setProviderOAuth((prev) => upsertProviderOAuthRow(prev, row));
        } catch (err) {
            const message = displayErrorMessage(err);
            setProviderOAuth((prev) => upsertProviderOAuthRow(prev, {
                providerId,
                ...(accountId ? { accountId } : {}),
                ...(accountLabel ? { accountLabel } : {}),
                status: 'error',
                error: message,
                hasAccessToken: false,
            }));
            feedback.notify({
                variant: 'error',
                title: `Could not start ${providerOAuthDisplayName(providerId)} authorization`,
                message,
            });
        }
    }, [feedback]);

    const handleCompleteProviderOAuth = useCallback(async (providerId: string, deviceCode?: string, accountId?: string) => {
        try {
            const row = await completeProviderOAuth(providerId, deviceCode, accountId);
            setProviderOAuth((prev) => upsertProviderOAuthRow(prev, row));
            const [providerRows, catalogRows] = await Promise.all([
                listModelProviders(),
                listModelCatalog(),
            ]);
            setModelProviders(providerRows);
            setModelCatalog(catalogRows);
        } catch (err) {
            const message = displayErrorMessage(err);
            setProviderOAuth((prev) => upsertProviderOAuthRow(prev, {
                providerId,
                ...(accountId ? { accountId } : {}),
                status: 'error',
                error: message,
                hasAccessToken: false,
            }));
            feedback.notify({
                variant: 'error',
                title: `Could not complete ${providerOAuthDisplayName(providerId)} authorization`,
                message,
            });
        }
    }, [feedback]);

    const handleCopy = useCallback(async (text: string, id: string) => {
        await navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    }, []);

    const formatDate = (date: Date | null) => {
        if (!date) return 'Never';
        return new Date(date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    // When embedded, drop both the min-h-screen + sticky header — the
    // host (SettingsSurface) provides its own chrome.
    const content = (
        <div className={embedded ? 'space-y-12' : 'mx-auto max-w-3xl px-6 py-10 space-y-12'}>

                {/* ── Agents ── */}
                {showSection('agents') && <AgentsSection />}

                {/* ── Sync ── */}
                {showSection('sync') && <SyncSection />}

                {showAll && <hr className="border-warm-border" />}

                {/* ── Audio ── */}
                {showSection('audio') && <AudioSection asrModels={asrModelEntries} />}

                {showAll && <hr className="border-warm-border" />}

                {/* ── API Tokens ── */}
                {showSection('tokens') && (
                <section>
                    <div className="flex items-center gap-3 mb-5">
                        <Key className="h-5 w-5 text-stone-600 dark:text-stone-300" weight="bold" />
                        <div>
                            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">API Tokens</h2>
                            <p className="text-sm text-stone-600 dark:text-stone-300">For CLI and agent access</p>
                        </div>
                    </div>

                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={newTokenName}
                            onChange={(e) => setNewTokenName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                            placeholder="Token name"
                            className={`${settingsFieldClass} min-w-0 flex-1 px-4`}
                        />
                        <motion.button
                            onClick={handleCreate}
                            disabled={isCreating || !newTokenName.trim()}
                            className={settingsPrimaryButtonClass}
                            whileTap={{ scale: 0.97 }}
                        >
                            Create
                        </motion.button>
                    </div>

                    <AnimatePresence>
                        {revealedToken && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden mb-4"
                            >
                                <div className="rounded-xl bg-warm-muted border border-warm-border p-4">
                                    <p className="text-sm font-medium text-stone-700 dark:text-stone-200 mb-2">
                                        Copy this token now — it won&apos;t be shown again.
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 rounded-lg bg-warm-surface border border-warm-border px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-50 select-all truncate">
                                            {revealedToken}
                                        </code>
                                        <button
                                            onClick={() => handleCopy(revealedToken, 'new')}
                                            className="rounded-lg p-2 text-slate-800 dark:text-slate-200 hover:text-slate-900 hover:bg-warm-muted dark:text-slate-300 dark:hover:text-slate-50 dark:hover:bg-warm-hover transition-colors"
                                        >
                                            {copiedId === 'new' ? <Check className="h-4 w-4 text-green-600" weight="bold" /> : <Copy className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    <button onClick={() => setRevealedToken(null)} className="mt-2 text-xs text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
                                        Dismiss
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {tokens.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-warm-border py-10 text-center">
                            <Key className="h-8 w-8 text-stone-500 mx-auto mb-2 dark:text-stone-500" weight="duotone" />
                            <p className="text-sm text-stone-600 dark:text-stone-300">No tokens yet</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {tokens.map((token) => (
                                <div key={token.id} className="group flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-warm-muted transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-slate-900 dark:text-slate-50">{token.name}</span>
                                            <code className="text-xs text-stone-500 dark:text-stone-400 font-mono">{token.tokenPrefix}</code>
                                        </div>
                                        <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                                            Created {formatDate(token.createdAt)} · Last used {formatDate(token.lastUsedAt)}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => handleRevoke(token.id)}
                                        className={settingsDangerGhostButtonClass}
                                    >
                                        <Trash className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
                )}

                {showAll && <hr className="border-warm-border" />}

                {/* ── Providers ── */}
                {showSection('providers') && (
                <ModelRoutingSection
                    mode="providers"
                    providers={modelProviderRows}
                    providerAccounts={modelProviders}
                    catalog={effectiveModelCatalog}
                    tierCounts={modelTierCounts}
                    providerOAuth={providerOAuth}
                    onStartProviderOAuth={handleStartProviderOAuth}
                    onCompleteProviderOAuth={handleCompleteProviderOAuth}
                    onPatchProvider={handlePatchModelProvider}
                    onPatchProviders={handlePatchModelProviders}
                    onDeleteProvider={handleDeleteModelProvider}
                    saving={isSavingModelProviders}
                    error={modelProviderError}
                />
                )}

                {showAll && <hr className="border-warm-border" />}

                {/* ── Variables: hidden compatibility section for raw secret variables. ── */}
                {activeSection === 'variables' && (
                <section>
                    <div className="flex items-center gap-3 mb-5">
                        <Lock className="h-5 w-5 text-stone-600 dark:text-stone-300" weight="bold" />
                        <div>
                            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">API Keys</h2>
                            <p className="text-sm text-stone-600 dark:text-stone-300">OpenAI image generation and canvas action keys</p>
                        </div>
                    </div>

                    <div className="mb-5 divide-y divide-warm-border border-y border-warm-border">
                        {providerPresets.map((preset) => {
                            const configured = variableKeys.has(preset.defaultSecretId);
                            return (
                                <button
                                    key={preset.id}
                                    type="button"
                                    aria-label={`${preset.label} · ${preset.defaultSecretId}`}
                                    onClick={() => setNewVarKey(preset.defaultSecretId)}
                                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition-colors hover:bg-warm-muted"
                                    title={preset.secretDescription}
                                >
                                    <span className="min-w-0">
                                        <span className="block text-sm font-medium text-slate-900 dark:text-slate-50">{preset.label}</span>
                                        <code className="block truncate text-xs text-stone-500 dark:text-stone-400">{preset.defaultSecretId}</code>
                                    </span>
                                    <span
                                        className={
                                            configured
                                                ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                                                : "rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                                        }
                                    >
                                        {configured ? 'Configured' : 'Missing'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={newVarKey}
                            onChange={(e) => setNewVarKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                            placeholder="KEY_NAME"
                            autoComplete="off"
                            className={`${settingsMonoFieldClass} w-36 px-4`}
                        />
                        <div className="flex-1 relative">
                            <input
                                type={showVarValue ? 'text' : 'password'}
                                value={newVarValue}
                                onChange={(e) => setNewVarValue(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddVariable()}
                                placeholder="Value"
                                autoComplete="new-password"
                                className={`${settingsFieldClass} px-4 pr-9`}
                            />
                            <button
                                type="button"
                                onClick={() => setShowVarValue(!showVarValue)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-700 dark:text-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                            >
                                {showVarValue ? <EyeSlash className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                        </div>
                        <motion.button
                            onClick={handleAddVariable}
                            disabled={isAddingVar || !newVarKey.trim() || !newVarValue.trim()}
                            className={settingsPrimaryButtonClass}
                            whileTap={{ scale: 0.97 }}
                        >
                            Set
                        </motion.button>
                    </div>

                    {variables.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-warm-border py-10 text-center">
                            <Lock className="h-8 w-8 text-stone-500 mx-auto mb-2 dark:text-stone-500" weight="duotone" />
                            <p className="text-sm text-stone-600 dark:text-stone-300">No variables yet</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {variables.map((v) => (
                                <div key={v.id} className="group flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-warm-muted transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <code className="text-sm font-mono font-medium text-slate-900 dark:text-slate-50">{v.key}</code>
                                            <span className="text-[10px] text-stone-600 dark:text-stone-400 bg-warm-muted rounded-lg px-2 py-0.5">saved</span>
                                        </div>
                                        <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">Updated {formatDate(v.updatedAt || v.createdAt)}</p>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteVariable(v.id)}
                                        className={settingsDangerGhostButtonClass}
                                    >
                                        <Trash className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
                )}

                {showAll && <hr className="border-warm-border" />}

                {/* ── Models ── */}
                {showSection('models') && (
                <ModelRoutingSection
                    mode="models"
                    providers={modelProviderRows}
                    providerAccounts={modelProviders}
                    catalog={effectiveModelCatalog}
                    tierCounts={modelTierCounts}
                    providerOAuth={providerOAuth}
                    onStartProviderOAuth={handleStartProviderOAuth}
                    onCompleteProviderOAuth={handleCompleteProviderOAuth}
                    onPatchProvider={handlePatchModelProvider}
                    onPatchProviders={handlePatchModelProviders}
                    onDeleteProvider={handleDeleteModelProvider}
                    saving={isSavingModelProviders}
                    error={modelProviderError}
                />
                )}

                {showAll && <hr className="border-warm-border" />}

                {/* ── Installed Actions ── */}
                {showSection('actions') && (
                <section>
                    <div className="flex items-center gap-3 mb-5">
                        <PuzzlePiece className="h-5 w-5 text-stone-600 dark:text-stone-300" weight="bold" />
                        <div className="flex-1">
                            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Installed Actions</h2>
                            <p className="text-sm text-stone-600 dark:text-stone-300">Canvas actions available in all projects</p>
                        </div>
                        <Link to="/marketplace/manage" className="text-sm font-medium text-stone-600 transition-colors hover:text-brand dark:text-stone-300 dark:hover:text-brand">
                            Browse
                        </Link>
                    </div>

                    {actions.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-warm-border py-10 text-center">
                            <PuzzlePiece className="h-8 w-8 text-stone-500 mx-auto mb-2 dark:text-stone-500" weight="duotone" />
                            <p className="text-sm text-stone-600 dark:text-stone-300 mb-2">No actions installed</p>
                            <Link to="/marketplace/manage" className="text-sm font-medium text-slate-950 transition-colors hover:text-brand dark:text-slate-50 dark:hover:text-brand">
                                Explore Marketplace
                            </Link>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {actions.map((action) => {
                                const manifest = (() => {
                                    try {
                                        const parsed = CustomActionDefinitionSchema.safeParse(JSON.parse(action.manifest));
                                        return parsed.success ? parsed.data : null;
                                    } catch {
                                        return null;
                                    }
                                })();
                                const secrets = manifest?.secrets ?? [];
                                const missingSecrets = secrets.filter((s) => !variableKeys.has(s.id));
                                const modelProvider = (() => {
                                    const provider = manifest?.model?.provider;
                                    if (!provider) return null;
                                    const presetId = normalizeActionProviderId(provider);
                                    return presetId ? ACTION_PROVIDER_PRESETS[presetId].label : provider;
                                })();
                                const modelLabel = manifest?.model
                                    ? `${modelProvider ?? manifest.model.provider} · ${manifest.model.name ?? manifest.model.id}`
                                    : null;
                                return (
                                    <div key={action.id} className="group rounded-xl px-4 py-3 hover:bg-warm-muted transition-colors">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-sm font-medium text-slate-900 dark:text-slate-50">{action.name}</span>
                                                    {action.version && <span className="text-xs text-stone-500 dark:text-stone-400 font-mono">v{action.version}</span>}
                                                    {action.author && <span className="text-xs text-stone-500 dark:text-stone-400">@{action.author}</span>}
                                                </div>
                                                {action.description && <p className="text-xs text-stone-600 dark:text-stone-300 mt-0.5 line-clamp-1">{action.description}</p>}
                                                {modelLabel && (
                                                    <div className="mt-1.5">
                                                        <span className="text-[10px] text-stone-600 dark:text-stone-300 bg-warm-surface border border-warm-border rounded-lg px-2 py-0.5 font-medium">
                                                            {modelLabel}
                                                        </span>
                                                    </div>
                                                )}
                                                {missingSecrets.length > 0 && (
                                                    <div className="flex items-center gap-1.5 mt-1.5">
                                                        <span className="text-[10px] text-amber-600 bg-amber-50 rounded-full px-2 py-0.5 font-medium">
                                                            Missing {missingSecrets.map((s) => s.id).join(', ')}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => handleUninstallAction(action.actionId)}
                                                className={`${settingsDangerGhostButtonClass} flex-shrink-0`}
                                            >
                                                <Trash className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
                )}

                {showAll && <hr className="border-warm-border" />}

                {/* ── Installed Skills ── */}
                {showSection('skills') && (
                <section>
                    <div className="flex items-center gap-3 mb-5">
                        <BookOpen className="h-5 w-5 text-stone-600 dark:text-stone-300" weight="bold" />
                        <div className="flex-1">
                            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Installed Skills</h2>
                            <p className="text-sm text-stone-600 dark:text-stone-300">AI agent skills for Claude</p>
                        </div>
                        <Link to="/marketplace/manage" className="text-sm font-medium text-stone-600 transition-colors hover:text-brand dark:text-stone-300 dark:hover:text-brand">
                            Browse
                        </Link>
                    </div>

                    {skills.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-warm-border py-10 text-center">
                            <BookOpen className="h-8 w-8 text-stone-500 mx-auto mb-2 dark:text-stone-500" weight="duotone" />
                            <p className="text-sm text-stone-600 dark:text-stone-300 mb-2">No skills installed</p>
                            <Link to="/marketplace/manage" className="text-sm font-medium text-slate-950 transition-colors hover:text-brand dark:text-slate-50 dark:hover:text-brand">
                                Explore Marketplace
                            </Link>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {skills.map((skill) => (
                                <div key={skill.id} className="group flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-warm-muted transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-medium text-slate-900 dark:text-slate-50">{skill.name}</span>
                                            {skill.version && <span className="text-xs text-stone-500 dark:text-stone-400 font-mono">v{skill.version}</span>}
                                            {skill.author && <span className="text-xs text-stone-500 dark:text-stone-400">@{skill.author}</span>}
                                        </div>
                                        {skill.description && <p className="text-xs text-stone-600 dark:text-stone-300 mt-0.5 line-clamp-1">{skill.description}</p>}
                                    </div>
                                    <button
                                        onClick={() => handleUninstallSkill(skill.skillId)}
                                        className={settingsDangerGhostButtonClass}
                                    >
                                        <Trash className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
                )}

                {showAll && <hr className="border-warm-border" />}

                {/* ── CLI ── */}
                {showSection('cli') && (
                <section className="pb-4">
                    <div className="flex items-center gap-3 mb-4">
                        <Terminal className="h-5 w-5 text-stone-600 dark:text-stone-300" weight="bold" />
                        <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">CLI</h2>
                    </div>
                    <code className="block rounded-xl bg-warm-muted border border-warm-border px-4 py-3 text-sm font-mono text-stone-700 dark:text-stone-200">
                        npm install -g @clash-space/cli
                    </code>
                </section>
                )}
            </div>
    );

    if (embedded) return content;

    return (
        <div className="min-h-screen bg-warm-surface">
            {/* Sticky header */}
            <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-warm-border">
                <div className="mx-auto max-w-3xl px-6 py-4 flex items-center gap-4">
                    <Link
                        to="/"
                        className="flex items-center justify-center h-9 w-9 rounded-xl border border-warm-border text-stone-600 transition-all hover:text-slate-950 hover:border-brand/35 dark:text-stone-300 dark:hover:text-slate-50"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                    <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-50">Settings</h1>
                </div>
            </header>
            {content}
        </div>
    );
}

const MODEL_PROVIDER_PRESETS: ModelProviderAccountInfo[] = [
    { providerId: 'official', upstreamId: 'openai', region: 'global', enabled: false, priority: 10 },
    { providerId: 'official', upstreamId: 'anthropic', region: 'global', enabled: false, priority: 15 },
    { providerId: 'official', upstreamId: 'google', region: 'global', enabled: false, priority: 20 },
    { providerId: 'fal', upstreamId: 'fal', enabled: false, priority: 30 },
    { providerId: 'kie', upstreamId: 'kie', enabled: false, priority: 40 },
    { providerId: 'replicate', upstreamId: 'replicate', enabled: false, priority: 50 },
    { providerId: 'kling', upstreamId: 'kling', enabled: false, priority: 60 },
    { providerId: 'minimax', upstreamId: 'minimax', enabled: false, priority: 70 },
    { providerId: 'jimeng', upstreamId: 'jimeng', enabled: false, priority: 80 },
    { providerId: 'volcengine', upstreamId: 'volcengine', enabled: false, priority: 90 },
    { providerId: 'elevenlabs', upstreamId: 'elevenlabs', enabled: false, priority: 100 },
];

function modelProviderKey(provider: Pick<ModelProviderAccountInfo, 'providerId' | 'upstreamId' | 'region'>): string {
    return [provider.providerId, provider.upstreamId ?? '', provider.region ?? ''].join(':');
}

function modelProviderAccountIdentity(provider: Pick<ModelProviderAccountInfo, 'id' | 'providerId' | 'upstreamId' | 'region'>): string {
    return provider.id ? `account:${provider.id}` : `provider:${modelProviderKey(provider)}`;
}

function modelProviderLabel(provider: Pick<ModelProviderAccountInfo, 'providerId' | 'upstreamId' | 'region'>): string {
    return [
        provider.providerId,
        provider.upstreamId,
        provider.region,
    ].filter(Boolean).join('/');
}

function requiredModelProviderCredentials(provider: Pick<ModelProviderAccountInfo, 'providerId' | 'upstreamId'>): string[] {
    if (provider.providerId === 'fal') return ['apiKey'];
    if (provider.providerId === 'kie') return ['apiKey'];
    if (provider.providerId === 'replicate') return ['apiKey'];
    if (provider.providerId === 'kling') return ['accessKey', 'secretKey'];
    if (provider.providerId === 'minimax') return ['apiKey'];
    if (provider.providerId === 'jimeng') return [];
    if (provider.providerId === 'volcengine') return ['apiKey'];
    if (provider.providerId === 'elevenlabs') return ['apiKey'];
    if (provider.providerId === 'official' && provider.upstreamId === 'openai') return ['apiKey'];
    if (provider.providerId === 'official' && provider.upstreamId === 'anthropic') return ['apiKey'];
    if (provider.providerId === 'official' && provider.upstreamId === 'google') return ['apiKey', 'vertexCredentials'];
    return [];
}

type ModelProviderCredentialField = {
    key: string;
    label: string;
    ariaLabel?: string;
    placeholder?: string;
    allowMultiple?: boolean;
};

type ModelProviderSetup = {
    title: string;
    description: string;
    apiKey: string;
    credentials?: ModelProviderCredentialField[];
    oauthProviderId?: ProviderOAuthId;
    requiresAllCredentials?: boolean;
    baseUrlKey?: string;
    baseUrlPlaceholder?: string;
};

function modelProviderCredentialFields(setup: ModelProviderSetup): ModelProviderCredentialField[] {
    return setup.credentials ?? [
        {
            key: setup.apiKey,
            label: 'API key',
            ariaLabel: `${setup.title} API key`,
            allowMultiple: true,
        },
    ];
}

function modelProviderSetup(provider: Pick<ModelProviderAccountInfo, 'providerId' | 'upstreamId'>): ModelProviderSetup | null {
    if (provider.providerId === 'mock') {
        return {
            title: 'Mock Provider',
            description: 'Deterministic local provider used to verify provider and model routing flows.',
            apiKey: '',
            credentials: [],
        };
    }
    if (provider.providerId === 'fal') {
        return {
            title: 'fal.ai',
            description: 'Image, video, and audio models served through fal.ai endpoints.',
            apiKey: 'apiKey',
        };
    }
    if (provider.providerId === 'kie') {
        return {
            title: 'KIE',
            description: 'Alternative image/video provider for supported generation models.',
            apiKey: 'apiKey',
        };
    }
    if (provider.providerId === 'replicate') {
        return {
            title: 'Replicate',
            description: 'Replicate-hosted image and media generation models.',
            apiKey: 'apiKey',
        };
    }
    if (provider.providerId === 'kling') {
        return {
            title: 'Kling',
            description: 'Official Kling video generation through Clash-hosted execution.',
            apiKey: 'accessKey',
            credentials: [
                {
                    key: 'accessKey',
                    label: 'Access key',
                    ariaLabel: 'Kling access key',
                    placeholder: 'Paste access key',
                    allowMultiple: false,
                },
                {
                    key: 'secretKey',
                    label: 'Secret key',
                    ariaLabel: 'Kling secret key',
                    placeholder: 'Paste secret key',
                    allowMultiple: false,
                },
            ],
            requiresAllCredentials: true,
        };
    }
    if (provider.providerId === 'minimax') {
        return {
            title: 'MiniMax',
            description: 'Official MiniMax speech generation through Clash-hosted execution.',
            apiKey: 'apiKey',
        };
    }
    if (provider.providerId === 'jimeng') {
        return {
            title: 'Dreamina',
            description: 'Official Dreamina generation through the local dreamina CLI adapter.',
            apiKey: '',
            credentials: [],
            oauthProviderId: 'dreamina',
        };
    }
    if (provider.providerId === 'volcengine') {
        return {
            title: 'Volcengine',
            description: 'Official Volcengine ModelArk generation through Clash-hosted execution.',
            apiKey: 'apiKey',
            baseUrlKey: 'baseUrl',
            baseUrlPlaceholder: 'https://ark.cn-beijing.volces.com/api/v3',
        };
    }
    if (provider.providerId === 'elevenlabs') {
        return {
            title: 'ElevenLabs',
            description: 'Official ElevenLabs speech generation through Clash-hosted execution.',
            apiKey: 'apiKey',
        };
    }
    if (provider.providerId === 'official' && provider.upstreamId === 'openai') {
        return {
            title: 'OpenAI',
            description: 'OpenAI text and image models through Clash-hosted execution.',
            apiKey: 'apiKey',
            baseUrlKey: 'baseUrl',
            baseUrlPlaceholder: 'https://api.openai.com/v1',
        };
    }
    if (provider.providerId === 'official' && provider.upstreamId === 'anthropic') {
        return {
            title: 'Anthropic',
            description: 'Anthropic text models through Clash-hosted execution.',
            apiKey: 'apiKey',
            baseUrlKey: 'baseUrl',
            baseUrlPlaceholder: 'https://api.anthropic.com',
        };
    }
    if (provider.providerId === 'official' && provider.upstreamId === 'google') {
        return {
            title: 'Google',
            description: 'Google AI Studio and Vertex for supported image, video, audio, and text models.',
            apiKey: 'apiKey',
            credentials: [
                {
                    key: 'apiKey',
                    label: 'AI Studio API key',
                    ariaLabel: 'Google AI Studio API key',
                    placeholder: 'Paste API key',
                    allowMultiple: false,
                },
                {
                    key: 'vertexCredentials',
                    label: 'Vertex service account JSON',
                    ariaLabel: 'Google Vertex service account JSON',
                    placeholder: 'Paste service account JSON',
                    allowMultiple: false,
                },
            ],
        };
    }
    return null;
}

function withCredentialAvailability(provider: ModelProviderAccountInfo): ModelProviderAccountInfo {
    const configuredCredentials = provider.configuredCredentials ?? [];
    return {
        ...provider,
        configuredCredentials,
    };
}

function buildModelProviderRows(
    configured: ModelProviderAccountInfo[],
): ModelProviderAccountInfo[] {
    const rows = new Map<string, ModelProviderAccountInfo>();
    for (const preset of MODEL_PROVIDER_PRESETS) {
        if (!modelProviderSetup(preset)) continue;
        rows.set(modelProviderKey(preset), withCredentialAvailability(preset));
    }
    for (const provider of configured) {
        if (!modelProviderSetup(provider)) continue;
        const key = modelProviderKey(provider);
        const existing = rows.get(key);
        if (!existing || (existing.configuredCredentials ?? []).length === 0) {
            rows.set(key, withCredentialAvailability(provider));
        }
    }
    return [...rows.values()];
}

function buildModelCatalogProviderInputs(
    configured: ModelProviderAccountInfo[],
    providerRows: ModelProviderAccountInfo[],
): ModelProviderAccountInfo[] {
    const configuredAccounts = configured
        .filter((provider) => modelProviderSetup(provider))
        .map(withCredentialAvailability);
    if (configuredAccounts.length === 0) return providerRows;
    const configuredKeys = new Set(configuredAccounts.map(modelProviderKey));
    return [
        ...configuredAccounts,
        ...providerRows.filter((provider) => !configuredKeys.has(modelProviderKey(provider))),
    ];
}

function upsertModelProvider(
    providers: ModelProviderAccountInfo[],
    next: ModelProviderAccountInfo,
): ModelProviderAccountInfo[] {
    const key = modelProviderAccountIdentity(next);
    const filtered = providers.filter((provider) => modelProviderAccountIdentity(provider) !== key);
    return [...filtered, next];
}

type ModelProviderPatch = {
    key: string;
    patch: Partial<ModelProviderAccountInfo>;
};

function patchModelProviderList(
    providers: ModelProviderAccountInfo[],
    key: string,
    patch: Partial<ModelProviderAccountInfo>,
): ModelProviderAccountInfo[] {
    const row = patch.id
        ? providers.find((provider) => provider.id === patch.id) ?? buildModelProviderRows(providers).find((provider) => modelProviderKey(provider) === key)
        : buildModelProviderRows(providers).find((provider) => modelProviderKey(provider) === key);
    if (!row) return providers;
    const credentialKeys = patch.credentials
        ? Object.entries(patch.credentials)
            .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
            .map(([credentialKey]) => credentialKey)
        : [];
    return upsertModelProvider(providers, {
        ...row,
        ...patch,
        configuredCredentials: credentialKeys.length
            ? [...new Set([...(row.configuredCredentials ?? []), ...credentialKeys])].sort()
            : patch.configuredCredentials ?? row.configuredCredentials,
    });
}

function patchModelProviderLists(
    providers: ModelProviderAccountInfo[],
    patches: ModelProviderPatch[],
): ModelProviderAccountInfo[] {
    return patches.reduce((nextProviders, { key, patch }) => patchModelProviderList(nextProviders, key, patch), providers);
}

function upsertProviderOAuthRow(rows: ProviderOAuthInfo[], next: ProviderOAuthInfo): ProviderOAuthInfo[] {
    return [next, ...rows.filter((row) => (
        row.providerId !== next.providerId ||
        (row.accountId ?? '') !== (next.accountId ?? '')
    ))];
}

function countModelCatalogTiers(catalog: ModelCatalogEntryInfo[]) {
    return catalog.reduce(
        (acc, entry) => {
            acc[entry.tier] += 1;
            return acc;
        },
        { available: 0, 'configured-provider': 0, all: 0 },
    );
}

type ProviderSupportRow = ReturnType<typeof listProviderModelSupport>[number];

type ProviderDraft = {
    accountId?: string;
    apiKeys?: Record<string, string>;
    baseUrl?: string;
    label?: string;
    modelAccessMode?: 'all' | 'specific';
    supportedModelIds?: string[];
};

const HIDDEN_CREDENTIAL_MASK = '•••• •••• ••••';

const MODEL_ACCESS_OPTIONS: SelectOption<'all' | 'specific'>[] = [
    { value: 'all', label: 'All models', description: 'Use every model this provider supports.' },
    { value: 'specific', label: 'Specific models', description: 'Restrict this account to selected model cards.' },
];

function SupportedModelPicker({
    options,
    onSelect,
}: {
    options: SelectOption<string>[];
    onSelect: (value: string) => void;
}) {
    return (
        <SearchableSelect
            ariaLabel="Add supported model"
            emptyMessage="No supported models match."
            listboxLabel="Supported models"
            matchTriggerWidth
            onValueChange={(value) => onSelect(String(value))}
            options={options}
            placeholder="Add model"
            searchAriaLabel="Search supported models"
            searchInputClassName={`${settingsSearchFieldClass} h-9 text-xs`}
            searchPlaceholder="Search models..."
            triggerClassName={`min-h-[34px] justify-between ${settingsSelectTriggerClass}`}
        />
    );
}

type ProviderTestModelOption = SelectOption<string> & {
    modelName: string;
    modelKind: string;
    upstreamModel: string;
    apiShape: string;
};

function ModelKindIcon({ kind }: { kind: string }) {
    const className = 'h-4 w-4';
    if (kind === 'video') return <VideoCamera className={className} aria-hidden="true" />;
    if (kind === 'audio') return <SpeakerHigh className={className} aria-hidden="true" />;
    if (kind === 'text') return <TextT className={className} aria-hidden="true" />;
    if (kind === 'asr') return <Microphone className={className} aria-hidden="true" />;
    return <ImageSquare className={className} aria-hidden="true" />;
}

function providerTestModelOptionLabel(option: ProviderTestModelOption): ReactNode {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{option.modelName}</span>
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-warm-muted px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:bg-slate-800 dark:text-stone-300">
                <ModelKindIcon kind={option.modelKind} />
                {option.modelKind}
            </span>
        </span>
    );
}

function providerTestModelTriggerLabel(option: ProviderTestModelOption): ReactNode {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{option.modelName}</span>
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-warm-muted px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:bg-slate-800 dark:text-stone-300">
                <ModelKindIcon kind={option.modelKind} />
                {option.modelKind}
            </span>
        </span>
    );
}

function providerTestModelSearchText(option: ProviderTestModelOption): string {
    return [
        option.modelName,
        option.modelKind,
        option.upstreamModel,
        option.apiShape,
        String(option.value),
    ].filter(Boolean).join(' ').toLowerCase();
}

function ProviderTestModelPicker({
    value,
    options,
    onValueChange,
}: {
    value: string;
    options: ProviderTestModelOption[];
    onValueChange: (value: string, option: ProviderTestModelOption) => void;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const selectedOption = options.find((option) => String(option.value) === String(value));
    const normalizedQuery = query.trim().toLowerCase();
    const filteredOptions = normalizedQuery
        ? options.filter((option) => providerTestModelSearchText(option).includes(normalizedQuery))
        : options;

    useEffect(() => {
        if (!open) setQuery('');
    }, [open]);

    const chooseOption = useCallback((option: ProviderTestModelOption) => {
        onValueChange(String(option.value), option);
        setOpen(false);
    }, [onValueChange]);

    return (
        <ComboboxProvider value={query} setValue={setQuery}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        aria-label="Choose test model"
                        aria-expanded={open}
                        disabled={options.length === 0}
                        onKeyDown={(event) => {
                            if (event.key !== 'ArrowDown') return;
                            event.preventDefault();
                            setOpen(true);
                        }}
                        className={`clash-settings-test-model-picker ${settingsSelectTriggerClass} flex min-w-0 items-center justify-between gap-2 rounded-xl border border-warm-border bg-warm-surface px-3 py-2 text-sm font-medium text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] transition-colors hover:bg-warm-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface disabled:cursor-not-allowed disabled:opacity-45 dark:text-slate-50 dark:hover:bg-slate-800`}
                    >
                        <span className={selectedOption ? 'min-w-0 flex-1 truncate text-left' : 'min-w-0 flex-1 truncate text-left text-stone-400 dark:text-stone-500'}>
                            {selectedOption ? providerTestModelTriggerLabel(selectedOption) : 'Select model'}
                        </span>
                        <CaretDown className="h-3.5 w-3.5 flex-shrink-0 text-stone-500" aria-hidden="true" />
                    </button>
                </PopoverTrigger>
                <PopoverContent
                    align="start"
                    sideOffset={8}
                    className="w-[min(420px,calc(100vw-24px))] overflow-hidden p-0"
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        searchInputRef.current?.focus();
                    }}
                >
                    <div className="border-b border-warm-border/80 p-2 dark:border-slate-700">
                        <div className="relative min-w-0">
                            <MagnifyingGlass
                                className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-stone-400"
                                aria-hidden="true"
                            />
                            <Combobox
                                ref={searchInputRef}
                                aria-label="Search test models"
                                autoComplete="list"
                                placeholder="Search models, routes, or shapes..."
                                className={`${settingsSearchFieldClass} h-9 text-xs`}
                            />
                        </div>
                    </div>
                    <ComboboxList
                        aria-label="Model to test"
                        alwaysVisible
                        className="max-h-72 overflow-y-auto p-1.5"
                    >
                        {filteredOptions.length === 0 ? (
                            <div className="px-3 py-5 text-center text-xs font-medium text-stone-500 dark:text-stone-400">
                                No matching models.
                            </div>
                        ) : (
                            filteredOptions.map((option) => {
                                const selected = String(option.value) === String(value);
                                const optionAriaLabel = [
                                    option.modelName,
                                    option.modelKind,
                                    option.upstreamModel,
                                    option.apiShape,
                                ].filter(Boolean).join(' ');
                                return (
                                    <ComboboxItem
                                        key={String(option.value)}
                                        value={option.modelName}
                                        aria-label={optionAriaLabel}
                                        setValueOnClick={false}
                                        selectValueOnClick={false}
                                        onClick={() => chooseOption(option)}
                                        className={cn(
                                            'flex min-h-[52px] w-full cursor-default items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors outline-none',
                                            selected
                                                ? 'bg-warm-muted/80 text-slate-950 dark:bg-slate-800 dark:text-slate-50'
                                                : 'text-slate-900 hover:bg-warm-muted/75 data-[active-item]:bg-warm-muted/75 dark:text-slate-100 dark:hover:bg-slate-800/80 dark:data-[active-item]:bg-slate-800/80',
                                        )}
                                    >
                                        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-slate-700 dark:text-slate-300" aria-hidden="true">
                                            <ModelKindIcon kind={option.modelKind} />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex min-w-0 items-center gap-2">
                                                <span className="truncate font-medium leading-5">{option.modelName}</span>
                                                <span className="inline-flex flex-shrink-0 items-center rounded-md bg-warm-muted px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:bg-slate-800 dark:text-stone-300">
                                                    {option.modelKind}
                                                </span>
                                            </span>
                                            <span className="block truncate text-xs font-normal leading-4 text-stone-600 dark:text-stone-400">
                                                {[option.upstreamModel, option.apiShape].filter(Boolean).join(' · ')}
                                            </span>
                                        </span>
                                        <Check
                                            className={cn(
                                                'h-4 w-4 flex-shrink-0 text-slate-700 transition-opacity dark:text-slate-200',
                                                selected ? 'opacity-100' : 'opacity-0',
                                            )}
                                            aria-hidden="true"
                                        />
                                    </ComboboxItem>
                                );
                            })
                        )}
                    </ComboboxList>
                </PopoverContent>
            </Popover>
        </ComboboxProvider>
    );
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function nextProviderAccountPriority(accounts: ModelProviderAccountInfo[]): number {
    if (accounts.length === 0) return 10;
    return Math.max(...accounts.map((account) => account.priority ?? 1000)) + 10;
}

function providerAccountSort(a: ModelProviderAccountInfo, b: ModelProviderAccountInfo): number {
    const priority = (a.priority ?? 1000) - (b.priority ?? 1000);
    if (priority !== 0) return priority;
    return modelProviderAccountIdentity(a).localeCompare(modelProviderAccountIdentity(b));
}

function oauthForProviderAccount(
    rows: ProviderOAuthInfo[],
    providerId: string,
    account?: Pick<ModelProviderAccountInfo, 'id'> | null,
): ProviderOAuthInfo | undefined {
    return rows.find((row) =>
        row.providerId === providerId &&
        (row.accountId ?? '') === (account?.id ?? '')
    );
}

function providerOAuthStatusText(oauth?: ProviderOAuthInfo): string {
    if (!oauth) return 'Not connected';
    if (oauth.status === 'authorized') return oauth.accountLabel ? `Connected: ${oauth.accountLabel}` : 'Connected';
    if (oauth.status === 'pending') return 'Authorization pending';
    if (oauth.status === 'error') return oauth.error ? `Error: ${oauth.error}` : 'Authorization error';
    return 'Not connected';
}

function providerOAuthDisplayName(providerId: string): string {
    if (providerId === 'dreamina') return 'Dreamina';
    return providerId;
}

type SortableProviderKeyRowProps = {
    id: string;
    index: number;
    account: ModelProviderAccountInfo;
    accountLabel: string;
    accountMeta: string;
    expanded: boolean;
    expandedPanel?: ReactNode;
    disabled?: boolean;
    onOpen: () => void;
    onEnabledChange: (checked: boolean) => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    canMoveUp: boolean;
    canMoveDown: boolean;
};

function SortableProviderKeyRow({
    id,
    index,
    account,
    accountLabel,
    accountMeta,
    expanded,
    expandedPanel,
    disabled = false,
    onOpen,
    onEnabledChange,
    onMoveUp,
    onMoveDown,
    canMoveUp,
    canMoveDown,
}: SortableProviderKeyRowProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
    };

    return (
        <li
            ref={setNodeRef}
            style={style}
            className={`overflow-hidden rounded-xl border bg-warm-surface shadow-sm transition-colors ${
                expanded ? 'border-brand/35 ring-2 ring-brand/10' : 'border-warm-border hover:bg-warm-muted/30'
            } ${isDragging ? 'shadow-lg ring-2 ring-brand/25' : ''}`}
        >
            <Collapsible open={expanded}>
                <div className="grid gap-3 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                        <button
                            type="button"
                            aria-label={`Drag ${accountLabel}`}
                            className="flex h-7 w-5 shrink-0 cursor-grab flex-col items-center justify-center gap-1 rounded-md text-stone-400 transition-colors hover:bg-warm-muted hover:text-stone-600 active:cursor-grabbing dark:text-stone-500 dark:hover:text-stone-200"
                            {...attributes}
                            {...listeners}
                        >
                            <span className="h-px w-4 rounded-full bg-current" aria-hidden="true" />
                            <span className="h-px w-4 rounded-full bg-current" aria-hidden="true" />
                        </button>
                        <CollapsibleTrigger asChild>
                            <button
                                type="button"
                                onClick={onOpen}
                                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface"
                            >
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-warm-muted text-xs font-semibold text-stone-500 dark:text-stone-300">
                                    {index + 1}
                                </span>
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                                        {accountLabel}
                                    </span>
                                    <code className="mt-0.5 block font-mono text-xs text-stone-500 dark:text-stone-400">
                                        {accountMeta}
                                    </code>
                                </span>
                            </button>
                        </CollapsibleTrigger>
                    </div>
                    <div className="flex items-center justify-end gap-1 pl-10 sm:pl-0">
                        <button
                            type="button"
                            aria-label={`Move ${accountLabel} up`}
                            disabled={!canMoveUp}
                            onClick={(event) => {
                                event.stopPropagation();
                                onMoveUp();
                            }}
                            className="rounded-md p-1 text-stone-400 transition-colors hover:bg-warm-muted hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:text-stone-200"
                        >
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            aria-label={`Move ${accountLabel} down`}
                            disabled={!canMoveDown}
                            onClick={(event) => {
                                event.stopPropagation();
                                onMoveDown();
                            }}
                            className="rounded-md p-1 text-stone-400 transition-colors hover:bg-warm-muted hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:text-stone-200"
                        >
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <Switch
                            aria-label={`Provider enabled for ${accountLabel}`}
                            checked={account.enabled !== false}
                            disabled={disabled}
                            onCheckedChange={onEnabledChange}
                        />
                        <CollapsibleTrigger asChild>
                            <button
                                type="button"
                                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${accountLabel}`}
                                onClick={onOpen}
                                className="rounded-md p-1 text-stone-400 transition-colors hover:bg-warm-muted hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:text-stone-200"
                            >
                                {expanded ? (
                                    <CaretDown className="h-4 w-4" aria-hidden="true" />
                                ) : (
                                    <CaretRight className="h-4 w-4" aria-hidden="true" />
                                )}
                            </button>
                        </CollapsibleTrigger>
                    </div>
                </div>
                <CollapsibleContent>
                    {expandedPanel && (
                        <div className="border-t border-warm-border" onClick={(event) => event.stopPropagation()}>
                            {expandedPanel}
                        </div>
                    )}
                </CollapsibleContent>
            </Collapsible>
        </li>
    );
}

function createProviderAccountId(providerKey: string): string {
    const prefix = providerKey.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider';
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function modelCardHref(modelId: string): string {
    return `/settings?section=models&model=${encodeURIComponent(modelId)}`;
}

function providerModelsHref(providerKey: string): string {
    return `/settings?section=models&provider=${encodeURIComponent(providerKey)}`;
}

function supportForProvider(
    supports: ProviderSupportRow[],
    provider: Pick<ModelProviderAccountInfo, 'providerId' | 'upstreamId' | 'region'>,
): ProviderSupportRow | undefined {
    return supports.find((support) =>
        support.providerId === provider.providerId &&
        (!provider.upstreamId || support.upstreamId === provider.upstreamId) &&
        (!provider.region || !support.region || support.region === provider.region)
    );
}

function providerIdForModelRoute(route: NonNullable<ModelCatalogEntryInfo['selectedRoute']>): ModelProviderAccountInfo['providerId'] {
    if (route.providerId) return route.providerId;
    if (route.upstreamId === 'openai' || route.upstreamId === 'google' || route.upstreamId === 'anthropic') return 'official';
    if (
        route.upstreamId === 'local' ||
        route.upstreamId === 'mock' ||
        route.upstreamId === 'fal' ||
        route.upstreamId === 'kie' ||
        route.upstreamId === 'replicate' ||
        route.upstreamId === 'kling' ||
        route.upstreamId === 'minimax' ||
        route.upstreamId === 'jimeng' ||
        route.upstreamId === 'volcengine' ||
        route.upstreamId === 'elevenlabs'
    ) {
        return route.upstreamId;
    }
    return 'custom';
}

function modelRouteProviderKey(route: NonNullable<ModelCatalogEntryInfo['selectedRoute']>): string {
    return modelProviderKey({
        providerId: providerIdForModelRoute(route),
        upstreamId: route.upstreamId,
        region: route.region,
    });
}

type ModelProviderLogoId =
    | 'openai'
    | 'anthropic'
    | 'google'
    | 'fal'
    | 'kie'
    | 'replicate'
    | 'kling'
    | 'minimax'
    | 'jimeng'
    | 'volcengine'
    | 'elevenlabs';

function modelProviderLogo(provider: Pick<ModelProviderAccountInfo, 'providerId' | 'upstreamId'>): { id: ModelProviderLogoId; src: string } | null {
    if (provider.providerId === 'official' && provider.upstreamId === 'openai') {
        return { id: 'openai', src: '/brand/providers/openai.svg' };
    }
    if (provider.providerId === 'official' && provider.upstreamId === 'anthropic') {
        return { id: 'anthropic', src: '/brand/providers/anthropic.svg' };
    }
    if (provider.providerId === 'official' && provider.upstreamId === 'google') {
        return { id: 'google', src: '/brand/providers/google.svg' };
    }
    if (provider.providerId === 'fal') {
        return { id: 'fal', src: '/brand/providers/fal.svg' };
    }
    if (provider.providerId === 'kie') {
        return { id: 'kie', src: '/brand/providers/kie.png' };
    }
    if (provider.providerId === 'replicate') {
        return { id: 'replicate', src: '/brand/providers/replicate.svg' };
    }
    if (provider.providerId === 'kling') {
        return { id: 'kling', src: '/brand/providers/kling.svg' };
    }
    if (provider.providerId === 'minimax') {
        return { id: 'minimax', src: '/brand/providers/minimax.svg' };
    }
    if (provider.providerId === 'jimeng') {
        return { id: 'jimeng', src: '/brand/providers/jimeng.svg' };
    }
    if (provider.providerId === 'volcengine') {
        return { id: 'volcengine', src: '/brand/providers/volcengine.svg' };
    }
    if (provider.providerId === 'elevenlabs') {
        return { id: 'elevenlabs', src: '/brand/providers/elevenlabs.svg' };
    }
    return null;
}

interface ModelRoutingSectionProps {
    mode: 'providers' | 'models';
    providers: ModelProviderAccountInfo[];
    providerAccounts: ModelProviderAccountInfo[];
    catalog: ModelCatalogEntryInfo[];
    tierCounts: ReturnType<typeof countModelCatalogTiers>;
    providerOAuth: ProviderOAuthInfo[];
    onStartProviderOAuth: (providerId: string, accountId?: string, accountLabel?: string) => Promise<void>;
    onCompleteProviderOAuth: (providerId: string, deviceCode?: string, accountId?: string) => Promise<void>;
    onPatchProvider: (key: string, patch: Partial<ModelProviderAccountInfo>) => Promise<ModelProviderAccountInfo[]>;
    onPatchProviders: (patches: ModelProviderPatch[]) => Promise<ModelProviderAccountInfo[]>;
    onDeleteProvider: (accountId: string) => Promise<void>;
    saving: boolean;
    error: string | null;
}

function ModelRoutingSection({
    mode,
    providers,
    providerAccounts,
    catalog,
    tierCounts,
    providerOAuth,
    onStartProviderOAuth,
    onCompleteProviderOAuth,
    onPatchProvider,
    onPatchProviders,
    onDeleteProvider,
    saving,
    error,
}: ModelRoutingSectionProps) {
    const feedback = useAppFeedback();
    const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({});
    const [providerTestModelIds, setProviderTestModelIds] = useState<Record<string, string>>({});
    const [providerTestBusyKey, setProviderTestBusyKey] = useState<string | null>(null);
    const [providerTestResults, setProviderTestResults] = useState<Record<string, ModelProviderTestResult>>({});
    const [savingProviderKey, setSavingProviderKey] = useState<string | null>(null);
    const [deletingProviderAccountId, setDeletingProviderAccountId] = useState<string | null>(null);
    const [providerOAuthBusyKey, setProviderOAuthBusyKey] = useState<string | null>(null);
    const [providerQuery, setProviderQuery] = useState('');
    const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(null);
    const [addingProviderKey, setAddingProviderKey] = useState<string | null>(null);
    const [editingProviderAccountKey, setEditingProviderAccountKey] = useState<{ providerKey: string; accountKey: string } | null>(null);
    const [expandedModelProviderOrderId, setExpandedModelProviderOrderId] = useState<string | null>(null);
    const [modelQuery, setModelQuery] = useState('');
    const [modelKindFilter, setModelKindFilter] = useState<'all' | string>('all');
    const [modelProviderFilter, setModelProviderFilter] = useState<'all' | 'ready' | 'missing'>('all');
    const [localAudioConfig, setLocalAudioConfig] = useState<LocalAudioConfig | null>(null);
    const [localAsrBusyModelId, setLocalAsrBusyModelId] = useState<string | null>(null);
    const localAsrConfigVersionRef = useRef(0);
    const providerKeySensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const providerSupports = useMemo(() => listProviderModelSupport({ includeMock: true }), []);
    const showProviders = mode === 'providers';
    const showModels = mode === 'models';
    const [searchParams] = useSearchParams();
    const focusedModelId = showModels ? searchParams.get('model') : null;
    const focusedProviderKey = showModels ? searchParams.get('provider') : null;
    const providerAccountsByKey = useMemo(() => {
        const rows = new Map<string, ModelProviderAccountInfo[]>();
        for (const account of providerAccounts) {
            if (!modelProviderSetup(account)) continue;
            const key = modelProviderKey(account);
            rows.set(key, [...(rows.get(key) ?? []), withCredentialAvailability(account)]);
        }
        for (const [key, accounts] of rows) {
            rows.set(key, [...accounts].sort(providerAccountSort));
        }
        return rows;
    }, [providerAccounts]);
    const commitProviderDraft = useCallback(async (
        key: string,
        setup: NonNullable<ReturnType<typeof modelProviderSetup>>,
        options: { createAccount?: boolean; accountId?: string; label?: string; account?: ModelProviderAccountInfo; priority?: number } = {},
    ) => {
        const draft = providerDrafts[key] ?? {};
        const credentialDrafts = modelProviderCredentialFields(setup)
            .map((credential) => [credential.key, draft.apiKeys?.[credential.key]?.trim() ?? ''] as const)
            .filter(([, value]) => value.length > 0);
        const label = options.label?.trim();
        const hasModelAccessDraft = draft.modelAccessMode !== undefined || draft.supportedModelIds !== undefined;
        const currentModelAccessMode = (options.account?.supportedModelIds ?? []).length > 0 ? 'specific' : 'all';
        const nextModelAccessMode = draft.modelAccessMode ?? currentModelAccessMode;
        const nextSupportedModelIds = nextModelAccessMode === 'all'
            ? []
            : draft.supportedModelIds ?? options.account?.supportedModelIds ?? [];
        const isOAuthAccountDraft = !!setup.oauthProviderId && !!options.createAccount;
        if (credentialDrafts.length === 0 && !draft.baseUrl?.trim() && !label && !hasModelAccessDraft && !isOAuthAccountDraft) return;
        setSavingProviderKey(key);
        try {
            const credentials = Object.fromEntries(credentialDrafts);
            if (setup.baseUrlKey && draft.baseUrl?.trim()) credentials[setup.baseUrlKey] = draft.baseUrl.trim();
            await onPatchProvider(key, {
                ...(options.account?.id ? { id: options.account.id } : {}),
                ...(options.createAccount ? { id: options.accountId ?? createProviderAccountId(key) } : {}),
                ...(options.createAccount ? { enabled: true } : {}),
                ...(options.priority !== undefined ? { priority: options.priority } : {}),
                ...(label ? { label } : {}),
                ...(Object.keys(credentials).length > 0 ? { credentials } : {}),
                ...(hasModelAccessDraft ? { supportedModelIds: nextSupportedModelIds } : {}),
            });
            setProviderDrafts((prev) => ({ ...prev, [key]: {} }));
            return true;
        } catch {
            return false;
        } finally {
            setSavingProviderKey(null);
        }
    }, [onPatchProvider, providerDrafts]);

    const reorderProviderAccounts = useCallback((
        key: string,
        accounts: ModelProviderAccountInfo[],
        event: DragEndEvent,
    ) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const accountIds = accounts.map(modelProviderAccountIdentity);
        const oldIndex = accountIds.indexOf(String(active.id));
        const newIndex = accountIds.indexOf(String(over.id));
        if (oldIndex < 0 || newIndex < 0) return;
        const ordered = arrayMove(accounts, oldIndex, newIndex);
        void onPatchProviders(ordered.map((account, index) => ({
            key,
            patch: {
                ...(account.id ? { id: account.id } : {}),
                ...(account.label ? { label: account.label } : {}),
                priority: (index + 1) * 10,
            },
        })));
    }, [onPatchProviders]);

    const providerViewRows = useMemo(() => providers
        .map((provider) => {
            const key = modelProviderKey(provider);
            const setup = modelProviderSetup(provider);
            const requiredKeys = requiredModelProviderCredentials(provider);
            const credentialFields = setup ? modelProviderCredentialFields(setup) : [];
            const accounts = providerAccountsByKey.get(key) ?? [];
            const accountRows = accounts.length > 0
                ? accounts
                : (provider.configuredCredentials ?? []).length > 0
                    ? [provider]
                    : [];
            const configuredKeys = [...new Set([
                ...(provider.configuredCredentials ?? []),
                ...accountRows.flatMap((account) => account.configuredCredentials ?? []),
            ])].sort();
            const hasBaseUrl = setup?.baseUrlKey ? configuredKeys.includes(setup.baseUrlKey) : false;
            const oauthProviderId = setup?.oauthProviderId;
            const oauth = oauthProviderId
                ? oauthForProviderAccount(providerOAuth, oauthProviderId)
                : undefined;
            const hasRequiredOAuth = oauthProviderId
                ? accountRows.some((account) => account.availableOAuth?.includes(oauthProviderId))
                : false;
            const hasRequiredCredentials = credentialFields.length === 0
                ? accountRows.length > 0
                : setup?.requiresAllCredentials
                    ? accountRows.some((account) => credentialFields.every((credential) =>
                        account.configuredCredentials?.includes(credential.key),
                    ))
                    : accountRows.some((account) => credentialFields.some((credential) =>
                        account.configuredCredentials?.includes(credential.key),
                    ));
            const support = supportForProvider(providerSupports, provider);
            const title = setup?.title ?? modelProviderLabel(provider);
            const searchText = [
                title,
                setup?.description,
                modelProviderLabel(provider),
                support?.models.map((model) => model.name).join(' '),
            ].filter(Boolean).join(' ').toLowerCase();
            return {
                provider,
                key,
                setup,
                requiredKeys,
                configuredKeys,
                accounts: accountRows,
                oauth,
                hasBaseUrl,
                support,
                title,
                searchText,
                configured: oauthProviderId
                    ? hasRequiredOAuth
                    : hasRequiredCredentials,
            };
        })
        .filter((row) => !providerQuery.trim() || row.searchText.includes(providerQuery.trim().toLowerCase()))
        .sort((a, b) => {
            if (a.configured !== b.configured) return a.configured ? -1 : 1;
            return (a.provider.priority ?? 999) - (b.provider.priority ?? 999);
        }), [providerAccountsByKey, providerOAuth, providerQuery, providerSupports, providers]);
	    const readyProviderCount = providerViewRows.filter((row) => row.configured).length;
	    const hostedModelCount = providerViewRows.reduce((count, row) => count + (row.support?.models.length ?? 0), 0);
	    const configuredProviderRows = providerViewRows.filter((row) => row.configured);
	    const availableProviderRows = providerViewRows.filter((row) => !row.configured);
	    const selectedProviderRow = providerViewRows.find((row) => row.key === selectedProviderKey) ?? null;
        const focusedProviderRow = focusedProviderKey
            ? providerViewRows.find((row) => row.key === focusedProviderKey) ?? null
            : null;
        const focusedProviderModelIds = useMemo(
            () => new Set(focusedProviderRow?.support?.models.map((model) => model.id) ?? []),
            [focusedProviderRow],
        );
    useEffect(() => {
        if (!showModels || !catalog.some(isLocalAsrModelEntry)) return;
        let cancelled = false;
        const version = ++localAsrConfigVersionRef.current;
        fetchLocalAudioConfig()
            .then((config) => {
                if (cancelled || localAsrConfigVersionRef.current !== version) return;
                setLocalAudioConfig((prev) => {
                    if (prev?.asr.setup.available && !config.asr.setup.available) return prev;
                    return config;
                });
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [catalog, showModels]);
    const modelKindOptions = useMemo(() => [...new Set(catalog.map((entry) => entry.model.kind))].sort(), [catalog]);
    const modelKindSelectOptions = useMemo<SelectOption<string>[]>(
        () => [
            { value: 'all', label: 'All modalities' },
            ...modelKindOptions.map((kind) => ({ value: kind, label: kind })),
        ],
        [modelKindOptions],
    );
    const modelNeedsProvider = useCallback((entry: ModelCatalogEntryInfo) =>
        !entry.selectedRoute || entry.missingCredentials.length > 0 || entry.tier !== 'available', []);
    const filteredModelCatalog = useMemo(() => catalog
        .filter((entry) => !focusedProviderRow || focusedProviderModelIds.has(entry.model.id))
        .filter((entry) => {
            if (!modelQuery.trim()) return true;
            const text = [
                entry.model.name,
                entry.model.id,
                entry.model.kind,
                entry.candidateProviders.join(' '),
            ].join(' ').toLowerCase();
            return text.includes(modelQuery.trim().toLowerCase());
        })
        .filter((entry) => modelKindFilter === 'all' || entry.model.kind === modelKindFilter)
        .filter((entry) => {
            if (modelProviderFilter === 'ready') return !modelNeedsProvider(entry);
            if (modelProviderFilter === 'missing') return modelNeedsProvider(entry);
            return true;
        }), [catalog, focusedProviderModelIds, focusedProviderRow, modelKindFilter, modelProviderFilter, modelNeedsProvider, modelQuery]);
    useEffect(() => {
        if (!showModels || !focusedModelId) return;
        const frame = window.requestAnimationFrame(() => {
            document.getElementById(`model-card-${focusedModelId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [focusedModelId, showModels, filteredModelCatalog.length]);
    const deployLocalAsrModel = useCallback(async (entry: ModelCatalogEntryInfo) => {
        const asrModel = asrModelValue(entry);
        localAsrConfigVersionRef.current += 1;
        setLocalAsrBusyModelId(entry.model.id);
        try {
            const res = await fetch(runtimeApiUrl('/api/v1/local/audio/install'), {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ asr_model: asrModel }),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => null) as { error?: string } | null;
                throw new Error(json?.error ?? `HTTP ${res.status}`);
            }
            const config = (await res.json()) as LocalAudioConfig;
            setLocalAudioConfig(config);
            feedback.notify({
                variant: 'success',
                title: 'Local ASR model deployed',
            });
        } catch (err) {
            feedback.notify({
                variant: 'error',
                title: 'Could not deploy local ASR model',
                message: displayErrorMessage(err),
            });
        } finally {
            setLocalAsrBusyModelId(null);
        }
    }, [feedback]);
    const renderModelCard = (entry: ModelCatalogEntryInfo) => {
        const needsProvider = modelNeedsProvider(entry);
        const focused = focusedModelId === entry.model.id;
        const route = entry.selectedRoute;
        const selectedRouteKey = route ? modelRouteProviderKey(route) : null;
        const routeOrder = new Map(entry.routes.map((candidate, index) => [modelRouteProviderKey(candidate), index]));
        const modelOrderAccounts = (row: typeof providerViewRows[number]) => (
            row.accounts.length > 0
                ? row.accounts.filter((account) =>
                    !account.supportedModelIds?.length || account.supportedModelIds.includes(entry.model.id),
                )
                : [row.provider]
        );
        const providerRowModelPriority = (row: typeof providerViewRows[number]) => {
            const priorities = modelOrderAccounts(row)
                .map((account) => account.modelPriorities?.[entry.model.id])
                .filter((priority): priority is number => typeof priority === 'number' && Number.isFinite(priority));
            return priorities.length ? Math.min(...priorities) : undefined;
        };
        const providerOrderRows = providerViewRows
            .filter((row) => (
                row.support?.models.some((model) => model.id === entry.model.id) &&
                modelOrderAccounts(row).length > 0
            ))
            .sort((a, b) => {
                const aModelPriority = providerRowModelPriority(a);
                const bModelPriority = providerRowModelPriority(b);
                if (aModelPriority !== undefined || bModelPriority !== undefined) {
                    const priority = (aModelPriority ?? Number.POSITIVE_INFINITY) - (bModelPriority ?? Number.POSITIVE_INFINITY);
                    if (priority !== 0) return priority;
                }
                const aRouteIndex = routeOrder.get(a.key) ?? Number.POSITIVE_INFINITY;
                const bRouteIndex = routeOrder.get(b.key) ?? Number.POSITIVE_INFINITY;
                if (aRouteIndex !== bRouteIndex) return aRouteIndex - bRouteIndex;
                if (a.configured !== b.configured) return a.configured ? -1 : 1;
                const aWeight = a.accounts[0]?.weight ?? a.provider.weight ?? 0;
                const bWeight = b.accounts[0]?.weight ?? b.provider.weight ?? 0;
                if (aWeight !== bWeight) return bWeight - aWeight;
                return (a.provider.priority ?? 999) - (b.provider.priority ?? 999);
            });
        const providerOrderOpen = expandedModelProviderOrderId === entry.model.id;
        const moveModelProvider = (fromIndex: number, toIndex: number) => {
            if (saving) return;
            if (toIndex < 0 || toIndex >= providerOrderRows.length) return;
            const ordered = arrayMove(providerOrderRows, fromIndex, toIndex);
            void onPatchProviders(ordered.flatMap((providerRow, index) => {
                const priority = (index + 1) * 10;
                const targets = modelOrderAccounts(providerRow);
                return targets.map((account) => ({
                    key: providerRow.key,
                    patch: {
                        ...(account.id ? { id: account.id } : {}),
                        ...(account.label ? { label: account.label } : {}),
                        modelPriorities: {
                            ...(account.modelPriorities ?? {}),
                            [entry.model.id]: priority,
                        },
                    },
                }));
            }));
        };
        const localAsr = isLocalAsrModelEntry(entry);
        const localAsrModel = asrModelValue(entry);
        const localAsrBusy = localAsrBusyModelId === entry.model.id;
        const localAsrDeployed = localAsr && localAudioConfig?.asr.setup.available === true && localAudioConfig.asr.model === localAsrModel;
        const routeLabel = route
            ? `${route.providerId ?? route.upstreamId}/${route.upstreamId}`
            : entry.candidateProviders.length > 0
                ? entry.candidateProviders.join(', ')
                : 'No provider';
        return (
            <div
                key={entry.model.id}
                id={`model-card-${entry.model.id}`}
                className={`rounded-xl border bg-warm-surface p-4 transition-colors ${
                    focused
                        ? 'border-brand/45 bg-brand-light/35 ring-2 ring-brand/15'
                        : 'border-warm-border'
                }`}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{entry.model.name}</span>
                            <span className="rounded-full bg-warm-muted px-2 py-0.5 text-[10px] font-medium text-stone-600 dark:text-stone-300">
                                {entry.model.kind}
                            </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">{entry.model.id}</p>
                    </div>
                </div>
                <div className="mt-3 text-xs text-stone-500 dark:text-stone-400">
                    {needsProvider
                        ? `Provider not configured: ${entry.missingCredentials.length > 0 ? 'credential required' : routeLabel}`
                        : `Provider ready: ${routeLabel}`}
                </div>
                {providerOrderRows.length > 1 && (
                    <div className="mt-3 border-t border-warm-border pt-3">
                        <button
                            type="button"
                            aria-label={`Edit provider order for ${entry.model.name}`}
                            onClick={() => setExpandedModelProviderOrderId((current) => current === entry.model.id ? null : entry.model.id)}
                            className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-warm-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                        >
                            <span className="text-xs font-semibold text-slate-900 dark:text-slate-50">Provider order</span>
                            <span className="flex min-w-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                                <span className="truncate">{providerOrderRows.map((row) => row.title).join(', ')}</span>
                                {providerOrderOpen ? (
                                    <CaretDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                ) : (
                                    <CaretRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                )}
                            </span>
                        </button>
                        {providerOrderOpen && (
                            <ul aria-label={`${entry.model.name} provider order`} className="mt-2 overflow-hidden rounded-xl border border-warm-border bg-warm-muted/20">
                                {providerOrderRows.map((providerRow, index) => {
                                    const isCurrent = providerRow.key === selectedRouteKey;
                                    return (
                                        <li
                                            key={providerRow.key}
                                            className="grid gap-3 border-b border-warm-border px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                                        >
                                            <div className="flex min-w-0 items-center gap-3">
                                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-warm-surface text-xs font-semibold text-stone-500 dark:text-stone-300">
                                                    {index + 1}
                                                </span>
                                                {renderProviderIcon(providerRow.provider, providerRow.title)}
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                                                            {providerRow.title}
                                                        </span>
                                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                                            isCurrent
                                                                ? 'bg-brand-light text-brand-dark'
                                                                : providerRow.configured
                                                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                                                                    : 'bg-warm-surface text-stone-500 dark:text-stone-300'
                                                        }`}>
                                                            {isCurrent ? 'Current' : providerRow.configured ? 'Ready' : 'Needs key'}
                                                        </span>
                                                    </div>
                                                    <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
                                                        {modelProviderLabel(providerRow.provider)}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex justify-end gap-1 pl-9 sm:pl-0">
                                                <button
                                                    type="button"
                                                    aria-label={`Move ${providerRow.title} up for ${entry.model.name}`}
                                                    disabled={saving || index === 0}
                                                    onClick={() => moveModelProvider(index, index - 1)}
                                                    className="rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-warm-surface hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35 dark:text-stone-300 dark:hover:text-slate-50"
                                                >
                                                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                                                </button>
                                                <button
                                                    type="button"
                                                    aria-label={`Move ${providerRow.title} down for ${entry.model.name}`}
                                                    disabled={saving || index === providerOrderRows.length - 1}
                                                    onClick={() => moveModelProvider(index, index + 1)}
                                                    className="rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-warm-surface hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35 dark:text-stone-300 dark:hover:text-slate-50"
                                                >
                                                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                                                </button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                )}
                {localAsr && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-warm-border pt-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-slate-900 dark:text-slate-50">Local deploy</span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                    localAsrBusy
                                        ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300'
                                        : localAsrDeployed
                                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                                            : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                                }`}>
                                    {localAsrBusy ? 'Deploying' : localAsrDeployed ? 'Deployed' : 'Not deployed'}
                                </span>
                            </div>
                            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Uses local model cache.</p>
                        </div>
                        {!localAsrDeployed && (
                            <button
                                type="button"
                                aria-label="Deploy local ASR model"
                                disabled={localAsrBusy}
                                onClick={() => { void deployLocalAsrModel(entry); }}
                                className={settingsCompactSecondaryButtonClass}
                            >
                                {localAsrBusy ? 'Deploying...' : 'Deploy'}
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    };
    const renderProviderIcon = (provider: Pick<ModelProviderAccountInfo, 'providerId' | 'upstreamId'>, title: string) => {
        const logo = modelProviderLogo(provider);
        if (!logo) {
            return (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-warm-border bg-warm-surface text-xs font-bold text-brand shadow-sm">
                    {title.slice(0, 2).toUpperCase()}
                </span>
            );
        }
        return (
            <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-warm-border bg-white p-1.5 shadow-sm dark:bg-white"
                title={`${title} logo`}
            >
                <img
                    src={logo.src}
                    alt=""
                    aria-hidden="true"
                    data-provider-logo={logo.id}
                    draggable={false}
                    className="h-full w-full object-contain"
                />
            </span>
        );
    };
    const providerCredentialAccountCount = (row: typeof providerViewRows[number]) => {
        const setup = row.setup;
        const credentialFields = setup ? modelProviderCredentialFields(setup) : [];
        if (credentialFields.length === 0 && row.accounts.length > 0) return row.accounts.length;
        const credentialAccounts = row.accounts.filter((account) =>
            credentialFields.some((credential) => account.configuredCredentials?.includes(credential.key)),
        );
        if (credentialAccounts.length > 0) return credentialAccounts.length;
        return row.configuredKeys.length > 0 ? 1 : 0;
    };

    const providerStatusLabel = (row: typeof providerViewRows[number]) => {
        if (row.oauth?.status === 'pending') return 'Pending';
        if (!row.configured) return 'Not configured';
        if (row.setup?.oauthProviderId) {
            const oauthProviderId = row.setup.oauthProviderId;
            const accountCount = row.accounts.filter((account) =>
                account.availableOAuth?.includes(oauthProviderId),
            ).length || row.accounts.length || 1;
            return `${accountCount} account${accountCount === 1 ? '' : 's'}`;
        }
        const keyCount = providerCredentialAccountCount(row) || 1;
        return `${keyCount} key${keyCount === 1 ? '' : 's'}`;
    };

    const renderProviderRow = (row: typeof providerViewRows[number]) => {
        const statusLabel = providerStatusLabel(row);
        return (
            <li key={row.key} className="border-b border-warm-border last:border-b-0">
                <button
                    type="button"
                    aria-label={`Open ${row.title} BYOK settings`}
                    onClick={() => setSelectedProviderKey(row.key)}
                    className="grid w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-warm-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                    <span className="flex min-w-0 items-center gap-3">
                        {renderProviderIcon(row.provider, row.title)}
                        <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{row.title}</span>
                    </span>
                    <span className="flex shrink-0 items-center justify-between gap-2 pl-12 text-sm text-stone-500 dark:text-stone-400 sm:justify-end sm:pl-0">
                        <span>{statusLabel}</span>
                        <CaretRight className="h-4 w-4 text-stone-400" aria-hidden="true" />
                    </span>
                </button>
            </li>
        );
    };

    const renderProviderDetail = (row: typeof providerViewRows[number]) => {
        const draft = providerDrafts[row.key] ?? {};
        const setup = row.setup;
        if (!setup) return null;
        const credentialFields = modelProviderCredentialFields(setup);
        const oauthProviderId = setup.oauthProviderId;
        const supportedModelsHref = row.support?.models.length
            ? providerModelsHref(row.key)
            : '/settings?section=models';
        const setupCredentialKeys = new Set([
            ...credentialFields.map((credential) => credential.key),
            ...(setup.baseUrlKey ? [setup.baseUrlKey] : []),
        ]);
        const configuredAccounts = row.accounts.filter((account) =>
            (account.configuredCredentials ?? []).some((credentialKey) => setupCredentialKeys.has(credentialKey)),
        );
        const savedAccounts = (oauthProviderId
            ? row.accounts
            : credentialFields.length === 0
                ? row.accounts
                : configuredAccounts.length > 0
                    ? configuredAccounts
                    : row.configuredKeys.some((credentialKey) => setupCredentialKeys.has(credentialKey))
                        ? [row.provider]
                        : []
        ).sort(providerAccountSort);
        const editingAccountKey = editingProviderAccountKey?.providerKey === row.key ? editingProviderAccountKey.accountKey : null;
        const editingAccount = editingAccountKey
            ? savedAccounts.find((account) => modelProviderAccountIdentity(account) === editingAccountKey) ?? null
            : null;
        const editingAccountIndex = editingAccount
            ? savedAccounts.findIndex((account) => modelProviderAccountIdentity(account) === modelProviderAccountIdentity(editingAccount))
            : -1;
        const editingAccountLabel = editingAccount
            ? editingAccount.label ?? `API key ${editingAccountIndex + 1}`
            : null;
        const isAddingPrioritizedKey = addingProviderKey === row.key;
        const newKeyNumber = savedAccounts.length + 1;
        const hasCredentialDraft = credentialFields.some((credential) => draft.apiKeys?.[credential.key]?.trim()) || !!draft.baseUrl?.trim();
        const editingSupportedModelIds = editingAccount?.supportedModelIds ?? [];
        const editingModelAccessMode: 'all' | 'specific' = editingSupportedModelIds.length > 0 ? 'specific' : 'all';
        const draftSupportedModelIds = draft.supportedModelIds ?? editingSupportedModelIds;
        const modelAccessMode: 'all' | 'specific' = draft.modelAccessMode ?? editingModelAccessMode;
        const hasModelAccessDraft = (
            draft.modelAccessMode !== undefined && draft.modelAccessMode !== editingModelAccessMode
        ) || (
            draft.supportedModelIds !== undefined && !sameStringArray(draft.supportedModelIds, editingSupportedModelIds)
        );
        const hasProviderDraft = hasCredentialDraft || (!!editingAccount && !!draft.label?.trim()) || hasModelAccessDraft || (isAddingPrioritizedKey && !!oauthProviderId);
        const providerTestKey = editingAccount ? modelProviderAccountIdentity(editingAccount) : `new:${row.key}`;
        const selectedSupportedModelIds = new Set(draftSupportedModelIds);
        const modelAccessInvalid = modelAccessMode === 'specific' && draftSupportedModelIds.length === 0;
        const clearProviderTestResult = () => setProviderTestResults((prev) => {
            if (!(providerTestKey in prev)) return prev;
            const { [providerTestKey]: _result, ...rest } = prev;
            return rest;
        });
        const updateProviderDraft = (patch: Partial<ProviderDraft>) => {
            clearProviderTestResult();
            setProviderDrafts((prev) => ({
                ...prev,
                [row.key]: {
                    ...prev[row.key],
                    ...patch,
                },
            }));
        };
        const updateCredentialDraft = (credentialKey: string, value: string) => {
            clearProviderTestResult();
            setProviderDrafts((prev) => ({
                ...prev,
                [row.key]: {
                    ...prev[row.key],
                    apiKeys: {
                        ...prev[row.key]?.apiKeys,
                        [credentialKey]: value,
                    },
                },
            }));
        };
        const setSupportedModelIdsDraft = (ids: string[]) => updateProviderDraft({ modelAccessMode: 'specific', supportedModelIds: ids });
        const clearProviderDraft = () => setProviderDrafts((prev) => ({ ...prev, [row.key]: {} }));
        const closeProviderKeyEditor = () => {
            setAddingProviderKey(null);
            setEditingProviderAccountKey(null);
            clearProviderDraft();
        };
        const openPrioritizedKeyEditor = () => {
            setEditingProviderAccountKey(null);
            setProviderDrafts((prev) => ({
                ...prev,
                [row.key]: oauthProviderId ? { accountId: createProviderAccountId(row.key) } : {},
            }));
            setAddingProviderKey(row.key);
            if (credentialFields.length > 0) {
                window.setTimeout(() => {
                    document.querySelector<HTMLInputElement>('[data-provider-key-input="true"]')?.focus();
                }, 0);
            }
        };
        const openExistingKeyEditor = (account: ModelProviderAccountInfo) => {
            setAddingProviderKey(null);
            clearProviderDraft();
            setEditingProviderAccountKey({ providerKey: row.key, accountKey: modelProviderAccountIdentity(account) });
        };
        const saveDraft = async () => {
            if (!setup || !hasProviderDraft) return false;
            const createAccount = isAddingPrioritizedKey;
            if (isAddingPrioritizedKey && !hasCredentialDraft && !oauthProviderId) return false;
            if (modelAccessInvalid) return false;
            const saved = await commitProviderDraft(row.key, setup, {
                createAccount,
                accountId: draft.accountId,
                account: editingAccount ?? undefined,
                priority: createAccount ? nextProviderAccountPriority(savedAccounts) : undefined,
                label: isAddingPrioritizedKey
                    ? createAccount ? (draft.label?.trim() || (oauthProviderId ? `${row.title} account ${newKeyNumber}` : undefined)) : draft.label?.trim()
                    : draft.label?.trim(),
            });
            if (saved) {
                setAddingProviderKey((prev) => (prev === row.key ? null : prev));
                if (isAddingPrioritizedKey) {
                    setEditingProviderAccountKey((prev) => (prev?.providerKey === row.key ? null : prev));
                }
            }
            return saved;
        };
        const moveSavedAccount = (fromIndex: number, toIndex: number) => {
            if (toIndex < 0 || toIndex >= savedAccounts.length) return;
            const ordered = arrayMove(savedAccounts, fromIndex, toIndex);
            void onPatchProviders(ordered.map((account, index) => ({
                key: row.key,
                patch: {
                    ...(account.id ? { id: account.id } : {}),
                    ...(account.label ? { label: account.label } : {}),
                    priority: (index + 1) * 10,
                },
            })));
        };
        const accountNoun = oauthProviderId ? 'account' : 'API key';
        const editorTitle = editingAccountLabel ?? (oauthProviderId ? 'New account' : 'New key');
        const editorNumber = editingAccount ? editingAccountIndex + 1 : newKeyNumber;
        const editorAriaLabel = editingAccountLabel
            ? `${editingAccountLabel} ${row.title} ${accountNoun}`
            : `New ${row.title} ${accountNoun}`;
        const allProviderModels = [...new Map((row.support?.models ?? []).map((model) => [model.id, model])).values()];
        const allProviderModelOptions = allProviderModels.map<ProviderTestModelOption>((model) => {
            const description = [model.upstreamModel, model.apiShape].filter(Boolean).join(' · ');
            const option: ProviderTestModelOption = {
                value: model.id,
                modelName: model.name,
                modelKind: model.kind,
                upstreamModel: model.upstreamModel,
                apiShape: model.apiShape,
                label: '',
                description,
            };
            option.label = providerTestModelOptionLabel(option);
            return option;
        });
        const supportedModelOptions = allProviderModels
            .filter((model) => !selectedSupportedModelIds.has(model.id))
            .map<SelectOption<string>>((model) => ({
            value: model.id,
            label: model.name,
            description: model.id,
        }));
        const providerTestOptions = allProviderModelOptions.filter((option) =>
            modelAccessMode !== 'specific' || selectedSupportedModelIds.has(option.value),
        );
        const selectedSupportedModels = draftSupportedModelIds
            .map((id) => allProviderModels.find((model) => model.id === id))
            .filter((model): model is NonNullable<typeof row.support>['models'][number] => !!model);
        const defaultProviderTestModelId = providerTestOptions.find((option) => option.value === 'nano-banana-2')?.value ?? providerTestOptions[0]?.value ?? '';
        const selectedProviderTestModelId = providerTestOptions.some((option) => option.value === providerTestModelIds[providerTestKey])
            ? providerTestModelIds[providerTestKey]
            : defaultProviderTestModelId;
        const providerTestResult = providerTestResults[providerTestKey];
        const canRunProviderTest = !!editingAccount && providerTestOptions.length > 0;
        const providerTestDisabled = providerTestBusyKey === providerTestKey || !selectedProviderTestModelId || hasProviderDraft || saving;
        const editingOAuth = oauthProviderId && editingAccount
            ? oauthForProviderAccount(providerOAuth, oauthProviderId, editingAccount)
            : undefined;
        const editingOAuthBusyKey = oauthProviderId && editingAccount?.id ? `${oauthProviderId}:${editingAccount.id}` : null;
        const editingOAuthBusy = editingOAuthBusyKey ? providerOAuthBusyKey === editingOAuthBusyKey : false;
        const runProviderTest = async () => {
            if (!canRunProviderTest || providerTestDisabled || !editingAccount || !selectedProviderTestModelId) return;
            setProviderTestBusyKey(providerTestKey);
            try {
                const result = await testModelProvider({
                    provider: editingAccount,
                    modelId: selectedProviderTestModelId,
                });
                setProviderTestResults((prev) => ({ ...prev, [providerTestKey]: result }));
            } catch (err) {
                setProviderTestResults((prev) => ({
                    ...prev,
                    [providerTestKey]: {
                        ok: false,
                        providerId: editingAccount.providerId,
                        ...(editingAccount.upstreamId ? { upstreamId: editingAccount.upstreamId } : {}),
                        ...(editingAccount.region ? { region: editingAccount.region } : {}),
                        modelId: selectedProviderTestModelId,
                        message: displayErrorMessage(err),
                    },
                }));
            } finally {
                setProviderTestBusyKey(null);
            }
        };
        const canDeleteAccount = !!editingAccount?.id;
        const deleteSavedAccount = async () => {
            if (!editingAccount?.id) return;
            setDeletingProviderAccountId(editingAccount.id);
            try {
                await onDeleteProvider(editingAccount.id);
                setProviderTestResults((prev) => {
                    const { [providerTestKey]: _result, ...rest } = prev;
                    return rest;
                });
                closeProviderKeyEditor();
            } finally {
                setDeletingProviderAccountId(null);
            }
        };
        const renderProviderKeyEditor = ({ includeHeader }: { includeHeader: boolean }) => (
            <div
                role="group"
                aria-label={editorAriaLabel}
                className={includeHeader ? "overflow-hidden rounded-xl border border-warm-border bg-warm-surface shadow-sm" : "bg-warm-surface"}
            >
                {includeHeader && (
                    <div className="flex items-center justify-between gap-3 border-b border-warm-border px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-warm-muted text-xs font-semibold text-stone-500 dark:text-stone-300">
                                {editorNumber}
                            </span>
                            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                                {editorTitle}
                            </span>
                        </div>
                        <button
                            type="button"
                            aria-label={`Collapse ${editorTitle}`}
                            onClick={closeProviderKeyEditor}
                            className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-warm-muted hover:text-stone-700 dark:hover:text-stone-200"
                        >
                            <CaretDown className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>
                )}
                <div className="space-y-4 px-4 py-4">
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">Name (optional)</span>
                        <input
                            aria-label={`${row.title} ${oauthProviderId ? 'account' : 'key'} name`}
                            type="text"
                            value={draft.label ?? ''}
                            onChange={(e) => updateProviderDraft({ label: e.target.value })}
                            placeholder={editingAccountLabel ?? 'e.g. Production, Team A'}
                            className={settingsFieldClass}
                        />
                    </label>
                    {credentialFields.map((credential, index) => (
                        <label key={credential.key} className="block">
                            <span className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">{credential.label}</span>
                            <span className="relative block">
                                <input
                                    aria-label={credential.ariaLabel ?? `${setup.title} ${credential.label}`}
                                    type="password"
                                    value={draft.apiKeys?.[credential.key] ?? ''}
                                    onChange={(e) => updateCredentialDraft(credential.key, e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            void saveDraft();
                                        }
                                    }}
                                    placeholder={editingAccount ? 'Saved credential' : credential.placeholder ?? (index === 0 && savedAccounts.length > 0 ? 'Paste another API key' : 'Paste API key')}
                                    autoComplete="new-password"
                                    data-provider-key-input={index === 0 ? 'true' : undefined}
                                    className={`${settingsFieldClass} pr-10`}
                                />
                                <Eye className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
                            </span>
                        </label>
                    ))}
                    {setup.baseUrlKey && (
                        <label className="block">
                            <span className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">Base URL</span>
                            <input
                                aria-label={`${setup.title} base URL`}
                                type="url"
                                value={draft.baseUrl ?? ''}
                                onChange={(e) => updateProviderDraft({ baseUrl: e.target.value })}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        void saveDraft();
                                    }
                                }}
                                placeholder={row.hasBaseUrl ? 'Saved base URL' : setup.baseUrlPlaceholder}
                                className={settingsFieldClass}
                            />
                        </label>
                    )}
                    {oauthProviderId && editingAccount?.id && (
                        <div className="rounded-xl border border-warm-border bg-warm-muted/20 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-50">Authorization</div>
                                    <p className="mt-1 text-xs font-medium text-stone-500 dark:text-stone-400">
                                        {providerOAuthStatusText(editingOAuth)}
                                    </p>
                                    {editingOAuth?.verificationUri && (
                                        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                                            Open {editingOAuth.verificationUri}{editingOAuth.userCode ? ` and enter ${editingOAuth.userCode}` : ''}.
                                        </p>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        disabled={editingOAuthBusy}
                                        onClick={async () => {
                                            if (!editingOAuthBusyKey || !editingAccount.id) return;
                                            setProviderOAuthBusyKey(editingOAuthBusyKey);
                                            try {
                                                await onStartProviderOAuth(
                                                    oauthProviderId,
                                                    editingAccount.id,
                                                    draft.label?.trim() || editingAccount.label,
                                                );
                                            } finally {
                                                setProviderOAuthBusyKey(null);
                                            }
                                        }}
                                        className={settingsCompactSecondaryButtonClass}
                                    >
                                        {editingOAuth?.status === 'pending' ? 'Restart authorization' : editingOAuth?.status === 'authorized' ? 'Reconnect' : 'Connect'}
                                    </button>
                                    {editingOAuth?.status === 'pending' && (
                                        <button
                                            type="button"
                                            disabled={editingOAuthBusy}
                                            onClick={async () => {
                                                if (!editingOAuthBusyKey || !editingAccount.id) return;
                                                setProviderOAuthBusyKey(editingOAuthBusyKey);
                                                try {
                                                    await onCompleteProviderOAuth(oauthProviderId, editingOAuth.deviceCode, editingAccount.id);
                                                } finally {
                                                    setProviderOAuthBusyKey(null);
                                                }
                                            }}
                                            className={settingsSmallPrimaryButtonClass}
                                        >
                                            Complete
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    {oauthProviderId && !editingAccount && (
                        <div className="rounded-xl border border-warm-border bg-warm-muted/20 p-3 text-xs font-medium text-stone-500 dark:text-stone-400">
                            Save this account before starting authorization.
                        </div>
                    )}
                    {allProviderModelOptions.length > 0 && (
                        <div className="rounded-xl border border-warm-border bg-warm-muted/20 p-3">
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-start">
                                <div className="min-w-0">
                                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-50">Model access</div>
                                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                                        Choose which supported model cards this account can serve.
                                    </p>
                                </div>
                                <SelectMenu
                                    value={modelAccessMode}
                                    options={MODEL_ACCESS_OPTIONS}
                                    onValueChange={(value) => {
                                        updateProviderDraft({
                                            modelAccessMode: value,
                                            supportedModelIds: value === 'specific' ? [...draftSupportedModelIds] : [],
                                        });
                                    }}
                                    ariaLabel="Model access"
                                    variant="field"
                                    triggerClassName={settingsSelectTriggerClass}
                                    menuWidth="trigger"
                                />
                            </div>
                            {modelAccessMode === 'specific' && (
                                <div className="mt-3 space-y-3">
                                    {selectedSupportedModels.length > 0 ? (
                                        <div className="flex flex-wrap gap-2">
                                            {selectedSupportedModels.map((model) => (
                                                <span
                                                    key={model.id}
                                                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-warm-border bg-warm-surface px-2.5 py-1 text-xs font-medium text-slate-800 dark:text-slate-100"
                                                >
                                                    <span className="truncate">{model.name}</span>
                                                    <button
                                                        type="button"
                                                        aria-label={`Remove ${model.name}`}
                                                        onClick={() => setSupportedModelIdsDraft(draftSupportedModelIds.filter((id) => id !== model.id))}
                                                        className="rounded p-0.5 text-stone-400 transition-colors hover:bg-warm-muted hover:text-slate-700 dark:hover:text-slate-100"
                                                    >
                                                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                                            Add at least one model before saving this restriction.
                                        </p>
                                    )}
                                    <SupportedModelPicker
                                        options={supportedModelOptions}
                                        onSelect={(value) => setSupportedModelIdsDraft([...draftSupportedModelIds, value])}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                    {canRunProviderTest && (
                        <div className="rounded-xl border border-warm-border bg-warm-muted/25 p-3">
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                                <div className="min-w-0">
                                    <span className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">Model to test</span>
                                    <ProviderTestModelPicker
                                        value={selectedProviderTestModelId}
                                        options={providerTestOptions}
                                        onValueChange={(value) => {
                                            setProviderTestModelIds((prev) => ({ ...prev, [providerTestKey]: String(value) }));
                                            setProviderTestResults((prev) => {
                                                const { [providerTestKey]: _result, ...rest } = prev;
                                                return rest;
                                            });
                                        }}
                                    />
                                </div>
                                <button
                                    type="button"
                                    aria-label="Run provider test"
                                    disabled={providerTestDisabled}
                                    onClick={() => { void runProviderTest(); }}
                                    className={settingsCompactSecondaryButtonClass}
                                >
                                    {providerTestBusyKey === providerTestKey ? 'Testing...' : 'Run test'}
                                </button>
                            </div>
                            {providerTestResult && (
                                <div className="mt-3 space-y-3">
                                    <p
                                        className={`text-xs font-medium ${
                                            providerTestResult.ok
                                                ? 'text-emerald-700 dark:text-emerald-300'
                                                : 'text-amber-700 dark:text-amber-300'
                                        }`}
                                    >
                                        {providerTestResult.message}
                                    </p>
                                    {(providerTestResult.input || providerTestResult.output) && (
                                        <div className="grid gap-3 lg:grid-cols-2">
                                            {providerTestResult.input && (
                                                <div className="min-w-0">
                                                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Input</div>
                                                    <pre
                                                        aria-label="Provider test input"
                                                        className={`${settingsCodeBlockClass} whitespace-pre-wrap break-words text-xs leading-5`}
                                                    >
                                                        {formatProviderTestPayload(providerTestResult.input)}
                                                    </pre>
                                                </div>
                                            )}
                                            {providerTestResult.output && (
                                                <div className="min-w-0">
                                                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Output</div>
                                                    <pre
                                                        aria-label="Provider test output"
                                                        className={`${settingsCodeBlockClass} whitespace-pre-wrap break-words text-xs leading-5`}
                                                    >
                                                        {formatProviderTestPayload(providerTestResult.output)}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {(includeHeader || hasProviderDraft || savingProviderKey === row.key || canDeleteAccount) && (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                {canDeleteAccount && (
                                    <button
                                        type="button"
                                        onClick={() => { void deleteSavedAccount(); }}
                                        disabled={deletingProviderAccountId === editingAccount?.id || saving}
                                        className={settingsDangerGhostButtonClass}
                                    >
                                        <Trash className="h-4 w-4" aria-hidden="true" />
                                        {deletingProviderAccountId === editingAccount?.id ? 'Removing...' : 'Remove key'}
                                    </button>
                                )}
                            </div>
                            <div className="flex justify-end gap-2">
                                {includeHeader && (
                                    <button
                                        type="button"
                                        onClick={closeProviderKeyEditor}
                                        className={settingsCompactSecondaryButtonClass}
                                    >
                                        Cancel
                                    </button>
                                )}
                                {(hasProviderDraft || savingProviderKey === row.key) && (
                                    <button
                                        type="button"
                                        onClick={() => { void saveDraft(); }}
                                        disabled={modelAccessInvalid || savingProviderKey === row.key || saving}
                                        className={settingsSmallPrimaryButtonClass}
                                    >
                                        {savingProviderKey === row.key ? 'Saving...' : 'Save'}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
        return (
            <div className="space-y-6">
                <div className="border-b border-warm-border pb-6">
                    <button
                        type="button"
                        aria-label="Back to BYOK"
                        onClick={() => {
                            setSelectedProviderKey(null);
                            setAddingProviderKey(null);
                            setEditingProviderAccountKey(null);
                        }}
                        className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-stone-500 transition-colors hover:text-slate-950 dark:text-stone-300 dark:hover:text-slate-50"
                    >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        <span>BYOK</span>
                        <CaretRight className="h-3.5 w-3.5 text-stone-400" aria-hidden="true" />
                        <span className="text-slate-900 dark:text-slate-50">{row.title}</span>
                    </button>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                            {renderProviderIcon(row.provider, row.title)}
                            <div className="min-w-0">
                                <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-50">
                                    {row.title}
                                </h2>
                                <Link
                                    to={supportedModelsHref}
                                    aria-label="View supported models"
                                    className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 transition-colors hover:text-brand dark:text-stone-300 dark:hover:text-brand-light"
                                >
                                    View supported models
                                    <CaretRight className="h-3.5 w-3.5" aria-hidden="true" />
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>

                {setup && (
                    <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
                        <aside className="text-sm text-stone-500 dark:text-stone-400">
                            <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-50">
                                <Key className="h-4 w-4" aria-hidden="true" />
                                <span>{oauthProviderId ? 'Provider Accounts' : 'Provider Keys'}</span>
                            </div>
                            <p className="mt-3 leading-7">
                                {oauthProviderId
                                    ? 'Add and authorize provider accounts. Drag an account by its handle to reorder priority.'
                                    : 'Add and configure your API keys. Drag a key by its handle to reorder priority.'}
                            </p>
                        </aside>
                        <div className="space-y-9">
                            <section className="space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Prioritized</h3>
                                        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                                            Attempted in order, before falling back to Clash-hosted endpoints.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        aria-label={`Add prioritized ${row.title} ${oauthProviderId ? 'account' : 'key'}`}
                                        onClick={openPrioritizedKeyEditor}
                                        className={`${settingsCompactSecondaryButtonClass} gap-1.5`}
                                    >
                                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                        {oauthProviderId ? 'Add account' : 'Add key'}
                                    </button>
                                </div>
                            <div className="space-y-3">
                                {savedAccounts.length > 0 && (
                                    <DndContext
                                        sensors={providerKeySensors}
                                        collisionDetection={closestCenter}
                                        modifiers={[restrictToVerticalAxis]}
                                        onDragEnd={(event) => reorderProviderAccounts(row.key, savedAccounts, event)}
                                    >
                                        <SortableContext
                                            items={savedAccounts.map(modelProviderAccountIdentity)}
                                            strategy={verticalListSortingStrategy}
                                        >
                                            <ul aria-label={`${row.title} prioritized ${oauthProviderId ? 'accounts' : 'keys'}`} className="space-y-2">
                                                {savedAccounts.map((account, index) => {
                                                    const accountKey = modelProviderAccountIdentity(account);
                                                    const accountLabel = account.label ?? `${oauthProviderId ? 'Account' : 'API key'} ${index + 1}`;
                                                    const accountOAuth = oauthProviderId
                                                        ? oauthForProviderAccount(providerOAuth, oauthProviderId, account)
                                                        : undefined;
                                                    const accountMeta = oauthProviderId ? providerOAuthStatusText(accountOAuth) : HIDDEN_CREDENTIAL_MASK;
                                                    const expanded = editingAccountKey === accountKey;
                                                    return (
                                                        <SortableProviderKeyRow
                                                            key={accountKey}
                                                            id={accountKey}
                                                            index={index}
                                                            account={account}
                                                            accountLabel={accountLabel}
                                                            accountMeta={accountMeta}
                                                            expanded={expanded}
                                                            expandedPanel={expanded ? renderProviderKeyEditor({ includeHeader: false }) : undefined}
                                                            disabled={saving}
                                                            onOpen={() => {
                                                                if (expanded) closeProviderKeyEditor();
                                                                else openExistingKeyEditor(account);
                                                            }}
                                                            onEnabledChange={(checked) => {
                                                                void onPatchProvider(row.key, {
                                                                    ...(account.id ? { id: account.id } : {}),
                                                                    ...(account.label ? { label: account.label } : {}),
                                                                    enabled: checked,
                                                                });
                                                            }}
                                                            onMoveUp={() => moveSavedAccount(index, index - 1)}
                                                            onMoveDown={() => moveSavedAccount(index, index + 1)}
                                                            canMoveUp={index > 0}
                                                            canMoveDown={index < savedAccounts.length - 1}
                                                        />
                                                    );
                                                })}
                                            </ul>
                                        </SortableContext>
                                    </DndContext>
                                )}

                                {savedAccounts.length === 0 && !isAddingPrioritizedKey && (
                                    <div className="flex min-h-20 items-center justify-center rounded-xl border border-dashed border-warm-border bg-warm-muted/20 px-4 py-5 text-sm font-medium text-stone-500 dark:text-stone-400">
                                        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                                        Add a prioritized {oauthProviderId ? 'account' : 'key'}
                                    </div>
                                )}

                                {isAddingPrioritizedKey && renderProviderKeyEditor({ includeHeader: true })}
                            </div>
                            </section>
                        {savingProviderKey === row.key && (
                            <div className="text-xs font-medium text-stone-500 dark:text-stone-400" aria-live="polite">
                                Saving {modelProviderLabel(row.provider)} credentials…
                            </div>
                        )}
                    </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <section>
            {showModels && <div className="flex items-center gap-3 mb-5">
                <Plug className="h-5 w-5 text-stone-600 dark:text-stone-300" weight="bold" />
                <div className="flex-1">
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Models</h2>
                    <p className="text-sm text-stone-600 dark:text-stone-300">
                        {focusedProviderRow
                            ? `Models supported by ${focusedProviderRow.title}`
                            : 'Supported models and available providers'}
                    </p>
                </div>
                {focusedProviderRow && (
                    <Link
                        to="/settings?section=models"
                        className="text-sm font-medium text-stone-600 transition-colors hover:text-brand dark:text-stone-300 dark:hover:text-brand"
                    >
                        Show all
                    </Link>
                )}
            </div>}

            {showModels && <div className="mb-6 grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-warm-border bg-warm-surface px-3 py-2">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">Available</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">{tierCounts.available}</div>
                </div>
                <div className="rounded-xl border border-warm-border bg-warm-surface px-3 py-2">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">Needs key</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">{tierCounts['configured-provider']}</div>
                </div>
                <div className="rounded-xl border border-warm-border bg-warm-surface px-3 py-2">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">All</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">{tierCounts.all}</div>
                </div>
            </div>}

            <div className="space-y-8">
                {showProviders && (selectedProviderRow ? renderProviderDetail(selectedProviderRow) : <div className="space-y-8">
                    <div className="border-b border-warm-border pb-5">
                        <div className="flex flex-col gap-6">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                                <div className="min-w-0">
                                    <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-50">BYOK</h2>
                                </div>
                            </div>
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                <p className="text-sm text-stone-500 dark:text-stone-400">
                                    Use your own provider API keys in Clash.
                                </p>
                                <div className="relative sm:w-80">
                                    <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                                    <input
                                        aria-label="Search providers"
                                        type="search"
                                        value={providerQuery}
                                        onChange={(e) => setProviderQuery(e.target.value)}
                                        placeholder="Search providers..."
                                        className={settingsSearchFieldClass}
                                    />
                                </div>
                            </div>
                            {saving && (
                                <span
                                    role="status"
                                    aria-label="Provider save status"
                                    aria-live="polite"
                                    className="pointer-events-none absolute right-0 top-full mt-1 rounded-lg border border-warm-border bg-warm-muted px-3 py-1 text-xs font-medium text-stone-700 shadow-sm dark:text-stone-200"
                                >
                                    Saving provider settings…
                                </span>
                            )}
                        </div>
                    </div>

                    {configuredProviderRows.length > 0 && (
                        <ul aria-label="Configured BYOK providers" className="overflow-hidden rounded-xl border border-warm-border bg-warm-surface shadow-sm">
                            {configuredProviderRows.map(renderProviderRow)}
                        </ul>
                    )}

                    <section className="space-y-3">
                        <h3 className="text-sm font-semibold text-stone-500 dark:text-stone-400">Available</h3>
                        <ul aria-label="Available BYOK providers" className="overflow-hidden rounded-xl border border-warm-border bg-warm-surface shadow-sm">
                            {availableProviderRows.length > 0 ? (
                                availableProviderRows.map(renderProviderRow)
                            ) : (
                                <li className="px-4 py-8 text-center text-sm text-stone-500 dark:text-stone-400">
                                    No providers match this search.
                                </li>
                            )}
                        </ul>
                    </section>

	                    {error && <div role="alert" className={`${settingsErrorAlertClass} mt-3`}>{error}</div>}
                </div>)}

                {showModels && <div className="space-y-6">
                    <div className="border-b border-warm-border pb-4">
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
                            <label className="relative block">
                                <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                                <input
                                    aria-label="Search models"
                                    type="search"
                                    value={modelQuery}
                                    onChange={(e) => setModelQuery(e.target.value)}
                                    placeholder="Search model cards..."
                                    className={settingsSearchFieldClass}
                                />
                            </label>
                            <SelectMenu
                                value={modelKindFilter}
                                options={modelKindSelectOptions}
                                onValueChange={(next) => setModelKindFilter(String(next))}
                                ariaLabel="Modality"
                                variant="field"
                                menuWidth="trigger"
                                className="w-full"
                                triggerClassName={settingsSelectTriggerClass}
                            />
                            <SelectMenu
                                value={modelProviderFilter}
                                options={MODEL_PROVIDER_FILTER_OPTIONS}
                                onValueChange={(next) => setModelProviderFilter(next as typeof modelProviderFilter)}
                                ariaLabel="Provider status"
                                variant="field"
                                menuWidth="trigger"
                                className="w-full"
                                triggerClassName={settingsSelectTriggerClass}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <h3 className="text-sm font-medium text-stone-500 dark:text-stone-400">Available model cards</h3>
                        {filteredModelCatalog.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-warm-border py-8 text-center text-sm text-stone-600 dark:text-stone-300">
                                No model cards match these filters.
                            </div>
                        ) : (
                            <div className="grid gap-3 lg:grid-cols-2">
                                {filteredModelCatalog.map((entry) => renderModelCard(entry))}
                            </div>
                        )}
                    </div>
                </div>}
            </div>
        </section>
    );
}

/**
 * Sync — local daemon cloud sync mode.
 */
interface LocalSyncConfig {
    mode: 'local-only' | 'cloud-sync';
    remote_loro: {
        enabled: boolean;
        url: string | null;
        has_token: boolean;
        source: 'none' | 'env' | 'config';
    };
}

function SyncSection() {
    const rt = useClashRuntime();
    const feedback = useAppFeedback();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [removingRuntimeId, setRemovingRuntimeId] = useState<string | null>(null);
    const [mode, setMode] = useState<'local-only' | 'cloud-sync'>('local-only');
    const [remoteUrl, setRemoteUrl] = useState('');
    const [remoteToken, setRemoteToken] = useState('');
    const [hasToken, setHasToken] = useState(false);
    const [source, setSource] = useState<'none' | 'env' | 'config'>('none');
    const syncVersionRef = useRef(0);

    const markDirty = useCallback(() => {
        syncVersionRef.current += 1;
        setDirty(true);
        setError(null);
    }, []);

    const applyConfig = useCallback((config: LocalSyncConfig) => {
        setMode(config.mode);
        setRemoteUrl(config.remote_loro.url ?? '');
        setRemoteToken('');
        setHasToken(config.remote_loro.has_token);
        setSource(config.remote_loro.source);
    }, []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch(runtimeApiUrl('/api/v1/local/sync'), { credentials: 'include' })
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return (await res.json()) as LocalSyncConfig;
            })
            .then((config) => {
                if (cancelled) return;
                applyConfig(config);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [applyConfig]);

    useEffect(() => {
        if (loading || !dirty) return;
        if (mode === 'cloud-sync' && !remoteUrl.trim()) return;
        const version = syncVersionRef.current;
        const timer = window.setTimeout(() => {
            setSaving(true);
            setError(null);
            const body: Record<string, unknown> = {
                mode,
                remote_loro_url: mode === 'cloud-sync' ? remoteUrl.trim() : null,
            };
            if (remoteToken.trim()) body.remote_loro_token = remoteToken.trim();
            void fetch(runtimeApiUrl('/api/v1/local/sync'), {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            })
                .then(async (res) => {
                    if (!res.ok) {
                        const json = await res.json().catch(() => null) as { error?: string } | null;
                        throw new Error(json?.error ?? `HTTP ${res.status}`);
                    }
                    return (await res.json()) as LocalSyncConfig;
                })
                .then((config) => {
                    if (syncVersionRef.current !== version) return;
                    setDirty(false);
                    applyConfig(config);
                    feedback.notify({
                        variant: 'success',
                        title: 'Sync settings saved',
                    });
                })
                .catch((err) => {
                    if (syncVersionRef.current !== version) return;
                    setError(err instanceof Error ? err.message : String(err));
                })
                .finally(() => {
                    if (syncVersionRef.current === version) setSaving(false);
                });
        }, 450);
        return () => window.clearTimeout(timer);
    }, [applyConfig, dirty, feedback, loading, mode, remoteToken, remoteUrl]);

    const onRemoveRuntime = useCallback(async (id: string, label: string) => {
        if (!confirm(`Remove ${label}? The daemon on that machine will stop being authorized.`)) return;
        setRemovingRuntimeId(id);
        try {
            const res = await fetch(runtimeApiUrl(`/api/v1/runtimes/${id}`), {
                method: "DELETE",
                credentials: "include",
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await rt.refresh();
        } catch (e) {
            feedback.notify({
                variant: "error",
                title: "Could not remove runtime",
                message: displayErrorMessage(e),
                actionLabel: "Open Sync",
                actionHref: "/settings?section=sync",
            });
        } finally {
            setRemovingRuntimeId(null);
        }
    }, [feedback, rt]);

    return (
        <section>
            <div className="flex items-center gap-3 mb-5">
                <CloudArrowUp className="h-5 w-5 text-stone-600 dark:text-stone-300" weight="bold" />
                <div className="flex-1">
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Sync</h2>
                    <p className="text-sm text-stone-600 dark:text-stone-300">
                        Local canvas state with optional cloud persistence.
                    </p>
                </div>
                <span className="rounded-lg border border-warm-border bg-warm-muted px-3 py-1 text-xs font-medium text-stone-700 dark:text-stone-200">
                    {mode === 'cloud-sync' ? 'Cloud sync' : 'Local only'}
                </span>
            </div>

            {loading ? (
                <SettingsFormSkeleton ariaLabel="Loading sync settings" variant="sync" />
            ) : (
                <SettingsAnimatedBody>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className={`rounded-xl border p-4 transition-colors ${mode === 'local-only' ? 'border-brand/55 bg-brand-light/45' : 'border-warm-border bg-warm-surface hover:border-brand/35'}`}>
                            <input
                                type="radio"
                                name="sync-mode"
                                value="local-only"
                                checked={mode === 'local-only'}
                                onChange={() => {
                                    setMode('local-only');
                                    markDirty();
                                }}
                                className="sr-only"
                            />
                            <span className="block text-sm font-semibold text-slate-900 dark:text-slate-50">Local only</span>
                            <span className="mt-1 block text-xs text-stone-600 dark:text-stone-300">
                                Stores projects on this machine.
                            </span>
                        </label>
                        <label className={`rounded-xl border p-4 transition-colors ${mode === 'cloud-sync' ? 'border-brand/55 bg-brand-light/45' : 'border-warm-border bg-warm-surface hover:border-brand/35'}`}>
                            <input
                                type="radio"
                                name="sync-mode"
                                value="cloud-sync"
                                checked={mode === 'cloud-sync'}
                                onChange={() => {
                                    setMode('cloud-sync');
                                    markDirty();
                                }}
                                className="sr-only"
                            />
                            <span className="block text-sm font-semibold text-slate-900 dark:text-slate-50">Cloud sync</span>
                            <span className="mt-1 block text-xs text-stone-600 dark:text-stone-300">
                                Mirrors Loro snapshots and updates.
                            </span>
                        </label>
                    </div>

                    <div className="space-y-3 rounded-xl border border-warm-border bg-warm-surface p-4">
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">Remote Loro URL</span>
                            <input
                                aria-label="Remote Loro URL"
                                type="url"
                                value={remoteUrl}
                                onChange={(e) => {
                                    setRemoteUrl(e.target.value);
                                    markDirty();
                                }}
                                placeholder="https://api.example.com"
                                disabled={mode !== 'cloud-sync'}
                                className={settingsFieldClass}
                            />
                        </label>
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">Remote Loro token</span>
                            <input
                                aria-label="Remote Loro token"
                                type="password"
                                value={remoteToken}
                                onChange={(e) => {
                                    setRemoteToken(e.target.value);
                                    markDirty();
                                }}
                                placeholder={hasToken ? 'Token saved' : 'Bearer token'}
                                disabled={mode !== 'cloud-sync'}
                                className={settingsFieldClass}
                            />
                        </label>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                            <span>{hasToken ? 'Token saved' : 'No token saved'}</span>
                            <span>·</span>
                            <span>Source: {source}</span>
                        </div>
                    </div>

                    {error && (
                        <div role="alert" className={settingsErrorAlertClass}>
                            {error}
                        </div>
                    )}
                    {saving && (
                        <div className="text-sm font-medium text-stone-500 dark:text-stone-400" aria-live="polite">
                            Saving sync settings…
                        </div>
                    )}

                    <div className="mt-7 border-t border-warm-border pt-5">
                        <div className="mb-3">
                            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-50">Runtime machines</h3>
                            <p className="text-xs text-stone-600 dark:text-stone-300">
                                Machines currently authorized to sync runtime state with this workspace.
                            </p>
                        </div>
                        {rt.runtimes.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-warm-border p-6 text-center">
                                <p className="text-sm text-stone-600 dark:text-stone-300">No runtime machines connected.</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {rt.runtimes.map((runtime) => {
                                    const online = runtime.status === "online";
                                    const label = runtime.hostname || runtime.machine_id.slice(0, 12);
                                    const lastBeat = runtime.last_heartbeat
                                        ? new Date(runtime.last_heartbeat * 1000).toLocaleString()
                                        : "never";
                                    return (
                                        <div
                                            key={runtime.id}
                                            className="flex items-start justify-between gap-3 rounded-xl border border-warm-border bg-warm-surface p-4"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className={`inline-block h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-stone-300"}`} />
                                                    <span className="font-medium text-slate-900 dark:text-slate-50">{label}</span>
                                                    <span className="text-xs text-stone-500 dark:text-stone-400">{runtime.os} · v{runtime.version}</span>
                                                </div>
                                                <div className="mt-1 text-xs text-stone-600 dark:text-stone-300">
                                                    Agents: {runtime.agents.length === 0 ? "none" : runtime.agents.map((agent) => agent.label ?? agent.id).join(", ")}
                                                </div>
                                                <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                                                    Last seen: {lastBeat}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                aria-label={`Remove ${label} runtime`}
                                                onClick={() => { void onRemoveRuntime(runtime.id, label); }}
                                                disabled={removingRuntimeId === runtime.id}
                                                className="text-xs text-stone-500 transition-colors hover:text-red-600 disabled:opacity-50 dark:text-stone-400 dark:hover:text-red-400"
                                            >
                                                {removingRuntimeId === runtime.id ? "Removing..." : "Remove"}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </SettingsAnimatedBody>
            )}
        </section>
    );
}

interface LocalAudioConfig {
    asr: {
        enabled: boolean;
        provider: 'builtin-funasr';
        base_url: string | null;
        model: string;
        has_api_key: boolean;
        ready: boolean;
        setup: {
            provider: 'funasr';
            runtime: 'builtin-rpc';
            status: 'disabled' | 'needs-install' | 'ready';
            available: boolean;
            default_base_url: string | null;
            commands: string[];
            message?: string;
        };
    };
}

function isLocalAsrModelEntry(entry: ModelCatalogEntryInfo): boolean {
    return (entry.model.kind as string) === 'asr' && (
        (entry.selectedRoute?.apiShape as string | undefined) === 'local-asr' ||
        entry.candidateProviders.map(String).includes('local')
    );
}

function asrModelValue(entry: ModelCatalogEntryInfo): string {
    if (entry.selectedRoute?.upstreamModel) return entry.selectedRoute.upstreamModel;
    const defaultParams = entry.model.defaultParams as Record<string, unknown> | undefined;
    const defaultModel = defaultParams?.asr_model;
    return typeof defaultModel === 'string' && defaultModel.trim()
        ? defaultModel.trim()
        : entry.model.id;
}

async function fetchLocalAudioConfig(): Promise<LocalAudioConfig> {
    const res = await fetch(runtimeApiUrl('/api/v1/local/audio'), { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as LocalAudioConfig;
}

function AudioSection({ asrModels }: { asrModels: ModelCatalogEntryInfo[] }) {
    const feedback = useAppFeedback();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [model, setModel] = useState('iic/SenseVoiceSmall');
    const [setupAvailable, setSetupAvailable] = useState(false);
    const [setupDialog, setSetupDialog] = useState<{
        title: string;
        message: string;
    } | null>(null);
    const audioVersionRef = useRef(0);
    const asrModelOptions = useMemo<SelectOption<string>[]>(
        () => asrModels.map((entry) => ({
            value: asrModelValue(entry),
            label: entry.model.name,
        })),
        [asrModels],
    );
    const hasSelectedAsrModel = asrModelOptions.length > 0;

    const markDirty = useCallback(() => {
        audioVersionRef.current += 1;
        setDirty(true);
    }, []);

    const applyConfig = useCallback((config: LocalAudioConfig) => {
        setEnabled(config.asr.enabled);
        setModel(config.asr.model);
        setSetupAvailable(config.asr.setup.available);
    }, []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchLocalAudioConfig()
            .then((config) => {
                if (cancelled) return;
                applyConfig(config);
            })
            .catch((err) => {
                if (cancelled) return;
                feedback.notify({
                    variant: 'error',
                    title: 'Could not load audio settings',
                    message: displayErrorMessage(err),
                });
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [applyConfig, feedback]);

    useEffect(() => {
        if (loading || !hasSelectedAsrModel) return;
        if (asrModelOptions.some((option) => option.value === model)) return;
        setModel(asrModelOptions[0].value);
        markDirty();
    }, [asrModelOptions, hasSelectedAsrModel, loading, markDirty, model]);

    useEffect(() => {
        if (loading || !dirty) return;
        if (!hasSelectedAsrModel) return;
        const version = audioVersionRef.current;
        const timer = window.setTimeout(() => {
            setSaving(true);
            const body: Record<string, unknown> = {
                asr_enabled: enabled,
                asr_provider: 'builtin-funasr',
                asr_model: model.trim() || 'iic/SenseVoiceSmall',
            };
            void fetch(runtimeApiUrl('/api/v1/local/audio'), {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            })
                .then(async (res) => {
                    if (!res.ok) {
                        const json = await res.json().catch(() => null) as { error?: string } | null;
                        throw new Error(json?.error ?? `HTTP ${res.status}`);
                    }
                    return (await res.json()) as LocalAudioConfig;
                })
                .then((config) => {
                    if (audioVersionRef.current !== version) return;
                    setDirty(false);
                    applyConfig(config);
                    feedback.notify({
                        variant: 'success',
                        title: 'Audio settings saved',
                    });
                })
                .catch((err) => {
                    if (audioVersionRef.current !== version) return;
                    feedback.notify({
                        variant: 'error',
                        title: 'Could not save audio settings',
                        message: displayErrorMessage(err),
                    });
                })
                .finally(() => {
                    if (audioVersionRef.current === version) setSaving(false);
                });
        }, 450);
        return () => window.clearTimeout(timer);
    }, [applyConfig, dirty, enabled, feedback, hasSelectedAsrModel, loading, model]);

    const blockingReason = !hasSelectedAsrModel
        ? 'Select an ASR model in Models before enabling voice input.'
        : !enabled && !setupAvailable
            ? 'Deploy the selected ASR model from Models before enabling voice input.'
            : undefined;
    const switchDisabled = saving;
    const switchDisabledReason = switchDisabled ? 'Saving audio settings.' : blockingReason;
    const switchReasonId = switchDisabledReason ? 'audio-asr-switch-reason' : undefined;
    const selectedModelValue = asrModelOptions.some((option) => option.value === model)
        ? model
        : asrModelOptions[0]?.value ?? model;
    const openSetupDialog = useCallback(() => {
        setSetupDialog(!hasSelectedAsrModel
            ? {
                title: 'Configure ASR model',
                message: 'Voice input needs a local ASR model before it can transcribe microphone clips.',
            }
            : {
                title: 'Deploy ASR model',
                message: 'The selected ASR model must be deployed before voice input can run locally.',
            });
    }, [hasSelectedAsrModel]);

    return (
        <section>
            <div className="flex items-center gap-3 mb-5">
                <Microphone className="h-5 w-5 text-stone-600 dark:text-stone-300" weight="bold" />
                <div className="flex-1">
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Audio</h2>
                    <p className="text-sm text-stone-600 dark:text-stone-300">
                        Voice input in chat.
                    </p>
                </div>
            </div>

            {loading ? (
                <SettingsFormSkeleton ariaLabel="Loading audio settings" variant="audio" />
            ) : (
                <SettingsAnimatedBody>
                    <div className="rounded-xl border border-warm-border bg-warm-surface p-4">
                        <div className="flex items-start justify-between gap-4 border-b border-warm-border pb-4">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Voice input</h3>
                                <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">
                                    Transcribe microphone clips before sending.
                                </p>
                            </div>
                            <Switch
                                checked={enabled}
                                onCheckedChange={(next) => {
                                    if (next && blockingReason) {
                                        openSetupDialog();
                                        return;
                                    }
                                    setEnabled(next);
                                    markDirty();
                                }}
                                disabled={switchDisabled}
                                aria-label="Enable voice input"
                                aria-describedby={switchReasonId}
                                title={switchDisabledReason}
                            />
                            {switchDisabledReason && (
                                <span id={switchReasonId} className="sr-only">
                                    {switchDisabledReason}
                                </span>
                            )}
                        </div>
                        <label className="mt-4 block">
                            <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">ASR model</span>
                            {hasSelectedAsrModel && !blockingReason ? (
                                <SelectMenu
                                    value={selectedModelValue}
                                    options={asrModelOptions}
                                    onValueChange={(next) => {
                                        setModel(String(next));
                                        markDirty();
                                    }}
                                    ariaLabel="ASR model"
                                    variant="field"
                                    menuWidth="trigger"
                                    className="w-full"
                                    triggerClassName={settingsSelectTriggerClass}
                                />
                            ) : (
                                <button
                                    type="button"
                                    aria-label="ASR model"
                                    onClick={openSetupDialog}
                                    className={`${settingsSelectTriggerClass} clash-settings-select-trigger inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-warm-border bg-warm-surface px-3 py-2 text-sm font-medium text-stone-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] transition-colors hover:bg-warm-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-warm-surface dark:text-stone-400 dark:hover:bg-slate-800`}
                                >
                                    <span className="min-w-0 flex-1 truncate text-left">
                                        {hasSelectedAsrModel ? selectedModelValue : 'Select'}
                                    </span>
                                    <CaretDown className="h-3.5 w-3.5 flex-shrink-0 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                                </button>
                            )}
                        </label>
                        {switchDisabledReason && (
                            <p className="mt-2 text-xs text-stone-600 dark:text-stone-300">
                                {switchDisabledReason}
                            </p>
                        )}
                    </div>

                    {saving && (
                        <div className="text-sm font-medium text-stone-500 dark:text-stone-400" aria-live="polite">
                            Saving audio settings…
                        </div>
                    )}
                </SettingsAnimatedBody>
            )}
            <Dialog
                open={!!setupDialog}
                onClose={() => setSetupDialog(null)}
                title={setupDialog?.title ?? 'Configure ASR model'}
                description={setupDialog?.message}
                size="sm"
            >
                <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={() => setSetupDialog(null)}
                        className={settingsCompactSecondaryButtonClass}
                    >
                        Cancel
                    </button>
                    <Link
                        to="/settings?section=models"
                        onClick={() => setSetupDialog(null)}
                        className={settingsSmallPrimaryButtonClass}
                    >
                        Open Models
                    </Link>
                </div>
            </Dialog>
        </section>
    );
}

/**
 * Agents — install, authenticate, and enable the local ACP harnesses Copilot can use.
 */
function AgentsSection() {
    const rt = useClashRuntime();
    const feedback = useAppFeedback();
    const [harnesses, setHarnesses] = useState<LocalHarnessInfo[]>([]);
    const [harnessLoading, setHarnessLoading] = useState(true);
    const [harnessLoadingMessage, setHarnessLoadingMessage] = useState("Checking installed agents…");
    const [savingHarness, setSavingHarness] = useState<{ id: string; action: HarnessSavingAction } | null>(null);
    const [authLaunches, setAuthLaunches] = useState<Record<string, AuthLaunchState>>({});
    const authOpeningTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});
    const authProbeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});
    const [uninstallHarnessTarget, setUninstallHarnessTarget] = useState<LocalHarnessInfo | null>(null);
    const [agentServers, setAgentServers] = useState<LocalAgentServersConfig>({});
    const [agentServersSaving, setAgentServersSaving] = useState(false);
    const [customAgentDialogOpen, setCustomAgentDialogOpen] = useState(false);
    const [customAgentOriginalName, setCustomAgentOriginalName] = useState<string | null>(null);
    const [customAgentStarterId, setCustomAgentStarterId] = useState<string>(CUSTOM_AGENT_SERVER_STARTERS[0].id);
    const [customAgentName, setCustomAgentName] = useState<string>(CUSTOM_AGENT_SERVER_STARTERS[0].name);
    const [customAgentCommand, setCustomAgentCommand] = useState<string>(CUSTOM_AGENT_SERVER_STARTERS[0].command);
    const [customAgentArgsText, setCustomAgentArgsText] = useState(formatArgsText(CUSTOM_AGENT_SERVER_STARTERS[0].args));
    const [customAgentEnvText, setCustomAgentEnvText] = useState(formatEnvText(CUSTOM_AGENT_SERVER_STARTERS[0].env));
    const [customAgentError, setCustomAgentError] = useState<string | null>(null);
    const [collapsedRuntimeIds, setCollapsedRuntimeIds] = useState<Set<string>>(() => new Set());

    const clearAuthTimers = useCallback((harnessId: string) => {
        const openingTimer = authOpeningTimersRef.current[harnessId];
        if (openingTimer) clearTimeout(openingTimer);
        delete authOpeningTimersRef.current[harnessId];
        const probeTimer = authProbeTimersRef.current[harnessId];
        if (probeTimer) clearTimeout(probeTimer);
        delete authProbeTimersRef.current[harnessId];
    }, []);

    const loadHarnesses = useCallback(async (opts: { refresh?: boolean; probe?: "auth" | "config"; showGlobalLoading?: boolean; loadingMessage?: string } = {}): Promise<LocalHarnessInfo[]> => {
        const showGlobalLoading = opts.showGlobalLoading ?? true;
        if (showGlobalLoading) {
            setHarnessLoadingMessage(opts.loadingMessage ?? (
                opts.probe === "auth"
                    ? "Checking agent auth…"
                    : opts.probe === "config"
                        ? "Checking agent model options…"
                        : "Checking installed agents…"
            ));
            setHarnessLoading(true);
        }
        try {
            const query = new URLSearchParams();
            if (opts.probe) query.set("probe", opts.probe);
            if (opts.refresh) query.set("refresh", "1");
            const path = query.toString() ? `/api/v1/local/harnesses?${query.toString()}` : "/api/v1/local/harnesses";
            const res = await fetch(runtimeApiUrl(path), {
                method: "GET",
                credentials: "include",
            });
            if (res.status === 404) {
                setHarnesses([]);
                return [];
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = (await res.json()) as { harnesses?: LocalHarnessInfo[] };
            const nextHarnesses = json.harnesses ?? [];
            setHarnesses(nextHarnesses);
            return nextHarnesses;
        } catch (e) {
            feedback.notify({
                variant: "error",
                title: "Could not load agents",
                message: displayErrorMessage(e),
                actionLabel: "Retry",
                onAction: () => {
                    void loadHarnesses({
                        probe: "auth",
                        refresh: true,
                        loadingMessage: "Checking agent auth and models…",
                    });
                    void rt.refresh({ probe: "config", refresh: true });
                },
            });
            return [];
        } finally {
            if (showGlobalLoading) setHarnessLoading(false);
        }
    }, [feedback, rt.refresh]);

    const loadAgentServers = useCallback(async () => {
        try {
            const res = await fetch(runtimeApiUrl("/api/v1/local/agent-servers"), {
                method: "GET",
                credentials: "include",
            });
            if (!res.ok) return;
            const json = (await res.json()) as { agent_servers?: LocalAgentServersConfig };
            setAgentServers(json.agent_servers ?? {});
        } catch {
            // Older local APIs may not expose editable custom agent servers.
        }
    }, []);

    useEffect(() => {
        void loadHarnesses({
            probe: "auth",
            loadingMessage: "Checking installed agent auth…",
        });
        void loadAgentServers();
    }, [loadHarnesses, loadAgentServers]);

    useEffect(() => () => {
        for (const timer of Object.values(authOpeningTimersRef.current)) {
            if (timer) clearTimeout(timer);
        }
        for (const timer of Object.values(authProbeTimersRef.current)) {
            if (timer) clearTimeout(timer);
        }
    }, []);

    const onRecheckHarnesses = useCallback(async (harnessId?: string) => {
        const scopedHarness = harnessId ? harnesses.find((candidate) => candidate.id === harnessId) : null;
        if (scopedHarness) setSavingHarness({ id: scopedHarness.id, action: "probe" });
        try {
            await Promise.all([
                loadHarnesses({
                    probe: "auth",
                    refresh: true,
                    showGlobalLoading: !scopedHarness,
                    loadingMessage: "Checking agent auth and models…",
                }),
                rt.refresh({ probe: "config", refresh: true }),
            ]);
        } catch (e) {
            feedback.notify({
                variant: "error",
                title: "Could not check agents",
                message: displayErrorMessage(e),
                actionLabel: "Open Agents",
                actionHref: "/settings?section=agents",
            });
        } finally {
            if (scopedHarness) {
                setSavingHarness((current) => (
                    current?.id === scopedHarness.id && current.action === "probe" ? null : current
                ));
            }
        }
    }, [feedback, harnesses, loadHarnesses, rt.refresh]);

    const scheduleAuthProbe = useCallback((harnessId: string, label: string, attempt = 0) => {
        const existingTimer = authProbeTimersRef.current[harnessId];
        if (existingTimer) clearTimeout(existingTimer);
        authProbeTimersRef.current[harnessId] = setTimeout(() => {
            delete authProbeTimersRef.current[harnessId];
            void (async () => {
                const nextHarnesses = await loadHarnesses({ probe: "auth", refresh: true });
                const harness = nextHarnesses.find((candidate) => candidate.id === harnessId);
                if (harness?.available && !harnessAuthBlocksEnable(harness)) {
                    clearAuthTimers(harnessId);
                    setAuthLaunches((current) => {
                        const { [harnessId]: _removed, ...rest } = current;
                        return rest;
                    });
                    await rt.refresh({ probe: "config", refresh: true });
                    return;
                }
                if (attempt + 1 >= AUTH_RECHECK_MAX_ATTEMPTS) {
                    setAuthLaunches((current) => ({
                        ...current,
                        [harnessId]: {
                            ...(current[harnessId] ?? { status: "attention" as const }),
                            status: "attention",
                            message: `Still waiting for ${label} auth.`,
                        },
                    }));
                    return;
                }
                setAuthLaunches((current) => ({
                    ...current,
                    [harnessId]: {
                        ...(current[harnessId] ?? { status: "waiting" as const }),
                        status: "waiting",
                            message: `Waiting for ${label} auth…`,
                    },
                }));
                scheduleAuthProbe(harnessId, label, attempt + 1);
            })();
        }, AUTH_RECHECK_INTERVAL_MS);
    }, [clearAuthTimers, loadHarnesses, rt.refresh]);

    const saveHarnessEnablement = async (baseHarnesses: LocalHarnessInfo[], harnessId: string, enabled: boolean): Promise<LocalHarnessInfo[]> => {
        const nextEnabled = new Set(baseHarnesses.filter((harness) => harness.enabled).map((harness) => harness.id));
        if (enabled) nextEnabled.add(harnessId);
        else nextEnabled.delete(harnessId);
        const res = await fetch(runtimeApiUrl("/api/v1/local/harnesses"), {
            method: "PUT",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled_harness_ids: Array.from(nextEnabled) }),
        });
        if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { harnesses?: LocalHarnessInfo[] };
        return json.harnesses ?? [];
    };

    const onToggleHarness = async (harnessId: string, enabled: boolean) => {
        const previousHarnesses = harnesses;
        const target = previousHarnesses.find((harness) => harness.id === harnessId);
        if (enabled && (!target?.available || harnessAuthBlocksEnable(target))) {
            feedback.notify({
                variant: "error",
                title: `Could not enable ${target?.label ?? "agent"}`,
                message: target?.auth?.message ?? "Install and check auth before enabling this agent.",
                actionLabel: "Check again",
                onAction: () => { void onRecheckHarnesses(); },
            });
            return;
        }
        const optimisticHarnesses = previousHarnesses.map((harness) => (
            harness.id === harnessId ? { ...harness, enabled } : harness
        ));
        setHarnesses(optimisticHarnesses);
        setSavingHarness({ id: harnessId, action: "toggle" });
        try {
            const savedHarnesses = await saveHarnessEnablement(optimisticHarnesses, harnessId, enabled);
            setHarnesses(savedHarnesses);
            if (enabled && !target?.auth) {
                setSavingHarness({ id: harnessId, action: "probe" });
                await Promise.all([
                    loadHarnesses({
                        probe: "auth",
                        refresh: true,
                        loadingMessage: "Checking agent auth and models…",
                    }),
                    rt.refresh({ probe: "config", refresh: true }),
                ]);
            }
        } catch (e) {
            const harness = harnesses.find((candidate) => candidate.id === harnessId);
            let refreshedAfterFailure = false;
            if (enabled) {
                setSavingHarness({ id: harnessId, action: "probe" });
                const nextHarnesses = await loadHarnesses({ probe: "auth", refresh: true });
                refreshedAfterFailure = nextHarnesses.some((candidate) => candidate.id === harnessId);
                await rt.refresh({ probe: "config", refresh: true });
            }
            if (!refreshedAfterFailure) {
                setHarnesses(previousHarnesses);
            }
            feedback.notify({
                variant: "error",
                title: `Could not ${enabled ? "enable" : "disable"} ${harness?.label ?? "agent"}`,
                message: displayErrorMessage(e),
                actionLabel: "Check again",
                onAction: () => { void onRecheckHarnesses(); },
            });
        } finally {
            setSavingHarness(null);
        }
    };

    const installHarnessRequest = async (harnessId: string): Promise<LocalHarnessInfo[]> => {
        const res = await fetch(runtimeApiUrl(`/api/v1/local/harnesses/${encodeURIComponent(harnessId)}/install`), {
            method: "POST",
            credentials: "include",
        });
        if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { harnesses?: LocalHarnessInfo[] };
        return json.harnesses ?? [];
    };

    const onInstallHarness = async (harnessId: string) => {
        const harnessLabel = harnesses.find((candidate) => candidate.id === harnessId)?.label ?? "agent";
        let installed = false;
        setSavingHarness({ id: harnessId, action: "install" });
        try {
            const nextHarnesses = await installHarnessRequest(harnessId);
            setHarnesses(nextHarnesses);
            installed = true;

            setSavingHarness({ id: harnessId, action: "probe" });
            const [probedHarnesses] = await Promise.all([
                loadHarnesses({
                    probe: "auth",
                    refresh: true,
                    showGlobalLoading: false,
                }),
                rt.refresh({ probe: "config", refresh: true }),
            ]);
            const setupHarnesses = probedHarnesses.length > 0 ? probedHarnesses : nextHarnesses;
            const installedHarness = setupHarnesses.find((candidate) => candidate.id === harnessId);
            if (installedHarness?.available && !harnessAuthBlocksEnable(installedHarness)) {
                setSavingHarness({ id: harnessId, action: "toggle" });
                const enabledHarnesses = await saveHarnessEnablement(setupHarnesses, harnessId, true);
                setHarnesses(enabledHarnesses);
                await rt.refresh({ probe: "config", refresh: true });
            }
        } catch (e) {
            const harness = harnesses.find((candidate) => candidate.id === harnessId);
            feedback.notify({
                variant: "error",
                title: installed ? `Could not finish setting up ${harness?.label ?? harnessLabel}` : `Could not install ${harness?.label ?? harnessLabel}`,
                message: displayErrorMessage(e),
                actionLabel: "Check again",
                onAction: () => { void onRecheckHarnesses(); },
            });
        } finally {
            setSavingHarness(null);
        }
    };

    const onUninstallHarness = async (harnessId: string) => {
        setSavingHarness({ id: harnessId, action: "uninstall" });
        try {
            const res = await fetch(runtimeApiUrl(`/api/v1/local/harnesses/${encodeURIComponent(harnessId)}/install`), {
                method: "DELETE",
                credentials: "include",
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                throw new Error(body?.error ?? `HTTP ${res.status}`);
            }
            const json = (await res.json()) as { harnesses?: LocalHarnessInfo[] };
            setHarnesses(json.harnesses ?? []);
            setUninstallHarnessTarget(null);
            await rt.refresh({ probe: "config", refresh: true });
        } catch (e) {
            const harness = harnesses.find((candidate) => candidate.id === harnessId) ?? uninstallHarnessTarget;
            feedback.notify({
                variant: "error",
                title: `Could not uninstall ${harness?.label ?? "agent"}`,
                message: displayErrorMessage(e),
                actionLabel: "Check again",
                onAction: () => { void onRecheckHarnesses(); },
            });
        } finally {
            setSavingHarness(null);
        }
    };

    const onUpgradeHarness = async (harnessId: string) => {
        setSavingHarness({ id: harnessId, action: "upgrade" });
        try {
            const res = await fetch(runtimeApiUrl(`/api/v1/local/harnesses/${encodeURIComponent(harnessId)}/upgrade`), {
                method: "POST",
                credentials: "include",
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                throw new Error(body?.error ?? `HTTP ${res.status}`);
            }
            const json = (await res.json()) as { harnesses?: LocalHarnessInfo[] };
            setHarnesses(json.harnesses ?? []);
            await rt.refresh({ probe: "config", refresh: true });
        } catch (e) {
            const harness = harnesses.find((candidate) => candidate.id === harnessId);
            feedback.notify({
                variant: "error",
                title: `Could not upgrade ${harness?.label ?? "agent"}`,
                message: displayErrorMessage(e),
                actionLabel: "Check again",
                onAction: () => { void onRecheckHarnesses(); },
            });
        } finally {
            setSavingHarness(null);
        }
    };

    const onAuthenticateHarness = async (harnessId: string, methodId?: string) => {
        const harness = harnesses.find((candidate) => candidate.id === harnessId);
        const label = harness?.label ?? "agent";
        const authMethod = methodId
            ? harness?.auth?.methods?.find((candidate) => candidate.id === methodId)
            : harness?.auth?.methods?.[0];
        const methodLabel = authMethod?.name ?? authMethod?.id ?? null;
        if (authMethodIsEnvVar(authMethod)) {
            const variableNames = authMethodVariableNames(authMethod);
            const variableText = variableNames.length > 0
                ? `Set ${variableNames.join(", ")} in your agent environment, then check again.`
                : "Set the required credentials in your agent environment, then check again.";
            feedback.notify({
                variant: "info",
                title: `Configure ${label} credentials`,
                message: variableText,
                actionLabel: "Check again",
                onAction: () => { void onRecheckHarnesses(harnessId); },
            });
            return;
        }
        const authNoun = authMethodIsTerminal(authMethod) ? "setup" : "sign in";
        clearAuthTimers(harnessId);
        setAuthLaunches((current) => ({
            ...current,
            [harnessId]: {
                status: "opening",
                ...(methodId ? { methodId } : {}),
                ...(methodLabel ? { methodLabel } : {}),
                message: `Opening ${label} ${authNoun}…`,
            },
        }));
        setSavingHarness({ id: harnessId, action: "auth" });
        const authAbortController = new AbortController();
        authOpeningTimersRef.current[harnessId] = setTimeout(() => {
            delete authOpeningTimersRef.current[harnessId];
            setSavingHarness((current) => (
                current?.id === harnessId && current.action === "auth" ? null : current
            ));
            setAuthLaunches((current) => ({
                ...current,
                [harnessId]: {
                    ...(current[harnessId] ?? {}),
                    status: "waiting",
                    ...(methodId ? { methodId } : {}),
                    ...(methodLabel ? { methodLabel } : {}),
                        message: `Waiting for ${label} auth…`,
                },
            }));
            scheduleAuthProbe(harnessId, label);
            authAbortController.abort();
        }, AUTH_LAUNCH_OPENING_TIMEOUT_MS);
        try {
            const res = await fetch(runtimeApiUrl(`/api/v1/local/harnesses/${encodeURIComponent(harnessId)}/authenticate`), {
                method: "POST",
                credentials: "include",
                signal: authAbortController.signal,
                ...(methodId
                    ? {
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ method_id: methodId }),
                    }
                    : {}),
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                throw new Error(body?.error ?? `HTTP ${res.status}`);
            }
            const json = (await res.json()) as { harnesses?: LocalHarnessInfo[] };
            const nextHarnesses = json.harnesses ?? [];
            setHarnesses(nextHarnesses);
            const openingTimer = authOpeningTimersRef.current[harnessId];
            if (openingTimer) clearTimeout(openingTimer);
            delete authOpeningTimersRef.current[harnessId];
            const authenticatedHarness = nextHarnesses.find((candidate) => candidate.id === harnessId);
            if (authenticatedHarness?.available && !harnessAuthBlocksEnable(authenticatedHarness)) {
                clearAuthTimers(harnessId);
                setAuthLaunches((current) => {
                    const { [harnessId]: _removed, ...rest } = current;
                    return rest;
                });
                await rt.refresh({ probe: "config", refresh: true });
                return;
            }
            setAuthLaunches((current) => ({
                ...current,
                [harnessId]: {
                    ...(current[harnessId] ?? {}),
                    status: "waiting",
                    ...(methodId ? { methodId } : {}),
                    ...(methodLabel ? { methodLabel } : {}),
                    message: `Waiting for ${label} auth…`,
                },
            }));
            scheduleAuthProbe(harnessId, label);
        } catch (e) {
            if (isAbortError(e)) {
                return;
            }
            clearAuthTimers(harnessId);
            setAuthLaunches((current) => {
                const { [harnessId]: _removed, ...rest } = current;
                return rest;
            });
            feedback.notify({
                variant: "error",
                title: authMethodIsTerminal(authMethod) ? `Could not open ${label} setup` : `Could not start ${label} sign in`,
                message: displayErrorMessage(e),
                actionLabel: "Check again",
                onAction: () => { void onRecheckHarnesses(); },
            });
        } finally {
            setSavingHarness((current) => (
                current?.id === harnessId && current.action === "auth" ? null : current
            ));
        }
    };

    const applyCustomAgentStarter = useCallback((starterId: string) => {
        const starter = CUSTOM_AGENT_SERVER_STARTERS.find((candidate) => candidate.id === starterId) ?? CUSTOM_AGENT_SERVER_STARTERS[0];
        setCustomAgentStarterId(starter.id);
        setCustomAgentName(starter.name);
        setCustomAgentCommand(starter.command);
        setCustomAgentArgsText(formatArgsText(starter.args));
        setCustomAgentEnvText(formatEnvText(starter.env));
        setCustomAgentError(null);
    }, []);

    const openAddCustomAgentDialog = useCallback(() => {
        setCustomAgentOriginalName(null);
        applyCustomAgentStarter(CUSTOM_AGENT_SERVER_STARTERS[0].id);
        setCustomAgentDialogOpen(true);
    }, [applyCustomAgentStarter]);

    const openEditCustomAgentDialog = useCallback((name: string, server: LocalAgentServersConfig[string]) => {
        setCustomAgentOriginalName(name);
        setCustomAgentStarterId("custom");
        setCustomAgentName(name);
        setCustomAgentCommand(server.command);
        setCustomAgentArgsText(formatArgsText(server.args));
        setCustomAgentEnvText(formatEnvText(server.env));
        setCustomAgentError(null);
        setCustomAgentDialogOpen(true);
    }, []);

    const saveAgentServers = useCallback(async (nextAgentServers: LocalAgentServersConfig) => {
        setAgentServersSaving(true);
        try {
            const res = await fetch(runtimeApiUrl("/api/v1/local/agent-servers"), {
                method: "PUT",
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ agent_servers: nextAgentServers }),
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { error?: string } | null;
                throw new Error(body?.error ?? `HTTP ${res.status}`);
            }
            const json = (await res.json()) as {
                agent_servers?: LocalAgentServersConfig;
                harnesses?: LocalHarnessInfo[];
            };
            setAgentServers(json.agent_servers ?? {});
            setHarnesses(json.harnesses ?? []);
            await rt.refresh({ probe: "config", refresh: true });
            feedback.notify({
                variant: "success",
                title: "Custom agent servers saved",
            });
        } catch (e) {
            throw e;
        } finally {
            setAgentServersSaving(false);
        }
    }, [feedback, rt]);

    const onSaveCustomAgentServer = async () => {
        const name = customAgentName.trim();
        const command = customAgentCommand.trim();
        if (!name) {
            setCustomAgentError("Agent server name is required.");
            return;
        }
        if (!command) {
            setCustomAgentError("Command is required.");
            return;
        }

        let env: Record<string, string> = {};
        try {
            const rawEnv = customAgentEnvText.trim();
            const parsedEnv = rawEnv ? JSON.parse(rawEnv) as unknown : {};
            if (!parsedEnv || typeof parsedEnv !== "object" || Array.isArray(parsedEnv)) {
                throw new Error("Environment must be a JSON object.");
            }
            env = {};
            for (const [key, value] of Object.entries(parsedEnv)) {
                if (typeof value !== "string") throw new Error("Environment values must be strings.");
                env[key] = value;
            }
        } catch (error) {
            setCustomAgentError(error instanceof Error ? error.message : String(error));
            return;
        }

        const nextAgentServers: LocalAgentServersConfig = { ...agentServers };
        if (customAgentOriginalName && customAgentOriginalName !== name) {
            delete nextAgentServers[customAgentOriginalName];
        }
        nextAgentServers[name] = {
            type: "custom",
            command,
            args: parseArgsText(customAgentArgsText),
            env,
        };

        try {
            await saveAgentServers(nextAgentServers);
            setCustomAgentDialogOpen(false);
        } catch (error) {
            setCustomAgentError(displayErrorMessage(error));
        }
    };

    const onRemoveCustomAgentServer = async (name: string) => {
        const nextAgentServers: LocalAgentServersConfig = { ...agentServers };
        delete nextAgentServers[name];
        try {
            await saveAgentServers(nextAgentServers);
        } catch (error) {
            feedback.notify({
                variant: "error",
                title: "Could not remove custom agent server",
                message: displayErrorMessage(error),
                actionLabel: "Open Agents",
                actionHref: "/settings?section=agents",
            });
        }
    };

    const localHarnessIds = useMemo(() => new Set(harnesses.map((harness) => harness.id)), [harnesses]);
    const localRuntimeId = useMemo(() => {
        const matchingRuntime = rt.runtimes.find((runtime) => (
            runtime.agents.some((agent) => localHarnessIds.has(agent.id))
        ));
        return (
            matchingRuntime?.id
            ?? rt.runtimes.find((runtime) => runtime.status === "online")?.id
            ?? rt.runtimes[0]?.id
            ?? "local-agent-runtime"
        );
    }, [localHarnessIds, rt.runtimes]);

    const runtimeGroups = useMemo(() => {
        const configuredHarnessCount = harnesses.filter(harnessIsConfigured).length;
        if (rt.runtimes.length === 0) {
            return [{
                id: "local-agent-runtime",
                label: "Local runtime",
                status: harnessLoading ? "Checking" : "Local",
                online: true,
                agentCount: configuredHarnessCount,
                localControls: true,
                runtime: null,
            }];
        }

        return rt.runtimes.map((runtime) => {
            const localControls = runtime.id === localRuntimeId;
            return {
                id: runtime.id,
                label: runtime.hostname || runtime.machine_id.slice(0, 12),
                status: runtime.status === "online" ? "Online" : "Offline",
                online: runtime.status === "online",
                agentCount: localControls ? configuredHarnessCount : runtime.agents.length,
                localControls,
                runtime,
            };
        });
    }, [harnessLoading, harnesses, localRuntimeId, rt.runtimes]);

    const toggleRuntimeCollapsed = useCallback((runtimeId: string) => {
        setCollapsedRuntimeIds((current) => {
            const next = new Set(current);
            if (next.has(runtimeId)) next.delete(runtimeId);
            else next.add(runtimeId);
            return next;
        });
    }, []);

    return (
        <section>
            <div className="mb-5 flex items-center gap-3">
                <Plug className="h-5 w-5 text-stone-600 dark:text-stone-300" weight="bold" />
                <div className="flex-1">
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Agents</h2>
                    <p className="text-sm text-stone-600 dark:text-stone-300">
                        Install, authenticate, and enable local agents for Copilot.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => { void onRecheckHarnesses(); }}
                    disabled={harnessLoading}
                    title={harnessLoading ? harnessLoadingMessage : "Check installed agents, auth, and model options again."}
                    className={`${settingsCompactSecondaryButtonClass} min-w-[6.75rem]`}
                >
                    {harnessLoading ? "Checking..." : "Check again"}
                </button>
            </div>

            <div className="space-y-3">
                {runtimeGroups.map((group) => {
                    const collapsed = collapsedRuntimeIds.has(group.id);
                    const agentCountLabel = `${group.agentCount} configured agent${group.agentCount === 1 ? "" : "s"}`;
                    return (
                        <div key={group.id} className="overflow-hidden rounded-xl border border-warm-border bg-warm-surface">
                            <button
                                type="button"
                                aria-expanded={!collapsed}
                                aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.label} runtime`}
                                onClick={() => toggleRuntimeCollapsed(group.id)}
                                className="grid min-h-[4.25rem] w-full grid-cols-[1rem_0.5rem_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-warm-muted"
                            >
                                <CaretRight
                                    className={`h-4 w-4 shrink-0 text-stone-500 transition-transform ${collapsed ? "" : "rotate-90"}`}
                                    weight="bold"
                                />
                                <span className={`h-2 w-2 shrink-0 rounded-full ${group.online ? "bg-emerald-500" : "bg-stone-300"}`} />
                                <span className="min-w-0 flex-1">
                                    <span className="flex flex-wrap items-center gap-2">
                                        <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{group.label}</span>
                                        <span className="rounded-full bg-warm-muted px-2 py-0.5 text-[11px] font-medium text-stone-600 dark:text-stone-300">
                                            {group.status}
                                        </span>
                                    </span>
                                    <span className="mt-0.5 block truncate text-xs text-stone-500 dark:text-stone-400">
                                        {agentCountLabel}
                                    </span>
                                </span>
                            </button>

                            {!collapsed && (
                                <div className="border-t border-warm-border">
                                    {group.localControls ? (
                                        <>
                                            {harnessLoading && (
                                                <div className="border-b border-warm-border px-4 py-2 text-xs text-stone-500 dark:text-stone-400" aria-live="polite">
                                                    {harnessLoadingMessage}
                                                </div>
                                            )}

                                            {harnessLoading && harnesses.length === 0 && (
                                                <AgentRowsSkeleton ariaLabel="Loading agents" />
                                            )}

                                            {!harnessLoading && harnesses.length === 0 && (
                                                <div className="px-4 py-5 text-sm text-stone-600 dark:text-stone-300">
                                                    No local agents discovered for this runtime.
                                                </div>
                                            )}

                                            {harnesses.length > 0 && (
                                                <SettingsAnimatedBody className="divide-y divide-warm-border">
                                                    {harnesses.map((harness) => {
                                                        const savingAction = savingHarness?.id === harness.id ? savingHarness.action : null;
                                                        const authLaunch = authLaunches[harness.id] ?? null;
                                                        const authOpening = authLaunch?.status === "opening";
                                                        const authWaiting = authLaunch?.status === "waiting";
                                                        const authAttention = authLaunch?.status === "attention";
                                                        const busy = savingAction != null;
                                                        const versionLine = formatHarnessVersionLine(harness);
                                                        const canInstall = !harness.available && !harness.installed && harness.installable;
                                                        const canUninstall = harness.installed && harness.installable;
                                                        const canUpgrade = harness.installed && harness.installable && harness.updateAvailable;
                                                        const needsAuth = harness.available && harness.auth?.status === "needs-auth";
                                                        const authMethods = needsAuth ? (harness.auth?.methods ?? []) : [];
                                                        const authMethodDescription = authMethods.length === 1 ? authMethods[0]?.description : null;
                                                        const hasTerminalAuthMethod = authMethods.some((method) => authMethodIsTerminal(method));
                                                        const hasEnvVarAuthMethod = authMethods.some((method) => authMethodIsEnvVar(method));
                                                        const envVarAuthNames = authMethods.flatMap((method) => authMethodIsEnvVar(method) ? authMethodVariableNames(method) : []);
                                                        const busyMessage = harnessBusyMessage(harness.label, savingAction);
                                                        const busyStatusLabel = harnessBusyStatusLabel(savingAction);
                                                        const activeAuthMethod = authLaunch?.methodId
                                                            ? authMethods.find((method) => method.id === authLaunch.methodId)
                                                            : authMethods[0];
                                                        const authOpeningStatusLabel = authMethodIsTerminal(activeAuthMethod) ? "Opening setup…" : "Opening sign in…";
                                                        const status = busyStatusLabel
                                                            ? { label: busyStatusLabel, className: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" }
                                                            : authOpening
                                                                ? { label: authOpeningStatusLabel, className: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" }
                                                                : authWaiting
                                                                    ? { label: "Waiting for auth…", className: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" }
                                                                    : authAttention
                                                                        ? { label: "Auth still pending", className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" }
                                                                        : harnessStatus(harness);
                                                        const authBlocked = harness.available && harnessAuthBlocksEnable(harness);
                                                        const switchChecked = harness.enabled;
                                                        const showEnableSwitch = (harness.available || harness.enabled) && (!authBlocked || harness.enabled);
                                                        const switchDisabled = busy || (!harness.enabled && (authBlocked || !harness.available));
                                                        const switchDisabledReason = busy
                                                            ? `${harness.label} is ${savingAction === "install"
                                                                ? "installing"
                                                                : savingAction === "upgrade"
                                                                    ? "upgrading"
                                                                    : savingAction === "uninstall"
                                                                        ? "uninstalling"
                                                                        : "checking"}.`
                                                            : authBlocked
                                                                ? hasEnvVarAuthMethod
                                                                    ? `Configure ${harness.label} credentials before enabling.`
                                                                    : needsAuth
                                                                        ? `Authenticate ${harness.label} before enabling.`
                                                                        : `Check ${harness.label} auth before enabling.`
                                                                : !harness.available && !harness.enabled
                                                                    ? `Install ${harness.label} before enabling.`
                                                                    : undefined;
                                                        const switchReasonId = switchDisabledReason ? `agent-switch-reason-${harness.id}` : undefined;
                                                        return (
                                                            <div
                                                                key={harness.id}
                                                                className="grid w-full grid-cols-[minmax(0,1fr)_minmax(8rem,24rem)] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-warm-muted disabled:cursor-not-allowed disabled:opacity-60"
                                                            >
                                                                <div className="min-w-0">
                                                                    <span className="flex items-center gap-2">
                                                                        <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                                                                            {harness.label}
                                                                        </span>
                                                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>
                                                                            {status.label}
                                                                        </span>
                                                                    </span>
                                                                    <span className="mt-0.5 block truncate font-mono text-xs text-stone-500 dark:text-stone-400">
                                                                        {harness.binary}
                                                                    </span>
                                                                    {versionLine && (
                                                                        <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
                                                                            {versionLine}
                                                                        </span>
                                                                    )}
                                                                    {harness.auth && (
                                                                        <span className="mt-1 block text-xs text-stone-600 dark:text-stone-300">
                                                                            {harness.auth.message}
                                                                        </span>
                                                                    )}
                                                                    {authMethodDescription && !harness.auth?.message.includes(authMethodDescription) && (
                                                                        <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
                                                                            {authMethodDescription}
                                                                        </span>
                                                                    )}
                                                                    {busyMessage && (
                                                                        <span className="mt-1 block text-xs text-sky-700 dark:text-sky-300" aria-live="polite">
                                                                            {busyMessage}
                                                                        </span>
                                                                    )}
                                                                    {(authWaiting || authAttention) && (
                                                                        <span className={`mt-1 block text-xs ${authAttention ? "text-amber-700 dark:text-amber-300" : "text-sky-700 dark:text-sky-300"}`}>
                                                                            {authAttention
                                                                                ? (authLaunch.message ?? `Still waiting for ${harness.label} auth.`)
                                                                                : (authLaunch.message ?? `Waiting for ${harness.label} auth…`)}
                                                                        </span>
                                                                    )}
                                                                    {needsAuth && harness.auth?.command && (
                                                                        <details className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                                                                            <summary className="cursor-pointer select-none font-medium text-stone-600 dark:text-stone-300">
                                                                                Manual fallback
                                                                            </summary>
                                                                            <span className="mt-1 block leading-5">
                                                                                {hasTerminalAuthMethod
                                                                                    ? "Configure the required credentials in the agent terminal, settings, or environment, then click Check again."
                                                                                    : hasEnvVarAuthMethod
                                                                                        ? `Set ${envVarAuthNames.length > 0 ? envVarAuthNames.join(", ") : "the required environment variables"} in your agent environment, then click Check again.`
                                                                                        : <>If Sign in does not open, run <code className="rounded bg-warm-muted px-1 font-mono">{harness.auth.command}</code> and follow the agent auth prompt.</>}
                                                                            </span>
                                                                        </details>
                                                                    )}
                                                                    {!harness.available && !canInstall && harness.homepage && (
                                                                        <span className="mt-1 block break-all text-xs text-stone-500 dark:text-stone-400">
                                                                            Docs: {harness.homepage}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                                                                    {canInstall && (
                                                                        <button
                                                                            type="button"
                                                                            aria-label={`Install ${harness.label}`}
                                                                            disabled={busy}
                                                                            onClick={() => onInstallHarness(harness.id)}
                                                                            className={settingsCompactSecondaryButtonClass}
                                                                        >
                                                                            {savingAction === "install" ? "Installing…" : "Install"}
                                                                        </button>
                                                                    )}
                                                                    {canUpgrade && (
                                                                        <button
                                                                            type="button"
                                                                            aria-label={`Upgrade ${harness.label}`}
                                                                            disabled={busy}
                                                                            onClick={() => { void onUpgradeHarness(harness.id); }}
                                                                            className="rounded-lg border border-brand/30 bg-brand-light px-3 py-1.5 text-xs font-medium text-brand shadow-sm transition-colors hover:bg-brand-light/80 disabled:cursor-not-allowed disabled:opacity-60"
                                                                        >
                                                                            {savingAction === "upgrade" ? "Upgrading…" : "Upgrade"}
                                                                        </button>
                                                                    )}
                                                                    {canUninstall && (
                                                                        <button
                                                                            type="button"
                                                                            aria-label={`Uninstall ${harness.label}`}
                                                                            disabled={busy}
                                                                            onClick={() => setUninstallHarnessTarget(harness)}
                                                                            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 shadow-sm transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/40 dark:bg-stone-900 dark:text-rose-300 dark:hover:bg-rose-500/10"
                                                                        >
                                                                            {savingAction === "uninstall" ? "Uninstalling…" : "Uninstall"}
                                                                        </button>
                                                                    )}
                                                                    {authBlocked && (
                                                                        <button
                                                                            type="button"
                                                                            aria-label={`Check ${harness.label} auth again`}
                                                                            disabled={busy || harnessLoading}
                                                                            onClick={() => { void onRecheckHarnesses(harness.id); }}
                                                                            title={savingAction === "probe" ? `Checking ${harness.label} auth.` : harnessLoading ? "A global agent check is already running." : `Check ${harness.label} auth again.`}
                                                                            className={settingsCompactSecondaryButtonClass}
                                                                        >
                                                                            {savingAction === "probe" ? "Checking auth…" : "Check again"}
                                                                        </button>
                                                                    )}
                                                                    {needsAuth && authMethods.length > 1 && authMethods.map((method) => {
                                                                        const methodLabel = method.name ?? method.id;
                                                                        const buttonLabel = authActionLabel(method, true);
                                                                        const methodActive = authLaunch?.methodId === method.id;
                                                                        const methodOpening = authOpening && methodActive;
                                                                        const methodWaiting = (authWaiting || authAttention) && methodActive;
                                                                        const methodOpeningLabel = authMethodIsTerminal(method) ? "Opening setup…" : "Opening sign in…";
                                                                        return (
                                                                            <button
                                                                                key={method.id}
                                                                                type="button"
                                                                                aria-label={authActionAriaLabel(harness.label, method, true)}
                                                                                disabled={busy && !methodWaiting}
                                                                                onClick={() => onAuthenticateHarness(harness.id, method.id)}
                                                                                className="rounded-lg border border-brand/30 bg-brand-light px-3 py-1.5 text-xs font-medium text-brand shadow-sm transition-colors hover:bg-brand-light/80 disabled:cursor-not-allowed disabled:opacity-60"
                                                                            >
                                                                                {methodOpening ? methodOpeningLabel : methodWaiting ? `Open ${methodLabel} again` : buttonLabel}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                    {needsAuth && authMethods.length === 1 && (
                                                                        <button
                                                                            type="button"
                                                                            aria-label={authActionAriaLabel(harness.label, authMethods[0], false)}
                                                                            disabled={busy && !(authWaiting || authAttention)}
                                                                            onClick={() => onAuthenticateHarness(harness.id, authMethods[0]?.id)}
                                                                            className="rounded-lg border border-brand/30 bg-brand-light px-3 py-1.5 text-xs font-medium text-brand shadow-sm transition-colors hover:bg-brand-light/80 disabled:cursor-not-allowed disabled:opacity-60"
                                                                        >
                                                                            {authOpening
                                                                                ? (authMethodIsTerminal(authMethods[0]) ? "Opening setup…" : "Opening sign in…")
                                                                                : (authWaiting || authAttention) ? "Open again" : authActionLabel(authMethods[0], false)}
                                                                        </button>
                                                                    )}
                                                                    {showEnableSwitch && (
                                                                        <>
                                                                            <Switch
                                                                                checked={switchChecked}
                                                                                aria-label={`${switchChecked ? "Disable" : "Enable"} ${harness.label} agent`}
                                                                                aria-describedby={switchReasonId}
                                                                                title={switchDisabledReason}
                                                                                disabled={switchDisabled}
                                                                                onCheckedChange={(checked) => { void onToggleHarness(harness.id, checked); }}
                                                                            />
                                                                            {switchDisabledReason && (
                                                                                <span id={switchReasonId} className="sr-only">
                                                                                    {switchDisabledReason}
                                                                                </span>
                                                                            )}
                                                                        </>
                                                                    )}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </SettingsAnimatedBody>
                                            )}
                                        </>
                                    ) : group.runtime?.agents.length ? (
                                        <SettingsAnimatedBody className="divide-y divide-warm-border">
                                            {group.runtime.agents.map((agent) => {
                                                const status = agent.auth?.status === "needs-auth"
                                                    ? "Auth needed"
                                                    : agent.auth?.status === "configured"
                                                        ? "Auth configured"
                                                        : "Reported";
                                                return (
                                                    <div key={`${group.id}-${agent.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3">
                                                        <div className="min-w-0">
                                                            <span className="flex items-center gap-2">
                                                                <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                                                                    {agent.label ?? agent.id}
                                                                </span>
                                                                <span className="rounded-full bg-warm-muted px-2 py-0.5 text-[11px] font-medium text-stone-600 dark:text-stone-300">
                                                                    {status}
                                                                </span>
                                                            </span>
                                                            <span className="mt-0.5 block truncate font-mono text-xs text-stone-500 dark:text-stone-400">
                                                                {[agent.binary, agent.version ? `v${agent.version}` : null].filter(Boolean).join(" · ") || agent.id}
                                                            </span>
                                                            {agent.auth?.message && (
                                                                <span className="mt-1 block text-xs text-stone-600 dark:text-stone-300">
                                                                    {agent.auth.message}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                                                            {agent.config_options?.length ? `${agent.config_options.length} options` : "Read-only"}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </SettingsAnimatedBody>
                                    ) : (
                                        <div className="px-4 py-5 text-sm text-stone-600 dark:text-stone-300">
                                            No agents reported by this runtime.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="mt-4 space-y-3 border-t border-warm-border/80 pt-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Custom agent servers</h3>
                        <p className="mt-0.5 text-xs text-stone-600 dark:text-stone-300">
                            {Object.keys(agentServers).length > 0
                                ? `${Object.keys(agentServers).length} custom server${Object.keys(agentServers).length === 1 ? "" : "s"} configured.`
                                : "Add command-backed ACP agent servers."}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={openAddCustomAgentDialog}
                        className={`${settingsCompactSecondaryButtonClass} gap-1.5`}
                    >
                        <Plus className="h-3.5 w-3.5" weight="bold" />
                        Add custom agent server
                    </button>
                </div>
                {Object.entries(agentServers).length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-warm-border bg-warm-surface">
                        {Object.entries(agentServers).map(([name, server]) => (
                            <div
                                key={name}
                                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-warm-border px-4 py-2.5 last:border-b-0"
                            >
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{name}</div>
                                    <div className="mt-0.5 truncate font-mono text-xs text-stone-500 dark:text-stone-400">
                                        {formatAgentCommand(server)}
                                    </div>
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => openEditCustomAgentDialog(name, server)}
                                        className={settingsCompactSecondaryButtonClass}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { void onRemoveCustomAgentServer(name); }}
                                        disabled={agentServersSaving}
                                        className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 shadow-sm transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/40 dark:bg-stone-900 dark:text-rose-300"
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                <div className="rounded-xl border border-warm-border bg-warm-surface p-4">
                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Prompt queue</h3>
                            <p className="mt-0.5 text-xs text-stone-600 dark:text-stone-300">
                                When enabled, follow-up messages wait for the current agent loop. Turn it off to send every message as a prompt immediately.
                            </p>
                        </div>
                        <Switch
                            checked={rt.promptQueueEnabled}
                            aria-label={`${rt.promptQueueEnabled ? "Disable" : "Enable"} prompt queue`}
                            onCheckedChange={(checked) => rt.setPromptQueueEnabled(checked)}
                        />
                    </div>
                </div>
            </div>

            <CustomAgentServerDialog
                open={customAgentDialogOpen}
                editing={customAgentOriginalName != null}
                starterId={customAgentStarterId}
                name={customAgentName}
                command={customAgentCommand}
                argsText={customAgentArgsText}
                envText={customAgentEnvText}
                error={customAgentError}
                saving={agentServersSaving}
                onClose={() => setCustomAgentDialogOpen(false)}
                onStarterChange={applyCustomAgentStarter}
                onNameChange={setCustomAgentName}
                onCommandChange={setCustomAgentCommand}
                onArgsTextChange={setCustomAgentArgsText}
                onEnvTextChange={setCustomAgentEnvText}
                onSave={() => { void onSaveCustomAgentServer(); }}
            />
            <UninstallHarnessDialog
                harness={uninstallHarnessTarget}
                busy={Boolean(uninstallHarnessTarget && savingHarness && savingHarness.id === uninstallHarnessTarget.id && savingHarness.action === "uninstall")}
                onClose={() => {
                    if (savingHarness?.action === "uninstall") return;
                    setUninstallHarnessTarget(null);
                }}
                onConfirm={(harnessId) => { void onUninstallHarness(harnessId); }}
            />
        </section>
    );

}

function UninstallHarnessDialog({
    harness,
    busy,
    onClose,
    onConfirm,
}: {
    harness: LocalHarnessInfo | null;
    busy: boolean;
    onClose: () => void;
    onConfirm: (harnessId: string) => void;
}) {
    return (
        <Dialog
            open={!!harness}
            onClose={onClose}
            title={harness ? `Uninstall ${harness.label}?` : "Uninstall agent?"}
            description={harness ? (
                <>
                    This removes the Clash-managed ACP install at <code className="font-mono">{harness.binary}</code>. Local agents installed outside Clash are not removed.
                </>
            ) : undefined}
            size="sm"
            disableBackdropClose={busy}
        >
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={busy}
                    className={settingsSecondaryButtonClass}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    aria-label={harness ? `Confirm uninstall ${harness.label}` : "Confirm uninstall agent"}
                    onClick={() => harness && onConfirm(harness.id)}
                    disabled={!harness || busy}
                    className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
                >
                    {busy ? "Uninstalling…" : "Uninstall"}
                </button>
            </div>
        </Dialog>
    );
}

interface CustomAgentServerDialogProps {
    open: boolean;
    editing: boolean;
    starterId: string;
    name: string;
    command: string;
    argsText: string;
    envText: string;
    error: string | null;
    saving: boolean;
    onClose: () => void;
    onStarterChange: (starterId: string) => void;
    onNameChange: (value: string) => void;
    onCommandChange: (value: string) => void;
    onArgsTextChange: (value: string) => void;
    onEnvTextChange: (value: string) => void;
    onSave: () => void;
}

function CustomAgentServerDialog({
    open,
    editing,
    starterId,
    name,
    command,
    argsText,
    envText,
    error,
    saving,
    onClose,
    onStarterChange,
    onNameChange,
    onCommandChange,
    onArgsTextChange,
    onEnvTextChange,
    onSave,
}: CustomAgentServerDialogProps) {
    const title = editing ? "Edit custom agent server" : "Add custom agent server";
    const previewName = name.trim() || "my-agent";
    const previewCommand = command.trim() || "<command>";
    const previewArgs = parseArgsText(argsText);
    let previewEnv: Record<string, string> = {};
    try {
        const parsedEnv = JSON.parse(envText || "{}") as unknown;
        if (parsedEnv && typeof parsedEnv === "object" && !Array.isArray(parsedEnv)) {
            previewEnv = Object.fromEntries(
                Object.entries(parsedEnv as Record<string, unknown>)
                    .filter(([, value]) => typeof value === "string"),
            ) as Record<string, string>;
        }
    } catch {
        previewEnv = {};
    }
    const settingsPreview = JSON.stringify({
        agent_servers: {
            [previewName]: {
                type: "custom",
                command: previewCommand,
                args: previewArgs,
                env: previewEnv,
            },
        },
    }, null, 2);
    return (
        <Dialog
            open={open}
            onClose={onClose}
            ariaLabel={title}
            size="xl"
            unstyled
        >
            <div className="absolute left-1/2 top-1/2 w-[min(56rem,100%)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-warm-border bg-warm-surface shadow-xl dark:bg-stone-950">
                <div className="flex max-h-[min(34rem,82vh)] min-h-[24rem] flex-col sm:min-h-[28rem] sm:flex-row">
                    <aside className="w-full shrink-0 border-b border-warm-border bg-warm-muted/55 p-3 dark:bg-stone-900/70 sm:w-56 sm:border-b-0 sm:border-r">
                        <div className="mb-2 px-2 text-[11px] font-semibold uppercase text-stone-500 dark:text-stone-400">
                            Starter
                        </div>
                        <div className="grid grid-cols-3 gap-1 sm:block sm:space-y-1">
                            {CUSTOM_AGENT_SERVER_STARTERS.map((starter) => {
                                const selected = starterId === starter.id;
                                return (
                                    <button
                                        key={starter.id}
                                        type="button"
                                        onClick={() => onStarterChange(starter.id)}
                                        className={`w-full truncate rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors ${
                                            selected
                                                ? "bg-white text-brand shadow-sm ring-1 ring-brand/25 dark:bg-stone-950"
                                                : "text-slate-700 hover:bg-white/70 dark:text-stone-200 dark:hover:bg-stone-800"
                                        }`}
                                    >
                                        {starter.label}
                                    </button>
                                );
                            })}
                        </div>
                    </aside>

                    <div className="flex min-w-0 flex-1 flex-col">
                        <header className="flex items-start justify-between gap-4 border-b border-warm-border px-5 py-4">
                            <div className="min-w-0">
                                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-50">
                                    {title}
                                </h2>
                            </div>
                            <button
                                type="button"
                                aria-label="Close"
                                onClick={onClose}
                                className="rounded-md p-1.5 text-stone-500 transition-colors hover:bg-warm-muted hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-stone-300 dark:hover:text-stone-100"
                            >
                                <X className="h-4 w-4" weight="bold" aria-hidden="true" />
                            </button>
                        </header>

                        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                            <div className="space-y-4">
                                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                    <label className="block">
                                        <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">
                                            Name
                                        </span>
                                        <input
                                            aria-label="Agent server name"
                                            value={name}
                                            onChange={(event) => onNameChange(event.target.value)}
                                            className="clash-settings-field h-9 w-full rounded-lg px-3 text-sm text-slate-900 placeholder:text-stone-400 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-50 dark:placeholder:text-stone-500"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">
                                            Command
                                        </span>
                                        <input
                                            aria-label="Command"
                                            value={command}
                                            onChange={(event) => onCommandChange(event.target.value)}
                                            className="clash-settings-field h-9 w-full rounded-lg px-3 font-mono text-sm text-slate-900 placeholder:text-stone-400 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-50 dark:placeholder:text-stone-500"
                                        />
                                    </label>
                                </div>

                                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                    <label className="block min-w-0">
                                        <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">
                                            Arguments
                                        </span>
                                        <textarea
                                            aria-label="Arguments"
                                            value={argsText}
                                            onChange={(event) => onArgsTextChange(event.target.value)}
                                            spellCheck={false}
                                            rows={6}
                                            className="clash-settings-field min-h-[9rem] w-full resize-y rounded-lg px-3 py-2 font-mono text-xs leading-5 text-slate-900 placeholder:text-stone-400 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-50 dark:placeholder:text-stone-500"
                                        />
                                    </label>

                                    <label className="block min-w-0">
                                        <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">
                                            Environment
                                        </span>
                                        <textarea
                                            aria-label="Environment"
                                            value={envText}
                                            onChange={(event) => onEnvTextChange(event.target.value)}
                                            spellCheck={false}
                                            rows={6}
                                            className="clash-settings-field min-h-[9rem] w-full resize-y rounded-lg px-3 py-2 font-mono text-xs leading-5 text-slate-900 placeholder:text-stone-400 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-50 dark:placeholder:text-stone-500"
                                        />
                                    </label>
                                </div>

                                <div>
                                    <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">
                                        Settings preview
                                    </span>
                                    <pre className="max-h-36 overflow-auto rounded-lg border border-warm-border bg-warm-muted/55 px-3 py-2 font-mono text-xs leading-5 text-stone-600 dark:text-stone-300">
                                        {settingsPreview}
                                    </pre>
                                </div>

                                {error && (
                                    <div role="alert" className={settingsErrorAlertClass}>
                                        {error}
                                    </div>
                                )}
                            </div>
                        </div>

                        <footer className="flex justify-end gap-2 border-t border-warm-border bg-warm-muted/40 px-5 py-3 dark:bg-stone-900/60">
                            <button
                                type="button"
                                onClick={onClose}
                                className={settingsSecondaryButtonClass}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={onSave}
                                disabled={saving}
                                className="clash-settings-primary inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {saving ? "Saving…" : "Save agent server"}
                            </button>
                        </footer>
                    </div>
                </div>
            </div>
        </Dialog>
    );
}
