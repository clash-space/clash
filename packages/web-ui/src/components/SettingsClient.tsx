
import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Plus, Trash, Copy, Check, ArrowLeft, Lock, Eye, EyeSlash, PuzzlePiece, BookOpen, Terminal, Plug, Users, Lightning } from '@phosphor-icons/react';
import { useClashRuntime } from '@clash/web-ui/hooks/useClashRuntime';
import { Link } from 'react-router';
import {
    createApiToken, revokeApiToken, type ApiTokenInfo,
    setVariable, deleteVariable, type VariableInfo,
    uninstallAction, type InstalledActionInfo,
    uninstallSkill, type InstalledSkillInfo,
} from '@clash/web-ui/lib/clientActions';

/** Stable identifiers for each section pane — shared between the legacy
 *  single-page layout (`/settings` route) and the modal layout
 *  (SettingsDialog). The dialog uses these as its sidebar nav keys. */
export type SettingsSection =
    | 'runtimes'
    | 'crew'
    | 'tokens'
    | 'variables'
    | 'actions'
    | 'skills'
    | 'cli';

interface Props {
    initialTokens: ApiTokenInfo[];
    initialVariables: VariableInfo[];
    initialActions: InstalledActionInfo[];
    initialSkills: InstalledSkillInfo[];
    /** When provided, only that section's body renders — used by
     *  SettingsDialog's content pane. */
    activeSection?: SettingsSection;
    /** When true, the sticky header / page chrome is suppressed and
     *  the layout is meant to live inside a modal panel. */
    embedded?: boolean;
}

export default function SettingsClient({
    initialTokens,
    initialVariables,
    initialActions,
    initialSkills,
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

    const variableKeys = new Set(variables.map((v) => v.key));

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

                {/* ── Crew ── */}
                {showSection('crew') && <CrewSection />}

                {/* ── API Tokens ── */}
                {showSection('tokens') && (
                <section>
                    <div className="flex items-center gap-3 mb-5">
                        <Key className="h-5 w-5 text-gray-700 dark:text-gray-300" weight="bold" />
                        <div>
                            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">API Tokens</h2>
                            <p className="text-sm text-gray-700 dark:text-gray-300">For CLI and agent access</p>
                        </div>
                    </div>

                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={newTokenName}
                            onChange={(e) => setNewTokenName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                            placeholder="Token name"
                            className="flex-1 rounded-full border border-warm-border bg-warm-surface px-4 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand focus:outline-none transition-colors dark:text-slate-50 dark:placeholder:text-slate-400"
                        />
                        <motion.button
                            onClick={handleCreate}
                            disabled={isCreating || !newTokenName.trim()}
                            className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
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
                            <p className="text-sm text-gray-700 dark:text-gray-300">No tokens yet</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {tokens.map((token) => (
                                <div key={token.id} className="group flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-warm-muted transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-slate-900 dark:text-slate-50">{token.name}</span>
                                            <code className="text-xs text-gray-700 dark:text-gray-300 dark:text-gray-400 font-mono">{token.tokenPrefix}</code>
                                        </div>
                                        <p className="text-xs text-gray-700 dark:text-gray-300 dark:text-gray-400 mt-0.5">
                                            Created {formatDate(token.createdAt)} · Last used {formatDate(token.lastUsedAt)}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => handleRevoke(token.id)}
                                        className="opacity-0 group-hover:opacity-100 rounded-lg p-1.5 text-gray-700 dark:text-gray-300 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 transition-all"
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
                        <Lock className="h-5 w-5 text-gray-700 dark:text-gray-300" weight="bold" />
                        <div>
                            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Variables</h2>
                            <p className="text-sm text-gray-700 dark:text-gray-300">Encrypted secrets for canvas actions</p>
                        </div>
                    </div>

                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={newVarKey}
                            onChange={(e) => setNewVarKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                            placeholder="KEY_NAME"
                            autoComplete="off"
                            className="w-36 rounded-full border border-warm-border bg-warm-surface px-4 py-2 text-sm font-mono text-slate-900 dark:text-slate-50 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
                        />
                        <div className="flex-1 relative">
                            <input
                                type={showVarValue ? 'text' : 'password'}
                                value={newVarValue}
                                onChange={(e) => setNewVarValue(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddVariable()}
                                placeholder="Value"
                                autoComplete="new-password"
                                className="w-full rounded-full border border-warm-border bg-warm-surface px-4 py-2 pr-9 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand focus:outline-none transition-colors dark:text-slate-50 dark:placeholder:text-slate-400"
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
                            className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            whileTap={{ scale: 0.97 }}
                        >
                            Set
                        </motion.button>
                    </div>

                    {variables.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-warm-border py-10 text-center">
                            <Lock className="h-8 w-8 text-stone-500 mx-auto mb-2 dark:text-stone-500" weight="duotone" />
                            <p className="text-sm text-gray-700 dark:text-gray-300">No variables yet</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {variables.map((v) => (
                                <div key={v.id} className="group flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-warm-muted transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <code className="text-sm font-mono font-medium text-slate-900 dark:text-slate-50">{v.key}</code>
                                            <span className="text-[10px] text-gray-700 dark:text-gray-300 dark:text-gray-400 bg-warm-muted rounded-full px-2 py-0.5">encrypted</span>
                                        </div>
                                        <p className="text-xs text-gray-700 dark:text-gray-300 dark:text-gray-400 mt-0.5">Updated {formatDate(v.updatedAt || v.createdAt)}</p>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteVariable(v.id)}
                                        className="opacity-0 group-hover:opacity-100 rounded-lg p-1.5 text-gray-700 dark:text-gray-300 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 transition-all"
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

                {/* ── Installed Actions ── */}
                {showSection('actions') && (
                <section>
                    <div className="flex items-center gap-3 mb-5">
                        <PuzzlePiece className="h-5 w-5 text-gray-700 dark:text-gray-300" weight="bold" />
                        <div className="flex-1">
                            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Installed Actions</h2>
                            <p className="text-sm text-gray-700 dark:text-gray-300">Canvas actions available in all projects</p>
                        </div>
                        <Link to="/marketplace" className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 transition-colors">
                            Browse
                        </Link>
                    </div>

                    {actions.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-warm-border py-10 text-center">
                            <PuzzlePiece className="h-8 w-8 text-stone-500 mx-auto mb-2 dark:text-stone-500" weight="duotone" />
                            <p className="text-sm text-gray-700 dark:text-gray-300 dark:text-gray-400 mb-2">No actions installed</p>
                            <Link to="/marketplace" className="text-sm font-medium text-slate-900 dark:text-slate-50 hover:text-gray-600 transition-colors">
                                Explore Marketplace
                            </Link>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {actions.map((action) => {
                                const secrets: Array<{ id: string }> = (() => {
                                    try { return JSON.parse(action.manifest)?.secrets || []; } catch { return []; }
                                })();
                                const missingSecrets = secrets.filter((s) => !variableKeys.has(s.id));
                                return (
                                    <div key={action.id} className="group rounded-xl px-4 py-3 hover:bg-warm-muted transition-colors">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-sm font-medium text-slate-900 dark:text-slate-50">{action.name}</span>
                                                    {action.version && <span className="text-xs text-gray-700 dark:text-gray-300 dark:text-gray-400 font-mono">v{action.version}</span>}
                                                    {action.author && <span className="text-xs text-gray-700 dark:text-gray-300">@{action.author}</span>}
                                                </div>
                                                {action.description && <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5 line-clamp-1">{action.description}</p>}
                                                {missingSecrets.length > 0 && (
                                                    <div className="flex items-center gap-1.5 mt-1.5">
                                                        <span className="text-[10px] text-amber-600 bg-amber-50 rounded-full px-2 py-0.5 font-medium">
                                                            {missingSecrets.length} missing {missingSecrets.length === 1 ? 'key' : 'keys'}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => handleUninstallAction(action.actionId)}
                                                className="opacity-0 group-hover:opacity-100 rounded-lg p-1.5 text-gray-700 dark:text-gray-300 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 transition-all flex-shrink-0"
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
                        <BookOpen className="h-5 w-5 text-gray-700 dark:text-gray-300" weight="bold" />
                        <div className="flex-1">
                            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Installed Skills</h2>
                            <p className="text-sm text-gray-700 dark:text-gray-300">AI agent skills for Claude Code</p>
                        </div>
                        <Link to="/marketplace" className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 transition-colors">
                            Browse
                        </Link>
                    </div>

                    {skills.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-warm-border py-10 text-center">
                            <BookOpen className="h-8 w-8 text-stone-500 mx-auto mb-2 dark:text-stone-500" weight="duotone" />
                            <p className="text-sm text-gray-700 dark:text-gray-300 dark:text-gray-400 mb-2">No skills installed</p>
                            <Link to="/marketplace" className="text-sm font-medium text-slate-900 dark:text-slate-50 hover:text-gray-600 transition-colors">
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
                                            {skill.version && <span className="text-xs text-gray-700 dark:text-gray-300 dark:text-gray-400 font-mono">v{skill.version}</span>}
                                            {skill.author && <span className="text-xs text-gray-700 dark:text-gray-300">@{skill.author}</span>}
                                        </div>
                                        {skill.description && <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5 line-clamp-1">{skill.description}</p>}
                                    </div>
                                    <button
                                        onClick={() => handleUninstallSkill(skill.skillId)}
                                        className="opacity-0 group-hover:opacity-100 rounded-lg p-1.5 text-gray-700 dark:text-gray-300 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 transition-all"
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
                        <Terminal className="h-5 w-5 text-gray-700 dark:text-gray-300" weight="bold" />
                        <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">CLI</h2>
                    </div>
                    <code className="block rounded-xl bg-warm-muted border border-warm-border px-4 py-3 text-sm font-mono text-gray-800 dark:text-gray-200">
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
                        className="flex items-center justify-center h-9 w-9 rounded-full border border-warm-border text-gray-700 dark:text-gray-300 hover:text-gray-900 hover:border-slate-300 transition-all"
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
            const res = await fetch(`/api/v1/runtimes/${id}`, {
                method: "DELETE",
                credentials: "same-origin",
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
                <Plug className="h-5 w-5 text-gray-700 dark:text-gray-300" weight="bold" />
                <div className="flex-1">
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Runtimes</h2>
                    <p className="text-sm text-gray-700 dark:text-gray-300">Local machines registered with <code>clash-bridge setup</code></p>
                </div>
                <button
                    type="button"
                    onClick={() => setSetupOpen((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 text-white px-3.5 py-1.5 text-sm hover:bg-gray-800"
                >
                    <Plus className="h-3.5 w-3.5" /> Add machine
                </button>
            </div>

            {setupOpen && (
                <div className="mb-4 rounded-xl border border-warm-border bg-warm-muted p-4">
                    <p className="text-xs text-gray-700 dark:text-gray-300 mb-2">Run on the machine you want to register:</p>
                    <code className="block rounded-lg bg-slate-900 text-slate-50 px-3 py-2.5 font-mono text-sm dark:bg-warm-page dark:text-slate-100 dark:border dark:border-warm-border">
                        npx @clash-space/bridge@beta setup
                    </code>
                    <p className="mt-2 text-xs text-gray-700 dark:text-gray-300">
                        It opens this site in your browser to authorize the connection,
                        then installs a background daemon (launchd / systemd).
                        The machine appears below within a few seconds.
                    </p>
                </div>
            )}

            {rt.runtimes.length === 0 ? (
                <div className="rounded-xl border border-dashed border-warm-border p-6 text-center">
                    <p className="text-sm text-gray-700 dark:text-gray-300">No machines registered yet</p>
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
                                        <span className="text-xs text-gray-700 dark:text-gray-300">{r.os} · v{r.version}</span>
                                    </div>
                                    <div className="text-xs text-gray-700 dark:text-gray-300">
                                        Agents: {r.agents.length === 0 ? "—" : r.agents.map((a) => a.id).join(", ")}
                                    </div>
                                    <div className="text-xs text-gray-700 dark:text-gray-300 dark:text-gray-400 mt-0.5">
                                        Last seen: {lastBeat}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onRemove(r.id)}
                                    disabled={removingId === r.id}
                                    className="text-xs text-gray-700 dark:text-gray-300 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
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

// ─── Crew (claimed crew members) ───────────────────────────────
//
// "Templates" are the bundled crew roles in the bridge daemon (Director,
// Canvas Editor, …). A "crew member" is the user's CLAIM: a specific
// (template × runtime) instance that gets invited into project rooms.
// See drizzle/0012_crew_member.sql for the why-this-layer rationale.

interface CrewMemberRow {
    id: string;
    user_id: string;
    template_id: string;
    runtime_id: string;
    agent_id: string | null;
    display_name: string;
    created_at: number;
    runtime_label: string | null;
    runtime_status: string | null;
    // Phase 0 per-agent budgets — populated and edited here, read at
    // generation time by the closed-source billing plugin. The
    // platform only plumbs these values; enforcement is the plugin's.
    budget_credits: number | null;
    budget_period: string;
    budget_used: number;
    budget_reset_at: number | null;
}

const BUILTIN_TEMPLATES: Array<{ id: string; label: string; summary: string }> = [
    { id: 'director',        label: 'Director',          summary: 'Plans the video and orchestrates the other roles.' },
    { id: 'canvas-editor',   label: 'Canvas Editor',     summary: 'Adds / edits / reorders / deletes nodes on the canvas.' },
    { id: 'generator',       label: 'Generator',         summary: 'Dispatches and tracks image / video / clip generation.' },
    { id: 'storyboard',      label: 'Storyboard Artist', summary: 'Sketches a shot list and lays it on the canvas.' },
    { id: 'project-manager', label: 'Project Manager',   summary: 'Lists / creates / switches / deletes projects.' },
];

function CrewSection() {
    const rt = useClashRuntime();
    const [crew, setCrew] = useState<CrewMemberRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [claimOpen, setClaimOpen] = useState(false);
    const [claimingTpl, setClaimingTpl] = useState<string>('');
    const [claimingRid, setClaimingRid] = useState<string>('');
    const [claimingAgent, setClaimingAgent] = useState<string>('');
    const [claimingName, setClaimingName] = useState<string>('');
    const [claimBusy, setClaimBusy] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch('/api/v1/crew', { credentials: 'same-origin' });
            if (!res.ok) return;
            const json = (await res.json()) as { crew: CrewMemberRow[] };
            setCrew(json.crew ?? []);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const onClaim = async () => {
        if (!claimingTpl || !claimingRid || !claimingAgent) return;
        setClaimBusy(true);
        try {
            const res = await fetch('/api/v1/crew', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    template_id: claimingTpl,
                    runtime_id: claimingRid,
                    agent_id: claimingAgent,
                    ...(claimingName.trim() ? { display_name: claimingName.trim() } : {}),
                }),
            });
            if (!res.ok) {
                const text = await res.text();
                alert(`Claim failed: ${text.slice(0, 200)}`);
                return;
            }
            await refresh();
            setClaimOpen(false);
            setClaimingTpl('');
            setClaimingRid('');
            setClaimingAgent('');
            setClaimingName('');
        } finally {
            setClaimBusy(false);
        }
    };

    const onRemove = async (id: string) => {
        if (!confirm('Unclaim this crew member? Existing chat sessions keep working.')) return;
        setRemovingId(id);
        try {
            const res = await fetch(`/api/v1/crew/${id}`, {
                method: 'DELETE',
                credentials: 'same-origin',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await refresh();
        } catch (e) {
            alert(`Failed to remove: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setRemovingId(null);
        }
    };

    const onlineRuntimes = rt.runtimes.filter((r) => r.status === 'online');
    const tplLabel = (id: string) => BUILTIN_TEMPLATES.find((t) => t.id === id)?.label ?? id;

    return (
        <section>
            <div className="flex items-center gap-3 mb-5">
                <Users className="h-5 w-5 text-gray-700 dark:text-gray-300" weight="bold" />
                <div className="flex-1">
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">Crew</h2>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                        Claim crew members from bundled templates and bind them to your runtimes.
                        Invite them into projects to chat.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setClaimOpen((v) => !v)}
                    disabled={onlineRuntimes.length === 0}
                    title={onlineRuntimes.length === 0 ? 'Register an online runtime first' : ''}
                    className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 text-white px-3.5 py-1.5 text-sm hover:bg-gray-800 disabled:bg-gray-300"
                >
                    <Plus className="h-3.5 w-3.5" /> Claim crew
                </button>
            </div>

            {claimOpen && (
                <div className="mb-4 rounded-xl border border-warm-border bg-warm-muted p-4 space-y-3">
                    <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Template</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {BUILTIN_TEMPLATES.map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => {
                                        setClaimingTpl(t.id);
                                        if (!claimingName) setClaimingName(t.label);
                                    }}
                                    className={`text-left rounded-lg border px-3 py-2 ${
                                        claimingTpl === t.id
                                            ? 'border-gray-900 bg-warm-surface'
                                            : 'border-warm-border bg-warm-surface hover:border-slate-400'
                                    }`}
                                >
                                    <div className="text-sm font-medium text-slate-900 dark:text-slate-50">{t.label}</div>
                                    <div className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">{t.summary}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Runtime</label>
                        <select
                            value={claimingRid}
                            onChange={(e) => setClaimingRid(e.target.value)}
                            className="w-full rounded-lg border border-warm-border bg-warm-surface px-3 py-2 text-sm"
                        >
                            <option value="">— pick a runtime —</option>
                            {onlineRuntimes.map((r) => (
                                <option key={r.id} value={r.id}>
                                    {r.hostname || r.machine_id.slice(0, 12)} · {r.os}
                                </option>
                            ))}
                        </select>
                        {onlineRuntimes.length === 0 && (
                            <p className="text-xs text-amber-600 mt-1">No online runtimes — start one with <code>clash-bridge setup</code> first.</p>
                        )}
                    </div>

                    {/* Agent picker — filtered to what the chosen runtime has on PATH. */}
                    {(() => {
                        const chosen = rt.runtimes.find((r) => r.id === claimingRid);
                        const detected = chosen?.agents ?? [];
                        return (
                            <div>
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Agent (which CLI powers this crew)</label>
                                <select
                                    value={claimingAgent}
                                    onChange={(e) => setClaimingAgent(e.target.value)}
                                    disabled={!claimingRid || detected.length === 0}
                                    className="w-full rounded-lg border border-warm-border bg-warm-surface px-3 py-2 text-sm disabled:bg-slate-100"
                                >
                                    <option value="">— pick an agent —</option>
                                    {detected.map((a) => (
                                        <option key={a.id} value={a.id}>
                                            {a.id}{a.version ? ` · v${a.version}` : ''}
                                        </option>
                                    ))}
                                </select>
                                {claimingRid && detected.length === 0 && (
                                    <p className="text-xs text-amber-600 mt-1">
                                        No ACP agents detected on this runtime. Install one (e.g. <code>npm i -g @zed-industries/claude-code-acp</code>) and re-run <code>clash-bridge setup --force</code>.
                                    </p>
                                )}
                            </div>
                        );
                    })()}

                    <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Name</label>
                        <input
                            type="text"
                            value={claimingName}
                            onChange={(e) => setClaimingName(e.target.value)}
                            placeholder={claimingTpl ? tplLabel(claimingTpl) : 'Director'}
                            className="w-full rounded-lg border border-warm-border bg-warm-surface px-3 py-2 text-sm"
                        />
                        <p className="text-xs text-gray-700 dark:text-gray-300 dark:text-gray-400 mt-1">Defaults to template name. Rename if you claim multiple of the same template.</p>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={() => setClaimOpen(false)}
                            className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => void onClaim()}
                            disabled={!claimingTpl || !claimingRid || !claimingAgent || claimBusy}
                            className="rounded-full bg-gray-900 text-white px-3.5 py-1.5 text-sm hover:bg-gray-800 disabled:bg-gray-300"
                        >
                            {claimBusy ? 'Claiming…' : 'Claim'}
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="rounded-xl border border-dashed border-warm-border p-6 text-center">
                    <p className="text-sm text-gray-700 dark:text-gray-300">Loading…</p>
                </div>
            ) : crew.length === 0 ? (
                <div className="rounded-xl border border-dashed border-warm-border p-6 text-center">
                    <p className="text-sm text-gray-700 dark:text-gray-300">No crew claimed yet</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {crew.map((c) => {
                        const online = c.runtime_status === 'online';
                        return (
                            <div
                                key={c.id}
                                className="rounded-xl border border-warm-border bg-warm-surface p-4 space-y-3"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`inline-block w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-stone-300'}`} />
                                            <span className="font-medium text-slate-900 dark:text-slate-50">{c.display_name}</span>
                                            <span className="text-xs text-gray-700 dark:text-gray-300">{tplLabel(c.template_id)}</span>
                                        </div>
                                        <div className="text-xs text-gray-700 dark:text-gray-300">
                                            On: {c.runtime_label || c.runtime_id.slice(0, 12)}
                                            {c.agent_id && <span className="ml-2">· {c.agent_id}</span>}
                                            {!online && <span className="text-amber-600 ml-2">(runtime offline)</span>}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void onRemove(c.id)}
                                        disabled={removingId === c.id}
                                        className="text-xs text-gray-700 dark:text-gray-300 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                                    >
                                        {removingId === c.id ? 'Removing…' : 'Unclaim'}
                                    </button>
                                </div>
                                <AgentBudgetEditor crew={c} onSaved={(next) => setCrew((prev) => prev.map((p) => (p.id === next.id ? next : p)))} />
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

// ─── Agent budget editor ───────────────────────────────────────
//
// Per-crew-member budget pocket — Phase 0 plumbing. Platform stores the
// chosen budget; the closed-source billing plugin reads at generation
// time to enforce. budget_credits=null means "no cap"; budget_period
// drives the plugin's reset schedule.
//
// Lives inline inside each crew row so the user sees current usage right
// next to the "Unclaim" affordance. Save fires PUT
// /api/v1/crew/:id/budget; server resets `budget_used` when the period
// changes, so we re-render with the row the server returned.

interface AgentBudgetEditorProps {
    crew: CrewMemberRow;
    onSaved: (row: CrewMemberRow) => void;
}

function AgentBudgetEditor({ crew, onSaved }: AgentBudgetEditorProps) {
    const [credits, setCredits] = useState<string>(crew.budget_credits == null ? '' : String(crew.budget_credits));
    const [period, setPeriod] = useState<string>(crew.budget_period || 'monthly');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset local edits when the underlying row changes (e.g. another
    // tab updates the crew). Without this we'd shadow the upstream
    // value with stale input state.
    useEffect(() => {
        setCredits(crew.budget_credits == null ? '' : String(crew.budget_credits));
        setPeriod(crew.budget_period || 'monthly');
    }, [crew.id, crew.budget_credits, crew.budget_period]);

    const onSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const trimmed = credits.trim();
            const credits_value = trimmed === '' ? null : Number(trimmed);
            if (credits_value !== null && (!Number.isFinite(credits_value) || credits_value < 0)) {
                setError('Credits must be a non-negative number, or empty for unlimited.');
                return;
            }
            const res = await fetch(`/api/v1/crew/${crew.id}/budget`, {
                method: 'PUT',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ budget_credits: credits_value, budget_period: period }),
            });
            if (!res.ok) {
                const text = await res.text();
                setError(`Save failed: ${text.slice(0, 200)}`);
                return;
            }
            const updated = (await res.json()) as Partial<CrewMemberRow>;
            onSaved({
                ...crew,
                budget_credits: updated.budget_credits ?? null,
                budget_period: updated.budget_period ?? period,
                budget_used: updated.budget_used ?? 0,
                budget_reset_at: updated.budget_reset_at ?? null,
            });
        } finally {
            setSaving(false);
        }
    };

    const usedDisplay = `${crew.budget_used} / ${crew.budget_credits == null ? '∞' : crew.budget_credits}`;
    const resetDisplay = crew.budget_reset_at
        ? new Date(crew.budget_reset_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '—';

    return (
        <div className="border-t border-warm-border pt-3">
            <div className="flex items-center gap-2 mb-2">
                <Lightning className="h-3.5 w-3.5 text-gray-700 dark:text-gray-300" weight="bold" />
                <span className="text-xs font-medium text-slate-900 dark:text-slate-50">Budget</span>
                <span className="text-xs text-gray-700 dark:text-gray-300">· used {usedDisplay} · resets {resetDisplay}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-gray-700 dark:text-gray-300">Credits</label>
                <input
                    type="number"
                    min={0}
                    value={credits}
                    onChange={(e) => setCredits(e.target.value)}
                    placeholder="unlimited"
                    className="w-28 rounded-lg border border-warm-border bg-warm-surface px-2 py-1 text-sm"
                />
                <label className="text-xs text-gray-700 dark:text-gray-300">Period</label>
                <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                    className="rounded-lg border border-warm-border bg-warm-surface px-2 py-1 text-sm"
                >
                    <option value="monthly">monthly</option>
                    <option value="one-time">one-time</option>
                    <option value="unlimited">unlimited</option>
                </select>
                <button
                    type="button"
                    onClick={() => void onSave()}
                    disabled={saving}
                    className="ml-auto rounded-full bg-slate-900 text-white px-3 py-1 text-xs hover:bg-slate-800 disabled:bg-gray-300 dark:bg-slate-100 dark:text-slate-900"
                >
                    {saving ? 'Saving…' : 'Save'}
                </button>
            </div>
            {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
        </div>
    );
}
