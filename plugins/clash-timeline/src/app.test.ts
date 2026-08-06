import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TIMELINE_DSL_DEFINITION } from "@clash/shared-types/timeline-contract";

async function appModule(): Promise<Record<string, any>> {
  return import("./app.js").catch(() => ({}));
}

test("Timeline MCP App projects every track category from the shared contract", async () => {
  const module = await appModule();
  assert.equal(typeof module.createTimelineAppHtml, "function");
  const html: string = module.createTimelineAppHtml("window.__TIMELINE_APP__ = true;");
  const categoryIds = TIMELINE_DSL_DEFINITION.taxonomy.trackCategories;
  const renderedCategoryIds = Array.from(html.matchAll(
    /<option value="([^"]+)"(?: selected)?[^>]*>/g,
  ), (match) => match[1]);

  assert.equal(module.TIMELINE_APP_RESOURCE_URI, "ui://clash/timeline");
  assert.deepEqual(
    module.TIMELINE_APP_CONTRACT.trackCategories.map((category: any) => category.id),
    categoryIds,
  );
  assert.deepEqual(renderedCategoryIds, categoryIds);
  assert.equal(
    module.TIMELINE_APP_CONTRACT.contractFingerprint,
    TIMELINE_DSL_DEFINITION.contractFingerprint,
  );
  assert.match(html, /data-timeline-list/);
  assert.match(html, /data-track-lanes/);
  assert.match(html, /data-inspector/);
  assert.match(html, /data-create-timeline/);
  assert.match(html, /video \/ image/i);
  assert.match(html, /text \/ subtitle/i);
  assert.match(html, /effects/i);
  assert.match(html, /audio/i);
  assert.match(html, /primary/i);
  assert.match(html, /__CLASH_TIMELINE_APP_CONTRACT__/);
  assert.doesNotMatch(html, /Main Storyline|Set as main/i);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("Timeline App client consumes the injected category contract and declares its timing-only inspector boundary", async () => {
  const source = readFileSync(new URL("./app-client.ts", import.meta.url), "utf8");
  const module = await appModule();

  assert.match(source, /__CLASH_TIMELINE_APP_CONTRACT__/);
  assert.doesNotMatch(source, /const categoryOrder\s*=\s*\[/);
  assert.deepEqual(module.TIMELINE_APP_CONTRACT.inspector.editableItemFields, [
    "from",
    "durationInFrames",
  ]);
  assert.match(
    module.createTimelineAppHtml(""),
    /Timing-only editor.*full Timeline DSL/i,
  );
});

test("Timeline App client performs real read, create, edit, and save tool calls", async () => {
  const module = await import("./app-client-source.js").catch(() => ({} as Record<string, any>));
  assert.equal(typeof module.timelineAppClientSource, "string");
  assert.match(module.timelineAppClientSource, /clash_timeline_list/);
  assert.match(module.timelineAppClientSource, /clash_timeline_get/);
  assert.match(module.timelineAppClientSource, /clash_timeline_create/);
  assert.match(module.timelineAppClientSource, /clash_timeline_validate/);
  assert.match(module.timelineAppClientSource, /clash_timeline_save/);
  assert.match(module.timelineAppClientSource, /baseRevisionId/);
  assert.match(module.timelineAppClientSource, /requestDisplayMode/);
  assert.doesNotMatch(module.timelineAppClientSource, /window\.prompt/);
});
