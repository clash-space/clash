'use client';

import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { MagnifyingGlass, ArrowLeft, PuzzlePiece, BookOpen, Check, Download } from '@phosphor-icons/react';
import Link from 'next/link';
import type { RegistryItem } from './actions';
import {
    marketplaceInstallAction,
    marketplaceUninstallAction,
    marketplaceInstallSkill,
    marketplaceUninstallSkill,
} from './actions';

type Filter = 'all' | 'action' | 'skill';

interface Props {
    items: RegistryItem[];
    installedActionIds: string[];
    installedSkillIds: string[];
}

export default function MarketplaceClient({ items, installedActionIds, installedSkillIds }: Props) {
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const [installedActions, setInstalledActions] = useState<Set<string>>(new Set(installedActionIds));
    const [installedSkills, setInstalledSkills] = useState<Set<string>>(new Set(installedSkillIds));
    const [loadingId, setLoadingId] = useState<string | null>(null);

    const filtered = useMemo(() => {
        let result = items;
        if (filter !== 'all') {
            result = result.filter((item) => item.type === filter);
        }
        if (query.trim()) {
            const q = query.toLowerCase();
            result = result.filter(
                (item) =>
                    item.name.toLowerCase().includes(q) ||
                    item.id.toLowerCase().includes(q) ||
                    (item.description || '').toLowerCase().includes(q) ||
                    (item.tags || []).some((t) => t.toLowerCase().includes(q))
            );
        }
        return result;
    }, [items, filter, query]);

    const isInstalled = useCallback(
        (item: RegistryItem) => {
            return item.type === 'action'
                ? installedActions.has(item.id)
                : installedSkills.has(item.id);
        },
        [installedActions, installedSkills]
    );

    const handleToggleInstall = useCallback(
        async (item: RegistryItem) => {
            setLoadingId(item.id);
            try {
                if (isInstalled(item)) {
                    // Uninstall
                    if (item.type === 'action') {
                        await marketplaceUninstallAction(item.id);
                        setInstalledActions((prev) => { const s = new Set(prev); s.delete(item.id); return s; });
                    } else {
                        await marketplaceUninstallSkill(item.id);
                        setInstalledSkills((prev) => { const s = new Set(prev); s.delete(item.id); return s; });
                    }
                } else {
                    // Install
                    if (item.type === 'action') {
                        await marketplaceInstallAction(item);
                        setInstalledActions((prev) => new Set(prev).add(item.id));
                    } else {
                        await marketplaceInstallSkill(item);
                        setInstalledSkills((prev) => new Set(prev).add(item.id));
                    }
                }
            } catch (err) {
                console.error('Install/uninstall failed:', err);
            } finally {
                setLoadingId(null);
            }
        },
        [isInstalled]
    );

    const filterButtons: Array<{ value: Filter; label: string }> = [
        { value: 'all', label: 'All' },
        { value: 'action', label: 'Actions' },
        { value: 'skill', label: 'Skills' },
    ];

    return (
        <div className="min-h-screen bg-gray-50 pt-28 pb-16 px-4">
            <div className="mx-auto max-w-4xl">
                {/* Header */}
                <div className="mb-8">
                    <Link
                        href="/settings"
                        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Settings
                    </Link>
                    <h1 className="font-display text-3xl font-bold text-gray-900">
                        Marketplace
                    </h1>
                    <p className="text-gray-500 mt-1">
                        Discover community actions and skills for your canvas and AI agents
                    </p>
                </div>

                {/* Search + Filter */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="flex-1 relative">
                        <MagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search actions and skills..."
                            className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
                        />
                    </div>
                    <div className="flex rounded-xl border border-slate-200 bg-white overflow-hidden">
                        {filterButtons.map((btn) => (
                            <button
                                key={btn.value}
                                onClick={() => setFilter(btn.value)}
                                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                                    filter === btn.value
                                        ? 'bg-gray-900 text-white'
                                        : 'text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                {btn.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Results */}
                {filtered.length === 0 ? (
                    <div className="text-center py-20">
                        <MagnifyingGlass className="h-10 w-10 text-gray-300 mx-auto mb-3" weight="duotone" />
                        <p className="text-sm text-gray-500">
                            {query ? `No results for "${query}"` : 'No items available yet. Check back soon!'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {filtered.map((item) => {
                            const installed = isInstalled(item);
                            const loading = loadingId === item.id;
                            const isAction = item.type === 'action';

                            return (
                                <motion.div
                                    key={`${item.type}-${item.id}`}
                                    className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col hover:shadow-md transition-shadow"
                                    whileHover={{ y: -2 }}
                                >
                                    {/* Card Header */}
                                    <div className="flex items-start gap-3 mb-3">
                                        <div className="flex items-center justify-center h-10 w-10 rounded-xl flex-shrink-0 bg-gray-100">
                                            {isAction ? (
                                                <PuzzlePiece className="h-5 w-5 text-gray-600" weight="bold" />
                                            ) : (
                                                <BookOpen className="h-5 w-5 text-gray-600" weight="bold" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-display text-sm font-bold text-gray-900 truncate">
                                                {item.icon ? `${item.icon} ` : ''}{item.name}
                                            </h3>
                                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 ${
                                                    'text-gray-600 bg-gray-100'
                                                }`}>
                                                    {item.type}
                                                </span>
                                                {isAction && item.runtime === 'worker' && (
                                                    <span className="text-[10px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 font-medium">
                                                        ☁️
                                                    </span>
                                                )}
                                                {item.version && (
                                                    <span className="text-[10px] text-gray-400 font-mono">
                                                        v{item.version}
                                                    </span>
                                                )}
                                                {item.author && (
                                                    <span className="text-[10px] text-gray-400">
                                                        @{item.author}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Description */}
                                    {item.description && (
                                        <p className="text-xs text-gray-500 line-clamp-2 mb-3 flex-1">
                                            {item.description}
                                        </p>
                                    )}

                                    {/* Tags */}
                                    {item.tags && item.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mb-3">
                                            {item.tags.slice(0, 4).map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="text-[10px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Install Button */}
                                    <motion.button
                                        onClick={() => handleToggleInstall(item)}
                                        disabled={loading}
                                        className={`mt-auto flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                                            installed
                                                ? 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600'
                                                : 'bg-gray-900 text-white hover:bg-gray-800'
                                        } disabled:opacity-50`}
                                        whileTap={{ scale: 0.98 }}
                                    >
                                        {loading ? (
                                            <span className="animate-pulse">...</span>
                                        ) : installed ? (
                                            <>
                                                <Check className="h-4 w-4" weight="bold" />
                                                Installed
                                            </>
                                        ) : (
                                            <>
                                                <Download className="h-4 w-4" weight="bold" />
                                                Install
                                            </>
                                        )}
                                    </motion.button>
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
