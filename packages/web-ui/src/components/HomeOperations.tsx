import { ArrowRight } from "@phosphor-icons/react";
import { Link } from "react-router";

import { HomeSectionHeader } from "./HomeSectionHeader";
import { BrandAsset } from "./BrandAsset";
import { ArtworkSlot } from "./ui/artwork-slot";
import { Card } from "./ui/card";

const operations = [
  {
    href: "/assets",
    title: "Organize your media",
    description: "Review source files and generated work in one place.",
    label: "Assets",
    artwork: "assets",
  },
  {
    href: "/marketplace/manage",
    title: "Extend your workflow",
    description: "Add actions and skills to the tools your agents can use.",
    label: "Store",
    artwork: "plugins",
  },
] as const;

export default function HomeOperations() {
  return (
    <section
      aria-labelledby="home-operations-heading"
      className="clash-home-section"
    >
      <HomeSectionHeader id="home-operations-heading" title="Explore Clash" />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {operations.map((operation) => {
          return (
            <Card key={operation.href} asChild interaction="surface">
              <Link
                to={operation.href}
                aria-label={`${operation.title}. ${operation.description}`}
                className="group flex min-h-24 items-center gap-4 p-4"
              >
                <ArtworkSlot size="xl">
                  <BrandAsset
                    data-slot="feature-avatar-artwork"
                    name={operation.artwork}
                    alt=""
                    className="size-14 shrink-0 object-contain transition-transform duration-[var(--motion-feedback-duration)] ease-[var(--motion-feedback-ease)] group-hover:-rotate-2 group-hover:scale-[1.04] motion-reduce:transition-none"
                  />
                </ArtworkSlot>
                <span className="min-w-0 flex-1">
                  <span
                    data-slot="operation-label"
                    className="text-xs font-medium text-content-muted"
                  >
                    {operation.label}
                  </span>
                  <span className="mt-1 block text-sm font-semibold text-content-primary">
                    {operation.title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-content-secondary">
                    {operation.description}
                  </span>
                </span>
                <ArrowRight
                  className="h-4 w-4 flex-none text-content-muted transition-[color,transform] duration-[var(--motion-feedback-duration)] ease-[var(--motion-feedback-ease)] group-hover:translate-x-0.5 group-hover:text-content-primary motion-reduce:transform-none"
                  weight="regular"
                  aria-hidden="true"
                />
              </Link>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
