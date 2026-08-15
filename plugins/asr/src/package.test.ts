import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateExecutablePluginPackage } from "@clash/shared-types";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("first-party ASR Generator package", () => {
  it("packages every declarative artifact with a TypeScript-only build", async () => {
    for (const relativePath of [
      "package.json",
      "tsconfig.json",
      "tsconfig.dev.json",
      "tsup.config.ts",
      "vitest.config.ts",
      "agents.json",
    ]) {
      expect(existsSync(join(root, relativePath)), relativePath).toBe(true);
    }
    if (!existsSync(join(root, "package.json"))) return;

    const packageJson = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    );
    expect(packageJson).toMatchObject({
      name: "@clash-plugin/asr",
      type: "module",
      exports: {
        "./manifest.json": "./manifest.json",
        "./stdio": "./dist/stdio.mjs",
      },
      scripts: { build: "tsup", test: "vitest run" },
    });
    expect(packageJson.files).toEqual([
      "manifest.json",
      "generators",
      "contract-tests",
      "dist",
      "agents.json",
    ]);
  });

  it("declares one speech-analysis Generator with an exact media input and typed transcript output", async () => {
    const manifestPath = join(root, "manifest.json");
    const generatorPath = join(root, "generators", "speech-analysis.json");
    const contractPath = join(root, "contract-tests", "transcribe.json");

    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(generatorPath)).toBe(true);
    expect(existsSync(contractPath)).toBe(true);
    if (
      !existsSync(manifestPath) ||
      !existsSync(generatorPath) ||
      !existsSync(contractPath)
    ) {
      return;
    }

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const generator = JSON.parse(await readFile(generatorPath, "utf8"));
    const contract = JSON.parse(await readFile(contractPath, "utf8"));
    const validated = validateExecutablePluginPackage(
      manifest,
      {},
      { "contract-tests/transcribe.json": contract },
      {
        generators: {
          "generators/speech-analysis.json": generator,
        },
      },
    );

    expect(validated.manifest).toMatchObject({
      id: "clash.asr",
      runtime: {
        kind: "local",
        transport: "stdio",
        entrypoint: "dist/stdio.mjs",
      },
      contributes: {
        generators: [
          {
            id: "speech-analysis",
            kind: "generator",
            path: "generators/speech-analysis.json",
          },
        ],
        functions: [
          {
            id: "transcribe",
            kind: "action",
            operations: ["submit", "poll"],
          },
        ],
        hostTools: ["speech.transcribe"],
      },
    });
    expect(validated.manifest).not.toHaveProperty("permissions");
    expect(generator).toMatchObject({
      apiVersion: "clash.generator/v1",
      kind: "generator",
      spec: {
        definitionId: "speech-analysis",
        editPolicy: "advance-head",
        persistentInputs: [],
        actions: [
          {
            id: "transcribe",
            executorExportId: "transcribe",
            invocationInputs: [
              {
                slot: "source",
                accepts: [
                  { kind: "media", mediaKind: "audio" },
                  { kind: "media", mediaKind: "video" },
                ],
                cardinality: { minItems: 1, maxItems: 1 },
              },
            ],
            outputs: [
              {
                slot: "transcript",
                assetType: {
                  kind: "document",
                  documentKind: "media.transcript",
                  schemaVersion: 1,
                },
                cardinality: { minItems: 1, maxItems: 1 },
              },
            ],
          },
        ],
      },
    });
  });

  it("keeps the canonical model in Generator state and freezes language as an Action parameter", async () => {
    const generator = JSON.parse(
      await readFile(join(root, "generators", "speech-analysis.json"), "utf8"),
    );
    const contract = JSON.parse(
      await readFile(join(root, "contract-tests", "transcribe.json"), "utf8"),
    );

    expect(generator.spec.stateSchema).toEqual({
      type: "object",
      properties: {
        modelId: { type: "string", minLength: 1 },
      },
      required: ["modelId"],
      additionalProperties: false,
    });
    expect(generator.spec.actions[0].parametersSchema).toEqual({
      type: "object",
      properties: {
        language: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    });
    expect(contract.input.values).toEqual({
      modelId: "sensevoice-small-asr",
      language: "en",
    });
    expect(contract.brokerFixtures[0].operation.modelId).toBe(
      "sensevoice-small-asr",
    );
  });

  it("runs a completed transcription as an inert PluginModule with one typed Document output", async () => {
    const sourcePath = join(root, "src", "stdio.ts");
    expect(existsSync(sourcePath)).toBe(true);
    if (!existsSync(sourcePath)) return;

    const asr = (await import(pathToFileURL(sourcePath).href)) as {
      plugin?: {
        invoke(
          invocation: Record<string, unknown>,
          context: Record<string, unknown>,
        ): Promise<unknown>;
        start?: unknown;
      };
    };
    expect(asr.plugin).toBeDefined();
    if (!asr.plugin) return;
    expect(asr.plugin.start).toBeUndefined();

    const reference = {
      slot: "source",
      index: 0,
      asset: {
        assetId: "audio-1",
        uri: "clash-asset://audio-1",
        kind: "audio" as const,
        mediaType: "audio/wav",
      },
    };
    const transcript = {
      schemaVersion: 1 as const,
      kind: "clash.asr.timed-transcript" as const,
      timebase: "milliseconds" as const,
      alignment: "word" as const,
      text: "hello",
      backendId: "funasr",
      modelId: "sensevoice-small-asr",
      language: "en",
      durationMs: 480,
      words: [{ id: "word-1", text: "hello", startMs: 40, endMs: 480 }],
      segments: [
        {
          id: "segment-1",
          text: "hello",
          startMs: 40,
          endMs: 480,
          wordIds: ["word-1"],
        },
      ],
    };
    let hostRequest: unknown;

    await expect(
      asr.plugin.invoke(
        {
          protocol: "clash.plugin.invoke/v1",
          invocationId: "invocation-1",
          taskId: "task-1",
          projectId: "project-1",
          target: {
            pluginId: "clash.asr",
            version: "0.1.0",
            exportId: "transcribe",
            schemaHash: `sha256:${"a".repeat(64)}`,
            kind: "action",
          },
          input: {
            values: { modelId: "sensevoice-small-asr", language: "en" },
            references: [reference],
          },
          assetInputs: [],
          actor: { kind: "agent", id: "agent-1" },
          operation: "submit",
        },
        {
          hostTools: {
            speechTranscribe: async (request: unknown) => {
              hostRequest = request;
              return { status: "completed", transcript };
            },
          },
        },
      ),
    ).resolves.toEqual({
      protocol: "clash.plugin.result/v1",
      invocationId: "invocation-1",
      status: "completed",
      outputs: [
        {
          slot: "transcript",
          kind: "document",
          document: {
            documentKind: "media.transcript",
            schemaVersion: 1,
            body: transcript,
          },
        },
      ],
    });
    expect(hostRequest).toEqual({
      reference,
      modelId: "sensevoice-small-asr",
      language: "en",
    });
  });

  it("maps Host acceptance into durable poll state and resumes through the same Action export", async () => {
    const asr = (await import("./stdio.js")) as {
      plugin: {
        invoke(
          invocation: Record<string, unknown>,
          context: Record<string, unknown>,
        ): Promise<unknown>;
      };
    };
    const reference = {
      slot: "source",
      index: 0,
      asset: {
        assetId: "video-1",
        uri: "clash-asset://video-1",
        kind: "video" as const,
        mediaType: "video/mp4",
      },
    };
    const transcript = {
      schemaVersion: 1 as const,
      kind: "clash.asr.timed-transcript" as const,
      timebase: "milliseconds" as const,
      alignment: "word" as const,
      text: "hello",
      backendId: "google-cloud-speech",
      modelId: "chirp-3-asr",
      durationMs: 620,
      words: [{ id: "word-1", text: "hello", startMs: 100, endMs: 620 }],
      segments: [
        {
          id: "segment-1",
          text: "hello",
          startMs: 100,
          endMs: 620,
          wordIds: ["word-1"],
        },
      ],
    };
    const requests: unknown[] = [];
    const hostTools = {
      speechTranscribe: async (request: Record<string, unknown>) => {
        requests.push(request);
        return "poll" in request
          ? { status: "completed" as const, transcript }
          : {
              status: "accepted" as const,
              poll: { upstreamTaskId: "speech-1" },
              retryAfterMs: 2_000,
            };
      },
    };
    const invocation = {
      protocol: "clash.plugin.invoke/v1",
      invocationId: "invocation-submit",
      taskId: "task-1",
      projectId: "project-1",
      target: {
        pluginId: "clash.asr",
        version: "0.1.0",
        exportId: "transcribe",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "action",
      },
      input: {
        values: { modelId: "chirp-3-asr" },
        references: [reference],
      },
      assetInputs: [],
      actor: { kind: "agent", id: "agent-1" },
      operation: "submit",
    };

    await expect(
      asr.plugin.invoke(invocation, { hostTools }),
    ).resolves.toMatchObject({
      invocationId: "invocation-submit",
      status: "accepted",
      pollState: { upstreamTaskId: "speech-1" },
      retryAfterMs: 2_000,
    });
    await expect(
      asr.plugin.invoke(
        {
          ...invocation,
          invocationId: "invocation-poll",
          operation: "poll",
          pollState: { upstreamTaskId: "speech-1" },
        },
        { hostTools },
      ),
    ).resolves.toMatchObject({
      invocationId: "invocation-poll",
      status: "completed",
      outputs: [
        {
          slot: "transcript",
          kind: "document",
          document: {
            documentKind: "media.transcript",
            schemaVersion: 1,
            body: transcript,
          },
        },
      ],
    });
    expect(requests).toEqual([
      { reference, modelId: "chirp-3-asr" },
      {
        reference,
        modelId: "chirp-3-asr",
        poll: { upstreamTaskId: "speech-1" },
      },
    ]);
  });

  it("rejects an invalid timed transcript before creating a Document output", async () => {
    const { plugin } = await import("./stdio.js");
    const reference = {
      slot: "source",
      index: 0,
      asset: {
        assetId: "audio-1",
        uri: "clash-asset://audio-1",
        kind: "audio" as const,
        mediaType: "audio/wav",
      },
    };

    await expect(
      plugin.invoke(
        {
          protocol: "clash.plugin.invoke/v1",
          invocationId: "invocation-invalid-transcript",
          taskId: "task-1",
          projectId: "project-1",
          target: {
            pluginId: "clash.asr",
            version: "0.1.0",
            exportId: "transcribe",
            schemaHash: `sha256:${"a".repeat(64)}`,
            kind: "action",
          },
          input: {
            values: { modelId: "sensevoice-small-asr" },
            references: [reference],
          },
          assetInputs: [],
          actor: { kind: "agent", id: "agent-1" },
          operation: "submit",
        },
        {
          hostTools: {
            speechTranscribe: async () =>
              ({
                status: "completed",
                transcript: {
                  schemaVersion: 1,
                  kind: "clash.asr.timed-transcript",
                  timebase: "milliseconds",
                  alignment: "word",
                  text: "hello",
                  backendId: "funasr",
                  modelId: "sensevoice-small-asr",
                  durationMs: 1,
                  words: [
                    {
                      id: "word-1",
                      text: "hello",
                      startMs: 0,
                      endMs: 0,
                    },
                  ],
                  segments: [],
                },
              }) as never,
          },
        },
      ),
    ).rejects.toThrow(/ASR word endMs must be greater than startMs/i);
  });

  it("rejects anything other than one frozen audio or video source reference", async () => {
    const { plugin } = await import("./stdio.js");
    let hostCalled = false;

    await expect(
      plugin.invoke(
        {
          protocol: "clash.plugin.invoke/v1",
          invocationId: "invocation-image-source",
          taskId: "task-1",
          projectId: "project-1",
          target: {
            pluginId: "clash.asr",
            version: "0.1.0",
            exportId: "transcribe",
            schemaHash: `sha256:${"a".repeat(64)}`,
            kind: "action",
          },
          input: {
            values: { modelId: "sensevoice-small-asr" },
            references: [
              {
                slot: "source",
                index: 0,
                asset: {
                  assetId: "image-1",
                  uri: "clash-asset://image-1",
                  kind: "image",
                  mediaType: "image/png",
                },
              },
            ],
          },
          assetInputs: [],
          actor: { kind: "agent", id: "agent-1" },
          operation: "submit",
        },
        {
          hostTools: {
            speechTranscribe: async () => {
              hostCalled = true;
              return {
                status: "accepted",
                poll: { upstreamTaskId: "must-not-run" },
              };
            },
          },
        },
      ),
    ).rejects.toThrow(/exactly one audio or video source/i);
    expect(hostCalled).toBe(false);
  });
});
