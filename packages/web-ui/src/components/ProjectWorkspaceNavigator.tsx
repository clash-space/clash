import {
    CaretLeft,
    CaretRight,
    DotsThree,
    FilmSlate,
    Image as ImageIcon,
    MagnifyingGlass,
    Plus,
    SquaresFour,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProjectCanvas, ProjectTimeline } from '@clash/shared-types';
import type { ProjectAsset } from '@clash/web-ui/lib/types';
import { Button } from './ui/button';
import {
    Combobox,
    ComboboxItem,
    ComboboxList,
    ComboboxProvider,
    useComboboxStore,
} from './ui/combobox';
import { Dialog } from './ui/dialog';
import { IconButton } from './ui/icon-button';
import { Tooltip } from './ui/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Tab, TabList, TabProvider } from './ui/tabs';

export type ProjectWorkspaceSurface =
    | { kind: 'canvas'; canvasId: string }
    | { kind: 'timeline'; timelineId: string }
    | { kind: 'assets' };

interface ProjectWorkspaceNavigatorProps {
    header?: ReactNode;
    footer?: ReactNode;
    collapsed?: boolean;
    onCollapsedChange?: (collapsed: boolean) => void;
    canvases: ProjectCanvas[];
    timelines: ProjectTimeline[];
    assets: ProjectAsset[];
    assetCount?: number;
    surface: ProjectWorkspaceSurface;
    onSelectCanvas: (canvasId: string) => void;
    onSelectTimeline: (timelineId: string) => void;
    onSelectAssets: () => void;
    onCreateCanvas: () => void;
    onRenameCanvas: (canvas: ProjectCanvas) => void;
    onDeleteCanvas: (canvas: ProjectCanvas) => void;
    onCreateTimeline: () => void;
    onAttachTimeline: (timeline: ProjectTimeline) => void;
}

const sectionHeaderClass = 'flex h-8 items-center justify-between px-1';
const sidebarActionSlotClass = 'clash-project-sidebar-action-slot h-6 min-h-6 w-6 min-w-6';

type ProjectSearchResult =
    | { kind: 'canvas'; id: string; label: string; searchText: string }
    | { kind: 'timeline'; id: string; label: string; searchText: string }
    | { kind: 'assets'; label: string; searchText: string };

function rowClass(active: boolean, collapsed: boolean): string {
    return [
        'group/menu-button relative flex h-8 w-full min-w-0 items-center rounded-md text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
        collapsed ? 'justify-center gap-0 px-0 text-center' : 'gap-2 px-2 pr-8 text-left',
        active
            ? 'bg-brand/[0.09] font-semibold text-slate-950'
            : 'text-stone-600 hover:bg-black/[0.035] hover:text-slate-950',
    ].join(' ');
}

function canvasTabId(canvasId: string): string {
    return `project-canvas-${canvasId}`;
}

function timelineTabId(timelineId: string): string {
    return `project-timeline-${timelineId}`;
}

function selectedTabId(surface: ProjectWorkspaceSurface): string {
    if (surface.kind === 'canvas') return canvasTabId(surface.canvasId);
    if (surface.kind === 'timeline') return timelineTabId(surface.timelineId);
    return 'project-assets';
}

export default function ProjectWorkspaceNavigator({
    header,
    footer,
    collapsed = false,
    onCollapsedChange,
    canvases,
    timelines,
    assets,
    assetCount,
    surface,
    onSelectCanvas,
    onSelectTimeline,
    onSelectAssets,
    onCreateCanvas,
    onRenameCanvas,
    onDeleteCanvas,
    onCreateTimeline,
    onAttachTimeline,
}: ProjectWorkspaceNavigatorProps) {
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const searchResults = useMemo<ProjectSearchResult[]>(() => {
        const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
        const results: ProjectSearchResult[] = [
            ...canvases.map((canvas) => ({
                kind: 'canvas' as const,
                id: canvas.id,
                label: canvas.name,
                searchText: `${canvas.name} canvas canvases`,
            })),
            ...timelines.map((timeline) => ({
                kind: 'timeline' as const,
                id: timeline.id,
                label: timeline.name,
                searchText: `${timeline.name} timeline timelines`,
            })),
            {
                kind: 'assets' as const,
                label: 'Assets',
                searchText: [
                    'assets library media',
                    ...assets.flatMap((asset) => [asset.id, asset.assetId, asset.storageKey, asset.type]),
                ]
                    .filter((value): value is string => typeof value === 'string')
                    .join(' '),
            },
        ];

        if (!normalizedQuery) return results;
        return results.filter((result) => result.searchText.toLocaleLowerCase().includes(normalizedQuery));
    }, [assets, canvases, searchQuery, timelines]);

    const closeSearch = useCallback(() => {
        setSearchOpen(false);
        setSearchQuery('');
    }, []);

    const handleSearchSelection = useCallback((selectedValue: string) => {
        const [kind, ...idParts] = selectedValue.split(':');
        const id = idParts.join(':');
        if (kind === 'canvas') onSelectCanvas(id);
        if (kind === 'timeline') onSelectTimeline(id);
        if (kind === 'assets') onSelectAssets();
        closeSearch();
    }, [closeSearch, onSelectAssets, onSelectCanvas, onSelectTimeline]);

    const searchStore = useComboboxStore({
        value: searchQuery,
        setValue: setSearchQuery,
        setSelectedValue: (selectedValue) => {
            if (typeof selectedValue === 'string') handleSearchSelection(selectedValue);
        },
        focusLoop: true,
        focusWrap: true,
        orientation: 'vertical',
    });

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                (event.metaKey || event.ctrlKey)
                && !event.altKey
                && !event.shiftKey
                && event.key.toLocaleLowerCase() === 'k'
            ) {
                event.preventDefault();
                setSearchOpen(true);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleSelectedTabChange = (tabId: string | null | undefined) => {
        if (!tabId) return;
        if (tabId === 'project-assets') {
            onSelectAssets();
            return;
        }
        const canvas = canvases.find((candidate) => canvasTabId(candidate.id) === tabId);
        if (canvas) {
            onSelectCanvas(canvas.id);
            return;
        }
        const timeline = timelines.find((candidate) => timelineTabId(candidate.id) === tabId);
        if (timeline) onSelectTimeline(timeline.id);
    };

    const searchButton = (
        <Button
            aria-label="Search project"
            variant={null}
            size={null}
            shape={null}
            onClick={() => setSearchOpen(true)}
            className={[
                'h-8 justify-start rounded-md border border-warm-border/80 bg-white/55 text-[12px] font-normal text-stone-400 shadow-none hover:bg-white/80 focus-visible:ring-1 focus-visible:ring-brand/60 focus-visible:ring-offset-0',
                collapsed ? 'w-8 justify-center px-0' : 'w-full gap-2 px-2',
            ].join(' ')}
            leftIcon={<MagnifyingGlass className="h-3.5 w-3.5" weight="regular" />}
        >
            {!collapsed ? (
                <>
                    <span className="min-w-0 flex-1 truncate text-left">Search</span>
                    <kbd className="font-sans text-[10px] font-medium text-stone-400">⌘K</kbd>
                </>
            ) : null}
        </Button>
    );
    const assetsTab = (
        <Tab
            id="project-assets"
            aria-label={`Assets (${assetCount ?? assets.length})`}
            className={rowClass(surface.kind === 'assets', collapsed)}
        >
            <ImageIcon
                className={surface.kind === 'assets' ? 'h-3.5 w-3.5 text-brand' : 'h-3.5 w-3.5 text-stone-400'}
                weight={surface.kind === 'assets' ? 'fill' : 'regular'}
            />
            <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>Assets</span>
            {!collapsed ? (
                <span
                    data-sidebar-action-slot="asset-count"
                    className={`${sidebarActionSlotClass} absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center text-[11px] tabular-nums text-stone-400`}
                >
                    {assetCount ?? assets.length}
                </span>
            ) : null}
        </Tab>
    );

    return (
        <aside
            aria-label="Project navigator"
            data-collapsed={collapsed}
            className="relative z-20 flex h-full min-h-0 w-full flex-col overflow-hidden bg-warm-page"
        >
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-30 w-px bg-warm-border" />
            {header ? (
                <div className="clash-project-sidebar-header flex h-10 shrink-0 items-center px-2">
                    {header}
                </div>
            ) : null}
            <div className="clash-project-sidebar-search flex h-10 shrink-0 items-start px-2 pt-2">
                {collapsed ? <Tooltip label="Search project (⌘K)">{searchButton}</Tooltip> : searchButton}
            </div>
            <TabProvider
                selectedId={selectedTabId(surface)}
                setSelectedId={handleSelectedTabChange}
                orientation="vertical"
                focusLoop
            >
                <TabList
                    aria-label="Project surfaces"
                    className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-2"
                >
                    <section
                        aria-label={collapsed ? 'Canvases' : undefined}
                        aria-labelledby={collapsed ? undefined : 'project-canvases-heading'}
                    >
                        {!collapsed ? (
                            <div className={sectionHeaderClass}>
                                <h2
                                    id="project-canvases-heading"
                                    className="font-display text-[11px] font-semibold text-stone-500"
                                >
                                    Canvases
                                </h2>
                                <Tooltip label="New Canvas">
                                    <IconButton
                                        label="New Canvas"
                                        icon={<Plus className="h-3 w-3" weight="bold" />}
                                        size="sm"
                                        shape="rounded"
                                        onClick={onCreateCanvas}
                                        className={`${sidebarActionSlotClass} rounded-md bg-transparent text-stone-500 hover:bg-black/[0.04] hover:text-slate-950`}
                                    />
                                </Tooltip>
                            </div>
                        ) : null}
                        <div className="space-y-0">
                            {canvases.map((canvas) => {
                                const active = surface.kind === 'canvas' && surface.canvasId === canvas.id;
                                const tab = (
                                    <Tab
                                        id={canvasTabId(canvas.id)}
                                        aria-label={canvas.name}
                                        className={rowClass(active, collapsed)}
                                    >
                                        <SquaresFour
                                            className={active ? 'h-3.5 w-3.5 text-brand' : 'h-3.5 w-3.5 text-stone-400'}
                                            weight={active ? 'fill' : 'regular'}
                                        />
                                        <span className={collapsed ? 'sr-only' : 'truncate'}>{canvas.name}</span>
                                    </Tab>
                                );
                                return (
                                    <div key={canvas.id} className="group/menu-item relative min-w-0">
                                        {collapsed ? <Tooltip label={canvas.name}>{tab}</Tooltip> : tab}
                                        {!collapsed ? (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <IconButton
                                                        label={`Canvas actions for ${canvas.name}`}
                                                        icon={<DotsThree className="h-4 w-4" weight="bold" />}
                                                        size="sm"
                                                        shape="rounded"
                                                        className={`${sidebarActionSlotClass} absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-transparent text-stone-400 opacity-0 hover:bg-stone-100 hover:text-slate-950 group-hover/menu-item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100`}
                                                    />
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent side="right" align="start" className="min-w-36 rounded-md p-1">
                                                    <DropdownMenuItem onSelect={() => onRenameCanvas(canvas)}>
                                                        Rename
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => onDeleteCanvas(canvas)}>
                                                        Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <section
                        aria-label={collapsed ? 'Timelines' : undefined}
                        aria-labelledby={collapsed ? undefined : 'project-timelines-heading'}
                        className="mt-2"
                    >
                        {!collapsed ? (
                            <div className={sectionHeaderClass}>
                                <h2
                                    id="project-timelines-heading"
                                    className="font-display text-[11px] font-semibold text-stone-500"
                                >
                                    Timelines
                                </h2>
                                <Tooltip label="New Timeline">
                                    <IconButton
                                        label="New Timeline"
                                        icon={<Plus className="h-3 w-3" weight="bold" />}
                                        size="sm"
                                        shape="rounded"
                                        onClick={onCreateTimeline}
                                        className={`${sidebarActionSlotClass} rounded-md bg-transparent text-stone-500 hover:bg-black/[0.04] hover:text-slate-950`}
                                    />
                                </Tooltip>
                            </div>
                        ) : null}
                        <div className="space-y-0">
                            {timelines.map((timeline) => {
                                const active = surface.kind === 'timeline' && surface.timelineId === timeline.id;
                                const tab = (
                                    <Tab
                                        id={timelineTabId(timeline.id)}
                                        aria-label={timeline.name}
                                        className={rowClass(active, collapsed)}
                                    >
                                        <FilmSlate
                                            className={active ? 'h-3.5 w-3.5 text-brand' : 'h-3.5 w-3.5 text-stone-400'}
                                            weight={active ? 'fill' : 'regular'}
                                        />
                                        <span className={collapsed ? 'sr-only' : 'truncate'}>{timeline.name}</span>
                                    </Tab>
                                );
                                return (
                                    <div key={timeline.id} className="group/menu-item relative min-w-0">
                                        {collapsed ? <Tooltip label={timeline.name}>{tab}</Tooltip> : tab}
                                        {!collapsed ? (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <IconButton
                                                        label={`Timeline actions for ${timeline.name}`}
                                                        icon={<DotsThree className="h-4 w-4" weight="bold" />}
                                                        size="sm"
                                                        shape="rounded"
                                                        className={`${sidebarActionSlotClass} absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-transparent text-stone-400 opacity-0 hover:bg-stone-100 hover:text-slate-950 group-hover/menu-item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100`}
                                                    />
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent side="right" align="start" className="min-w-44 rounded-md p-1">
                                                    <DropdownMenuItem onSelect={() => onAttachTimeline(timeline)}>
                                                        Move to current Canvas
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <div className="mt-2">
                        {collapsed ? <Tooltip label="Assets">{assetsTab}</Tooltip> : assetsTab}
                    </div>
                </TabList>
            </TabProvider>
            {footer || onCollapsedChange ? (
                <div
                    role="group"
                    aria-label="Project controls"
                    className={[
                        'clash-project-sidebar-footer flex h-12 shrink-0 items-center border-t border-warm-border/75 px-2',
                        collapsed ? 'justify-center' : 'justify-between gap-2',
                    ].join(' ')}
                >
                    {!collapsed ? footer : null}
                    {onCollapsedChange ? (
                        <Tooltip label={collapsed ? 'Expand project sidebar' : 'Collapse project sidebar'}>
                            <IconButton
                                label={collapsed ? 'Expand project sidebar' : 'Collapse project sidebar'}
                                icon={collapsed
                                    ? <CaretRight className="h-3.5 w-3.5" weight="bold" />
                                    : <CaretLeft className="h-3.5 w-3.5" weight="bold" />}
                                size="sm"
                                shape="rounded"
                                onClick={() => onCollapsedChange(!collapsed)}
                                className="shrink-0 rounded-md text-stone-500 hover:bg-black/[0.04] hover:text-slate-950"
                            />
                        </Tooltip>
                    ) : null}
                </div>
            ) : null}
            <Dialog
                open={searchOpen}
                onClose={closeSearch}
                ariaLabel="Search project"
                size="auto"
                hideCloseButton
                unstyled
                containerClassName="items-start pt-[12vh]"
                contentClassName="w-full max-w-lg overflow-hidden rounded-lg border border-warm-border bg-warm-surface shadow-[0_18px_54px_rgba(35,31,25,0.18)]"
            >
                <ComboboxProvider store={searchStore}>
                    <div className="relative border-b border-warm-border/80">
                        <MagnifyingGlass
                            aria-hidden="true"
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
                        />
                        <Combobox
                            aria-label="Search project"
                            autoComplete="list"
                            autoSelect
                            autoFocus
                            placeholder="Search canvases, timelines, and assets"
                            className="h-12 w-full bg-transparent pl-10 pr-4 text-sm text-slate-950 outline-none placeholder:text-stone-400 focus-visible:ring-0"
                        />
                    </div>
                    <ComboboxList
                        aria-label="Project search results"
                        alwaysVisible
                        className="max-h-80 overflow-y-auto p-1.5"
                    >
                        {searchResults.length === 0 ? (
                            <div role="status" className="flex h-12 items-center justify-center text-xs text-stone-400">
                                No results
                            </div>
                        ) : searchResults.map((result) => {
                            const value = result.kind === 'assets' ? 'assets:' : `${result.kind}:${result.id}`;
                            const kindLabel = result.kind === 'assets' ? 'Project' : result.kind === 'canvas' ? 'Canvas' : 'Timeline';
                            const ResultIcon = result.kind === 'assets'
                                ? ImageIcon
                                : result.kind === 'canvas'
                                    ? SquaresFour
                                    : FilmSlate;
                            return (
                                <ComboboxItem
                                    key={value}
                                    value={value}
                                    focusOnHover
                                    setValueOnClick={false}
                                    aria-label={`${result.label} ${kindLabel}`}
                                    className="flex h-10 w-full cursor-default items-center gap-3 rounded-md px-2.5 text-left text-[13px] text-slate-900 outline-none hover:bg-warm-muted data-[active-item]:bg-warm-muted focus-visible:bg-warm-muted"
                                >
                                    <ResultIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-stone-400" />
                                    <span className="min-w-0 flex-1 truncate font-medium">{result.label}</span>
                                    <span className="text-[11px] text-stone-400">{kindLabel}</span>
                                </ComboboxItem>
                            );
                        })}
                    </ComboboxList>
                </ComboboxProvider>
            </Dialog>
        </aside>
    );
}
