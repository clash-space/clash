export const TIMELINE_APP_RESOURCE_URI = "ui://clash/timeline";
export const TIMELINE_APP_MIME_TYPE = "text/html;profile=mcp-app";

export function createTimelineAppHtml(bundledJavascript: string): string {
  const safeJavascript = bundledJavascript.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Clash Timeline</title>
    <style>
      :root {
        color-scheme: light dark;
        --paper: light-dark(oklch(97% .012 78), oklch(20% .012 58));
        --paper-raised: light-dark(oklch(99% .009 78), oklch(24% .014 58));
        --ink: light-dark(oklch(25% .018 56), oklch(92% .013 76));
        --muted: light-dark(oklch(51% .018 62), oklch(70% .016 70));
        --line: light-dark(oklch(86% .018 73), oklch(34% .016 60));
        --coral: light-dark(oklch(64% .18 34), oklch(72% .16 38));
        --coral-soft: color-mix(in oklch, var(--coral) 14%, var(--paper));
        --focus: light-dark(oklch(50% .19 34), oklch(79% .16 38));
        --success: light-dark(oklch(48% .11 145), oklch(73% .13 145));
        --danger: light-dark(oklch(52% .18 25), oklch(72% .16 25));
        --track-effect: oklch(68% .13 320);
        --track-text: oklch(69% .13 78);
        --track-visual: oklch(66% .14 34);
        --track-audio: oklch(66% .12 155);
        --font-display: "Iowan Old Style", "Palatino Linotype", Palatino, serif;
        --font-body: "Avenir Next", Avenir, "Helvetica Neue", sans-serif;
        --font-data: "SFMono-Regular", Consolas, monospace;
      }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; }
      body {
        overflow: hidden;
        color: var(--ink);
        background: var(--paper);
        font-family: var(--font-body);
        font-size: 1rem;
        line-height: 1.5;
        font-kerning: normal;
      }
      button, input, select { color: inherit; font: inherit; }
      button, input, select { min-height: 2.75rem; }
      button { cursor: pointer; }
      button:disabled { cursor: not-allowed; opacity: .46; }
      button:focus-visible, input:focus-visible, select:focus-visible {
        outline: 2px solid var(--focus);
        outline-offset: 2px;
      }
      [data-app-shell] {
        container: timeline-app / inline-size;
        display: grid;
        grid-template-rows: auto 1fr;
        width: 100%;
        height: 100%;
        min-height: 31rem;
      }
      [data-topbar] {
        display: grid;
        grid-template-columns: minmax(10rem, .8fr) minmax(15rem, 1.6fr) auto;
        align-items: center;
        gap: 1rem;
        min-height: 4.5rem;
        padding: .75rem clamp(1rem, 3vw, 2.25rem);
        border-bottom: 1px solid var(--line);
        background: var(--paper-raised);
      }
      [data-brand] { display: flex; align-items: baseline; gap: .7rem; min-width: 0; }
      [data-brand] strong {
        font-family: var(--font-display);
        font-size: 1.5rem;
        font-weight: 600;
        letter-spacing: -.035em;
      }
      [data-brand] span, [data-meta], [data-status] {
        color: var(--muted);
        font-family: var(--font-data);
        font-size: .75rem;
        font-variant-numeric: tabular-nums;
      }
      [data-workspace-field] { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: .7rem; }
      [data-workspace-field] label { color: var(--muted); font-size: .75rem; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }
      input, select {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: .45rem;
        padding: .55rem .7rem;
        background: var(--paper);
      }
      [data-top-actions] { display: flex; align-items: center; justify-content: flex-end; gap: .4rem; }
      button {
        border: 1px solid transparent;
        border-radius: .45rem;
        padding: .55rem .85rem;
        background: transparent;
      }
      button:hover { background: color-mix(in oklch, var(--ink) 6%, transparent); }
      [data-primary] { color: var(--paper-raised); background: var(--coral); font-weight: 700; }
      [data-primary]:hover { background: color-mix(in oklch, var(--coral) 88%, var(--ink)); }
      [data-secondary] { border-color: var(--line); background: var(--paper-raised); }
      [data-workspace] {
        display: grid;
        grid-template-columns: minmax(14rem, 17rem) minmax(26rem, 1fr) minmax(15rem, 19rem);
        min-height: 0;
      }
      [data-sidebar], [data-inspector] {
        min-height: 0;
        overflow: auto;
        background: var(--paper-raised);
      }
      [data-sidebar] { border-right: 1px solid var(--line); }
      [data-inspector] { border-left: 1px solid var(--line); }
      [data-panel-heading] { padding: 1.5rem 1.25rem .75rem; }
      [data-panel-heading] h2 { margin: 0; font-family: var(--font-display); font-size: 1.25rem; letter-spacing: -.025em; }
      [data-panel-heading] p { margin: .25rem 0 0; color: var(--muted); font-size: .875rem; }
      [data-create-timeline] {
        display: grid;
        gap: .65rem;
        margin: .75rem 1.25rem 1.25rem;
        padding-bottom: 1.25rem;
        border-bottom: 1px solid var(--line);
      }
      [data-form-row] { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
      [data-create-timeline] label, [data-track-form] label, [data-inspector] label {
        display: grid;
        gap: .3rem;
        color: var(--muted);
        font-size: .75rem;
        font-weight: 650;
      }
      [data-timeline-list] { display: grid; padding: 0 .65rem 1.5rem; }
      [data-timeline-row] {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: .5rem;
        width: 100%;
        min-height: 3.7rem;
        padding: .65rem;
        text-align: left;
        border-radius: .35rem;
      }
      [data-timeline-row][aria-current="true"] { background: var(--coral-soft); }
      [data-timeline-name] { overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
      [data-scope] { color: var(--muted); font-size: .75rem; }
      [data-editor] { position: relative; min-width: 0; min-height: 0; overflow: auto; }
      [data-editor-header] {
        position: sticky;
        z-index: 4;
        top: 0;
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 1rem;
        min-height: 7.5rem;
        padding: 1.5rem clamp(1.25rem, 3vw, 2.5rem) 1.25rem;
        border-bottom: 1px solid var(--line);
        background: color-mix(in oklch, var(--paper) 94%, transparent);
        backdrop-filter: blur(14px);
      }
      [data-editor-title] h1 { margin: 0; font-family: var(--font-display); font-size: clamp(1.8rem, 4cqi, 3.2rem); font-weight: 560; line-height: 1; letter-spacing: -.045em; }
      [data-editor-title] p { margin: .55rem 0 0; color: var(--muted); }
      [data-editor-actions] { display: flex; align-items: center; gap: .45rem; }
      [data-dirty="true"] [data-save]::after { content: " •"; }
      [data-track-toolbar] {
        display: grid;
        grid-template-columns: minmax(7rem, .8fr) minmax(9rem, 1fr) auto;
        gap: .55rem;
        padding: 1.25rem clamp(1.25rem, 3vw, 2.5rem);
        border-bottom: 1px solid var(--line);
      }
      [data-track-lanes] { min-width: 38rem; padding: 1rem clamp(1.25rem, 3vw, 2.5rem) 5rem; }
      [data-track-lane] {
        display: grid;
        grid-template-columns: 8.5rem minmax(28rem, 1fr);
        min-height: 4.5rem;
        border-bottom: 1px solid var(--line);
      }
      [data-track-label] { display: flex; flex-direction: column; justify-content: center; gap: .2rem; padding-right: 1rem; }
      [data-track-label] strong { font-size: .875rem; }
      [data-track-label] span { color: var(--muted); font-size: .75rem; }
      [data-track-rail] {
        position: relative;
        min-width: 0;
        margin: .55rem 0;
        overflow: hidden;
        border-left: 1px solid var(--line);
        background-image: repeating-linear-gradient(to right, transparent 0, transparent calc(10% - 1px), color-mix(in oklch, var(--line) 70%, transparent) 10%);
      }
      [data-item] {
        position: absolute;
        top: .35rem;
        bottom: .35rem;
        min-width: 2.5rem;
        overflow: hidden;
        padding: .5rem .65rem;
        color: oklch(22% .02 52);
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        background: color-mix(in oklch, var(--lane-color) 72%, var(--paper-raised));
        border-color: color-mix(in oklch, var(--lane-color) 72%, var(--ink));
      }
      [data-item][aria-pressed="true"] { outline: 2px solid var(--ink); outline-offset: -3px; }
      [data-track-lane][data-category="effect"] { --lane-color: var(--track-effect); }
      [data-track-lane][data-category="text"] { --lane-color: var(--track-text); }
      [data-track-lane][data-category="visual"], [data-track-lane][data-category="primary"] { --lane-color: var(--track-visual); }
      [data-track-lane][data-category="audio"] { --lane-color: var(--track-audio); }
      [data-empty-state] { max-width: 32rem; padding: clamp(3rem, 10vh, 7rem) 2rem; }
      [data-empty-state] h2 { margin: 0; font-family: var(--font-display); font-size: 2rem; font-weight: 560; letter-spacing: -.035em; }
      [data-empty-state] p { color: var(--muted); }
      [data-inspector-content] { display: grid; gap: 1rem; padding: .75rem 1.25rem 2rem; }
      [data-item-fields] { display: grid; grid-template-columns: 1fr 1fr; gap: .65rem; }
      [data-inspector-placeholder] { color: var(--muted); font-size: .875rem; }
      [data-status] {
        position: fixed;
        right: 1rem;
        bottom: max(1rem, env(safe-area-inset-bottom));
        z-index: 10;
        max-width: min(30rem, calc(100vw - 2rem));
        padding: .55rem .75rem;
        border: 1px solid var(--line);
        border-radius: .4rem;
        background: var(--paper-raised);
      }
      [data-status][data-state="error"] { color: var(--danger); border-color: var(--danger); }
      [data-status][data-state="success"] { color: var(--success); }
      [hidden] { display: none !important; }
      @container timeline-app (max-width: 62rem) {
        [data-topbar] { grid-template-columns: 1fr auto; }
        [data-workspace-field] { grid-column: 1 / -1; grid-row: 2; }
        [data-workspace] { grid-template-columns: 14rem minmax(24rem, 1fr); }
        [data-inspector] { grid-column: 1 / -1; border-top: 1px solid var(--line); border-left: 0; }
      }
      @container timeline-app (max-width: 42rem) {
        [data-topbar] { grid-template-columns: 1fr; }
        [data-top-actions] { justify-content: flex-start; }
        [data-workspace] { display: block; overflow: auto; }
        [data-sidebar], [data-inspector] { overflow: visible; border: 0; border-bottom: 1px solid var(--line); }
        [data-timeline-list] { grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); }
        [data-editor] { overflow: visible; }
        [data-editor-header] { position: static; align-items: flex-start; flex-direction: column; }
        [data-track-toolbar] { grid-template-columns: 1fr; }
      }
      @media (pointer: coarse) {
        button, input, select { min-height: 3rem; }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
      }
    </style>
  </head>
  <body>
    <main data-app-shell data-display-mode="inline">
      <header data-topbar>
        <div data-brand><strong>Clash Timeline</strong><span>Codex plugin</span></div>
        <div data-workspace-field>
          <label for="workspace-cwd">Workspace</label>
          <input id="workspace-cwd" data-workspace-cwd autocomplete="off" spellcheck="false" />
        </div>
        <div data-top-actions>
          <button type="button" data-secondary data-refresh>Refresh</button>
          <button type="button" data-mode="inline">Inline</button>
          <button type="button" data-mode="fullscreen">Full screen</button>
        </div>
      </header>
      <div data-workspace>
        <aside data-sidebar>
          <div data-panel-heading><h2>Timelines</h2><p>Project and Canvas scope stays visible.</p></div>
          <form data-create-timeline>
            <div data-form-row>
              <label>ID<input name="timelineId" autocomplete="off" required /></label>
              <label>Name<input name="name" autocomplete="off" required /></label>
            </div>
            <button type="submit" data-secondary>Create timeline</button>
          </form>
          <nav data-timeline-list aria-label="Project timelines"></nav>
        </aside>
        <section data-editor data-dirty="false">
          <header data-editor-header>
            <div data-editor-title><h1 data-selected-name>No timeline selected</h1><p data-selected-meta>Select a timeline to inspect its cut.</p></div>
            <div data-editor-actions><button type="button" data-primary data-save disabled>Save timeline</button></div>
          </header>
          <form data-track-form data-track-toolbar>
            <label>Track ID<input name="trackId" autocomplete="off" required /></label>
            <label>Category
              <select name="category" data-track-category>
                <option value="visual">Video / image</option>
                <option value="text">Text / subtitle</option>
                <option value="effect">Effects</option>
                <option value="audio">Audio</option>
              </select>
            </label>
            <button type="submit" data-secondary>Add track</button>
          </form>
          <div data-track-lanes></div>
          <div data-empty-state hidden><h2>Start with structure.</h2><p>Create a timeline or add a typed track. Every save goes through the same read-proof and apply contract as the Clash CLI.</p></div>
        </section>
        <aside data-inspector>
          <div data-panel-heading><h2>Inspector</h2><p>Edit exact frame values.</p></div>
          <div data-inspector-content><p data-inspector-placeholder>Select a clip to inspect its timing.</p></div>
        </aside>
      </div>
      <output data-status aria-live="polite">Connecting…</output>
    </main>
    <script type="module">${safeJavascript}</script>
  </body>
</html>`;
}
