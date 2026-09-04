import {
  CaretDown,
  Check,
  FilmSlate,
  Image as ImageIcon,
  MusicNotes,
  Plus,
  Shapes,
  Sparkle,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useState } from "react";
import type {
  ResolvedAsset,
  StoryboardViewItem,
  StoryboardViewMaterial,
  StoryboardViewResource,
  StoryboardViewShot,
  StoryboardViewState,
} from "@clash/shared-types";

import type { StoryboardGeneratorChoice } from "../lib/storyboardGenerator";
import { AssetThumbnail } from "../features/assets/AssetThumbnail";
import { projectAssetDisplayName } from "../features/assets/projectAssetPresentation";
import { projectAssetPlaybackUrl } from "../features/assets/media-url";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { IconButton } from "./ui/icon-button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Tooltip } from "./ui/tooltip";

type ItemSection = "keyElements" | "shots" | "audioLayers";

export interface PluginStoryboardSurfaceProps {
  projectId: string;
  nodeId: string;
  label: string;
  state: StoryboardViewState;
  assets: readonly ResolvedAsset[];
  generators: readonly StoryboardGeneratorChoice[];
  onSave: (state: StoryboardViewState) => void;
  onGenerate: (
    material: StoryboardViewMaterial,
    choice: StoryboardGeneratorChoice,
  ) => Promise<StoryboardViewResource> | StoryboardViewResource;
  onClose: () => void;
}

function nextId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8)
    ?? Date.now().toString(36);
  return `${prefix}_${suffix}`;
}

function cloneState(state: StoryboardViewState): StoryboardViewState {
  return structuredClone(state);
}

function descriptionText(item: StoryboardViewItem | StoryboardViewShot): string {
  return item.description
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function resourceAsset(
  candidate: StoryboardViewResource,
  assets: readonly ResolvedAsset[],
): ResolvedAsset | undefined {
  return assets.find((asset) => asset.id === candidate.projectAssetId);
}

function CandidateCard({
  candidate,
  selected,
  assets,
  onSelect,
}: {
  candidate: StoryboardViewResource;
  selected: boolean;
  assets: readonly ResolvedAsset[];
  onSelect?: () => void;
}) {
  const asset = resourceAsset(candidate, assets);
  const label = asset ? projectAssetDisplayName(asset) : candidate.modelName ?? candidate.id;
  const className = `group relative w-36 overflow-hidden rounded-xl border text-left transition-colors ${
        selected
          ? "border-brand bg-brand/[0.06]"
          : "border-warm-border bg-warm-surface hover:border-stone-400"
      }`;
  const content = <>
      <div className="h-20 bg-warm-muted">
        {asset ? (
          <AssetThumbnail
            kind={asset.kind}
            src={projectAssetPlaybackUrl(asset) ?? ""}
            thumbnailSrc={asset.thumbnailUrl}
            status={asset.status}
            label={label}
            variant="card"
            decorative
          />
        ) : (
          <div className="flex h-full items-center justify-center text-content-muted">
            <ImageIcon className="h-7 w-7" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-content-secondary">
          {label}
        </span>
        {selected ? <Check className="h-3 w-3 shrink-0 text-brand" weight="bold" /> : null}
      </div>
    </>;
  return onSelect ? (
    <button type="button" aria-pressed={selected} onClick={onSelect} className={className}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function MaterialRow({
  material,
  assets,
  choices,
  generating,
  onChange,
  onGenerate,
}: {
  material: StoryboardViewMaterial;
  assets: readonly ResolvedAsset[];
  choices: readonly StoryboardGeneratorChoice[];
  generating: boolean;
  onChange: (next: StoryboardViewMaterial) => void;
  onGenerate: (choice: StoryboardGeneratorChoice) => void;
}) {
  const compatible = choices.filter((choice) => choice.mediaKind === material.mediaKind);
  return (
    <div className="rounded-xl border border-warm-border/80 bg-warm-muted/40 p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] font-medium text-content-secondary">
            {material.id}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-content-muted">
            {material.mediaKind} material slot
          </div>
        </div>
        {compatible.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                disabled={generating || !(material.promptDraft?.text.trim())}
                leftIcon={<Sparkle className="h-3.5 w-3.5" weight="fill" />}
                className="min-h-0 rounded-lg px-2.5 py-1.5 text-[11px]"
              >
                {generating ? "Generating…" : "Generate"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56 rounded-xl p-1">
              {compatible.map((choice) => (
                <DropdownMenuItem
                  key={`${choice.definition.pluginId}:${choice.definition.definitionId}:${choice.actionId}:${choice.outputSlot}`}
                  onSelect={() => onGenerate(choice)}
                >
                  <Sparkle className="h-4 w-4 text-brand" />
                  {choice.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <Textarea
        aria-label={`Prompt for ${material.id}`}
        value={material.promptDraft?.text ?? ""}
        placeholder="Describe what this material should contain…"
        rows={2}
        onChange={(event) => onChange({
          ...material,
          promptDraft: {
            id: material.promptDraft?.id ?? nextId("PromptDraft"),
            text: event.target.value,
          },
        })}
        className="mt-2 min-h-16 resize-y rounded-lg border-warm-border bg-warm-surface text-xs"
      />
      {material.candidates.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-content-muted">
            Candidates · {material.candidates.length}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {material.candidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                selected={material.selectedCandidateId === candidate.id}
                assets={assets}
                onSelect={() => onChange({
                  ...material,
                  selectedCandidateId: candidate.id,
                })}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-content-muted">
          {compatible.length > 0
            ? "Write a prompt, then run an installed Generator."
            : `No installed prompt-only Generator currently outputs ${material.mediaKind}.`}
        </div>
      )}
    </div>
  );
}

function StoryboardItemCard({
  item,
  section,
  assets,
  choices,
  generatingSlot,
  onChange,
  onDelete,
  onGenerate,
}: {
  item: StoryboardViewItem | StoryboardViewShot;
  section: ItemSection;
  assets: readonly ResolvedAsset[];
  choices: readonly StoryboardGeneratorChoice[];
  generatingSlot: string | null;
  onChange: (item: StoryboardViewItem | StoryboardViewShot) => void;
  onDelete: () => void;
  onGenerate: (material: StoryboardViewMaterial, choice: StoryboardGeneratorChoice) => void;
}) {
  const references = item.description.filter((part) => part.type === "entity-reference");
  return (
    <Collapsible defaultOpen className="border-b border-warm-border/70 last:border-b-0">
      <div className="group flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left [&[data-state=open]_.item-caret]:rotate-180">
          <CaretDown className="item-caret h-3.5 w-3.5 shrink-0 text-content-muted transition-transform" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-content-primary">
            {item.id}
          </span>
          {"durationSeconds" in item && item.durationSeconds ? (
            <span className="shrink-0 text-[11px] text-content-muted">≈{item.durationSeconds}s</span>
          ) : null}
        </CollapsibleTrigger>
        <Tooltip label={`Delete ${item.id}`}>
          <IconButton
            label={`Delete ${item.id}`}
            icon={<Trash className="h-3.5 w-3.5" />}
            size="sm"
            shape="rounded"
            onClick={onDelete}
            className="h-6 min-h-6 w-6 min-w-6 rounded-md bg-transparent text-content-muted opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus-visible:opacity-100"
          />
        </Tooltip>
      </div>
      <CollapsibleContent>
        <div className="space-y-3 px-9 pb-4">
          <Input
            aria-label={`Identifier for ${item.id}`}
            value={item.id}
            onChange={(event) => onChange({ ...item, id: event.target.value })}
            className="h-8 rounded-lg border-warm-border bg-warm-surface font-mono text-xs"
          />
          <Textarea
            aria-label={`Description for ${item.id}`}
            value={descriptionText(item)}
            rows={3}
            placeholder="Description"
            onChange={(event) => onChange({
              ...item,
              description: [
                { type: "text", text: event.target.value },
                ...references,
              ],
            })}
            className="resize-y rounded-lg border-warm-border bg-warm-surface text-sm leading-6"
          />
          {references.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {references.map((reference, index) => (
                <span
                  key={`${reference.entityId}:${index}`}
                  className="rounded-md border border-warm-border bg-warm-surface px-2 py-1 font-mono text-[10px] text-content-secondary"
                >
                  @{reference.entityId}
                </span>
              ))}
            </div>
          ) : null}
          {section === "audioLayers" ? (
            <Textarea
              aria-label={`Direction for ${item.id}`}
              value={item.details ?? ""}
              rows={3}
              placeholder="Timing, edit, and mix direction…"
              onChange={(event) => onChange({ ...item, details: event.target.value })}
              className="resize-y rounded-lg border-warm-border bg-warm-surface text-sm italic leading-6 text-sky-700 dark:text-sky-300"
            />
          ) : null}
          <div className="space-y-2">
            {item.materials.map((material, index) => (
              <MaterialRow
                key={material.id}
                material={material}
                assets={assets}
                choices={choices}
                generating={generatingSlot === material.id}
                onChange={(next) => onChange({
                  ...item,
                  materials: item.materials.map((entry, materialIndex) =>
                    materialIndex === index ? next : entry),
                })}
                onGenerate={(choice) => onGenerate(material, choice)}
              />
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const sectionMeta: Record<ItemSection, {
  label: string;
  prefix: string;
  mediaKind: "image" | "video" | "audio";
  icon: typeof Shapes;
}> = {
  keyElements: { label: "Key elements", prefix: "Element", mediaKind: "image", icon: Shapes },
  shots: { label: "Shots", prefix: "Shot", mediaKind: "video", icon: FilmSlate },
  audioLayers: { label: "Audio layers", prefix: "Audio", mediaKind: "audio", icon: MusicNotes },
};

export function PluginStoryboardSurface({
  label,
  state,
  assets,
  generators,
  onSave,
  onGenerate,
  onClose,
}: PluginStoryboardSurfaceProps) {
  const [generatingSlot, setGeneratingSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateItem = (
    section: ItemSection,
    index: number,
    item: StoryboardViewItem | StoryboardViewShot,
  ) => {
    const next = cloneState(state);
    (next[section] as Array<StoryboardViewItem | StoryboardViewShot>)[index] = item;
    onSave(next);
  };
  const generate = async (
    section: ItemSection,
    itemIndex: number,
    material: StoryboardViewMaterial,
    choice: StoryboardGeneratorChoice,
  ) => {
    setGeneratingSlot(material.id);
    setError(null);
    try {
      const candidate = await onGenerate(material, choice);
      const next = cloneState(state);
      const item = next[section][itemIndex] as StoryboardViewItem | StoryboardViewShot;
      const materialIndex = item.materials.findIndex((entry) => entry.id === material.id);
      if (materialIndex < 0) return;
      item.materials[materialIndex] = {
        ...item.materials[materialIndex]!,
        candidates: [...item.materials[materialIndex]!.candidates, candidate],
      };
      onSave(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setGeneratingSlot(null);
    }
  };

  return (
    <div className="absolute inset-0 z-10 flex min-h-0 flex-col bg-warm-page" data-plugin-view="storyboard">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-warm-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Shapes className="h-4 w-4" weight="duotone" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-sm font-semibold text-content-primary">{label}</div>
          <div className="text-[10px] text-content-muted">Draft View · generation uses installed Generators</div>
        </div>
        <IconButton
          label="Close Storyboard"
          icon={<X className="h-4 w-4" />}
          size="sm"
          shape="rounded"
          onClick={onClose}
          className="rounded-lg bg-transparent text-content-muted hover:bg-warm-hover"
        />
      </header>
      {error ? (
        <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-warm-border bg-warm-surface shadow-sm">
          {(Object.keys(sectionMeta) as ItemSection[]).map((section) => {
            const meta = sectionMeta[section];
            const Icon = meta.icon;
            const items = state[section];
            return (
              <Collapsible key={section} defaultOpen className="border-b border-warm-border last:border-b-0">
                <div className="flex h-11 items-center gap-2 px-3">
                  <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left [&[data-state=open]_.section-caret]:rotate-180">
                    <CaretDown className="section-caret h-3.5 w-3.5 text-content-muted transition-transform" />
                    <Icon className="h-4 w-4 text-content-secondary" weight="duotone" />
                    <span className="font-display text-sm font-semibold text-content-primary">{meta.label}</span>
                    <span className="rounded-full bg-warm-muted px-1.5 py-0.5 text-[10px] text-content-muted">{items.length}</span>
                  </CollapsibleTrigger>
                  <Tooltip label={`Add ${meta.label}`}>
                    <IconButton
                      label={`Add ${meta.label}`}
                      icon={<Plus className="h-3.5 w-3.5" weight="bold" />}
                      size="sm"
                      shape="rounded"
                      onClick={() => {
                        const next = cloneState(state);
                        const itemId = nextId(meta.prefix);
                        const item = {
                          id: itemId,
                          description: [],
                          materials: [{
                            id: `${itemId}_${meta.mediaKind}`,
                            mediaKind: meta.mediaKind,
                            candidates: [],
                          }],
                          ...(section === "shots" ? { durationSeconds: 3 } : {}),
                        };
                        (next[section] as Array<typeof item>).push(item);
                        onSave(next);
                      }}
                      className="h-7 min-h-7 w-7 min-w-7 rounded-md bg-transparent text-content-muted hover:bg-warm-hover hover:text-content-primary"
                    />
                  </Tooltip>
                </div>
                <CollapsibleContent>
                  {items.length > 0 ? items.map((item, index) => (
                    <StoryboardItemCard
                      key={`${item.id}:${index}`}
                      item={item}
                      section={section}
                      assets={assets}
                      choices={generators}
                      generatingSlot={generatingSlot}
                      onChange={(next) => updateItem(section, index, next)}
                      onDelete={() => {
                        const next = cloneState(state);
                        next[section].splice(index, 1);
                        onSave(next);
                      }}
                      onGenerate={(material, choice) => void generate(section, index, material, choice)}
                    />
                  )) : (
                    <div className="border-t border-warm-border/60 px-9 py-5 text-xs text-content-muted">
                      Add the first {meta.label.toLowerCase()} entry.
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
          <Collapsible defaultOpen>
            <div className="flex h-11 items-center gap-2 px-3">
              <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left [&[data-state=open]_.section-caret]:rotate-180">
                <CaretDown className="section-caret h-3.5 w-3.5 text-content-muted transition-transform" />
                <ImageIcon className="h-4 w-4 text-content-secondary" weight="duotone" />
                <span className="font-display text-sm font-semibold text-content-primary">Uncategorized</span>
                <span className="rounded-full bg-warm-muted px-1.5 py-0.5 text-[10px] text-content-muted">{state.uncategorized.length}</span>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <div className="flex flex-wrap gap-2 border-t border-warm-border/60 px-9 py-4">
                {state.uncategorized.length > 0 ? state.uncategorized.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    selected={false}
                    assets={assets}
                  />
                )) : (
                  <div className="py-1 text-xs text-content-muted">Loose Project Assets appear here until assigned.</div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </div>
  );
}
