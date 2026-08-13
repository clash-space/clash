import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  loadProviderLiveTestConfig,
  loadProviderLiveTestLocalAccount,
  providerLiveTestTimeoutMs,
} from "./provider-live-test-config.test-helper.js";
import { runProviderLiveTestHarness } from "./provider-replay-test-harness.js";
import { readJsonlProviderTestRecording } from "./provider-test-recorder.js";
import {
  createVolcengineModelArkCases,
  createVolcengineSeedAudioCases,
  selectVolcengineProviderCases,
} from "./volcengine-provider-e2e-cases.js";

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

describe.runIf(e2e.mode === "live")("Volcengine provider live recorder", () => {
  it(
    "records every Seedance 2.0 and 2.5 input mode through the Project backend",
    async () => {
      const localAccount = e2e.env.CLASH_VOLCENGINE_API_KEY?.trim()
        ? undefined
        : await loadProviderLiveTestLocalAccount(e2e, {
            accountIdEnv: "CLASH_VOLCENGINE_ACCOUNT_ID",
            matches: (candidate) =>
              candidate.providerId === "volcengine" &&
              (candidate.upstreamId === undefined ||
                candidate.upstreamId === "volcengine") &&
              !!candidate.credentials?.apiKey,
          });
      const apiKey =
        e2e.env.CLASH_VOLCENGINE_API_KEY?.trim() ||
        localAccount?.credentials?.apiKey?.trim();
      if (!apiKey) {
        throw new Error(
          "Volcengine ModelArk live recording requires CLASH_VOLCENGINE_API_KEY or an explicitly opted-in local account",
        );
      }

      const configuredRecordingPath =
        e2e.env.CLASH_VOLCENGINE_MODELARK_RECORDING_PATH?.trim();
      let recordingPath: string;
      if (configuredRecordingPath) {
        recordingPath = resolve(configuredRecordingPath);
        await expect(access(recordingPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } else {
        const root = await mkdtemp(
          join(tmpdir(), "clash-volcengine-modelark-live-recording-"),
        );
        temporaryRoots.push(root);
        recordingPath = join(root, "volcengine-modelark-live-traffic.jsonl");
      }

      const cases = selectVolcengineProviderCases(
        await createVolcengineModelArkCases(),
        e2e.env.CLASH_PROVIDER_E2E_TARGETS,
      );
      const result = await runProviderLiveTestHarness({
        recordingPath,
        account: {
          id: localAccount?.id ?? "volcengine-modelark-live-recorder",
          providerId: "volcengine",
          upstreamId: "volcengine",
          credentials: { apiKey },
        },
        cases,
        bundledPluginIds: ["clash.volcengine"],
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
      expect(
        requests.filter(
          (event) =>
            event.request.method === "POST" &&
            event.request.url.endsWith("/contents/generations/tasks"),
        ),
      ).toHaveLength(cases.length);
      expect(
        requests.every(
          (event) =>
            !event.request.headers.authorization ||
            event.request.headers.authorization === "[redacted]",
        ),
      ).toBe(true);
    },
    60 * 60_000,
  );

  it(
    "records every Seed Audio input mode through the Project backend",
    async () => {
      const localAccount = e2e.env.CLASH_VOLCENGINE_SPEECH_API_KEY?.trim()
        ? undefined
        : await loadProviderLiveTestLocalAccount(e2e, {
            accountIdEnv: "CLASH_VOLCENGINE_SPEECH_ACCOUNT_ID",
            matches: (candidate) =>
              candidate.providerId === "volcengine-speech" &&
              (candidate.upstreamId === undefined ||
                candidate.upstreamId === "volcengine-speech") &&
              !!candidate.credentials?.apiKey,
          });
      const apiKey =
        e2e.env.CLASH_VOLCENGINE_SPEECH_API_KEY?.trim() ||
        localAccount?.credentials?.apiKey?.trim();
      if (!apiKey) {
        throw new Error(
          "Volcengine live recording requires CLASH_VOLCENGINE_SPEECH_API_KEY or an explicitly opted-in local account",
        );
      }

      const configuredRecordingPath =
        e2e.env.CLASH_VOLCENGINE_SPEECH_RECORDING_PATH?.trim() ||
        e2e.env.CLASH_VOLCENGINE_RECORDING_PATH?.trim();
      let recordingPath: string;
      if (configuredRecordingPath) {
        recordingPath = resolve(configuredRecordingPath);
        await expect(access(recordingPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } else {
        const root = await mkdtemp(
          join(tmpdir(), "clash-volcengine-live-recording-"),
        );
        temporaryRoots.push(root);
        recordingPath = join(root, "volcengine-seed-audio-live-traffic.jsonl");
      }

      const cases = selectVolcengineProviderCases(
        await createVolcengineSeedAudioCases(),
        e2e.env.CLASH_PROVIDER_E2E_TARGETS,
      );
      const result = await runProviderLiveTestHarness({
        recordingPath,
        account: {
          id: localAccount?.id ?? "volcengine-live-recorder",
          providerId: "volcengine-speech",
          upstreamId: "volcengine-speech",
          credentials: { apiKey },
        },
        cases,
        bundledPluginIds: ["clash.volcengine"],
        timeoutMs: providerTimeoutMs,
      });
      expect(result.cases.map(({ id }) => id).sort()).toEqual(
        cases.map(({ id }) => id).sort(),
      );

      const raw = await readFile(recordingPath, "utf8");
      expect(raw).toContain("[redacted]");
      expect(raw).not.toContain(apiKey);
      expect(raw).not.toContain("/Users/");
      if (e2e.configPath) expect(raw).not.toContain(e2e.configPath);

      const events = await readJsonlProviderTestRecording(recordingPath);
      const requests = events.filter((event) => event.type === "request");
      expect(requests).toHaveLength(cases.length);
      expect(
        requests.every(
          (event) =>
            event.request.url.endsWith("/api/v3/tts/create") &&
            event.request.headers["x-api-key"] === "[redacted]",
        ),
      ).toBe(true);
    },
    45 * 60_000,
  );
});
