import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertProviderMediaFormat,
  createProviderReplayOfflineFetch,
  normalizeProviderReplayText,
  providerTestReferenceAssetId,
  providerTestExecutedNodeId,
  runProviderReplayTestHarness,
} from "./provider-replay-test-harness.js";
import { loadProviderLiveTestConfig } from "./provider-live-test-config.test-helper.js";

describe("provider replay test harness", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("defaults to credential-free offline replay", async () => {
    await expect(
      loadProviderLiveTestConfig({
        CLASH_PROVIDER_E2E_CONFIG: "/does/not/exist/provider-e2e.json",
        CLASH_MINIMAX_API_KEY: "must-not-be-read-during-replay",
      }),
    ).resolves.toEqual({
      mode: "replay",
      env: {},
    });
  });

  it("loads live credentials from a local config and lets environment variables override them", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-provider-e2e-config-"));
    temporaryRoots.push(root);
    const configPath = join(root, "provider-e2e.json");
    await writeFile(
      configPath,
      JSON.stringify({
        env: {
          CLASH_MINIMAX_API_KEY: "config-key",
          CLASH_GOOGLE_KEY: "/config/google.json",
        },
      }),
    );

    await expect(
      loadProviderLiveTestConfig({
        CLASH_PROVIDER_E2E: "live",
        CLASH_PROVIDER_E2E_CONFIG: configPath,
        CLASH_MINIMAX_API_KEY: "environment-key",
      }),
    ).resolves.toEqual({
      mode: "live",
      configPath,
      env: {
        CLASH_MINIMAX_API_KEY: "environment-key",
        CLASH_GOOGLE_KEY: "/config/google.json",
        CLASH_PROVIDER_E2E: "live",
        CLASH_PROVIDER_E2E_CONFIG: configPath,
      },
    });
  });

  it("preserves a host-command execute error instead of reporting a missing child node", () => {
    expect(() =>
      providerTestExecutedNodeId("minimax-tts", {
        error: "MiniMax TTS rejected voice_id female-warm",
      }),
    ).toThrow(
      "minimax-tts execute failed: MiniMax TTS rejected voice_id female-warm",
    );
  });

  it("keeps reference import identity stable for the same case and reference index", () => {
    const firstReplay = providerTestReferenceAssetId("case/with spaces", 0);
    const secondReplay = providerTestReferenceAssetId("case/with spaces", 0);

    expect(secondReplay).toBe(firstReplay);
    expect(providerTestReferenceAssetId("another-case", 0)).not.toBe(
      firstReplay,
    );
    expect(providerTestReferenceAssetId("case/with spaces", 1)).not.toBe(
      firstReplay,
    );
  });

  it("blocks non-loopback fetches during offline replay", async () => {
    const calls: string[] = [];
    const guarded = createProviderReplayOfflineFetch(async (input) => {
      calls.push(input instanceof Request ? input.url : String(input));
      return new Response("local");
    });

    await expect(
      guarded("http://127.0.0.1:49321/api/v1/projects"),
    ).resolves.toBeInstanceOf(Response);
    await expect(
      guarded("https://provider.example/v1/generate"),
    ).rejects.toThrow("Offline provider replay blocked network fetch");
    expect(calls).toEqual(["http://127.0.0.1:49321/api/v1/projects"]);
  });

  it("normalizes only presentation-level text differences for replay grading", () => {
    expect(normalizeProviderReplayText("你好 Clash，测试时间对齐！")).toBe(
      "你好clash测试时间对齐",
    );
    expect(normalizeProviderReplayText("ＣＬＡＳＨ\u00a0ready")).toBe(
      "clashready",
    );
    expect(normalizeProviderReplayText("结果不同")).not.toBe(
      normalizeProviderReplayText("结果相同"),
    );
  });

  it("accepts real container signatures used by provider replay assets", () => {
    expect(() =>
      assertProviderMediaFormat(
        "image/png",
        Buffer.from("89504e470d0a1a0a00000000", "hex"),
      ),
    ).not.toThrow();
    expect(() =>
      assertProviderMediaFormat(
        "image/jpeg",
        Buffer.from("ffd8ffe000104a46494600ffd9", "hex"),
      ),
    ).not.toThrow();
    expect(() =>
      assertProviderMediaFormat(
        "audio/wav",
        Buffer.from("524946462400000057415645666d7420", "hex"),
      ),
    ).not.toThrow();
    expect(() =>
      assertProviderMediaFormat(
        "audio/mpeg",
        Buffer.from("49443304000000000000", "hex"),
      ),
    ).not.toThrow();
    expect(() =>
      assertProviderMediaFormat(
        "video/mp4",
        Buffer.from("000000186674797069736f6d00000200", "hex"),
      ),
    ).not.toThrow();
  });

  it("rejects non-media bytes even when metadata claims a media MIME", () => {
    expect(() =>
      assertProviderMediaFormat("image/png", Buffer.from("not a png")),
    ).toThrow("does not contain PNG bytes");
    expect(() =>
      assertProviderMediaFormat("video/mp4", Buffer.from("not an mp4")),
    ).toThrow("does not contain an MP4 file type box");
  });

  it("grades a text fixture through Project Canvas with no provider network fallback", async () => {
    const fixturePath = join(
      import.meta.dirname,
      "fixtures/minimax-local-stand-in-traffic.jsonl",
    );
    const result = await runProviderReplayTestHarness({
      fixturePath,
      account: {
        id: "minimax-replay-harness",
        providerId: "minimax",
        upstreamId: "minimax",
        credentials: {
          apiKey: "replay-placeholder",
          service: "international",
          baseUrl: "https://minimax.stand-in.invalid",
        },
      },
      cases: [
        {
          id: "m3-text",
          type: "text_gen",
          modelId: "minimax-m3",
          prompt: "Explain this synthetic recorder fixture.",
          params: { system_prompt: "Answer in one sentence." },
          expect: {
            kind: "text",
            text: "Synthetic MiniMax M3 fixture answer.",
          },
        },
      ],
      providerAssetFetch: async () => {
        throw new Error("offline replay harness attempted provider network");
      },
    });

    expect(result.cases).toEqual([
      expect.objectContaining({
        id: "m3-text",
        kind: "text",
        text: "Synthetic MiniMax M3 fixture answer.",
        revisionId: expect.stringMatching(/^txrev-/),
      }),
    ]);
    expect(result.dataDir).toContain("clash-provider-replay-harness-");
    await expect(
      import("node:fs/promises").then(({ access }) => access(result.dataDir)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);
});
