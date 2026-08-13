import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  createHiloProviderCases,
  prepareHiloProviderTestPlugin,
  selectHiloProviderCases,
} from "./hilo-provider-e2e-cases.js";
import { createLocalProviderStore } from "./local-provider-store.js";
import { defaultLocalApiDataDir } from "./local-paths.js";
import { openPluginStore } from "./plugin-store.js";
import {
  loadProviderLiveTestConfig,
  providerLiveTestTimeoutMs,
} from "./provider-live-test-config.test-helper.js";
import { runProviderLiveTestHarness } from "./provider-replay-test-harness.js";
import { readJsonlProviderTestRecording } from "./provider-test-recorder.js";

const e2e = await loadProviderLiveTestConfig(process.env);
const providerTimeoutMs = providerLiveTestTimeoutMs(e2e);
const temporaryRoots: string[] = [];

interface HiloLiveCredential {
  accountId: string;
  accessToken: string;
}

async function loadHiloLiveCredential(): Promise<HiloLiveCredential> {
  const accountId =
    e2e.env.CLASH_HILO_HUB_ACCOUNT_ID?.trim() || "hilo-hub-primary";
  const configuredToken = e2e.env.CLASH_HILO_HUB_ACCESS_TOKEN?.trim();
  if (configuredToken) return { accountId, accessToken: configuredToken };

  const dataDir = resolve(
    e2e.env.CLASH_HILO_HUB_LOCAL_DATA_DIR?.trim() ||
      e2e.env.CLASH_PROVIDER_E2E_LOCAL_DATA_DIR?.trim() ||
      defaultLocalApiDataDir(e2e.env),
  );
  const providerStore = createLocalProviderStore(dataDir);
  const account = (await providerStore.loadProviderAccounts()).find(
    (candidate) =>
      candidate.enabled &&
      candidate.id === accountId &&
      candidate.providerId === "hilo-hub",
  );
  if (!account) {
    throw new Error(
      `Hilo live recording requires enabled account ${accountId} in ${dataDir}`,
    );
  }
  const accessToken = await (
    await openPluginStore({ dataDir })
  ).get({
    pluginId: "hrhrng.hub",
    accountId,
    key: "accessToken",
  });
  if (!accessToken?.trim()) {
    throw new Error(
      `Hilo live recording account ${accountId} has no plugin accessToken`,
    );
  }
  return { accountId, accessToken };
}

afterAll(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Real quota is spent only after the caller explicitly opts into live provider E2E. */
describe.runIf(e2e.mode === "live")("Hilo Hub provider live recorder", () => {
  it(
    "records H3 image+MP3 and Seedance audio references through the Project backend",
    async () => {
      const credential = await loadHiloLiveCredential();
      const configuredRecordingPath =
        e2e.env.CLASH_HILO_HUB_RECORDING_PATH?.trim();
      let recordingPath: string;
      if (configuredRecordingPath) {
        recordingPath = resolve(configuredRecordingPath);
        await expect(access(recordingPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } else {
        const root = await mkdtemp(
          join(tmpdir(), "clash-hilo-live-recording-"),
        );
        temporaryRoots.push(root);
        recordingPath = join(root, "hilo-live-traffic.jsonl");
      }

      const cases = selectHiloProviderCases(
        await createHiloProviderCases(),
        e2e.env.CLASH_PROVIDER_E2E_TARGETS,
      );
      const result = await runProviderLiveTestHarness({
        recordingPath,
        account: {
          id: credential.accountId,
          providerId: "hilo-hub",
          upstreamId: "hilo-hub",
          credentials: { accessToken: credential.accessToken },
        },
        cases,
        preparePlugins: prepareHiloProviderTestPlugin,
        timeoutMs: providerTimeoutMs,
      });
      expect(result.cases.map(({ id }) => id)).toEqual(
        cases.map(({ id }) => id),
      );

      const raw = await readFile(recordingPath, "utf8");
      expect(raw).toContain("[redacted]");
      expect(raw).not.toContain(credential.accessToken);
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
            (!event.request.headers.authorization ||
              event.request.headers.authorization === "[redacted]") &&
            (!event.request.headers.token ||
              event.request.headers.token === "[redacted]"),
        ),
      ).toBe(true);
      expect(
        requests.filter((event) =>
          event.request.url.includes("/api/v1/files/upload"),
        ),
      ).toHaveLength(cases.length * 2);
      expect(
        requests.filter(
          (event) =>
            event.request.url.includes("/generate") &&
            !event.request.url.includes("/files/upload"),
        ),
      ).toHaveLength(cases.length);
    },
    60 * 60_000,
  );
});
