import {
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
import { writeProjectAssetDrag } from "@clash/web-ui/lib/projectAssetDrag";
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
    | {
        kind: "asset";
        assetId: string;
    };

interface ProjectWorkspaceNavigatorProps {
    header?: ReactNode;
    footer?: ReactNode;
    collapsed?: boolean;
    canvases: ProjectCanvas[];
    timelines: ProjectTimeline[];
    assets: ProjectAsset[];
    surface: ProjectWorkspaceSurface;
    onSelectCanvas: (canvasId: string) => void;
    onSelectTimeline: (timelineId: string) => void;
    onSelectAsset: (assetId: string) => void;
    onCreateCanvas: () => void;
    onRenameCanvas: (canvas: ProjectCanvas) => void;
    onDeleteCanvas: (canvas: ProjectCanvas) => void;
    onCreateTimeline: () => void;
    onAttachTimeline: (timeline: ProjectTimeline) => void;
    onAddAsset: () => void;
}

const sectionHeaderClass = 'flex h-8 items-center justify-between px-1';
const sectionHeadingClass =
  "font-display text-[11px] font-semibold text-stone-500";
const sidebarActionSlotClass = 'clash-project-sidebar-action-slot h-6 min-h-6 w-6 min-w-6';

type ProjectFolderId = "canvases" | "timelines" | "assets";

interface ProjectFolderSectionProps {
  id: ProjectFolderId;
  label: string;
  open: boolean;
  collapsed: boolean;
  addLabel: string;
  onToggle: () => void;
  onAdd: () => void;
  children: ReactNode;
}

function ProjectFolderSection({
  id,
  label,
  open,
  collapsed,
  addLabel,
  onToggle,
  onAdd,
  children,
}: ProjectFolderSectionProps) {
  const headingId = `project-${id}-heading`;
  const contentId = `project-${id}-list`;

  return (
    <section
      data-project-folder={id}
      aria-label={collapsed ? label : undefined}
      aria-labelledby={collapsed ? undefined : headingId}
      className="mt-2 first:mt-0"
    >
      {!collapsed ? (
        <div data-project-folder-header className={sectionHeaderClass}>
          <h2 className="min-w-0 flex-1">
            <Button
              aria-label={label}
              aria-expanded={open}
              aria-controls={contentId}
              variant={null}
              size={null}
              shape={null}
              onClick={onToggle}
              className="flex h-8 w-full min-w-0 items-center justify-start gap-1.5 rounded-md bg-transparent px-1 text-left shadow-none hover:bg-black/[0.025] focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-0"
            >
              <CaretRight
                className={`h-3 w-3 shrink-0 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
                weight="bold"
              />
              <span id={headingId} className={sectionHeadingClass}>
                {label}
              </span>
            </Button>
          </h2>
          <Tooltip label={addLabel}>
            <IconButton
              label={addLabel}
              icon={<Plus className="h-3 w-3" weight="bold" />}
              size="sm"
              shape="rounded"
              onClick={onAdd}
              className={`${sidebarActionSlotClass} rounded-md bg-transparent text-stone-500 hover:bg-black/[0.04] hover:text-slate-950`}
            />
          </Tooltip>
        </div>
      ) : null}
      {open ? (
        <div id={contentId} data-project-folder-content className="space-y-0">
          {children}
        </div>
      ) : null}
    </section>
  );
}

type ProjectSearchResult =
    | { kind: 'canvas'; id: string; label: string; searchText: string }
    | { kind: 'timeline'; id: string; label: string; searchText: string }
    | {
        kind: "asset";
        id: string;
        label: string;
        searchText: string;
    };

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

function assetTabId(assetId: string): string {
  return `project-asset-${assetId}`;
}

function selectedTabId(surface: ProjectWorkspaceSurface): string {
    if (surface.kind === 'canvas') return canvasTabId(surface.canvasId);
    if (surface.kind === 'timeline') return timelineTabId(surface.timelineId);
    return assetTabId(surface.assetId);
}

function assetNavigationLabel(asset: ProjectAsset): {
  label: string;
  path: string;
} {
  const path = asset.storageKey?.trim() || asset.id;
  const label = path.split(/[\\/]/).filter(Boolean).at(-1) || path;
  return { label, path };
}

export default function ProjectWorkspaceNavigator({
    header,
    footer,
    collapsed = false,
    canvases,
    timelines,
    assets,
    surface,
    onSelectCanvas,
    onSelectTimeline,
    onSelectAsset,
    onCreateCanvas,
    onRenameCanvas,
    onDeleteCanvas,
    onCreateTimeline,
    onAttachTimeline,
    onAddAsset,
}: ProjectWorkspaceNavigatorProps) {
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [openFolders, setOpenFolders] = useState<
      Record<ProjectFolderId, boolean>
    >({
      canvases: true,
      timelines: true,
      assets: true,
    });
    const searchResults = useMemo<ProjectSearchResult[]>(() => {
        const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
        const results: ProjectSearchResult[] = [...canvases.map((canvas) => ({
            kind: 'canvas' as const,
            id: canvas.id,
            label: canvas.name,
            searchText: `${canvas.name} canvas canvases`,
        })), ...timelines.map((timeline) => ({
            kind: 'timeline' as const,
            id: timeline.id,
            label: timeline.name,
            searchText: `${timeline.name} timeline timelines`,
        })), ...assets.map((asset) => {
          const { label, path } = assetNavigationLabel(asset);
          return {
            kind: "asset" as const,
            id: asset.id,
            label,
            searchText: [
              label,
              path,
              asset.id,
              asset.assetId,
              asset.type,
              "asset assets media",
            ]
              .filter((value): value is string => typeof value === "string")
              .join(" "),
          };
        })];

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
        if (kind === "asset") onSelectAsset(id);
        closeSearch();
    }, [closeSearch, onSelectAsset, onSelectCanvas, onSelectTimeline]);

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

    useEffect(() => {
      const folderId: ProjectFolderId =
        surface.kind === "canvas"
          ? "canvases"
          : surface.kind === "timeline"
            ? "timelines"
            : "assets";
      setOpenFolders((current) =>
        current[folderId] ? current : { ...current, [folderId]: true },
      );
    }, [surface]);

    const toggleFolder = useCallback((folderId: ProjectFolderId) => {
      setOpenFolders((current) => ({
        ...current,
        [folderId]: !current[folderId],
      }));
    }, []);

    const handleSelectedTabChange = (tabId: string | null | undefined) => {
        if (!tabId) return;
        const canvas = canvases.find((candidate) => canvasTabId(candidate.id) === tabId);
        if (canvas) {
            onSelectCanvas(canvas.id);
            return;
        }
        const timeline = timelines.find((candidate) => timelineTabId(candidate.id) === tabId);
        if (timeline) {
          onSelectTimeline(timeline.id);
          return;
        }
        const asset = assets.find(
          (candidate) => assetTabId(candidate.id) === tabId,
        );
        if (asset) onSelectAsset(asset.id);
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
    return (
      <aside
        aria-label="Project navigator"
        aria-hidden={collapsed || undefined}
        data-collapsed={collapsed}
        className={[
          "relative z-20 flex h-full min-h-0 w-full flex-col overflow-hidden bg-warm-page transition-[opacity,visibility] duration-150",
          collapsed
            ? "invisible pointer-events-none opacity-0"
            : "visible opacity-100",
        ].join(" ")}
      >
        {!collapsed ? (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 z-30 w-px bg-warm-border"
            />
            {header ? (
              <div className="clash-project-sidebar-header flex h-10 shrink-0 items-center px-2">
                {header}
              </div>
            ) : null}
            <div className="clash-project-sidebar-search flex h-10 shrink-0 items-start px-2 pt-2">
              {searchButton}
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
            <ProjectFolderSection
              id="canvases"
              label="Canvases"
              open={openFolders.canvases}
              collapsed={collapsed}
              addLabel="New Canvas"
              onToggle={() => toggleFolder("canvases")}
              onAdd={onCreateCanvas}
            >
              {canvases.map((canvas) => {
                const active =
                  surface.kind === "canvas" && surface.canvasId === canvas.id;
                const tab = (
                  <Tab
                    id={canvasTabId(canvas.id)}
                    aria-label={canvas.name}
                    className={rowClass(active, collapsed)}
                  >
                    <SquaresFour
                      className={
                        active
                          ? "h-3.5 w-3.5 text-brand"
                          : "h-3.5 w-3.5 text-stone-400"
                      }
                      weight={active ? "fill" : "regular"}
                    />
                    <span className={collapsed ? "sr-only" : "truncate"}>
                      {canvas.name}
                    </span>
                  </Tab>
                );
                return (
                  <div
                    key={canvas.id}
                    className="group/menu-item relative min-w-0"
                  >
                    {collapsed ? (
                      <Tooltip label={canvas.name}>{tab}</Tooltip>
                    ) : (
                      tab
                    )}
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
                        <DropdownMenuContent
                          side="right"
                          align="start"
                          className="min-w-36 rounded-md p-1"
                        >
                          <DropdownMenuItem
                            onSelect={() => onRenameCanvas(canvas)}
                          >
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => onDeleteCanvas(canvas)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                );
              })}
            </ProjectFolderSection>

            <ProjectFolderSection
              id="timelines"
              label="Timelines"
              open={openFolders.timelines}
              collapsed={collapsed}
              addLabel="New Timeline"
              onToggle={() => toggleFolder("timelines")}
              onAdd={onCreateTimeline}
            >
              {timelines.map((timeline) => {
                const active =
                  surface.kind === "timeline" &&
                  surface.timelineId === timeline.id;
                const tab = (
                  <Tab
                    id={timelineTabId(timeline.id)}
                    aria-label={timeline.name}
                    className={rowClass(active, collapsed)}
                  >
                    <FilmSlate
                      className={
                        active
                          ? "h-3.5 w-3.5 text-brand"
                          : "h-3.5 w-3.5 text-stone-400"
                      }
                      weight={active ? "fill" : "regular"}
                    />
                    <span className={collapsed ? "sr-only" : "truncate"}>
                      {timeline.name}
                    </span>
                  </Tab>
                );
                return (
                  <div
                    key={timeline.id}
                    className="group/menu-item relative min-w-0"
                  >
                    {collapsed ? (
                      <Tooltip label={timeline.name}>{tab}</Tooltip>
                    ) : (
                      tab
                    )}
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
                        <DropdownMenuContent
                          side="right"
                          align="start"
                          className="min-w-44 rounded-md p-1"
                        >
                          <DropdownMenuItem
                            onSelect={() => onAttachTimeline(timeline)}
                          >
                            Move to current Canvas
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                );
              })}
            </ProjectFolderSection>

            <ProjectFolderSection
              id="assets"
              label="Assets"
              open={openFolders.assets}
              collapsed={collapsed}
              addLabel="Add Asset"
              onToggle={() => toggleFolder("assets")}
              onAdd={onAddAsset}
            >
              {assets.length > 0 ? (
                <ul aria-label="Project assets" className="space-y-0">
                  {assets.map((asset) => {
                    const { label, path } = assetNavigationLabel(asset);
                    const AssetIcon =
                      asset.type === "video" ? FilmSlate : ImageIcon;
                    const active =
                      surface.kind === "asset" && surface.assetId === asset.id;
                    const tab = (
                      <Tab
                        id={assetTabId(asset.id)}
                        aria-label={label}
                        title={path}
                        draggable
                        onDragStart={(event) =>
                          writeProjectAssetDrag(event.dataTransfer, asset)
                        }
                        className={`${rowClass(active, collapsed)} cursor-grab active:cursor-grabbing`}
                      >
                        <AssetIcon
                          className={
                            active
                              ? "h-3 w-3 shrink-0 text-brand"
                              : "h-3 w-3 shrink-0 text-stone-400"
                          }
                          weight={active ? "fill" : "regular"}
                        />
                        <span
                          className={
                            collapsed ? "sr-only" : "min-w-0 flex-1 truncate"
                          }
                        >
                          {label}
                        </span>
                      </Tab>
                    );
                    return (
                      <li key={asset.id} className="min-w-0">
                        {collapsed ? <Tooltip label={label}>{tab}</Tooltip> : tab}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </ProjectFolderSection>
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
          </>
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
                <div
                  role="status"
                  className="flex h-12 items-center justify-center text-xs text-stone-400"
                >
                  No results
                </div>
              ) : (
                searchResults.map((result) => {
                  const value = `${result.kind}:${result.id}`;
                  const kindLabel =
                    result.kind === "asset"
                      ? "Asset"
                      : result.kind === "canvas"
                        ? "Canvas"
                        : "Timeline";
                  const ResultIcon =
                    result.kind === "asset"
                      ? ImageIcon
                      : result.kind === "canvas"
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
                      <ResultIcon
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-stone-400"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {result.label}
                      </span>
                      <span className="text-[11px] text-stone-400">
                        {kindLabel}
                      </span>
                    </ComboboxItem>
                  );
                })
              )}
            </ComboboxList>
          </ComboboxProvider>
        </Dialog>
      </aside>
    );
}
