export const DIRECTOR_APP_RESOURCE_URI = "ui://clash/director";
export const DIRECTOR_APP_MIME_TYPE = "text/html;profile=mcp-app";

export function createDirectorAppHtml(bundledJavascript: string): string {
  const safeJavascript = bundledJavascript.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Clash Director</title>
  <style>
    :root {
      color-scheme: dark;
      --director-viewport: #08090c;
      --director-panel: #1c1d20;
      --director-panel-raised: #25262a;
      --director-text: #f5f5f4;
      --director-secondary: #c7c4bf;
      --director-muted: #87847f;
      --director-divider: rgba(255,255,255,.09);
      --director-hover: rgba(255,255,255,.06);
      --director-active: rgba(255,107,80,.14);
      --director-selection: #ff6b50;
      --director-grid-major: #22445b;
      --director-grid-minor: #152b3b;
      --director-camera: #f5a623;
      --director-danger: #f87171;
      --font-ui: "Avenir Next", Avenir, "Helvetica Neue", sans-serif;
      --font-data: "SFMono-Regular", Consolas, monospace;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { color: var(--director-text); background: var(--director-viewport); font-family: var(--font-ui); font-size: 14px; }
    button, input, select { min-height: 2.5rem; color: inherit; font: inherit; }
    button { cursor: pointer; border: 1px solid transparent; border-radius: 8px; background: transparent; }
    button:hover { background: var(--director-hover); }
    button:disabled { cursor: not-allowed; opacity: .45; }
    button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--director-selection); outline-offset: 2px; }
    input, select { width: 100%; border: 1px solid var(--director-divider); border-radius: 7px; background: var(--director-panel-raised); padding: .5rem .65rem; }
    [data-app-shell] { display: grid; grid-template-rows: 3.25rem minmax(0,1fr); width: 100%; height: 100%; min-height: 34rem; }
    [data-topbar] { display: grid; grid-template-columns: auto minmax(16rem,1fr) auto; align-items: center; gap: 1rem; padding: .4rem .65rem; border-bottom: 1px solid var(--director-divider); background: var(--director-panel); }
    [data-brand] { display: flex; align-items: baseline; gap: .55rem; white-space: nowrap; }
    [data-brand] strong { font-size: 1rem; letter-spacing: -.02em; }
    [data-brand] span, [data-meta], [data-status] { color: var(--director-muted); font-family: var(--font-data); font-size: .72rem; }
    [data-workspace-field] { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: .6rem; }
    [data-workspace-field] label, [data-field] label { color: var(--director-muted); font-size: .68rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    [data-top-actions] { display: flex; gap: .25rem; }
    [data-secondary] { border-color: var(--director-divider); background: var(--director-panel-raised); }
    [data-primary] { color: white; background: var(--director-selection); font-weight: 700; }
    [data-workspace] { display: grid; grid-template-columns: minmax(14rem,17rem) minmax(25rem,1fr) minmax(15rem,19rem); min-height: 0; }
    [data-sidebar], [data-inspector] { min-height: 0; overflow: auto; background: var(--director-panel); }
    [data-sidebar] { border-right: 1px solid var(--director-divider); }
    [data-inspector] { border-left: 1px solid var(--director-divider); }
    [data-panel-heading] { padding: 1rem 1rem .55rem; }
    [data-panel-heading] h2 { margin: 0; font-size: .85rem; }
    [data-panel-heading] p { margin: .25rem 0 0; color: var(--director-muted); font-size: .75rem; }
    [data-create-stage] { display: grid; gap: .45rem; padding: .5rem 1rem 1rem; border-bottom: 1px solid var(--director-divider); }
    [data-form-row] { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; }
    [data-stage-list], [data-scene-tree] { display: grid; gap: .15rem; padding: .45rem; }
    [data-stage-row], [data-scene-row] { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; width: 100%; padding: .45rem .6rem; text-align: left; }
    [data-stage-row][aria-current="true"], [data-scene-row][aria-current="true"] { background: var(--director-active); }
    [data-name] { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; }
    [data-center] { position: relative; display: grid; grid-template-rows: 3rem minmax(0,1fr) 10rem; min-width: 0; min-height: 0; background: var(--director-viewport); }
    [data-editor-header] { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .4rem .75rem; border-bottom: 1px solid var(--director-divider); background: var(--director-panel); }
    [data-editor-title] strong { display: block; }
    [data-editor-title] span { color: var(--director-muted); font-size: .72rem; }
    [data-viewport] { position: relative; min-height: 0; overflow: hidden; background-color: var(--director-viewport); background-image: linear-gradient(var(--director-grid-minor) 1px,transparent 1px),linear-gradient(90deg,var(--director-grid-minor) 1px,transparent 1px),linear-gradient(var(--director-grid-major) 1px,transparent 1px),linear-gradient(90deg,var(--director-grid-major) 1px,transparent 1px); background-size: 24px 24px,24px 24px,120px 120px,120px 120px; perspective: 900px; }
    [data-viewport-stage] { position: absolute; inset: 10% 8%; transform: rotateX(58deg) rotateZ(-2deg); transform-style: preserve-3d; }
    [data-viewport-object] { position: absolute; display: grid; place-items: center; width: 3.25rem; height: 4.75rem; border: 1px solid color-mix(in srgb,var(--object-color) 75%,white); border-radius: 999px 999px 35% 35%; color: white; background: color-mix(in srgb,var(--object-color) 72%,transparent); box-shadow: 0 1rem 2rem rgba(0,0,0,.32); transform: rotateZ(2deg) rotateX(-58deg); font-size: .65rem; text-align: center; }
    [data-viewport-object][aria-selected="true"] { outline: 2px solid var(--director-selection); outline-offset: 4px; }
    [data-empty] { display: grid; place-items: center; height: 100%; color: var(--director-muted); text-align: center; }
    [data-timeline] { overflow: auto; border-top: 1px solid var(--director-divider); background: var(--director-panel); }
    [data-ruler] { height: 2rem; border-bottom: 1px solid var(--director-divider); background-image: repeating-linear-gradient(90deg,var(--director-divider) 0 1px,transparent 1px 10%); }
    [data-track] { display: grid; grid-template-columns: 9rem 1fr; min-height: 2.4rem; border-bottom: 1px solid var(--director-divider); }
    [data-track] strong { padding: .65rem; color: var(--director-secondary); font-size: .72rem; }
    [data-keyframes] { position: relative; }
    [data-keyframe] { position: absolute; top: 50%; width: .55rem; height: .55rem; padding: 0; min-height: 0; border-radius: 1px; background: var(--director-selection); transform: translate(-50%,-50%) rotate(45deg); }
    [data-inspector-content] { display: grid; gap: .75rem; padding: .75rem 1rem 5rem; }
    [data-field] { display: grid; gap: .3rem; }
    [data-vector] { display: grid; grid-template-columns: repeat(3,1fr); gap: .3rem; }
    [data-status] { position: fixed; right: .75rem; bottom: .75rem; z-index: 10; max-width: min(30rem,calc(100vw - 1.5rem)); padding: .5rem .65rem; border: 1px solid var(--director-divider); border-radius: 7px; background: var(--director-panel-raised); }
    [data-status][data-state="error"] { color: var(--director-danger); border-color: var(--director-danger); }
    [data-status][data-state="success"] { color: #73d99a; }
    [hidden] { display: none !important; }
    @media (max-width: 850px) { [data-workspace] { grid-template-columns: 13rem minmax(22rem,1fr); } [data-inspector] { display: none; } }
    @media (max-width: 620px) { html,body { overflow: auto; } [data-app-shell] { height: auto; } [data-topbar] { grid-template-columns: 1fr; } [data-workspace] { display: block; } [data-sidebar],[data-inspector] { display: block; max-height: none; border: 0; border-bottom: 1px solid var(--director-divider); } [data-center] { min-height: 38rem; } }
    @media (pointer: coarse) { button,input,select { min-height: 3rem; } }
  </style>
</head>
<body>
  <main data-app-shell data-display-mode="inline">
    <header data-topbar>
      <div data-brand><strong>Clash Director</strong><span>Codex plugin</span></div>
      <div data-workspace-field><label for="workspace-cwd">Workspace</label><input id="workspace-cwd" data-workspace-cwd autocomplete="off" spellcheck="false" /></div>
      <div data-top-actions><button type="button" data-secondary data-refresh>Refresh</button><button type="button" data-mode="inline">Inline</button><button type="button" data-mode="fullscreen">Full screen</button></div>
    </header>
    <div data-workspace>
      <aside data-sidebar>
        <div data-panel-heading><h2>Director Stages</h2><p>Project and Canvas ownership.</p></div>
        <form data-create-stage><div data-form-row><label>ID<input name="stageId" required /></label><label>Name<input name="name" required /></label></div><button type="submit" data-secondary>Create Stage</button></form>
        <nav data-stage-list aria-label="Project Director Stages"></nav>
        <div data-panel-heading><h2>Scene</h2><p>Objects and cameras in the selected Stage.</p></div>
        <div data-scene-tree></div>
      </aside>
      <section data-center>
        <header data-editor-header><div data-editor-title><strong data-selected-name>No Stage selected</strong><span data-selected-meta>Read a Director Stage to begin.</span></div><button type="button" data-primary data-save disabled>Save Stage</button></header>
        <div data-viewport><div data-viewport-stage></div><div data-empty>Stage composition preview<br />Open Clash for the full WebGL director view.</div></div>
        <div data-timeline><div data-ruler></div><div data-timeline-tracks></div></div>
      </section>
      <aside data-inspector><div data-panel-heading><h2>Inspector</h2><p>Exact agent-readable properties.</p></div><form data-inspector-content><p data-meta>Select an object, camera, or Stage.</p></form></aside>
    </div>
    <output data-status aria-live="polite">Connecting…</output>
  </main>
  <script type="module">${safeJavascript}</script>
</body>
</html>`;
}
