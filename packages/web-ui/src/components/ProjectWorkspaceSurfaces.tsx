import { ArrowRight, FilmSlate, Plus } from '@phosphor-icons/react';
import type { ProjectTimeline } from '@clash/shared-types';
import type { ProjectAsset } from '@clash/web-ui/lib/types';
import { Button } from './ui/button';

export function ProjectAssetsSurface({
    assets,
    canvasName,
    onPlace,
}: {
    assets: ProjectAsset[];
    canvasName: string;
    onPlace: (asset: ProjectAsset) => void;
}) {
    return (
        <main className="absolute inset-0 z-10 overflow-y-auto bg-warm-page px-10 py-8">
            <header className="mb-7 flex items-end justify-between border-b border-warm-border pb-4">
                <div>
                    <h1 className="font-display text-2xl font-semibold text-slate-950">Assets</h1>
                    <p className="mt-1 text-sm text-stone-500">{assets.length} project assets</p>
                </div>
                <div className="text-sm text-stone-500">Place on {canvasName}</div>
            </header>
            {assets.length === 0 ? (
                <div className="py-16 text-sm text-stone-400">No assets</div>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
                    {assets.map((asset) => (
                        <article key={asset.id} className="group min-w-0 overflow-hidden rounded-lg border border-warm-border bg-warm-surface">
                            <div className="aspect-video overflow-hidden bg-stone-100">
                                {asset.type === 'video' ? (
                                    <video
                                        src={asset.url}
                                        className="h-full w-full object-cover"
                                        muted
                                        playsInline
                                        preload="metadata"
                                    />
                                ) : (
                                    <img
                                        src={asset.url}
                                        alt=""
                                        className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02]"
                                    />
                                )}
                            </div>
                            <div className="flex h-12 min-w-0 items-center gap-2 px-3">
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                                    {asset.id}
                                </span>
                                <Button
                                    size="sm"
                                    shape="rounded"
                                    onClick={() => onPlace(asset)}
                                    leftIcon={<Plus className="h-3.5 w-3.5" weight="bold" />}
                                    className="h-8 min-h-8 rounded-md px-2.5 text-xs"
                                >
                                    Place
                                </Button>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </main>
    );
}

export function StandaloneTimelineSurface({
    timeline,
    canvasName,
    onAttach,
}: {
    timeline: ProjectTimeline;
    canvasName: string;
    onAttach: () => void;
}) {
    const tracks = Array.isArray((timeline.state as any)?.tracks)
        ? (timeline.state as any).tracks.length
        : 0;
    return (
        <main className="absolute inset-0 z-10 overflow-y-auto bg-warm-page px-10 py-8">
            <header className="flex items-start justify-between border-b border-warm-border pb-5">
                <div className="min-w-0">
                    <div className="mb-2 flex items-center gap-2 text-sm text-stone-500">
                        <FilmSlate className="h-4 w-4" weight="fill" />
                        <span>Standalone Timeline</span>
                    </div>
                    <h1 className="truncate font-display text-3xl font-semibold text-slate-950">
                        {timeline.name}
                    </h1>
                </div>
                <Button
                    onClick={onAttach}
                    rightIcon={<ArrowRight className="h-4 w-4" weight="bold" />}
                    className="rounded-md"
                >
                    Move to {canvasName}
                </Button>
            </header>
            <dl className="grid max-w-2xl grid-cols-2 gap-x-10 gap-y-5 py-8 text-sm">
                <div>
                    <dt className="text-stone-500">Tracks</dt>
                    <dd className="mt-1 font-display text-xl font-semibold text-slate-900">{tracks}</dd>
                </div>
                <div>
                    <dt className="text-stone-500">Revision</dt>
                    <dd className="mt-1 truncate font-mono text-xs text-slate-700">{timeline.revisionId}</dd>
                </div>
            </dl>
        </main>
    );
}
