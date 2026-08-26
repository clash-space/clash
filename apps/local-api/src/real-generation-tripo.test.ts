import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  createTripoProviderCases,
  selectTripoProviderCases,
} from "./tripo-provider-e2e-cases.js";
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
 * Real quota is spent only after the caller opts in explicitly. The API key is resolved from
 * the process environment assembled by loadProviderLiveTestConfig, or an explicitly opted-in
 * local Tripo account; normal test runs never inspect the developer's provider store or
 * ~/.clash, and this suite never sends a request itself outside describe.runIf("live").
 */
describe.runIf(e2e.mode === "live")("Tripo provider live recorder", () => {
  it(
    "records selected redacted cases through the same Project backend, humanoid before auto-rig",
    async () => {
      const localAccount = e2e.env.CLASH_TRIPO_API_KEY?.trim()
        ? undefined
        : await loadProviderLiveTestLocalAccount(e2e, {
            accountIdEnv: "CLASH_TRIPO_ACCOUNT_ID",
            matches: (candidate) =>
              candidate.providerId === "tripo" &&
              (candidate.upstreamId === undefined ||
                candidate.upstreamId === "tripo"),
          });
      const apiKey =
        e2e.env.CLASH_TRIPO_API_KEY?.trim() ||
        localAccount?.credentials?.apiKey?.trim();
      if (!apiKey) {
        throw new Error(
          "Tripo live recording requires CLASH_TRIPO_API_KEY or an explicitly opted-in local account",
        );
      }

      const configuredRecordingPath = e2e.env.CLASH_TRIPO_RECORDING_PATH?.trim();
      let recordingPath: string;
      if (configuredRecordingPath) {
        recordingPath = resolve(configuredRecordingPath);
        await expect(access(recordingPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } else {
        const root = await mkdtemp(join(tmpdir(), "clash-tripo-live-recording-"));
        temporaryRoots.push(root);
        recordingPath = join(root, "tripo-live-traffic.jsonl");
      }

      const region =
        e2e.env.CLASH_TRIPO_REGION?.trim() ||
        localAccount?.region?.trim() ||
        "international";
      if (region !== "international" && region !== "china") {
        throw new Error("CLASH_TRIPO_REGION must be 'international' or 'china'");
      }

      const cases = selectTripoProviderCases(
        await createTripoProviderCases(),
        e2e.env.CLASH_PROVIDER_E2E_TARGETS,
      );
      // Sequential dependency, not a parallelizable set: tripo-auto-rig's refCaseIds always
      // resolve tripo-h31-humanoid's produced model, so it must never run before or without it.
      const autoRigIndex = cases.findIndex(({ id }) => id === "tripo-auto-rig");
      if (autoRigIndex !== -1) {
        const humanoidIndex = cases.findIndex(
          ({ id }) => id === "tripo-h31-humanoid",
        );
        expect(humanoidIndex).toBeGreaterThanOrEqual(0);
        expect(humanoidIndex).toBeLessThan(autoRigIndex);
      }

      const result = await runProviderLiveTestHarness({
        recordingPath,
        account: {
          id: "tripo-live-recorder",
          providerId: "tripo",
          upstreamId: "tripo",
          region,
          credentials: { apiKey },
        },
        cases,
        // Explicit: this suite only ever exercises Tripo, so avoid the default fallback that
        // would otherwise build every bundled plugin.
        bundledPluginIds: ["clash.tripo"],
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
      if (selected.has("tripo-h31-humanoid")) {
        expect(
          requests.some((event) =>
            event.request.url.includes("/generation/text-to-model"),
          ),
        ).toBe(true);
      }
      if (selected.has("tripo-auto-rig")) {
        expect(
          requests.some((event) =>
            event.request.url.includes("/animations/rig"),
          ),
        ).toBe(true);
      }
    },
    45 * 60_000,
  );
});
