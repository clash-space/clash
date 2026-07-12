import {
    DotsThree,
    FilmSlate,
    Image as ImageIcon,
    MagnifyingGlass,
    Plus,
    SquaresFour,
    X,
} from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import type { ProjectCanvas, ProjectTimeline } from '@clash/shared-types';
import type { ProjectAsset } from '@clash/web-ui/lib/types';
import { IconButton } from './ui/icon-button';
import { Input } from './ui/input';
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

function rowClass(active: boolean): string {
    return [
        'group/menu-button relative flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 pr-8 text-left text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
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
    const [searchQuery, setSearchQuery] = useState('');
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    const canvasSectionMatches = 'canvases'.includes(normalizedQuery);
    const timelineSectionMatches = 'timelines'.includes(normalizedQuery);
    const assetsSurfaceMatches = 'assets'.includes(normalizedQuery);
    const visibleCanvases = normalizedQuery && !canvasSectionMatches
        ? canvases.filter((canvas) => canvas.name.toLocaleLowerCase().includes(normalizedQuery))
        : canvases;
    const visibleTimelines = normalizedQuery && !timelineSectionMatches
        ? timelines.filter((timeline) => timeline.name.toLocaleLowerCase().includes(normalizedQuery))
        : timelines;
    const assetsMatch = !normalizedQuery || assetsSurfaceMatches || assets.some((asset) =>
        [asset.id, asset.assetId, asset.storageKey, asset.type]
            .filter((value): value is string => typeof value === 'string')
            .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
    );
    const showCanvasSection = !normalizedQuery || canvasSectionMatches || visibleCanvases.length > 0;
    const showTimelineSection = !normalizedQuery || timelineSectionMatches || visibleTimelines.length > 0;
    const showAssetsSurface = !normalizedQuery || assetsMatch;
    const hasSearchResults = showCanvasSection || showTimelineSection || showAssetsSurface;

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

    return (
        <aside
            aria-label="Project navigator"
            className="relative z-20 flex h-full min-h-0 w-full flex-col border-r border-warm-border bg-warm-page"
        >
            {header ? (
                <div className="clash-project-sidebar-header flex h-12 shrink-0 items-center border-b border-warm-border/75 px-2.5">
                    {header}
                </div>
            ) : null}
            <div className="clash-project-sidebar-search flex h-10 shrink-0 items-start px-2 pt-2">
                <div className="relative h-8 w-full">
                    <MagnifyingGlass
                        aria-hidden="true"
                        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400"
                    />
                    <Input
                        type="search"
                        aria-label="Search project"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search"
                        className="h-8 w-full rounded-md border border-warm-border/80 bg-white/55 pl-7 pr-7 text-[12px] text-slate-900 placeholder:text-stone-400 focus-visible:ring-1 focus-visible:ring-offset-0"
                    />
                    {searchQuery ? (
                        <IconButton
                            label="Clear search"
                            icon={<X className="h-3.5 w-3.5" weight="bold" />}
                            size="sm"
                            shape="rounded"
                            onClick={() => setSearchQuery('')}
                            className={`${sidebarActionSlotClass} absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-transparent text-stone-400 hover:bg-black/[0.04] hover:text-slate-950`}
                        />
                    ) : null}
                </div>
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
                {showCanvasSection ? (
                <section aria-labelledby="project-canvases-heading">
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
                    <div className="space-y-0">
                        {visibleCanvases.map((canvas) => {
                            const active = surface.kind === 'canvas' && surface.canvasId === canvas.id;
                            return (
                                <div key={canvas.id} className="group/menu-item relative min-w-0">
                                    <Tab
                                        id={canvasTabId(canvas.id)}
                                        className={rowClass(active)}
                                    >
                                        <SquaresFour
                                            className={active ? 'h-3.5 w-3.5 text-brand' : 'h-3.5 w-3.5 text-stone-400'}
                                            weight={active ? 'fill' : 'regular'}
                                        />
                                        <span className="truncate">{canvas.name}</span>
                                    </Tab>
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
                                </div>
                            );
                        })}
                    </div>
                </section>
                ) : null}

                {showTimelineSection ? (
                <section aria-labelledby="project-timelines-heading" className={showCanvasSection ? 'mt-2' : undefined}>
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
                    <div className="space-y-0">
                        {visibleTimelines.map((timeline) => {
                            const active = surface.kind === 'timeline' && surface.timelineId === timeline.id;
                            return (
                                <div key={timeline.id} className="group/menu-item relative min-w-0">
                                    <Tab
                                        id={timelineTabId(timeline.id)}
                                        className={rowClass(active)}
                                    >
                                        <FilmSlate
                                            className={active ? 'h-3.5 w-3.5 text-brand' : 'h-3.5 w-3.5 text-stone-400'}
                                            weight={active ? 'fill' : 'regular'}
                                        />
                                        <span className="truncate">{timeline.name}</span>
                                    </Tab>
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
                                </div>
                            );
                        })}
                    </div>
                </section>
                ) : null}

                {showAssetsSurface ? (
                    <div className={showCanvasSection || showTimelineSection ? 'mt-2' : undefined}>
                    <Tab
                        id="project-assets"
                        aria-label={`Assets (${assetCount ?? assets.length})`}
                        className={rowClass(surface.kind === 'assets')}
                    >
                        <ImageIcon
                            className={surface.kind === 'assets' ? 'h-3.5 w-3.5 text-brand' : 'h-3.5 w-3.5 text-stone-400'}
                            weight={surface.kind === 'assets' ? 'fill' : 'regular'}
                        />
                        <span className="min-w-0 flex-1 truncate">Assets</span>
                        <span
                            data-sidebar-action-slot="asset-count"
                            className={`${sidebarActionSlotClass} absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center text-[11px] tabular-nums text-stone-400`}
                        >
                            {assetCount ?? assets.length}
                        </span>
                    </Tab>
                    </div>
                ) : null}
                {!hasSearchResults ? (
                    <div role="status" className="flex h-8 items-center px-2 text-[12px] text-stone-400">
                        No results
                    </div>
                ) : null}
            </TabList>
            </TabProvider>
            {footer ? (
                <div
                    role="group"
                    aria-label="Project controls"
                    className="clash-project-sidebar-footer flex h-12 shrink-0 items-center border-t border-warm-border/75 px-2"
                >
                    {footer}
                </div>
            ) : null}
        </aside>
    );
}
