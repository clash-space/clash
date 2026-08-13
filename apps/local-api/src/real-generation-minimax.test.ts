import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  createMiniMaxProviderCases,
  selectMiniMaxProviderCases,
} from "./minimax-provider-e2e-cases.js";
import { runProviderLiveTestHarness } from "./provider-replay-test-harness.js";
import { readJsonlProviderTestRecording } from "./provider-test-recorder.js";
import {
  loadProviderLiveTestConfig,
  loadProviderLiveTestLocalAccount,
  providerLiveTestTimeoutMs,
} from "./provider-live-test-config.test-helper.js";

const e2e = await loadProviderLiveTestConfig(process.env);
const providerTimeoutMs = providerLiveTestTimeoutMs(e2e);
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

/**
 * Real quota is spent only after the caller opts in explicitly. The API key is
 * resolved from the process environment assembled by loadProviderLiveTestConfig;
 * normal test runs never inspect the developer's provider store or ~/.clash.
 */
describe.runIf(e2e.mode === "live")("MiniMax provider live recorder", () => {
  it(
    "records selected redacted cases through the same Project backend",
    async () => {
      const localAccount = e2e.env.CLASH_MINIMAX_API_KEY?.trim()
        ? undefined
        : await loadProviderLiveTestLocalAccount(e2e, {
            accountIdEnv: "CLASH_MINIMAX_ACCOUNT_ID",
            matches: (candidate) =>
              candidate.providerId === "minimax" &&
              (candidate.upstreamId === undefined ||
                candidate.upstreamId === "minimax"),
          });
      const apiKey =
        e2e.env.CLASH_MINIMAX_API_KEY?.trim() ||
        localAccount?.credentials?.apiKey?.trim();
      if (!apiKey) {
        throw new Error(
          "MiniMax live recording requires CLASH_MINIMAX_API_KEY or an explicitly opted-in local account",
        );
      }

      const configuredRecordingPath =
        e2e.env.CLASH_MINIMAX_RECORDING_PATH?.trim();
      let recordingPath: string;
      if (configuredRecordingPath) {
        recordingPath = resolve(configuredRecordingPath);
        await expect(access(recordingPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } else {
        const root = await mkdtemp(
          join(tmpdir(), "clash-minimax-live-recording-"),
        );
        temporaryRoots.push(root);
        recordingPath = join(root, "minimax-live-traffic.jsonl");
      }

      const service =
        e2e.env.CLASH_MINIMAX_SERVICE?.trim() ||
        localAccount?.credentials?.service?.trim() ||
        "international";
      if (service !== "international" && service !== "domestic") {
        throw new Error(
          "CLASH_MINIMAX_SERVICE must be 'international' or 'domestic'",
        );
      }

      const cases = selectMiniMaxProviderCases(
        await createMiniMaxProviderCases(),
        e2e.env.CLASH_PROVIDER_E2E_TARGETS,
      );
      const result = await runProviderLiveTestHarness({
        recordingPath,
        account: {
          id: "minimax-live-recorder",
          providerId: "minimax",
          upstreamId: "minimax",
          credentials: { apiKey, service },
        },
        cases,
        timeoutMs: providerTimeoutMs,
      });
      expect(result.cases.map(({ id }) => id)).toEqual(
        cases.map(({ id }) => id),
      );

      const raw = await readFile(recordingPath, "utf8");
      expect(raw).toContain("[redacted]");
      expect(raw).not.toContain(apiKey);
      expect(raw).not.toContain("/Users/");
      if (e2e.configPath) expect(raw).not.toContain(e2e.configPath);

      const events = await readJsonlProviderTestRecording(recordingPath);
      const requests = events.filter((event) => event.type === "request");
      expect(new Set(requests.map((event) => event.stub.modelId))).toEqual(
        new Set(cases.map(({ modelId }) => modelId)),
      );
      expect(
        requests.every(
          (event) =>
            event.request.headers.authorization === "[redacted]" ||
            !event.request.headers.authorization,
        ),
      ).toBe(true);
      const selected = new Set(cases.map(({ id }) => id));
      if (selected.has("minimax-m3")) {
        expect(
          requests.some((event) =>
            event.request.url.includes("/v1/chat/completions"),
          ),
        ).toBe(true);
      }
      if (selected.has("minimax-tts")) {
        expect(
          requests.some((event) => event.request.url.includes("/v1/t2a_v2")),
        ).toBe(true);
      }
      if (selected.has("minimax-music-3")) {
        expect(
          requests.some((event) =>
            event.request.url.includes("/v1/music_generation"),
          ),
        ).toBe(true);
      }
      const selectedVideoCases = cases.filter(({ modelId }) =>
        modelId.startsWith("minimax-h3"),
      );
      if (selectedVideoCases.length > 0) {
        expect(
          requests.filter((event) =>
            event.request.url.includes("/v2/video_generation"),
          ),
        ).toHaveLength(selectedVideoCases.length);
        expect(
          requests.filter((event) =>
            event.request.url.includes("/v2/query/video_generation/"),
          ).length,
        ).toBeGreaterThanOrEqual(selectedVideoCases.length);
      }
    },
    45 * 60_000,
  );
});
