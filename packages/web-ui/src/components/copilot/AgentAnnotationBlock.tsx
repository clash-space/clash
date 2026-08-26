import { useCallback, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CaretDown,
  CaretUp,
  Crosshair,
  NotePencil,
  Quotes,
  Trash,
  X,
} from "@phosphor-icons/react";
import type {
  AgentAnnotationDraft,
  AgentAnnotationTarget,
} from "@clash/shared-types";
import { useAsset } from "@clash/web-ui/lib/hooks/useAsset";
import { IconButton } from "../ui/icon-button";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { ProjectSurfaceIcon } from "../ProjectSurfaceIcon";
import { VideoPoster } from "../../features/assets/VideoPoster";

const SURFACE_LABELS = {
  canvas: "Canvas",
  timeline: "Timeline",
  "director-stage": "Director Stage",
  asset: "Asset",
  browser: "Browser",
} as const;

function formatObjectType(objectType: string): string {
  const parts = objectType.split(/[-_\s]+/).filter(Boolean);
  if (parts[0] === "director" && parts[1] === "stage" && parts.length > 2) {
    parts.splice(0, 2);
  } else if (
    parts.length > 1 &&
    ["canvas", "timeline", "asset", "browser"].includes(parts[0])
  ) {
    parts.shift();
  }
  return parts
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function SurfaceIcon({
  surface,
  className = "h-4 w-4",
}: {
  surface: AgentAnnotationDraft["target"]["surface"];
  className?: string;
}) {
  return (
    <ProjectSurfaceIcon
      surface={surface}
      className={className}
      weight="duotone"
    />
  );
}

/**
 * Matches the numbered pins that AgentSelectionAnnotationOverlay renders on the
 * creative surfaces: annotation order is the shared numbering.
 */
function AnnotationNumberBadge({ number }: { number: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-semibold leading-none text-white"
    >
      {number}
    </span>
  );
}

export function AgentAnnotationActionsContextMenu({
  annotation,
  onOpen,
  onLocate,
  onRemove,
  children,
}: {
  annotation: AgentAnnotationDraft;
  onOpen?: () => void;
  onLocate?: () => void;
  onRemove?: () => void;
  children: ReactNode;
}) {
  if (!onOpen && !onLocate && !onRemove) return <>{children}</>;
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        aria-label={`Annotation actions for ${annotation.target.objectLabel}`}
      >
        <ContextMenuLabel>{annotation.target.objectLabel}</ContextMenuLabel>
        {onOpen ? (
          <ContextMenuItem onSelect={onOpen}>
            <NotePencil className="h-4 w-4 shrink-0" weight="duotone" />
            Open annotation
          </ContextMenuItem>
        ) : null}
        {onLocate ? (
          <ContextMenuItem onSelect={onLocate}>
            <Crosshair className="h-4 w-4 shrink-0" weight="bold" />
            Locate in workspace
          </ContextMenuItem>
        ) : null}
        {onRemove ? <ContextMenuSeparator /> : null}
        {onRemove ? (
          <ContextMenuItem
            onSelect={onRemove}
            className="text-red-600 dark:text-red-400"
          >
            <Trash className="h-4 w-4 shrink-0" weight="bold" />
            Remove annotation
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Media preview for annotations that target an asset-backed object. */
function AnnotationAssetThumbnail({
  target,
  size = "sm",
}: {
  target: AgentAnnotationTarget;
  size?: "sm" | "md" | "lg";
}) {
  const asset = useAsset(target.projectId, target.previewAssetId);
  const isVideo =
    target.objectType.includes("video") || asset?.kind === "video";
  const mediaUrl = isVideo ? asset?.thumbnailUrl : asset?.url;
  const hasVideoPreview = Boolean(
    asset?.thumbnailUrl || (asset?.status === "ready" && asset.url),
  );
  const sizeClass =
    size === "lg"
      ? "h-auto max-h-36 w-auto max-w-full rounded-md"
      : size === "md"
        ? "h-7 w-7 rounded-md"
        : "h-5 w-5 rounded";

  if (size === "lg") {
    if (isVideo) {
      if (!asset || !hasVideoPreview) return null;
      return (
        <span
          data-testid="annotation-asset-preview"
          className={`${sizeClass} relative inline-flex overflow-hidden bg-warm-muted`}
        >
          <VideoPoster
            thumbnailSrc={asset.thumbnailUrl}
            videoSrc={asset.url}
            status={asset.status}
            alt={target.objectLabel}
            className={`${sizeClass} bg-warm-muted object-contain`}
          />
        </span>
      );
    }
    if (!mediaUrl) return null;
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        data-testid="annotation-asset-preview"
        src={mediaUrl}
        alt={target.objectLabel}
        className={`${sizeClass} bg-warm-muted object-contain`}
      />
    );
  }

  // No resolved media yet (still signing, or nothing renderable): show
  // nothing rather than an empty gray tile.
  if (isVideo ? !hasVideoPreview : !mediaUrl) return null;

  return (
    <span
      data-testid="annotation-asset-thumbnail"
      className={`${sizeClass} shrink-0 overflow-hidden bg-warm-muted ring-1 ring-warm-border flex items-center justify-center`}
    >
      {isVideo && asset ? (
        <VideoPoster
          thumbnailSrc={asset.thumbnailUrl}
          videoSrc={asset.url}
          status={asset.status}
          alt={target.objectLabel}
          className="h-full w-full object-cover"
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={mediaUrl}
          alt={target.objectLabel}
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}

function AnnotationRow({
  annotation,
  number,
  expanded,
  disabled,
  onToggle,
  onOpen,
  onChange,
  onRemove,
  onLocate,
}: {
  annotation: AgentAnnotationDraft;
  number: number;
  expanded: boolean;
  disabled: boolean;
  onToggle: () => void;
  onOpen?: () => void;
  onChange?: (note: string) => void;
  onRemove?: () => void;
  onLocate?: () => void;
}) {
  const { target } = annotation;
  const focusEditorAtEnd = useCallback((editor: HTMLTextAreaElement | null) => {
    if (!editor) return;
    editor.focus();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
  }, []);

  const row = (
    <li
      data-testid="agent-annotation-item"
      data-agent-annotation-surface={target.surface}
      data-expanded={expanded ? "true" : "false"}
      className="group/annotation relative rounded-lg transition-colors hover:bg-warm-muted/50 dark:hover:bg-warm-muted/50"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`Annotation ${number}: ${target.objectLabel}`}
          onClick={onOpen ?? onToggle}
          disabled={disabled}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
        >
          <AnnotationNumberBadge number={number} />
          {target.previewAssetId ? (
            <AnnotationAssetThumbnail target={target} size="md" />
          ) : (
            <span
              className="shrink-0 text-stone-500 dark:text-stone-400"
              aria-hidden="true"
            >
              <SurfaceIcon surface={target.surface} className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="truncate text-[13px] font-medium">
            {target.objectLabel}
          </span>
          <span
            data-testid="agent-annotation-object-type"
            className="shrink-0 rounded bg-warm-muted px-1.5 py-0.5 text-[10px] font-medium text-stone-600 dark:bg-warm-muted dark:text-neutral-300"
          >
            {formatObjectType(target.objectType)}
          </span>
          <span className="truncate text-[11px] text-stone-500 dark:text-stone-400">
            {target.surfaceLabel}
          </span>
          {target.selection ? (
            <Quotes
              className="h-3 w-3 shrink-0 text-stone-400"
              weight="fill"
              aria-hidden="true"
            />
          ) : null}
          {annotation.note.trim() ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400"
              aria-hidden="true"
            />
          ) : null}
        </button>
        {onLocate ? (
          <IconButton
            label={`Locate annotation for ${target.objectLabel}`}
            icon={<Crosshair className="h-3.5 w-3.5" weight="bold" />}
            variant="default"
            size="sm"
            shape="rounded"
            onClick={onLocate}
            disabled={disabled}
            className="h-6 min-h-6 w-6 min-w-6 text-stone-400 opacity-70 hover:text-slate-900 group-hover/annotation:opacity-100 focus-visible:opacity-100 dark:hover:text-slate-100"
          />
        ) : null}
        {onRemove ? (
          <IconButton
            label={`Remove annotation for ${target.objectLabel}`}
            icon={<X className="h-3 w-3" weight="bold" />}
            variant="default"
            size="sm"
            shape="rounded"
            onClick={onRemove}
            disabled={disabled}
            className="h-6 min-h-6 w-6 min-w-6 text-stone-400 opacity-70 hover:text-slate-900 group-hover/annotation:opacity-100 focus-visible:opacity-100 dark:hover:text-slate-100"
          />
        ) : null}
      </div>
      {expanded ? (
        <div className="border-t border-warm-border/70 px-2.5 pb-2 pt-1.5 dark:border-warm-border/70">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">
              {SURFACE_LABELS[target.surface]}
            </span>
            <span className="truncate font-mono text-[10px] text-stone-500 dark:text-stone-400">
              {target.objectPath}
            </span>
          </div>
          {target.previewAssetId ? (
            <div className="mt-1.5">
              <AnnotationAssetThumbnail target={target} size="lg" />
            </div>
          ) : null}
          {target.selection ? (
            <blockquote className="mt-1.5 flex gap-1.5 rounded-md bg-warm-muted/70 px-2 py-1.5 text-[12px] leading-4 text-stone-600 dark:bg-warm-muted/70 dark:text-neutral-300">
              <Quotes
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400"
                weight="fill"
                aria-hidden="true"
              />
              <span className="line-clamp-3">{target.selection.exact}</span>
            </blockquote>
          ) : null}
          <Textarea
            ref={onChange ? focusEditorAtEnd : undefined}
            aria-label={`Annotation for ${target.objectLabel}`}
            value={annotation.note}
            placeholder={
              target.selection
                ? "Add an optional comment…"
                : "What should the agent inspect or change?"
            }
            rows={2}
            readOnly={!onChange}
            disabled={disabled}
            onChange={(event) => onChange?.(event.target.value)}
            className="mt-1.5 block min-h-9 w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-5 text-slate-900 placeholder:text-stone-400 focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-slate-100 dark:placeholder:text-stone-500"
          />
        </div>
      ) : null}
    </li>
  );
  return (
    <AgentAnnotationActionsContextMenu
      annotation={annotation}
      onOpen={onOpen}
      onLocate={onLocate}
      onRemove={onRemove}
    >
      {row}
    </AgentAnnotationActionsContextMenu>
  );
}

export function AgentAnnotationTray({
  annotations,
  disabled = false,
  onChange,
  onRemove,
  onLocate,
  onOpen,
}: {
  annotations: readonly AgentAnnotationDraft[];
  disabled?: boolean;
  onChange?: (id: string, note: string) => void;
  onRemove?: (id: string) => void;
  onLocate?: (id: string) => void;
  onOpen?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // null = automatic (a single annotation opens straight into its details);
  // COLLAPSED_ALL = the user explicitly closed the auto-opened details.
  const COLLAPSED_ALL = "__collapsed__";
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (annotations.length === 0) return null;
  const count = annotations.length;
  const detailId =
    expandedId === COLLAPSED_ALL
      ? null
      : (expandedId ?? (count === 1 ? annotations[0].id : null));
  const assetAnnotations = annotations.filter(
    (annotation) => annotation.target.previewAssetId,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          data-testid="agent-annotation-tray"
          data-open={open ? "true" : "false"}
          className="px-3 pt-3"
        >
          <button
            type="button"
            aria-expanded={open}
            aria-label="Agent annotations"
            onClick={() => setOpen((value) => !value)}
            disabled={disabled}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-warm-border bg-warm-surface py-1 pl-2 pr-2.5 text-[12px] font-medium leading-4 text-slate-900 transition-colors hover:bg-warm-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 dark:border-warm-border dark:bg-warm-surface dark:text-neutral-100 dark:hover:bg-warm-muted/60"
          >
            {assetAnnotations.length > 0 ? (
              <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
                {assetAnnotations.slice(0, 3).map((annotation) => (
                  <AnnotationAssetThumbnail
                    key={annotation.id}
                    target={annotation.target}
                    size="sm"
                  />
                ))}
              </span>
            ) : (
              <NotePencil
                className="h-3.5 w-3.5 shrink-0 text-stone-500 dark:text-stone-400"
                weight="duotone"
                aria-hidden="true"
              />
            )}
            <AnnotationNumberBadge number={count} />
            <span>{count === 1 ? "annotation" : "annotations"}</span>
            {open ? (
              <CaretUp
                className="h-3 w-3 shrink-0 text-stone-400"
                weight="bold"
                aria-hidden="true"
              />
            ) : (
              <CaretDown
                className="h-3 w-3 shrink-0 text-stone-400"
                weight="bold"
                aria-hidden="true"
              />
            )}
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[min(440px,calc(100vw-24px))] rounded-xl p-1"
      >
        <ul
          aria-label="Agent annotations"
          className="max-h-[min(50vh,360px)] overflow-y-auto text-slate-900 dark:text-slate-100"
        >
          {annotations.map((annotation, index) => (
            <AnnotationRow
              key={annotation.id}
              annotation={annotation}
              number={index + 1}
              expanded={detailId === annotation.id}
              disabled={disabled}
              onOpen={
                onOpen
                  ? () => {
                      setOpen(false);
                      onOpen(annotation.id);
                    }
                  : undefined
              }
              onToggle={() =>
                setExpandedId(
                  detailId === annotation.id ? COLLAPSED_ALL : annotation.id,
                )
              }
              onChange={
                onChange ? (note) => onChange(annotation.id, note) : undefined
              }
              onRemove={onRemove ? () => onRemove(annotation.id) : undefined}
              onLocate={onLocate ? () => onLocate(annotation.id) : undefined}
            />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function AgentAnnotationInspector({
  annotations,
  activeId,
  disabled = false,
  onSelect,
  onBack,
  onChange,
  onRemove,
  onLocate,
}: {
  annotations: readonly AgentAnnotationDraft[];
  activeId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onBack: () => void;
  onChange?: (id: string, note: string) => void;
  onRemove?: (id: string) => void;
  onLocate?: (id: string) => void;
}) {
  const activeIndex = annotations.findIndex(
    (annotation) => annotation.id === activeId,
  );
  const annotation = activeIndex >= 0 ? annotations[activeIndex] : null;
  if (!annotation) return null;
  const { target } = annotation;

  return (
    <section
      data-testid="agent-annotation-inspector"
      aria-label={`Annotation for ${target.objectLabel}`}
      className="flex h-full min-h-0 flex-col bg-warm-page text-content-primary"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-warm-border px-3">
        <IconButton
          label="Back to chat"
          title="Back to chat"
          size="sm"
          shape="rounded"
          onClick={onBack}
          icon={<ArrowLeft className="h-4 w-4" weight="bold" />}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {target.objectLabel}
          </div>
          <div className="truncate text-[11px] text-content-muted">
            Annotation {activeIndex + 1} of {annotations.length}
          </div>
        </div>
        {onLocate ? (
          <IconButton
            label={`Locate annotation for ${target.objectLabel}`}
            title="Locate in workspace"
            size="sm"
            shape="rounded"
            onClick={() => onLocate(annotation.id)}
            icon={<Crosshair className="h-4 w-4" weight="bold" />}
          />
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <AgentAnnotationActionsContextMenu
          annotation={annotation}
          onLocate={onLocate ? () => onLocate(annotation.id) : undefined}
          onRemove={onRemove ? () => onRemove(annotation.id) : undefined}
        >
          <div
            data-testid="agent-annotation-target-summary"
            className="rounded-xl bg-warm-surface/70 p-3 ring-1 ring-inset ring-warm-border"
          >
            <div className="flex min-w-0 items-start gap-2.5">
              <AnnotationNumberBadge number={activeIndex + 1} />
              {target.previewAssetId ? (
                <AnnotationAssetThumbnail target={target} size="md" />
              ) : (
                <span
                  className="mt-0.5 shrink-0 text-content-muted"
                  aria-hidden="true"
                >
                  <SurfaceIcon surface={target.surface} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {target.objectLabel}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-content-muted">
                  <span>{target.surfaceLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">
                    {formatObjectType(target.objectType)}
                  </span>
                </div>
              </div>
            </div>
            {target.previewAssetId ? (
              <div className="mt-3 overflow-hidden rounded-lg bg-warm-muted">
                <AnnotationAssetThumbnail target={target} size="lg" />
              </div>
            ) : null}
            {target.selection ? (
              <blockquote className="mt-3 flex gap-2 rounded-r-lg border-l-2 border-brand/45 bg-warm-muted/45 px-3 py-2.5 text-[13px] leading-5 text-content-secondary">
                <Quotes
                  className="mt-0.5 h-4 w-4 shrink-0 text-content-muted"
                  weight="fill"
                  aria-hidden="true"
                />
                <span>{target.selection.exact}</span>
              </blockquote>
            ) : (
              <p className="mt-3 text-[11px] leading-4 text-content-muted">
                Attached to the whole{" "}
                {formatObjectType(target.objectType).toLowerCase()}.
              </p>
            )}
          </div>
        </AgentAnnotationActionsContextMenu>

        <div className="mt-5">
          <label
            htmlFor={`annotation-note-${annotation.id}`}
            className="text-xs font-semibold text-content-secondary"
          >
            Instruction for agent
          </label>
          <Textarea
            id={`annotation-note-${annotation.id}`}
            aria-label={`Annotation for ${target.objectLabel}`}
            value={annotation.note}
            placeholder={
              target.selection
                ? "Add context for the selected passage…"
                : "What should the agent inspect or change?"
            }
            rows={5}
            readOnly={!onChange}
            disabled={disabled}
            onChange={(event) => onChange?.(annotation.id, event.target.value)}
            className="mt-2 min-h-32 resize-y rounded-xl border-warm-border bg-warm-surface px-3 py-2.5 text-sm leading-5 shadow-none"
          />
          <p className="mt-2 text-[11px] leading-4 text-content-muted">
            Sent with this exact workspace target and selection.
          </p>
        </div>

        {annotations.length > 1 ? (
          <div className="mt-5 border-t border-warm-border pt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted">
              All annotations
            </div>
            <div className="space-y-1">
              {annotations.map((candidate, index) => {
                const selected = candidate.id === annotation.id;
                const row = (
                  <button
                    type="button"
                    aria-label={`Open annotation ${index + 1}: ${candidate.target.objectLabel}`}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(candidate.id)}
                    className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                      selected
                        ? "bg-warm-muted text-content-primary"
                        : "text-content-secondary hover:bg-warm-muted/60 hover:text-content-primary"
                    }`}
                  >
                    <AnnotationNumberBadge number={index + 1} />
                    <SurfaceIcon
                      surface={candidate.target.surface}
                      className="h-3.5 w-3.5 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {candidate.target.objectLabel}
                    </span>
                  </button>
                );
                return (
                  <AgentAnnotationActionsContextMenu
                    key={candidate.id}
                    annotation={candidate}
                    onOpen={() => onSelect(candidate.id)}
                    onLocate={
                      onLocate ? () => onLocate(candidate.id) : undefined
                    }
                    onRemove={
                      onRemove ? () => onRemove(candidate.id) : undefined
                    }
                  >
                    {row}
                  </AgentAnnotationActionsContextMenu>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {onRemove ? (
        <footer className="shrink-0 border-t border-warm-border p-3">
          <button
            type="button"
            onClick={() => onRemove(annotation.id)}
            disabled={disabled}
            className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/35"
          >
            <Trash className="h-4 w-4" weight="bold" />
            Remove annotation
          </button>
        </footer>
      ) : null}
    </section>
  );
}
