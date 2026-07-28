import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../..");
const textEditorSource = readFileSync(
  resolve(root, "packages/web-ui/src/components/TextDocumentEditorSurface.tsx"),
  "utf8",
);
const globalCss = readFileSync(
  resolve(root, "apps/web/app/globals.css"),
  "utf8",
);

describe("Text document editor design tokens", () => {
  it("uses the shared Project chrome rhythm for its route header and controls", () => {
    expect(textEditorSource).toContain(
      "h-[var(--clash-project-sidebar-header-height,2.5rem)]",
    );
    expect(textEditorSource).toContain("clash-project-chrome-header-content");
    expect(textEditorSource).toContain(
      "gap-[var(--clash-control-gap,0.25rem)]",
    );
    expect(textEditorSource).toContain("clash-workbench-control-button");
    expect(textEditorSource).toContain(
      "h-[var(--clash-project-control-height,2rem)]",
    );
    expect(textEditorSource).toContain('label="Back to Canvas"');
    expect(textEditorSource).not.toContain('label="Close text editor"');
    expect(textEditorSource).toContain("TEXT_AUTOSAVE_DELAY_MS = 500");
    expect(textEditorSource).toContain("Saving…");
    expect(textEditorSource).toContain("Saved");
    expect(textEditorSource).not.toContain('label="Save"');
    expect(textEditorSource).toContain('aria-live="polite"');
    expect(textEditorSource).not.toContain(
      'className="hidden shrink-0 items-center gap-[var(--clash-control-gap,0.25rem)] text-xs text-content-muted sm:flex"',
    );
    expect(textEditorSource).not.toContain("<TextT");
    expect(
      textEditorSource.indexOf("<RevisionHistoryBadge"),
    ).toBeGreaterThan(
      textEditorSource.indexOf('aria-label="Text formatting"'),
    );
    expect(textEditorSource.indexOf("<RevisionHistoryBadge")).toBeLessThan(
      textEditorSource.indexOf('aria-live="polite"'),
    );
    expect(textEditorSource).not.toContain("border-b border-warm-border");
    expect(textEditorSource).not.toContain("h-10 shrink-0");
    expect(textEditorSource).not.toContain("h-7 min-h-7 rounded-md");
  });

  it("uses the shared workbench panel and semantic document tokens", () => {
    expect(textEditorSource).toContain("clash-workbench-panel-surface");
    expect(textEditorSource).toContain(
      "pl-[var(--clash-project-chrome-gutter,0.5rem)] pr-0",
    );
    expect(textEditorSource).toContain("onContextMenu");
    expect(textEditorSource).not.toContain("onPointerUp");
    expect(textEditorSource).not.toContain("max-w-[56rem]");
    expect(textEditorSource).not.toContain("text-[2.25rem]");

    expect(globalCss).toMatch(/--clash-document-reading-width:\s*65ch/);
    expect(globalCss).toMatch(/--clash-document-page-inline-gutter:\s*clamp\(/);
    expect(globalCss).toMatch(
      /\.clash-workbench-panel-surface,[\s\S]*?border-radius:\s*var\(--clash-workbench-surface-radius\)/,
    );
    expect(globalCss).toMatch(
      /\.clash-text-node-title-shell\s*\{[\s\S]*?width:\s*min\(100%, var\(--clash-document-reading-width\)\)/,
    );
  });
});
