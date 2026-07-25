import {
  CaretRight,
  ChatCenteredDots,
  Cube,
  DotsThree,
  FilmSlate,
  Image as ImageIcon,
  Images,
  MagnifyingGlass,
  Plus,
  SquaresFour,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AgentAnnotationTarget,
  ProjectCanvas,
  ProjectDirectorStage,
  ProjectTimeline,
} from "@clash/shared-types";
import type { ProjectAsset } from "@clash/web-ui/lib/types";
import { writeProjectAssetDrag } from "@clash/web-ui/lib/projectAssetDrag";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxItem,
  ComboboxList,
  ComboboxProvider,
  useComboboxStore,
} from "./ui/combobox";
import { Dialog } from "./ui/dialog";
import { IconButton } from "./ui/icon-button";
import { Tooltip } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Tab, TabList, TabProvider } from "./ui/tabs";
import { AssetThumbnail } from "../features/assets/AssetThumbnail";
import {
  projectAssetDisplayName,
  projectAssetThumbnailSource,
} from "../features/assets/projectAssetPresentation";

export type ProjectWorkspaceSurface =
  | { kind: "canvas"; canvasId: string }
  | { kind: "timeline"; timelineId: string }
  | { kind: "director-stage"; stageId: string }
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
  directorStages?: ProjectDirectorStage[];
  assets: ProjectAsset[];
  globalAssets?: ProjectAsset[];
  surface: ProjectWorkspaceSurface;
  onSelectCanvas: (canvasId: string) => void;
  onSelectTimeline: (timelineId: string) => void;
  onSelectDirectorStage?: (stageId: string) => void;
  onSelectAsset: (assetId: string) => void;
  onCreateCanvas: () => void;
  onRenameCanvas: (canvas: ProjectCanvas) => void;
  onDeleteCanvas: (canvas: ProjectCanvas) => void;
  onCreateTimeline: () => void;
  onAttachTimeline: (timeline: ProjectTimeline) => void;
  onDeleteTimeline?: (timeline: ProjectTimeline) => void;
  onCreateDirectorStage?: () => void;
  onAttachDirectorStage?: (stage: ProjectDirectorStage) => void;
  onAddAsset: () => void;
  onAddGlobalAsset?: (assetId: string) => void | Promise<void>;
  onAddAssetToLibrary?: (assetId: string) => void;
  /** Queues an agent annotation for a sidebar object (project id added by the caller). */
  onAnnotate?: (target: Omit<AgentAnnotationTarget, "projectId">) => void;
}

const sectionHeaderClass =
  "flex h-[var(--clash-project-control-rhythm,2rem)] items-center justify-between px-1";
const sectionHeadingClass =
  "font-display text-[11px] font-semibold text-stone-500";
const sidebarActionSlotClass =
  "clash-project-sidebar-action-slot h-6 min-h-6 w-6 min-w-6";

type ProjectFolderId = "canvases" | "timelines" | "director-stages" | "assets";

interface ProjectFolderSectionProps {
  id: ProjectFolderId;
  label: string;
  open: boolean;
  collapsed: boolean;
  addLabel?: string;
  onToggle: () => void;
  onAdd?: () => void;
  addControl?: ReactNode;
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
  addControl,
  children,
}: ProjectFolderSectionProps) {
  const headingId = `project-${id}-heading`;
  const contentId = `project-${id}-list`;

  return (
    <section
      data-project-folder={id}
      aria-label={collapsed ? label : undefined}
      aria-labelledby={collapsed ? undefined : headingId}
      className="mt-[var(--clash-project-action-phase,0.5rem)] first:mt-0"
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
              className="flex h-[var(--clash-project-control-rhythm,2rem)] w-full min-w-0 items-center justify-start gap-1.5 rounded-md bg-transparent px-1 text-left shadow-none hover:bg-black/[0.025] focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-0"
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
          {addControl ??
            (addLabel && onAdd ? (
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
            ) : null)}
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

interface SidebarContextAction {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * Right-click menu for a sidebar row: annotate-for-agent first, then the
 * row's own actions (the same ones its "…" dropdown offers).
 */
function SidebarItemContextMenu({
  label,
  onAnnotate,
  actions = [],
  children,
}: {
  label: string;
  onAnnotate?: () => void;
  actions?: SidebarContextAction[];
  children: ReactNode;
}) {
  if (!onAnnotate && actions.length === 0) return <>{children}</>;
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{label}</ContextMenuLabel>
        {onAnnotate ? (
          <ContextMenuItem onSelect={onAnnotate}>
            <ChatCenteredDots
              className="h-4 w-4 shrink-0 text-stone-500 dark:text-stone-400"
              weight="duotone"
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              Annotate for agent
            </span>
          </ContextMenuItem>
        ) : null}
        {onAnnotate && actions.length > 0 ? <ContextMenuSeparator /> : null}
        {actions.map((action) => (
          <ContextMenuItem
            key={action.key}
            onSelect={action.onSelect}
            className={
              action.danger
                ? "text-red-600 data-[highlighted]:text-red-700 dark:text-red-400"
                : undefined
            }
          >
            {action.icon}
            <span className="min-w-0 flex-1 truncate">{action.label}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

type ProjectSearchResult =
  | { kind: "canvas"; id: string; label: string; searchText: string }
  | { kind: "timeline"; id: string; label: string; searchText: string }
  | { kind: "director-stage"; id: string; label: string; searchText: string }
  | {
      kind: "asset";
      id: string;
      label: string;
      searchText: string;
    };

function rowClass(active: boolean, collapsed: boolean): string {
  return [
    "group/menu-button relative flex h-[var(--clash-project-control-rhythm,2rem)] w-full min-w-0 items-center rounded-md text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
    collapsed
      ? "justify-center gap-0 px-0 text-center"
      : "gap-2 px-2 pr-8 text-left",
    active
      ? "bg-brand/[0.09] font-semibold text-slate-950 dark:text-neutral-100"
      : "text-stone-600 hover:bg-black/[0.035] hover:text-slate-950 dark:text-neutral-400 dark:hover:bg-white/[0.045] dark:hover:text-neutral-100",
  ].join(" ");
}

function canvasTabId(canvasId: string): string {
  return `project-canvas-${canvasId}`;
}

function timelineTabId(timelineId: string): string {
  return `project-timeline-${timelineId}`;
}

function directorStageTabId(stageId: string): string {
  return `project-director-stage-${stageId}`;
}

function assetTabId(assetId: string): string {
  return `project-asset-${assetId}`;
}

function selectedTabId(surface: ProjectWorkspaceSurface): string {
  if (surface.kind === "canvas") return canvasTabId(surface.canvasId);
  if (surface.kind === "timeline") return timelineTabId(surface.timelineId);
  if (surface.kind === "director-stage") return directorStageTabId(surface.stageId);
  return assetTabId(surface.assetId);
}

function assetNavigationLabel(asset: ProjectAsset): {
  label: string;
  path: string;
} {
  const path = asset.storageKey?.trim() || asset.id;
  const label = projectAssetDisplayName(asset);
  return { label, path };
}

export default function ProjectWorkspaceNavigator({
  header,
  footer,
  collapsed = false,
  canvases,
  timelines,
  directorStages = [],
  assets,
  globalAssets = [],
  surface,
  onSelectCanvas,
  onSelectTimeline,
  onSelectDirectorStage,
  onSelectAsset,
  onCreateCanvas,
  onRenameCanvas,
  onDeleteCanvas,
  onCreateTimeline,
  onAttachTimeline,
  onDeleteTimeline,
  onCreateDirectorStage,
  onAttachDirectorStage,
  onAddAsset,
  onAddGlobalAsset,
  onAddAssetToLibrary,
  onAnnotate,
}: ProjectWorkspaceNavigatorProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [openFolders, setOpenFolders] = useState<
    Record<ProjectFolderId, boolean>
  >({
    canvases: true,
    timelines: true,
    "director-stages": true,
    assets: true,
  });
  const searchResults = useMemo<ProjectSearchResult[]>(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    const results: ProjectSearchResult[] = [
      ...canvases.map((canvas) => ({
        kind: "canvas" as const,
        id: canvas.id,
        label: canvas.name,
        searchText: `${canvas.name} canvas canvases`,
      })),
      ...timelines.map((timeline) => ({
        kind: "timeline" as const,
        id: timeline.id,
        label: timeline.name,
        searchText: `${timeline.name} timeline timelines`,
      })),
      ...directorStages.map((stage) => ({
        kind: "director-stage" as const,
        id: stage.id,
        label: stage.name,
        searchText: `${stage.name} director stage 3d blocking camera`,
      })),
      ...assets.map((asset) => {
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
      }),
    ];

    if (!normalizedQuery) return results;
    return results.filter((result) =>
      result.searchText.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [assets, canvases, directorStages, searchQuery, timelines]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
  }, []);

  const handleSearchSelection = useCallback(
    (selectedValue: string) => {
      const [kind, ...idParts] = selectedValue.split(":");
      const id = idParts.join(":");
      if (kind === "canvas") onSelectCanvas(id);
      if (kind === "timeline") onSelectTimeline(id);
      if (kind === "director-stage") onSelectDirectorStage?.(id);
      if (kind === "asset") onSelectAsset(id);
      closeSearch();
    },
    [closeSearch, onSelectAsset, onSelectCanvas, onSelectDirectorStage, onSelectTimeline],
  );

  const searchStore = useComboboxStore({
    value: searchQuery,
    setValue: setSearchQuery,
    setSelectedValue: (selectedValue) => {
      if (typeof selectedValue === "string")
        handleSearchSelection(selectedValue);
    },
    focusLoop: true,
    focusWrap: true,
    orientation: "vertical",
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLocaleLowerCase() === "k"
      ) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const folderId: ProjectFolderId =
      surface.kind === "canvas"
        ? "canvases"
        : surface.kind === "timeline"
          ? "timelines"
          : surface.kind === "director-stage"
            ? "director-stages"
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
    const canvas = canvases.find(
      (candidate) => canvasTabId(candidate.id) === tabId,
    );
    if (canvas) {
      onSelectCanvas(canvas.id);
      return;
    }
    const timeline = timelines.find(
      (candidate) => timelineTabId(candidate.id) === tabId,
    );
    if (timeline) {
      onSelectTimeline(timeline.id);
      return;
    }
    const directorStage = directorStages.find(
      (candidate) => directorStageTabId(candidate.id) === tabId,
    );
    if (directorStage) {
      onSelectDirectorStage?.(directorStage.id);
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
        "h-[var(--clash-project-control-rhythm,2rem)] justify-start rounded-md border border-warm-border/80 bg-warm-surface text-[12px] font-normal text-stone-500 shadow-none hover:bg-warm-muted focus-visible:ring-1 focus-visible:ring-brand/60 focus-visible:ring-offset-0 dark:text-neutral-400 dark:hover:text-neutral-200",
        collapsed ? "w-8 justify-center px-0" : "w-full gap-2 px-2",
      ].join(" ")}
      leftIcon={<MagnifyingGlass className="h-3.5 w-3.5" weight="regular" />}
    >
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1 truncate text-left">Search</span>
          <kbd className="font-sans text-[10px] font-medium text-stone-400">
            ⌘K
          </kbd>
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
          <div className="clash-project-sidebar-search flex h-[var(--clash-project-search-row-height,2.5rem)] shrink-0 items-start px-2 pt-[var(--clash-project-action-phase,0.5rem)]">
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
              className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-[var(--clash-project-action-phase,0.5rem)]"
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
                    <SidebarItemContextMenu
                      key={canvas.id}
                      label={canvas.name}
                      onAnnotate={onAnnotate
                        ? () =>
                            onAnnotate({
                              surface: "canvas",
                              surfaceId: canvas.id,
                              surfaceLabel: canvas.name,
                              objectId: canvas.id,
                              objectType: "canvas",
                              objectLabel: canvas.name,
                              objectPath: `canvases/${canvas.id}`,
                              capabilities: ["read", "modify"],
                            })
                        : undefined}
                      actions={[
                        {
                          key: "rename",
                          label: "Rename",
                          onSelect: () => onRenameCanvas(canvas),
                        },
                        {
                          key: "delete",
                          label: "Delete",
                          danger: true,
                          icon: <Trash className="h-4 w-4 shrink-0" />,
                          onSelect: () => onDeleteCanvas(canvas),
                        },
                      ]}
                    >
                    <div
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
                              icon={
                                <DotsThree className="h-4 w-4" weight="bold" />
                              }
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
                    </SidebarItemContextMenu>
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
                    <SidebarItemContextMenu
                      key={timeline.id}
                      label={timeline.name}
                      onAnnotate={onAnnotate
                        ? () =>
                            onAnnotate({
                              surface: "timeline",
                              surfaceId: timeline.id,
                              surfaceLabel: timeline.name,
                              objectId: timeline.id,
                              objectType: "timeline",
                              objectLabel: timeline.name,
                              objectPath: `timelines/${timeline.id}`,
                              capabilities: ["read", "modify"],
                            })
                        : undefined}
                      actions={[
                        {
                          key: "attach",
                          label: "Move to current Canvas",
                          onSelect: () => onAttachTimeline(timeline),
                        },
                        ...(onDeleteTimeline
                          ? [{
                              key: "delete",
                              label: "Delete",
                              danger: true,
                              icon: <Trash className="h-4 w-4 shrink-0" />,
                              onSelect: () => onDeleteTimeline(timeline),
                            }]
                          : []),
                      ]}
                    >
                    <div
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
                              icon={
                                <DotsThree className="h-4 w-4" weight="bold" />
                              }
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
                            {onDeleteTimeline ? (
                              <DropdownMenuItem
                                className="text-red-600 focus:text-red-700"
                                onSelect={() => onDeleteTimeline(timeline)}
                              >
                                Delete
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                    </SidebarItemContextMenu>
                  );
                })}
              </ProjectFolderSection>

              <ProjectFolderSection
                id="director-stages"
                label="Director Stages"
                open={openFolders["director-stages"]}
                collapsed={collapsed}
                addLabel={onCreateDirectorStage ? "New Director Stage" : undefined}
                onToggle={() => toggleFolder("director-stages")}
                onAdd={onCreateDirectorStage}
              >
                {directorStages.map((stage) => {
                  const active =
                    surface.kind === "director-stage" &&
                    surface.stageId === stage.id;
                  const tab = (
                    <Tab
                      id={directorStageTabId(stage.id)}
                      aria-label={stage.name}
                      className={rowClass(active, collapsed)}
                    >
                      <Cube
                        className={
                          active
                            ? "h-3.5 w-3.5 text-brand"
                            : "h-3.5 w-3.5 text-stone-400"
                        }
                        weight={active ? "fill" : "regular"}
                      />
                      <span className={collapsed ? "sr-only" : "truncate"}>
                        {stage.name}
                      </span>
                    </Tab>
                  );
                  return (
                    <SidebarItemContextMenu
                      key={stage.id}
                      label={stage.name}
                      onAnnotate={onAnnotate
                        ? () =>
                            onAnnotate({
                              surface: "director-stage",
                              surfaceId: stage.id,
                              surfaceLabel: stage.name,
                              objectId: stage.id,
                              objectType: "director-stage",
                              objectLabel: stage.name,
                              objectPath: `director-stages/${stage.id}`,
                              capabilities: ["read", "modify"],
                            })
                        : undefined}
                      actions={onAttachDirectorStage
                        ? [{
                            key: "attach",
                            label: "Move to current Canvas",
                            onSelect: () => onAttachDirectorStage(stage),
                          }]
                        : []}
                    >
                    <div
                      className="group/menu-item relative min-w-0"
                    >
                      {collapsed ? <Tooltip label={stage.name}>{tab}</Tooltip> : tab}
                      {!collapsed && onAttachDirectorStage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              label={`Director Stage actions for ${stage.name}`}
                              icon={<DotsThree className="h-4 w-4" weight="bold" />}
                              size="sm"
                              shape="rounded"
                              className={`${sidebarActionSlotClass} absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-transparent text-stone-400 opacity-0 hover:bg-stone-100 hover:text-slate-950 group-hover/menu-item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100`}
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="right" align="start" className="min-w-44 rounded-md p-1">
                            <DropdownMenuItem onSelect={() => onAttachDirectorStage(stage)}>
                              Move to current Canvas
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                    </SidebarItemContextMenu>
                  );
                })}
              </ProjectFolderSection>

              <ProjectFolderSection
                id="assets"
                label="Assets"
                open={openFolders.assets}
                collapsed={collapsed}
                onToggle={() => toggleFolder("assets")}
                addControl={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        label="Add Asset"
                        icon={<Plus className="h-3 w-3" weight="bold" />}
                        size="sm"
                        shape="rounded"
                        className={`${sidebarActionSlotClass} rounded-md bg-transparent text-stone-500 hover:bg-black/[0.04] hover:text-slate-950`}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      side="right"
                      align="start"
                      className="min-w-52 rounded-xl p-1"
                    >
                      <DropdownMenuItem onSelect={onAddAsset}>
                        <UploadSimple className="h-4 w-4 text-stone-500" />
                        Upload from Mac
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => setLibraryPickerOpen(true)}
                      >
                        <Images className="h-4 w-4 text-stone-500" />
                        Add from Global Assets
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              >
                {assets.length > 0 ? (
                  <ul aria-label="Project assets" className="space-y-0">
                    {assets.map((asset) => {
                      const { label } = assetNavigationLabel(asset);
                      const active =
                        surface.kind === "asset" &&
                        surface.assetId === asset.id;
                      const tab = (
                        <Tab
                          id={assetTabId(asset.id)}
                          aria-label={label}
                          title={label}
                          draggable
                          onDragStart={(event) =>
                            writeProjectAssetDrag(event.dataTransfer, asset)
                          }
                          className={`${rowClass(active, collapsed)} cursor-grab active:cursor-grabbing`}
                        >
                          <AssetThumbnail
                            type={asset.type}
                            src={projectAssetThumbnailSource(asset)}
                            label={label}
                            active={active}
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
                      const assetRowId = asset.assetId ?? asset.id;
                      const canAddToLibrary = Boolean(
                        onAddAssetToLibrary &&
                          !globalAssets.some(
                            (globalAsset) => globalAsset.id === asset.id,
                          ),
                      );
                      return (
                        <SidebarItemContextMenu
                          key={asset.id}
                          label={label}
                          onAnnotate={onAnnotate
                            ? () =>
                                onAnnotate({
                                  surface: "asset",
                                  surfaceId: asset.id,
                                  surfaceLabel: label,
                                  objectId: assetRowId,
                                  objectType: `asset-${asset.type}`,
                                  objectLabel: label,
                                  objectPath: `assets/${assetRowId}`,
                                  capabilities: ["read", "modify"],
                                  ...(asset.type === "image" ||
                                  asset.type === "video"
                                    ? { previewAssetId: assetRowId }
                                    : {}),
                                })
                            : undefined}
                          actions={canAddToLibrary && onAddAssetToLibrary
                            ? [{
                                key: "add-to-library",
                                label: "Add to Global Assets",
                                icon: (
                                  <Images className="h-4 w-4 shrink-0 text-stone-500" />
                                ),
                                onSelect: () =>
                                  onAddAssetToLibrary(assetRowId),
                              }]
                            : []}
                        >
                        <li
                          data-agent-annotation-object-id={assetRowId}
                          className="group/menu-item relative min-w-0"
                        >
                          {collapsed ? (
                            <Tooltip label={label}>{tab}</Tooltip>
                          ) : (
                            tab
                          )}
                          {!collapsed &&
                          onAddAssetToLibrary &&
                          !globalAssets.some(
                            (globalAsset) => globalAsset.id === asset.id,
                          ) ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton
                                  label={`More options for ${label}`}
                                  icon={
                                    <DotsThree
                                      className="h-4 w-4"
                                      weight="bold"
                                    />
                                  }
                                  size="sm"
                                  shape="rounded"
                                  className={`${sidebarActionSlotClass} absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-transparent text-stone-400 opacity-0 hover:bg-stone-100 hover:text-slate-950 group-hover/menu-item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100`}
                                />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                side="right"
                                align="start"
                                className="min-w-48 rounded-xl p-1"
                              >
                                <DropdownMenuItem
                                  onSelect={() =>
                                    onAddAssetToLibrary(
                                      asset.assetId ?? asset.id,
                                    )
                                  }
                                >
                                  <Images className="h-4 w-4 text-stone-500" />
                                  Add to Global Assets
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </li>
                        </SidebarItemContextMenu>
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
        open={libraryPickerOpen}
        onClose={() => setLibraryPickerOpen(false)}
        title="Add from Global Assets"
        description="Choose reusable media to add to this project."
        size="lg"
      >
        {globalAssets.filter(
          (asset) =>
            !assets.some((projectAsset) => projectAsset.id === asset.id),
        ).length > 0 ? (
          <ul
            aria-label="Available global assets"
            className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {globalAssets
              .filter(
                (asset) =>
                  !assets.some((projectAsset) => projectAsset.id === asset.id),
              )
              .map((asset) => {
                const { label } = assetNavigationLabel(asset);
                return (
                  <li key={asset.id}>
                    <button
                      type="button"
                      aria-label={`Add ${label}`}
                      onClick={() => {
                        void Promise.resolve(
                          onAddGlobalAsset?.(asset.assetId ?? asset.id),
                        ).then(() => setLibraryPickerOpen(false));
                      }}
                      className="group w-full rounded-xl border border-warm-border bg-warm-page/50 p-2 text-left transition-colors hover:border-brand/30 hover:bg-brand/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                    >
                      <span className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-stone-100">
                        <AssetThumbnail
                          type={asset.type}
                          src={projectAssetThumbnailSource(asset)}
                          label={label}
                          variant="card"
                          decorative
                        />
                      </span>
                      <span className="mt-2 block truncate text-sm font-semibold text-slate-900">
                        {label}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        ) : (
          <div className="mt-5 border-y border-dashed border-warm-border py-12 text-center">
            <p className="text-sm font-semibold text-slate-900">
              No reusable assets available
            </p>
            <p className="mt-1 text-sm text-stone-500">
              Add assets from the Home Assets tab first.
            </p>
          </div>
        )}
      </Dialog>
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
              placeholder="Search canvases, stages, timelines, and assets"
              className="h-12 w-full bg-transparent pl-10 pr-4 text-sm text-slate-950 outline-none placeholder:text-stone-400 focus-visible:ring-0 dark:text-neutral-100 dark:placeholder:text-neutral-500"
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
                      : result.kind === "director-stage"
                        ? "Director Stage"
                        : "Timeline";
                const ResultIcon =
                  result.kind === "asset"
                    ? ImageIcon
                    : result.kind === "canvas"
                      ? SquaresFour
                      : result.kind === "director-stage"
                        ? Cube
                        : FilmSlate;
                return (
                  <ComboboxItem
                    key={value}
                    value={value}
                    focusOnHover
                    setValueOnClick={false}
                    aria-label={`${result.label} ${kindLabel}`}
                    className="flex h-10 w-full cursor-default items-center gap-3 rounded-md px-2.5 text-left text-[13px] text-slate-900 outline-none hover:bg-warm-muted data-[active-item]:bg-warm-muted focus-visible:bg-warm-muted dark:text-neutral-100"
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
