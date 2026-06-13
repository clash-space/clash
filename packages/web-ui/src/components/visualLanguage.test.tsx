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
  /bg-slate-950\/35|bg-slate-950|hover:bg-slate-800|bg-red-600|hover:bg-red-700|focus-visible:ring-red-500|shadow-lg border border-warm-border|transition=\{\{ type: 'spring'|bg-warm-muted\/70/;
const oldRouteErrorTokens =
  /Something went wrong|Unknown error|bg-slate-950|hover:bg-slate-800|text-white transition-colors|border-t-slate-950|shadow-\[0_18px_48px_rgba\(35,31,25,0\.08\)/;
const oldSettingsDialogTokens =
  /ChatGPT-style|shadow-2xl border border-warm-border|bg-warm-muted\/40 flex flex-col/;
const oldSettingsActionTokens =
  /bg-slate-950|hover:bg-slate-800|bg-slate-950 text-slate-50|bg-red-50|hover:bg-red-50|text-red-700/;
const oldProjectTileTokens =
  /border-2 border-dashed|hover:shadow-lg|bg-warm-muted\/60|bg-warm-surface\/70|window\.confirm|if \(confirm\(|confirm\('[^']|hover:bg-red-50|dark:hover:bg-red-950|focus-visible:ring-red-500/;
const oldAuthRouteTokens =
  /bg-slate-950 px-6 py-4|hover:bg-slate-800|bg-red-50|bg-green-50|shadow-slate-950\/10/;
const oldDaemonConnectTokens =
  /bg-slate-950|hover:bg-slate-800|bg-slate-950 text-slate-50|text-white px-6 py-3|text-red-600|clash-auth-code[^"]*break-all/;
const oldLocalAgentSetupTokens =
  /bg-slate-950 text-white py-2\.5|min-h-\[44px\] text-sm font-medium hover:bg-slate-800|bg-slate-900 text-slate-50 px-3 py-2\.5|border-red-200 bg-red-50/;
const oldMarketplaceActionTokens =
  /bg-slate-950 text-white|hover:bg-slate-800|hover:bg-red-50 hover:text-red-600|dark:hover:bg-red-950/;
const oldUserAccountActionTokens =
  /bg-(?:slate|stone)-9(?:00|50)|hover:bg-(?:slate|stone)-(?:7|8)00|shadow-slate-950\/20|dark:bg-slate-100|dark:hover:bg-white/;
const oldBillingActionTokens =
  /bg-slate-950 text-white|hover:bg-slate-800|dark:bg-slate-100|dark:hover:bg-white/;
const oldChatInputActionTokens =
  /bg-slate-950 text-white|hover:bg-slate-800|hover:bg-red-600|focus-visible:ring-red-500|bg-red-50(?:\s|")|hover:bg-red-100(?:\s|")|text-red-700(?:\s|")|dark:bg-red-950(?:\/|\s|")/;
const oldNodeBuildActionTokens =
  /bg-slate-950(?:\s|")|bg-slate-950 text|hover:bg-slate-800|bg-red-50(?:\s|")|hover:bg-red-50|border-red-200|border-red-300|text-red-700|text-red-800|focus-visible:ring-red-500/;
const oldInlineNodePrimaryActionTokens =
  /text-white bg-slate-950|bg-slate-950 hover:bg-slate-800|bg-slate-950 rounded-lg hover:bg-slate-800/;
const oldActionBadgeMenuActionTokens =
  /!bg-slate-950|bg-slate-950 text-white|bg-slate-950 hover:bg-slate-800|bg-slate-950 hover:bg-black|bg-slate-900 rounded-xl|bg-slate-900 text-white|bg-slate-700 hover:bg-slate-900|bg-slate-700 text-white|bg-red-400 text-white/;
const oldCopilotActionSurfaceTokens =
  /bg-slate-950 text-white|hover:bg-slate-800|bg-brand text-white text-xs font-medium hover:bg-red-500|bg-brand text-white rounded-lg text-sm font-medium hover:bg-red-500|border-red-200 bg-red-50|text-red-800/;

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

  it("keeps marketplace filters and install actions out of generic black and hard-red chrome", () => {
    const source = [
      "packages/web-ui/src/components/MarketplaceClient.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldMarketplaceActionTokens);
    expect(source).toMatch(/clash-marketplace-filter-active/);
    expect(source).toMatch(/clash-marketplace-primary/);
    expect(source).toMatch(/clash-marketplace-installed/);
  });

  it("keeps user account sign-in actions on Clash brand surfaces instead of generic black auth chrome", () => {
    const source = [
      "packages/web-ui/src/components/UserControls.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldUserAccountActionTokens);
    expect(source).toMatch(/clash-user-primary/);
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

  it("keeps billing purchase and configuration actions on Clash brand surfaces instead of generic black buttons", () => {
    const source = [
      "packages/web-ui/src/components/BillingClient.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldBillingActionTokens);
    expect(source).toMatch(/clash-billing-primary/);
  });

  it("keeps chat input errors and send controls on Clash surfaces instead of black and hard-red chrome", () => {
    const source = [
      "packages/web-ui/src/components/copilot/ChatInput.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldChatInputActionTokens);
    expect(source).toMatch(/clash-chat-input-alert-error/);
    expect(source).toMatch(/clash-chat-input-primary/);
    expect(source).toMatch(/clash-chat-input-stop/);
  });

  it("keeps canvas build and apply controls on Clash node surfaces instead of generic black and hard-red chrome", () => {
    const source = [
      "packages/web-ui/src/components/nodes/DraftPlaceholder.tsx",
      "packages/web-ui/src/components/nodes/BuildPlanDialog.tsx",
      "packages/web-ui/src/components/nodes/CloneTrajectoryDialog.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldNodeBuildActionTokens);
    expect(source).toMatch(/clash-node-primary/);
    expect(source).toMatch(/clash-node-alert-error/);
    expect(source).toMatch(/clash-node-row-error/);
    expect(source).toMatch(/clash-node-danger-ghost/);
    expect(source).toMatch(/clash-node-badge-draft/);
  });

  it("uses the transparent Clash mark for the browser tab favicon", () => {
    const favicon = readFileSync(join(process.cwd(), "apps/web/public/favicon.svg"), "utf8");
    const mark = readFileSync(join(process.cwd(), "apps/web/public/brand/logo-mark.svg"), "utf8");

    expect(favicon).toBe(mark);
    expect(favicon).not.toMatch(/<rect\s+width="512"\s+height="512"|fill="#F7F6F2"|fill="#FBFAF7"/);
  });

  it("keeps inline canvas node primary actions on Clash node surfaces instead of generic black buttons", () => {
    const source = [
      "packages/web-ui/src/components/nodes/TextNode.tsx",
      "packages/web-ui/src/components/nodes/PromptNode.tsx",
      "packages/web-ui/src/components/nodes/ImageEditorNode.tsx",
      "packages/web-ui/src/components/nodes/VideoClipperNode.tsx",
      "packages/web-ui/src/components/nodes/VideoEditorNode.tsx",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldInlineNodePrimaryActionTokens);
    expect(source.match(/clash-node-primary/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps ActionBadge canvas controls on warm and brand tokens", () => {
    const sourcePath = join(process.cwd(), "packages/web-ui/src/components/nodes/ActionBadge.tsx");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toMatch(oldCanvasControlTokens);
    expect(source).toMatch(/brand|warm|stone|slate/);
  });

  it("keeps ActionBadge menus and selected controls out of generic black chrome", () => {
    const source = [
      "packages/web-ui/src/components/nodes/ActionBadge.tsx",
      "packages/web-ui/src/components/nodes/ActionBadgePipelineMenu.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldActionBadgeMenuActionTokens);
    expect(source).toMatch(/clash-node-choice-active/);
    expect(source).toMatch(/clash-node-ref-index/);
    expect(source).toMatch(/clash-node-ref-remove/);
    expect(source).toMatch(/clash-node-primary/);
    expect(source).toMatch(/!bg-brand/);
  });

  it("keeps copilot proposal and approval actions on shared Clash surfaces", () => {
    const source = [
      "packages/web-ui/src/components/copilot/NodeProposalCard.tsx",
      "packages/web-ui/src/components/copilot/ApprovalCard.tsx",
      "packages/web-ui/src/components/copilot/MessageErrorBoundary.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldCopilotActionSurfaceTokens);
    expect(source).toMatch(/clash-copilot-primary/);
    expect(source).toMatch(/clash-copilot-alert-error/);
  });

  it("keeps the project brand mark as the bottom-right copilot launcher instead of a canvas header logo", () => {
    const projectSource = readFileSync(join(process.cwd(), "packages/web-ui/src/components/ProjectEditor.tsx"), "utf8");
    const copilotSource = readFileSync(join(process.cwd(), "packages/web-ui/src/components/ChatbotCopilot.tsx"), "utf8");
    const cssSource = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");
    const launcherRule = cssSource.match(/\.clash-copilot-launcher\s*\{[\s\S]*?\}/)?.[0] ?? "";

    expect(projectSource).not.toMatch(/aria-label="Clash home"|<Link to="\/"/);
    expect(projectSource).toMatch(/id="editor-header"/);
    expect(projectSource).toMatch(/absolute left-9 top-4/);
    expect(projectSource).toMatch(/clash-project-return-button/);
    expect(projectSource).toMatch(/projectTitleInputWidthCh/);
    expect(projectSource).toMatch(/width: `\$\{projectTitleInputWidthCh\}ch`/);
    expect(projectSource).toMatch(/id="project-top-actions"/);
    expect(projectSource).toMatch(/absolute top-10 z-20/);
    expect(projectSource).toMatch(/<PresenceBar clients=\{otherClients\} \/>/);
    expect(projectSource).toMatch(/<UserControls projectChrome \/>/);
    expect(projectSource).not.toMatch(/MonitorPlay|isPresentationMode|Present canvas|Presenting/);
    expect(copilotSource).toMatch(/clash-copilot-launcher/);
    expect(copilotSource).toMatch(/bottom-\[max\(1rem,env\(safe-area-inset-bottom\)\)\]/);
    expect(copilotSource).toMatch(/\/brand\/logo-mark-animated\.svg/);
    expect(copilotSource).toMatch(/clash-copilot-panel-shell fixed bottom-3 right-3/);
    expect(copilotSource).toMatch(/height: 'calc\(100dvh - var\(--clash-desktop-chrome-height, 0px\) - 1\.5rem\)'/);
    expect(copilotSource).toMatch(/rounded-matrix/);
    expect(copilotSource).toMatch(/transformOrigin: 'right bottom'/);
    expect(copilotSource).toMatch(/absolute left-12 top-6/);
    expect(copilotSource).toMatch(/absolute right-4 top-6/);
    expect(copilotSource).toMatch(/top-20 overflow-y-auto/);
    expect(copilotSource).toMatch(/scale: isCollapsed \? 0\.82 : 1/);
    expect(copilotSource).toMatch(/x: isCollapsed \? 48 : 0/);
    expect(copilotSource).toMatch(/y: isCollapsed \? 48 : 0/);
    expect(copilotSource).toMatch(/from-warm-surface via-warm-surface\/85/);
    expect(copilotSource).not.toMatch(/border-l border-warm-border shadow-\[0_18px_50px/);
    expect(cssSource).toMatch(/\.clash-copilot-launcher/);
    expect(cssSource).toMatch(/\.clash-copilot-panel-shell/);
    expect(cssSource).toMatch(/\.clash-copilot-panel-shell\s*\{[\s\S]*?border-radius:\s*28px/);
    expect(cssSource).toMatch(/\.clash-copilot-panel-shell\s*\{[\s\S]*?radial-gradient\(rgba\(214, 209, 200, 0\.22\) 1px, transparent 1px\)/);
    expect(cssSource).toMatch(/\.clash-copilot-panel-shell\s*\{[\s\S]*?background-size:\s*18px 18px, auto, auto, auto/);
    expect(cssSource).toMatch(/\.clash-copilot-resize-handle::before/);
    expect(cssSource).toMatch(/\.clash-project-top-action/);
    expect(cssSource).toMatch(/\.clash-project-return-button,\s*\n\.clash-project-name-input\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
    expect(cssSource).toMatch(/\.clash-project-name-input:focus\s*\{[\s\S]*?inset 0 -2px 0 rgba\(255, 107, 80, 0\.34\)/);
    expect(cssSource).not.toMatch(/\.clash-project-top-action-active/);
    expect(launcherRule).toMatch(/border:\s*0/);
    expect(launcherRule).toMatch(/background:\s*transparent/);
    expect(launcherRule).toMatch(/box-shadow:\s*none/);
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
    const backgroundSource = readFileSync(join(process.cwd(), "packages/web-ui/src/components/Background.tsx"), "utf8");
    const cssSource = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");

    expect(backgroundSource).not.toMatch(/to-warm-page\/\[(0\.025|0\.012|0\.006|0\.003|0\.0015)\]/);
    expect(backgroundSource).toMatch(/to-warm-page\/\[0\.0008\]/);
    expect(backgroundSource).toMatch(/opacity: 0\.38/);
    expect(cssSource).not.toMatch(/#f7f6f2|#d8d5cf|#f1efea/);
    expect(cssSource).toMatch(/--color-warm-page: #fbfaf7/);
  });

  it("keeps dashboard entry screens canvas-first without a detached hero preview", () => {
    const source = [
      "packages/web-ui/src/components/HeroSection.tsx",
      "packages/web-ui/src/components/landing/LandingHero.tsx",
      "packages/web-ui/src/components/ProjectsClient.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/HeroCanvasPreview|clash-home-canvas-preview|clash-home-preview-node|Agent drafting|Neon rain/);
    expect(source).toMatch(/variant="hero"/);
    expect(source).toMatch(/clash-hero-stage/);
    expect(source).toMatch(/clash-hero-prompt/);
    expect(source).not.toMatch(/lg:pl-(12|16)|xl:pl-(12|16)/);
    expect(source).toMatch(/\/brand\/logo-mark-animated\.svg/);
    expect(source).toMatch(/clash-dashboard-shell/);
    expect(source).toMatch(/clash-projects-empty-workbench/);
    expect(source).toMatch(/clash-projects-empty-canvas/);
    expect(source).toMatch(/clash-projects-empty-edge/);
    expect(source).toMatch(/clash-projects-empty-node--agent/);
    expect(source).toMatch(/clash-home-preview-edge-flow/);
    expect(source).not.toMatch(/clash-projects-empty-node--wide|clash-projects-empty-node--small|clash-projects-empty-node--accent/);
  });

  it("keeps the landing capability section out of generic icon-card grid patterns", () => {
    const source = readFileSync(join(process.cwd(), "packages/web-ui/src/components/landing/FeatureGrid.tsx"), "utf8");
    const cssSource = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");

    expect(source).toMatch(/clash-landing-capability-rail/);
    expect(source).toMatch(/clash-landing-capability-row/);
    expect(cssSource).toMatch(/\.clash-landing-capability-rail/);
    expect(source).not.toMatch(/lg:grid-cols-3/);
    expect(source).not.toMatch(/rounded-2xl border border-warm-border\/80 bg-warm-surface\/80 p-7/);
  });

  it("keeps the public landing page aligned with canvas and local-runtime product language", () => {
    const source = [
      "packages/web-ui/src/components/landing/LandingHero.tsx",
      "packages/web-ui/src/components/landing/FeatureGrid.tsx",
      "packages/web-ui/src/components/landing/HowItWorks.tsx",
      "packages/web-ui/src/components/landing/UseCases.tsx",
      "packages/web-ui/src/components/landing/Pricing.tsx",
      "packages/web-ui/src/components/landing/CTASection.tsx",
      "packages/web-ui/src/components/landing/BlogPreview.tsx",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/HeroCanvasPreview|Agent drafting|Neon rain/);
    expect(source).toMatch(/variant="hero"/);
    expect(source).toMatch(/Canvas-first planning/);
    expect(source).toMatch(/Local runtime ready/);
    expect(source).toMatch(/Cloud when invited/);
    expect(source).toMatch(/From idea to canvas to runtime/);
    expect(source).toMatch(/Solo creator studio/);
    expect(source).toMatch(/Local by default, cloud when it helps/);
    expect(source).toMatch(/Start local\. Add cloud only when the project needs it\./);
    expect(source).toMatch(/clash-blog-preview-canvas/);
    expect(source).toMatch(/Field notes/);
    expect(source).toMatch(/The canvas is the contract/);
    expect(source).toMatch(/Local-first agents, cloud when useful/);
    expect(source).toMatch(/Multiplayer without losing the room/);
    expect(source).not.toMatch(/stock footage|Digital Avatars|Brand Customization|Export optimized|technical complexity|b-roll|lip-sync|720p export|Watermark on exports|bg-slate-950|AI video tools are flooding|Sleep-Time Production|CRDT-Powered Collaboration|bg-gradient-to-br|gradient:/);
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
    expect(source).toMatch(/clash-confirm-primary/);
    expect(source).toMatch(/clash-confirm-secondary/);
    expect(source).toMatch(/clash-confirm-danger/);
  });

  it("keeps the root error boundary transparent and recoverable instead of generic copy", () => {
    const source = readFileSync(join(process.cwd(), "apps/web/app/root.tsx"), "utf8");

    expect(source).not.toMatch(oldRouteErrorTokens);
    expect(source).toMatch(/clash-route-error-surface/);
    expect(source).toMatch(/clash-route-error-primary/);
    expect(source).toMatch(/clash-route-error-secondary/);
    expect(source).toMatch(/clash-route-error-detail/);
    expect(source).toMatch(/Clash could not finish this view/);
    expect(source).toMatch(/error\.code/);
    expect(source).toMatch(/Reload/);
    expect(source).toMatch(/Go home/);
  });

  it("keeps settings modal chrome in Clash surfaces instead of inherited generic modal styling", () => {
    const source = [
      "packages/web-ui/src/components/SettingsDialog.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldSettingsDialogTokens);
    expect(source).toMatch(/clash-settings-dialog-shell/);
    expect(source).toMatch(/clash-settings-dialog-sidebar/);
    expect(source).toMatch(/clash-settings-dialog-content/);
  });

  it("keeps settings actions, alerts, and setup command surfaces out of generic black and hard-red chrome", () => {
    const source = [
      "packages/web-ui/src/components/SettingsClient.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldSettingsActionTokens);
    expect(source).toMatch(/clash-settings-primary/);
    expect(source).toMatch(/clash-settings-code/);
    expect(source).toMatch(/clash-settings-alert-error/);
    expect(source).toMatch(/clash-settings-danger-ghost/);
  });

  it("keeps project tiles on Clash canvas surfaces instead of generic dashed cards", () => {
    const source = [
      "packages/web-ui/src/components/RecentProjects.tsx",
      "packages/web-ui/src/components/ProjectsClient.tsx",
      "packages/web-ui/src/components/ProjectCard.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldProjectTileTokens);
    expect(source).toMatch(/clash-project-create-tile/);
    expect(source).toMatch(/clash-project-card-frame/);
    expect(source).toMatch(/clash-project-card-empty/);
    expect(source).toMatch(/useConfirm/);
    expect(source).toMatch(/clash-project-card-delete/);
  });

  it("keeps the login route in Clash auth surfaces instead of generic black auth buttons", () => {
    const source = [
      "apps/web/app/routes/login.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldAuthRouteTokens);
    expect(source).toMatch(/clash-auth-panel/);
    expect(source).toMatch(/clash-auth-input/);
    expect(source).toMatch(/clash-auth-primary/);
    expect(source).toMatch(/clash-auth-alert/);
  });

  it("keeps CLI and daemon authorization routes in Clash auth surfaces instead of generic black setup chrome", () => {
    const source = [
      "apps/web/app/routes/auth.cli.tsx",
      "apps/web/app/routes/connect-daemon.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldDaemonConnectTokens);
    expect(source).toMatch(/clash-auth-panel/);
    expect(source).toMatch(/clash-auth-primary/);
    expect(source).toMatch(/clash-auth-code/);
    expect(source).toMatch(/clash-auth-alert-error/);
  });

  it("keeps local agent setup surfaces aligned with daemon-era Clash chrome", () => {
    const source = [
      "packages/web-ui/src/components/copilot/SessionStartPicker.tsx",
      "packages/web-ui/src/components/copilot/ByoAgentDialog.tsx",
      "packages/web-ui/src/components/ChatbotCopilot.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldLocalAgentSetupTokens);
    expect(source).toMatch(/clash-copilot-primary/);
    expect(source).toMatch(/clash-copilot-code/);
    expect(source).toMatch(/clash-copilot-alert-error/);
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
