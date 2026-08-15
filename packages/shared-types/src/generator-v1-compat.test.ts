import { describe, expect, it } from "vitest";

import * as sharedTypes from "./index.js";

type GeneratorDefinition = {
  pluginId: string;
  definitionId: string;
  version: string;
  schemaHash: string;
  stateSchema: Record<string, unknown>;
  editPolicy: "advance-head" | "fork-when-materialized";
  persistentInputs: unknown[];
  actions: Array<{
    id: string;
    executorExportId: string;
    parametersSchema: Record<string, unknown>;
    invocationInputs: unknown[];
    outputs: unknown[];
  }>;
};

type CompatApi = {
  generatorDefinitionFromActionSpec?: (
    spec: unknown,
    binding: unknown,
  ) => GeneratorDefinition;
  generatorDefinitionFromExecutableActionCard?: (
    registration: unknown,
    options?: unknown,
  ) => GeneratorDefinition;
  generatorDefinitionFromCustomActionDefinition?: (
    definition: unknown,
    options?: unknown,
  ) => GeneratorDefinition;
};

const compat = sharedTypes as CompatApi;

const schemaHash = `sha256:${"c".repeat(64)}`;

function executableActionRegistration(overrides: Record<string, unknown> = {}) {
  return {
    pluginId: "acme.agent-media",
    version: "1.2.0",
    schemaHash,
    runtime: {
      kind: "local",
      transport: "stdio",
      entrypoint: "dist/handler.mjs",
    },
    document: {
      apiVersion: "clash.card/v1",
      kind: "action-card",
      spec: {
        id: "remove-background",
        name: "Remove Background",
        parameters: [
          {
            id: "softness",
            label: "Edge softness",
            type: "number",
            required: true,
            min: 0,
          },
        ],
        outputType: "image",
        input: {
          requiresPrompt: false,
          inputMode: { images: { min: 1, max: 3 } },
          promptModalities: ["image"],
        },
        functionExportId: "remove-background-executor",
      },
    },
    ...overrides,
  };
}

describe("Generator v1 compatibility", () => {
  it("maps every ActionSpec operation to the exact synthetic executor export", () => {
    expect(compat.generatorDefinitionFromActionSpec).toBeTypeOf("function");
    if (!compat.generatorDefinitionFromActionSpec) return;

    const definition = compat.generatorDefinitionFromActionSpec(
      sharedTypes.BUILT_IN_ASSET_ACTION_SPECS["video-clipper"],
      {
        pluginId: "clash.asset-edit",
        version: "1.0.0",
        exportId: "video-clipper",
        schemaHash,
      },
    );

    expect(definition).toMatchObject({
      pluginId: "clash.asset-edit",
      definitionId: "video-clipper",
      version: "1.0.0",
      schemaHash,
      editPolicy: "advance-head",
      persistentInputs: [],
      actions: [
        {
          id: "screenshot",
          executorExportId: "video-clipper",
          invocationInputs: [
            {
              slot: "source",
              accepts: [{ kind: "media", mediaKind: "video" }],
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
          outputs: [
            {
              slot: "output",
              assetType: { kind: "media", mediaKind: "image" },
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
        },
        {
          id: "crop",
          executorExportId: "video-clipper",
          invocationInputs: [
            {
              slot: "source",
              accepts: [{ kind: "media", mediaKind: "video" }],
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
          outputs: [
            {
              slot: "output",
              assetType: { kind: "media", mediaKind: "video" },
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
        },
      ],
    });
    expect(
      definition.actions.map((action) => action.executorExportId),
    ).not.toContain("client-render");
    expect(
      definition.actions.map((action) => action.executorExportId),
    ).not.toContain("server-transform");
  });

  it("requires an ActionSpec binding for the same stable definition id", () => {
    expect(compat.generatorDefinitionFromActionSpec).toBeTypeOf("function");
    if (!compat.generatorDefinitionFromActionSpec) return;

    expect(() =>
      compat.generatorDefinitionFromActionSpec!(
        sharedTypes.BUILT_IN_ASSET_ACTION_SPECS["video-clipper"],
        {
          pluginId: "clash.asset-edit",
          version: "1.0.0",
          exportId: "different-action",
          schemaHash,
        },
      ),
    ).toThrow(/binding.*video-clipper/i);
  });

  it("turns an activated Action Card into one synthetic Generator and preserves exact provenance", () => {
    expect(compat.generatorDefinitionFromExecutableActionCard).toBeTypeOf(
      "function",
    );
    if (!compat.generatorDefinitionFromExecutableActionCard) return;

    const registration = executableActionRegistration();
    const definition =
      compat.generatorDefinitionFromExecutableActionCard(registration);

    expect(definition).toMatchObject({
      pluginId: registration.pluginId,
      definitionId: "remove-background",
      version: registration.version,
      schemaHash: registration.schemaHash,
      editPolicy: "fork-when-materialized",
      persistentInputs: [],
      actions: [
        {
          id: "remove-background",
          executorExportId: "remove-background-executor",
          invocationInputs: [
            {
              slot: "images",
              accepts: [{ kind: "media", mediaKind: "image" }],
              cardinality: { minItems: 1, maxItems: 3 },
            },
          ],
          outputs: [
            {
              slot: "media",
              assetType: { kind: "media", mediaKind: "image" },
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
        },
      ],
    });
  });

  it("retains Action Card invocation parameter validation in the synthetic Action", () => {
    expect(compat.generatorDefinitionFromExecutableActionCard).toBeTypeOf(
      "function",
    );
    if (!compat.generatorDefinitionFromExecutableActionCard) return;

    const definition = compat.generatorDefinitionFromExecutableActionCard(
      executableActionRegistration(),
    );

    expect(definition.actions[0]?.parametersSchema).toEqual({
      type: "object",
      properties: {
        softness: { type: "number", minimum: 0 },
      },
      required: ["softness"],
      additionalProperties: false,
    });
  });

  it("preserves every declared v1 parameter type and the prompt requirement", () => {
    expect(compat.generatorDefinitionFromExecutableActionCard).toBeTypeOf(
      "function",
    );
    if (!compat.generatorDefinitionFromExecutableActionCard) return;

    const definition = compat.generatorDefinitionFromExecutableActionCard(
      executableActionRegistration({
        document: {
          apiVersion: "clash.card/v1",
          kind: "action-card",
          spec: {
            id: "styled-caption",
            name: "Styled Caption",
            outputType: "image",
            functionExportId: "styled-caption-executor",
            input: {
              requiresPrompt: true,
              inputMode: {},
              promptModalities: ["text"],
            },
            parameters: [
              {
                id: "style",
                label: "Style",
                type: "select",
                options: [
                  { label: "Clean", value: "clean" },
                  { label: "Bold", value: "bold" },
                ],
                defaultValue: "clean",
              },
              {
                id: "guidance",
                label: "Guidance",
                type: "slider",
                min: 0,
                max: 1,
              },
              { id: "caption", label: "Caption", type: "text" },
              {
                id: "transparent",
                label: "Transparent",
                type: "boolean",
              },
            ],
          },
        },
      }),
    );

    expect(definition.actions[0]?.parametersSchema).toEqual({
      type: "object",
      properties: {
        prompt: { type: "string" },
        style: {
          enum: ["clean", "bold"],
          default: "clean",
        },
        guidance: { type: "number", minimum: 0, maximum: 1 },
        caption: { type: "string" },
        transparent: { type: "boolean" },
      },
      required: ["prompt"],
      additionalProperties: false,
    });
  });

  it("keeps local stdio and hosted HTTP realms out of Action Card semantics", () => {
    expect(compat.generatorDefinitionFromExecutableActionCard).toBeTypeOf(
      "function",
    );
    if (!compat.generatorDefinitionFromExecutableActionCard) return;

    const local = compat.generatorDefinitionFromExecutableActionCard(
      executableActionRegistration(),
    );
    const hosted = compat.generatorDefinitionFromExecutableActionCard(
      executableActionRegistration({
        runtime: {
          kind: "hosted",
          transport: "http",
          endpoint: "https://actions.example.com/invoke",
        },
      }),
    );

    expect(hosted).toEqual(local);
    expect(local).not.toHaveProperty("runtime");
    expect(local).not.toHaveProperty("executionRealm");
  });

  it("requires an explicit typed Document contract for legacy text output", () => {
    expect(compat.generatorDefinitionFromExecutableActionCard).toBeTypeOf(
      "function",
    );
    if (!compat.generatorDefinitionFromExecutableActionCard) return;

    const registration = executableActionRegistration({
      document: {
        apiVersion: "clash.card/v1",
        kind: "action-card",
        spec: {
          id: "transcribe",
          name: "Transcribe",
          outputType: "text",
          functionExportId: "transcribe-executor",
          input: {
            requiresPrompt: false,
            inputMode: { audios: { min: 1, max: 1 } },
            promptModalities: ["audio"],
          },
        },
      },
    });

    expect(() =>
      compat.generatorDefinitionFromExecutableActionCard!(registration),
    ).toThrow(/textOutputType/i);

    const definition = compat.generatorDefinitionFromExecutableActionCard(
      registration,
      {
        textOutputType: {
          documentKind: "media.transcript",
          schemaVersion: 1,
        },
      },
    );

    expect(definition.actions[0]?.outputs).toEqual([
      {
        slot: "result",
        assetType: {
          kind: "document",
          documentKind: "media.transcript",
          schemaVersion: 1,
        },
        cardinality: { minItems: 1, maxItems: 1 },
      },
    ]);
  });

  it("adapts a plugin-backed CustomActionDefinition without leaking its runtime fields", () => {
    expect(compat.generatorDefinitionFromCustomActionDefinition).toBeTypeOf(
      "function",
    );
    if (!compat.generatorDefinitionFromCustomActionDefinition) return;

    const definition = compat.generatorDefinitionFromCustomActionDefinition({
      id: "animate-logo",
      name: "Animate Logo",
      outputType: "video",
      runtime: "worker",
      workerUrl: "https://actions.example.com/animate-logo",
      version: "2.1.0",
      pluginBinding: {
        pluginId: "acme.motion",
        version: "2.1.0",
        exportId: "animate-logo-executor",
        schemaHash,
      },
    });

    expect(definition).toMatchObject({
      pluginId: "acme.motion",
      definitionId: "animate-logo",
      version: "2.1.0",
      schemaHash,
      actions: [
        {
          id: "animate-logo",
          executorExportId: "animate-logo-executor",
          outputs: [
            {
              slot: "media",
              assetType: { kind: "media", mediaKind: "video" },
              cardinality: { minItems: 1, maxItems: 1 },
            },
          ],
        },
      ],
    });
    expect(definition).not.toHaveProperty("runtime");
    expect(definition).not.toHaveProperty("workerUrl");
  });

  it("fails closed when Custom Action provenance or output contracts are not exact", () => {
    expect(compat.generatorDefinitionFromCustomActionDefinition).toBeTypeOf(
      "function",
    );
    if (!compat.generatorDefinitionFromCustomActionDefinition) return;

    expect(() =>
      compat.generatorDefinitionFromCustomActionDefinition!({
        id: "unbound",
        name: "Unbound",
        outputType: "image",
      }),
    ).toThrow(/pluginBinding/i);

    expect(() =>
      compat.generatorDefinitionFromCustomActionDefinition!({
        id: "unknown-output",
        name: "Unknown Output",
        outputType: "archive",
        pluginBinding: {
          pluginId: "acme.archive",
          version: "1.0.0",
          exportId: "archive",
          schemaHash,
        },
      }),
    ).toThrow();

    expect(() =>
      compat.generatorDefinitionFromCustomActionDefinition!({
        id: "bare-hash",
        name: "Bare Hash",
        outputType: "image",
        pluginBinding: {
          pluginId: "acme.image",
          version: "1.0.0",
          exportId: "image",
          schemaHash: "c".repeat(64),
        },
      }),
    ).toThrow();
  });
});
