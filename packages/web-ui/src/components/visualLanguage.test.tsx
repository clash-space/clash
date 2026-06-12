// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import BillingClient from "./BillingClient";
import MarketplaceClient from "./MarketplaceClient";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) =>
          ({ children, whileHover: _whileHover, whileTap: _whileTap, transition: _transition, ...props }: any) =>
            React.createElement(tag, props, children),
      },
    ),
  };
});

const oldVisualTokens = /indigo|purple|violet|blue-50|blue-500|bg-gradient-to-br|text-gray|bg-gray|border-gray/;

describe("visual language surfaces", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the marketplace with warm brand surfaces instead of legacy blue/purple categories", () => {
    const { container } = render(
      <MemoryRouter>
        <MarketplaceClient
          items={[
            {
              id: "image-action",
              type: "action",
              name: "Image Action",
              description: "Creates a canvas asset.",
              author: "clash",
              version: "1.0.0",
              tags: ["image", "canvas"],
            },
            {
              id: "writing-skill",
              type: "skill",
              name: "Writing Skill",
              description: "Refines a creative brief.",
              author: "clash",
              version: "1.0.0",
              tags: ["copy"],
            },
          ]}
          installedActionIds={[]}
          installedSkillIds={[]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Marketplace" })).toBeTruthy();
    expect(container.innerHTML).not.toMatch(oldVisualTokens);
    expect(container.querySelector('[class*="bg-brand-light"][class*="text-brand"]')).toBeTruthy();
    expect(container.querySelector('[class*="bg-warm-muted"][class*="text-stone-700"]')).toBeTruthy();
    expect(container.querySelector('input[class*="rounded-xl"]')).toBeTruthy();
  });

  it("renders billing cards with warm surfaces instead of a purple gradient hero", () => {
    const { container } = render(
      <MemoryRouter>
        <BillingClient
          balance={{ available: 1200, grant: 800, topup: 400, hold: 0, grant_expires_at: 1780000000 } as any}
          packs={[
            {
              pack_id: "starter",
              label: "Starter (bonus)",
              credits: 1000,
              price_usd_cents: 1000,
              paddle_price_id: "pri_starter",
            },
          ] as any}
          plans={[
            {
              id: "free",
              name: "Free",
              price_usd_cents: 0,
              monthly_credits: 100,
              features: {
                storage_mb: 512,
                max_projects: 1,
                max_resolution: "720p",
                max_duration_s: 10,
                commercial: false,
              },
            },
            {
              id: "studio",
              name: "Studio",
              price_usd_cents: 2900,
              monthly_credits: 5000,
              features: {
                storage_mb: 8192,
                max_projects: 20,
                max_resolution: "4K",
                max_duration_s: 60,
                commercial: true,
              },
            },
          ] as any}
          ledger={[]}
          notEnabled={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("credits available")).toBeTruthy();
    expect(container.innerHTML).not.toMatch(oldVisualTokens);
    expect(container.querySelector('[class*="bg-warm-surface/95"]')).toBeTruthy();
    expect(container.querySelector('[class*="ring-brand/15"]')).toBeTruthy();
  });
});
