import { Check } from "@phosphor-icons/react";
import type { RegistryItem } from "@clash/web-ui/lib/clientActions";
import { Link } from "react-router";

import { MarketplaceItemArtwork } from "./MarketplaceItemCard";
import { marketplacePluginPath } from "./marketplaceRouting";
import { HomeSectionActionLink, HomeSectionHeader } from "./HomeSectionHeader";

export default function HomeMarketplaceRecommendations({
  featuredPlugins,
  installedActionIds,
  installedSkillIds,
}: {
  featuredPlugins: RegistryItem[];
  installedActionIds: string[];
  installedSkillIds: string[];
}) {
  if (featuredPlugins.length === 0) return null;

  const installedActions = new Set(installedActionIds);
  const installedSkills = new Set(installedSkillIds);

  return (
    <section
      aria-labelledby="home-marketplace-heading"
      className="clash-home-section"
    >
      <HomeSectionHeader
        id="home-marketplace-heading"
        title="From Marketplace"
        action={
          <HomeSectionActionLink to="/marketplace/manage">
            View Marketplace
          </HomeSectionActionLink>
        }
      />

      <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 xl:grid-cols-4">
        {featuredPlugins.map((item) => {
          const installed =
            item.type === "action"
              ? installedActions.has(item.id)
              : installedSkills.has(item.id);

          return (
            <li
              key={`${item.type}-${item.id}`}
              data-slot="home-marketplace-item"
              className="min-w-0 border-t border-border"
            >
              <Link
                to={marketplacePluginPath(item)}
                aria-label={`View ${item.name} details`}
                className="flex min-w-0 items-center gap-3 rounded-md py-3.5 outline-none transition-colors hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MarketplaceItemArtwork item={item} context="preview" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-content-primary">
                    {item.name}
                  </h3>
                  {item.description ? (
                    <p className="mt-0.5 truncate text-xs text-content-secondary">
                      {item.description}
                    </p>
                  ) : null}
                  <span className="mt-1 flex items-center gap-1 text-xs text-content-muted">
                    {installed ? (
                      <Check
                        className="size-3"
                        weight="bold"
                        aria-hidden="true"
                      />
                    ) : null}
                    {installed
                      ? "Installed"
                      : item.type === "action"
                        ? "Action"
                        : "Skill"}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
