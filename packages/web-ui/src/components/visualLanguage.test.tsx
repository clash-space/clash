// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import BillingClient from "./BillingClient";
import MarketplaceClient from "./MarketplaceClient";
import SettingsClient from "./SettingsClient";

import { sourceContains, sourceMatches } from "../test-support/source-match";
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
  listModelCatalog: vi.fn(),
  listModelProviders: vi.fn(async () => []),
  updateModelProviders: vi.fn(),
  listProviderOAuth: vi.fn(async () => []),
  listPluginProviders: vi.fn(async () => []),
  startProviderOAuth: vi.fn(),
  completeProviderOAuth: vi.fn(),
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
    expect(sourceMatches(source, /clash-marketplace-filter-active/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-marketplace-primary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-marketplace-installed/), "mechanism missing").toBe(true);
  });

  it("keeps user account sign-in actions on Clash brand surfaces instead of generic black auth chrome", () => {
    const source = [
      "packages/web-ui/src/components/UserControls.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldUserAccountActionTokens);
    expect(sourceMatches(source, /clash-user-primary/), "mechanism missing").toBe(true);
  });

  it("keeps the project chrome avatar transparent instead of sitting on a white surface", () => {
    const cssSource = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");
    const avatarRule = cssSource.match(/\.clash-project-top-avatar\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const avatarHoverRule = cssSource.match(/\.clash-project-top-avatar:hover\s*\{[\s\S]*?\}/)?.[0] ?? "";

    expect(sourceMatches(cssSource, /\.clash-project-top-action,\s*\n\.clash-project-top-balance,\s*\n\.clash-project-top-avatar/), "must not reappear").toBe(false);
    expect(sourceMatches(avatarRule, /background:\s*transparent/)).toBe(true);
    expect(sourceMatches(avatarRule, /box-shadow:\s*none/)).toBe(true);
    expect(sourceMatches(avatarHoverRule, /background:\s*transparent/)).toBe(true);
    expect(sourceMatches(avatarHoverRule, /box-shadow:\s*none/)).toBe(true);
  });

  it("caps the desktop copilot panel at three sevenths of the viewport", () => {
    // The cap lives in `copilotPanelLayout.ts`, which owns the clamp and has its own
    // behaviour test. This suite previously looked for a `MAX_COPILOT_PANEL_FRACTION`
    // in ProjectEditor and ChatbotCopilot -- a name that appeared in no source file at
    // all, so the assertion described a design that was never built.
    const layoutSource = readFileSync(join(process.cwd(), "packages/web-ui/src/components/copilotPanelLayout.ts"), "utf8");

    expect(sourceMatches(layoutSource, /const COPILOT_PANEL_MAX_WIDTH_FRACTION = 3 \/ 7/), "mechanism missing").toBe(true);
    expect(sourceMatches(layoutSource, /2 \/ 3/), "must not reappear").toBe(false);
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
    expect(sourceMatches(source, /clash-billing-primary/), "mechanism missing").toBe(true);
  });

  it("keeps chat input errors and send controls on Clash surfaces instead of black and hard-red chrome", () => {
    const source = [
      "packages/web-ui/src/components/copilot/ChatInput.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldChatInputActionTokens);
    expect(sourceMatches(source, /clash-chat-input-alert-error/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-chat-input-primary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-chat-input-stop/), "mechanism missing").toBe(true);
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
    expect(sourceMatches(source, /clash-node-primary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-node-alert-error/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-node-row-error/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-node-danger-ghost/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-node-badge-draft/), "mechanism missing").toBe(true);
  });

  it("uses the transparent Clash mark for the browser tab favicon", () => {
    const favicon = readFileSync(join(process.cwd(), "apps/web/public/favicon.svg"), "utf8");
    const mark = readFileSync(join(process.cwd(), "apps/web/public/brand/logo-mark.svg"), "utf8");

    expect(favicon).toBe(mark);
    expect(sourceMatches(favicon, /<rect\s+width="512"\s+height="512"|fill="#F7F6F2"|fill="#FBFAF7"/)).toBe(false);
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
    // A count is the wrong contract: it drifts whenever a node gains or loses a
    // button, and `TextNode` legitimately has no primary action at all. What must hold
    // is that a node with a primary action styles it with the shared token rather than
    // a hand-rolled dark button.
    expect(source).toMatch(/clash-node-primary/);
  });

  it("keeps ActionBadge canvas controls on warm and brand tokens", () => {
    const sourcePath = join(process.cwd(), "packages/web-ui/src/components/nodes/ActionBadge.tsx");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toMatch(oldCanvasControlTokens);
    expect(sourceMatches(source, /brand|warm|stone|slate/), "mechanism missing").toBe(true);
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
    expect(sourceMatches(source, /clash-node-choice-active/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-node-ref-index/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-node-ref-remove/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-node-primary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /!bg-brand/), "mechanism missing").toBe(true);
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
    expect(sourceMatches(source, /clash-copilot-primary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-copilot-alert-error/), "mechanism missing").toBe(true);
  });

  it("moves the collapsed project avatar between Canvas and the production header", () => {
    const projectSource = readFileSync(join(process.cwd(), "packages/web-ui/src/components/ProjectEditor.tsx"), "utf8");
    const copilotSource = readFileSync(join(process.cwd(), "packages/web-ui/src/components/ChatbotCopilot.tsx"), "utf8");
    const cssSource = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");
    const launcherRule = cssSource.match(/\.clash-copilot-launcher\s*\{[\s\S]*?\}/)?.[0] ?? "";

    expect(sourceMatches(projectSource, /aria-label="Clash home"|<Link to="\/"/), "must not reappear").toBe(false);
    expect(sourceMatches(projectSource, /id="editor-header"/), "mechanism missing").toBe(true);
    expect(sourceMatches(projectSource, /clash-project-sidebar-header/), "mechanism missing").toBe(true);
    expect(sourceMatches(projectSource, /id="editor-header" className="absolute/), "must not reappear").toBe(false);
    expect(sourceMatches(projectSource, /clash-project-return-button/), "mechanism missing").toBe(true);
    expect(sourceMatches(projectSource, /<form\s+className="min-w-0 flex-1"/), "mechanism missing").toBe(true);
    expect(sourceMatches(projectSource, /clash-project-name-input h-8 w-full/), "mechanism missing").toBe(true);
    expect(sourceMatches(projectSource, /id="project-top-actions"/), "must not reappear").toBe(false);
    expect(sourceMatches(projectSource, /topActionsRight/), "must not reappear").toBe(false);
    expect(sourceMatches(projectSource, /resolveProjectShareAdmission|resolveProjectWebAdmission/), "must not reappear").toBe(false);
    expect(sourceMatches(projectSource, /<PresenceBar clients=\{otherClients\} \/>/), "must not reappear").toBe(false);
    expect(sourceMatches(projectSource, /footer=\{<UserControls compact \/>\}/), "mechanism missing").toBe(true);
    expect(sourceMatches(projectSource, /MonitorPlay|isPresentationMode|Present canvas|Presenting/), "must not reappear").toBe(false);
    expect(sourceMatches(copilotSource, /clash-copilot-launcher/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /bottom-\[max\(1rem,env\(safe-area-inset-bottom\)\)\]/), "mechanism missing").toBe(true);
    expect(sourceMatches(projectSource, /COPILOT_COLLAPSED_RAIL_WIDTH_PX/), "must not reappear").toBe(false);
    // The inset is 40px while the sidebar is collapsed off-canvas, 0 otherwise.
    expect(sourceMatches(
      projectSource,
      /isSidebarCollapsed && workspaceSurface\.kind !== "canvas" \? 40 : 0/,
    ), "mechanism missing").toBe(true);
    expect(sourceContains(projectSource, 'collapsedLauncherPlacement={workspaceSurface.kind === "canvas" ? "canvas" : "header"}'), "mechanism missing").toBe(true);
    expect(sourceContains(projectSource, "headerEndInset={copilotHeaderInset}"), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /AgentMotion/), "mechanism missing").toBe(true);
    expect(sourceContains(copilotSource, 'data-copilot-launcher-placement={collapsedLauncherPlacement}'), "mechanism missing").toBe(true);
    expect(sourceContains(copilotSource, 'layout="position"'), "mechanism missing").toBe(true);
    expect(sourceContains(copilotSource, "COPILOT_LAUNCHER_RELOCATION_TRANSITION"), "mechanism missing").toBe(true);
    expect(sourceContains(copilotSource, "top-[calc(var(--clash-desktop-chrome-height,0px)+0.375rem)]"), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.dark \.clash-copilot-launcher--header \.clash-agent-motion\s*\{[^}]*color: #d6d3d1;/)).toBe(true);
    expect(sourceMatches(cssSource, /\.clash-copilot-launcher--header \.clash-agent-motion__svg\s*\{[^}]*opacity: 0\.9;/)).toBe(true);
    expect(sourceMatches(copilotSource, /clash-copilot-panel-shell fixed z-50/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /clash-copilot-panel-shell fixed z-50 flex flex-col overflow-hidden bg-warm-page/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /clash-copilot-panel-shell--docked bottom-0 right-0 rounded-none/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /bottom-2 right-2 rounded-matrix/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /height: isDocked[\s\S]*?'calc\(100dvh - var\(--clash-desktop-chrome-height, 0px\)\)'[\s\S]*?'calc\(100dvh - var\(--clash-desktop-chrome-height, 0px\) - 1rem\)'/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /rounded-matrix/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /const COPILOT_PANEL_LAUNCHER_FOCAL_OFFSET_PX = 44/), "mechanism missing").toBe(true);
    // The single desktop origin was split in two when the launcher gained a header
    // placement, which is what this test is about: the panel grows from wherever its
    // launcher sits. An unbounded `[\s\S]*?` here also spanned the whole normalized
    // file, so the gap is bounded.
    expect(sourceMatches(copilotSource, /const COPILOT_PANEL_CANVAS_TRANSFORM_ORIGIN =.{0,60}calc\(100% - \$\{COPILOT_PANEL_LAUNCHER_FOCAL_OFFSET_PX\}px\)/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /const COPILOT_PANEL_HEADER_TRANSFORM_ORIGIN = "calc\(100% - 16px\) calc\(0% \+ 14px\)"/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /\? COPILOT_PANEL_HEADER_TRANSFORM_ORIGIN.{0,20}: COPILOT_PANEL_CANVAS_TRANSFORM_ORIGIN/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /transformOrigin: 'right bottom'/), "must not reappear").toBe(false);
    expect(sourceMatches(copilotSource, /const COPILOT_PANEL_COLLAPSE_TRANSITION = \{ duration: 0\.34,[\s\S]*?times: \[0, 0\.52, 1\]/), "mechanism missing").toBe(true);
    // The collapsed state was split alongside the transform origin: the canvas launcher
    // sits bottom-right so the panel drifts toward it (`x: [0, 0, 42]`), while the header
    // launcher is directly above so it collapses in place (`x: 0`). Both keep the same
    // fade and scale curve, and the gap is bounded so the pattern cannot drift across
    // the whole normalized file.
    expect(sourceMatches(copilotSource, /const COPILOT_PANEL_COLLAPSED_CANVAS_STATE = \{.{0,80}x: \[0, 0, 42\]/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /const COPILOT_PANEL_COLLAPSED_HEADER_STATE = \{.{0,80}x: 0, y: 0/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /opacity: \[1, 0\.76, 0\], scale: \[1, 0\.56, 0\.08\]/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /transition=\{isResizing \? \{ duration: 0 \} : isCollapsed && !isMobile \? COPILOT_PANEL_COLLAPSE_TRANSITION : COPILOT_PANEL_TRANSITION\}/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /const COPILOT_LAUNCHER_ENTER_TRANSITION = \{ duration: 0\.24, delay: 0\.12/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /initial=\{\{ opacity: 0, scale: 0\.86, y: 8 \}\}/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /const CREATIVE_STATUS_ROTATION_MS = 15_000/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /setInterval\(\(\) => \{[\s\S]*?\}, CREATIVE_STATUS_ROTATION_MS\)/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /\}, 4600\)/), "must not reappear").toBe(false);
    expect(sourceMatches(copilotSource, /clash-copilot-panel-header/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /clash-copilot-panel-header relative z-20 flex shrink-0 items-center gap-2 px-4 py-3/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /import \{ CopilotRailSlot \} from '\.\/copilot\/CopilotRail'/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /<CopilotRailSlot ariaHidden=\{false\}>[\s\S]*label=\{t\('copilot\.panel\.collapse'\)\}/), "must not reappear").toBe(false);
    expect(sourceMatches(copilotSource, /role="toolbar"[\s\S]*label=\{t\('copilot\.panel\.collapse'\)\}/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /clash-copilot-agent-perch/), "must not reappear").toBe(false);
    expect(sourceMatches(copilotSource, /clash-copilot-agent-activity-row/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /clash-copilot-agent-activity-row flex items-center gap-0\.5 px-0/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /<CopilotRailSlot className="h-8">[\s\S]*<AgentMotion/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /-ml-1\.5/), "must not reappear").toBe(false);
    expect(sourceMatches(copilotSource, /clash-copilot-agent-activity-row[\s\S]*w-5 shrink-0 items-center justify-center/), "must not reappear").toBe(false);
    expect(sourceMatches(copilotSource, /clash-session-config-trigger/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /clash-runtime-prompt-queue/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /AgentMotion[\s\S]*state=\{state\}[\s\S]*className="clash-agent-motion--compact h-6 w-6"[\s\S]*gazeTarget=\{gazeTarget \?\? null\}/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /toolbarAccessory=\{\(/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /AcpAgentLogo/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /embedded/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /relative flex-1 min-h-0 overflow-y-auto/), "mechanism missing").toBe(true);
    // The collapsed target is chosen by launcher placement first, so the animate prop
    // reads a `collapsedDesktopState` variable rather than one fixed constant. The gap
    // is bounded because normalized source is a single line.
    expect(sourceMatches(copilotSource, /isCollapsed \? collapsedDesktopState.{0,10}: COPILOT_PANEL_EXPANDED_DESKTOP_STATE/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /collapsedDesktopState = collapsesIntoHeader \? COPILOT_PANEL_COLLAPSED_HEADER_STATE.{0,10}: COPILOT_PANEL_COLLAPSED_CANVAS_STATE/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /initial=\{\{ opacity: 0, scale: 0\.82/), "must not reappear").toBe(false);
    expect(sourceMatches(copilotSource, /from-warm-surface via-warm-surface\/85/), "must not reappear").toBe(false);
    expect(sourceMatches(copilotSource, /border-l border-warm-border shadow-\[0_18px_50px/), "must not reappear").toBe(false);
    expect(sourceMatches(cssSource, /\.clash-copilot-launcher/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.clash-copilot-panel-shell/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.clash-copilot-panel-shell\s*\{[\s\S]*?border-radius:\s*var\(--clash-workbench-surface-radius\)/), "mechanism missing").toBe(true);
    const panelShellRule = cssSource.match(/\.clash-copilot-panel-shell\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const toolbarSurfaceRule = cssSource.match(/\.clash-canvas-toolbar-surface,[\s\S]*?\.clash-canvas-menu-surface\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const promptQueueRule = cssSource.match(/\.clash-runtime-prompt-queue\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(sourceMatches(panelShellRule, /background:\s*var\(--color-warm-page\)/)).toBe(true);
    expect(sourceMatches(panelShellRule, /linear-gradient|radial-gradient|background-size/)).toBe(false);
    expect(sourceMatches(cssSource, /\.clash-copilot-panel-header\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?border-bottom:\s*0;[\s\S]*?box-shadow:\s*none;/)).toBe(true);
    expect(sourceMatches(promptQueueRule, /linear-gradient\(\s*180deg,\s*rgba\(255, 254, 253, 0\.9\),\s*rgba\(250, 248, 244, 0\.74\)\s*\)/)).toBe(true);
    expect(sourceMatches(promptQueueRule, /border-bottom:\s*0/)).toBe(true);
    expect(sourceMatches(promptQueueRule, /0 -6px 18px rgba\(35, 31, 25, 0\.034\)/)).toBe(true);
    const railSource = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/copilot/CopilotRail.tsx"),
      "utf8",
    );
    expect(sourceMatches(railSource, /COPILOT_RAIL_SLOT_CLASS/)).toBe(true);
    expect(sourceMatches(railSource, /clash-copilot-rail-slot flex h-8 w-8 shrink-0 -translate-x-1 items-center justify-center/)).toBe(true);
    expect(sourceMatches(toolbarSurfaceRule, /background:\s*var\(--clash-floating-toolbar-background\)/)).toBe(true);
    expect(sourceMatches(toolbarSurfaceRule, /linear-gradient|radial-gradient|background-size/)).toBe(false);
    expect(sourceMatches(cssSource, /\.clash-timeline-toolbar-surface\s*\{/), "must not reappear").toBe(false);
    expect(sourceMatches(cssSource, /\.clash-canvas-toolbar-surface::before,[\s\S]*?\.clash-canvas-menu-surface::before\s*\{[\s\S]*?content:\s*none;/)).toBe(true);
    expect(sourceMatches(cssSource, /\.clash-copilot-resize-handle::before/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.clash-project-top-action/), "mechanism missing").toBe(true);
    // Normalized source has no line breaks, so a pattern cannot spell the selector list
    // with `\n`; and each gap is bounded so the match cannot wander into another rule.
    expect(sourceMatches(cssSource, /\.clash-project-return-button,\.clash-project-name-input \{.{0,20}border: 0;.{0,20}background: transparent;.{0,20}box-shadow: none;/)).toBe(true);
    expect(sourceMatches(cssSource, /\.clash-project-name-input:focus\s*\{[\s\S]*?inset 0 -2px 0 rgba\(255, 107, 80, 0\.34\)/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.clash-project-top-action-active/), "must not reappear").toBe(false);
    expect(sourceMatches(launcherRule, /border:\s*0/)).toBe(true);
    expect(sourceMatches(launcherRule, /background:\s*transparent/)).toBe(true);
    expect(sourceMatches(launcherRule, /box-shadow:\s*none/)).toBe(true);
  });

  it("aligns the floating Copilot to the shared 8px workbench grid", () => {
    const copilotSource = readFileSync(join(process.cwd(), "packages/web-ui/src/components/ChatbotCopilot.tsx"), "utf8");

    expect(sourceMatches(copilotSource, /bottom-2 right-2 rounded-matrix/), "mechanism missing").toBe(true);
    expect(sourceContains(copilotSource, "calc(100dvh - var(--clash-desktop-chrome-height, 0px) - 1rem)"), "mechanism missing").toBe(true);
  });

  it("keeps the Clash agent eyes pointer-reactive without rerender-heavy motion", () => {
    const agentSource = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/copilot/AgentMotion.tsx"),
      "utf8",
    );
    const cssSource = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");

    expect(sourceMatches(agentSource, /\.\.\/ui\/gesture/)).toBe(true);
    expect(sourceMatches(agentSource, /useMoveGesture/)).toBe(true);
    expect(sourceMatches(agentSource, /addEventListener\('pointermove'/)).toBe(false);
    expect(sourceMatches(agentSource, /requestAnimationFrame/)).toBe(true);
    expect(sourceMatches(agentSource, /prefers-reduced-motion: reduce/)).toBe(true);
    expect(sourceMatches(agentSource, /--clash-agent-eye-x/)).toBe(true);
    expect(sourceMatches(agentSource, /data-agent-motion-tracking/)).toBe(true);
    expect(sourceMatches(cssSource, /\.clash-agent-motion\[data-agent-motion-tracking="true"\]\s+\.clash-agent-motion__gaze/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /transform:\s*translate3d\(var\(--clash-agent-eye-x\), var\(--clash-agent-eye-y\), 0\)/), "mechanism missing").toBe(true);
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
    expect(sourceMatches(source, /brand|warm|stone|slate/), "mechanism missing").toBe(true);
  });

  it("keeps the homepage depth mask transparent enough for the canvas grid to read", () => {
    const backgroundSource = readFileSync(join(process.cwd(), "packages/web-ui/src/components/Background.tsx"), "utf8");
    const cssSource = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");

    expect(sourceMatches(backgroundSource, /to-warm-page\/\[(0\.025|0\.012|0\.006|0\.003|0\.0015)\]/)).toBe(false);
    expect(sourceMatches(backgroundSource, /to-warm-page\/\[0\.0008\]/)).toBe(true);
    expect(sourceMatches(backgroundSource, /opacity: 0\.38/)).toBe(true);
    expect(sourceMatches(cssSource, /#f7f6f2|#d8d5cf|#f1efea/), "must not reappear").toBe(false);
    expect(sourceMatches(cssSource, /--color-warm-page: var\(--clash-warm-page\)/), "mechanism missing").toBe(true);
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

    expect(sourceMatches(source, /HeroCanvasPreview|clash-home-canvas-preview|clash-home-preview-node|Agent drafting|Neon rain/), "must not reappear").toBe(false);
    expect(sourceMatches(source, /variant="hero"/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-hero-stage/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-hero-prompt/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /lg:pl-(12|16)|xl:pl-(12|16)/), "must not reappear").toBe(false);
    expect(sourceMatches(source, /\/brand\/logo-mark-animated\.svg/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-dashboard-shell/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-projects-empty-workbench/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-projects-empty-canvas/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-projects-empty-edge/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-projects-empty-node--agent/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-home-preview-edge-flow/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-projects-empty-node--wide|clash-projects-empty-node--small|clash-projects-empty-node--accent/), "must not reappear").toBe(false);
  });

  it("keeps the authenticated home hero headline bounded inside the first viewport", () => {
    const heroSource = readFileSync(join(process.cwd(), "packages/web-ui/src/components/HeroSection.tsx"), "utf8");
    const cssSource = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");

    expect(sourceMatches(heroSource, /clash-home-hero-heading/)).toBe(true);
    expect(sourceMatches(heroSource, /clash-home-hero/)).toBe(true);
    expect(sourceMatches(heroSource, /clash-home-hero-copy/)).toBe(true);
    expect(sourceMatches(heroSource, /clash-home-hero-copy[\s\S]*<\/motion\.h1>[\s\S]*<\/div>\s*<div className="clash-hero-prompt"/)).toBe(true);
    expect(sourceMatches(cssSource, /\.clash-home-hero-heading\s*\{/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.clash-home-hero\s*\{[\s\S]*100dvh[\s\S]*\}/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.clash-home-hero\s+\.clash-hero-stage\s*\{[\s\S]*min-height:\s*auto/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.clash-home-hero\s+\.clash-hero-stage\s*\{[\s\S]*align-items:\s*center/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.clash-hero-prompt\s*\{[\s\S]*width:\s*min\(100%,\s*72rem\)[\s\S]*margin-inline:\s*auto/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /max-width:\s*min\(100%,\s*62rem\)/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /font-size:\s*clamp\(3\.25rem,\s*7\.6vw,\s*8rem\)/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /overflow-wrap:\s*normal/), "mechanism missing").toBe(true);
  });

  it("keeps the landing capability section out of generic icon-card grid patterns", () => {
    const source = readFileSync(join(process.cwd(), "packages/web-ui/src/components/landing/FeatureGrid.tsx"), "utf8");
    const cssSource = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");

    expect(sourceMatches(source, /clash-landing-capability-rail/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-landing-capability-row/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.clash-landing-capability-rail/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /lg:grid-cols-3/), "must not reappear").toBe(false);
    expect(sourceMatches(source, /rounded-2xl border border-warm-border\/80 bg-warm-surface\/80 p-7/), "must not reappear").toBe(false);
  });

  it("keeps the landing use cases as a matrix instead of same-sized cards", () => {
    const source = readFileSync(join(process.cwd(), "packages/web-ui/src/components/landing/UseCases.tsx"), "utf8");
    const cssSource = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");

    expect(sourceMatches(source, /clash-landing-usecase-matrix/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-landing-usecase-row--lead/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.clash-landing-usecase-matrix/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /lg:grid-cols-3/), "must not reappear").toBe(false);
    expect(sourceMatches(source, /rounded-2xl border border-warm-border\/80 bg-warm-surface\/88 p-8/), "must not reappear").toBe(false);
  });

  it("keeps landing modes as a ledger instead of pricing cards", () => {
    const source = readFileSync(join(process.cwd(), "packages/web-ui/src/components/landing/Pricing.tsx"), "utf8");
    const cssSource = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");

    expect(sourceMatches(source, /clash-landing-mode-ledger/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-landing-mode-row--emphasis/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.clash-landing-mode-ledger/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /lg:grid-cols-3/), "must not reappear").toBe(false);
    expect(sourceMatches(source, /rounded-2xl p-8|scale-\[1\.02\]|shadow-\[0_18px_42px/), "must not reappear").toBe(false);
  });

  it("keeps landing field notes as an editorial ledger instead of blog cards", () => {
    const source = readFileSync(join(process.cwd(), "packages/web-ui/src/components/landing/BlogPreview.tsx"), "utf8");
    const cssSource = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");

    expect(sourceMatches(source, /clash-landing-note-ledger/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-landing-note-path/), "mechanism missing").toBe(true);
    expect(sourceMatches(cssSource, /\.clash-landing-note-ledger/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-blog-preview-canvas/), "must not reappear").toBe(false);
    expect(sourceMatches(source, /lg:grid-cols-3|md:grid-cols-2/), "must not reappear").toBe(false);
    expect(sourceMatches(source, /rounded-2xl border border-warm-border\/80 bg-warm-surface\/88/), "must not reappear").toBe(false);
  });

  it("keeps the public landing page free of the retired hero mock", () => {
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

    // This suite used to pin twenty-odd marketing strings verbatim, including several
    // ("Workspace where", "and Creators", "Co-create.") that no landing file contained
    // -- copy had moved on and the assertions had not. Pinned copy is a ratchet: it
    // makes an editorial change look like a regression while catching nothing.
    //
    // What is worth locking is the removal: a fake canvas preview with invented project
    // names once stood in for the product on the public page. Asserting its absence
    // keeps the deletion an invariant instead of a gap.
    expect(sourceMatches(source, /HeroCanvasPreview|Agent drafting|Scene rhythm|Shot pass|Neon rain/), "retired hero mock must not reappear").toBe(false);
    expect(sourceMatches(source, /variant="hero"/), "retired hero variant must not reappear").toBe(false);
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
    expect(sourceMatches(source, /brand|warm|stone|slate/), "mechanism missing").toBe(true);
  });

  it("keeps collaborative cursor colours out of AI-blue/purple palette drift", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/hooks/usePresenceAwareness.ts"),
      "utf8",
    );

    expect(source).not.toMatch(oldAwarenessPaletteTokens);
    expect(sourceMatches(source, /coral|ember|moss|slate/), "mechanism missing").toBe(true);
  });

  it("keeps the video clipper timeline controls out of blue/purple editor chrome", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/VideoClipperContext.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(oldVideoClipperTokens);
    expect(sourceMatches(source, /brand|warm|slate/), "mechanism missing").toBe(true);
  });

  it("keeps editor modal shells on Clash surface classes instead of generic dark overlays", () => {
    const source = [
      "packages/web-ui/src/components/ImageEditorContext.tsx",
      "packages/web-ui/src/components/VideoClipperContext.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldEditorModalShellTokens);
    expect(sourceMatches(source, /clash-editor-modal-backdrop/), "mechanism missing").toBe(true);
    expect(readFileSync(join(process.cwd(), "packages/web-ui/src/components/VideoEditorContext.tsx"), "utf8"))
      .not.toMatch(/EditorModalDialog|clash-editor-modal-backdrop/);
    expect(sourceMatches(source, /clash-editor-modal-surface/), "mechanism missing").toBe(true);
  });

  it("keeps the media viewer in Clash media surfaces instead of generic black lightbox chrome", () => {
    const source = [
      "packages/web-ui/src/components/MediaViewer.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldMediaViewerTokens);
    expect(sourceMatches(source, /clash-media-viewer-backdrop/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-media-viewer-frame/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-media-viewer-chrome/), "mechanism missing").toBe(true);
  });

  it("keeps confirm dialogs in Clash dialog surfaces instead of generic slate overlays", () => {
    const source = [
      "packages/web-ui/src/components/ConfirmDialog.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldConfirmDialogTokens);
    expect(sourceMatches(source, /clash-confirm-dialog-backdrop/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-confirm-dialog-surface/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-confirm-dialog-footer/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-confirm-primary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-confirm-secondary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-confirm-danger/), "mechanism missing").toBe(true);
  });

  it("keeps the root error boundary transparent and recoverable instead of generic copy", () => {
    const source = readFileSync(join(process.cwd(), "apps/web/app/root.tsx"), "utf8");
    const errorMark = readFileSync(join(process.cwd(), "apps/web/public/brand/logo-mark-error.svg"), "utf8");

    expect(source).not.toMatch(oldRouteErrorTokens);
    expect(sourceMatches(source, /clash-route-error-surface/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-route-error-primary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-route-error-secondary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-route-error-detail/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /Clash could not finish this view/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /error\.code/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /Reload/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /Go home/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /\/brand\/logo-mark-error\.svg/), "mechanism missing").toBe(true);
    expect(sourceMatches(errorMark, /aria-label="Clash error logo"/)).toBe(true);
    expect(errorMark.match(/stroke-linecap="round"/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps settings modal chrome in Clash surfaces instead of inherited generic modal styling", () => {
    const source = [
      "packages/web-ui/src/components/SettingsSurface.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldSettingsDialogTokens);
    expect(sourceMatches(source, /clash-settings-dialog-shell/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-settings-dialog-sidebar/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-settings-dialog-content/), "mechanism missing").toBe(true);
  });

  it("keeps settings actions, alerts, and setup command surfaces out of generic black and hard-red chrome", () => {
    const source = [
      "packages/web-ui/src/components/SettingsClient.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldSettingsActionTokens);
    expect(sourceMatches(source, /clash-settings-primary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-settings-code/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-settings-alert-error/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-settings-danger-ghost/), "mechanism missing").toBe(true);
  });

  it("keeps settings form controls on shared field and menu tokens", () => {
    const source = [
      "packages/web-ui/src/components/SettingsClient.tsx",
      "packages/web-ui/src/components/ui/select.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(sourceMatches(source, /<select\b/), "must not reappear").toBe(false);
    expect(sourceMatches(source, /clash-settings-field/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-settings-secondary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-settings-select-trigger/), "mechanism missing").toBe(true);
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
    expect(sourceMatches(source, /clash-project-create-tile/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-project-card-frame/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-project-card-empty/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /useConfirm/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-project-card-delete/), "mechanism missing").toBe(true);
  });

  it("keeps the new-project trigger visually unboxed", () => {
    const tileSource = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/ProjectCreateTile.tsx"),
      "utf8",
    );
    const cardSource = readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/ProjectCard.tsx"),
      "utf8",
    );
    const cssSource = readFileSync(
      join(process.cwd(), "apps/web/app/globals.css"),
      "utf8",
    );
    const tileRule = cssSource.match(
      /\.clash-project-create-tile\s*\{([^}]*)\}/,
    )?.[1];
    // Narrow before asserting on it, so a missing rule reports itself rather than
    // silently passing an undefined body to every check below.
    expect(tileRule, ".clash-project-create-tile rule must exist").toBeDefined();

    expect(sourceContains(tileSource, "./ui/dialog")).toBe(true);
    expect(sourceMatches(tileSource, /clash-project-create-tile[\s\S]*rounded-none/)).toBe(true);
    expect(sourceMatches(tileSource, /clash-project-create-icon/)).toBe(false);
    expect(sourceMatches(cardSource, /clash-project-card-frame[\s\S]*rounded-2xl/)).toBe(true);
    expect(sourceMatches(tileRule!, /border:\s*0/)).toBe(true);
    expect(sourceMatches(tileRule!, /background:\s*transparent/)).toBe(true);
    expect(sourceMatches(tileRule!, /box-shadow:\s*none/)).toBe(true);
    expect(sourceMatches(cssSource, /\.clash-project-create-tile::(before|after)/), "must not reappear").toBe(false);
  });

  it("keeps the login route in Clash auth surfaces instead of generic black auth buttons", () => {
    const source = [
      "apps/web/app/routes/login.tsx",
      "apps/web/app/globals.css",
    ]
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(oldAuthRouteTokens);
    expect(sourceMatches(source, /clash-auth-panel/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-auth-input/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-auth-primary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-auth-alert/), "mechanism missing").toBe(true);
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
    expect(sourceMatches(source, /clash-auth-panel/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-auth-primary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-auth-code/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-auth-alert-error/), "mechanism missing").toBe(true);
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
    expect(sourceMatches(source, /clash-copilot-primary/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-copilot-code/), "mechanism missing").toBe(true);
    expect(sourceMatches(source, /clash-copilot-alert-error/), "mechanism missing").toBe(true);
  });

  it("keeps the cloud agent temporarily marked as coming soon", () => {
    const copilotSource = readFileSync(join(process.cwd(), "packages/web-ui/src/components/ChatbotCopilot.tsx"), "utf8");
    const enLocale = readFileSync(join(process.cwd(), "apps/web/app/locales/en.json"), "utf8");

    expect(sourceMatches(copilotSource, /useState<'cloud' \| 'runtime'>\('runtime'\)/), "mechanism missing").toBe(true);
    expect(sourceMatches(copilotSource, /label=\{t\('copilot\.runtime\.cloud\.label'\)\}[\s\S]*disabled/), "mechanism missing").toBe(true);
    expect(sourceMatches(enLocale, /"label": "Cloud Agent"/)).toBe(true);
    expect(sourceMatches(enLocale, /"sub": "Coming soon"/)).toBe(true);
  });

  it.each([
    ["tokens", "API Tokens"],
    ["providers", "BYOK"],
    ["actions", "Installed Actions"],
    ["skills", "Installed Skills"],
    ["cli", "CLI"],
    ["agents", "Agents"],
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
    expect(container.querySelector('[class*="data-[state=checked]:border-brand"][class*="data-[state=checked]:bg-brand/10"]')).toBeTruthy();
  });
});
