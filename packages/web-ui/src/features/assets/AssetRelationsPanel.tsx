import {
  ArrowUpRight,
  FilmSlate,
  FlowArrow,
  Quotes,
  SquaresFour,
  Stack,
} from '@phosphor-icons/react';
import { AssetThumbnail } from './AssetThumbnail';
import type { AssetRelationSummary } from './relations';

interface AssetRelationsPanelProps {
  relations: AssetRelationSummary;
  onOpenCanvas?: (canvasId: string, nodeId?: string) => void;
  onOpenTimeline?: (timelineId: string) => void;
  onOpenAsset?: (assetId: string) => void;
}

const sectionTitleClass = 'font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400';
const relationButtonClass = 'group flex w-full items-center gap-2.5 py-2 text-left text-xs text-slate-700 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/35';

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-warm-border/70 px-4 py-3.5 first:border-t-0">
      <h2 className={sectionTitleClass}>{title}</h2>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

export function AssetRelationsPanel({
  relations,
  onOpenCanvas,
  onOpenTimeline,
  onOpenAsset,
}: AssetRelationsPanelProps) {
  const otherCanvases = relations.canvases.filter((canvas) => canvas.role !== 'origin');
  const hasUsage = otherCanvases.length > 0 || relations.timelines.length > 0;
  const hasRecordedRelations = Boolean(
    relations.origin || hasUsage || relations.upstreamAssets.length || relations.prompts.length || relations.sourceModel,
  );

  return (
    <aside
      aria-label="Asset relations"
      className="flex h-full w-[18.5rem] shrink-0 flex-col overflow-y-auto border-l border-warm-border bg-warm-surface text-slate-800"
    >
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <FlowArrow className="h-4 w-4 text-brand" weight="bold" aria-hidden="true" />
          <h1 className="font-display text-sm font-semibold tracking-[-0.01em] text-slate-950">Provenance</h1>
        </div>
        {relations.sourceModel ? (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-stone-500">
            <span className="uppercase tracking-[0.1em]">Model</span>
            <span className="min-w-0 truncate font-medium text-slate-700">{relations.sourceModel}</span>
          </div>
        ) : null}
      </div>

      {relations.origin ? (
        <Section title="Created in">
          <button
            type="button"
            className={relationButtonClass}
            aria-label={`Open origin Canvas ${relations.origin.canvasName}`}
            onClick={() => onOpenCanvas?.(relations.origin!.canvasId, relations.origin!.nodeId)}
          >
            <SquaresFour className="h-4 w-4 shrink-0 text-brand" weight="fill" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">{relations.origin.canvasName}</span>
            <span className="text-[10px] uppercase tracking-[0.08em] text-stone-400">Canvas</span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-stone-300 transition-colors group-hover:text-brand" aria-hidden="true" />
          </button>
        </Section>
      ) : null}

      {hasUsage ? (
        <Section title="Used in">
          {otherCanvases.map((canvas) => (
            <button
              key={canvas.canvasId}
              type="button"
              className={relationButtonClass}
              aria-label={`Open Canvas ${canvas.canvasName}`}
              onClick={() => onOpenCanvas?.(canvas.canvasId, canvas.nodeId)}
            >
              <SquaresFour className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{canvas.canvasName}</span>
              <span className="text-[10px] text-stone-400">
                {canvas.nodeCount} {canvas.role === 'reference' ? 'ref' : 'node'}{canvas.nodeCount === 1 ? '' : 's'}
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-stone-300 group-hover:text-brand" aria-hidden="true" />
            </button>
          ))}
          {relations.timelines.map((timeline) => (
            <button
              key={timeline.timelineId}
              type="button"
              className={relationButtonClass}
              aria-label={`Open Timeline ${timeline.timelineName}`}
              onClick={() => onOpenTimeline?.(timeline.timelineId)}
            >
              <FilmSlate className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{timeline.timelineName}</span>
              <span className="text-[10px] text-stone-400">{timeline.itemCount} clip{timeline.itemCount === 1 ? '' : 's'}</span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-stone-300 group-hover:text-brand" aria-hidden="true" />
            </button>
          ))}
        </Section>
      ) : null}

      {relations.upstreamAssets.length > 0 ? (
        <Section title="Source assets">
          {relations.upstreamAssets.map((source) => {
            const content = (
              <>
                {source.asset ? (
                  <AssetThumbnail
                    type={source.asset.type}
                    src={source.asset.url}
                    label={source.label}
                    decorative
                  />
                ) : (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border border-warm-border bg-warm-muted">
                    <Stack className="h-3 w-3 text-stone-400" aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{source.label}</span>
                <span className="text-[10px] capitalize text-stone-400">{source.role.replace('-', ' ')}</span>
                {source.availableInProject ? (
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-stone-300 group-hover:text-brand" aria-hidden="true" />
                ) : null}
              </>
            );
            return source.availableInProject ? (
              <button
                key={`${source.role}:${source.assetId}`}
                type="button"
                className={relationButtonClass}
                aria-label={`Open source asset ${source.label}`}
                onClick={() => onOpenAsset?.(source.assetId)}
              >
                {content}
              </button>
            ) : (
              <div key={`${source.role}:${source.assetId}`} className={`${relationButtonClass} cursor-default`} title={source.assetId}>
                {content}
              </div>
            );
          })}
        </Section>
      ) : null}

      {relations.prompts.length > 0 ? (
        <Section title="Prompts">
          <div className="space-y-3 pt-1">
            {relations.prompts.map((prompt) => (
              <div key={`${prompt.label}:${prompt.value}`}>
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-stone-400">
                  <Quotes className="h-3 w-3" aria-hidden="true" />
                  {prompt.label}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-[1.55] text-slate-700">{prompt.value}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {!hasRecordedRelations ? (
        <div className="px-4 py-8 text-xs leading-relaxed text-stone-400">
          No provenance has been recorded for this asset yet.
        </div>
      ) : null}
    </aside>
  );
}

