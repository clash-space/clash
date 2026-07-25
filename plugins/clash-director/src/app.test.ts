import test from "node:test";
import assert from "node:assert/strict";

test("Director MCP App is self-contained, tokenized, and scene-oriented", async () => {
  const module = await import("./app.js").catch(() => ({} as Record<string, any>));
  assert.equal(typeof module.createDirectorAppHtml, "function");
  const html = module.createDirectorAppHtml("window.__DIRECTOR_APP__ = true;");
  assert.equal(module.DIRECTOR_APP_RESOURCE_URI, "ui://clash/director");
  assert.match(html, /data-stage-list/);
  assert.match(html, /data-scene-tree/);
  assert.match(html, /data-viewport/);
  assert.match(html, /data-inspector/);
  assert.match(html, /--director-panel:/);
  assert.match(html, /--director-selection:/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("Director App client performs real entity reads and saves", async () => {
  const module = await import("./app-client-source.js").catch(() => ({} as Record<string, any>));
  assert.match(module.directorAppClientSource, /clash_director_list/);
  assert.match(module.directorAppClientSource, /clash_director_get/);
  assert.match(module.directorAppClientSource, /clash_director_create/);
  assert.match(module.directorAppClientSource, /clash_director_save/);
  assert.match(module.directorAppClientSource, /requestDisplayMode/);
  assert.doesNotMatch(module.directorAppClientSource, /window\.prompt/);
});
