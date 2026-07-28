import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createLocalApiApp } from "../src/app.js";
import { defaultLocalApiDataDir } from "../src/local-paths.js";
import { createLocalProviderStore } from "../src/local-provider-store.js";
import {
  createProviderConformanceStubs,
  createProviderTestReplayFetch,
  createProviderTestReplayFixtures,
  filterProviderTestReplayFixturesForStub,
  readJsonlProviderTestRecording,
  type ProviderTestReplayFixture,
} from "../src/provider-test-recorder.js";

interface ProviderAccountRow {
  id?: string;
  userId?: string;
  providerId: string;
  upstreamId?: string;
  region?: string;
  enabled?: boolean;
}

interface Target {
  modelId: string;
  shape: "text" | "image" | "video";
}

const DEFAULT_TARGETS: Target[] = [
  { modelId: "gemini-3.5-flash", shape: "text" },
  { modelId: "gemini-3.1-pro", shape: "text" },
  { modelId: "gemini-3-flash", shape: "text" },
  { modelId: "gemini-3.1-flash-lite", shape: "text" },
  { modelId: "nano-banana-2", shape: "image" },
  { modelId: "nano-banana-2-lite", shape: "image" },
  { modelId: "nano-banana-pro", shape: "image" },
  { modelId: "veo-3.1", shape: "video" },
  { modelId: "veo-3.1-fast", shape: "video" },
  { modelId: "veo-3.1-lite", shape: "video" },
];

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function defaultRecordingPath(): string {
  return join(process.cwd(), ".tmp", "provider-recordings", "google-agent-platform-sota.jsonl");
}

function selectedTargets(): Target[] {
  const only = process.argv
    .flatMap((arg, index, all) => arg === "--target" && all[index + 1] ? [all[index + 1]] : [])
    .filter(Boolean);
  if (!only.length) return DEFAULT_TARGETS;
  const known = new Map(DEFAULT_TARGETS.map((target) => [target.modelId, target]));
  return only.map((modelId) => {
    const target = known.get(modelId);
    if (!target) throw new Error(`Unknown Google Agent Platform conformance target: ${modelId}`);
    return target;
  });
}

async function loadProviderAccounts(dataDir: string): Promise<ProviderAccountRow[]> {
  return createLocalProviderStore(dataDir).loadProviderAccounts();
}

function googleAgentPlatformAccount(accounts: readonly ProviderAccountRow[], userId: string): ProviderAccountRow {
  const account = accounts.find((row) =>
    (row.userId ?? userId) === userId &&
    row.providerId === "official" &&
    row.upstreamId === "google-agent-platform" &&
    (row.region ?? "global") === "global"
  );
  if (!account) {
    throw new Error(`No official/google-agent-platform/global provider account found for user ${userId}`);
  }
  return account;
}

async function replayFixtures(recordingPath: string): Promise<ProviderTestReplayFixture[]> {
  if (!existsSync(recordingPath)) return [];
  const events = await readJsonlProviderTestRecording(recordingPath);
  return createProviderTestReplayFixtures(events);
}

function stubIdForTarget(target: Target): string {
  const stub = createProviderConformanceStubs().find((candidate) =>
    candidate.providerId === "official" &&
    candidate.upstreamId === "google-agent-platform" &&
    (candidate.region ?? "global") === "global" &&
    candidate.modelId === target.modelId &&
    candidate.shape === target.shape
  );
  if (!stub) throw new Error(`No conformance stub for ${target.modelId} (${target.shape})`);
  return stub.id;
}

function providerPayload(account: ProviderAccountRow): ProviderAccountRow {
  return {
    ...(account.id ? { id: account.id } : {}),
    providerId: account.providerId,
    ...(account.upstreamId ? { upstreamId: account.upstreamId } : {}),
    region: account.region ?? "global",
    enabled: account.enabled !== false,
  };
}

function compactResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const result = value as Record<string, unknown>;
  const output = result.output && typeof result.output === "object"
    ? { ...(result.output as Record<string, unknown>) }
    : undefined;
  if (typeof output?.text === "string" && output.text.length > 240) {
    output.text = `${output.text.slice(0, 240)}...`;
  }
  return {
    ok: result.ok,
    providerId: result.providerId,
    upstreamId: result.upstreamId,
    region: result.region,
    modelId: result.modelId,
    provider: result.provider,
    modelEndpoint: result.modelEndpoint,
    requestId: result.requestId,
    input: result.input,
    output,
    message: result.message,
    missingCredentials: result.missingCredentials,
    unsupported: result.unsupported,
  };
}

async function runTarget(input: {
  dataDir: string;
  userId: string;
  account: ProviderAccountRow;
  recordingPath: string;
  target: Target;
  replayOnly: boolean;
}): Promise<{ ok: boolean; mode: "live" | "replay" | "missing-replay"; result?: unknown }> {
  const fixtures = await replayFixtures(input.recordingPath);
  const targetFixtures = filterProviderTestReplayFixturesForStub(fixtures, stubIdForTarget(input.target));
  const mode = targetFixtures.length > 0 ? "replay" : input.replayOnly ? "missing-replay" : "live";
  if (mode === "missing-replay") {
    return {
      ok: false,
      mode,
      result: { ok: false, message: `No replay fixture for ${input.target.modelId}` },
    };
  }

  const app = createLocalApiApp({
    dataDir: input.dataDir,
    userId: input.userId,
    ...(mode === "replay"
      ? { providerTestFetch: createProviderTestReplayFetch(targetFixtures) }
      : { providerTestRecordingPath: input.recordingPath }),
  });
  const response = await app.request("/api/v1/model-providers/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      live: true,
      provider: providerPayload(input.account),
      modelId: input.target.modelId,
    }),
  });
  const result = await response.json();
  return { ok: response.ok && result?.ok === true, mode, result };
}

async function main(): Promise<void> {
  const dataDir = resolve(argValue("--data-dir") ?? defaultLocalApiDataDir(process.env));
  const userId = argValue("--user-id") ?? process.env.CLASH_USER_ID ?? "local-user";
  const recordingPath = resolve(argValue("--recording") ?? process.env.CLASH_PROVIDER_TEST_RECORDING_PATH ?? defaultRecordingPath());
  const replayOnly = hasFlag("--replay");
  await mkdir(dirname(recordingPath), { recursive: true });
  const accounts = await loadProviderAccounts(dataDir);
  const account = googleAgentPlatformAccount(accounts, userId);
  const targets = selectedTargets();

  console.log(JSON.stringify({
    dataDir,
    userId,
    recordingPath,
    mode: replayOnly ? "replay" : "live-once",
    targets: targets.map((target) => target.modelId),
  }, null, 2));

  const results: Array<{ target: Target; mode: string; ok: boolean; result?: unknown }> = [];
  for (const target of targets) {
    const run = await runTarget({ dataDir, userId, account, recordingPath, target, replayOnly });
    results.push({ target, mode: run.mode, ok: run.ok, result: compactResult(run.result) });
    console.log(JSON.stringify({ target, mode: run.mode, ok: run.ok, result: compactResult(run.result) }, null, 2));
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
