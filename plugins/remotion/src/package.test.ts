import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import {
  generatorDefinitionFromExecutablePluginRegistration,
  resolveGeneratorProjectionDefinition,
  validateExecutablePluginPackage,
} from "@clash/shared-types";
import { describe, expect, it } from "vitest";

it("copies a portable browser bundle as a declared plugin resource", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "remotion-source-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "remotion-target-"));
  await mkdir(join(sourceRoot, "public"), { recursive: true });
  await writeFile(
    join(sourceRoot, "index.html"),
    '<script>window.remotion_cwd = "/Users/example/repo";</script>',
  );
  await writeFile(
    join(sourceRoot, "bundle.js"),
    'console.log("bundle");\n//# sourceMappingURL=bundle.js.map\n',
  );
  await writeFile(join(sourceRoot, "bundle.js.map"), "{}\n");
  await writeFile(join(sourceRoot, "public", "tone.wav"), "audio");

  const module = await import("../scripts/copy-browser-bundle.js").catch(
    () => undefined,
  );
  expect(module?.copyBrowserBundle).toBeTypeOf("function");
  if (!module?.copyBrowserBundle) return;
  await module.copyBrowserBundle({ sourceRoot, targetRoot });

  expect((await readdir(targetRoot)).sort()).toEqual([
    "bundle.js",
    "index.html",
    "public",
  ]);
  expect(await readFile(join(targetRoot, "index.html"), "utf8")).toContain(
    'window.remotion_cwd = ".";',
  );
  const copiedJavaScript = await readFile(
    join(targetRoot, "bundle.js"),
    "utf8",
  );
  expect(copiedJavaScript).toContain('console.log("bundle")');
  expect(copiedJavaScript).not.toMatch(/sourceMappingURL/);
  expect(await readFile(join(targetRoot, "public", "tone.wav"), "utf8")).toBe(
    "audio",
  );
});

describe("first-party Remotion Timeline Generator package", () => {
  it("ships the development tsconfig required by its tsx build step", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");

    expect(existsSync(join(root, "tsconfig.dev.json"))).toBe(true);
  });

  it("registers one Definition claiming the clash.timeline projection surface with a video render Action", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const manifestPath = join(root, "manifest.json");
    const generatorPath = join(root, "generators", "timeline.json");

    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(generatorPath)).toBe(true);
    if (!existsSync(manifestPath) || !existsSync(generatorPath)) return;

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const generator = JSON.parse(await readFile(generatorPath, "utf8"));
    const validated = validateExecutablePluginPackage(
      manifest,
      {},
      {},
      { generators: { "generators/timeline.json": generator } },
    );

    expect(validated.manifest).toMatchObject({
      id: "clash.remotion",
      contributes: {
        generators: [
          { id: "timeline", kind: "generator", path: "generators/timeline.json" },
        ],
      },
    });

    const definition = generatorDefinitionFromExecutablePluginRegistration({
      pluginId: validated.manifest.id,
      version: validated.manifest.version,
      schemaHash: `sha256:${"d".repeat(64)}`,
      document: validated.generators["generators/timeline.json"]!,
    });

    const resolved = resolveGeneratorProjectionDefinition(
      [definition],
      "clash.timeline",
    );
    expect(resolved).toMatchObject({
      ok: true,
      definition: {
        projectionSurface: {
          id: "clash.timeline",
          stateKey: "timeline",
          mediaInputSlot: "timeline:item",
          primaryActionId: "render",
        },
        persistentInputs: [{ slot: "timeline:item" }],
        actions: [
          {
            id: "render",
            executorExportId: "render-timeline",
            outputs: [
              { slot: "render:output", assetType: { kind: "media", mediaKind: "video" } },
            ],
          },
        ],
      },
    });
  });

  it("declares a stateSchema that validates the full timeline state envelope, not the raw DSL", async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const generatorPath = join(root, "generators", "timeline.json");
    const generator = JSON.parse(await readFile(generatorPath, "utf8"));
    const stateSchema = generator.spec.stateSchema;

    const ajv = new Ajv({ allErrors: true, strict: true });
    const validate = ajv.compile(stateSchema);

    const validEnvelope = {
      timeline: {
        name: "Rough cut",
        owner: { kind: "project" },
        state: { tracks: [] },
      },
    };
    expect(validate(validEnvelope)).toBe(true);

    const validCanvasActionOwner = {
      timeline: {
        name: "Rough cut",
        owner: {
          kind: "canvas-action",
          canvasId: "canvas-1",
          actionNodeId: "node-1",
        },
        state: { tracks: [] },
      },
    };
    expect(validate(validCanvasActionOwner)).toBe(true);

    const missingName = {
      timeline: { owner: { kind: "project" }, state: { tracks: [] } },
    };
    expect(validate(missingName)).toBe(false);

    const missingOwner = {
      timeline: { name: "Rough cut", state: { tracks: [] } },
    };
    expect(validate(missingOwner)).toBe(false);

    const missingState = {
      timeline: { name: "Rough cut", owner: { kind: "project" } },
    };
    expect(validate(missingState)).toBe(false);

    const extraEnvelopeProperty = {
      timeline: {
        name: "Rough cut",
        owner: { kind: "project" },
        state: { tracks: [] },
        extra: true,
      },
    };
    expect(validate(extraEnvelopeProperty)).toBe(false);

    const rawDslWithoutEnvelope = {
      timeline: { tracks: [] },
    };
    expect(validate(rawDslWithoutEnvelope)).toBe(false);

    const definition = generatorDefinitionFromExecutablePluginRegistration({
      pluginId: "clash.remotion",
      version: "0.1.0",
      schemaHash: `sha256:${"d".repeat(64)}`,
      document: generator,
    });
    const resolved = resolveGeneratorProjectionDefinition(
      [definition],
      "clash.timeline",
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.definition.projectionSurface?.stateKey).toBe("timeline");
  });
});
