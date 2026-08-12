import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  createGoogleOmniProviderCases,
  createGoogleProviderCases,
} from "./google-provider-e2e-cases.js";
import { loadProviderLiveTestConfig } from "./provider-live-test-config.test-helper.js";
import { loadProviderLiveTestLocalAccount } from "./provider-live-test-config.test-helper.js";
import { runProviderLiveTestHarness } from "./provider-replay-test-harness.js";
import { readJsonlProviderTestRecording } from "./provider-test-recorder.js";
import { resolveStoredCredentials } from "./service-account-exchange.js";

const e2e = await loadProviderLiveTestConfig(process.env);
const temporaryRoots: string[] = [];

interface GoogleLiveCredentialSelection {
  credentials: Record<string, string>;
  secrets: string[];
}

async function googleLiveCredentials(): Promise<GoogleLiveCredentialSelection> {
  const serviceAccountPath =
    e2e.env.CLASH_GOOGLE_SERVICE_ACCOUNT_FILE?.trim() ||
    e2e.env.CLASH_GOOGLE_KEY?.trim();
  if (serviceAccountPath) {
    const serviceAccountKey = await readFile(
      resolve(serviceAccountPath),
      "utf8",
    );
    const credentials = await resolveStoredCredentials({
      serviceAccountKey,
      service: "agent-platform",
      region: "global",
    });
    return {
      // The isolated harness uses one map both to satisfy route eligibility (which correctly
      // recognises the configured serviceAccountKey method) and as the scoped runtime store.
      // Keep the configured key alongside the derived short-lived values for that test-only gate;
      // clash.google reads accessToken first and never requests serviceAccountKey.
      credentials: { ...credentials, serviceAccountKey },
      secrets: [serviceAccountKey, credentials.accessToken!],
    };
  }

  const apiKey = e2e.env.CLASH_GOOGLE_API_KEY?.trim();
  if (apiKey) {
    return {
      credentials: {
        apiKey,
        service: e2e.env.CLASH_GOOGLE_SERVICE?.trim() || "ai-studio",
        region: e2e.env.CLASH_GOOGLE_REGION?.trim() || "global",
      },
      secrets: [apiKey],
    };
  }

  const account = await loadProviderLiveTestLocalAccount(e2e, {
    accountIdEnv: "CLASH_GOOGLE_ACCOUNT_ID",
    matches: (candidate) =>
      candidate.providerId === "google" ||
      (candidate.providerId === "official" &&
        candidate.upstreamId === "google-ai-studio"),
  });
  const storedCredentials = { ...(account?.credentials ?? {}) };
  let credentials = { ...storedCredentials };
  const credential =
    credentials.serviceAccountKey?.trim() || credentials.apiKey?.trim();
  if (!credential) {
    throw new Error(
      "Google live recording requires CLASH_GOOGLE_SERVICE_ACCOUNT_FILE, " +
        "CLASH_GOOGLE_API_KEY, or an explicitly opted-in local account",
    );
  }
  credentials.service ??= credentials.serviceAccountKey
    ? "agent-platform"
    : "ai-studio";
  credentials.region ??= account?.region ?? "global";
  if (e2e.env.CLASH_GOOGLE_SERVICE?.trim()) {
    credentials.service = e2e.env.CLASH_GOOGLE_SERVICE.trim();
  }
  if (e2e.env.CLASH_GOOGLE_REGION?.trim()) {
    credentials.region = e2e.env.CLASH_GOOGLE_REGION.trim();
  }
  credentials = await resolveStoredCredentials(credentials);
  if (storedCredentials.serviceAccountKey) {
    credentials.serviceAccountKey = storedCredentials.serviceAccountKey;
  }
  return {
    credentials,
    secrets: [credential, credentials.accessToken].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
  };
}

function selectedCases<T extends { id: string }>(cases: readonly T[]): T[] {
  const raw = e2e.env.CLASH_PROVIDER_E2E_TARGETS?.trim();
  if (!raw) return [...cases];
  const targets = new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return cases.filter((candidate) => targets.has(candidate.id));
}

afterAll(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

/**
 * Opt-in real quota run. Normal Vitest never opens a credential file, reads ~/.clash,
 * or reaches Google; it uses google-backend.e2e.test.ts and the checked-in JSONL instead.
 */
describe.runIf(e2e.mode === "live")("Google provider live recorder", () => {
  it(
    "records text, image, TTS, ASR, and Veo families through the Project backend",
    async () => {
      const cases = selectedCases(await createGoogleProviderCases());
      if (cases.length === 0) return;
      const credentialSelection = await googleLiveCredentials();

      const configuredRecordingPath =
        e2e.env.CLASH_GOOGLE_RECORDING_PATH?.trim();
      let recordingPath: string;
      if (configuredRecordingPath) {
        recordingPath = resolve(configuredRecordingPath);
        await expect(access(recordingPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } else {
        const root = await mkdtemp(
          join(tmpdir(), "clash-google-live-recording-"),
        );
        temporaryRoots.push(root);
        recordingPath = join(root, "google-live-traffic.jsonl");
      }

      const result = await runProviderLiveTestHarness({
        recordingPath,
        account: {
          id: "google-live-recorder",
          providerId: "official",
          upstreamId: "google-ai-studio",
          region: "global",
          credentials: credentialSelection.credentials,
        },
        cases,
        timeoutMs: 20 * 60_000,
      });
      expect(result.cases).toHaveLength(cases.length);

      const raw = await readFile(recordingPath, "utf8");
      expect(raw).toContain("[redacted]");
      for (const secret of credentialSelection.secrets) {
        expect(raw).not.toContain(secret);
      }
      expect(raw).not.toContain("private_key");
      expect(raw).not.toContain("/Users/");
      if (e2e.configPath) expect(raw).not.toContain(e2e.configPath);

      const events = await readJsonlProviderTestRecording(recordingPath);
      const requests = events.filter((event) => event.type === "request");
      expect(new Set(requests.map((event) => event.stub.modelId))).toEqual(
        new Set(cases.map((candidate) => candidate.modelId)),
      );
      expect(
        requests.every(
          (event) =>
            event.request.headers.authorization === "[redacted]" ||
            !event.request.headers.authorization,
        ),
      ).toBe(true);
      if (cases.some((candidate) => candidate.type !== "video_gen")) {
        expect(
          requests.some((event) =>
            event.request.url.endsWith(":generateContent"),
          ),
        ).toBe(true);
      }
      const videoCases = cases.filter(
        (candidate) => candidate.type === "video_gen",
      );
      expect(
        requests.filter((event) =>
          event.request.url.endsWith(":predictLongRunning"),
        ),
      ).toHaveLength(videoCases.length);
      if (videoCases.length > 0) {
        expect(
          requests.filter((event) =>
            event.request.url.endsWith(":fetchPredictOperation"),
          ).length,
        ).toBeGreaterThanOrEqual(videoCases.length);
      }
    },
    45 * 60_000,
  );

  it(
    "records Gemini Omni through the Interactions API",
    async () => {
      const cases = selectedCases(createGoogleOmniProviderCases());
      if (cases.length === 0) return;
      const credentialSelection = await googleLiveCredentials();
      const configuredRecordingPath =
        e2e.env.CLASH_GOOGLE_OMNI_RECORDING_PATH?.trim();
      let recordingPath: string;
      if (configuredRecordingPath) {
        recordingPath = resolve(configuredRecordingPath);
        await expect(access(recordingPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } else {
        const root = await mkdtemp(
          join(tmpdir(), "clash-google-omni-live-recording-"),
        );
        temporaryRoots.push(root);
        recordingPath = join(root, "google-omni-live-traffic.jsonl");
      }

      const result = await runProviderLiveTestHarness({
        recordingPath,
        account: {
          id: "google-omni-live-recorder",
          providerId: "official",
          upstreamId: "google-ai-studio",
          region: "global",
          credentials: credentialSelection.credentials,
        },
        cases,
        timeoutMs: 20 * 60_000,
      });
      expect(result.cases).toHaveLength(1);

      const raw = await readFile(recordingPath, "utf8");
      expect(raw).toContain("[redacted]");
      for (const secret of credentialSelection.secrets) {
        expect(raw).not.toContain(secret);
      }
      expect(raw).not.toContain("private_key");
      expect(raw).not.toContain("/Users/");
      const events = await readJsonlProviderTestRecording(recordingPath);
      const requests = events.filter((event) => event.type === "request");
      expect(
        requests.some((event) => event.request.url.endsWith("/interactions")),
      ).toBe(true);
      expect(
        requests.some((event) => /\/interactions\//.test(event.request.url)),
      ).toBe(true);
    },
    45 * 60_000,
  );
});
