export const CANVAS_APP_RESOURCE_URI = "ui://clash/canvas";
export const CANVAS_APP_MIME_TYPE = "text/html;profile=mcp-app";

export function createCanvasAppHtml(bundledJavascript: string): string {
  const safeJavascript = bundledJavascript.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Clash Canvas</title>
    <style>
      :root {
        color-scheme: light dark;
        --clash-coral: #ff6b50;
        --paper: light-dark(#f7f6f2, #1c1d1f);
        --ink: light-dark(#25262a, #f2f0e9);
        --muted: light-dark(#77766f, #aaa79f);
        --line: light-dark(#d9d6ce, #3b3c40);
        --node: light-dark(#fffdf8, #252629);
        --shadow: light-dark(0 14px 36px rgba(49, 45, 38, .12), 0 16px 42px rgba(0, 0, 0, .3));
      }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body {
        color: var(--ink);
        background: var(--paper);
        font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
      }
      button, input { font: inherit; color: inherit; }
      [data-app-shell] { position: relative; width: 100%; height: 100%; min-height: 420px; }
      [data-canvas-stage] {
        position: absolute; inset: 0; overflow: hidden; touch-action: none;
        background-color: var(--paper);
        background-image: radial-gradient(circle, color-mix(in srgb, var(--ink) 17%, transparent) 1px, transparent 1px);
        background-size: 18px 18px;
      }
      [data-world] { position: absolute; inset: 0; transform-origin: 0 0; will-change: transform; }
      [data-edges] { position: absolute; inset: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
      [data-node] {
        position: absolute; width: 240px; min-height: 112px; padding: 16px 17px 15px;
        border: 1px solid var(--line); border-radius: 15px; background: var(--node); box-shadow: var(--shadow);
        cursor: grab; user-select: none; transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }
      [data-node]:hover, [data-node][data-selected="true"] { border-color: var(--clash-coral); }
      [data-node]:active { cursor: grabbing; }
      [data-node-kind] { color: var(--clash-coral); font: 650 10px/1.2 "JetBrains Mono", ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }
      [data-node-title] { margin-top: 11px; font: 650 16px/1.25 "Space Grotesk", ui-sans-serif, sans-serif; letter-spacing: -.02em; }
      [data-node-copy] { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.45; white-space: pre-wrap; max-height: 54px; overflow: hidden; }
      [data-toolbar] {
        position: absolute; z-index: 20; left: 18px; top: 18px; display: flex; align-items: center; gap: 6px;
        padding: 6px; border: 1px solid var(--line); border-radius: 14px; background: color-mix(in srgb, var(--paper) 94%, transparent);
        box-shadow: 0 8px 30px rgba(49, 45, 38, .1);
      }
      [data-toolbar] button { border: 0; border-radius: 9px; background: transparent; padding: 8px 10px; cursor: pointer; }
      [data-toolbar] button:hover, [data-toolbar] button:focus-visible { background: color-mix(in srgb, var(--clash-coral) 12%, transparent); outline: none; }
      [data-toolbar] [data-primary] { color: #6d1f13; background: color-mix(in srgb, var(--clash-coral) 22%, var(--paper)); }
      [data-note-form] { display: flex; align-items: center; gap: 4px; }
      [data-note-form] input { width: 0; min-width: 0; padding: 8px 0; border: 0; border-bottom: 1px solid transparent; outline: none; background: transparent; opacity: 0; transition: width 180ms ease, padding 180ms ease, opacity 120ms ease; }
      [data-note-form]:focus-within input, [data-note-form][data-open="true"] input { width: 150px; padding-inline: 8px; border-bottom-color: var(--line); opacity: 1; }
      [data-status] { position: absolute; z-index: 20; right: 18px; top: 18px; color: var(--muted); font: 11px/1.4 "JetBrains Mono", ui-monospace, monospace; }
      [data-empty] { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: 320px; text-align: center; color: var(--muted); }
      [data-empty] strong { display: block; margin-bottom: 8px; color: var(--ink); font: 650 22px/1.2 "Space Grotesk", ui-sans-serif, sans-serif; letter-spacing: -.025em; }
      [data-mode-switcher] { display: flex; gap: 2px; padding-left: 2px; }
      [data-mode-switcher] button { color: var(--muted); font-size: 11px; }
      [data-display-mode="pip"] [data-toolbar] { left: 10px; top: 10px; right: 10px; overflow: auto; }
      [data-display-mode="pip"] [data-toolbar] > :not([data-mode-switcher]) { display: none; }
      [data-display-mode="pip"] [data-status] { right: 12px; bottom: 10px; top: auto; }
      [data-display-mode="pip"] [data-node] { box-shadow: none; }
      [data-display-mode="inline"] [data-mode="inline"], [data-display-mode="pip"] [data-mode="pip"], [data-display-mode="fullscreen"] [data-mode="fullscreen"] { color: var(--clash-coral); }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; } }
    </style>
  </head>
  <body>
    <main data-app-shell data-display-mode="inline">
      <section>
        <div data-canvas-stage aria-label="Clash Canvas">
          <div data-world><svg data-edges aria-hidden="true"></svg><div data-nodes></div></div>
        </div>
        <div data-empty hidden><strong>Your canvas is ready.</strong>Add a note or ask your agent to build here.</div>
      </section>
      <nav data-toolbar aria-label="Canvas tools">
        <form data-note-form>
          <input name="label" aria-label="Note title" placeholder="Note title" autocomplete="off" />
          <button type="button" data-primary data-add-note>New note</button>
        </form>
        <button type="button" data-refresh>Refresh</button>
        <button type="button" data-fit>Fit</button>
        <button type="button" data-zoom-out aria-label="Zoom out">−</button>
        <button type="button" data-zoom-in aria-label="Zoom in">+</button>
        <div data-mode-switcher aria-label="Display mode">
          <button type="button" data-mode="inline">Inline</button>
          <button type="button" data-mode="pip">PiP</button>
          <button type="button" data-mode="fullscreen">Full</button>
        </div>
      </nav>
      <output data-status aria-live="polite">Connecting…</output>
    </main>
    <script type="module">${safeJavascript}</script>
  </body>
</html>`;
}
