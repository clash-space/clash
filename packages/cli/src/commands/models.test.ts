import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  providerPayloadFromOptions,
  providerWriteHeaders,
  publicProviderAccountsResult,
} from "./models";

const modelsSource = readFileSync(fileURLToPath(new URL("./models.ts", import.meta.url)), "utf8");

function commandBlock(source: string, command: string, nextCommand?: string): string {
  const start = source.indexOf(`.command("${command}")`);
  assert.notEqual(start, -1, `${command} command not found`);
  const end = nextCommand ? source.indexOf(`.command("${nextCommand}")`, start + 1) : -1;
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

test("builds a provider account payload from CLI options", () => {
  assert.deepEqual(providerPayloadFromOptions("official", {
    upstream: "openai",
    region: "global",
    weight: "80",
    priority: "2",
  }), {
    providerId: "official",
    upstreamId: "openai",
    region: "global",
    enabled: true,
    weight: 80,
    priority: 2,
  });
});

test("can disable a provider account from CLI options", () => {
  assert.deepEqual(providerPayloadFromOptions("fal", {
    disable: true,
  }), {
    providerId: "fal",
    enabled: false,
  });
});

test("provider account writes use implicit cwd observation CAS", () => {
  const providersSource = commandBlock(modelsSource, "providers", "provider");
  const providerSetSource = commandBlock(modelsSource, "set");

  assert.match(providersSource, /recordAgentObservation/);
  assert.match(providersSource, /publicProviderAccountsResult/);
  assert.doesNotMatch(providersSource, /Read token:/);
  assert.doesNotMatch(providerSetSource, /\.option\("--if-match/);
  assert.doesNotMatch(providerSetSource, /\.option\("--force"/);
  assert.match(providerSetSource, /providerWriteHeaders\(\{/);
  assert.match(providerSetSource, /observedVersion/);
  assert.doesNotMatch(providerSetSource, /force: options\.force === true/);
});

test("provider JSON output hides internal read receipts", () => {
  assert.deepEqual(publicProviderAccountsResult([
    {
      providerId: "fal",
      enabled: true,
      readToken: "provider-account-v1:secret:receipt:secret",
    },
  ] as Array<any>), [
    {
      providerId: "fal",
      enabled: true,
    },
  ]);
});

test("provider write headers carry an internal observed version", () => {
  assert.deepEqual(
    providerWriteHeaders(
      { observedVersion: " provider-accounts-v1:abc " },
      { CLASH_AGENT_MEMBER_ID: "agent-1" },
    ),
    {
      "x-clash-client-type": "agent",
      "x-clash-observed-version": "provider-accounts-v1:abc",
    },
  );
});
