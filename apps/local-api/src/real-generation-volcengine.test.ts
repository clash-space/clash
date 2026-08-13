import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  createPublicAssetStorageService,
  type PublicAssetStorageService,
} from "./public-asset-storage.js";
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

function trackedPublicStorage(delegate: PublicAssetStorageService): {
  service: PublicAssetStorageService;
  cleanup: () => Promise<void>;
} {
  const keys: string[] = [];
  return {
    service: {
      getPublicConfig: () => delegate.getPublicConfig(),
      updateFromRequest: (input) => delegate.updateFromRequest(input),
      testConnection: () => delegate.testConnection(),
      async publish(input) {
        const published = await delegate.publish(input);
        keys.push(published.key);
        return published;
      },
      delete: (key) => delegate.delete(key),
    },
    async cleanup() {
      await Promise.all(keys.splice(0).map((key) => delegate.delete(key)));
    },
  };
}

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
      const needsPublicStorage = cases.some((graderCase) =>
        graderCase.refs?.some((reference) => reference.kind === "video"),
      );
      const publicStorageDataDir =
        e2e.env.CLASH_PROVIDER_E2E_PUBLIC_STORAGE_DATA_DIR?.trim() ||
        e2e.env.CLASH_PROVIDER_E2E_LOCAL_DATA_DIR?.trim();
      if (needsPublicStorage && !publicStorageDataDir) {
        throw new Error(
          "Volcengine video-reference recording requires CLASH_PROVIDER_E2E_PUBLIC_STORAGE_DATA_DIR or CLASH_PROVIDER_E2E_LOCAL_DATA_DIR.",
        );
      }
      const tracked = publicStorageDataDir
        ? trackedPublicStorage(
            createPublicAssetStorageService({ dataDir: publicStorageDataDir }),
          )
        : undefined;
      if (needsPublicStorage) {
        const config = await tracked!.service.getPublicConfig();
        if (!config.available) {
          throw new Error(
            `Volcengine video-reference recording requires configured public storage in ${publicStorageDataDir}.`,
          );
        }
      }

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
        ...(tracked ? { publicAssetStorage: tracked.service } : {}),
        timeoutMs: providerTimeoutMs,
      }).finally(() => tracked?.cleanup());
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
      if (needsPublicStorage) {
        const referenceVideoUrls = requests.flatMap((event): string[] => {
          if (
            event.type !== "request" ||
            !event.request.url.endsWith("/contents/generations/tasks") ||
            !event.request.body ||
            typeof event.request.body !== "object" ||
            Array.isArray(event.request.body) ||
            !("content" in event.request.body)
          ) {
            return [];
          }
          const content = event.request.body.content;
          if (!Array.isArray(content)) return [];
          return content.flatMap((part): string[] => {
            if (
              !part ||
              typeof part !== "object" ||
              Array.isArray(part) ||
              !("role" in part) ||
              part.role !== "reference_video" ||
              !("video_url" in part) ||
              !part.video_url ||
              typeof part.video_url !== "object" ||
              Array.isArray(part.video_url) ||
              !("url" in part.video_url) ||
              typeof part.video_url.url !== "string"
            ) {
              return [];
            }
            return [part.video_url.url];
          });
        });
        expect(referenceVideoUrls).toHaveLength(
          cases.filter((graderCase) =>
            graderCase.refs?.some((reference) => reference.kind === "video"),
          ).length,
        );
        expect(referenceVideoUrls.every((url) => url.startsWith("https://")))
          .toBe(true);
        expect(referenceVideoUrls.every((url) => !url.startsWith("data:")))
          .toBe(true);
      }
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
