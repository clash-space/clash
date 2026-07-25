export const STUDIO_APP_RESOURCE_URI = "ui://clash/studio";
export const STUDIO_APP_MIME_TYPE = "text/html;profile=mcp-app";

export function createStudioAppHtml(bundledJavascript: string): string {
  const safeJavascript = bundledJavascript.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Clash Studio</title>
    <style>
      :root {
        color-scheme: light dark;
        --paper: light-dark(oklch(96.8% .009 73), oklch(20% .012 55));
        --paper-strong: light-dark(oklch(99% .006 73), oklch(24% .012 55));
        --ink: light-dark(oklch(24% .018 55), oklch(93% .012 73));
        --muted: light-dark(oklch(52% .015 55), oklch(70% .015 73));
        --line: color-mix(in oklch, var(--ink) 15%, transparent);
        --coral: light-dark(oklch(64% .19 35), oklch(71% .17 35));
        --success: light-dark(oklch(55% .11 151), oklch(72% .13 151));
      }
      * { box-sizing: border-box; }
      html, body { min-width: 0; min-height: 100%; margin: 0; }
      body {
        color: var(--ink);
        background: var(--paper);
        font-family: "Avenir Next", Avenir, ui-sans-serif, system-ui, sans-serif;
        font-size: 1rem;
        line-height: 1.5;
        font-kerning: normal;
      }
      button { min-height: 44px; color: inherit; font: inherit; }
      button:focus-visible { outline: 2px solid var(--coral); outline-offset: 3px; }
      [data-app-shell] {
        container-type: inline-size;
        min-height: 420px;
        padding: max(1.25rem, env(safe-area-inset-top)) max(1.25rem, env(safe-area-inset-right)) max(1.5rem, env(safe-area-inset-bottom)) max(1.25rem, env(safe-area-inset-left));
      }
      [data-masthead] { display: grid; gap: 1.5rem; border-bottom: 1px solid var(--line); padding-bottom: 1.5rem; }
      [data-kicker] { margin: 0 0 .35rem; color: var(--coral); font-size: .75rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
      h1 { margin: 0; font-family: "Iowan Old Style", "Palatino Linotype", ui-serif, serif; font-size: clamp(2.25rem, 9cqi, 5.5rem); font-weight: 500; letter-spacing: -.055em; line-height: .92; }
      [data-host] { display: grid; align-content: end; gap: .25rem; }
      [data-host-status] { display: flex; align-items: center; gap: .5rem; font-weight: 650; }
      [data-host-status]::before { width: .55rem; height: .55rem; border-radius: 50%; background: var(--muted); content: ""; }
      [data-host-status][data-state="active"]::before { background: var(--success); }
      [data-host-endpoint] { color: var(--muted); font-size: .875rem; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      [data-actions] { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .65rem; }
      [data-actions] button { border: 1px solid var(--line); border-radius: .45rem; padding: .6rem .85rem; background: transparent; cursor: pointer; }
      [data-actions] button:hover { border-color: var(--coral); background: color-mix(in oklch, var(--coral) 8%, transparent); }
      [data-mode-switcher] { display: flex; gap: .15rem; }
      [data-mode-switcher] button { border-color: transparent; color: var(--muted); }
      [data-display-mode="inline"] [data-mode="inline"], [data-display-mode="fullscreen"] [data-mode="fullscreen"] { color: var(--coral); }
      [data-projects] { padding-top: 1.5rem; }
      [data-projects-header] { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
      h2 { margin: 0; font-size: .875rem; letter-spacing: .11em; text-transform: uppercase; }
      [data-project-count] { color: var(--muted); font-size: .875rem; font-variant-numeric: tabular-nums; }
      [data-project-list] { margin: 1rem 0 0; padding: 0; list-style: none; border-top: 1px solid var(--line); }
      [data-project-row] { display: grid; grid-template-columns: 3rem minmax(0, 1fr) minmax(8rem, auto); gap: 1rem; align-items: baseline; padding: 1rem .15rem; border-bottom: 1px solid var(--line); }
      [data-project-index] { color: var(--coral); font-size: .75rem; font-variant-numeric: tabular-nums; }
      [data-project-name] { font-size: 1.125rem; font-weight: 650; letter-spacing: -.018em; }
      [data-project-id] { color: var(--muted); font-size: .75rem; text-align: right; overflow-wrap: anywhere; }
      [data-empty] { margin: 2rem 0; max-width: 42ch; color: var(--muted); }
      [data-guidance] { margin: 1.5rem 0 0; max-width: 62ch; color: var(--muted); font-size: .875rem; }
      [data-status] { display: block; min-height: 1.5rem; margin-top: 1rem; color: var(--muted); font-size: .875rem; }
      @container (min-width: 44rem) {
        [data-masthead] { grid-template-columns: minmax(0, 1.4fr) minmax(16rem, .6fr); align-items: end; min-height: 15rem; }
      }
      @container (max-width: 32rem) {
        [data-project-row] { grid-template-columns: 2rem minmax(0, 1fr); }
        [data-project-id] { grid-column: 2; text-align: left; }
      }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; } }
    </style>
  </head>
  <body>
    <main data-app-shell data-display-mode="inline">
      <header data-masthead>
        <div><p data-kicker>Local creative host</p><h1>Clash Studio</h1></div>
        <div data-host>
          <div data-host-status data-state="inactive">Checking host</div>
          <div data-host-endpoint>Open Clash Desktop or start local-api.</div>
          <div data-actions>
            <button type="button" data-refresh>Refresh</button>
            <div data-mode-switcher aria-label="Display mode">
              <button type="button" data-mode="inline">Inline</button>
              <button type="button" data-mode="fullscreen">Full</button>
            </div>
          </div>
        </div>
      </header>
      <section data-projects aria-labelledby="projects-title">
        <div data-projects-header><h2 id="projects-title">Projects</h2><span data-project-count>0 projects</span></div>
        <ol data-project-list></ol>
        <p data-empty hidden>No local projects yet. Create one through Codex or Clash Desktop.</p>
        <p data-guidance>Ask Codex to open a Canvas, Timeline, or Director Stage. Each opens as a focused Clash App backed by this host.</p>
      </section>
      <output data-status aria-live="polite"></output>
    </main>
    <script type="module">${safeJavascript}</script>
  </body>
</html>`;
}
