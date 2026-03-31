'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Plus, Trash, Copy, Check, ArrowLeft, Lock, Eye, EyeSlash, PuzzlePiece, BookOpen, ArrowRight } from '@phosphor-icons/react';
import Link from 'next/link';
import {
    createApiToken, revokeApiToken, type ApiTokenInfo,
    setVariable, deleteVariable, type VariableInfo,
    uninstallAction, type InstalledActionInfo,
    uninstallSkill, type InstalledSkillInfo,
} from './actions';

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

    // Variables state
    const [variables, setVariables] = useState<VariableInfo[]>(initialVariables);
    const [newVarKey, setNewVarKey] = useState('');
    const [newVarValue, setNewVarValue] = useState('');
    const [isAddingVar, setIsAddingVar] = useState(false);
    const [showVarValue, setShowVarValue] = useState(false);

    // Installed actions/skills state
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
        <div className="min-h-screen bg-gray-50 pt-28 pb-16 px-4">
            <div className="mx-auto max-w-2xl">
                {/* Header */}
                <div className="mb-8">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back
                    </Link>
                    <h1 className="font-display text-3xl font-bold text-gray-900">
                        Settings
                    </h1>
                </div>

                {/* API Tokens Section */}
                <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-gray-100">
                                <Key className="h-5 w-5 text-gray-600" weight="bold" />
                            </div>
                            <div>
                                <h2 className="font-display text-lg font-bold text-gray-900">
                                    API Tokens
                                </h2>
                                <p className="text-sm text-gray-500">
                                    Manage tokens for CLI and agent access
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Create Token */}
                    <div className="px-6 py-4 border-b border-slate-100 bg-gray-50/50">
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={newTokenName}
                                onChange={(e) => setNewTokenName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                                placeholder="Token name (e.g., My CLI)"
                                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
                            />
                            <motion.button
                                onClick={handleCreate}
                                disabled={isCreating || !newTokenName.trim()}
                                className="flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                                whileHover={!isCreating ? { scale: 1.02 } : {}}
                                whileTap={!isCreating ? { scale: 0.98 } : {}}
                            >
                                <Plus className="h-4 w-4" weight="bold" />
                                Create
                            </motion.button>
                        </div>
                    </div>

                    {/* Revealed Token (shown once after creation) */}
                    <AnimatePresence>
                        {revealedToken && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="px-6 py-4 bg-emerald-50 border-b border-emerald-100">
                                    <p className="text-sm font-medium text-emerald-800 mb-2">
                                        Token created! Copy it now — it won&apos;t be shown again.
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 rounded-lg bg-white border border-emerald-200 px-3 py-2 text-sm font-mono text-gray-900 select-all">
                                            {revealedToken}
                                        </code>
                                        <motion.button
                                            onClick={() => handleCopy(revealedToken, 'new')}
                                            className="rounded-lg bg-emerald-600 p-2.5 text-white hover:bg-emerald-700 transition-colors"
                                            whileTap={{ scale: 0.95 }}
                                        >
                                            {copiedId === 'new' ? (
                                                <Check className="h-4 w-4" weight="bold" />
                                            ) : (
                                                <Copy className="h-4 w-4" weight="bold" />
                                            )}
                                        </motion.button>
                                    </div>
                                    <button
                                        onClick={() => setRevealedToken(null)}
                                        className="mt-2 text-xs text-emerald-700 hover:text-emerald-900 underline"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Token List */}
                    <div className="divide-y divide-slate-100">
                        {tokens.length === 0 ? (
                            <div className="px-6 py-12 text-center">
                                <Key className="h-10 w-10 text-gray-300 mx-auto mb-3" weight="duotone" />
                                <p className="text-sm text-gray-500">
                                    No API tokens yet. Create one to use the CLI.
                                </p>
                            </div>
                        ) : (
                            tokens.map((token) => (
                                <div
                                    key={token.id}
                                    className="flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition-colors"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-gray-900 truncate">
                                                {token.name}
                                            </span>
                                            <code className="text-xs text-gray-400 font-mono bg-gray-100 rounded px-1.5 py-0.5">
                                                {token.tokenPrefix}
                                            </code>
                                        </div>
                                        <div className="flex items-center gap-3 mt-1">
                                            <span className="text-xs text-gray-400">
                                                Created {formatDate(token.createdAt)}
                                            </span>
                                            <span className="text-xs text-gray-400">
                                                Last used {formatDate(token.lastUsedAt)}
                                            </span>
                                        </div>
                                    </div>
                                    <motion.button
                                        onClick={() => handleRevoke(token.id)}
                                        className="ml-4 rounded-lg p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
                                        whileTap={{ scale: 0.95 }}
                                        title="Revoke token"
                                    >
                                        <Trash className="h-4 w-4" weight="bold" />
                                    </motion.button>
                                </div>
                            ))
                        )}
                    </div>
                </section>

                {/* Variables Section */}
                <section className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-purple-50">
                                <Lock className="h-5 w-5 text-purple-600" weight="bold" />
                            </div>
                            <div>
                                <h2 className="font-display text-lg font-bold text-gray-900">
                                    Variables
                                </h2>
                                <p className="text-sm text-gray-500">
                                    API keys and secrets used by canvas actions. Values are encrypted.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Add Variable */}
                    <div className="px-6 py-4 border-b border-slate-100 bg-gray-50/50">
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={newVarKey}
                                onChange={(e) => setNewVarKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                                placeholder="KEY_NAME"
                                className="w-40 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-mono text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
                            />
                            <div className="flex-1 relative">
                                <input
                                    type={showVarValue ? 'text' : 'password'}
                                    value={newVarValue}
                                    onChange={(e) => setNewVarValue(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddVariable()}
                                    placeholder="Value (encrypted at rest)"
                                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowVarValue(!showVarValue)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    {showVarValue ? <EyeSlash className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            <motion.button
                                onClick={handleAddVariable}
                                disabled={isAddingVar || !newVarKey.trim() || !newVarValue.trim()}
                                className="flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                                whileHover={!isAddingVar ? { scale: 1.02 } : {}}
                                whileTap={!isAddingVar ? { scale: 0.98 } : {}}
                            >
                                <Plus className="h-4 w-4" weight="bold" />
                                Set
                            </motion.button>
                        </div>
                    </div>

                    {/* Variable List */}
                    <div className="divide-y divide-slate-100">
                        {variables.length === 0 ? (
                            <div className="px-6 py-12 text-center">
                                <Lock className="h-10 w-10 text-gray-300 mx-auto mb-3" weight="duotone" />
                                <p className="text-sm text-gray-500">
                                    No variables yet. Actions that need API keys will prompt you to add them.
                                </p>
                            </div>
                        ) : (
                            variables.map((v) => (
                                <div
                                    key={v.id}
                                    className="flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition-colors"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <code className="text-sm font-mono font-medium text-gray-900">
                                                {v.key}
                                            </code>
                                            <span className="text-xs text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5 font-medium">
                                                encrypted
                                            </span>
                                        </div>
                                        <span className="text-xs text-gray-400 mt-1 block">
                                            Set {formatDate(v.updatedAt || v.createdAt)}
                                        </span>
                                    </div>
                                    <motion.button
                                        onClick={() => handleDeleteVariable(v.id)}
                                        className="ml-4 rounded-lg p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
                                        whileTap={{ scale: 0.95 }}
                                        title="Delete variable"
                                    >
                                        <Trash className="h-4 w-4" weight="bold" />
                                    </motion.button>
                                </div>
                            ))
                        )}
                    </div>
                </section>

                {/* Installed Actions Section */}
                <section className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-blue-50">
                                <PuzzlePiece className="h-5 w-5 text-blue-600" weight="bold" />
                            </div>
                            <div className="flex-1">
                                <h2 className="font-display text-lg font-bold text-gray-900">
                                    Installed Actions
                                </h2>
                                <p className="text-sm text-gray-500">
                                    Canvas actions available in all your projects
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {actions.length === 0 ? (
                            <div className="px-6 py-12 text-center">
                                <PuzzlePiece className="h-10 w-10 text-gray-300 mx-auto mb-3" weight="duotone" />
                                <p className="text-sm text-gray-500 mb-3">
                                    No actions installed yet.
                                </p>
                                <Link
                                    href="/marketplace"
                                    className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                                >
                                    Browse Marketplace <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                            </div>
                        ) : (
                            <>
                                {actions.map((action) => {
                                    const secrets: Array<{ id: string }> = (() => {
                                        try { return JSON.parse(action.manifest)?.secrets || []; } catch { return []; }
                                    })();
                                    const missingSecrets = secrets.filter((s) => !variableKeys.has(s.id));
                                    return (
                                        <div key={action.id} className="px-6 py-4 hover:bg-gray-50/50 transition-colors">
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-sm font-medium text-gray-900">
                                                            {action.icon || '🧩'} {action.name}
                                                        </span>
                                                        <span className="text-[10px] text-sky-600 bg-sky-50 rounded px-1.5 py-0.5 font-medium">
                                                            {action.runtime === 'worker' ? '☁️ Cloud' : '🖥 Local'}
                                                        </span>
                                                        {action.version && (
                                                            <span className="text-[10px] text-gray-400 font-mono">
                                                                v{action.version}
                                                            </span>
                                                        )}
                                                        {action.author && (
                                                            <span className="text-[10px] text-gray-400">
                                                                @{action.author}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {action.description && (
                                                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{action.description}</p>
                                                    )}
                                                    {secrets.length > 0 && (
                                                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                                            {secrets.map((s) => (
                                                                <span key={s.id} className={`text-[10px] font-mono rounded px-1.5 py-0.5 ${
                                                                    variableKeys.has(s.id)
                                                                        ? 'text-emerald-600 bg-emerald-50'
                                                                        : 'text-red-600 bg-red-50'
                                                                }`}>
                                                                    {variableKeys.has(s.id) ? '✅' : '❌'} {s.id}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {missingSecrets.length > 0 && (
                                                        <p className="text-[10px] text-red-500 mt-1">
                                                            Missing keys — set them in Variables above
                                                        </p>
                                                    )}
                                                </div>
                                                <motion.button
                                                    onClick={() => handleUninstallAction(action.actionId)}
                                                    className="ml-4 rounded-lg p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all flex-shrink-0"
                                                    whileTap={{ scale: 0.95 }}
                                                    title="Uninstall"
                                                >
                                                    <Trash className="h-4 w-4" weight="bold" />
                                                </motion.button>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div className="px-6 py-3 bg-gray-50/50">
                                    <Link
                                        href="/marketplace"
                                        className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                                    >
                                        Browse Marketplace <ArrowRight className="h-3.5 w-3.5" />
                                    </Link>
                                </div>
                            </>
                        )}
                    </div>
                </section>

                {/* Installed Skills Section */}
                <section className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-amber-50">
                                <BookOpen className="h-5 w-5 text-amber-600" weight="bold" />
                            </div>
                            <div>
                                <h2 className="font-display text-lg font-bold text-gray-900">
                                    Installed Skills
                                </h2>
                                <p className="text-sm text-gray-500">
                                    AI agent skills for Claude Code
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {skills.length === 0 ? (
                            <div className="px-6 py-12 text-center">
                                <BookOpen className="h-10 w-10 text-gray-300 mx-auto mb-3" weight="duotone" />
                                <p className="text-sm text-gray-500 mb-3">
                                    No skills installed yet.
                                </p>
                                <Link
                                    href="/marketplace"
                                    className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                                >
                                    Browse Marketplace <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                            </div>
                        ) : (
                            <>
                                {skills.map((skill) => (
                                    <div key={skill.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition-colors">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-medium text-gray-900">
                                                    {skill.icon || '📘'} {skill.name}
                                                </span>
                                                <span className="text-[10px] text-amber-600 bg-amber-50 rounded px-1.5 py-0.5 font-medium">
                                                    skill
                                                </span>
                                                {skill.version && (
                                                    <span className="text-[10px] text-gray-400 font-mono">v{skill.version}</span>
                                                )}
                                                {skill.author && (
                                                    <span className="text-[10px] text-gray-400">@{skill.author}</span>
                                                )}
                                            </div>
                                            {skill.description && (
                                                <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{skill.description}</p>
                                            )}
                                            {skill.linkedActionId && (
                                                <p className="text-[10px] text-gray-400 mt-0.5">
                                                    Linked action: {skill.linkedActionId}
                                                </p>
                                            )}
                                        </div>
                                        <motion.button
                                            onClick={() => handleUninstallSkill(skill.skillId)}
                                            className="ml-4 rounded-lg p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
                                            whileTap={{ scale: 0.95 }}
                                            title="Uninstall"
                                        >
                                            <Trash className="h-4 w-4" weight="bold" />
                                        </motion.button>
                                    </div>
                                ))}
                                <div className="px-6 py-3 bg-gray-50/50">
                                    <Link
                                        href="/marketplace"
                                        className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                                    >
                                        Browse Marketplace <ArrowRight className="h-3.5 w-3.5" />
                                    </Link>
                                </div>
                            </>
                        )}
                    </div>
                </section>

                {/* CLI Setup Instructions */}
                <section className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <h3 className="font-display text-base font-bold text-gray-900 mb-3">
                        Quick Setup
                    </h3>
                    <div className="space-y-3 text-sm text-gray-600">
                        <div className="flex items-start gap-3">
                            <span className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-gray-100 text-xs font-bold text-gray-500">1</span>
                            <div>
                                <p>Install the CLI:</p>
                                <code className="inline-block mt-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-mono text-gray-800">
                                    npm install -g @clash/cli
                                </code>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <span className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-gray-100 text-xs font-bold text-gray-500">2</span>
                            <div>
                                <p>Configure your token:</p>
                                <code className="inline-block mt-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-mono text-gray-800">
                                    export CLASH_API_KEY=clsh_...
                                </code>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <span className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-gray-100 text-xs font-bold text-gray-500">3</span>
                            <div>
                                <p>Verify:</p>
                                <code className="inline-block mt-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-mono text-gray-800">
                                    clash auth status
                                </code>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
