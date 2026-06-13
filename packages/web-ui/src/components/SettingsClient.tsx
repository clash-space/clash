
import { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Plus, Trash, Copy, Check, ArrowLeft, Lock, Eye, EyeSlash, PuzzlePiece, BookOpen, Terminal, Plug, CloudArrowUp } from '@phosphor-icons/react';
import { useClashRuntime } from '@clash/web-ui/hooks/useClashRuntime';
import { Link } from 'react-router';
import { ACTION_PROVIDER_PRESETS, CustomActionDefinitionSchema, normalizeActionProviderId } from '@clash/shared-types';
import {
    createApiToken, revokeApiToken, type ApiTokenInfo,
    setVariable, deleteVariable, type VariableInfo,
    uninstallAction, type InstalledActionInfo,
    uninstallSkill, type InstalledSkillInfo,
    updateModelProviders, listModelCatalog, type ModelProviderAccountInfo, type ModelCatalogEntryInfo,
} from '@clash/web-ui/lib/clientActions';
import { runtimeApiUrl } from '@clash/web-ui/lib/runtimeConfig';

/** Stable identifiers for each section pane — shared between the legacy
 *  SettingsDialog. The dialog uses these as its sidebar nav keys. */
export type SettingsSection =
    | 'runtimes'
    | 'sync'
    | 'tokens'
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
     *  SettingsDialog's content pane. */
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
    const [modelProviderSaved, setModelProviderSaved] = useState(false);

    const variableKeys = new Set(variables.map((v) => v.key));
    const providerPresets = Object.values(ACTION_PROVIDER_PRESETS);
    const modelProviderRows = useMemo(() => buildModelProviderRows(modelProviders, variableKeys), [modelProviders, variables]);
    const modelTierCounts = useMemo(() => countModelCatalogTiers(modelCatalog), [modelCatalog]);

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

    const handlePatchModelProvider = useCallback((key: string, patch: Partial<ModelProviderAccountInfo>) => {
        setModelProviders((prev) => {
            const row = buildModelProviderRows(prev).find((provider) => modelProviderKey(provider) === key);
            if (!row) return prev;
            return upsertModelProvider(prev, { ...row, ...patch });
        });
        setModelProviderSaved(false);
        setModelProviderError(null);
    }, []);

    const handleSaveModelProviders = useCallback(async () => {
        if (modelProviders.length === 0) return;
        setIsSavingModelProviders(true);
        setModelProviderSaved(false);
        setModelProviderError(null);
        try {
            const savedProviders = await updateModelProviders(modelProviders);
            setModelProviders(savedProviders);
            setModelCatalog(await listModelCatalog());
            setModelProviderSaved(true);
        } catch (err) {
            setModelProviderError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSavingModelProviders(false);
        }
    }, [modelProviders]);

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
    // host (SettingsDialog) provides its own modal chrome.
    const content = (
        <div className={embedded ? 'space-y-12' : 'mx-auto max-w-3xl px-6 py-10 space-y-12'}>

                {/* ── Runtimes ── */}
                {showSection('runtimes') && <RuntimesSection />}

                {/* ── Sync ── */}
                {showSection('sync') && <SyncSection />}

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
                            className="flex-1 rounded-xl border border-warm-border bg-warm-surface px-4 py-2 text-sm text-slate-900 placeholder:text-stone-400 focus:border-brand focus:outline-none transition-colors dark:text-slate-50 dark:placeholder:text-stone-500"
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

                {/* ── Variables ── */}
                {showSection('variables') && (
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
                            className="w-36 rounded-xl border border-warm-border bg-warm-surface px-4 py-2 text-sm font-mono text-slate-900 dark:text-slate-50 placeholder:text-stone-400 focus:border-brand focus:outline-none transition-colors"
                        />
                        <div className="flex-1 relative">
                            <input
                                type={showVarValue ? 'text' : 'password'}
                                value={newVarValue}
                                onChange={(e) => setNewVarValue(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddVariable()}
                                placeholder="Value"
                                autoComplete="new-password"
                                className="w-full rounded-xl border border-warm-border bg-warm-surface px-4 py-2 pr-9 text-sm text-slate-900 placeholder:text-stone-400 focus:border-brand focus:outline-none transition-colors dark:text-slate-50 dark:placeholder:text-stone-500"
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
                    providers={modelProviderRows}
                    catalog={modelCatalog}
                    tierCounts={modelTierCounts}
                    onPatchProvider={handlePatchModelProvider}
                    onSave={handleSaveModelProviders}
                    saving={isSavingModelProviders}
                    saveDisabled={modelProviders.length === 0}
                    saved={modelProviderSaved}
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
                        <Link to="/marketplace" className="text-sm font-medium text-stone-600 transition-colors hover:text-brand dark:text-stone-300 dark:hover:text-brand">
                            Browse
                        </Link>
                    </div>

                    {actions.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-warm-border py-10 text-center">
                            <PuzzlePiece className="h-8 w-8 text-stone-500 mx-auto mb-2 dark:text-stone-500" weight="duotone" />
                            <p className="text-sm text-stone-600 dark:text-stone-300 mb-2">No actions installed</p>
                            <Link to="/marketplace" className="text-sm font-medium text-slate-950 transition-colors hover:text-brand dark:text-slate-50 dark:hover:text-brand">
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
                            <p className="text-sm text-stone-600 dark:text-stone-300">AI agent skills for Claude Code</p>
                        </div>
                        <Link to="/marketplace" className="text-sm font-medium text-stone-600 transition-colors hover:text-brand dark:text-stone-300 dark:hover:text-brand">
                            Browse
                        </Link>
                    </div>

                    {skills.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-warm-border py-10 text-center">
                            <BookOpen className="h-8 w-8 text-stone-500 mx-auto mb-2 dark:text-stone-500" weight="duotone" />
                            <p className="text-sm text-stone-600 dark:text-stone-300 mb-2">No skills installed</p>
                            <Link to="/marketplace" className="text-sm font-medium text-slate-950 transition-colors hover:text-brand dark:text-slate-50 dark:hover:text-brand">
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
    { providerId: 'official', upstreamId: 'google', region: 'global', enabled: false, priority: 20 },
    { providerId: 'fal', upstreamId: 'fal', enabled: false, priority: 30 },
    { providerId: 'kie', upstreamId: 'kie', enabled: false, priority: 40 },
    { providerId: 'replicate', upstreamId: 'replicate', enabled: false, priority: 50 },
];

function modelProviderKey(provider: Pick<ModelProviderAccountInfo, 'providerId' | 'upstreamId' | 'region'>): string {
    return [provider.providerId, provider.upstreamId ?? '', provider.region ?? ''].join(':');
}

function modelProviderLabel(provider: Pick<ModelProviderAccountInfo, 'providerId' | 'upstreamId' | 'region'>): string {
    return [
        provider.providerId,
        provider.upstreamId,
        provider.region,
    ].filter(Boolean).join('/');
}

function requiredModelProviderVariables(provider: Pick<ModelProviderAccountInfo, 'providerId' | 'upstreamId'>): string[] {
    if (provider.providerId === 'fal') return ['FAL_API_KEY'];
    if (provider.providerId === 'kie') return ['KIE_API_KEY'];
    if (provider.providerId === 'replicate') return ['REPLICATE_API_TOKEN'];
    if (provider.providerId === 'official' && provider.upstreamId === 'openai') return ['OPENAI_API_KEY'];
    if (provider.providerId === 'official' && provider.upstreamId === 'google') return ['GOOGLE_API_KEY', 'GOOGLE_VERTEX'];
    return [];
}

function withVariableAvailability(
    provider: ModelProviderAccountInfo,
    variableKeys?: Set<string>,
): ModelProviderAccountInfo {
    const required = requiredModelProviderVariables(provider);
    const discovered = variableKeys ? required.filter((key) => variableKeys.has(key)) : [];
    const availableVariables = provider.availableVariables?.length ? provider.availableVariables : discovered;
    return {
        ...provider,
        ...(availableVariables.length ? { availableVariables } : { availableVariables: [] }),
    };
}

function buildModelProviderRows(
    configured: ModelProviderAccountInfo[],
    variableKeys?: Set<string>,
): ModelProviderAccountInfo[] {
    const rows = new Map<string, ModelProviderAccountInfo>();
    for (const preset of MODEL_PROVIDER_PRESETS) {
        rows.set(modelProviderKey(preset), withVariableAvailability(preset, variableKeys));
    }
    for (const provider of configured) {
        rows.set(modelProviderKey(provider), withVariableAvailability(provider, variableKeys));
    }
    return [...rows.values()];
}

function upsertModelProvider(
    providers: ModelProviderAccountInfo[],
    next: ModelProviderAccountInfo,
): ModelProviderAccountInfo[] {
    const key = modelProviderKey(next);
    const filtered = providers.filter((provider) => modelProviderKey(provider) !== key);
    return [...filtered, next];
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

interface ModelRoutingSectionProps {
    providers: ModelProviderAccountInfo[];
    catalog: ModelCatalogEntryInfo[];
    tierCounts: ReturnType<typeof countModelCatalogTiers>;
    onPatchProvider: (key: string, patch: Partial<ModelProviderAccountInfo>) => void;
    onSave: () => void;
    saving: boolean;
    saveDisabled: boolean;
    saved: boolean;
    error: string | null;
}

function ModelRoutingSection({
    providers,
    catalog,
    tierCounts,
    onPatchProvider,
    onSave,
    saving,
    saveDisabled,
    saved,
    error,
}: ModelRoutingSectionProps) {
    const visibleCatalog = catalog.slice(0, 18);

    return (
        <section>
            <div className="flex items-center gap-3 mb-5">
                <Plug className="h-5 w-5 text-stone-600 dark:text-stone-300" weight="bold" />
                <div className="flex-1">
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Models</h2>
                    <p className="text-sm text-stone-600 dark:text-stone-300">Provider accounts and model cards</p>
                </div>
                <button
                    type="button"
                    onClick={onSave}
                    disabled={saving || saveDisabled}
                    className={settingsSmallPrimaryButtonClass}
                >
                    {saving ? 'Saving…' : 'Save routing'}
                </button>
            </div>

            <div className="mb-6 grid grid-cols-3 gap-2">
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
            </div>

            <div className="space-y-8">
                <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-50">Provider routing</h3>
                    <div className="divide-y divide-warm-border border-y border-warm-border">
                        {providers.map((provider) => {
                            const key = modelProviderKey(provider);
                            const label = modelProviderLabel(provider);
                            const configuredKeys = provider.availableVariables ?? [];
                            const requiredKeys = requiredModelProviderVariables(provider);
                            const enabled = provider.enabled !== false;
                            return (
                                <div key={key} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_88px_88px] sm:items-center">
                                    <label className="flex min-w-0 items-start gap-3">
                                        <input
                                            type="checkbox"
                                            aria-label={`Enable ${label}`}
                                            checked={enabled}
                                            onChange={(e) => onPatchProvider(key, { enabled: e.target.checked })}
                                            className="mt-1 h-4 w-4 rounded border-warm-border text-brand focus:ring-brand/40"
                                        />
                                        <span className="min-w-0">
                                            <span className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-medium text-slate-900 dark:text-slate-50">{label}</span>
                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'}`}>
                                                    {enabled ? 'Enabled' : 'Disabled'}
                                                </span>
                                            </span>
                                            <span className="mt-1 block truncate text-xs text-stone-500 dark:text-stone-400">
                                                {configuredKeys.length > 0
                                                    ? configuredKeys.join(', ')
                                                    : requiredKeys.length > 0
                                                        ? `Missing ${requiredKeys.join(' or ')}`
                                                        : 'Custom key'}
                                            </span>
                                        </span>
                                    </label>
                                    <label className="block">
                                        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">Weight</span>
                                        <input
                                            aria-label={`Weight for ${label}`}
                                            type="number"
                                            min={0}
                                            value={provider.weight ?? ''}
                                            onChange={(e) => onPatchProvider(key, {
                                                weight: e.target.value === '' ? undefined : Number(e.target.value),
                                            })}
                                            className="w-full rounded-lg border border-warm-border bg-warm-surface px-2 py-1.5 text-sm text-slate-900 focus:border-brand focus:outline-none dark:text-slate-50"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">Priority</span>
                                        <input
                                            aria-label={`Priority for ${label}`}
                                            type="number"
                                            min={0}
                                            value={provider.priority ?? ''}
                                            onChange={(e) => onPatchProvider(key, {
                                                priority: e.target.value === '' ? undefined : Number(e.target.value),
                                            })}
                                            className="w-full rounded-lg border border-warm-border bg-warm-surface px-2 py-1.5 text-sm text-slate-900 focus:border-brand focus:outline-none dark:text-slate-50"
                                        />
                                    </label>
                                </div>
                            );
                        })}
                    </div>
                    {error && <div role="alert" className={`${settingsErrorAlertClass} mt-3`}>{error}</div>}
                    {saved && !error && (
                        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                            Routing saved.
                        </div>
                    )}
                </div>

                <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-50">Model cards</h3>
                    {visibleCatalog.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-warm-border py-8 text-center text-sm text-stone-600 dark:text-stone-300">
                            No model cards loaded
                        </div>
                    ) : (
                        <div className="divide-y divide-warm-border border-y border-warm-border">
                            {visibleCatalog.map((entry) => {
                                const route = entry.selectedRoute;
                                const routeLabel = route
                                    ? `${route.providerId ?? route.upstreamId}/${route.upstreamId}`
                                    : entry.candidateProviders.join(', ');
                                return (
                                    <div key={entry.model.id} className="flex items-center justify-between gap-3 py-3">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-medium text-slate-900 dark:text-slate-50">{entry.model.name}</span>
                                                <span className="rounded-full bg-warm-muted px-2 py-0.5 text-[10px] font-medium text-stone-600 dark:text-stone-300">
                                                    {entry.model.kind}
                                                </span>
                                            </div>
                                            <div className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">
                                                {routeLabel || 'No route'}
                                                {entry.missingVariables.length > 0 ? ` · Missing ${entry.missingVariables.join(', ')}` : ''}
                                            </div>
                                        </div>
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                            entry.tier === 'available'
                                                ? 'bg-emerald-50 text-emerald-700'
                                                : entry.tier === 'configured-provider'
                                                    ? 'bg-amber-50 text-amber-700'
                                                    : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'
                                        }`}>
                                            {entry.tier === 'configured-provider' ? 'Needs key' : entry.tier}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
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
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [mode, setMode] = useState<'local-only' | 'cloud-sync'>('local-only');
    const [remoteUrl, setRemoteUrl] = useState('');
    const [remoteToken, setRemoteToken] = useState('');
    const [hasToken, setHasToken] = useState(false);
    const [source, setSource] = useState<'none' | 'env' | 'config'>('none');

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
                setError(null);
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

    const onSave = async () => {
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            const body: Record<string, unknown> = {
                mode,
                remote_loro_url: mode === 'cloud-sync' ? remoteUrl.trim() : null,
            };
            if (remoteToken.trim()) body.remote_loro_token = remoteToken.trim();
            const res = await fetch(runtimeApiUrl('/api/v1/local/sync'), {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const json = await res.json().catch(() => null) as { error?: string } | null;
                throw new Error(json?.error ?? `HTTP ${res.status}`);
            }
            applyConfig((await res.json()) as LocalSyncConfig);
            setSaved(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

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
                <div className="rounded-xl border border-warm-border bg-warm-surface p-4 text-sm text-stone-600 dark:text-stone-300">
                    Loading sync settings…
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className={`rounded-xl border p-4 transition-colors ${mode === 'local-only' ? 'border-brand/55 bg-brand-light/45' : 'border-warm-border bg-warm-surface hover:border-brand/35'}`}>
                            <input
                                type="radio"
                                name="sync-mode"
                                value="local-only"
                                checked={mode === 'local-only'}
                                onChange={() => setMode('local-only')}
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
                                onChange={() => setMode('cloud-sync')}
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
                                onChange={(e) => setRemoteUrl(e.target.value)}
                                placeholder="https://api.example.com"
                                disabled={mode !== 'cloud-sync'}
                                className="w-full rounded-lg border border-warm-border bg-warm-surface px-3 py-2 text-sm text-slate-900 placeholder:text-stone-400 focus:border-brand focus:outline-none disabled:opacity-50 dark:text-slate-50 dark:placeholder:text-stone-500"
                            />
                        </label>
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">Remote Loro token</span>
                            <input
                                aria-label="Remote Loro token"
                                type="password"
                                value={remoteToken}
                                onChange={(e) => setRemoteToken(e.target.value)}
                                placeholder={hasToken ? 'Token saved' : 'Bearer token'}
                                disabled={mode !== 'cloud-sync'}
                                className="w-full rounded-lg border border-warm-border bg-warm-surface px-3 py-2 text-sm text-slate-900 placeholder:text-stone-400 focus:border-brand focus:outline-none disabled:opacity-50 dark:text-slate-50 dark:placeholder:text-stone-500"
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
                    {saved && !error && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                            Sync settings saved.
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={onSave}
                        disabled={saving || (mode === 'cloud-sync' && !remoteUrl.trim())}
                        className={settingsPrimaryButtonClass}
                    >
                        {saving ? 'Saving…' : 'Save sync settings'}
                    </button>
                </div>
            )}
        </section>
    );
}

/**
 * Runtimes — list of machines the user has registered via `clash-bridge setup`.
 * Each row shows status (online/offline), agents detected, last heartbeat,
 * and a remove button (revokes tokens + deletes the row server-side; the
 * daemon on that machine starts getting 401 on next attach and stops).
 */
function RuntimesSection() {
    const rt = useClashRuntime();
    const [setupOpen, setSetupOpen] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);

    const onRemove = async (id: string) => {
        if (!confirm("Remove this runtime? The daemon on that machine will stop being authorized.")) return;
        setRemovingId(id);
        try {
            const res = await fetch(runtimeApiUrl(`/api/v1/runtimes/${id}`), {
                method: "DELETE",
                credentials: "include",
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await rt.refresh();
        } catch (e) {
            alert(`Failed to remove: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setRemovingId(null);
        }
    };

    return (
        <section>
            <div className="flex items-center gap-3 mb-5">
                <Plug className="h-5 w-5 text-stone-600 dark:text-stone-300" weight="bold" />
                <div className="flex-1">
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Runtimes</h2>
                    <p className="text-sm text-stone-600 dark:text-stone-300">Local machines registered with <code>clash-bridge setup</code></p>
                </div>
                <button
                    type="button"
                    onClick={() => setSetupOpen((v) => !v)}
                    className={settingsSmallPrimaryButtonClass}
                >
                    <Plus className="h-3.5 w-3.5" /> Add machine
                </button>
            </div>

            {setupOpen && (
                <div className="mb-4 rounded-xl border border-warm-border bg-warm-muted p-4">
                    <p className="text-xs text-stone-600 dark:text-stone-300 mb-2">Run on the machine you want to register:</p>
                    <code className={settingsCodeBlockClass}>
                        npx @clash-space/bridge@beta setup
                    </code>
                    <p className="mt-2 text-xs text-stone-600 dark:text-stone-300">
                        It opens this site in your browser to authorize the connection,
                        then installs a background daemon (launchd / systemd).
                        The machine appears below within a few seconds.
                    </p>
                </div>
            )}

            {rt.runtimes.length === 0 ? (
                <div className="rounded-xl border border-dashed border-warm-border p-6 text-center">
                    <p className="text-sm text-stone-600 dark:text-stone-300">No machines registered yet</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {rt.runtimes.map((r) => {
                        const online = r.status === "online";
                        const lastBeat = r.last_heartbeat
                            ? new Date(r.last_heartbeat * 1000).toLocaleString()
                            : "never";
                        return (
                            <div
                                key={r.id}
                                className="flex items-start justify-between gap-3 rounded-xl border border-warm-border bg-warm-surface p-4"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`inline-block w-2 h-2 rounded-full ${online ? "bg-emerald-500" : "bg-stone-300"}`} />
                                        <span className="font-medium text-slate-900 dark:text-slate-50">{r.hostname || r.machine_id.slice(0, 12)}</span>
                                        <span className="text-xs text-stone-500 dark:text-stone-400">{r.os} · v{r.version}</span>
                                    </div>
                                    <div className="text-xs text-stone-600 dark:text-stone-300">
                                        Agents: {r.agents.length === 0 ? "—" : r.agents.map((a) => a.id).join(", ")}
                                    </div>
                                    <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                                        Last seen: {lastBeat}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onRemove(r.id)}
                                    disabled={removingId === r.id}
                                    className="text-xs text-stone-500 transition-colors hover:text-red-600 disabled:opacity-50 dark:text-stone-400 dark:hover:text-red-400"
                                >
                                    {removingId === r.id ? "Removing…" : "Remove"}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
