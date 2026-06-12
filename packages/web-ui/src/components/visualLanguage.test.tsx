// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import BillingClient from "./BillingClient";
import MarketplaceClient from "./MarketplaceClient";
import SettingsClient from "./SettingsClient";

vi.mock("@clash/web-ui/hooks/useClashRuntime", () => ({
  useClashRuntime: () => ({
    runtimes: [],
    refresh: vi.fn(),
  }),
}));

vi.mock("@clash/web-ui/lib/clientActions", () => ({
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
  setVariable: vi.fn(),
  deleteVariable: vi.fn(),
  uninstallAction: vi.fn(),
  uninstallSkill: vi.fn(),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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
const oldCanvasControlTokens =
  /text-gray|bg-gray|border-gray|hover:bg-gray|focus:border-gray|placeholder:text-gray|accent-gray|prose-headings:text-gray|prose-p:text-gray|prose-code:text-gray/;
const oldActivityPresenceTokens =
  /blue-100|blue-300|blue-700|blue-950|bg-gradient-to-br|from-brand to-red-500/;
const oldIdentityMentionTokens =
  /from-brand to-red-500|hover:bg-gray-50|text-gray-700|text-gray-800|dark:text-gray-200|dark:text-gray-300/;
const oldAwarenessPaletteTokens =
  /cyan|blue-500|violet|#06b6d4|#3b82f6|#8b5cf6/;
const oldVideoClipperTokens =
  /border-purple-500|color="purple"|color="blue"|color:\s*'blue'|color:\s*'purple'|bg-blue-500|ring-blue-300|bg-purple-500|ring-purple-300/;
const oldEditorModalShellTokens =
  /bg-slate-950(?:\/30|\/10|\/\[0\.28\])|shadow-2xl|shadow-\[0_24px_80px_rgba\(15,23,42,0\.28\)\]|ring-slate-950\/10|border-white\/70/;
const oldMediaViewerTokens =
  /bg-black\/80|bg-white\/10|hover:bg-white\/20|text-white|ring-white\/10|shadow-2xl|focus-visible:ring-white|focus-visible:ring-offset-black/;
const oldConfirmDialogTokens =
  /bg-slate-950\/35|shadow-lg border border-warm-border|transition=\{\{ type: 'spring'|bg-warm-muted\/70/;

describe("visual language surfaces", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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

  it("keeps ActionBadge canvas controls on warm and brand tokens", () => {
    const sourcePath = join(process.cwd(), "packages/web-ui/src/components/nodes/ActionBadge.tsx");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toMatch(oldCanvasControlTokens);
    expect(source).toMatch(/brand|warm|stone|slate/);
  });

  it("keeps activity and presence feedback out of legacy blue or gradient states", () => {
    const source = [
      "packages/web-ui/src/components/ActivityToast.tsx",
      "packages/web-ui/src/components/NodeActivityIndicator.tsx",
      "packages/web-ui/src/components/PresenceBar.tsx",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldActivityPresenceTokens);
    expect(source).toMatch(/brand|warm|stone|slate/);
  });

  it("keeps the homepage depth mask transparent enough for the canvas grid to read", () => {
    const source = readFileSync(join(process.cwd(), "packages/web-ui/src/components/Background.tsx"), "utf8");

    expect(source).not.toMatch(/to-warm-page\/\[(0\.025|0\.012|0\.006)\]/);
    expect(source).toMatch(/to-warm-page\/\[0\.003\]/);
  });

  it("keeps identity and mention surfaces out of legacy gradient and default gray chrome", () => {
    const source = [
      "packages/web-ui/src/components/UserControls.tsx",
      "packages/web-ui/src/components/GroupChatPanel.tsx",
      "packages/web-ui/src/components/MilkdownEditor.tsx",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldIdentityMentionTokens);
    expect(source).toMatch(/brand|warm|stone|slate/);
  });

  it("keeps collaborative cursor colours out of AI-blue/purple palette drift", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/hooks/usePresenceAwareness.ts"),
      "utf8",
    );

    expect(source).not.toMatch(oldAwarenessPaletteTokens);
    expect(source).toMatch(/coral|ember|moss|slate/);
  });

  it("keeps the video clipper timeline controls out of blue/purple editor chrome", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/VideoClipperContext.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(oldVideoClipperTokens);
    expect(source).toMatch(/brand|warm|slate/);
  });

  it("keeps editor modal shells on Clash surface classes instead of generic dark overlays", () => {
    const source = [
      "packages/web-ui/src/components/ImageEditorContext.tsx",
      "packages/web-ui/src/components/VideoClipperContext.tsx",
      "packages/web-ui/src/components/VideoEditorContext.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldEditorModalShellTokens);
    expect(source).toMatch(/clash-editor-modal-backdrop/);
    expect(source).toMatch(/clash-editor-modal-surface/);
  });

  it("keeps the media viewer in Clash media surfaces instead of generic black lightbox chrome", () => {
    const source = [
      "packages/web-ui/src/components/MediaViewer.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldMediaViewerTokens);
    expect(source).toMatch(/clash-media-viewer-backdrop/);
    expect(source).toMatch(/clash-media-viewer-frame/);
    expect(source).toMatch(/clash-media-viewer-chrome/);
  });

  it("keeps confirm dialogs in Clash dialog surfaces instead of generic slate overlays", () => {
    const source = [
      "packages/web-ui/src/components/ConfirmDialog.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldConfirmDialogTokens);
    expect(source).toMatch(/clash-confirm-dialog-backdrop/);
    expect(source).toMatch(/clash-confirm-dialog-surface/);
    expect(source).toMatch(/clash-confirm-dialog-footer/);
  });

  it.each([
    ["tokens", "API Tokens"],
    ["variables", "API Keys"],
    ["actions", "Installed Actions"],
    ["skills", "Installed Skills"],
    ["cli", "CLI"],
    ["runtimes", "Runtimes"],
  ] as const)("renders %s settings with warm controls instead of default gray chrome", (section, heading) => {
    const { container } = render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection={section}
          embedded
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    expect(container.innerHTML).not.toMatch(oldVisualTokens);
  });

  it("renders sync settings with warm selected states after loading local config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            mode: "local-only",
            remote_loro: {
              enabled: false,
              url: null,
              has_token: false,
              source: "none",
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const { container } = render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="sync"
          embedded
        />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByLabelText("Remote Loro URL")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Sync" })).toBeTruthy();
    expect(container.innerHTML).not.toMatch(oldVisualTokens);
    expect(container.querySelector('[class*="border-brand/55"][class*="bg-brand-light/45"]')).toBeTruthy();
  });
});
