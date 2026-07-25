import test from "node:test";
import assert from "node:assert/strict";

test("Canvas App is a self-contained Clash work surface", async () => {
  const { createCanvasAppHtml, CANVAS_APP_RESOURCE_URI } = await import("./canvas-app");
  const html = createCanvasAppHtml("/* bundled app */");

  assert.equal(CANVAS_APP_RESOURCE_URI, "ui://clash/canvas");
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /--clash-coral:\s*#ff6b50/i);
  assert.match(html, /data-canvas-stage/);
  assert.match(html, /aria-label="Canvas tools"/);
  assert.match(html, /data-note-form/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /\/\* bundled app \*\//);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("Canvas App keeps bundled JavaScript inside its resource boundary", async () => {
  const { createCanvasAppHtml } = await import("./canvas-app");
  const html = createCanvasAppHtml("const marker = '</script><p>escaped</p>';");

  assert.doesNotMatch(html, /const marker = '<\/script>/);
  assert.match(html, /const marker = '<\\\/script>/);
});

test("Canvas App client reads snapshots and persists drag positions through MCP", async () => {
  const { canvasAppClientSource } = await import("./canvas-app-client-source");

  assert.match(canvasAppClientSource, /clash_canvas_snapshot/);
  assert.match(canvasAppClientSource, /clash_canvas_move/);
  assert.match(canvasAppClientSource, /callServerTool/);
  assert.match(canvasAppClientSource, /requestAnimationFrame/);
  assert.match(canvasAppClientSource, /pointermove/);
  assert.match(canvasAppClientSource, /wheel/);
  assert.doesNotMatch(canvasAppClientSource, /window\.prompt/);
  assert.match(canvasAppClientSource, /data-note-form/);
});

test("Canvas App adapts inline, picture-in-picture, and fullscreen without embedding Timeline", async () => {
  const { canvasAppClientSource } = await import("./canvas-app-client-source");
  const { createCanvasAppHtml } = await import("./canvas-app");
  const html = createCanvasAppHtml("/* bundled app */");

  assert.match(canvasAppClientSource, /requestDisplayMode/);
  assert.match(canvasAppClientSource, /"inline"/);
  assert.match(canvasAppClientSource, /"pip"/);
  assert.match(canvasAppClientSource, /"fullscreen"/);
  assert.match(canvasAppClientSource, /displayMode/);
  assert.match(html, /data-mode="inline"/);
  assert.match(html, /data-mode="pip"/);
  assert.match(html, /data-mode="fullscreen"/);
  assert.doesNotMatch(canvasAppClientSource, /clash_cli_timeline|refreshTimelines|renderTimelines/);
  assert.doesNotMatch(html, /data-surface="timeline"|data-timeline-list/);
});
