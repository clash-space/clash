
import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Plus, Trash, Copy, Check, ArrowLeft, Lock, Eye, EyeSlash, PuzzlePiece, BookOpen, Terminal, Plug, Users } from '@phosphor-icons/react';
import { useClashRuntime } from '@clash/web-ui/hooks/useClashRuntime';
import { Link } from 'react-router';
import {
    createApiToken, revokeApiToken, type ApiTokenInfo,
    setVariable, deleteVariable, type VariableInfo,
    uninstallAction, type InstalledActionInfo,
    uninstallSkill, type InstalledSkillInfo,
} from '@clash/web-ui/lib/clientActions';

interface Props {
    initialTokens: ApiTokenInfo[];
    initialVariables: VariableInfo[];
    initialActions: InstalledActionInfo[];
    initialSkills: InstalledSkillInfo[];
}

export default function SettingsClient({ initialTokens, initialVariables, initialActions, initialSkills }: Props) {
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

    return (
        <div className="min-h-screen bg-white">
            {/* Sticky header */}
            <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-100">
                <div className="mx-auto max-w-3xl px-6 py-4 flex items-center gap-4">
                    <Link
                        to="/"
                        className="flex items-center justify-center h-9 w-9 rounded-full border border-slate-200 text-gray-500 hover:text-gray-900 hover:border-slate-300 transition-all"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                    <h1 className="font-display text-xl font-bold text-gray-900">Settings</h1>
                </div>
            </header>

            <div className="mx-auto max-w-3xl px-6 py-10 space-y-12">

                {/* ── Runtimes ── */}
                <RuntimesSection />

                {/* ── Crew ── */}
                <CrewSection />

                {/* ── API Tokens ── */}
                <section>
                    <div className="flex items-center gap-3 mb-5">
                        <Key className="h-5 w-5 text-gray-400" weight="bold" />
                        <div>
                            <h2 className="font-display text-base font-bold text-gray-900">API Tokens</h2>
                            <p className="text-sm text-gray-500">For CLI and agent access</p>
                        </div>
                    </div>

                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={newTokenName}
                            onChange={(e) => setNewTokenName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                            placeholder="Token name"
                            className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
                        />
                        <motion.button
                            onClick={handleCreate}
                            disabled={isCreating || !newTokenName.trim()}
                            className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                                <div className="rounded-xl bg-gray-50 border border-slate-200 p-4">
                                    <p className="text-sm font-medium text-gray-700 mb-2">
                                        Copy this token now — it won&apos;t be shown again.
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm font-mono text-gray-900 select-all truncate">
                                            {revealedToken}
                                        </code>
                                        <button
                                            onClick={() => handleCopy(revealedToken, 'new')}
                                            className="rounded-lg p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                                        >
                                            {copiedId === 'new' ? <Check className="h-4 w-4 text-green-600" weight="bold" /> : <Copy className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    <button onClick={() => setRevealedToken(null)} className="mt-2 text-xs text-gray-400 hover:text-gray-600">
                                        Dismiss
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {tokens.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
                            <Key className="h-8 w-8 text-gray-300 mx-auto mb-2" weight="duotone" />
                            <p className="text-sm text-gray-400">No tokens yet</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {tokens.map((token) => (
                                <div key={token.id} className="group flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-gray-900">{token.name}</span>
                                            <code className="text-xs text-gray-400 font-mono">{token.tokenPrefix}</code>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-0.5">
                                            Created {formatDate(token.createdAt)} · Last used {formatDate(token.lastUsedAt)}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => handleRevoke(token.id)}
                                        className="opacity-0 group-hover:opacity-100 rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
                                    >
                                        <Trash className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <hr className="border-slate-100" />

                {/* ── Variables ── */}
                <section>
                    <div className="flex items-center gap-3 mb-5">
                        <Lock className="h-5 w-5 text-gray-400" weight="bold" />
                        <div>
                            <h2 className="font-display text-base font-bold text-gray-900">Variables</h2>
                            <p className="text-sm text-gray-500">Encrypted secrets for canvas actions</p>
                        </div>
                    </div>

                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={newVarKey}
                            onChange={(e) => setNewVarKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                            placeholder="KEY_NAME"
                            autoComplete="off"
                            className="w-36 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-mono text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
                        />
                        <div className="flex-1 relative">
                            <input
                                type={showVarValue ? 'text' : 'password'}
                                value={newVarValue}
                                onChange={(e) => setNewVarValue(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddVariable()}
                                placeholder="Value"
                                autoComplete="new-password"
                                className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
                            />
                            <button
                                type="button"
                                onClick={() => setShowVarValue(!showVarValue)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showVarValue ? <EyeSlash className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                        </div>
                        <motion.button
                            onClick={handleAddVariable}
                            disabled={isAddingVar || !newVarKey.trim() || !newVarValue.trim()}
                            className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            whileTap={{ scale: 0.97 }}
                        >
                            Set
                        </motion.button>
                    </div>

                    {variables.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
                            <Lock className="h-8 w-8 text-gray-300 mx-auto mb-2" weight="duotone" />
                            <p className="text-sm text-gray-400">No variables yet</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {variables.map((v) => (
                                <div key={v.id} className="group flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <code className="text-sm font-mono font-medium text-gray-900">{v.key}</code>
                                            <span className="text-[10px] text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">encrypted</span>
                                        </div>
                                        <p className="text-xs text-gray-400 mt-0.5">Updated {formatDate(v.updatedAt || v.createdAt)}</p>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteVariable(v.id)}
                                        className="opacity-0 group-hover:opacity-100 rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
                                    >
                                        <Trash className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <hr className="border-slate-100" />

                {/* ── Installed Actions ── */}
                <section>
                    <div className="flex items-center gap-3 mb-5">
                        <PuzzlePiece className="h-5 w-5 text-gray-400" weight="bold" />
                        <div className="flex-1">
                            <h2 className="font-display text-base font-bold text-gray-900">Installed Actions</h2>
                            <p className="text-sm text-gray-500">Canvas actions available in all projects</p>
                        </div>
                        <Link to="/marketplace" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
                            Browse
                        </Link>
                    </div>

                    {actions.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
                            <PuzzlePiece className="h-8 w-8 text-gray-300 mx-auto mb-2" weight="duotone" />
                            <p className="text-sm text-gray-400 mb-2">No actions installed</p>
                            <Link to="/marketplace" className="text-sm font-medium text-gray-900 hover:text-gray-600 transition-colors">
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
                                    <div key={action.id} className="group rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-sm font-medium text-gray-900">{action.name}</span>
                                                    {action.version && <span className="text-xs text-gray-400 font-mono">v{action.version}</span>}
                                                    {action.author && <span className="text-xs text-gray-400">@{action.author}</span>}
                                                </div>
                                                {action.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{action.description}</p>}
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
                                                className="opacity-0 group-hover:opacity-100 rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all flex-shrink-0"
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

                <hr className="border-slate-100" />

                {/* ── Installed Skills ── */}
                <section>
                    <div className="flex items-center gap-3 mb-5">
                        <BookOpen className="h-5 w-5 text-gray-400" weight="bold" />
                        <div className="flex-1">
                            <h2 className="font-display text-base font-bold text-gray-900">Installed Skills</h2>
                            <p className="text-sm text-gray-500">AI agent skills for Claude Code</p>
                        </div>
                        <Link to="/marketplace" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
                            Browse
                        </Link>
                    </div>

                    {skills.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
                            <BookOpen className="h-8 w-8 text-gray-300 mx-auto mb-2" weight="duotone" />
                            <p className="text-sm text-gray-400 mb-2">No skills installed</p>
                            <Link to="/marketplace" className="text-sm font-medium text-gray-900 hover:text-gray-600 transition-colors">
                                Explore Marketplace
                            </Link>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {skills.map((skill) => (
                                <div key={skill.id} className="group flex items-center gap-3 rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-medium text-gray-900">{skill.name}</span>
                                            {skill.version && <span className="text-xs text-gray-400 font-mono">v{skill.version}</span>}
                                            {skill.author && <span className="text-xs text-gray-400">@{skill.author}</span>}
                                        </div>
                                        {skill.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{skill.description}</p>}
                                    </div>
                                    <button
                                        onClick={() => handleUninstallSkill(skill.skillId)}
                                        className="opacity-0 group-hover:opacity-100 rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
                                    >
                                        <Trash className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <hr className="border-slate-100" />

                {/* ── CLI ── */}
                <section className="pb-4">
                    <div className="flex items-center gap-3 mb-4">
                        <Terminal className="h-5 w-5 text-gray-400" weight="bold" />
                        <h2 className="font-display text-base font-bold text-gray-900">CLI</h2>
                    </div>
                    <code className="block rounded-xl bg-gray-50 border border-slate-200 px-4 py-3 text-sm font-mono text-gray-700">
                        npm install -g @clash-space/cli
                    </code>
                </section>
            </div>
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
                <Plug className="h-5 w-5 text-gray-400" weight="bold" />
                <div className="flex-1">
                    <h2 className="font-display text-base font-bold text-gray-900">Runtimes</h2>
                    <p className="text-sm text-gray-500">Local machines registered with <code>clash-bridge setup</code></p>
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
                <div className="mb-4 rounded-xl border border-slate-200 bg-gray-50 p-4">
                    <p className="text-xs text-gray-500 mb-2">Run on the machine you want to register:</p>
                    <code className="block rounded-lg bg-slate-900 text-slate-50 px-3 py-2.5 font-mono text-sm">
                        npx @clash-space/bridge@beta setup
                    </code>
                    <p className="mt-2 text-xs text-gray-400">
                        It opens this site in your browser to authorize the connection,
                        then installs a background daemon (launchd / systemd).
                        The machine appears below within a few seconds.
                    </p>
                </div>
            )}

            {rt.runtimes.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center">
                    <p className="text-sm text-gray-400">No machines registered yet</p>
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
                                className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`inline-block w-2 h-2 rounded-full ${online ? "bg-emerald-500" : "bg-stone-300"}`} />
                                        <span className="font-medium text-gray-900">{r.hostname || r.machine_id.slice(0, 12)}</span>
                                        <span className="text-xs text-gray-400">{r.os} · v{r.version}</span>
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        Agents: {r.agents.length === 0 ? "—" : r.agents.map((a) => a.id).join(", ")}
                                    </div>
                                    <div className="text-xs text-gray-400 mt-0.5">
                                        Last seen: {lastBeat}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onRemove(r.id)}
                                    disabled={removingId === r.id}
                                    className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
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
    display_name: string;
    created_at: number;
    runtime_label: string | null;
    runtime_status: string | null;
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
        if (!claimingTpl || !claimingRid) return;
        setClaimBusy(true);
        try {
            const res = await fetch('/api/v1/crew', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    template_id: claimingTpl,
                    runtime_id: claimingRid,
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
                <Users className="h-5 w-5 text-gray-400" weight="bold" />
                <div className="flex-1">
                    <h2 className="font-display text-base font-bold text-gray-900">Crew</h2>
                    <p className="text-sm text-gray-500">
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
                <div className="mb-4 rounded-xl border border-slate-200 bg-gray-50 p-4 space-y-3">
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Template</label>
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
                                            ? 'border-gray-900 bg-white'
                                            : 'border-slate-200 bg-white hover:border-slate-400'
                                    }`}
                                >
                                    <div className="text-sm font-medium text-gray-900">{t.label}</div>
                                    <div className="text-xs text-gray-500 mt-0.5">{t.summary}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Runtime</label>
                        <select
                            value={claimingRid}
                            onChange={(e) => setClaimingRid(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
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

                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Name</label>
                        <input
                            type="text"
                            value={claimingName}
                            onChange={(e) => setClaimingName(e.target.value)}
                            placeholder={claimingTpl ? tplLabel(claimingTpl) : 'Director'}
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                        <p className="text-xs text-gray-400 mt-1">Defaults to template name. Rename if you claim multiple of the same template.</p>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={() => setClaimOpen(false)}
                            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => void onClaim()}
                            disabled={!claimingTpl || !claimingRid || claimBusy}
                            className="rounded-full bg-gray-900 text-white px-3.5 py-1.5 text-sm hover:bg-gray-800 disabled:bg-gray-300"
                        >
                            {claimBusy ? 'Claiming…' : 'Claim'}
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center">
                    <p className="text-sm text-gray-400">Loading…</p>
                </div>
            ) : crew.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center">
                    <p className="text-sm text-gray-400">No crew claimed yet</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {crew.map((c) => {
                        const online = c.runtime_status === 'online';
                        return (
                            <div
                                key={c.id}
                                className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`inline-block w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-stone-300'}`} />
                                        <span className="font-medium text-gray-900">{c.display_name}</span>
                                        <span className="text-xs text-gray-400">{tplLabel(c.template_id)}</span>
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        On: {c.runtime_label || c.runtime_id.slice(0, 12)}
                                        {!online && <span className="text-amber-600 ml-2">(runtime offline)</span>}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void onRemove(c.id)}
                                    disabled={removingId === c.id}
                                    className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                                >
                                    {removingId === c.id ? 'Removing…' : 'Unclaim'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
