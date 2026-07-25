import test from "node:test";
import assert from "node:assert/strict";

test("Studio App is a host-backed project overview rather than a second desktop shell", async () => {
  let module: Record<string, unknown> = {};
  try {
    module = await import("./studio-app") as Record<string, unknown>;
  } catch {
    // RED until the Studio App boundary exists.
  }

  assert.equal(module.STUDIO_APP_RESOURCE_URI, "ui://clash/studio");
  assert.equal(typeof module.createStudioAppHtml, "function");
  const html = (module.createStudioAppHtml as (javascript: string) => string)(
    "window.__CLASH_STUDIO__ = true;",
  );
  assert.match(html, /data-host-status/);
  assert.match(html, /data-project-list/);
  assert.match(html, /data-refresh/);
  assert.match(html, /data-mode="inline"/);
  assert.match(html, /data-mode="fullscreen"/);
  assert.match(html, /window\.__CLASH_STUDIO__ = true/);
  assert.doesNotMatch(html, /iframe|localhost:\d+/i);
});
