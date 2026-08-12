import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Volcengine standard Provider plugin", () => {
  it("assembles distinct ModelArk and Speech executors declared by its manifest", async () => {
    const module = await import("./stdio.js");

    expect(Object.keys(module.CONTRIBUTIONS)).toEqual([
      "volcengine-execute",
      "volcengine-speech-execute",
    ]);
    expect(module.plugin.contributes).toEqual([
      {
        id: "volcengine-execute",
        kind: "provider-executor",
        operations: ["submit", "poll"],
      },
      {
        id: "volcengine-speech-execute",
        kind: "provider-executor",
        operations: ["submit"],
      },
    ]);
    expect(module.CONTRIBUTIONS["volcengine-execute"]).not.toBe(
      module.CONTRIBUTIONS["volcengine-speech-execute"],
    );
  });

  it("declares ModelArk and Doubao Speech as separate provider accounts", async () => {
    const readProvider = async (name: string) => JSON.parse(
      await readFile(join(__dirname, "..", "providers", name), "utf8"),
    ) as {
      spec: {
        id: string;
        upstreamId: string;
        apiShape: string;
        executorExportId: string;
        auth: {
          methods: Array<{ id: string; form: Array<Record<string, unknown>> }>;
        };
      };
    };
    const modelArk = await readProvider("volcengine.json");
    const speech = await readProvider("volcengine-speech.json");

    expect(modelArk.spec).toMatchObject({
      id: "volcengine",
      upstreamId: "volcengine",
      apiShape: "modelark",
      executorExportId: "volcengine-execute",
    });
    expect(modelArk.spec.auth.methods).toEqual([
      {
        id: "modelark-api-key",
        label: "ModelArk API key",
        form: [
          {
            kind: "field",
            key: "apiKey",
            label: "ModelArk API key",
            secret: true,
          },
          {
            kind: "field",
            key: "baseUrl",
            label: "ModelArk Base URL",
            default: "https://ark.cn-beijing.volces.com/api/v3",
          },
        ],
      },
    ]);
    expect(speech.spec).toMatchObject({
      id: "volcengine-speech",
      upstreamId: "volcengine-speech",
      apiShape: "volcengine-speech",
      executorExportId: "volcengine-speech-execute",
    });
    expect(speech.spec.auth.methods).toEqual([
      {
        id: "doubao-speech-api-key",
        label: "Doubao Speech API key",
        form: [
          {
            kind: "field",
            key: "apiKey",
            label: "Doubao Speech API key",
            secret: true,
          },
          {
            kind: "field",
            key: "baseUrl",
            label: "Doubao Speech Base URL",
            default: "https://openspeech.bytedance.com/api/v3",
          },
        ],
      },
    ]);
  });
});
