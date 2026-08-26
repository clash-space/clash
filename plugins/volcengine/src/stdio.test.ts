import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Volcengine standard Provider plugin", () => {
  it("assembles distinct ModelArk, Speech, and MediaKit provider executors declared by its manifest", async () => {
    const module = await import("./stdio.js");

    expect(Object.keys(module.CONTRIBUTIONS)).toEqual([
      "volcengine-execute",
      "volcengine-speech-execute",
      "volcengine-mediakit-execute",
    ]);
    for (const contribution of module.plugin.contributes) {
      expect(contribution.kind).toBe("provider-executor");
    }
    const ids = module.plugin.contributes.map(
      (contribution: { id: string }) => contribution.id,
    );
    expect(ids).toContain("volcengine-execute");
    expect(ids).toContain("volcengine-speech-execute");
    expect(ids).toContain("volcengine-mediakit-execute");
    expect(module.CONTRIBUTIONS["volcengine-execute"]).not.toBe(
      module.CONTRIBUTIONS["volcengine-speech-execute"],
    );
    expect(module.CONTRIBUTIONS["volcengine-mediakit-execute"]).not.toBe(
      module.CONTRIBUTIONS["volcengine-execute"],
    );
  });

  it("declares MediaKit as a distinct Bearer API-key provider account, separate from ModelArk", async () => {
    const raw = await readFile(
      join(__dirname, "..", "providers", "volcengine-mediakit.json"),
      "utf8",
    );
    const mediakit = JSON.parse(raw) as {
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

    expect(mediakit.spec).toMatchObject({
      id: "volcengine-mediakit",
      upstreamId: "volcengine-mediakit",
      apiShape: "mediakit",
      executorExportId: "volcengine-mediakit-execute",
    });
    expect(mediakit.spec.auth.methods).toEqual([
      {
        id: "mediakit-api-key",
        label: "MediaKit API key",
        form: [
          {
            kind: "field",
            key: "apiKey",
            label: "MediaKit API key",
            secret: true,
          },
          {
            kind: "field",
            key: "baseUrl",
            label: "MediaKit Base URL",
            default: "https://mediakit.cn-beijing.volces.com",
          },
        ],
      },
    ]);
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
    const modelArk = await readProvider("volcengine-modelark.json");
    const speech = await readProvider("volcengine-speech.json");

    expect(modelArk.spec).toMatchObject({
      id: "volcengine-modelark",
      upstreamId: "volcengine-modelark",
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
