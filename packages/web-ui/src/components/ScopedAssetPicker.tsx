import { MagnifyingGlass, UploadSimple, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetSourceScope } from "@clash/shared-types";
import { AssetThumbnail } from "../features/assets/AssetThumbnail";
import { assetAvailabilityLabel } from "../features/assets/availability";
import { Dialog } from "./ui/dialog";
import type {
  ScopedAssetOption,
  ScopedAssetSection,
} from "./scopedAssetPickerModel";

type ScopeFilter = "all" | AssetSourceScope;

export function ScopedAssetPicker({
  open,
  sections,
  onClose,
  onSelect,
  onUpload,
  busy = false,
}: {
  open: boolean;
  sections: ScopedAssetSection[];
  onClose: () => void;
  onSelect: (asset: ScopedAssetOption) => void | Promise<void>;
  onUpload: (file: File) => void | Promise<void>;
  busy?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeScope, setActiveScope] = useState<ScopeFilter>("all");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveScope("all");
  }, [open]);

  const externalSection = sections.find(
    (section) => section.scope === "external",
  );
  const assets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return sections.flatMap((section) => {
      if (activeScope !== "all" && activeScope !== section.scope) return [];
      return section.assets.flatMap((asset) => {
        if (
          normalizedQuery &&
          !`${asset.name} ${asset.type} ${section.label}`
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        )
          return [];
        return [{ asset, scopeLabel: section.label }];
      });
    });
  }, [activeScope, query, sections]);
  const showUpload = Boolean(
    externalSection?.allowLocalUpload &&
    (activeScope === "all" || activeScope === "external") &&
    (!query ||
      "upload from mac local file".includes(query.trim().toLocaleLowerCase())),
  );
  const selectableCount = assets.filter(
    ({ asset }) => !asset.disabledReason,
  ).length;
  const notReadyCount = assets.filter(
    ({ asset }) => asset.status !== "ready",
  ).length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel="Add media"
      size="auto"
      unstyled
      overlayClassName="bg-stone-950/30 backdrop-blur-[2px]"
      containerClassName="p-5 sm:p-8"
      contentClassName="h-[min(760px,88vh)] w-[min(1040px,94vw)] overflow-hidden rounded-[28px] border border-overlay-border bg-overlay-surface text-content-primary shadow-overlay"
    >
      <div data-layout="command-grid" className="flex h-full min-h-0 flex-col">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (file) void onUpload(file);
          }}
        />

        <header className="shrink-0 px-6 pt-5 sm:px-8 sm:pt-7">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-display text-xl font-semibold tracking-[-0.025em] text-content-primary">
                Add media
              </h2>
              <p className="mt-0.5 text-sm text-content-secondary">
                Choose once. Clash extends the reference chain for this
                workspace.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-content-secondary transition-colors duration-150 hover:bg-warm-muted hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-overlay-surface"
            >
              <X className="h-[18px] w-[18px]" weight="bold" />
            </button>
          </div>

          <label className="relative block">
            <span className="sr-only">Search media</span>
            <MagnifyingGlass
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-content-muted"
              weight="bold"
            />
            <input
              autoFocus
              type="search"
              aria-label="Search media"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search media"
              className="h-14 w-full rounded-2xl border border-warm-border bg-warm-surface pl-12 pr-16 text-[17px] text-content-primary shadow-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-content-muted focus:border-brand/55 focus:ring-2 focus:ring-brand/15"
            />
            <kbd className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-warm-border bg-warm-muted px-1.5 py-0.5 font-sans text-[11px] font-medium text-content-muted shadow-sm">
              ⌘K
            </kbd>
          </label>

          <div
            role="tablist"
            aria-label="Media scope"
            className="mt-4 flex gap-2 overflow-x-auto border-b border-warm-border pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {[
              { scope: "all" as const, label: "All" },
              ...sections.map((section) => ({
                scope: section.scope,
                label: section.label,
              })),
            ].map((item) => {
              const selected = activeScope === item.scope;
              return (
                <button
                  key={item.scope}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveScope(item.scope)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-[background-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 active:scale-[0.97] ${
                    selected
                      ? "bg-brand text-brand-foreground shadow-sm"
                      : "bg-warm-muted text-content-secondary hover:bg-warm-hover hover:text-content-primary"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">
          {assets.length > 0 || showUpload ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(142px,1fr))] gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
              {assets.map(({ asset, scopeLabel }) => (
                <button
                  key={`${asset.source.kind}:${asset.sourceNodeId ?? asset.assetId}`}
                  type="button"
                  aria-label={`Add ${asset.name}`}
                  disabled={busy || Boolean(asset.disabledReason)}
                  onClick={() => void onSelect(asset)}
                  title={asset.disabledReason}
                  className="group min-w-0 text-center focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <span className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[22px] bg-warm-muted ring-1 ring-warm-border transition-[transform,box-shadow] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:ring-brand/35 group-hover:shadow-md group-active:translate-y-0 group-active:scale-[0.985] group-focus-visible:ring-2 group-focus-visible:ring-brand group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-overlay-surface motion-reduce:transform-none motion-reduce:transition-none">
                    <AssetThumbnail
                      kind={asset.type}
                      src={asset.src}
                      thumbnailSrc={asset.thumbnail}
                      status={asset.status}
                      label={asset.name}
                      variant="card"
                      decorative
                    />
                    <span className="absolute bottom-2 left-2 rounded-md bg-stone-950/68 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                      {scopeLabel}
                    </span>
                  </span>
                  <span className="mt-2.5 block truncate px-1 text-sm font-semibold text-content-primary">
                    {asset.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-content-secondary">
                    {asset.status === "ready"
                      ? asset.type
                      : assetAvailabilityLabel(asset)}
                  </span>
                </button>
              ))}

              {showUpload ? (
                <button
                  type="button"
                  aria-label="Upload from Mac"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  className="group min-w-0 text-center focus-visible:outline-none disabled:cursor-wait disabled:opacity-55"
                >
                  <span className="flex aspect-square items-center justify-center rounded-[22px] border border-dashed border-warm-border bg-warm-surface text-content-secondary transition-[transform,border-color,background-color,color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:border-brand/60 group-hover:bg-brand-light/35 group-hover:text-brand group-active:translate-y-0 group-active:scale-[0.985] group-focus-visible:ring-2 group-focus-visible:ring-brand group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-overlay-surface motion-reduce:transform-none motion-reduce:transition-none">
                    <UploadSimple className="h-8 w-8" weight="regular" />
                  </span>
                  <span className="mt-2.5 block text-sm font-semibold text-content-primary">
                    Upload from Mac
                  </span>
                  <span className="mt-0.5 block text-xs text-content-secondary">
                    Local file
                  </span>
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full min-h-52 items-center justify-center text-center">
              <div>
                <MagnifyingGlass
                  className="mx-auto h-8 w-8 text-content-disabled"
                  weight="regular"
                />
                <p className="mt-3 text-sm font-semibold text-content-primary">
                  {query
                    ? "No media matches this search"
                    : "Everything here is already connected"}
                </p>
                <p className="mt-1 text-sm text-content-secondary">
                  {query
                    ? "Try another name or scope."
                    : "Choose another scope or upload a new file."}
                </p>
              </div>
            </div>
          )}
        </div>

        <footer className="flex h-11 shrink-0 items-center justify-between border-t border-overlay-border bg-warm-muted px-6 text-xs text-content-secondary sm:px-8">
          <span>
            {selectableCount} selectable
            {notReadyCount > 0 ? ` · ${notReadyCount} not ready` : ""}
          </span>
          <span>Esc to close</span>
        </footer>
      </div>
    </Dialog>
  );
}
