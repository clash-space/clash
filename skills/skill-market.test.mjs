import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const registryPath = path.join(repoRoot, "skills", "registry.json");
const evalsPath = path.join(repoRoot, "skills", "video-production", "evals", "evals.json");
const clashCommandsReferencePath = path.join(repoRoot, "skills", "clash", "references", "commands.md");
const canvasOperationsSkillPath = path.join(repoRoot, "packages", "claude-code-plugin", "skills", "canvas-operations", "SKILL.md");
const projectManagementSkillPath = path.join(repoRoot, "packages", "claude-code-plugin", "skills", "project-management", "SKILL.md");
const forbiddenInternalSurfacePattern =
  /\b(snapshot\.bin|local\.sqlite|sqlite|loro|room|variables|runtime\/|\.clash\/db)\b/i;

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md must start with YAML frontmatter");
  const fields = {};
  for (const line of match[1].split("\n")) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    fields[pair[1]] = pair[2].replace(/^["']|["']$/g, "");
  }
  return fields;
}

test("first-party skill marketplace registry is self-contained and installable", async () => {
  assert.ok(existsSync(registryPath), "skills/registry.json should exist");
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const registrySchema = JSON.parse(await readFile(path.join(repoRoot, "skills", "registry.schema.json"), "utf8"));
  assert.ok(existsSync(evalsPath), "video production skill evals should exist");
  const evals = JSON.parse(await readFile(evalsPath, "utf8"));
  assert.ok(Array.isArray(evals.evals), "evals.evals must be an array");
  const evalSkillIds = new Set(evals.evals.map((item) => item.skill_id));

  assert.equal(registry.version, 1);
  assert.equal(
    registry.marketplaceSemantics?.skillBoundary,
    "portable-artifact-contract",
    "skills should be portable workflow/artifact contracts, not Clash runtime plugins",
  );
  assert.match(
    registry.marketplaceSemantics?.executionModel?.portableSkillExecution ?? "",
    /agent.*cwd/i,
    "portable skill execution should be owned by an agent working in its cwd",
  );
  assert.match(
    registry.marketplaceSemantics?.executionModel?.clashManagedExecution ?? "",
    /register assets.*metadata.*provenance.*review.*CAS/i,
    "Clash-managed execution should be collaboration and project-state management",
  );
  assert.match(
    registry.marketplaceSemantics?.executionModel?.hardBoundary ?? "",
    /missing Clash system capability.*not prevent portable skill execution/i,
    "missing Clash-native capability should not block portable skill workflows",
  );
  assert.match(
    registry.marketplaceSemantics?.hostCapabilityContract ?? "",
    /host capability contracts.*not Clash private storage or UI internals/i,
    "skills should depend on host capability contracts instead of Clash internals",
  );
  assert.match(
    registry.marketplaceSemantics?.hostCapabilityContract ?? "",
    /Clash is one host implementation.*collaboration/i,
    "Clash should be positioned as the collaboration and management host",
  );
  assert.deepEqual(
    registry.marketplaceSemantics?.artifactContract?.publicInterfaces,
    [
      "action",
      "metadata-fill",
      "asset",
      "analysis-metadata",
      "view-projection",
      "timeline-cas-apply",
      "schema",
    ],
    "portable skills should expose only stable public production interfaces",
  );
  assert.match(
    registry.marketplaceSemantics?.artifactContract?.skillOwnedWorkspace ?? "",
    /agent.*cwd.*draft/i,
    "skill-owned workspace should be the agent cwd draft area",
  );
  assert.deepEqual(
    registry.marketplaceSemantics?.artifactContract?.hostOwnedInternals,
    [
      "snapshot.bin",
      "project.sqlite",
      "loro-crdt-doc",
      "canvas-private-node-state",
      "runtime-secrets",
    ],
    "host-owned internals must be explicitly out of the portable skill contract",
  );
  assert.match(
    registry.marketplaceSemantics?.artifactContract?.forbiddenDependencyPolicy ?? "",
    /must not depend on.*snapshot\.bin.*SQLite.*Loro.*runtime secret/i,
    "skill contracts should forbid dependency on Clash internals",
  );
  assert.match(
    registry.marketplaceSemantics?.systemCapabilityMeaning ?? "",
    /Clash-native automation bindings/i,
    "system capabilities should describe Clash-native automation coverage",
  );
  assert.match(
    registry.marketplaceSemantics?.systemCapabilityMeaning ?? "",
    /not.*required.*run/i,
    "system capabilities must not be treated as a gate for portable skill execution",
  );
  assert.match(
    registry.marketplaceSemantics?.statusPolicy?.ready ?? "",
    /runnable.*local.*action|local.*CLI.*contract.*test/i,
    "ready status must mean a runnable capability with local CLI/action contract coverage",
  );
  assert.doesNotMatch(
    registry.marketplaceSemantics?.statusPolicy?.ready ?? "",
    /architecture|planning contract/i,
    "ready status must not be used for architecture or planning-only contracts",
  );
  assert.match(
    registry.marketplaceSemantics?.statusPolicy?.blockedBySystemGap ?? "",
    /systemGaps.*capability.*unblockSignal/i,
    "blocked-by-system-gap status should require explicit capability gaps and unblock signals",
  );
  assert.ok(
    registry.marketplaceSemantics?.clashRole?.includes("collaboration-management"),
    "registry should state that Clash owns collaboration and management",
  );
  const skillSchema = registrySchema.properties?.skills?.items;
  assert.ok(
    Array.isArray(skillSchema?.allOf),
    "registry schema should encode status-dependent skill gap rules",
  );
  assert.ok(
    JSON.stringify(skillSchema.allOf).includes('"blocked-by-system-gap"') &&
      JSON.stringify(skillSchema.allOf).includes('"systemGaps"'),
    "registry schema should require systemGaps for blocked-by-system-gap skills",
  );
  assert.ok(
    JSON.stringify(skillSchema.allOf).includes('"ready"') &&
      JSON.stringify(skillSchema.allOf).includes('"maxItems":0'),
    "registry schema should forbid unresolved systemGaps on ready skills",
  );
  assert.ok(Array.isArray(registry.skills));
  assert.ok(registry.skills.length >= 12, "expected architecture, workflow, and concrete video/image skills");
  assert.ok(Array.isArray(registry.actions), "registry should publish executable action contracts");
  assert.ok(registry.actions.length >= 5, "registry should expose first-party production actions, not only skill docs");
  assert.ok(Array.isArray(registry.thirdPartyReferences), "third-party reference license ledger is required");

  const ids = new Set();
  const actionIds = new Set();
  const kinds = new Set();
  const capabilityIds = new Set(registry.systemCapabilities?.map((capability) => capability.id) ?? []);
  const referenceByName = new Map(registry.thirdPartyReferences.map((reference) => [reference.name, reference]));
  assert.ok(capabilityIds.has("audio.beat-grid"), "MV skills need a beat-grid capability");
  assert.ok(capabilityIds.has("media.asset-registry"), "media skills need an asset registry capability");
  assert.ok(capabilityIds.has("image.reference-sheets"), "image/storyboard skills need reference sheet support");
  assert.ok(capabilityIds.has("legal.oss-license-ledger"), "skill marketplace needs OSS license tracking");
  const capabilityById = new Map(registry.systemCapabilities.map((capability) => [capability.id, capability]));
  assert.equal(capabilityById.get("render.html-composition")?.status, "partial");
  assert.match(
    capabilityById.get("render.html-composition")?.description ?? "",
    /seekable HTML preview.*data-current-frame.*clash-mg-frame.*decoded alpha-plane pixel sampling.*renderer parity/i,
  );
  assert.equal(capabilityById.get("render.export-validation")?.status, "partial");
  assert.match(
    capabilityById.get("render.export-validation")?.description ?? "",
    /VP9 alpha_mode.*decoded alpha-plane pixel samples/i,
  );
  assert.equal(capabilityById.get("render.composition-router")?.status, "partial");
  assert.match(
    capabilityById.get("render.composition-router")?.description ?? "",
    /fallbackUsed=false|silent runtime fallback/i,
  );
  assert.equal(capabilityById.get("review.stage-gates")?.status, "partial");
  assert.match(
    capabilityById.get("review.stage-gates")?.description ?? "",
    /path-bound hash lock|wrong-file/i,
  );
  assert.equal(capabilityById.get("workflow.dry-run-cost-gate")?.status, "partial");
  assert.match(
    capabilityById.get("workflow.dry-run-cost-gate")?.description ?? "",
    /without executing|fallbackUsed=false/i,
  );
  assert.equal(capabilityById.get("ad.delivery-export-validation")?.status, "partial");
  assert.match(
    capabilityById.get("ad.delivery-export-validation")?.description ?? "",
    /extract-ad-visual-frames.*analyze-ad-visual-pixels.*final-frame mean RGB diff.*OCR\/logo\/loudness/i,
  );
  assert.match(
    capabilityById.get("ad.delivery-export-validation")?.description ?? "",
    /direct PNG\/JPEG image decoding backends still missing/i,
  );
  assert.equal(capabilityById.get("analysis.backend-benchmark")?.status, "partial");
  assert.match(
    capabilityById.get("analysis.backend-benchmark")?.description ?? "",
    /plan-analysis-benchmark|did not execute|metric thresholds/i,
  );
  assert.equal(capabilityById.get("audio.section-analysis")?.status, "partial");
  assert.match(
    capabilityById.get("audio.section-analysis")?.description ?? "",
    /semantic.*review confidence.*multi-tempo/i,
  );
  assert.equal(capabilityById.get("audio.word-timestamps")?.status, "partial");
  assert.match(
    capabilityById.get("audio.word-timestamps")?.description ?? "",
    /source path\/hash.*backend\/model|executing ASR backends.*missing/i,
  );
  assert.equal(capabilityById.get("video.reference-download")?.status, "partial");
  assert.match(
    capabilityById.get("video.reference-download")?.description ?? "",
    /execute-reference-download|raw reference asset|does not grant final export/i,
  );
  assert.equal(capabilityById.get("video.shot-analysis")?.status, "partial");
  assert.match(
    capabilityById.get("video.shot-analysis")?.description ?? "",
    /shot-analysis\.projection|no media copying|automatic detector/i,
  );
  assert.equal(capabilityById.get("image.semantic-reference-roles")?.status, "partial");
  assert.match(
    capabilityById.get("image.semantic-reference-roles")?.description ?? "",
    /copy-on-write|identity views|logo locks/i,
  );
  assert.equal(capabilityById.get("image.reference-sheets")?.status, "partial");
  assert.match(
    capabilityById.get("image.reference-sheets")?.description ?? "",
    /referenceViews.*character-reference-sheet.*copy-on-write/i,
  );
  assert.equal(capabilityById.get("image.storyboard-consistency")?.status, "partial");
  assert.match(
    capabilityById.get("image.storyboard-consistency")?.description ?? "",
    /characters\[\]\.referenceViews|character reference-sheet registration/i,
  );
  assert.equal(capabilityById.get("image.product-logo-qa")?.status, "partial");
  assert.match(
    capabilityById.get("image.product-logo-qa")?.description ?? "",
    /plan-product-logo-qa|fails closed|OCR/i,
  );
  assert.equal(capabilityById.get("image.embedding-store")?.status, "partial");
  assert.match(
    capabilityById.get("image.embedding-store")?.description ?? "",
    /plan-image-embedding-store|vector path\/hash|does not execute embedding models/i,
  );
  assert.equal(capabilityById.get("image.comfyui-runner")?.status, "partial");
  assert.match(
    capabilityById.get("image.comfyui-runner")?.description ?? "",
    /plan-comfyui-workflow|workflow\/output hashes|does not execute ComfyUI/i,
  );
  assert.equal(capabilityById.get("audio.stem-separation")?.status, "partial");
  assert.match(
    capabilityById.get("audio.stem-separation")?.description ?? "",
    /plan-audio-stem-separation|path\/hash|does not execute .*separation backends/i,
  );
  assert.equal(capabilityById.get("provenance.content-credentials")?.status, "partial");
  assert.match(
    capabilityById.get("provenance.content-credentials")?.description ?? "",
    /plan-content-credentials|target\/ingredient|does not sign C2PA/i,
  );
  assert.equal(capabilityById.get("ad.delivery-export-validation")?.status, "partial");
  assert.match(
    capabilityById.get("ad.delivery-export-validation")?.description ?? "",
    /plan-ad-visual-qa|visual QA reports|without executing OCR\/logo\/pixel/i,
  );
  assert.equal(capabilityById.get("ad.packshot-end-card")?.status, "partial");
  assert.match(
    capabilityById.get("ad.packshot-end-card")?.description ?? "",
    /extract-ad-visual-frames.*analyze-ad-visual-pixels.*plan-ad-visual-qa/i,
  );
  assert.match(
    capabilityById.get("ad.packshot-end-card")?.description ?? "",
    /packshot.*logo.*disclaimer.*final-frame|Automatic .*backends/i,
  );
  assert.match(
    capabilityById.get("workflow.production-action-runner")?.description ?? "",
    /portable file\/artifact/i,
  );
  assert.match(
    capabilityById.get("workflow.production-action-runner")?.description ?? "",
    /ad visual frame extraction manifests.*ad visual QA plans/i,
  );
  assert.equal(capabilityById.get("caption.retime-and-render")?.status, "partial");
  assert.match(
    capabilityById.get("caption.retime-and-render")?.description ?? "",
    /project-caption-overlay.*CAS subtitle timeline projection.*export-caption-burn|SRT\/VTT\/ASS sidecar export.*FFmpeg ASS burn-in/i,
  );

  for (const action of registry.actions) {
    assert.match(action.id, /^clash\.action\./, `${action.id} should use clash.action.* namespace`);
    assert.ok(!actionIds.has(action.id), `duplicate action id ${action.id}`);
    actionIds.add(action.id);
    assert.equal(action.source, "first-party", `${action.id} should be first-party`);
    assert.equal(action.trigger?.mode, "local-cli", `${action.id} should be a local CLI action contract`);
    assert.match(action.trigger?.command ?? "", /^clash production /, `${action.id} should point at a production command`);
    assert.equal(action.trigger?.requiresLocalRuntime, true, `${action.id} should require the user's local runtime`);
    assert.doesNotMatch(
      action.trigger?.command ?? "",
      forbiddenInternalSurfacePattern,
      `${action.id} trigger must not depend on Clash private storage surfaces`,
    );
    assert.ok(action.skillId && evalSkillIds.has(action.skillId), `${action.id} should point at a marketplace skill`);
    assert.ok(Array.isArray(action.lifecycle), `${action.id} should describe action lifecycle`);
    assert.ok(action.lifecycle.includes("action"), `${action.id} should start from an explicit action`);
    assert.ok(
      action.lifecycle.some((step) => ["metadata-fill", "asset", "view-projection", "review-gate"].includes(step)),
      `${action.id} should move production state through metadata, asset, view, or review gates`,
    );
    assert.ok(Array.isArray(action.inputs) && action.inputs.length > 0, `${action.id} should declare input artifacts`);
    assert.ok(Array.isArray(action.outputs) && action.outputs.length > 0, `${action.id} should declare output artifacts`);
    const metadataFillActionOutput = action.outputs.find((output) => output.kind === "action");
    const metadataProjectionOutput = action.outputs.find((output) => output.kind === "metadata");
    if (action.lifecycle.includes("metadata-fill")) {
      assert.ok(metadataFillActionOutput, `${action.id} metadata-fill lifecycle must emit an action artifact`);
      assert.equal(
        metadataFillActionOutput.schema,
        "asset-metadata-fill-action",
        `${action.id} action artifact schema must describe the AssetMetadataFillAction envelope`,
      );
      assert.ok(
        metadataFillActionOutput.metadataKind,
        `${action.id} action artifact must declare the metadataKind it fills`,
      );
      assert.ok(
        metadataFillActionOutput.metadataSchema,
        `${action.id} action artifact must declare the metadata payload schema`,
      );
      assert.ok(
        existsSync(path.join(repoRoot, "skills", "video-production", "schemas", `${metadataFillActionOutput.metadataSchema}.schema.json`)),
        `${action.id} metadata payload schema ${metadataFillActionOutput.metadataSchema} should exist`,
      );
      assert.ok(metadataProjectionOutput, `${action.id} metadata-fill lifecycle must emit a metadata projection artifact`);
      assert.equal(
        metadataProjectionOutput.metadataKind,
        metadataFillActionOutput.metadataKind,
        `${action.id} metadata projection must carry the same metadataKind as the action artifact`,
      );
      assert.equal(
        metadataProjectionOutput.metadataSchema,
        metadataFillActionOutput.metadataSchema,
        `${action.id} metadata projection must carry the same metadataSchema as the action artifact`,
      );
    }
    for (const output of action.outputs) {
      assert.ok(output.kind, `${action.id} output needs a kind`);
      assert.ok(output.pathPattern, `${action.id} output ${output.kind} needs a pathPattern`);
      assert.doesNotMatch(
        output.pathPattern,
        forbiddenInternalSurfacePattern,
        `${action.id} output ${output.pathPattern} must stay on public artifact paths`,
      );
      if (output.lockPathPattern) {
        assert.doesNotMatch(
          output.lockPathPattern,
          forbiddenInternalSurfacePattern,
          `${action.id} lock sidecar must stay on public artifact paths`,
        );
      }
      if (output.schema) {
        assert.ok(
          existsSync(path.join(repoRoot, "skills", "video-production", "schemas", `${output.schema}.schema.json`)),
          `${action.id} output schema ${output.schema} should exist in video-production/schemas`,
        );
      }
      if (output.kind === "projection") {
        assert.equal(output.casRequired, true, `${action.id} projection outputs must require explicit CAS apply`);
        assert.equal(
          output.applyCommand,
          "clash timeline apply",
          `${action.id} projection outputs must name the explicit timeline apply command`,
        );
        assert.equal(
          output.lockSource,
          "fresh-canvas-pull",
          `${action.id} projection outputs must say the CAS lock comes from a fresh canvas pull`,
        );
        assert.equal(
          output.lockPathPattern,
          "timelines/main.timeline.lock.json",
          `${action.id} projection outputs must not advertise projection-sidecar locks for timeline apply`,
        );
        assert.equal(
          output.nodeIdPlaceholder,
          "<video-editor-node-id>",
          `${action.id} projection outputs must disclose the required timeline node id placeholder`,
        );
        assert.deepEqual(
          output.requiredRuntimeArgs,
          ["--node <video-editor-node-id>"],
          `${action.id} projection outputs must disclose required runtime args`,
        );
        assert.equal(
          output.pullCommand,
          "clash timeline pull",
          `${action.id} projection outputs must name the fresh-pull command`,
        );
        assert.deepEqual(
          output.pullArgsPattern,
          ["--node", "<video-editor-node-id>", "--file", "timelines/main.timeline.yaml"],
          `${action.id} projection outputs must describe fresh-pull args`,
        );
        assert.deepEqual(
          output.applyArgsPattern,
          ["--node", "<video-editor-node-id>", "--file", output.pathPattern, "--lock", "timelines/main.timeline.lock.json"],
          `${action.id} projection outputs must describe apply args with the projection file and fresh lock`,
        );
      }
      if (output.kind === "metadata") {
        assert.equal(
          output.applyCommand,
          "clash production apply-metadata",
          `${action.id} metadata outputs must name the metadata apply command`,
        );
      }
    }
    for (const capability of action.requiredSystemCapabilities ?? []) {
      assert.ok(capabilityIds.has(capability), `${action.id} references unknown capability ${capability}`);
    }
  }

  assert.ok(actionIds.has("clash.action.production.render-mg"));
  assert.ok(actionIds.has("clash.action.production.verify-mg-preview"));
  assert.ok(actionIds.has("clash.action.production.project-composition-timeline"));
  assert.ok(actionIds.has("clash.action.production.plan-text-cut"));
  assert.ok(actionIds.has("clash.action.production.verify-caption-lineage"));
  assert.ok(actionIds.has("clash.action.production.analyze-audio-beats"));
  assert.ok(actionIds.has("clash.action.production.verify-mv-beat-sync"));
  assert.ok(actionIds.has("clash.action.production.plan-reference-review"));
  assert.ok(actionIds.has("clash.action.production.verify-reference-isolation"));
  assert.ok(actionIds.has("clash.action.production.plan-storyboard-review"));
  assert.ok(actionIds.has("clash.action.production.project-storyboard-timeline"));
  assert.ok(actionIds.has("clash.action.production.verify-storyboard-timeline"));
  assert.ok(actionIds.has("clash.action.production.project-derived-overlay"));

  for (const skill of registry.skills) {
    assert.equal(skill.source, "first-party", `${skill.id} should be marked first-party`);
    assert.ok(evalSkillIds.has(skill.id), `${skill.id} should have an eval prompt`);
    assert.ok(skill.id && !ids.has(skill.id), `duplicate skill id ${skill.id}`);
    ids.add(skill.id);
    kinds.add(skill.kind);
    assert.ok(Array.isArray(skill.requiredSystemCapabilities), `${skill.id} must declare system gaps`);
    assert.ok(!skill.researchSources?.includes("subagent-research"), `${skill.id} should name concrete research sources`);
    for (const source of skill.researchSources ?? []) {
      assert.ok(referenceByName.has(source), `${skill.id} references ${source} without a license ledger entry`);
    }
    for (const capability of skill.requiredSystemCapabilities) {
      assert.ok(capabilityIds.has(capability), `${skill.id} references unknown capability ${capability}`);
    }
    if (skill.status === "ready") {
      assert.notEqual(skill.kind, "architecture", `${skill.id} cannot be ready if it is architecture-only`);
      assert.ok(
        registry.actions.some((action) => action.skillId === skill.id),
        `${skill.id} cannot be ready without a runnable production action contract`,
      );
      assert.ok(
        !Array.isArray(skill.systemGaps) || skill.systemGaps.length === 0,
        `${skill.id} is ready and must not carry unresolved system gaps`,
      );
    }
    if (skill.status === "blocked-by-system-gap") {
      assert.ok(Array.isArray(skill.systemGaps), `${skill.id} must list explicit system gaps`);
      assert.ok(skill.systemGaps.length > 0, `${skill.id} must list at least one blocking system gap`);
      for (const gap of skill.systemGaps) {
        assert.ok(
          skill.requiredSystemCapabilities.includes(gap.capability),
          `${skill.id} gap ${gap.capability} must be one of its required capabilities`,
        );
        assert.ok(capabilityIds.has(gap.capability), `${skill.id} gap ${gap.capability} must be a known capability`);
        assert.ok(gap.gap?.length > 24, `${skill.id} gap ${gap.capability} needs a concrete missing behavior`);
        assert.ok(gap.unblockSignal?.length > 24, `${skill.id} gap ${gap.capability} needs an unblock signal`);
      }
    }
    for (const publicArtifact of [...(skill.inputs ?? []), ...(skill.outputs ?? [])]) {
      assert.doesNotMatch(
        publicArtifact,
        forbiddenInternalSurfacePattern,
        `${skill.id} public artifact ${publicArtifact} must not point at Clash internals`,
      );
    }

    const skillPath = path.join(repoRoot, skill.path, "SKILL.md");
    assert.ok(existsSync(skillPath), `${skill.id} SKILL.md missing at ${skill.path}`);
    const skillMarkdown = await readFile(skillPath, "utf8");
    const frontmatter = parseFrontmatter(skillMarkdown);
    assert.equal(frontmatter.name, skill.name, `${skill.id} frontmatter name should match registry`);
    assert.ok(frontmatter.description?.length > 60, `${skill.id} needs a trigger-rich description`);
    assert.doesNotMatch(
      skillMarkdown,
      /projections\/timelines\/[^\s"`]*\.lock\.json/,
      `${skill.id} docs must not tell agents to use projection-sidecar locks for timeline apply`,
    );
  }

  for (const reference of registry.thirdPartyReferences) {
    assert.ok(reference.url?.startsWith("https://"), `${reference.name} needs a source URL`);
    assert.ok(reference.license, `${reference.name} needs a license value`);
    assert.ok(reference.licenseSource?.startsWith("https://"), `${reference.name} needs a license source URL`);
    assert.ok(reference.integrationPolicy?.length > 40, `${reference.name} needs an integration policy`);
    if (/AGPL|Noncommercial|NOASSERTION|custom/i.test(reference.license)) {
      assert.notEqual(
        reference.usage,
        "reference-or-integration-with-notice",
        `${reference.name} has restrictive or unverified licensing and cannot be marked as directly integratable`,
      );
    }
  }

  assert.ok(kinds.has("architecture"), "registry should include architecture skills");
  assert.ok(kinds.has("detail"), "registry should include detail skills");
  assert.ok(ids.has("clash.video.talking-head-text-cut"));
  assert.ok(ids.has("clash.video.music-video-beat-editing"));
  assert.ok(ids.has("clash.video.tvc-reference-remix"));
  assert.ok(ids.has("clash.audio.beat-analysis"));
  assert.ok(ids.has("clash.audio.transcript-cut-planning"));
  assert.ok(ids.has("clash.video.reference-ingest-analysis"));
  assert.ok(ids.has("clash.image.character-reference-sheets"));

  const motionGraphics = registry.skills.find((skill) => skill.id === "clash.video.motion-graphics-overlays");
  assert.equal(
    motionGraphics?.status,
    "blocked-by-system-gap",
    "MG skill should stay blocked until remaining renderer parity and alpha validation gaps close",
  );
});

test("clash command reference uses current remote vars CLI syntax", async () => {
  const commands = await readFile(clashCommandsReferencePath, "utf8");

  assert.match(commands, /clash vars set API_KEY --value "\.\.\."/);
  assert.match(commands, /clash vars delete API_KEY/);
  assert.doesNotMatch(commands, /clash vars set --key/);
  assert.doesNotMatch(commands, /clash vars delete --key/);
});

test("agent-facing project docs expose recoverable project delete and restore", async () => {
  const commands = await readFile(clashCommandsReferencePath, "utf8");
  const projectSkill = await readFile(projectManagementSkillPath, "utf8");

  for (const docs of [commands, projectSkill]) {
    assert.match(docs, /clash projects get --id <project-id> --json/);
    assert.match(docs, /clash projects create --name/);
    assert.match(docs, /clash projects delete --id <project-id> --if-match <readToken> --yes/);
    assert.match(docs, /clash project get --id <project-id> --include-deleted --json/);
    assert.match(docs, /clash project restore <project-id> --if-match <readToken>/);
    assert.match(docs, /soft-delete|recoverable|restore/i);
    assert.doesNotMatch(docs, /removes the canvas, asset references, and history/i);
    assert.doesNotMatch(docs, /clash projects get <project-id>/);
    assert.doesNotMatch(docs, /clash projects create "<name>"/);
    assert.doesNotMatch(docs, /clash projects delete <project-id>/);
  }
});

test("agent-facing canvas docs use current option-based CLI syntax", async () => {
  const canvasSkill = await readFile(canvasOperationsSkillPath, "utf8");

  assert.match(canvasSkill, /clash canvas connect --project <project-id>/);
  assert.match(canvasSkill, /clash canvas get --project <project-id> --node <node-id> --json/);
  assert.match(canvasSkill, /clash canvas search --project <project-id> --query "<text>" --json/);
  assert.match(canvasSkill, /clash canvas add --project <project-id> --type text --label "<label>" --content "<text>" --json/);
  assert.match(canvasSkill, /clash canvas update --project <project-id> --node <node-id> --if-match <readToken>/);
  assert.match(canvasSkill, /clash canvas replace-asset --project <project-id> --node <media-node-id> --asset <asset-id> --if-match <readToken> --json/);
  assert.match(canvasSkill, /clash canvas delete --project <project-id> --node <node-id> --if-match <readToken> --yes --json/);
  assert.match(canvasSkill, /readToken/);
  assert.doesNotMatch(canvasSkill, /clash canvas connect <project-id>/);
  assert.doesNotMatch(canvasSkill, /clash canvas get <node-id>/);
  assert.doesNotMatch(canvasSkill, /clash canvas update <node-id>/);
  assert.doesNotMatch(canvasSkill, /clash canvas delete <node-id>/);
});

test("clash command reference exposes canvas read-token direct patch CAS", async () => {
  const commands = await readFile(clashCommandsReferencePath, "utf8");

  assert.match(commands, /clash canvas get --project <id> --node <node-id> --json/);
  assert.match(commands, /readToken/);
  assert.match(commands, /clash canvas update --project <id> --node <id> --if-match <readToken>/);
  assert.match(commands, /clash canvas delete --project <id> --node <id> --if-match <readToken> --yes --json/);
  assert.match(commands, /agent.*direct.*write/i);
});

test("clash command reference exposes media asset copy-on-write replacement", async () => {
  const commands = await readFile(clashCommandsReferencePath, "utf8");

  assert.match(commands, /clash canvas replace-asset --project <id> --node <media-node-id> --asset <asset-id> --if-match <readToken> --json/);
  assert.match(commands, /copy-on-write media node/i);
  assert.match(commands, /does not mutate existing downstream references/i);
});

test("clash command reference exposes text copy-on-write replacement", async () => {
  const commands = await readFile(clashCommandsReferencePath, "utf8");

  assert.match(commands, /clash text pull --project <id> --node <text-node-id> --json/);
  assert.match(commands, /clash text apply --project <id> --node <text-node-id> --json/);
  assert.match(commands, /clash text replace --project <id> --node <text-node-id> --json/);
  assert.match(commands, /copy-on-write text\s+node/i);
  assert.match(commands, /does not mutate existing materialized downstream checkpoints in place/i);
});

test("clash command reference exposes timeline versioned replacement", async () => {
  const commands = await readFile(clashCommandsReferencePath, "utf8");

  assert.match(commands, /clash timeline pull --project <id> --node <video-editor-node-id> --json/);
  assert.match(commands, /clash timeline apply --project <id> --node <video-editor-node-id> --json/);
  assert.match(commands, /clash timeline replace --project <id> --node <video-editor-node-id> --json/);
  assert.match(commands, /same lock as read proof/i);
  assert.match(commands, /copy-on-write video-editor node/i);
  assert.match(commands, /does not mutate existing materialized downstream renders in\s+place/i);
});

test("clash command reference exposes storyboard prompt-pack read-proof replacement", async () => {
  const commands = await readFile(clashCommandsReferencePath, "utf8");

  assert.match(commands, /clash production project-storyboard-prompt-pack --action actions\/storyboard-review\.json --out plans\/prompt-pack\.json --json/);
  assert.match(commands, /clash production apply-storyboard-prompt-pack --file plans\/prompt-pack\.json --lock plans\/prompt-pack\.lock\.json --json/);
  assert.match(commands, /clash production replace-storyboard-prompt-pack --file plans\/prompt-pack\.json --lock plans\/prompt-pack\.lock\.json --json/);
  assert.match(commands, /read step/i);
  assert.match(commands, /same lock as\s+read proof/i);
  assert.match(commands, /copy-on-write storyboard prompt-pack projection/i);
  assert.match(commands, /does not\s+mutate the existing managed projection/i);
});

test("clash command reference exposes path-bound review gate CAS", async () => {
  const commands = await readFile(clashCommandsReferencePath, "utf8");

  assert.match(commands, /clash production plan-review-gate --pipeline pipeline\.manifest\.json --stage export/);
  assert.match(commands, /clash production approve-review-gate --gate reviews\/gates\/export\.review-gate\.json --lock reviews\/gates\/export\.review-gate\.lock\.json/);
  assert.match(commands, /lock binds\s+the gate file path and gate hash/i);
  assert.match(commands, /Reusing a lock from a copied or different\s+gate file is rejected/i);
});

test("reference download schemas gate final export on redistribution and derivative rights", async () => {
  for (const schemaName of ["reference-download-plan", "reference-download-receipt"]) {
    const schema = JSON.parse(
      await readFile(path.join(repoRoot, "skills", "video-production", "schemas", `${schemaName}.schema.json`), "utf8"),
    );
    const encoded = JSON.stringify(schema.allOf ?? []);
    assert.match(encoded, /finalExportAllowed/, `${schemaName} should constrain final export`);
    assert.match(encoded, /redistributionAllowed/, `${schemaName} should require redistribution rights for final export`);
    assert.match(encoded, /derivativeAllowed/, `${schemaName} should require derivative rights for final export`);
  }
});

test("transcript cut plan schema matches the generated frame-based talking-head projection", async () => {
  const schema = JSON.parse(
    await readFile(path.join(repoRoot, "skills", "video-production", "schemas", "transcript-cut-plan.schema.json"), "utf8"),
  );
  const encoded = JSON.stringify(schema);
  const cutProperties = schema.properties?.cuts?.items?.properties ?? {};

  assert.equal(schema.properties?.kind?.const, "clash.talking-head.transcript-cut-plan.projection");
  assert.ok(
    schema.required?.includes("captionTrack"),
    "transcript cut plan must keep the structured caption projection in the same artifact",
  );
  assert.ok(cutProperties.sourceStartFrame, "cut schema should use generated sourceStartFrame fields");
  assert.ok(cutProperties.outputStartFrame, "cut schema should use generated outputStartFrame fields");
  assert.deepEqual(cutProperties.reason.enum, ["silence", "filler", "tone-particle", "repeat", "false-start", "manual"]);
  assert.doesNotMatch(encoded, /filler-word|repetition|startMs|sourceStartMs/);
});

test("timeline projection schemas require explicit node args for CAS apply", async () => {
  for (const schemaName of [
    "mg-overlay-manifest",
    "caption-overlay-projection",
    "composition-timeline-projection",
    "derived-overlay-projection",
    "mv-beat-cut-projection",
    "storyboard-timeline-projection",
  ]) {
    const schema = JSON.parse(
      await readFile(path.join(repoRoot, "skills", "video-production", "schemas", `${schemaName}.schema.json`), "utf8"),
    );
    const casApply = schema.properties?.casApply ?? {};
    const required = casApply.required ?? [];
    const encoded = JSON.stringify(casApply);

    assert.ok(required.includes("nodeIdPlaceholder"), `${schemaName} casApply must disclose the required timeline node`);
    assert.ok(required.includes("requiredRuntimeArgs"), `${schemaName} casApply must list runtime args`);
    assert.match(encoded, /<video-editor-node-id>/, `${schemaName} casApply should use a node id placeholder`);
    assert.match(encoded, /--node/, `${schemaName} pull/apply args should include --node`);
  }
});

test("reference download plan schema constrains executable command surface", async () => {
  const schema = JSON.parse(
    await readFile(path.join(repoRoot, "skills", "video-production", "schemas", "reference-download-plan.schema.json"), "utf8"),
  );
  const encoded = JSON.stringify(schema.properties?.downloadCommand ?? {});

  assert.match(encoded, /prefixItems/, "downloadCommand schema should constrain the executable prefix");
  assert.match(encoded, /yt-dlp/, "downloadCommand schema should require yt-dlp as the executable");
  assert.match(encoded, /minItems/, "downloadCommand schema should require command arguments");
  assert.match(encoded, /--exec/, "downloadCommand schema should reject yt-dlp arguments that execute local commands");
});
