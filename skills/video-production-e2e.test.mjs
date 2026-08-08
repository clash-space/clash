import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const e2eScript = path.join(repoRoot, "skills", "video-production", "e2e", "video-production-e2e.mjs");

test("video production skill E2E harness emits category artifacts and validates schemas", async () => {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "clash-video-skill-e2e-"));
  try {
    const result = spawnSync(process.execPath, [e2eScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLASH_VIDEO_SKILL_E2E_ARTIFACT_ROOT: artifactRoot,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const reportPath = path.join(artifactRoot, "report.json");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.status, "pass");
    assert.deepEqual(
      report.categories.map((item) => item.id).sort(),
      ["image", "motion-graphics", "mv", "short-drama", "talking-head", "tvc-reference"].sort(),
    );
    for (const category of report.categories) {
      assert.ok(category.artifacts.length > 0, `${category.id} should produce artifacts`);
      assert.ok(category.checks.every((check) => check.pass === true), `${category.id} checks should pass`);
    }
    const motionGraphics = report.categories.find((category) => category.id === "motion-graphics");
    const motionGraphicsEvidence = JSON.stringify(motionGraphics);
    assert.match(motionGraphicsEvidence, /remotion-component/);
    assert.match(motionGraphicsEvidence, /sourceNodeId/);
    assert.match(motionGraphicsEvidence, /Timeline render/);
    assert.doesNotMatch(
      motionGraphicsEvidence,
      /HTML preview|rasterizer|render-mg|verify-mg-preview|export-mg|composition route/i,
    );
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
