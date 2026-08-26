import { useMemo, useState } from "react";
import type { RegistryItem } from "@clash/web-ui/lib/clientActions";
import { MarketplaceItemCard } from "./MarketplaceItemCard";
import type { AddMarketplaceSkillReference } from "./MarketplaceSkillReferenceDnd";
import { SearchFilterToolbar } from "./SearchFilterToolbar";
import { useOptionalDashboardComposer } from "./DashboardComposerContext";
import { AppPage, AppPageHeader } from "./AppPage";
import { ArtworkSlot } from "./ui/artwork-slot";
import { BrandAsset } from "./BrandAsset";

type MarketplaceTypeFilter = "action" | "skill";

interface Props {
  items: RegistryItem[];
  installedActionIds: string[];
  installedSkillIds: string[];
  mode?: "public" | "manage";
  canAddReference?: boolean;
  onAddReference?: AddMarketplaceSkillReference;
}

export default function MarketplaceClient({
  items,
  installedActionIds,
  installedSkillIds,
  mode = "manage",
  canAddReference = false,
  onAddReference,
}: Props) {
  const [query, setQuery] = useState("");
  const [typeFilters, setTypeFilters] = useState<MarketplaceTypeFilter[]>([]);
  const dashboardComposer = useOptionalDashboardComposer();
  const addReference = onAddReference ?? dashboardComposer?.addSkillReference;
  const allowReferences = canAddReference || Boolean(dashboardComposer);
  const installedActions = useMemo(
    () => new Set(installedActionIds),
    [installedActionIds],
  );
  const installedSkills = useMemo(
    () => new Set(installedSkillIds),
    [installedSkillIds],
  );
  const canManage = mode === "manage";

  const filtered = useMemo(() => {
    let result = items;
    if (typeFilters.length > 0) {
      result = result.filter((item) =>
        typeFilters.every((typeFilter) => item.type === typeFilter),
      );
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q) ||
          (item.description || "").toLowerCase().includes(q) ||
          (item.tags || []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [items, query, typeFilters]);

  const typeFilterOptions: Array<{
    value: MarketplaceTypeFilter;
    label: string;
  }> = [
    { value: "action", label: "Actions" },
    { value: "skill", label: "Skills" },
  ];
  const emptyMessage = query.trim()
    ? `No results for "${query}"`
    : typeFilters.length > 0
      ? "No items match the selected filters"
      : "No items available yet";

  return (
    <div className="min-h-screen">
      <AppPage width="narrow">
        <AppPageHeader
          title="Marketplace"
          description={
            canManage
              ? "Install actions and skills for your workspace"
              : "Actions and skills for Clash agents"
          }
        />

        <div
          data-slot="marketplace-sticky-controls"
          className="sticky top-[var(--clash-app-sidebar-section-gap)] z-20 -mx-2 bg-background px-2 py-4"
        >
          <SearchFilterToolbar
            query={query}
            onQueryChange={setQuery}
            filterGroups={[
              {
                id: "type",
                label: "Type",
                options: typeFilterOptions,
                selectedValues: typeFilters,
                onSelectedValuesChange: (values) =>
                  setTypeFilters(
                    values.filter(
                      (value): value is MarketplaceTypeFilter =>
                        value === "action" || value === "skill",
                    ),
                  ),
              },
            ]}
            searchLabel="Search actions and skills"
            context="page"
            spacing="none"
          />
        </div>

        {/* Results */}
        {filtered.length === 0 ? (
          <div
            role="status"
            aria-label={emptyMessage}
            className="py-24 text-center"
          >
            <ArtworkSlot
              slot="marketplace-empty-artwork"
              size="xl"
              className="mx-auto mb-4"
            >
              <BrandAsset
                name="emptySearch"
                alt=""
                className="size-16 object-contain"
              />
            </ArtworkSlot>
            <p className="text-sm text-content-secondary">{emptyMessage}</p>
          </div>
        ) : (
          <ul
            aria-label="Marketplace catalog"
            data-layout="plugin-grid"
            className="grid grid-cols-1 gap-[var(--settings-row-gap)] md:grid-cols-2"
          >
            {filtered.map((item) => (
              <MarketplaceItemCard
                key={`${item.type}-${item.id}`}
                item={item}
                initiallyInstalled={
                  item.type === "action"
                    ? installedActions.has(item.id)
                    : installedSkills.has(item.id)
                }
                canManage={canManage}
                canAddReference={item.type === "skill" && allowReferences}
                onAddReference={
                  item.type === "skill" ? addReference : undefined
                }
                isReferenceAdded={
                  item.type === "skill" &&
                  Boolean(
                    dashboardComposer?.references.skills.some(
                      (skill) => skill.id === item.id,
                    ),
                  )
                }
              />
            ))}
          </ul>
        )}
      </AppPage>
    </div>
  );
}
