import { useCallback, useState } from "react";
import {
  CaretDown,
  CaretUp,
  Crosshair,
  Cube,
  FilmSlate,
  HashStraight,
  Images,
  NotePencil,
  Quotes,
  X,
} from "@phosphor-icons/react";
import type {
  AgentAnnotationDraft,
  AgentAnnotationTarget,
} from "@clash/shared-types";
import { useAsset } from "@clash/web-ui/lib/hooks/useAsset";
import { useSignedUrl } from "@clash/web-ui/lib/hooks/useSignedUrl";
import { IconButton } from "../ui/icon-button";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import { Textarea } from "../ui/textarea";

const SURFACE_LABELS = {
  canvas: "Canvas",
  timeline: "Timeline",
  "director-stage": "Director Stage",
  asset: "Asset",
} as const;

function formatObjectType(objectType: string): string {
  const parts = objectType.split(/[-_\s]+/).filter(Boolean);
  if (parts[0] === "director" && parts[1] === "stage" && parts.length > 2) {
    parts.splice(0, 2);
  } else if (
    parts.length > 1 &&
    ["canvas", "timeline", "asset"].includes(parts[0])
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
  if (surface === "timeline")
    return <FilmSlate className={className} weight="duotone" />;
  if (surface === "director-stage")
    return <Cube className={className} weight="duotone" />;
  if (surface === "asset")
    return <Images className={className} weight="duotone" />;
  return <HashStraight className={className} weight="duotone" />;
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

/** Media preview for annotations that target an asset-backed object. */
function AnnotationAssetThumbnail({
  target,
  size = "sm",
}: {
  target: AgentAnnotationTarget;
  size?: "sm" | "md" | "lg";
}) {
  const asset = useAsset(target.previewAssetId);
  const isVideo =
    target.objectType.includes("video") || asset?.kind === "video";
  const r2Key = isVideo
    ? (asset?.coverR2Key ?? asset?.srcR2Key)
    : asset?.srcR2Key;
  const signedUrl = useSignedUrl(r2Key ?? undefined);
  const sizeClass =
    size === "lg"
      ? "h-auto max-h-36 w-auto max-w-full rounded-md"
      : size === "md"
        ? "h-7 w-7 rounded-md"
        : "h-5 w-5 rounded";

  if (size === "lg") {
    if (!signedUrl) return null;
    return isVideo && asset?.srcR2Key && !asset?.coverR2Key ? (
      <video
        data-testid="annotation-asset-preview"
        src={`${signedUrl}#t=0.1`}
        className={`${sizeClass} bg-warm-muted object-contain`}
        preload="metadata"
        muted
        playsInline
        aria-label={target.objectLabel}
      />
    ) : (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        data-testid="annotation-asset-preview"
        src={signedUrl}
        alt={target.objectLabel}
        className={`${sizeClass} bg-warm-muted object-contain`}
      />
    );
  }

  // No resolved media yet (still signing, or nothing renderable): show
  // nothing rather than an empty gray tile.
  if (!signedUrl) return null;

  return (
    <span
      data-testid="annotation-asset-thumbnail"
      className={`${sizeClass} shrink-0 overflow-hidden bg-warm-muted ring-1 ring-warm-border flex items-center justify-center`}
    >
      {isVideo && asset?.srcR2Key && !asset?.coverR2Key && signedUrl ? (
        <video
          src={`${signedUrl}#t=0.1`}
          className="h-full w-full object-cover"
          preload="metadata"
          muted
          playsInline
          aria-label={target.objectLabel}
        />
      ) : signedUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={signedUrl}
          alt={target.objectLabel}
          className="h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}

function AnnotationRow({
  annotation,
  number,
  expanded,
  disabled,
  onToggle,
  onChange,
  onRemove,
  onLocate,
}: {
  annotation: AgentAnnotationDraft;
  number: number;
  expanded: boolean;
  disabled: boolean;
  onToggle: () => void;
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

  return (
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
          onClick={onToggle}
          disabled={disabled}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand disabled:opacity-60"
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
}

export function AgentAnnotationTray({
  annotations,
  disabled = false,
  onChange,
  onRemove,
  onLocate,
}: {
  annotations: readonly AgentAnnotationDraft[];
  disabled?: boolean;
  onChange?: (id: string, note: string) => void;
  onRemove?: (id: string) => void;
  onLocate?: (id: string) => void;
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
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-warm-border bg-warm-surface py-1 pl-2 pr-2.5 text-[12px] font-medium leading-4 text-slate-900 transition-colors hover:bg-warm-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand disabled:opacity-60 dark:border-warm-border dark:bg-warm-surface dark:text-neutral-100 dark:hover:bg-warm-muted/60"
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
