import { useRef, useState, type ChangeEvent } from "react";
import type { AssetKind, ResolvedAsset } from "@clash/shared-types";
import {
  FilmSlate,
  Image as ImageIcon,
  MusicNote,
  Plus,
  ArrowCounterClockwise,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import {
  importPersonalGlobalAssetFile,
  restorePersonalGlobalAsset,
  trashPersonalGlobalAsset,
} from "../lib/hooks/useAsset";
import { AssetThumbnail } from "../features/assets/AssetThumbnail";
import { projectAssetDisplayName } from "../features/assets/projectAssetPresentation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type TrashedResolvedAsset = ResolvedAsset & {
  lifecycle: Extract<ResolvedAsset["lifecycle"], { state: "trashed" }>;
};

function kindForFile(file: File): AssetKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

export default function GlobalAssetsClient({
  initialAssets,
}: {
  initialAssets: ResolvedAsset[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState(initialAssets);
  const [uploading, setUploading] = useState(false);
  const [mutatingAssetId, setMutatingAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeAssets = assets.filter(
    (asset) => asset.lifecycle.state === "active",
  );
  const trashedAssets = assets.filter(
    (asset): asset is TrashedResolvedAsset =>
      asset.lifecycle.state === "trashed",
  );

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const kind = kindForFile(file);
        if (!kind)
          throw new Error(`Unsupported asset type: ${file.type || file.name}`);
        const asset = await importPersonalGlobalAssetFile(file, kind);
        setAssets((current) => [
          asset,
          ...current.filter((candidate) => candidate.id !== asset.id),
        ]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
      input.value = "";
    }
  };

  const updateAsset = (next: ResolvedAsset) => {
    setAssets((current) =>
      current.map((asset) => (asset.id === next.id ? next : asset)),
    );
  };

  const trashAsset = async (asset: ResolvedAsset) => {
    setMutatingAssetId(asset.id);
    setError(null);
    try {
      updateAsset(await trashPersonalGlobalAsset({ globalAssetId: asset.id }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMutatingAssetId(null);
    }
  };

  const restoreAsset = async (asset: ResolvedAsset) => {
    setMutatingAssetId(asset.id);
    setError(null);
    try {
      if (asset.lifecycle.state !== "trashed") return;
      updateAsset(
        await restorePersonalGlobalAsset(
          asset.id,
          asset.lifecycle.deleteOperationId,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMutatingAssetId(null);
    }
  };

  return (
    <main className="clash-dashboard-shell min-h-screen">
      <div className="mx-auto max-w-[1600px] px-6 pb-24 pt-20">
        <header className="mb-10 flex items-end justify-between gap-6">
          <div>
            <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">
              Reusable media
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50">
              Assets
            </h1>
            <p className="mt-2 max-w-xl text-base text-stone-600 dark:text-stone-300">
              One library for source files you want to reuse across canvases.
            </p>
          </div>
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            leftIcon={
              uploading ? (
                <UploadSimple className="h-4 w-4 animate-pulse" />
              ) : (
                <Plus className="h-4 w-4" weight="bold" />
              )
            }
          >
            {uploading ? "Uploading…" : "Add assets"}
          </Button>
          <Input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            aria-label="Upload global assets"
            className="hidden"
            onChange={uploadFiles}
          />
        </header>

        {error ? (
          <p role="alert" className="mb-6 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
        {activeAssets.length === 0 && trashedAssets.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="group flex min-h-72 w-full flex-col items-center justify-center border-y border-dashed border-warm-border bg-warm-surface/40 text-center transition-colors hover:bg-warm-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <UploadSimple
              className="mb-5 h-8 w-8 text-stone-350 transition-transform duration-200 group-hover:-translate-y-1"
              weight="light"
            />
            <strong className="font-display text-lg text-content-primary">
              Build your reusable library
            </strong>
            <span className="mt-2 text-sm text-content-secondary">
              Choose images, video, or audio from this Mac.
            </span>
          </button>
        ) : (
          <section aria-labelledby="global-asset-library-heading">
            <h2
              id="global-asset-library-heading"
              className="mb-4 font-display text-lg font-semibold text-content-primary"
            >
              Library
            </h2>
            {activeAssets.length === 0 ? (
              <p className="border-y border-dashed border-warm-border py-10 text-sm text-content-secondary">
                No active reusable assets.
              </p>
            ) : (
              <ul
                aria-label="Global asset library"
                className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 xl:grid-cols-5"
              >
                {activeAssets.map((asset) => {
                  const label = projectAssetDisplayName(asset);
                  const Icon =
                    asset.kind === "video"
                      ? FilmSlate
                      : asset.kind === "audio"
                        ? MusicNote
                        : ImageIcon;
                  return (
                    <li key={asset.id} className="group min-w-0">
                      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-warm-muted ring-1 ring-warm-border/80">
                        <AssetThumbnail
                          kind={asset.kind}
                          src={asset.url ?? ""}
                          thumbnailSrc={asset.thumbnailUrl}
                          status={asset.status}
                          label={label}
                          variant="card"
                          decorative
                        />
                        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-stone-950/75 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-stone-50">
                          <Icon className="h-3 w-3" />
                          {asset.kind}
                        </span>
                      </div>
                      <p
                        className="mt-2 truncate text-sm font-semibold text-content-primary"
                        title={label}
                      >
                        {label}
                      </p>
                      {asset.status === "unavailable" ? (
                        <p className="mt-1 text-xs text-content-muted">
                          Unavailable on this device
                        </p>
                      ) : null}
                      <Button
                        size="sm"
                        shape="rounded"
                        disabled={mutatingAssetId === asset.id}
                        onClick={() => void trashAsset(asset)}
                        leftIcon={<Trash className="h-3.5 w-3.5" />}
                        aria-label={`Move ${label} to Trash`}
                        className="mt-2"
                      >
                        Move to Trash
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {trashedAssets.length > 0 ? (
          <section
            aria-labelledby="global-asset-trash-heading"
            className="mt-14"
          >
            <h2
              id="global-asset-trash-heading"
              className="mb-4 font-display text-lg font-semibold text-content-primary"
            >
              Trash
            </h2>
            <ul
              aria-label="Global asset trash"
              className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 xl:grid-cols-5"
            >
              {trashedAssets.map((asset) => {
                const label = projectAssetDisplayName(asset);
                return (
                  <li
                    key={asset.id}
                    className="rounded-xl border border-warm-border bg-warm-surface p-4"
                  >
                    <p
                      className="truncate text-sm font-semibold text-content-primary"
                      title={label}
                    >
                      {label}
                    </p>
                    <p className="mt-1 text-xs text-content-muted">
                      Recoverable until {asset.lifecycle.purgeAfter}
                    </p>
                    <Button
                      size="sm"
                      shape="rounded"
                      disabled={mutatingAssetId === asset.id}
                      onClick={() => void restoreAsset(asset)}
                      leftIcon={
                        <ArrowCounterClockwise className="h-3.5 w-3.5" />
                      }
                      aria-label={`Restore ${label}`}
                      className="mt-3"
                    >
                      Restore
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
