import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ChatCenteredText,
  Crosshair,
  NotePencil,
  Trash,
  X,
} from "@phosphor-icons/react";
import type {
  AgentAnnotationDraft,
  AgentAnnotationTarget,
} from "@clash/shared-types";
import { useAsset } from "@clash/web-ui/lib/hooks/useAsset";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
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
  size?: "sm" | "md" | "lg" | "dialog";
}) {
  const asset = useAsset(target.projectId, target.previewAssetId);
  const isVideo =
    target.objectType.includes("video") || asset?.kind === "video";
  const mediaUrl = isVideo ? asset?.thumbnailUrl : asset?.url;
  const hasVideoPreview = Boolean(
    asset?.thumbnailUrl || (asset?.status === "ready" && asset.url),
  );
  const sizeClass =
    size === "dialog"
      ? "h-auto max-h-64 w-auto max-w-full rounded-lg"
      : size === "lg"
        ? "h-auto max-h-36 w-auto max-w-full rounded-md"
        : size === "md"
          ? "h-7 w-7 rounded-md"
          : "h-5 w-5 rounded";

  if (size === "lg" || size === "dialog") {
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

function AnnotationSummaryRow({
  annotation,
  number,
  disabled,
  onRemove,
}: {
  annotation: AgentAnnotationDraft;
  number: number;
  disabled: boolean;
  onRemove?: () => void;
}) {
  const { target } = annotation;
  return (
    <li
      data-testid="agent-annotation-item"
      data-agent-annotation-surface={target.surface}
      className="flex min-w-0 items-start gap-2 border-b border-warm-border/60 py-2.5 first:pt-0 last:border-b-0 last:pb-0"
    >
      <span
        data-testid="agent-annotation-number"
        className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-content-muted"
      >
        {number}.
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-content-muted">
          <SurfaceIcon surface={target.surface} className="h-3.5 w-3.5" />
          <span className="truncate">{target.surfaceLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{formatObjectType(target.objectType)}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[13px] font-medium leading-5 text-content-primary">
          {target.objectLabel}
        </p>
        {target.previewAssetId ? (
          <div className="mt-2">
            <AnnotationAssetThumbnail target={target} size="lg" />
          </div>
        ) : null}
        {target.selection ? (
          <p className="mt-1 line-clamp-3 text-xs leading-5 text-content-secondary">
            {target.selection.exact}
          </p>
        ) : null}
        {annotation.note.trim() ? (
          <div className="mt-2">
            <div className="text-[11px] text-content-muted">Comment</div>
            <p className="mt-0.5 line-clamp-3 text-xs leading-5 text-content-secondary">
              {annotation.note.trim()}
            </p>
          </div>
        ) : null}
      </div>
      {onRemove ? (
        <IconButton
          label={`Remove annotation ${number}`}
          icon={<X className="h-3.5 w-3.5" weight="bold" />}
          variant="default"
          size="sm"
          shape="rounded"
          onClick={onRemove}
          disabled={disabled}
          className="h-6 min-h-6 w-6 min-w-6 shrink-0 text-content-muted hover:text-destructive"
        />
      ) : null}
    </li>
  );
}

export function AgentAnnotationTray({
  annotations,
  disabled = false,
  onRemove,
}: {
  annotations: readonly AgentAnnotationDraft[];
  disabled?: boolean;
  onRemove?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (annotations.length === 0) return null;
  const count = annotations.length;
  const label = `${count} ${count === 1 ? "annotation" : "annotations"}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="agent-annotation-tray"
          data-open={open ? "true" : "false"}
          aria-expanded={open}
          aria-label={label}
          disabled={disabled}
          className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg bg-warm-surface/55 px-2.5 text-xs font-medium text-content-secondary ring-1 ring-warm-border/70 transition-colors hover:bg-warm-muted hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
        >
          <ChatCenteredText
            className="h-3.5 w-3.5 shrink-0"
            weight="duotone"
            aria-hidden="true"
          />
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        aria-label="Agent annotations"
        className="w-[min(420px,calc(100vw-24px))] rounded-xl p-3"
      >
        <ul
          aria-label="Agent annotations"
          className="max-h-72 overflow-y-auto text-content-primary"
        >
          {annotations.map((annotation, index) => (
            <AnnotationSummaryRow
              key={annotation.id}
              annotation={annotation}
              number={index + 1}
              disabled={disabled}
              onRemove={onRemove ? () => onRemove(annotation.id) : undefined}
            />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function AgentAnnotationEditor({
  annotations,
  activeId,
  disabled = false,
  onClose,
  onChange,
  onRemove,
  onLocate,
}: {
  annotations: readonly AgentAnnotationDraft[];
  activeId: string | null;
  disabled?: boolean;
  onClose: () => void;
  onChange?: (id: string, note: string) => void;
  onRemove?: (id: string) => void;
  onLocate?: (id: string) => void;
}) {
  const activeIndex = annotations.findIndex(
    (annotation) => annotation.id === activeId,
  );
  const annotation = activeIndex >= 0 ? annotations[activeIndex] : null;
  const target = annotation?.target;
  const [draftNote, setDraftNote] = useState(annotation?.note ?? "");
  const [anchorReady, setAnchorReady] = useState(false);
  const anchorElementRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const virtualAnchorRef = useRef({
    getBoundingClientRect: () =>
      anchorElementRef.current?.getBoundingClientRect() ??
      document.documentElement.getBoundingClientRect(),
  });

  useEffect(() => {
    setDraftNote(annotation?.note ?? "");
  }, [annotation?.id, annotation?.note]);

  useLayoutEffect(() => {
    let observer: MutationObserver | null = null;
    const resolveAnchor = () => {
      const anchor = activeId
        ? (Array.from(
            document.querySelectorAll<HTMLElement>(
              "[data-agent-annotation-anchor]",
            ),
          ).find(
            (candidate) =>
              candidate.dataset.agentAnnotationAnchor === activeId,
          ) ?? null)
        : null;
      anchorElementRef.current = anchor;
      setAnchorReady(Boolean(anchor));
      if (anchor) observer?.disconnect();
      return Boolean(anchor);
    };

    if (resolveAnchor() || !activeId) return;

    // Canvas pins are measured in requestAnimationFrame and may mount after
    // the annotation becomes active. Keep the Radix virtual anchor in sync
    // across that delayed mount and surface navigation.
    observer = new MutationObserver(resolveAnchor);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-agent-annotation-anchor"],
    });
    resolveAnchor();
    return () => observer.disconnect();
  }, [activeId, annotation?.id]);

  const expanded = Boolean(annotation?.note.trim() || draftNote.trim());

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const minHeight = expanded ? 64 : 28;
    const maxHeight = 220;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(
      maxHeight,
      Math.max(minHeight, textarea.scrollHeight),
    )}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draftNote, expanded]);

  const save = (event?: FormEvent) => {
    event?.preventDefault();
    if (!annotation || disabled || !onChange) return;
    onChange(annotation.id, draftNote.trim());
    onClose();
  };

  return (
    <Popover
      open={Boolean(annotation && target && anchorReady)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={virtualAnchorRef} />
      {annotation && target && anchorReady ? (
        <PopoverContent
          side="right"
          align="center"
          sideOffset={12}
          collisionPadding={12}
          aria-label={`Annotation for ${target.objectLabel}`}
          data-testid="agent-annotation-editor"
          data-expanded={expanded ? "true" : "false"}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            anchorElementRef.current?.focus();
          }}
          className={`pointer-events-auto w-[min(320px,calc(100vw-24px))] rounded-2xl bg-warm-surface text-content-primary shadow-[var(--clash-shadow-floating)] ring-1 ring-warm-border/70 ${
            expanded ? "min-h-[136px] p-3" : "min-h-16 px-4 py-2"
          }`}
        >
          <form onSubmit={save}>
            <div
              className={`flex min-w-0 flex-1 ${
                expanded ? "items-start px-1" : "items-center"
              }`}
            >
              <Textarea
                ref={textareaRef}
                autoFocus
                rows={1}
                value={draftNote}
                aria-label={`Annotation for ${target.objectLabel}`}
                placeholder="Add an optional comment…"
                readOnly={!onChange}
                disabled={disabled}
                onChange={(event) => setDraftNote(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey) &&
                    !event.nativeEvent.isComposing &&
                    expanded
                  ) {
                    save(event);
                  }
                }}
                className={`min-h-0 min-w-0 flex-1 resize-none border-0 bg-transparent px-0 text-sm leading-6 shadow-none placeholder:text-content-muted focus-visible:border-transparent focus-visible:ring-0 ${
                  expanded ? "w-full py-1" : "py-0.5 pr-3"
                }`}
              />
            </div>
            {expanded ? (
              <div className="mt-2 flex items-center justify-between border-t border-warm-border/60 pt-2.5">
                <div className="flex items-center gap-1">
                  {onRemove ? (
                    <IconButton
                      label="Remove annotation"
                      title="Remove annotation"
                      size="sm"
                      shape="rounded"
                      disabled={disabled}
                      onClick={() => {
                        onRemove(annotation.id);
                        onClose();
                      }}
                      className="text-content-muted hover:bg-destructive/10 hover:text-destructive"
                      icon={<Trash className="h-4 w-4" weight="bold" />}
                    />
                  ) : null}
                  {onLocate ? (
                    <IconButton
                      label="Locate annotation"
                      title="Locate in workspace"
                      size="sm"
                      shape="rounded"
                      disabled={disabled}
                      onClick={() => onLocate(annotation.id)}
                      className="text-content-muted"
                      icon={<Crosshair className="h-4 w-4" weight="bold" />}
                    />
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    shape="pill"
                    onClick={onClose}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    shape="pill"
                    disabled={disabled || !onChange}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : null}
          </form>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
