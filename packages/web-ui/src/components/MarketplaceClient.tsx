
import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { MagnifyingGlass, PuzzlePiece, BookOpen, Check, Download } from '@phosphor-icons/react';
import type { RegistryItem } from '@clash/web-ui/lib/clientActions';
import {
    marketplaceInstallAction,
    marketplaceUninstallAction,
    marketplaceInstallSkill,
    marketplaceUninstallSkill,
} from '@clash/web-ui/lib/clientActions';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

type Filter = 'all' | 'action' | 'skill';

interface Props {
    items: RegistryItem[];
    installedActionIds: string[];
    installedSkillIds: string[];
    mode?: 'public' | 'manage';
}

export default function MarketplaceClient({ items, installedActionIds, installedSkillIds, mode = 'manage' }: Props) {
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const [installedActions, setInstalledActions] = useState<Set<string>>(new Set(installedActionIds));
    const [installedSkills, setInstalledSkills] = useState<Set<string>>(new Set(installedSkillIds));
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const canManage = mode === 'manage';

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
            if (!canManage) return;
            setLoadingId(item.id);
            try {
                if (isInstalled(item)) {
                    if (item.type === 'action') {
                        await marketplaceUninstallAction(item.id);
                        setInstalledActions((prev) => { const s = new Set(prev); s.delete(item.id); return s; });
                    } else {
                        await marketplaceUninstallSkill(item.id);
                        setInstalledSkills((prev) => { const s = new Set(prev); s.delete(item.id); return s; });
                    }
                } else {
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
        [canManage, isInstalled]
    );

    const filterButtons: Array<{ value: Filter; label: string }> = [
        { value: 'all', label: 'All' },
        { value: 'action', label: 'Actions' },
        { value: 'skill', label: 'Skills' },
    ];

    return (
        <div className="min-h-screen pt-28 pb-16 px-4 md:px-8">
            <div className="mx-auto max-w-5xl">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50">
                        Marketplace
                    </h1>
                    <p className="text-stone-600 dark:text-stone-300 mt-1">
                        {canManage ? 'Install actions and skills for your workspace' : 'Actions and skills for Clash agents'}
                    </p>
                </div>

                {/* Search + Filter */}
                <div className="mb-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                    <div className="flex-1 relative">
                        <MagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                        <Input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search actions and skills..."
                            className="w-full rounded-xl border border-warm-border bg-warm-surface pl-11 pr-4 py-2.5 text-sm text-slate-950 shadow-sm transition-colors placeholder:text-stone-400 focus:border-brand focus:outline-none dark:text-slate-50 dark:placeholder:text-stone-500"
                        />
                    </div>
                    <ToggleGroup
                        type="single"
                        value={filter}
                        onValueChange={(value) => {
                            if (value === 'all' || value === 'action' || value === 'skill') {
                                setFilter(value);
                            }
                        }}
                        className="flex flex-wrap gap-1"
                        aria-label="Marketplace item type"
                    >
                        {filterButtons.map((btn) => (
                            <ToggleGroupItem
                                key={btn.value}
                                value={btn.value}
                                className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                                    filter === btn.value
                                        ? 'clash-marketplace-filter-active'
                                        : 'text-stone-600 hover:text-slate-950 hover:bg-warm-muted dark:text-stone-300 dark:hover:text-slate-50 dark:hover:bg-warm-hover'
                                }`}
                            >
                                {btn.label}
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                </div>

                {/* Results */}
                {filtered.length === 0 ? (
                    <div className="text-center py-24">
                        <MagnifyingGlass className="h-10 w-10 text-stone-500 mx-auto mb-3 dark:text-stone-500" weight="duotone" aria-hidden="true" />
                        <p className="text-sm text-stone-600 dark:text-stone-300">
                            {query ? `No results for "${query}"` : 'No items available yet'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filtered.map((item) => {
                            const installed = isInstalled(item);
                            const loading = loadingId === item.id;
                            const isAction = item.type === 'action';

                            return (
                                <motion.div
                                    key={`${item.type}-${item.id}`}
                                    className="bg-warm-surface/90 rounded-2xl border border-warm-border p-5 flex flex-col cursor-default hover:shadow-sm hover:border-brand/30 transition-all"
                                    whileHover={{ y: -3 }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                >
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className={`flex items-center justify-center h-10 w-10 rounded-xl flex-shrink-0 ${
                                            isAction ? 'bg-brand-light text-brand' : 'bg-warm-muted text-stone-700 dark:text-stone-200'
                                        }`}>
                                            {isAction ? (
                                                <PuzzlePiece className="h-5 w-5" weight="bold" />
                                            ) : (
                                                <BookOpen className="h-5 w-5" weight="bold" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-slate-50 truncate">
                                                {item.name}
                                            </h3>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                {item.author && <span className="text-xs text-stone-500 dark:text-stone-400">@{item.author}</span>}
                                                {item.version && <span className="text-xs text-stone-500 dark:text-stone-400 font-mono">v{item.version}</span>}
                                            </div>
                                        </div>
                                    </div>

                                    {item.description && (
                                        <p className="text-sm text-stone-600 dark:text-stone-300 line-clamp-2 mb-4 flex-1 leading-relaxed">
                                            {item.description}
                                        </p>
                                    )}

                                    {item.tags && item.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mb-4">
                                            {item.tags.slice(0, 3).map((tag) => (
                                                <span key={tag} className="text-xs text-stone-600 dark:text-stone-300 bg-warm-muted rounded-lg px-2.5 py-0.5">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {canManage ? (
                                        <Button
                                            onClick={() => handleToggleInstall(item)}
                                            disabled={loading}
                                            leftIcon={loading ? undefined : installed ? (
                                                <Check className="h-4 w-4" weight="bold" />
                                            ) : (
                                                <Download className="h-4 w-4" weight="bold" />
                                            )}
                                            size="md"
                                            shape="rounded"
                                            className={`mt-auto rounded-xl px-4 py-2 text-sm font-semibold ${
                                                installed
                                                    ? 'clash-marketplace-installed'
                                                    : 'clash-marketplace-primary'
                                            }`}
                                        >
                                            {loading ? (
                                                <span className="animate-pulse">...</span>
                                            ) : installed ? 'Installed' : 'Install'}
                                        </Button>
                                    ) : (
                                        <div className="mt-auto rounded-xl border border-warm-border bg-warm-muted px-4 py-2 text-center text-sm font-semibold text-stone-700 dark:text-stone-200">
                                            Available in workspace
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
