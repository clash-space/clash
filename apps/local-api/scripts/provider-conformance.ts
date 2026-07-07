import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createLocalApiApp } from "../src/app.js";
import { createLocalProviderStore } from "../src/local-provider-store.js";
import {
  findProviderConformanceAccount,
  selectProviderConformanceStubs,
  selectProviderConformanceStubsForAccounts,
  type ProviderConformanceAccountRow,
} from "../src/provider-conformance-runner.js";
import {
  createProviderConformanceStubs,
  createProviderTestReplayFetch,
  createProviderTestReplayFixtures,
  filterProviderTestReplayFixturesForStub,
  readJsonlProviderTestRecording,
  type ProviderConformanceStub,
  type ProviderTestReplayFixture,
} from "../src/provider-test-recorder.js";

type RunMode = "live" | "replay" | "missing-account" | "missing-replay";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function repeatedArgValues(name: string): string[] {
  return process.argv
    .flatMap((arg, index, all) => arg === name && all[index + 1] ? [all[index + 1]] : [])
    .filter(Boolean);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function defaultDesktopDataDir(): string {
  return join(homedir(), "Library", "Application Support", "@master-clash", "desktop", "local-api");
}

function defaultDataDir(): string {
  if (process.env.CLASH_LOCAL_DATA_DIR) return process.env.CLASH_LOCAL_DATA_DIR;
  const desktop = defaultDesktopDataDir();
  if (existsSync(join(desktop, "local.sqlite")) || existsSync(join(desktop, "db.json"))) return desktop;
  return join(homedir(), ".clash", "local-api");
}

function defaultRecordingPath(): string {
  return join(process.cwd(), ".tmp", "provider-recordings", "provider-conformance.jsonl");
}

async function loadProviderAccounts(dataDir: string): Promise<ProviderConformanceAccountRow[]> {
  return createLocalProviderStore(dataDir).loadProviderAccounts();
}

async function replayFixtures(recordingPath: string): Promise<ProviderTestReplayFixture[]> {
  if (!existsSync(recordingPath)) return [];
  const events = await readJsonlProviderTestRecording(recordingPath);
  return createProviderTestReplayFixtures(events);
}

function providerPayload(account: ProviderConformanceAccountRow): ProviderConformanceAccountRow {
  return {
    ...(account.id ? { id: account.id } : {}),
    providerId: account.providerId,
    ...(account.upstreamId ? { upstreamId: account.upstreamId } : {}),
    ...(account.region ? { region: account.region } : {}),
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
    missingOAuth: result.missingOAuth,
    unsupported: result.unsupported,
  };
}

function selectedStubs(input: {
  accounts: readonly ProviderConformanceAccountRow[];
  includeMock: boolean;
  selectors: readonly string[];
  userId: string;
}): ProviderConformanceStub[] {
  const stubs = createProviderConformanceStubs({ includeMock: input.includeMock });
  return input.selectors.length
    ? selectProviderConformanceStubs(stubs, input.selectors)
    : selectProviderConformanceStubsForAccounts(stubs, input.accounts, input.userId);
}

async function runStub(input: {
  dataDir: string;
  userId: string;
  accounts: readonly ProviderConformanceAccountRow[];
  recordingPath: string;
  stub: ProviderConformanceStub;
  replayOnly: boolean;
}): Promise<{ ok: boolean; mode: RunMode; result?: unknown }> {
  const account = findProviderConformanceAccount(input.accounts, input.stub, input.userId);
  if (!account) {
    return {
      ok: false,
      mode: "missing-account",
      result: { ok: false, message: `No configured provider account for ${input.stub.id}` },
    };
  }

  const fixtures = await replayFixtures(input.recordingPath);
  const targetFixtures = filterProviderTestReplayFixturesForStub(fixtures, input.stub.id);
  const mode: RunMode = targetFixtures.length > 0 ? "replay" : input.replayOnly ? "missing-replay" : "live";
  if (mode === "missing-replay") {
    return {
      ok: false,
      mode,
      result: { ok: false, message: `No replay fixture for ${input.stub.id}` },
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
      provider: providerPayload(account),
      modelId: input.stub.modelId,
    }),
  });
  const result = await response.json();
  return { ok: response.ok && result?.ok === true, mode, result };
}

async function main(): Promise<void> {
  const dataDir = resolve(argValue("--data-dir") ?? defaultDataDir());
  const userId = argValue("--user-id") ?? process.env.CLASH_USER_ID ?? "local-user";
  const recordingPath = resolve(argValue("--recording") ?? process.env.CLASH_PROVIDER_TEST_RECORDING_PATH ?? defaultRecordingPath());
  const replayOnly = hasFlag("--replay");
  const includeMock = hasFlag("--include-mock");
  const selectors = repeatedArgValues("--target");

  await mkdir(dirname(recordingPath), { recursive: true });
  const accounts = await loadProviderAccounts(dataDir);
  const targets = selectedStubs({ accounts, includeMock, selectors, userId });

  console.log(JSON.stringify({
    dataDir,
    userId,
    recordingPath,
    mode: replayOnly ? "replay" : "live-once",
    targets: targets.map((target) => target.id),
  }, null, 2));

  const results: Array<{ target: string; mode: RunMode; ok: boolean; result?: unknown }> = [];
  for (const stub of targets) {
    const run = await runStub({ dataDir, userId, accounts, recordingPath, stub, replayOnly });
    const row = {
      target: stub.id,
      mode: run.mode,
      ok: run.ok,
      result: compactResult(run.result),
    };
    results.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
