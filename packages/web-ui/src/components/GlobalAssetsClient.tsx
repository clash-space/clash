import { useMemo, useRef, useState, type ChangeEvent } from "react";
import type { Asset, AssetKind } from "@clash/shared-types/assets";
import { FilmSlate, Image as ImageIcon, MusicNote, Plus, UploadSimple } from "@phosphor-icons/react";
import { runtimeApiUrl } from "../lib/runtimeConfig";
import { firstAssetMediaUrl } from "../features/assets/media-url";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

function assetLabel(asset: Asset): string {
  return asset.metadata?.originalName
    ?? asset.srcR2Key.split(/[\\/]/).filter(Boolean).at(-1)
    ?? asset.id;
}

function assetPreviewUrl(asset: Asset): string {
  return firstAssetMediaUrl(asset.signedCoverUrl, asset.signedUrl, `/assets/${asset.srcR2Key}`) ?? "";
}

function kindForFile(file: File): AssetKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

export default function GlobalAssetsClient({ initialAssets }: { initialAssets: Asset[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState(initialAssets);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sortedAssets = useMemo(
    () => [...assets].sort((a, b) => b.createdAt - a.createdAt),
    [assets],
  );

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const kind = kindForFile(file);
        if (!kind) throw new Error(`Unsupported asset type: ${file.type || file.name}`);
        const formData = new FormData();
        formData.append("file", file);
        const uploadResponse = await fetch(runtimeApiUrl("/upload"), { method: "POST", body: formData });
        if (!uploadResponse.ok) throw new Error((await uploadResponse.text()) || "Upload failed");
        const { storageKey } = await uploadResponse.json() as { storageKey: string };
        const registerResponse = await fetch(runtimeApiUrl("/api/v1/assets"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ addToLibrary: true, kind, srcR2Key: storageKey, originalName: file.name }),
        });
        if (!registerResponse.ok) throw new Error((await registerResponse.text()) || "Asset registration failed");
        const { id } = await registerResponse.json() as { id: string };
        const assetResponse = await fetch(runtimeApiUrl(`/api/v1/assets/${encodeURIComponent(id)}`));
        if (!assetResponse.ok) throw new Error((await assetResponse.text()) || "Asset loading failed");
        const asset = await assetResponse.json() as Asset;
        asset.metadata = { ...(asset.metadata ?? {}), originalName: file.name };
        setAssets((current) => [asset, ...current.filter((candidate) => candidate.id !== asset.id)]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
      input.value = "";
    }
  };

  return (
    <main className="clash-dashboard-shell min-h-screen">
      <div className="mx-auto max-w-[1600px] px-6 pb-24 pt-20">
        <header className="mb-10 flex items-end justify-between gap-6">
          <div>
            <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400">Reusable media</p>
            <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-50">Assets</h1>
            <p className="mt-2 max-w-xl text-base text-stone-600 dark:text-stone-300">One library for source files you want to reuse across canvases.</p>
          </div>
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            leftIcon={uploading ? <UploadSimple className="h-4 w-4 animate-pulse" /> : <Plus className="h-4 w-4" weight="bold" />}
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

        {error ? <p role="alert" className="mb-6 text-sm font-medium text-red-700">{error}</p> : null}
        {sortedAssets.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="group flex min-h-72 w-full flex-col items-center justify-center border-y border-dashed border-warm-border bg-warm-surface/40 text-center transition-colors hover:bg-warm-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <UploadSimple className="mb-5 h-8 w-8 text-stone-350 transition-transform duration-200 group-hover:-translate-y-1" weight="light" />
            <strong className="font-display text-lg text-content-primary">Build your reusable library</strong>
            <span className="mt-2 text-sm text-content-secondary">Choose images, video, or audio from this Mac.</span>
          </button>
        ) : (
          <ul aria-label="Global asset library" className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 xl:grid-cols-5">
            {sortedAssets.map((asset) => {
              const label = assetLabel(asset);
              const Icon = asset.kind === "video" ? FilmSlate : asset.kind === "audio" ? MusicNote : ImageIcon;
              return (
                <li key={asset.id} className="group min-w-0">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-warm-muted ring-1 ring-warm-border/80">
                    {asset.kind === "image" ? (
                      <img src={assetPreviewUrl(asset)} alt="" className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.025]" />
                    ) : asset.kind === "video" && asset.signedCoverUrl ? (
                      <img src={assetPreviewUrl(asset)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-stone-100 text-stone-400"><Icon className="h-9 w-9" weight="light" /></div>
                    )}
                    <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-stone-950/75 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-stone-50">
                      <Icon className="h-3 w-3" />{asset.kind}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm font-semibold text-slate-900" title={label}>{label}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
