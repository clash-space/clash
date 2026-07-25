import test from "node:test";
import assert from "node:assert/strict";

async function appModule(): Promise<Record<string, any>> {
  return import("./app.js").catch(() => ({}));
}

test("Timeline MCP App is self-contained and uses explicit track categories", async () => {
  const module = await appModule();
  assert.equal(typeof module.createTimelineAppHtml, "function");
  const html = module.createTimelineAppHtml("window.__TIMELINE_APP__ = true;");

  assert.equal(module.TIMELINE_APP_RESOURCE_URI, "ui://clash/timeline");
  assert.match(html, /data-timeline-list/);
  assert.match(html, /data-track-lanes/);
  assert.match(html, /data-inspector/);
  assert.match(html, /data-create-timeline/);
  assert.match(html, /video \/ image/i);
  assert.match(html, /text \/ subtitle/i);
  assert.match(html, /effects/i);
  assert.match(html, /audio/i);
  assert.doesNotMatch(html, /Main Storyline|Set as main/i);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("Timeline App client performs real read, create, edit, and save tool calls", async () => {
  const module = await import("./app-client-source.js").catch(() => ({} as Record<string, any>));
  assert.equal(typeof module.timelineAppClientSource, "string");
  assert.match(module.timelineAppClientSource, /clash_timeline_list/);
  assert.match(module.timelineAppClientSource, /clash_timeline_get/);
  assert.match(module.timelineAppClientSource, /clash_timeline_create/);
  assert.match(module.timelineAppClientSource, /clash_timeline_save/);
  assert.match(module.timelineAppClientSource, /requestDisplayMode/);
  assert.doesNotMatch(module.timelineAppClientSource, /window\.prompt/);
});
